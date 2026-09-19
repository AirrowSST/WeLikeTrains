import { describe, it, expect, afterEach, vi } from "vitest";
import {
  timelineIds,
  timelineDefinition,
  timelineTime,
  timelineInputs,
} from "../shared/timelines";
import { places } from "../shared/catalog";
import { getConditions } from "../server/feeds";
import { planJourney } from "../server/planner";
import { planSchema, savedCommuteSchema } from "../server/validation";
import { startDatamallSimulator } from "../scripts/datamall-simulator";
import type { PlanRequest } from "../shared/types";

const request = (
  id: (typeof timelineIds)[number],
  minute: number,
): PlanRequest => {
  const { profile } = timelineDefinition(id);
  return {
    origin: places.find((p) => p.id === profile.origin)!,
    destination: places.find((p) => p.id === profile.destination)!,
    preferences: profile.preferences,
    departure: timelineTime({ id, minute }),
    dataMode: "demo",
    scenario: "normal",
    timeline: { id, minute },
  };
};
afterEach(() => vi.unstubAllGlobals());
describe("profile timeline playback", () => {
  it("keeps scheduled bus arrivals stable as the simulation clock advances", () => {
    const first = timelineInputs({ id: "rachel-control", minute: 0 }).bus(
      "64009",
      ["27"],
    );
    const next = timelineInputs({ id: "rachel-control", minute: 1 }).bus(
      "64009",
      ["27"],
    );
    expect(first.Services[0].NextBus.EstimatedArrival).toBe(
      next.Services[0].NextBus.EstimatedArrival,
    );
    const departed = timelineInputs({ id: "rachel-control", minute: 4 }).bus(
      "64009",
      ["27"],
    );
    expect(departed.Services[0].NextBus.EstimatedArrival).toBe(
      first.Services[0].NextBus2.EstimatedArrival,
    );
  });
  for (const persona of ["rachel", "arjun", "lim"] as const) {
    it(`${persona}: control stays clear; all eventful conditions start immediately and recover at exact boundaries without network access`, async () => {
      vi.stubGlobal("fetch", () => {
        throw new Error("Timelines must be offline");
      });
      for (const minute of [0, 4, 5, 11, 12, 24, 25, 39, 40, 60]) {
        const control = await getConditions(
          request(`${persona}-control`, minute),
        );
        expect(control.notices).toHaveLength(0);
        expect(control.weather.rain).toBe(false);
        const eventful = await getConditions(
          request(`${persona}-eventful`, minute),
        );
        expect(eventful.notices.length > 0).toBe(minute < 40);
        expect(eventful.weather.walkStatus).toBe(
          minute < 25 ? "invalid" : "valid",
        );
        expect(
          eventful.feeds.every(
            (feed) =>
              feed.status === "demo" && feed.name.startsWith("SIMULATED"),
          ),
        ).toBe(true);
      }
      expect(await getConditions(request(`${persona}-eventful`, 0))).toEqual(
        await getConditions(request(`${persona}-eventful`, 0)),
      );
      const controlPlan = await planJourney(request(`${persona}-control`, 0));
      const eventPlan = await planJourney(request(`${persona}-eventful`, 0));
      expect(controlPlan.travelDecision).toBe("travel");
      if (persona === "lim")
        expect(
          eventPlan.recommended.segments.some((s) => s.stops.includes("EW16")),
        ).toBe(false);
      else
        expect(eventPlan.original.segments.some((s) => s.affected)).toBe(true);
      expect(
        eventPlan.recommended.id !== eventPlan.original.id ||
          eventPlan.recommended.duration !== controlPlan.recommended.duration ||
          eventPlan.travelDecision === "wait",
      ).toBe(true);
      const rainy = await planJourney(request(`${persona}-eventful`, 0));
      expect(rainy.conditions.weather.rain).toBe(true);
      const recovered = await planJourney(request(`${persona}-eventful`, 40));
      expect(recovered.conditions.notices).toHaveLength(0);
      expect(recovered.travelDecision).toBe("travel");
    }, 60000);
  }
  it("validates all six IDs, clock bounds and account isolation", () => {
    expect(timelineIds).toHaveLength(6);
    const demo = request("rachel-control", 0);
    expect(planSchema.safeParse(demo).success).toBe(true);
    for (const invalid of [
      { ...demo, dataMode: "live" },
      { ...demo, departure: "2026-09-21T09:00:00+08:00" },
      { ...demo, timeline: { id: "unknown", minute: 0 } },
      { ...demo, timeline: { id: "rachel-control", minute: 61 } },
      { ...demo, timeline: { id: "rachel-control", minute: 0.5 } },
    ])
      expect(planSchema.safeParse(invalid).success).toBe(false);
    expect(
      savedCommuteSchema.safeParse({
        id: "test",
        label: "Test",
        request: demo,
        hardPreferences: {},
        timeSensitive: "08:45",
        savedAt: demo.departure,
      }).success,
    ).toBe(false);
  });
  it("serves the same timeline API inputs over HTTP without cross-profile state", async () => {
    const server = await startDatamallSimulator();
    try {
      const headers = { AccountKey: "local-test-key" };
      for (const id of timelineIds)
        for (const endpoint of [
          "TrainServiceAlerts",
          "two-hr-forecast",
          "v2/FacilitiesMaintenance",
        ]) {
          const response = await fetch(
            `${server.base}/${endpoint}?timeline=${id}&minute=12`,
            { headers },
          );
          const input = timelineInputs({ id, minute: 12 });
          expect(await response.json()).toEqual(
            endpoint === "TrainServiceAlerts"
              ? input.alerts
              : endpoint === "two-hr-forecast"
                ? input.weather
                : input.maintenance,
          );
        }
      expect(
        (
          await fetch(
            `${server.base}/TrainServiceAlerts?timeline=rachel-control&minute=61`,
            { headers },
          )
        ).status,
      ).toBe(400);
    } finally {
      await server.close();
    }
  });
});
