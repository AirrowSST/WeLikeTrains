import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { TransitStop } from "../shared/types";

export const LTA_BUS_REFERENCE_ENDPOINTS = [
  "BusStops",
  "BusRoutes",
  "BusServices",
] as const;
export const LTA_OPEN_DATA_LICENCE = "Singapore Open Data Licence version 1.0";

export interface BusStopRecord {
  code: string;
  name: string;
  roadName: string;
  lat: number;
  lon: number;
}

export interface BusRouteRecord {
  serviceNo: string;
  operator: string;
  direction: number;
  stopSequence: number;
  stopCode: string;
  distanceKm: number;
  weekdayFirstBus?: string;
  weekdayLastBus?: string;
  saturdayFirstBus?: string;
  saturdayLastBus?: string;
  sundayFirstBus?: string;
  sundayLastBus?: string;
}

export interface BusServiceRecord {
  serviceNo: string;
  operator: string;
  direction: number;
  category: string;
  originCode?: string;
  destinationCode?: string;
  loopDescription?: string;
  amPeakFrequency?: string;
  amOffpeakFrequency?: string;
  pmPeakFrequency?: string;
  pmOffpeakFrequency?: string;
}

export interface BusNetworkSnapshot {
  version: 1;
  source: string;
  accessedAt: string;
  accessedOn: string;
  licence: string;
  stops: BusStopRecord[];
  routes: BusRouteRecord[];
  services: BusServiceRecord[];
}

export interface BusReferenceRows {
  BusStops: unknown[];
  BusRoutes: unknown[];
  BusServices: unknown[];
}

type DataMallConnection = {
  base: string;
  key: string;
};

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

