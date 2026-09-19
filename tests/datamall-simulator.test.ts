import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { startDatamallSimulator } from "../scripts/datamall-simulator";
import { ltaConnection } from "../server/lta-client";
import {
  cachedFetch,
  feedCache,
  feedQuotaBackoff,
  getBusArrivals,
  getConditions,
} from "../server/feeds";
import { getNetwork } from "../server/network";
import { planJourney } from "../server/planner";
import type { PlanRequest } from "../shared/types";

const servers: Awaited<ReturnType<typeof startDatamallSimulator>>[] = [];
const start = async () => {
  const server = await startDatamallSimulator({
    now: () => Date.parse("2026-09-21T07:40:00+08:00"),
  });
  servers.push(server);
  return server;
};
const headers = { AccountKey: "local-test-key" };
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  feedCache.clear();
  feedQuotaBackoff.clear();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("local DataMall HTTP simulator", () => {
  it("uses a dummy key, parses missed-first-bus arrivals, and isolates provider caches", async () => {
    const server = await start();
    server.setScenario("missed-first-bus");
    vi.stubEnv("LTA_BASE_URL", server.base);
    vi.stubEnv("LTA_ACCOUNT_KEY", "must-never-reach-the-simulator");
    expect(ltaConnection().key).toBe("local-test-key");
    const arrivals = await getBusArrivals("76141");
    expect(arrivals.status).toBe("demo");
    expect(arrivals.buses.map((bus) => bus.eta)).toEqual([
      "2026-09-20T23:46:00.000Z",
      "2026-09-20T23:51:00.000Z",
      "2026-09-20T23:58:00.000Z",
    ]);
    expect(
      arrivals.buses.filter(
        (bus) => Date.parse(bus.eta) >= Date.parse("2026-09-21T07:48:00+08:00"),
      )[0].eta,
    ).toBe("2026-09-20T23:51:00.000Z");
    const other = await start();
    other.setScenario("rate-limited");
    vi.stubEnv("LTA_BASE_URL", other.base);
    await expect(getBusArrivals("76141")).rejects.toThrow("429");
  });
  it("makes the first catchable simulated bus change route timing", async () => {
    const server = await start();
    vi.stubEnv("LTA_BASE_URL", server.base);
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(server.base)) return nativeFetch(input, init);
        if (url.includes("four-day-outlook"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: {
                  records: [
                    {
                      forecasts: [
                        {
                          timestamp: "2026-09-21T00:00:00+08:00",
                          forecast: { summary: "Fair" },
                        },
                      ],
                    },
                  ],
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        return Promise.reject(new Error("Non-LTA provider offline in test"));
      },
    );
    const network = getNetwork();
    const origin = [...network.stations.values()].find((station) =>
      station.codes.includes("64009"),
    )!;
    const destination = [...network.stations.values()].find((station) =>
      station.codes.includes("64379"),
    )!;
    const request: PlanRequest = {
      origin: {
        id: "sim-hougang",
        name: origin.name,
        subtitle: "Synthetic route start",
        lat: origin.coord[0],
        lon: origin.coord[1],
      },
      destination: {
        id: "sim-punggol-cc",
        name: destination.name,
        subtitle: "Synthetic route destination",
        lat: destination.coord[0],
        lon: destination.coord[1],
      },
      departure: "2026-09-21T07:47:00+08:00",
      preferences: {
        maxWalk: 500,
        walkingSpeed: 75,
        avoidCrowds: false,
        stepFree: false,
        sheltered: false,
        cycling: false,
        alertThreshold: 10,
      },
      dataMode: "live",
      scenario: "normal",
    };

    server.setScenario("normal");
    const normal = await planJourney(request);
    feedCache.clear();
    server.setScenario("missed-first-bus");
    const missed = await planJourney(request);
    const normalBus = normal.recommended.segments.find(
      (segment) => segment.line === "27",
    )!;
    const missedBus = missed.recommended.segments.find(
      (segment) => segment.line === "27",
    )!;

    expect(normalBus).toMatchObject({ waitMinutes: 2, crowd: "low" });
    expect(missedBus).toMatchObject({ waitMinutes: 3, crowd: "moderate" });
    expect(missed.recommended.duration).toBe(normal.recommended.duration + 1);
    expect(Date.parse(missed.recommended.arrival)).toBe(
      Date.parse(normal.recommended.arrival) + 60_000,
    );
    expect(
      missed.conditions.feeds.find((feed) =>
        feed.name.includes("SIMULATED · Bus arrivals 64009"),
      ),
    ).toMatchObject({ status: "demo" });
  });
  it("enforces headers, returns 500-row pages and a final empty page", async () => {
    const server = await start();
    expect((await fetch(`${server.base}/BusStops`)).status).toBe(401);
    for (const endpoint of ["BusStops", "BusRoutes", "BusServices"]) {
      for (const [skip, count] of [
        [0, 500],
        [500, 1],
        [1000, 0],
      ]) {
        const result = await fetch(`${server.base}/${endpoint}?$skip=${skip}`, {
          headers,
        });
        expect((await result.json()).value).toHaveLength(count);
      }
    }
  });
  it("serves authored GTFS ZIPs through expiring links", async () => {
    let clock = Date.now();
    const server = await startDatamallSimulator({ now: () => clock });
    servers.push(server);
    const metadata = await (
      await fetch(`${server.base}/GTFSScheduleTrain`, { headers })
    ).json();
    const link = metadata.value[0].Link;
    const zip = await (await fetch(link)).arrayBuffer();
    expect(Object.keys(unzipSync(new Uint8Array(zip)))).toContain(
      "stop_times.txt",
    );
    clock += 15 * 60_000;
    expect((await fetch(link)).status).toBe(403);
  });
  it("exercises stale cache, rate limits, malformed JSON and timeouts over HTTP", async () => {
    const server = await start();
    server.setScenario("stale");
    const url = `${server.base}/BusStops`;
    await cachedFetch(url, url, 0, headers);
    expect((await cachedFetch(url, url, 0, headers)).stale).toBe(true);
    feedCache.clear();
    server.setScenario("malformed");
    await expect(cachedFetch(url, url, 0, headers)).rejects.toThrow();
    server.setScenario("rate-limited");
    expect((await fetch(url, { headers })).headers.get("Retry-After")).toBe(
      "30",
    );
    server.setScenario("timeout");
    await expect(
      fetch(url, { headers, signal: AbortSignal.timeout(30) }),
    ).rejects.toThrow();
  });
  it("labels simulated feeds and partial failure while keeping weather independent", async () => {
    const server = await start();
    server.setScenario("partial-failure");
    vi.stubEnv("LTA_BASE_URL", server.base);
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) =>
        String(input).startsWith(server.base)
          ? nativeFetch(input, init)
          : Promise.reject(new Error("Weather offline in test")),
    );
    const result = await getConditions({
      dataMode: "live",
      scenario: "normal",
      departure: "2026-09-21T07:40:00+08:00",
    });
    expect(
      result.feeds.find((feed) => feed.name === "SIMULATED · Traffic speeds")
        ?.status,
    ).toBe("unavailable");
    expect(
      result.feeds.find(
        (feed) => feed.name === "SIMULATED · LTA service alerts",
      )?.status,
    ).toBe("demo");
    expect(
      result.notices.every((notice) => notice.title.startsWith("SIMULATED")),
    ).toBe(true);
  });
  it("rejects production overrides and remote targets", () => {
    vi.stubEnv("LTA_BASE_URL", "http://127.0.0.1:8090/ltaodataservice");
    vi.stubEnv("NODE_ENV", "production");
    expect(ltaConnection).toThrow("development-only");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LTA_BASE_URL", "https://example.com");
    expect(ltaConnection).toThrow("127.0.0.1");
  });
});
