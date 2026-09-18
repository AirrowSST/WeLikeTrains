import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { Segment } from "../shared/types";
import {
  activeServiceIds,
  buildRailScheduleSnapshot,
  evaluateRailSegments,
  loadRailScheduleSnapshot,
  parseGtfsTime,
  selectCatchableTrain,
  type GtfsScheduleFiles,
} from "../server/rail-schedule";

const fixtureFiles = (): GtfsScheduleFiles => {
  const read = (name: string) =>
    readFileSync(new URL(`./fixtures/gtfs/${name}`, import.meta.url), "utf8");
  return {
    routes: read("routes.txt"),
    stops: read("stops.txt"),
    trips: read("trips.txt"),
    stopTimes: read("stop_times.txt"),
    calendar: read("calendar.txt"),
    calendarDates: read("calendar_dates.txt"),
  };
};

const snapshot = () =>
  buildRailScheduleSnapshot(fixtureFiles(), "2026-09-19T00:00:00.000Z");

describe("GTFS-backed rail timing", () => {
  it("parses service-day times beyond midnight without treating them as wall-clock times", () => {
    expect(parseGtfsTime("25:03:30")).toBe(90_210);
    expect(() => parseGtfsTime("not-a-time")).toThrow(/GTFS time/i);
  });

  it("normalizes platform stops and applies calendar-date exceptions", () => {
    const data = snapshot();
    expect(data.trips[0].stops[0][0]).toBe("EW2");
    expect(activeServiceIds(data, "2026-09-21")).toContain("WKD");
    expect(activeServiceIds(data, "2026-09-22")).not.toContain("WKD");
    expect(activeServiceIds(data, "2026-09-22")).toContain("SPECIAL");
  });

  it("selects the first train that remains catchable after station access", () => {
    const result = selectCatchableTrain(snapshot(), {
      line: "EWL",
      fromCodes: ["EW2", "Tampines"],
      toCodes: ["EW14", "Raffles Place"],
      readyAt: "2026-09-21T07:56:00+08:00",
    });

    expect(result).toMatchObject({
      tripId: "EWL-catchable",
      fromCode: "EW2",
      toCode: "EW14",
      waitMinutes: 2,
      rideMinutes: 36 + 20 / 60,
    });
  });

  it("considers the previous service date for a beyond-24:00 train", () => {
    const result = selectCatchableTrain(snapshot(), {
      line: "EWL",
      fromCodes: ["EW2"],
      toCodes: ["EW14"],
      readyAt: "2026-09-19T00:09:00+08:00",
    });

    expect(result?.tripId).toBe("EWL-after-midnight");
    expect(result?.waitMinutes).toBe(1);
    expect(result?.departureAt).toBe("2026-09-18T16:10:00.000Z");
  });

  it("advances the journey clock through access, wait and ride, then falls back visibly outside snapshot coverage", () => {
    const segments: Segment[] = [
      {
        id: "walk-home-tampines",
        mode: "walk",
        line: "walk",
        from: "Home",
        to: "Tampines",
        minutes: 14,
        distance: 900,
        geometry: [
          [1.35, 103.94],
          [1.353, 103.945],
        ],
        stops: [],
        crowd: "unknown",
        affected: false,
        delay: 0,
        sheltered: false,
        accessibility: "unknown",
        instructions: "Walk to Tampines.",
        source: "Fixture",
      },
      {
        id: "EWL-Tampines",
        mode: "rail",
        line: "EWL",
        direction: "Tuas Link",
        from: "Tampines",
        to: "Raffles Place",
        minutes: 38,
        distance: 19_000,
        geometry: [
          [1.353, 103.945],
          [1.284, 103.851],
        ],
        stops: ["EW2", "EW14", "Tampines", "Raffles Place"],
        crowd: "unknown",
        affected: false,
        delay: 0,
        sheltered: true,
        accessibility: "unknown",
        instructions: "Board EWL.",
        source: "Estimated",
        waitMinutes: 4,
      },
    ];

    const scheduled = evaluateRailSegments(
      segments,
      "2026-09-21T07:40:00+08:00",
      snapshot(),
      { stationAccessMinutes: 2, interchangeMinutes: 3 },
    );
    expect(scheduled.scheduledSegments).toBe(1);
    expect(scheduled.segments[1].minutes).toBeCloseTo(40 + 20 / 60);
    expect(scheduled.segments[1].waitMinutes).toBe(4);
    expect(scheduled.segments[1].instructions).toContain("07:58");
    expect(scheduled.segments[1].source).toContain(
      "LTA DataMall GTFS Schedule",
    );

    const fallback = evaluateRailSegments(
      segments,
      "2027-01-04T07:40:00+08:00",
      snapshot(),
    );
    expect(fallback.scheduledSegments).toBe(0);
    expect(fallback.fallbackSegments).toBe(1);
    expect(fallback.segments[1].minutes).toBe(38);
    expect(fallback.segments[1].source).toContain("fallback");
  });

  it("advances through a rail transfer before selecting the next catchable train", () => {
    const firstLeg: Segment = {
      id: "EWL-Tampines",
      mode: "rail",
      line: "EWL",
      direction: "Tuas Link",
      from: "Tampines",
      to: "Raffles Place",
      minutes: 38,
      distance: 19_000,
      geometry: [
        [1.353, 103.945],
        [1.284, 103.851],
      ],
      stops: ["EW2", "EW14"],
      crowd: "unknown",
      affected: false,
      delay: 0,
      sheltered: true,
      accessibility: "unknown",
      instructions: "Board EWL.",
      source: "Estimated",
    };
    const secondLeg: Segment = {
      ...firstLeg,
      id: "NSL-Raffles-Place",
      line: "NSL",
      direction: "Jurong East",
      from: "Raffles Place",
      to: "Orchard",
      stops: ["NS26", "NS22"],
      minutes: 9,
      distance: 3_500,
      instructions: "Change to NSL.",
    };

    const result = evaluateRailSegments(
      [firstLeg, secondLeg],
      "2026-09-21T07:56:00+08:00",
      snapshot(),
      { stationAccessMinutes: 2, interchangeMinutes: 3 },
    );

    expect(result.scheduledSegments).toBe(2);
    expect(result.segments[1].waitMinutes).toBeCloseTo(3 + 40 / 60);
    expect(result.segments[1].instructions).toContain("08:38");
  });

  it("treats a corrupt local snapshot as unavailable instead of breaking planning", () => {
    const directory = mkdtempSync(join(tmpdir(), "wayce-gtfs-"));
    const path = join(directory, "broken.json.gz");
    try {
      writeFileSync(path, "not a gzip archive");
      expect(loadRailScheduleSnapshot(pathToFileURL(path))).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
