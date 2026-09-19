import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Segment } from "../shared/types";
import { canonicalLine } from "../shared/catalog";
import { predictedStopTime, type TrainUpdate } from "./rail-realtime";

export const LTA_GTFS_ENDPOINT =
  "https://datamall2.mytransport.sg/ltaodataservice/GTFSScheduleTrain";
export const LTA_OPEN_DATA_LICENCE =
  "https://datamall.lta.gov.sg/content/datamall/en/SingaporeOpenDataLicence.html";

export interface GtfsScheduleFiles {
  routes: string;
  stops: string;
  trips: string;
  stopTimes: string;
  calendar: string;
  calendarDates: string;
}

export interface RailScheduleService {
  id: string;
  startDate: string;
  endDate: string;
  weekdays: number[];
  addedDates: string[];
  removedDates: string[];
}

export interface RailScheduleTrip {
  id: string;
  serviceId: string;
  line: string;
  headsign: string;
  stops: [
    stationCode: string,
    arrivalSeconds: number,
    departureSeconds: number,
  ][];
}

export interface RailScheduleSnapshot {
  version: 1;
  accessedAt: string;
  accessedOn: string;
  source: string;
  licence: string;
  validFrom: string;
  validUntil: string;
  services: RailScheduleService[];
  trips: RailScheduleTrip[];
}

interface CsvRow {
  [column: string]: string;
}

const compactDate = (value: string) => {
  if (!/^\d{8}$/.test(value)) throw new Error(`Invalid GTFS date: ${value}`);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
};

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index++;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  const [headers = [], ...values] = rows;
  return values.map((columns) =>
    Object.fromEntries(
      headers.map((header, index) => [
        header.replace(/^\uFEFF/, ""),
        columns[index] ?? "",
      ]),
    ),
  );
}

