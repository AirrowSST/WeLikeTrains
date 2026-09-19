import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFICIAL_LTA_BASE, pacedDataMallFetch } from "../server/lta-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("DataMall request pacing", () => {
  it("spaces simultaneous official request starts below the burst quota", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const starts: number[] = [];
    const usableSignals: boolean[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        starts.push(Date.now());
        usableSignals.push(!!init?.signal && !init.signal.aborted);
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await Promise.all(
      ["TrainServiceAlerts", "PCDRealTime", "PCDForecast"].map((endpoint) =>
        pacedDataMallFetch(`${OFFICIAL_LTA_BASE}/${endpoint}`, {}, 100),
      ),
    );

    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(350);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(350);
    expect(usableSignals).toEqual([true, true, true]);
  });
});
