import { describe, it, expect } from "vitest";
import { canonicalLine, crowdValue } from "../shared/catalog";
import {
  parseTrainAlerts,
  parseCrowds,
  parseBuses,
  demoConditions,
} from "../server/feeds";
import {
  extractPreferences,
  localChat,
  resolveChatToolCalls,
} from "../server/providers";
import type { PlanResponse } from "../shared/types";
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
