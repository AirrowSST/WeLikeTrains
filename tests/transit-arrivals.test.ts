import { describe, expect, it } from "vitest";
import { matchingBusTimes } from "../src/TransitArrivals";
import { trainArrivalsSchema } from "../server/validation";
import type { BusArrival } from "../shared/types";

describe("active journey arrival filtering", () => {
  it("shows only future monitored buses for the exact service and boarding stop", () => {
    const now = Date.parse("2026-09-21T07:40:00+08:00");
    const bus: BusArrival = {
      service: "27",
      stop: "76141",
      eta: new Date(now + 60000).toISOString(),
      monitored: true,
      status: "live",
      load: "low",
      wheelchair: true,
      type: "SD",
    };
    expect(
      matchingBusTimes(
        [
          bus,
          bus,
          { ...bus, service: "2" },
          { ...bus, stop: "76149" },
          { ...bus, monitored: false },
          { ...bus, status: "stale" },
          { ...bus, eta: "bad" },
          { ...bus, eta: new Date(now - 60000).toISOString() },
          { ...bus, eta: new Date(now + 300000).toISOString() },
        ],
        "76141",
        "27",
        now,
      ),
    ).toEqual([bus.eta, new Date(now + 300000).toISOString()]);
  });
  it("validates and bounds station-board requests", () => {
    const body = {
      line: "EWL",
      from: "Tampines",
      to: "Raffles Place",
      stops: ["EW2", "EW14"],
    };
    expect(trainArrivalsSchema.safeParse(body).success).toBe(true);
    expect(
      trainArrivalsSchema.safeParse({ ...body, at: "invalid" }).success,
    ).toBe(false);
    expect(
      trainArrivalsSchema.safeParse({ ...body, stops: Array(151).fill("EW2") })
        .success,
    ).toBe(false);
  });
});
