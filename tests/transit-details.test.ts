import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stationDepartures,
  busServiceMap,
  stationCrowds,
} from "../server/transit-details";
import * as feeds from "../server/feeds";
vi.mock("../server/lta-client", () => ({
  ltaConnection: () => ({
    key: "test-key",
    base: "http://127.0.0.1",
    simulated: false,
  }),
}));
afterEach(() => vi.restoreAllMocks());
import { stationColor } from "../shared/transit-details";
import type { RailScheduleSnapshot } from "../server/rail-schedule";
import type { BusNetworkSnapshot } from "../server/bus-network";

describe("map transit details", () => {
  it("returns three ordered forecast slots separately, using extension feed codes", async () => {
    const stop = {
      id: "expo",
      name: "Expo",
      mode: "rail" as const,
      codes: ["CG1"],
      lines: ["EWL"],
      lat: 1.3,
      lon: 103.8,
    };
    const now = Date.now();
    const value = {
      value: [3, -2, 1, 0, 2].map((i) => ({
        Station: "CG1",
        CrowdLevel: "m",
        StartTime: new Date(now + i * 1800000).toISOString(),
        EndTime: new Date(now + (i + 1) * 1800000).toISOString(),
      })),
    };
    const mock = vi
      .spyOn(feeds, "cachedFetch")
      .mockResolvedValue({ value, at: now, stale: false });
    const forecasts = await stationCrowds(stop, true);
    expect(mock.mock.calls[0][1]).toContain("PCDForecast?TrainLine=CGL");
    expect(forecasts).toHaveLength(3);
    expect(
      forecasts.every((r) => r.status === "forecast" && r.line === "CGL"),
    ).toBe(true);
    expect(forecasts.map((r) => r.start)).toEqual(
      [0, 1, 2].map((i) => new Date(now + i * 1800000).toISOString()),
    );
    mock.mockRejectedValue(new Error("Unavailable"));
    expect(await stationCrowds(stop, true)).toEqual([
      { line: "CGL", level: "unknown", status: "unavailable" },
    ]);
    mock.mockResolvedValue({ value, at: now, stale: true });
    expect((await stationCrowds(stop, true))[0]).toMatchObject({
      level: "unknown",
      status: "stale",
    });
  });
  it("labels stale and recently expired platform crowd observations", async () => {
    const stop = {
      id: "rail",
      name: "Station",
      mode: "rail" as const,
      codes: ["EW2"],
      lines: ["EWL"],
      lat: 1.3,
      lon: 103.8,
    };
    const now = Date.now();
    const value = {
      value: [
        {
          Station: "EW2",
          CrowdLevel: "h",
          StartTime: new Date(now - 60000).toISOString(),
          EndTime: new Date(now + 60000).toISOString(),
        },
      ],
    };
    const mock = vi
      .spyOn(feeds, "cachedFetch")
      .mockResolvedValue({ value, at: now, stale: false });
    expect((await stationCrowds(stop))[0].level).toBe("high");
    mock.mockResolvedValue({ value, at: now, stale: true });
    expect((await stationCrowds(stop))[0]).toMatchObject({
      level: "high",
      status: "stale",
    });
    mock.mockResolvedValue({
      value: {
        value: [
          { ...value.value[0], EndTime: new Date(now - 1).toISOString() },
        ],
      },
      at: now,
      stale: false,
    });
    expect((await stationCrowds(stop))[0]).toMatchObject({
      level: "high",
      status: "stale",
    });
  });
  it("colours each interchange code and branch with its line", () => {
    expect(stationColor("EW2")).toBe(stationColor("CG1"));
    expect(stationColor("EW2")).not.toBe(stationColor("DT32"));
    expect(stationColor("", ["CEL"])).toBe(stationColor("CC1"));
  });
  it("keeps bus directions and repeated stop occurrences in sequence", () => {
    const snapshot = {
      stops: [
        { code: "12345", name: "A", lat: 1.3, lon: 103.8 },
        { code: "12346", name: "B", lat: 1.31, lon: 103.81 },
      ],
      routes: [
        { serviceNo: "27", direction: 1, stopCode: "12345", stopSequence: 3 },
        { serviceNo: "27", direction: 1, stopCode: "12345", stopSequence: 1 },
        { serviceNo: "27", direction: 1, stopCode: "12346", stopSequence: 2 },
        { serviceNo: "27", direction: 2, stopCode: "12346", stopSequence: 1 },
      ],
    } as BusNetworkSnapshot;
    const result = busServiceMap("27", "12345", snapshot);
    expect(result.directions).toHaveLength(1);
    expect(result.directions[0].stops.map((s) => s.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(result.directions[0].stops.map((s) => s.codes[0])).toEqual([
      "12345",
      "12346",
      "12345",
    ]);
    expect(busServiceMap("99", "12345", snapshot).directions).toEqual([]);
  });
  it("shows three departures per direction, excludes terminal boarding and respects service dates", () => {
    const snapshot = {
      version: 1,
      accessedAt: "",
      accessedOn: "",
      source: "fixture",
      licence: "",
      validFrom: "2026-01-01",
      validUntil: "2026-12-31",
      services: [
        {
          id: "weekday",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          weekdays: [1],
          addedDates: [],
          removedDates: [],
        },
      ],
      trips: [0, 1, 2, 3].flatMap((i) => [
        {
          id: `east-${i}`,
          serviceId: "weekday",
          line: "EWL",
          headsign: "East",
          stops: [
            ["EW2", 28800 + i * 300, 28800 + i * 300],
            ["EW1", 29400 + i * 300, 29400 + i * 300],
          ],
        },
        {
          id: `west-${i}`,
          serviceId: "weekday",
          line: "EWL",
          headsign: "West",
          stops: [
            ["EW2", 28920 + i * 300, 28920 + i * 300],
            ["EW3", 29520 + i * 300, 29520 + i * 300],
          ],
        },
        {
          id: `terminal-${i}`,
          serviceId: "weekday",
          line: "EWL",
          headsign: "Terminal",
          stops: [
            ["EW1", 28000, 28000],
            ["EW2", 28800, 28800],
          ],
        },
      ]),
    } as RailScheduleSnapshot;
    const stop = {
      id: "rail",
      name: "Station",
      mode: "rail" as const,
      codes: ["EW2"],
      lines: ["EWL"],
      lat: 1.3,
      lon: 103.8,
    };
    const board = stationDepartures(
      stop,
      Date.parse("2026-09-21T08:00:00+08:00"),
      snapshot,
    );
    expect(board.groups.map((g) => g.towards)).toEqual(["East", "West"]);
    expect(board.groups.every((g) => g.times.length === 3)).toBe(true);
    expect(
      stationDepartures(stop, Date.parse("2026-09-20T08:00:00+08:00"), snapshot)
        .groups,
    ).toEqual([]);
  });
});
