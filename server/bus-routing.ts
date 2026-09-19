import type { Segment } from "../shared/types";
import {
  loadBusNetworkSnapshot,
  type BusNetworkSnapshot,
  type BusRouteRecord,
  type BusServiceRecord,
} from "./bus-network";
import type { Station, TransitEdge } from "./network";

export interface BusReference {
  key: string;
  boarding: BusRouteRecord;
  service?: BusServiceRecord;
}

const routeKey = (r: BusRouteRecord | BusServiceRecord) =>
  `${r.serviceNo}|${r.operator}|${r.direction}`;

/** DataMall owns connectivity. OSM shapes are optional display enrichment only. */
export function joinOfficialBusRoutes(
  stations: Map<string, Station>,
  transit: Map<string, TransitEdge[]>,
  snapshot = loadBusNetworkSnapshot(),
) {
  if (!snapshot)
    return { matched: 0, schematic: 0, missing: 0, directions: 0, services: 0 };
  const shapes = new Map<string, TransitEdge[]>();
  for (const edges of transit.values())
    for (const edge of edges) {
      if (edge.mode !== "bus" || edge.geometry.length < 3) continue;
      const from = stations
        .get(edge.from)
        ?.codes.find((c) => /^\d{5}$/.test(c));
      const to = stations.get(edge.to)?.codes.find((c) => /^\d{5}$/.test(c));
      if (!from || !to) continue;
      const key = `${edge.line}|${from}|${to}`;
      shapes.set(key, [...(shapes.get(key) ?? []), edge]);
    }
  const stops = new Map(snapshot.stops.map((s) => [s.code, s]));
  // Replace the OSM bus topology, keeping rail and pedestrian networks intact.
  for (const [id, station] of stations)
    if (station.mode === "bus") stations.delete(id);
  for (const [id, edges] of transit)
    transit.set(
      id,
      edges.filter((edge) => edge.mode !== "bus"),
    );
  const byCode = new Map<string, Station>();
  for (const stop of snapshot.stops) {
    const station: Station = {
      id: `bus:datamall:${stop.code}`,
      name: stop.name,
      mode: "bus",
      coord: [stop.lat, stop.lon],
      codes: [stop.code],
    };
    stations.set(station.id, station);
    byCode.set(stop.code, station);
  }
  const services = new Map(snapshot.services.map((s) => [routeKey(s), s]));
  const routes = new Map<string, BusRouteRecord[]>();
  for (const row of snapshot.routes)
    routes.set(routeKey(row), [...(routes.get(routeKey(row)) ?? []), row]);
  let matched = 0,
    missing = 0,
    schematic = 0;
  const addedDirections = new Set<string>(),
    addedServices = new Set<string>();
  for (const [key, rows] of routes) {
    rows.sort((a, b) => a.stopSequence - b.stopSequence);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      const metres = (b.distanceKm - a.distanceKm) * 1000;
      const shape = (
        shapes.get(`${a.serviceNo}|${a.stopCode}|${b.stopCode}`) ?? []
      ).find(
        (e) =>
          metres > 0 &&
          Math.abs(e.distance - metres) <= Math.max(100, metres * 0.25),
      );
      const from = byCode.get(a.stopCode),
        to = byCode.get(b.stopCode);
      // Cumulative distances are rounded to 100 m. Allow rounding/coordinate
      // noise, but reject physically implausible travel distances.
      const chord =
        from && to
          ? Math.hypot(
              (from.coord[0] - to.coord[0]) * 111320,
              (from.coord[1] - to.coord[1]) *
                111320 *
                Math.cos((from.coord[0] * Math.PI) / 180),
            )
          : Infinity;
      if (
        !from ||
        !to ||
        !Number.isFinite(metres) ||
        metres < 0 ||
        metres + 150 < chord ||
        b.stopSequence !== a.stopSequence + 1
      ) {
        missing++;
        continue;
      }
      const service = services.get(key);
      const edge: TransitEdge = {
        mode: "bus",
        geometryKind: shape ? "mapped" : "schematic",
        geometry: shape?.geometry ?? [from.coord, to.coord],
        roadNames: shape?.roadNames,
        from: from.id,
        to: to.id,
        line: a.serviceNo,
        distance: metres,
        minutes: metres / 320 + 0.45,
        direction: stops.get(rows.at(-1)!.stopCode)?.name ?? to.name,
        busReference: { key, boarding: a, service },
      };
      transit.set(from.id, [...(transit.get(from.id) ?? []), edge]);
      if (shape) matched++;
      else schematic++;
      addedDirections.add(key);
      addedServices.add(a.serviceNo);
    }
  }
  return {
    matched,
    schematic,
    missing,
    directions: addedDirections.size,
    services: addedServices.size,
  };
}

function frequencyValues(
  service: BusServiceRecord | undefined,
  readyAt: number,
): number[] | undefined {
  if (!service) return undefined;
  const local = new Date(readyAt + 8 * 3600_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const raw =
    minute >= 390 && minute <= 510
      ? service.amPeakFrequency
      : minute > 510 && minute < 1020
        ? service.amOffpeakFrequency
        : minute >= 1020 && minute <= 1140
          ? service.pmPeakFrequency
          : service.pmOffpeakFrequency;
  if (!raw || !/^\d+(?:-\d+)?$/.test(raw.trim())) return undefined;
  const values = raw.split("-").map(Number);
  if (values.some((n) => n <= 0 || n > 120)) return undefined;
  return values;
}

export function frequencyWait(
  service: BusServiceRecord | undefined,
  readyAt: number,
): number | undefined {
  const values = frequencyValues(service, readyAt);
  if (!values) return undefined;
  // Expected random-arrival wait, not a promised departure time.
  return Math.ceil(values.reduce((a, b) => a + b, 0) / values.length / 2);
}

export function frequencyWaitRange(
  service: BusServiceRecord | undefined,
  readyAt: number,
): [number, number] | undefined {
  const values = frequencyValues(service, readyAt);
  return values ? [0, Math.max(...values)] : undefined;
}

const clockMinutes = (value?: string) => {
  if (!value || !/^\d{4}$/.test(value)) return undefined;
  const h = Number(value.slice(0, 2)),
    m = Number(value.slice(2));
  return h < 48 && m < 60 ? h * 60 + m : undefined;
};

/** Both today's and yesterday's operating windows matter after midnight. */
export function busOperating(
  row: BusRouteRecord,
  readyAt: number,
): boolean | undefined {
  const local = new Date(readyAt + 8 * 3600_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  let known = false;
  for (const offset of [0, 1]) {
    const day = (local.getUTCDay() - offset + 7) % 7;
    const first = clockMinutes(
      day === 0
        ? row.sundayFirstBus
        : day === 6
          ? row.saturdayFirstBus
          : row.weekdayFirstBus,
    );
    let last = clockMinutes(
      day === 0
        ? row.sundayLastBus
        : day === 6
          ? row.saturdayLastBus
          : row.weekdayLastBus,
    );
    if (first === undefined || last === undefined) continue;
    known = true;
    if (last < first) last += 1440;
    if (minute + offset * 1440 >= first && minute + offset * 1440 <= last)
      return true;
  }
  return known ? false : undefined;
}

export function referenceWait(segment: Segment, readyAt: number) {
  return frequencyWait(segment.busReference?.service, readyAt);
}

export function referenceWaitRange(segment: Segment, readyAt: number) {
  return frequencyWaitRange(segment.busReference?.service, readyAt);
}
