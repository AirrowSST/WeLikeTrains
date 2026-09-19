import { describe, it, expect } from "vitest";
import {
  busOperating,
  frequencyWait,
  joinOfficialBusRoutes,
} from "../server/bus-routing";
import { buildGeospatial } from "../server/geospatial";
import { trafficAllowance } from "../server/traffic-timing";
import { decodeRealtime, predictedStopTime } from "../server/rail-realtime";
import Gtfs from "gtfs-realtime-bindings";
import type { Segment } from "../shared/types";
import {
  releasedPlannedRows,
  replacePlannedDirections,
} from "../server/planned-buses";
import { timingMetrics } from "../scripts/evaluate-journey-timings";
import { nearestReading, parseCrowds } from "../server/feeds";
import {
  selectCatchableTrain,
  type RailScheduleSnapshot,
} from "../server/rail-schedule";

describe("official routing inputs", () => {
  it("joins NEA station IDs to coordinates and rejects old observations", () => {
    const now = Date.parse("2026-09-21T07:40:00+08:00");
    const data = {
      data: {
        stations: [
          { id: "far", location: { latitude: 1.4, longitude: 103.9 } },
          { id: "near", location: { latitude: 1.3, longitude: 103.8 } },
        ],
        readings: [
          {
            timestamp: new Date(now).toISOString(),
            data: [
              { stationId: "far", value: 12 },
              { stationId: "near", value: 0 },
            ],
          },
        ],
      },
    };
    expect(nearestReading(data, { lat: 1.3, lon: 103.8 }, now)).toBe(0);
    expect(
      nearestReading(data, { lat: 1.3, lon: 103.8 }, now + 21 * 60000),
    ).toBeUndefined();
    expect(
      parseCrowds(
        {
          value: [
            {
              Station: "EW2",
              Start: "2026-09-21T07:30:00+08:00",
              CrowdLevel: "h",
            },
          ],
        },
        "EWL",
        true,
      )[0].start,
    ).toContain("07:30");
  });
  it("reselects a later train after cancellation or a skipped destination, including realtime delays", () => {
    const data: RailScheduleSnapshot = {
      version: 1,
      accessedAt: "",
      accessedOn: "",
      source: "fixture",
      licence: "fixture",
      validFrom: "2026-01-01",
      validUntil: "2026-12-31",
      services: [
        {
          id: "daily",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          addedDates: [],
          removedDates: [],
        },
      ],
      trips: [
        {
          id: "first",
          serviceId: "daily",
          line: "EWL",
          headsign: "",
          stops: [
            ["EW2", 28000, 28000],
            ["EW14", 30000, 30000],
          ],
        },
        {
          id: "second",
          serviceId: "daily",
          line: "EWL",
          headsign: "",
          stops: [
            ["EW2", 28300, 28300],
            ["EW14", 30300, 30300],
          ],
        },
      ],
    };
    const request = {
      line: "EWL",
      fromCodes: ["EW2"],
      toCodes: ["EW14"],
      readyAt: "2026-09-21T07:40:00+08:00",
    };
    expect(
      selectCatchableTrain(data, {
        ...request,
        updates: [
          {
            tripId: "first",
            startDate: "20260921",
            cancelled: true,
            stops: [],
          },
        ],
      })?.tripId,
    ).toBe("second");
    expect(
      selectCatchableTrain(data, {
        ...request,
        updates: [
          {
            tripId: "first",
            startDate: "20260921",
            cancelled: false,
            stops: [{ code: "EW14", skipped: true, noData: false }],
          },
        ],
      })?.tripId,
    ).toBe("second");
    expect(
      selectCatchableTrain(data, {
        ...request,
        updates: [
          {
            tripId: "first",
            startDate: "20260921",
            cancelled: false,
            delay: 60,
            stops: [],
          },
        ],
      })?.departureAt,
    ).toBe(
      new Date(
        Date.parse("2026-09-21T00:00:00+08:00") + 28060 * 1000,
      ).toISOString(),
    );
  });
  it("never releases future planned route data and rejects incomplete direction replacement", () => {
    const rows = [
      { EffectiveDate: "20260920T00:00:00+0800" },
      { EffectiveDate: "20260919T00:00:00+0800" },
      { EffectiveDate: "invalid" },
    ];
    expect(
      releasedPlannedRows(rows, Date.parse("2026-09-19T08:00:00+08:00")),
    ).toEqual([rows[1]]);
    const row = {
      serviceNo: "1",
      operator: "X",
      direction: 1,
      stopCode: "12345",
      stopSequence: 1,
      distanceKm: 0,
    };
    expect(
      replacePlannedDirections([row], [{ ...row, stopSequence: 2 }]),
    ).toEqual([row]);
  });
  it("measures observed errors and refuses an empty calibration sample", () => {
    expect(
      timingMetrics([
        {
          predictedMinutes: 20,
          actualMinutes: 25,
          lowerMinutes: 17,
          upperMinutes: 28,
          catchable: true,
        },
      ]),
    ).toMatchObject({
      observations: 1,
      medianAbsoluteErrorMinutes: 5,
      intervalCoverage: 1,
      catchableFraction: 1,
    });
    expect(() => timingMetrics([])).toThrow(/No observations/);
  });
  it("uses peak/offpeak headways and handles overnight service windows", () => {
    const service = {
      serviceNo: "27",
      operator: "X",
      direction: 1,
      category: "TRUNK",
      amPeakFrequency: "6-10",
      amOffpeakFrequency: "12-16",
    };
    expect(
      frequencyWait(service, Date.parse("2026-09-21T07:40:00+08:00")),
    ).toBe(4);
    expect(
      frequencyWait(service, Date.parse("2026-09-21T10:40:00+08:00")),
    ).toBe(7);
    expect(
      frequencyWait(
        { ...service, amPeakFrequency: "-" },
        Date.parse("2026-09-21T07:40:00+08:00"),
      ),
    ).toBeUndefined();
    const row = {
      serviceNo: "27",
      operator: "X",
      direction: 1,
      stopCode: "12345",
      stopSequence: 1,
      distanceKm: 0,
      weekdayFirstBus: "0600",
      weekdayLastBus: "0030",
    };
    expect(busOperating(row, Date.parse("2026-09-22T00:20:00+08:00"))).toBe(
      true,
    );
    expect(busOperating(row, Date.parse("2026-09-22T02:20:00+08:00"))).toBe(
      false,
    );
  });
  it("matches covered paths conservatively without covering a nearby parallel street", () => {
    const geo = buildGeospatial({
      version: 1,
      accessedAt: "",
      layers: {
        CoveredLinkWay: [
          {
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [103.8, 1.3],
                [103.801, 1.3],
              ],
            },
          },
        ],
      },
    });
    expect(geo.covered.matches([1.3, 103.8001], [1.3, 103.8008])).toBe(true);
    expect(geo.covered.matches([1.3003, 103.8001], [1.3003, 103.8008])).toBe(
      false,
    );
  });
  it("applies only aligned slow traffic and never accelerates a bus or adjusts its wait", () => {
    const segment = {
      mode: "bus",
      minutes: 14,
      waitMinutes: 4,
      geometry: [
        [1.3, 103.8],
        [1.3, 103.801],
      ],
    } as Segment;
    const reading = {
      id: "x",
      kind: "congestion" as const,
      severity: "high" as const,
      description: "",
      source: "LTA",
      delayMinutes: 0,
      linkId: "1",
      minimumSpeed: 0,
      maximumSpeed: 9,
      location: [1.3, 103.8] as [number, number],
      endLocation: [1.3, 103.801] as [number, number],
    };
    expect(trafficAllowance(segment, [reading])).toBeGreaterThan(0);
    expect(
      trafficAllowance(segment, [
        {
          ...reading,
          location: reading.endLocation,
          endLocation: reading.location,
        },
      ]),
    ).toBe(0);
    expect(
      trafficAllowance(segment, [
        { ...reading, minimumSpeed: 50, maximumSpeed: 59 },
      ]),
    ).toBe(0);
  });
  it("decodes cancellation/skip predictions and rejects stale/differential feeds", () => {
    const now = Date.parse("2026-09-21T07:40:00+08:00");
    const encode = (timestamp: number, incrementality = 0) =>
      Gtfs.transit_realtime.FeedMessage.encode(
        Gtfs.transit_realtime.FeedMessage.fromObject({
          header: { gtfsRealtimeVersion: "2.0", timestamp, incrementality },
          entity: [
            {
              id: "x",
              tripUpdate: {
                trip: {
                  tripId: "trip",
                  startDate: "20260921",
                  scheduleRelationship: 3,
                },
                stopTimeUpdate: [{ stopId: "EW2_B", scheduleRelationship: 1 }],
              },
            },
          ],
        }),
      ).finish();
    const data = decodeRealtime(encode(now / 1000), now);
    expect(data.updates[0]).toMatchObject({
      cancelled: true,
      stops: [{ code: "EW2", skipped: true }],
    });
    expect(() => decodeRealtime(encode(now / 1000 - 601), now)).toThrow(
      /stale/,
    );
    expect(() => decodeRealtime(encode(now / 1000, 1), now)).toThrow(
      /Differential/,
    );
    expect(
      predictedStopTime(
        { ...data.updates[0], cancelled: false, delay: 120, stops: [] },
        ["EW2"],
        0,
        now,
        true,
      ),
    ).toBe(now + 120000);
  });
});