export function parseGtfsTime(value: string) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid GTFS time: ${value}`);
  const [, hoursText, minutesText, secondsText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (minutes > 59 || seconds > 59)
    throw new Error(`Invalid GTFS time: ${value}`);
  return hours * 3600 + minutes * 60 + seconds;
}

const linePrefixes: Record<string, string[]> = {
  BPL: ["BP"],
  CCL: ["CC"],
  CEL: ["CE"],
  CGL: ["CG"],
  DTL: ["DT"],
  EWL: ["EW"],
  NEL: ["NE"],
  NSL: ["NS"],
  PLRT: ["PE", "PW"],
  SLRT: ["SE", "SW"],
  TEL: ["TE"],
};

const stationCodes = (...values: string[]) =>
  values.flatMap(
    (value) => value.toUpperCase().match(/[A-Z]{1,3}\d{1,3}[A-Z]?/g) ?? [],
  );

function normalizedStationCode(
  stop: CsvRow | undefined,
  stopId: string,
  line: string,
) {
  const codes = stationCodes(
    stop?.stop_code ?? "",
    stop?.parent_station ?? "",
    stopId,
  );
  const prefixes = linePrefixes[line] ?? [];
  return (
    codes.find((code) => prefixes.some((prefix) => code.startsWith(prefix))) ??
    codes[0]
  );
}

export function buildRailScheduleSnapshot(
  files: GtfsScheduleFiles,
  accessedAt: string,
): RailScheduleSnapshot {
  const routes = new Map(
    parseCsv(files.routes).map((row) => [
      row.route_id,
      canonicalLine(row.route_short_name || row.route_id),
    ]),
  );
  const stops = new Map(parseCsv(files.stops).map((row) => [row.stop_id, row]));
  const tripRows = parseCsv(files.trips);
  const tripsById = new Map(
    tripRows.map((row) => [
      row.trip_id,
      {
        id: row.trip_id,
        serviceId: row.service_id,
        line: routes.get(row.route_id) ?? canonicalLine(row.route_id),
        headsign: row.trip_headsign ?? "",
      },
    ]),
  );
  const stopTimes = new Map<
    string,
    { sequence: number; stop: [string, number, number] }[]
  >();
  for (const row of parseCsv(files.stopTimes)) {
    const trip = tripsById.get(row.trip_id);
    if (!trip || !trip.line) continue;
    const code = normalizedStationCode(
      stops.get(row.stop_id),
      row.stop_id,
      trip.line,
    );
    if (!code) continue;
    try {
      const arrival = parseGtfsTime(row.arrival_time);
      const departure = parseGtfsTime(row.departure_time || row.arrival_time);
      const values = stopTimes.get(row.trip_id) ?? [];
      values.push({
        sequence: Number(row.stop_sequence),
        stop: [code, arrival, departure],
      });
      stopTimes.set(row.trip_id, values);
    } catch {
      // A malformed record must not make an otherwise valid maintenance import unusable.
    }
  }

  const trips = [...tripsById.values()]
    .map((trip): RailScheduleTrip | undefined => {
      const rows = (stopTimes.get(trip.id) ?? []).sort(
        (left, right) => left.sequence - right.sequence,
      );
      const normalized: RailScheduleTrip["stops"] = [];
      for (const row of rows) {
        const previous = normalized.at(-1);
        if (previous?.[0] === row.stop[0]) {
          previous[1] = Math.min(previous[1], row.stop[1]);
          previous[2] = Math.max(previous[2], row.stop[2]);
        } else normalized.push(row.stop);
      }
      if (normalized.length < 2) return undefined;
      return { ...trip, stops: normalized };
    })
    .filter((trip): trip is RailScheduleTrip => !!trip);

  const exceptions = new Map<
    string,
    { addedDates: string[]; removedDates: string[] }
  >();
  for (const row of parseCsv(files.calendarDates)) {
    const entry = exceptions.get(row.service_id) ?? {
      addedDates: [],
      removedDates: [],
    };
    const date = compactDate(row.date);
    if (row.exception_type === "1") entry.addedDates.push(date);
    if (row.exception_type === "2") entry.removedDates.push(date);
    exceptions.set(row.service_id, entry);
  }
  const weekdayColumns = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const servicesById = new Map<string, RailScheduleService>();
  for (const row of parseCsv(files.calendar)) {
    const exception = exceptions.get(row.service_id) ?? {
      addedDates: [],
      removedDates: [],
    };
    servicesById.set(row.service_id, {
      id: row.service_id,
      startDate: compactDate(row.start_date),
      endDate: compactDate(row.end_date),
      weekdays: weekdayColumns
        .map((column, index) => (row[column] === "1" ? index : -1))
        .filter((day) => day >= 0),
      ...exception,
    });
  }
  for (const [id, exception] of exceptions) {
    if (servicesById.has(id)) continue;
    const dates = [...exception.addedDates, ...exception.removedDates].sort();
    servicesById.set(id, {
      id,
      startDate: dates[0] ?? "1970-01-01",
      endDate: dates.at(-1) ?? "1970-01-01",
      weekdays: [],
      ...exception,
    });
  }
  const services = [...servicesById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const coverage = services
    .flatMap((service) => [
      service.startDate,
      service.endDate,
      ...service.addedDates,
    ])
    .sort();
  if (!trips.length || !services.length || !coverage.length)
    throw new Error(
      "GTFS import did not contain usable train trips and services",
    );
  return {
    version: 1,
    accessedAt,
    accessedOn: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(accessedAt)),
    source: LTA_GTFS_ENDPOINT,
    licence: LTA_OPEN_DATA_LICENCE,
    validFrom: coverage[0],
    validUntil: coverage.at(-1)!,
    services,
    trips: trips.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function activeServiceIds(snapshot: RailScheduleSnapshot, date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const active = new Set<string>();
  for (const service of snapshot.services) {
    if (
      date >= service.startDate &&
      date <= service.endDate &&
      service.weekdays.includes(day)
    )
      active.add(service.id);
    if (service.removedDates.includes(date)) active.delete(service.id);
    if (service.addedDates.includes(date)) active.add(service.id);
  }
  return [...active];
}

const singaporeDate = (value: number) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const previousDate = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);

const normalizeRequestedCodes = (values: string[]) =>
  new Set(stationCodes(...values));

export const segmentEndpointCodes = (
  segment: Pick<Segment, "line" | "stops" | "from" | "to">,
) => {
  const codes = stationCodes(...segment.stops);
  const prefixes = linePrefixes[segment.line] ?? [];
  const matching = codes.filter((code) =>
    prefixes.some((prefix) => code.startsWith(prefix)),
  );
  const candidates = matching.length ? matching : codes;
  return {
    from: candidates.length ? [candidates[0]] : [segment.from],
    to: candidates.length ? [candidates.at(-1)!] : [segment.to],
  };
};

export interface CatchableTrainRequest {
  updates?: TrainUpdate[];
  line: string;
  fromCodes: string[];
  toCodes: string[];
  readyAt: string | number;
}

export interface CatchableTrain {
  realtime?: boolean;
  tripId: string;
  serviceDate: string;
  fromCode: string;
  toCode: string;
  departureAt: string;
  arrivalAt: string;
  waitMinutes: number;
  rideMinutes: number;
}

export function selectCatchableTrain(
  snapshot: RailScheduleSnapshot,
  request: CatchableTrainRequest,
): CatchableTrain | undefined {
  const readyAt =
    typeof request.readyAt === "number"
      ? request.readyAt
      : Date.parse(request.readyAt);
  if (!Number.isFinite(readyAt)) throw new Error("Invalid ready time");
  const fromCodes = normalizeRequestedCodes(request.fromCodes);
  const toCodes = normalizeRequestedCodes(request.toCodes);
  if (!fromCodes.size || !toCodes.size) return undefined;
  const currentDate = singaporeDate(readyAt);
  const serviceDates = [previousDate(currentDate), currentDate];
  let best: CatchableTrain | undefined;
  for (const serviceDate of serviceDates) {
    const active = new Set(activeServiceIds(snapshot, serviceDate));
    if (!active.size) continue;
    const midnight = Date.parse(`${serviceDate}T00:00:00+08:00`);
    for (const trip of snapshot.trips) {
      if (trip.line !== request.line || !active.has(trip.serviceId)) continue;
      const update = request.updates?.find(
        (u) =>
          u.tripId === trip.id &&
          u.startDate === serviceDate.replaceAll("-", ""),
      );
      if (update?.cancelled) continue;
      for (let fromIndex = 0; fromIndex < trip.stops.length - 1; fromIndex++) {
        const from = trip.stops[fromIndex];
        if (!fromCodes.has(from[0])) continue;
        if (update?.stops.some((s) => s.code === from[0] && s.skipped))
          continue;
        for (
          let toIndex = fromIndex + 1;
          toIndex < trip.stops.length;
          toIndex++
        ) {
          const to = trip.stops[toIndex];
          if (!toCodes.has(to[0])) continue;
          if (update?.stops.some((s) => s.code === to[0] && s.skipped))
            continue;
          const codes = trip.stops.map((s) => s[0]);
          const times = trip.stops.map((s) => midnight + s[2] * 1000);
          const departure = predictedStopTime(
            update,
            codes,
            fromIndex,
            midnight + from[2] * 1000,
            true,
            times,
          );
          let arrival = predictedStopTime(
            update,
            codes,
            toIndex,
            midnight + to[1] * 1000,
            false,
            times,
          );
          if (update && arrival < departure) continue;
          while (arrival < departure) arrival += 86_400_000;
          if (
            departure < readyAt ||
            departure - readyAt > 2 * 3600_000 ||
            (best && departure >= Date.parse(best.departureAt))
          )
            break;
          best = {
            realtime: !!update,
            tripId: trip.id,
            serviceDate,
            fromCode: from[0],
            toCode: to[0],
            departureAt: new Date(departure).toISOString(),
            arrivalAt: new Date(arrival).toISOString(),
            waitMinutes: (departure - readyAt) / 60_000,
            rideMinutes: (arrival - departure) / 60_000,
          };
          break;
        }
      }
    }
  }
  return best;
}

// Bounded station-board lookup, using the same dated/directional timetable
// selection as the planner. These are departures, not live train movements.
export function nextTrainDepartures(
  snapshot: RailScheduleSnapshot | undefined,
  request: CatchableTrainRequest,
) {
  const departures: CatchableTrain[] = [];
  const start =
    typeof request.readyAt === "number"
      ? request.readyAt
      : Date.parse(request.readyAt);
  if (!snapshot || !Number.isFinite(start)) return departures;
  let readyAt = start;
  for (let i = 0; i < 3; i++) {
    const next = selectCatchableTrain(snapshot, { ...request, readyAt });
    if (!next || Date.parse(next.departureAt) - start > 90 * 60000) break;
    departures.push(next);
    readyAt = Date.parse(next.departureAt) + 1;
  }
  return departures;
}

const singaporeClock = (value: string) =>
  new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

export function evaluateRailSegments(
  input: Segment[],
  departure: string,
  snapshot: RailScheduleSnapshot | undefined,
  options: {
    stationAccessMinutes?: number;
    interchangeMinutes?: number;
    updates?: TrainUpdate[];
  } = {},
) {
  const segments = input.map((segment) => ({
    ...segment,
    geometry: segment.geometry.map(
      (coordinate) => [...coordinate] as [number, number],
    ),
    stops: [...segment.stops],
    hops: segment.hops?.map((hop) => ({
      ...hop,
      codes: [...hop.codes],
      fromCodes: hop.fromCodes ? [...hop.fromCodes] : undefined,
      toCodes: hop.toCodes ? [...hop.toCodes] : undefined,
      geometry: hop.geometry.map(
        (coordinate) => [...coordinate] as [number, number],
      ),
    })),
  }));
  let clock = Date.parse(departure);
  let scheduledSegments = 0;
  let fallbackSegments = 0;
  const stationAccessMinutes = options.stationAccessMinutes ?? 2;
  const interchangeMinutes = options.interchangeMinutes ?? 3;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.mode !== "rail") {
      clock += segment.minutes * 60_000;
      continue;
    }
    const previous = segments[index - 1];
    const allowance =
      previous?.mode === "rail" ? interchangeMinutes : stationAccessMinutes;
    const readyAt = clock + allowance * 60_000;
    const endpointCodes = segmentEndpointCodes(segment);
    const scheduled = snapshot
      ? selectCatchableTrain(snapshot, {
          line: segment.line,
          fromCodes: endpointCodes.from,
          toCodes: endpointCodes.to,
          readyAt,
          updates: options.updates,
        })
      : undefined;
    if (!scheduled) {
      if (
        snapshot &&
        options.updates?.length &&
        selectCatchableTrain(snapshot, {
          line: segment.line,
          fromCodes: endpointCodes.from,
          toCodes: endpointCodes.to,
          readyAt,
        })
      ) {
        segment.unavailable = true;
        segment.source = "LTA GTFS Realtime · no catchable service";
        segment.instructions =
          "No catchable train remains after realtime cancellations or skipped stops. Re-plan.";
        clock += segment.minutes * 60_000;
        continue;
      }
      fallbackSegments++;
      segment.source = `${segment.source} · timetable fallback`;
      segment.instructions = `${segment.instructions} Scheduled timing is unavailable for this leg, so Wayce is using its local estimate.`;
      clock += segment.minutes * 60_000;
      continue;
    }
    const legStart = clock;
    clock = Date.parse(scheduled.arrivalAt);
    segment.minutes = (clock - legStart) / 60_000;
    segment.waitMinutes =
      (Date.parse(scheduled.departureAt) - legStart) / 60_000;
    segment.instructions = `${previous?.mode === "rail" ? "Change to" : "Board"} ${segment.line} towards ${segment.direction ?? "the destination"}. The first catchable scheduled train leaves at ${singaporeClock(scheduled.departureAt)} after an estimated ${allowance}-minute ${previous?.mode === "rail" ? "interchange" : "station-access"} allowance. Alight at ${segment.to}.`;
    segment.source = `LTA DataMall GTFS Schedule (accessed ${snapshot!.accessedOn}) · station access estimated`;
    if (scheduled.realtime) {
      segment.source += " · LTA GTFS Realtime";
      segment.instructions = segment.instructions.replace(
        "scheduled train",
        "predicted train",
      );
    }
    scheduledSegments++;
  }
  return { segments, scheduledSegments, fallbackSegments };
}

let cachedSnapshot: RailScheduleSnapshot | null | undefined;
const defaultSnapshotUrl = new URL(
  "../data/train-schedule.json.gz",
  import.meta.url,
);

export function loadRailScheduleSnapshot(path = defaultSnapshotUrl) {
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
      !Array.isArray(parsed.services) ||
      !Array.isArray(parsed.trips)
    )
      throw new Error("Unsupported rail schedule snapshot");
    for (const trip of parsed.trips) trip.line = canonicalLine(trip.line);
    if (isDefault) cachedSnapshot = parsed as RailScheduleSnapshot;
    return parsed as RailScheduleSnapshot;
  } catch {
    if (isDefault) cachedSnapshot = null;
    return undefined;
  }
}
