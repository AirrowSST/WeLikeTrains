import { loadBusNetworkSnapshot, type BusNetworkSnapshot } from "./bus-network";
import {
  activeServiceIds,
  loadRailScheduleSnapshot,
  type RailScheduleSnapshot,
} from "./rail-schedule";
import { cachedFetch, isDataMallQuotaError, parseCrowds } from "./feeds";
import { ltaConnection } from "./lta-client";
import { canonicalLine } from "../shared/catalog";
import type { TransitStop } from "../shared/types";
import type { BusServiceMap, StationBoard } from "../shared/transit-details";

export function busServiceMap(
  service: string,
  stopCode: string,
  snapshot: BusNetworkSnapshot | undefined = loadBusNetworkSnapshot(),
): BusServiceMap {
  if (!snapshot) return { service, directions: [] };
  const directions = [
    ...new Set(
      snapshot.routes
        .filter((r) => r.serviceNo === service && r.stopCode === stopCode)
        .map((r) => r.direction),
    ),
  ];
  const stops = new Map(snapshot.stops.map((s) => [s.code, s]));
  const services = new Map<string, Set<string>>();
  for (const row of snapshot.routes) {
    const set = services.get(row.stopCode) ?? new Set<string>();
    set.add(row.serviceNo);
    services.set(row.stopCode, set);
  }
  return {
    service,
    directions: directions.map((direction) => ({
      direction,
      stops: snapshot.routes
        .filter((r) => r.serviceNo === service && r.direction === direction)
        .sort((a, b) => a.stopSequence - b.stopSequence)
        .flatMap((r) => {
          const s = stops.get(r.stopCode);
          return s
            ? [
                {
                  id: `lta-bus:${s.code}`,
                  name: s.name,
                  mode: "bus" as const,
                  lat: s.lat,
                  lon: s.lon,
                  codes: [s.code],
                  lines: [...(services.get(s.code) ?? [])].sort((a, b) =>
                    a.localeCompare(b, undefined, { numeric: true }),
                  ),
                  sequence: r.stopSequence,
                },
              ]
            : [];
        }),
    })),
  };
}

export function stationDepartures(
  stop: TransitStop,
  at: number,
  snapshot: RailScheduleSnapshot | undefined = loadRailScheduleSnapshot(),
): StationBoard {
  const result: StationBoard = {
    groups: [],
    crowds: [],
    accessedOn: snapshot?.accessedOn,
  };
  if (!snapshot) return result;
  const day = new Date(at + 8 * 3600000).toISOString().slice(0, 10);
  const dates = [-1, 0, 1].map((offset) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const groups = new Map<string, StationBoard["groups"][number]>();
  for (const date of dates) {
    const active = new Set(activeServiceIds(snapshot, date));
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    for (const trip of snapshot.trips) {
      if (!active.has(trip.serviceId)) continue;
      trip.stops.slice(0, -1).forEach(([code, , seconds], index) => {
        if (!stop.codes.includes(code)) return;
        const departure = midnight + seconds * 1000;
        if (departure < at || departure > at + 90 * 60000) return;
        const towards = trip.headsign || trip.stops.at(-1)![0];
        // Keep branches separate even when their public headsign is identical.
        const key = `${trip.line}:${towards}:${trip.stops[index + 1][0]}`;
        const group = groups.get(key) ?? {
          line: trip.line,
          towards,
          times: [],
        };
        group.times.push(new Date(departure).toISOString());
        groups.set(key, group);
      });
    }
  }
  result.groups = [...groups.values()].map((g) => ({
    ...g,
    times: [...new Set(g.times)].sort().slice(0, 3),
  }));
  return result;
}

export async function stationCrowds(
  stop: TransitStop,
  forecast = false,
): Promise<StationBoard["crowds"]> {
  const connection = ltaConnection();
  // Crowd feeds keep extension codes separate from the main lines.
  const byPrefix: Record<string, string> = {
    EW: "EWL",
    NS: "NSL",
    NE: "NEL",
    DT: "DTL",
    CC: "CCL",
    TE: "TEL",
    CG: "CGL",
    CE: "CEL",
    BP: "BPL",
    SE: "SLRT",
    SW: "SLRT",
    PE: "PLRT",
    PW: "PLRT",
  };
  const codedLines = stop.codes
    .map((code) => byPrefix[code.match(/^[A-Z]+/)?.[0] ?? ""])
    .filter(Boolean);
  const results = await Promise.all(
    [
      ...new Set(
        codedLines.length ? codedLines : stop.lines.map(canonicalLine),
      ),
    ].map(async (line) => {
      const unavailable = {
        line,
        level: "unknown" as const,
        status: "unavailable",
      };
      if (!connection.key) return [unavailable];
      try {
        const url = `${connection.base}/${forecast ? "PCDForecast" : "PCDRealTime"}?TrainLine=${encodeURIComponent(line)}`;
        const response = await cachedFetch(
          url,
          url,
          forecast ? 21600000 : 60000,
          {
            AccountKey: connection.key,
          },
          forecast ? 30 * 3600000 : 3600000,
        );
        if (response.stale && forecast)
          return [{ ...unavailable, status: "stale" }];
        const now = Date.now();
        const readings = parseCrowds(response.value, line, forecast)
          .filter(
            (r) =>
              stop.codes.includes(r.station) &&
              (forecast || Date.parse(r.start) <= now),
          )
          .sort((a, b) =>
            forecast
              ? Date.parse(a.start) - Date.parse(b.start)
              : Date.parse(b.start) - Date.parse(a.start),
          );
        const active = forecast
          ? readings.filter((reading) => Date.parse(reading.end) > now)
          : readings.filter((reading) => Date.parse(reading.end) > now);
        const selected = active.length
          ? active
          : forecast
            ? []
            : readings.filter(
                (reading) => now - Date.parse(reading.end) <= 60 * 60000,
              );
        const unique = selected
          .filter(
            (r, i, all) =>
              all.findIndex(
                (other) => other.start === r.start && other.end === r.end,
              ) === i,
          )
          .slice(0, forecast ? 3 : 1);
        return unique.length
          ? unique.map((reading) => ({
              line,
              level: reading.level,
              start: reading.start,
              end: reading.end,
              status: connection.simulated
                ? "simulated"
                : response.stale || Date.parse(reading.end) <= now
                  ? "stale"
                  : forecast
                    ? "forecast"
                    : "current station crowd",
            }))
          : [unavailable];
      } catch (error) {
        return [
          {
            ...unavailable,
            status: isDataMallQuotaError(error)
              ? "rate-limited"
              : "unavailable",
          },
        ];
      }
    }),
  );
  return results.flat();
}