const objectRow = (value: unknown, endpoint: string, index: number) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${endpoint} row ${index + 1} is not an object`);
  return value as Record<string, unknown>;
};

const requiredText = (
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
  index: number,
) => {
  const value = row[field];
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error(`${endpoint} row ${index + 1} has no ${field}`);
  const result = String(value).trim();
  if (!result)
    throw new Error(`${endpoint} row ${index + 1} has an empty ${field}`);
  return result;
};

const optionalText = (row: Record<string, unknown>, field: string) => {
  const value = row[field];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value).trim() || undefined;
};

const requiredNumber = (
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
  index: number,
) => {
  const value = Number(row[field]);
  if (!Number.isFinite(value))
    throw new Error(`${endpoint} row ${index + 1} has an invalid ${field}`);
  return value;
};

export async function fetchBusReferenceRows(
  connection: DataMallConnection,
  request: typeof fetch = fetch,
): Promise<BusReferenceRows> {
  const result = {} as BusReferenceRows;
  for (const endpoint of LTA_BUS_REFERENCE_ENDPOINTS) {
    const rows: unknown[] = [];
    for (let skip = 0; ; skip += 500) {
      if (skip > 200_000)
        throw new Error(
          `${endpoint} exceeded the maintenance import safety cap`,
        );
      const response = await request(
        `${connection.base}/${endpoint}?$skip=${skip}`,
        {
          redirect: "error",
          headers: { AccountKey: connection.key, Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok)
        throw new Error(
          `${endpoint} request failed (${response.status}) at $skip=${skip}`,
        );
      const body = (await response.json()) as { value?: unknown };
      if (!Array.isArray(body?.value))
        throw new Error(
          `${endpoint} returned an invalid response at $skip=${skip}`,
        );
      rows.push(...body.value);
      if (body.value.length < 500) break;
    }
    if (!rows.length) throw new Error(`${endpoint} returned no rows`);
    result[endpoint] = rows;
  }
  return result;
}

export function buildBusNetworkSnapshot(
  rows: BusReferenceRows,
  accessedAt: string,
): BusNetworkSnapshot {
  const accessedOn = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(accessedAt));
  const stopMap = new Map<string, BusStopRecord>();
  rows.BusStops.forEach((value, index) => {
    const row = objectRow(value, "BusStops", index);
    const code = requiredText(row, "BusStopCode", "BusStops", index);
    const lat = requiredNumber(row, "Latitude", "BusStops", index);
    const lon = requiredNumber(row, "Longitude", "BusStops", index);
    if (!/^\d{5}$/.test(code) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw new Error(
        `BusStops row ${index + 1} has an invalid stop or coordinate`,
      );
    stopMap.set(code, {
      code,
      name: requiredText(row, "Description", "BusStops", index),
      roadName: requiredText(row, "RoadName", "BusStops", index),
      lat,
      lon,
    });
  });

  const routeMap = new Map<string, BusRouteRecord>();
  rows.BusRoutes.forEach((value, index) => {
    const row = objectRow(value, "BusRoutes", index);
    const serviceNo = requiredText(row, "ServiceNo", "BusRoutes", index);
    const operator = requiredText(row, "Operator", "BusRoutes", index);
    const direction = requiredNumber(row, "Direction", "BusRoutes", index);
    const stopSequence = requiredNumber(
      row,
      "StopSequence",
      "BusRoutes",
      index,
    );
    const stopCode = requiredText(row, "BusStopCode", "BusRoutes", index);
    const distanceKm = requiredNumber(row, "Distance", "BusRoutes", index);
    if (
      !Number.isInteger(direction) ||
      direction < 1 ||
      !Number.isInteger(stopSequence) ||
      stopSequence < 1 ||
      !/^\d{5}$/.test(stopCode) ||
      distanceKm < 0
    )
      throw new Error(`BusRoutes row ${index + 1} has invalid route ordering`);
    const route: BusRouteRecord = {
      serviceNo,
      operator,
      direction,
      stopSequence,
      stopCode,
      distanceKm,
      weekdayFirstBus: optionalText(row, "WD_FirstBus"),
      weekdayLastBus: optionalText(row, "WD_LastBus"),
      saturdayFirstBus: optionalText(row, "SAT_FirstBus"),
      saturdayLastBus: optionalText(row, "SAT_LastBus"),
      sundayFirstBus: optionalText(row, "SUN_FirstBus"),
      sundayLastBus: optionalText(row, "SUN_LastBus"),
    };
    routeMap.set(
      `${serviceNo}|${operator}|${direction}|${stopSequence}|${stopCode}`,
      route,
    );
  });

  const serviceMap = new Map<string, BusServiceRecord>();
  rows.BusServices.forEach((value, index) => {
    const row = objectRow(value, "BusServices", index);
    const serviceNo = requiredText(row, "ServiceNo", "BusServices", index);
    const operator = requiredText(row, "Operator", "BusServices", index);
    const direction = requiredNumber(row, "Direction", "BusServices", index);
    if (!Number.isInteger(direction) || direction < 1)
      throw new Error(`BusServices row ${index + 1} has an invalid Direction`);
    const service: BusServiceRecord = {
      serviceNo,
      operator,
      direction,
      category: requiredText(row, "Category", "BusServices", index),
      originCode: optionalText(row, "OriginCode"),
      destinationCode: optionalText(row, "DestinationCode"),
      loopDescription: optionalText(row, "LoopDesc"),
      amPeakFrequency: optionalText(row, "AM_Peak_Freq"),
      amOffpeakFrequency: optionalText(row, "AM_Offpeak_Freq"),
      pmPeakFrequency: optionalText(row, "PM_Peak_Freq"),
      pmOffpeakFrequency: optionalText(row, "PM_Offpeak_Freq"),
    };
    serviceMap.set(`${serviceNo}|${operator}|${direction}`, service);
  });

  return {
    version: 1,
    source: "LTA DataMall BusStops, BusRoutes and BusServices",
    accessedAt,
    accessedOn,
    licence: LTA_OPEN_DATA_LICENCE,
    stops: [...stopMap.values()].sort((a, b) => naturalCompare(a.code, b.code)),
    routes: [...routeMap.values()].sort(
      (a, b) =>
        naturalCompare(a.serviceNo, b.serviceNo) ||
        naturalCompare(a.operator, b.operator) ||
        a.direction - b.direction ||
        a.stopSequence - b.stopSequence,
    ),
    services: [...serviceMap.values()].sort(
      (a, b) =>
        naturalCompare(a.serviceNo, b.serviceNo) ||
        naturalCompare(a.operator, b.operator) ||
        a.direction - b.direction,
    ),
  };
}

let cachedSnapshot: BusNetworkSnapshot | null | undefined;
const defaultSnapshotUrl = new URL(
  "../data/bus-network.json.gz",
  import.meta.url,
);

export function loadBusNetworkSnapshot(path = defaultSnapshotUrl) {
  const isDefault = path.href === defaultSnapshotUrl.href;
  if (cachedSnapshot !== undefined && isDefault)
    return cachedSnapshot ?? undefined;
  try {
    if (!existsSync(path)) {
      if (isDefault) cachedSnapshot = null;
      return undefined;
    }
    const parsed = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.stops) ||
      !Array.isArray(parsed.routes) ||
      !Array.isArray(parsed.services)
    )
      throw new Error("Unsupported bus network snapshot");
    if (isDefault) cachedSnapshot = parsed as BusNetworkSnapshot;
    return parsed as BusNetworkSnapshot;
  } catch {
    if (isDefault) cachedSnapshot = null;
    return undefined;
  }
}

export function listDataMallBusStops(
  snapshot = loadBusNetworkSnapshot(),
): TransitStop[] {
  if (!snapshot) return [];
  const servicesByStop = new Map<string, Set<string>>();
  for (const route of snapshot.routes) {
    const services = servicesByStop.get(route.stopCode) ?? new Set<string>();
    services.add(route.serviceNo);
    servicesByStop.set(route.stopCode, services);
  }
  return snapshot.stops.map((stop) => ({
    id: `lta-bus:${stop.code}`,
    name: stop.name,
    mode: "bus",
    lat: stop.lat,
    lon: stop.lon,
    codes: [stop.code],
    lines: [...(servicesByStop.get(stop.code) ?? [])].sort(naturalCompare),
  }));
}
