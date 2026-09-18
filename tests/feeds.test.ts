import { describe, it, expect } from "vitest";
import { canonicalLine, crowdValue } from "../shared/catalog";
import {
  parseTrainAlerts,
  parseCrowds,
  parseBuses,
  demoConditions,
} from "../server/feeds";
import { extractPreferences, decodePolyline } from "../server/providers";
import { noticeActive } from "../server/planner";
import { planSchema } from "../server/validation";
describe("official data contracts", () => {
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
    });
  });
  it("does not apply a future closure to the current commute", () => {
    const c = demoConditions("normal", "2026-09-21T07:40:00+08:00");
    expect(noticeActive(c.notices[0], "2026-09-21T07:40:00+08:00", 60)).toBe(
      false,
    );
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
    });
    expect(extractPreferences("No cycling please")).toMatchObject({
      cycling: false,
    });
  });
  it("decodes routing geometry with signed coordinate deltas", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
  it("rejects outside-Singapore coordinates and invalid preferences", () => {
    expect(planSchema.safeParse({ origin: { lat: 51, lon: 0 } }).success).toBe(
      false,
    );
  });
});
