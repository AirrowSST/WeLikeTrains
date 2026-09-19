import { describe, expect, it } from "vitest";
import { crowdDescription } from "../shared/crowding";
import { parseCrowds } from "../server/feeds";

describe("crowding labels", () => {
  it("rejects undated or invalid platform readings instead of showing them forever", () => {
    expect(
      parseCrowds(
        {
          value: [
            { Station: "EW2", CrowdLevel: "h" },
            { Station: "EW2", CrowdLevel: "h", StartTime: "invalid" },
          ],
        },
        "EWL",
      ),
    ).toEqual([]);
  });
  it("distinguishes selected bus occupancy from train platform forecasts", () => {
    expect(
      crowdDescription({ mode: "bus", crowd: "high", crowdSource: "current" }),
    ).toBe("Bus occupancy: High · Selected arriving bus");
    expect(
      crowdDescription({
        mode: "rail",
        crowd: "moderate",
        crowdSource: "forecast",
      }),
    ).toBe("Station/platform crowding: Moderate · Forecast");
  });
  it("does not turn unavailable or simulated readings into live facts", () => {
    expect(
      crowdDescription({
        mode: "bus",
        crowd: "unknown",
        crowdSource: "current",
      }),
    ).toContain("Unknown · No usable reading");
    expect(
      crowdDescription({
        mode: "rail",
        crowd: "low",
        crowdSource: "simulated",
      }),
    ).toContain("Low · Simulated");
    expect(crowdDescription({ mode: "rail", crowd: "low" })).toContain(
      "Reading time unverified",
    );
  });
});
