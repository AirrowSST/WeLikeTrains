import { afterEach, describe, it, expect, vi } from "vitest";
import { canonicalLine, crowdValue } from "../shared/catalog";
import {
  LTA_ENDPOINTS,
  DataMallQuotaError,
  cachedFetch,
  crowdFeedLinesForSegments,
  feedCache,
  feedQuotaBackoff,
  getConditions,
  getRailCrowding,
  parseTrainAlerts,
  parseCrowds,
  parseBuses,
  parseEstimatedTravelTimes,
  parseFloodAlerts,
  parseTrafficSpeedBands,
  demoConditions,
} from "../server/feeds";
import estimatedTravelTimes from "./fixtures/datamall/estimated-travel-times.json";
import pubFloodAlerts from "./fixtures/datamall/pub-flood-alerts.json";
import trafficSpeedBands from "./fixtures/datamall/traffic-speed-bands-v4.json";
import {
  extractPreferences,
  localChat,
  resolveChatToolCalls,
} from "../server/providers";
import type { PlanResponse, Segment } from "../shared/types";
import { noticeActive } from "../server/planner";
import { planSchema } from "../server/validation";

afterEach(() => {
  feedCache.clear();
  feedQuotaBackoff.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe("official data contracts", () => {
  it("scopes crowd calls to route lines and reuses their cache", async () => {
    vi.stubEnv("LTA_ACCOUNT_KEY", "test-key");
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ value: [] }),
    );
    vi.stubGlobal("fetch", fetcher);

    await getConditions({
      dataMode: "live",
      scenario: "normal",
      departure: "2026-09-21T07:40:00+08:00",
    });
    expect(
      fetcher.mock.calls.some(([url]) =>
        /PCDRealTime|PCDForecast/.test(String(url)),
      ),
    ).toBe(false);

    const first = await getRailCrowding(["EWL", "EWL", "CGL", "invalid"]);
    const second = await getRailCrowding(["CGL", "EWL"]);
    const crowdUrls = fetcher.mock.calls
      .map(([url]) => String(url))
      .filter((url) => /PCDRealTime|PCDForecast/.test(url));
    expect(crowdUrls).toHaveLength(4);
    expect(new Set(crowdUrls)).toEqual(
      new Set([
        "https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime?TrainLine=EWL",
        "https://datamall2.mytransport.sg/ltaodataservice/PCDForecast?TrainLine=EWL",
        "https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime?TrainLine=CGL",
        "https://datamall2.mytransport.sg/ltaodataservice/PCDForecast?TrainLine=CGL",
      ]),
    );
    expect(first.feeds).toHaveLength(4);
    expect(second.feeds).toHaveLength(4);
  });

  it("derives crowd API lines from only the rail segments and branch codes", () => {
    const segment = (mode: Segment["mode"], line: string, stops: string[]) =>
      ({ mode, line, stops }) as Segment;
    expect(
      crowdFeedLinesForSegments([
        segment("rail", "EWL", ["EW4", "CG1", "CG2"]),
        segment("rail", "CCL", ["CC4", "CE1"]),
        segment("bus", "27", ["76141"]),
      ]).sort(),
    ).toEqual(["CCL", "CEL", "CGL", "EWL"]);
  });

  it("identifies DataMall quota faults hidden behind HTTP 500", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            fault: {
              faultstring: "Rate limit quota violation. Quota limit exceeded.",
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const request = () =>
      cachedFetch(
        "quota-fixture",
        "https://datamall2.mytransport.sg/ltaodataservice/PCDForecast?TrainLine=EWL",
        0,
        { AccountKey: "test-key" },
      );
    await expect(request()).rejects.toBeInstanceOf(DataMallQuotaError);
    await expect(request()).rejects.toBeInstanceOf(DataMallQuotaError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("excludes road works from live requests and feed diagnostics", async () => {
    vi.stubEnv("LTA_ACCOUNT_KEY", "test-key");
    const fetcher = vi.fn(async (_input: unknown) =>
      jsonResponse({ value: [] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await getConditions({
      dataMode: "live",
      scenario: "normal",
      departure: "2026-09-21T07:40:00+08:00",
    });
    const urls = fetcher.mock.calls.map((args) => String(args[0]));
    expect(urls.some((url) => url.includes("TrainServiceAlerts"))).toBe(true);
    expect(urls.some((url) => /RoadWorks/i.test(url))).toBe(false);
    expect(result.feeds.some((feed) => /road works/i.test(feed.name))).toBe(
      false,
    );
    expect(
      result.notices.some((notice) => /RoadWorks/i.test(notice.source)),
    ).toBe(false);
  });
  it("keeps per-segment mitigations, direction and the separate advisory stream", () => {
    const data = {
      value: {
        Status: 2,
        AffectedSegments: [
          {
            Line: "STL",
            Direction: "Both",
            Stations: "SE1, SE2",
            FreePublicBus: "SE1,SE2",
            FreeMRTShuttle: "Sengkang → Ranggung",
          },
        ],
        Message: [
          { Content: "Major delays", CreatedDate: "2026-09-21T07:20:00+08:00" },
        ],
      },
    };
    const [notice] = parseTrainAlerts(data);
    expect(notice).toMatchObject({
      line: "SLRT",
      stations: ["SE1", "SE2"],
      freeBus: "SE1,SE2",
      shuttle: "Sengkang → Ranggung",
      direction: "Both",
    });
    expect(notice.description).toBe("Major delays");
  });
  it("preserves messages on days with empty affected segments", () => {
    const result = parseTrainAlerts({
      value: {
        Status: 1,
        AffectedSegments: [],
        Message: [{ Content: "Bus diversion today" }],
      },
    });
    expect(result[0].kind).toBe("advisory");
  });
  it("normalises extension and LRT aliases", () => {
    expect(["STL", "PTL", "CGL", "CEL", "BPL"].map(canonicalLine)).toEqual([
      "SLRT",
      "PLRT",
      "EWL",
      "CCL",
      "BPL",
    ]);
  });
  it("parses nested 30-minute forecasts separately from live crowd readings", () => {
    const data = {
      value: [
        {
          Date: "2026-09-21",
          Stations: [
            {
              Station: "EW14",
              Interval: [{ StartTime: "08:00:00", CrowdLevel: "h" }],
            },
          ],
        },
      ],
    };
    expect(parseCrowds(data, "CGL", true)[0]).toMatchObject({
      station: "EW14",
      line: "EWL",
      level: "high",
      forecast: true,
      start: "2026-09-21T08:00:00+08:00",
    });
  });
  it("distinguishes three bus occupancy levels, unknown values and WAB", () => {
    expect(["SEA", "SDA", "LSD", "NA"].map(crowdValue)).toEqual([
      "low",
      "moderate",
      "high",
      "unknown",
    ]);
    const buses = parseBuses(
      {
        Services: [
          {
            ServiceNo: "196",
            NextBus: {
              EstimatedArrival: "2026-09-21T08:00:00+08:00",
              Load: "LSD",
              Feature: "WAB",
              Type: "DD",
              Monitored: 1,
            },
          },
        ],
      },
      "84009",
    );
    expect(buses[0]).toMatchObject({
      load: "high",
      wheelchair: true,
      type: "DD",
      monitored: true,
    });
  });
  it("uses the current DataMall paths for audited road and flood feeds", () => {
    expect(LTA_ENDPOINTS).toMatchObject({
      floodAlerts: "PubFloodAlerts",
      trafficSpeedBands: "v4/TrafficSpeedBands",
      estimatedTravelTimes: "EstTravelTimes",
    });
  });
  it("parses v4 traffic speed-band geometry and speed fields", () => {
    expect(parseTrafficSpeedBands(trafficSpeedBands)[0]).toMatchObject({
      id: "speed-band-103040000",
      kind: "congestion",
      roadName: "Pan Island Expressway",
      roadCategory: "A",
      location: [1.3421, 103.9201],
      endLocation: [1.3429, 103.9211],
      speedBand: 3,
      minimumSpeed: 30,
      maximumSpeed: 39,
      delayMinutes: 0,
    });
  });
  it("parses expressway travel-time sections without treating ETA as delay", () => {
    expect(parseEstimatedTravelTimes(estimatedTravelTimes)[0]).toMatchObject({
      id: "expressway-AYE-1-AYE/MCE Interchange-Clementi Avenue 6",
      kind: "expressway",
      expressway: "AYE",
      direction: "1",
      farEndPoint: "Tuas Checkpoint",
      startPoint: "AYE/MCE Interchange",
      endPoint: "Clementi Avenue 6",
      estimatedMinutes: 5,
      delayMinutes: 0,
    });
  });
  it("parses the current PUB CAP-style flood fields", () => {
    expect(parseFloodAlerts(pubFloodAlerts)[0]).toMatchObject({
      id: "pub-flood-PUB-20260921-001",
      title: "Flash flood at Jalan Boon Lay",
      description:
        "Water is rising across the affected carriageway. Avoid the affected road and nearby walkways.",
      severity: "critical",
      startsAt: "2026-09-21T07:30:00+08:00",
      endsAt: "2026-09-21T09:00:00+08:00",
      location: [1.3312, 103.7058],
      roadName: "Jalan Boon Lay",
    });
  });
  it("reports the audited feeds independently when an upstream fails", async () => {
    vi.stubEnv("LTA_ACCOUNT_KEY", "test-account-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/${LTA_ENDPOINTS.floodAlerts}`))
        throw new Error("PUB unavailable");
      if (url.endsWith(`/${LTA_ENDPOINTS.trafficSpeedBands}`))
        return jsonResponse(trafficSpeedBands);
      if (url.endsWith(`/${LTA_ENDPOINTS.estimatedTravelTimes}`))
        return jsonResponse(estimatedTravelTimes);
      return jsonResponse({ value: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const conditions = await getConditions({
      dataMode: "live",
      scenario: "normal",
      departure: "2026-09-21T07:40:00+08:00",
    });

    expect(
      conditions.feeds.find((feed) => feed.name === "PUB flood alerts")?.status,
    ).toBe("unavailable");
    expect(
      conditions.feeds.find((feed) => feed.name === "Traffic speeds")?.status,
    ).toBe("live");
    expect(
      conditions.feeds.find((feed) => feed.name === "Expressway travel times")
        ?.status,
    ).toBe("live");
    expect(conditions.traffic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ linkId: "103040000" }),
        expect.objectContaining({ estimatedMinutes: 5 }),
      ]),
    );
  });
  it("returns a recent cached feed as stale after an upstream failure", async () => {
    const at = Date.parse("2026-09-21T07:30:00+08:00");
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(at)
      .mockReturnValueOnce(at + 61_000)
      .mockReturnValueOnce(at + 61_000);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ value: ["current"] }))
        .mockRejectedValueOnce(new Error("temporary upstream failure")),
    );

    await cachedFetch("stale-fixture", "https://example.invalid/feed", 60_000);
    const fallback = await cachedFetch(
      "stale-fixture",
      "https://example.invalid/feed",
      60_000,
    );

    expect(fallback).toMatchObject({
      value: { value: ["current"] },
      at,
      stale: true,
    });
  });
  it("does not apply a future closure to the current commute", () => {
    const c = demoConditions("normal", "2026-09-21T07:40:00+08:00");
    expect(noticeActive(c.notices[0], "2026-09-21T07:40:00+08:00", 60)).toBe(
      false,
    );
  });
  it("applies labelled custom weather only to deterministic demo conditions", () => {
    const conditions = demoConditions(
      "disruption",
      "2026-09-21T07:40:00+08:00",
      { kind: "storm", rainfallMm: 12, temperature: 28 },
    );
    expect(conditions.weather).toMatchObject({
      forecast: "Heavy demo thunderstorms",
      rain: true,
      rainfallMm: 12,
      walkStatus: "invalid",
      cycleStatus: "invalid",
    });
    expect(
      conditions.feeds.find((feed) => feed.name === "Weather")?.detail,
    ).toBe("Custom simulated weather");
  });
  it("extracts preferences without executing user instructions", () => {
    expect(
      extractPreferences(
        "I walk slowly, avoid crowds, and need a sheltered route",
      ),
    ).toMatchObject({
      stepFree: true,
      walkingSpeed: 40,
      avoidCrowds: true,
      sheltered: true,
      shelterMode: "require",
    });
    expect(extractPreferences("I prefer sheltered walks")).toMatchObject({
      sheltered: true,
      shelterMode: "prefer",
    });
    expect(extractPreferences("I don't need a sheltered route")).toMatchObject({
      sheltered: false,
      shelterMode: "prefer",
    });
    expect(extractPreferences("No cycling please")).toMatchObject({
      cycling: false,
    });
  });
  it("validates chat tool calls before proposing app actions", () => {
    const plan = {
      recommended: {
        id: "dtl",
        title: "Take DTL",
        blocked: false,
        range: [57, 69],
        walkMinutes: 23,
        crowd: "low",
        transfers: 1,
      },
      alternatives: [
        {
          id: "blocked-ewl",
          title: "Blocked EWL",
          blocked: true,
          range: [50, 60],
          walkMinutes: 10,
          crowd: "moderate",
          transfers: 0,
        },
      ],
    } as PlanResponse;
    const accepted = resolveChatToolCalls(
      [
        {
          name: "propose_preferences",
          args: { avoidCrowds: true, maxWalk: 800 },
        },
        { name: "recommend_route", args: { routeId: "dtl" } },
        { name: "display_routes", args: { routeIds: ["dtl"] } },
      ],
      plan,
    );
    expect(accepted.preferences).toEqual({ avoidCrowds: true, maxWalk: 800 });
    expect(accepted.recommendedRouteId).toBe("dtl");
    expect(accepted.displayedRouteIds).toEqual(["dtl"]);
    expect(accepted.responses).toHaveLength(3);
    expect(
      localChat("Show me the route options", plan).displayedRouteIds,
    ).toEqual(["dtl"]);

    const rejected = resolveChatToolCalls(
      [
        { name: "propose_preferences", args: { maxWalk: 50 } },
        { name: "recommend_route", args: { routeId: "blocked-ewl" } },
        {
          name: "display_routes",
          args: { routeIds: ["dtl", "blocked-ewl"] },
        },
      ],
      plan,
    );
    expect(rejected.preferences).toBeUndefined();
    expect(rejected.recommendedRouteId).toBeUndefined();
    expect(rejected.displayedRouteIds).toBeUndefined();
    expect(
      rejected.responses.every((response) => response.response?.error),
    ).toBe(true);
  });
  it("rejects outside-Singapore coordinates and invalid preferences", () => {
    expect(planSchema.safeParse({ origin: { lat: 51, lon: 0 } }).success).toBe(
      false,
    );
  });
});
