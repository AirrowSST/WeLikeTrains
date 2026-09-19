import { describe, expect, it } from "vitest";
import { joinOfficialBusRoutes } from "../server/bus-routing";
import type { BusNetworkSnapshot } from "../server/bus-network";
import type { Station, TransitEdge } from "../server/network";
import { trafficAllowance } from "../server/traffic-timing";
import type { Segment } from "../shared/types";
import { walkingPath } from "../server/network";
import { profiles } from "../shared/catalog";

const snapshot = (): BusNetworkSnapshot => ({
  version: 1,
  source: "fixture",
  accessedAt: "2026-09-19T00:00:00Z",
  accessedOn: "2026-09-19",
  licence: "fixture",
  stops: [
    { code: "10001", name: "A", lat: 1.3, lon: 103.8, roadName: "A Road" },
    { code: "10002", name: "B", lat: 1.301, lon: 103.801, roadName: "B Road" },
    { code: "10003", name: "C", lat: 1.302, lon: 103.802, roadName: "C Road" },
  ],
  services: [],
  routes: [
    {
      serviceNo: "999",
      operator: "X",
      direction: 1,
      stopSequence: 1,
      stopCode: "10001",
      distanceKm: 0,
    },
    {
      serviceNo: "999",
      operator: "X",
      direction: 1,
      stopSequence: 2,
      stopCode: "10002",
      distanceKm: 0.8,
    },
    {
      serviceNo: "999",
      operator: "X",
      direction: 1,
      stopSequence: 3,
      stopCode: "10003",
      distanceKm: 1.2,
    },
    {
      serviceNo: "999",
      operator: "X",
      direction: 2,
      stopSequence: 1,
      stopCode: "10003",
      distanceKm: 0,
    },
    {
      serviceNo: "999",
      operator: "X",
      direction: 2,
      stopSequence: 2,
      stopCode: "10001",
      distanceKm: 1.5,
    },
  ],
});

describe("DataMall-first bus connectivity", () => {
  it("does not invent a return walk from an official stop to itself", () => {
    expect(
      walkingPath([1.3, 103.8], [1.3, 103.8], profiles[0].preferences)
        ?.distance,
    ).toBe(0);
  });
  it("routes every valid direction without any OSM bus shape and keeps official distance", () => {
    const stations = new Map<string, Station>(),
      transit = new Map<string, TransitEdge[]>();
    expect(joinOfficialBusRoutes(stations, transit, snapshot())).toEqual({
      matched: 0,
      schematic: 3,
      missing: 0,
      services: 1,
      directions: 2,
    });
    const edge = transit.get("bus:datamall:10001")![0];
    expect(edge).toMatchObject({
      distance: 800,
      geometryKind: "schematic",
      to: "bus:datamall:10002",
      busReference: { key: "999|X|1" },
    });
    expect(edge.geometry).toEqual([
      [1.3, 103.8],
      [1.301, 103.801],
    ]);
    expect(transit.get("bus:datamall:10003")![0].busReference?.key).toBe(
      "999|X|2",
    );
  });
  it("does not bridge missing stop sequences or use negative distances", () => {
    const data = snapshot();
    data.routes[1].stopSequence = 4;
    data.routes[4].distanceKm = -1;
    const result = joinOfficialBusRoutes(new Map(), new Map(), data);
    expect(result.missing).toBe(3);
    expect(result.schematic).toBe(0);
  });
  it("preserves repeated stop occurrences on loop routes", () => {
    const data = snapshot();
    data.routes = data.routes.slice(0, 3);
    data.routes.push({ ...data.routes[0], stopSequence: 4, distanceKm: 2 });
    const transit = new Map<string, TransitEdge[]>();
    joinOfficialBusRoutes(new Map(), transit, data);
    expect(transit.get("bus:datamall:10003")![0]).toMatchObject({
      to: "bus:datamall:10001",
      busReference: { boarding: { stopSequence: 3 } },
    });
  });
  it("rejects an impossible zero-distance jump rather than creating a fast route", () => {
    const data = snapshot();
    data.stops[1].lat = 1.4;
    data.routes[1].distanceKm = 0;
    const result = joinOfficialBusRoutes(new Map(), new Map(), data);
    expect(result.missing).toBe(2);
    expect(result.schematic).toBe(1);
  });
  it("never applies road-speed matching to a schematic line", () => {
    const segment = {
      mode: "bus",
      geometryKind: "schematic",
      geometry: [
        [1.3, 103.8],
        [1.301, 103.8],
      ],
      minutes: 5,
    } as Segment;
    expect(
      trafficAllowance(segment, [
        {
          id: "road",
          kind: "congestion",
          severity: "high",
          description: "fixture",
          source: "fixture",
          delayMinutes: 0,
          linkId: "road",
          minimumSpeed: 1,
          maximumSpeed: 2,
          location: [1.3, 103.8],
          endLocation: [1.301, 103.8],
        },
      ]),
    ).toBe(0);
  });
});
