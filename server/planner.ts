import { createHash } from "node:crypto";
import type {
  BusArrival,
  Conditions,
  Crowd,
  Journey,
  Notice,
  PlanRequest,
  PlanResponse,
  Segment,
} from "../shared/types";
import { sgTime } from "../shared/catalog";
import {
  shelterExposureRatio,
  shelterMode as effectiveShelterMode,
} from "../shared/shelter";
import {
  busOperating,
  frequencyWait,
  referenceWait,
  referenceWaitRange,
} from "./bus-routing";
import { getGeospatial, stationExits } from "./geospatial";
import { trafficAllowance } from "./traffic-timing";
import { estimateRisk } from "../shared/risk";
import {
  distance,
  getNetwork,
  Heap,
  walkSegment,
  type TransitEdge,
} from "./network";
import {
  crowdFeedLinesForSegments,
  getBusArrivals,
  getConditions,
  getRailCrowding,
  parseBuses,
} from "./feeds";
import { timelineInputs } from "../shared/timelines";
import {
  evaluateRailSegments,
  loadRailScheduleSnapshot,
  LTA_OPEN_DATA_LICENCE,
  type RailScheduleSnapshot,
} from "./rail-schedule";

export function noticeActive(n: Notice, departure: string, duration = 120) {
  const start = Date.parse(n.startsAt),
    end = n.endsAt ? Date.parse(n.endsAt) : Infinity;
  const at = Date.parse(departure);
  return Number.isFinite(start) && start <= at + duration * 60000 && end >= at;
}
export function segmentAffected(n: Notice, s: Segment) {
  if (n.kind === "flood")
    return (
      s.geometryKind !== "schematic" &&
      !!n.location &&
      s.geometry.some((point) => distance(point, n.location!) < 180)
    );
  if (n.kind !== "lift" && n.line && n.line !== s.line) return false;
  const codes = new Set(s.stops.flatMap((x) => x.split(/[;,/ ]/)));
  return n.stations.length
    ? n.stations.some((c) => codes.has(c)) ||
        !!n.stationNames?.some((name) =>
          [s.from, s.to, ...s.stops].some((s) =>
            s.toLowerCase().includes(name.toLowerCase()),
          ),
        )
    : !!n.line && n.line === s.line;
}
const worstCrowd = (values: Crowd[]): Crowd =>
  values.includes("high")
    ? "high"
    : values.includes("moderate")
      ? "moderate"
      : values.includes("low")
        ? "low"
        : "unknown";
function crowdRowsAt(
  c: Conditions,
  stationCodes: string[],
  line: string,
  departure: string,
) {
  const time = Date.parse(departure);
  const rows = c.crowd.filter(
    (r) =>
      r.line === line &&
      (stationCodes.includes(r.station) || !stationCodes.length) &&
      (!r.start || Date.parse(r.start) <= time) &&
      (!r.end || Date.parse(r.end) > time),
  );
  return rows;
}
function crowdAt(
  c: Conditions,
  codes: string[],
  line: string,
  departure: string,
): Crowd {
  return worstCrowd(crowdRowsAt(c, codes, line, departure).map((r) => r.level));
}
function atJourneyMinute(departure: string, elapsedMinutes: number) {
  return new Date(Date.parse(departure) + elapsedMinutes * 60000).toISOString();
}

const busBoardingStop = (segment: Segment) =>
  segment.hops?.[0]?.codes.find((code) => /^\d{5}$/.test(code)) ??
  segment.stops.find((code) => /^\d{5}$/.test(code));

const singaporeClock = (value: string) =>
  new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

const LIVE_BUS_WARNING =
  "Bus boarding uses the first catchable monitored DataMall arrival. Bus in-vehicle time remains an estimate.";
const BUS_FALLBACK_WARNING =
  "A bus leg has no fresh catchable monitored arrival, so its boarding wait uses the labelled local estimate.";
const RAIN_WALKING_WARNING =
  "Bring an umbrella and take extra care while walking: exposed paths may be slippery and visibility may be reduced.";
const busTimingSource =
  / · (?:LTA DataMall BusArrival \((?:simulated|live)\)|estimated boarding-wait fallback)/g;

const transitMode = (segment: Segment | undefined) =>
  segment?.mode === "bus" || segment?.mode === "rail";

export function journeyDurationRange(
  segments: Segment[],
  duration: number,
  options: {
    departure: string;
    stepFree: boolean;
    baseLower?: number;
    baseUpper?: number;
  },
): [number, number] {
  let lowerDelta = -(options.baseLower ?? 3);
  let upperDelta = options.baseUpper ?? 8;
  let clock = Date.parse(options.departure);

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const previous = segments[index - 1];
    const next = segments[index + 1];

    if (segment.mode === "rail") {
      const directTransfer = previous?.mode === "rail";
      const centralAllowance = options.stepFree
        ? directTransfer
          ? 5
          : 4
        : directTransfer
          ? 3
          : 2;
      const upperAllowance = options.stepFree
        ? directTransfer
          ? 8
          : 7
        : directTransfer
          ? 5
          : 4;
      upperDelta += upperAllowance - centralAllowance;
    }

    if (segment.mode === "bus" && segment.waitMinutes !== undefined) {
      const wait = Math.max(0, segment.waitMinutes);
      if (/LTA DataMall BusArrival \((?:simulated|live)\)/.test(segment.source)) {
        upperDelta += 2;
      } else {
        const publishedRange = referenceWaitRange(segment, clock);
        const upperWait = publishedRange?.[1] ?? Math.max(wait, wait * 2);
        lowerDelta -= wait;
        upperDelta += Math.max(0, upperWait - wait);
      }
    }

    if (
      segment.mode === "walk" &&
      transitMode(previous) &&
      transitMode(next)
    ) {
      const walk = Math.max(1, segment.minutes - (segment.delay ?? 0));
      const lowerWalk = walk * 0.8 + 1;
      const upperWalk = walk * 1.2 + 3;
      lowerDelta += Math.min(0, lowerWalk - walk);
      upperDelta += Math.max(0, upperWalk - walk);
    }

    clock += segment.minutes * 60_000;
  }

  return [
    Math.max(1, Math.floor(duration + lowerDelta)),
    Math.max(1, Math.ceil(duration + upperDelta)),
  ];
}

function retimeBusSegment(
  segment: Segment,
  buses: BusArrival[],
  readyAt: number,
) {
  const currentWait = segment.waitMinutes ?? 0;
  const estimatedWait =
    referenceWait(segment, readyAt) ??
    segment.estimatedWaitMinutes ??
    currentWait;
  const inVehicleMinutes = Math.max(0, segment.minutes - currentWait);
  const stop = busBoardingStop(segment);
  const arrival = buses
    .filter(
      (bus) =>
        bus.service === segment.line &&
        bus.stop === stop &&
        bus.monitored === true &&
        bus.status !== "stale" &&
        Number.isFinite(Date.parse(bus.eta)) &&
        Date.parse(bus.eta) >= readyAt &&
        Date.parse(bus.eta) - readyAt < 30 * 60_000,
    )
    .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))[0];
  const action = segment.instructions.startsWith("Change to")
    ? "Change to"
    : "Board";
  const source = segment.source.replace(busTimingSource, "");
  segment.estimatedWaitMinutes = estimatedWait;
  if (arrival) {
    const waitMinutes = (Date.parse(arrival.eta) - readyAt) / 60_000;
    segment.waitMinutes = waitMinutes;
    segment.minutes = inVehicleMinutes + waitMinutes;
    segment.source = `${source} · LTA DataMall BusArrival (${arrival.status === "demo" ? "simulated" : "live"})`;
    segment.instructions = `${action} bus ${segment.line} towards ${segment.direction ?? "the destination"}. The first catchable ${arrival.status === "demo" ? "simulated" : "live"} bus is due at ${singaporeClock(arrival.eta)}; in-vehicle time remains estimated. Alight at ${segment.to}.`;
  } else {
    segment.waitMinutes = estimatedWait;
    segment.minutes = inVehicleMinutes + estimatedWait;
    segment.source = `${source} · estimated boarding-wait fallback`;
    segment.instructions = `${action} bus ${segment.line} towards ${segment.direction ?? "the destination"}. Allow ${estimatedWait} min for the estimated boarding wait${segment.busReference ? " based on LTA dispatch frequency" : ""}. Alight at ${segment.to}.`;
  }
  return arrival;
}

export function applyBusArrivalTiming(
  journey: Journey,
  buses: BusArrival[],
  departure: string,
): Journey {
  let clock = Date.parse(departure);
  let liveSegments = 0;
  let fallbackSegments = 0;
  const segments = journey.segments.map((source) => {
    const segment: Segment = {
      ...source,
      geometry: source.geometry.map((coordinate) => [...coordinate]),
      stops: [...source.stops],
      hops: source.hops?.map((hop) => ({
        ...hop,
        codes: [...hop.codes],
        geometry: hop.geometry.map((coordinate) => [...coordinate]),
      })),
    };
    if (segment.mode !== "bus") {
      clock += segment.minutes * 60_000;
      return segment;
    }
    const arrival = retimeBusSegment(segment, buses, clock);
    if (arrival) {
      liveSegments++;
    } else {
      fallbackSegments++;
    }
    clock += segment.minutes * 60_000;
    return segment;
  });
  const duration = Math.ceil(
    segments.reduce((total, segment) => total + segment.minutes, 0),
  );
  const warnings = [...journey.warnings];
  if (liveSegments) warnings.push(LIVE_BUS_WARNING);
  if (fallbackSegments) warnings.push(BUS_FALLBACK_WARNING);
  return {
    ...journey,
    segments,
    duration,
    baselineDuration: duration,
    range: journeyDurationRange(segments, duration, {
      departure,
      stepFree: false,
    }),
    score: duration,
    warnings: [...new Set(warnings)],
    source: liveSegments
      ? `${journey.source} · LTA DataMall BusArrival`
      : journey.source,
  };
}

export function applyConditions(
  journey: Journey,
  conditions: Conditions,
  request: PlanRequest,
): Journey {
  const seenDelay = new Set<string>();
  let blocked = false;
  let elapsedMinutes = 0;
  let liveBusSegments = 0;
  let fallbackBusSegments = 0;
  const reasons: string[] = [];
  const warnings = journey.warnings.filter(
    (warning) =>
      warning !== LIVE_BUS_WARNING && warning !== BUS_FALLBACK_WARNING,
  );
  const segments = journey.segments.map((s, segmentIndex) => {
    const segment = {
      ...s,
      geometry: s.geometry.map((c) => [...c] as [number, number]),
    };
    let selectedBus: BusArrival | undefined;
    // Re-evaluate rail after preceding bus waits, weather and disruption delays.
    if (s.mode === "rail" && s.source.includes("GTFS")) {
      const directTransfer =
        journey.segments[segmentIndex - 1]?.mode === "rail";
      const allowance = request.preferences.stepFree
        ? directTransfer
          ? 5
          : 4
        : directTransfer
          ? 3
          : 2;
      const timing = evaluateRailSegments(
        [segment],
        atJourneyMinute(request.departure, elapsedMinutes),
        loadRailScheduleSnapshot(),
        { stationAccessMinutes: allowance, updates: conditions.trainUpdates },
      );
      Object.assign(segment, timing.segments[0]);
    }
    if (s.mode === "bus" && (request.dataMode === "live" || request.timeline)) {
      selectedBus = retimeBusSegment(
        segment,
        conditions.buses,
        Date.parse(atJourneyMinute(request.departure, elapsedMinutes)),
      );
      if (selectedBus) liveBusSegments++;
      else fallbackBusSegments++;
    }
    const boardingAt = atJourneyMinute(
      request.departure,
      elapsedMinutes + (segment.waitMinutes ?? 0),
    );
    segment.crowd =
      s.mode === "rail"
        ? crowdAt(conditions, s.stops, s.line, boardingAt)
        : s.crowd;
    segment.crowdSource = undefined;
    if (s.mode === "rail" && segment.crowd !== "unknown") {
      const rows = crowdRowsAt(conditions, s.stops, s.line, boardingAt).filter(
        (r) => r.level === segment.crowd,
      );
      segment.crowdSource =
        request.dataMode === "demo" ||
        request.timeline ||
        conditions.feeds.some(
          (f) => f.status === "demo" && /crowd/i.test(f.name),
        )
          ? "simulated"
          : rows.every((r) => r.forecast)
            ? "forecast"
            : rows.every((r) => !r.forecast)
              ? "current"
              : "mixed";
    }
    segment.delay = 0;
    segment.affected = false;
    segment.affectedGeometry = [];
    segment.issues = segment.sheltered && s.mode === "walk" ? ["shelter"] : [];
    if (segment.unavailable) {
      blocked = true;
      warnings.push(segment.instructions);
    }
    if (s.mode === "bus") {
      const boardingTime = Date.parse(boardingAt);
      const boardingStop = busBoardingStop(s);
      const bus =
        request.dataMode === "live" || request.timeline
          ? selectedBus
          : conditions.buses
              .filter(
                (b) =>
                  b.service === s.line &&
                  b.stop === boardingStop &&
                  b.status !== "stale" &&
                  b.monitored !== false &&
                  Date.parse(b.eta) >= boardingTime &&
                  Date.parse(b.eta) - boardingTime < 30 * 60000,
              )
              .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))[0];
      if (bus) {
        segment.crowd = bus.load;
        segment.crowdSource =
          bus.status === "demo" || request.dataMode === "demo"
            ? "simulated"
            : "current";
        if (request.preferences.stepFree && !bus.wheelchair)
          warnings.push(
            `The next bus ${bus.service} is not marked wheelchair-accessible. Wait for a confirmed accessible vehicle.`,
          );
      }
    }
    for (const notice of conditions.notices) {
      if (
        !noticeActive(notice, request.departure, journey.duration) ||
        !segmentAffected(notice, s)
      )
        continue;
      if (notice.kind === "lift" && !request.preferences.stepFree) continue;
      if (["disruption", "planned", "lift", "flood"].includes(notice.kind)) {
        segment.affected = true;
        segment.issues.push(
          notice.kind === "flood"
            ? "flood"
            : notice.kind === "disruption"
              ? "disruption"
              : "road-closure",
        );
        segment.affectedGeometry.push(
          ...(s.hops
            ?.filter((h) =>
              segmentAffected(notice, {
                ...s,
                from: h.from,
                to: h.to,
                stops: h.codes,
              }),
            )
            .map((h) => h.geometry) ?? [s.geometry]),
        );
        if (!seenDelay.has(notice.id)) {
          segment.delay += notice.delayMinutes;
          seenDelay.add(notice.id);
          reasons.push(notice.title);
        }
        if (
          notice.kind === "flood" ||
          notice.kind === "planned" ||
          notice.kind === "lift"
        )
          blocked = true;
        if (
          notice.kind === "disruption" &&
          notice.freeBus &&
          s.mode === "rail"
        ) {
          segment.issues.push("bridging-bus");
          warnings.push(
            `${notice.freeBus}. Use the free bridging bus where it serves your affected rail section.`,
          );
        }
      }
    }
    if (s.mode === "bus") {
      const speedFeed = conditions.feeds.find((f) =>
        /Traffic speeds/.test(f.name),
      );
      const trafficDelay =
        speedFeed && ["live", "demo"].includes(speedFeed.status)
          ? trafficAllowance(s, conditions.traffic)
          : 0;
      if (trafficDelay > 0) {
        segment.delay += trafficDelay;
        segment.affected = true;
        segment.issues.push("congestion");
        segment.affectedGeometry.push(s.geometry);
        reasons.push(
          "Slow road traffic adds a bounded bus allowance; bus running time remains estimated",
        );
      }
      for (const traffic of conditions.traffic) {
        if (
          traffic.delayMinutes <= 0 ||
          !traffic.location ||
          s.geometryKind === "schematic" ||
          !s.geometry.some((point) => distance(point, traffic.location!) < 250)
        )
          continue;
        segment.affected = true;
        segment.affectedGeometry.push(s.geometry);
        segment.delay += traffic.delayMinutes;
        segment.issues.push(
          traffic.kind === "road-closure"
            ? "road-closure"
            : traffic.kind === "incident"
              ? "accident"
              : "congestion",
        );
        if (!seenDelay.has(traffic.id)) {
          seenDelay.add(traffic.id);
          reasons.push(traffic.description);
        }
        if (traffic.kind === "road-closure") blocked = true;
      }
    }
    if (segment.crowd === "high" && s.mode === "rail") {
      segment.delay += 3;
      segment.issues.push("crowd");
      if (!reasons.includes("Allow extra boarding time at crowded platforms"))
        reasons.push("Allow extra boarding time at crowded platforms");
    }
    if (
      s.mode === "walk" &&
      shelterExposureRatio(s) > 0 &&
      conditions.weather.walkStatus !== "valid"
    ) {
      segment.issues.push(conditions.weather.rain ? "rain" : "heat");
      segment.delay += Math.ceil(
        s.minutes *
          shelterExposureRatio(s) *
          (conditions.weather.walkStatus === "invalid" ? 0.5 : 0.2),
      );
      if (conditions.weather.rain) warnings.push(RAIN_WALKING_WARNING);
    }
    if (conditions.weather.rain) {
      if (s.mode === "bus") segment.delay += Math.ceil(s.minutes * 0.15);
      if (s.mode === "cycle" && conditions.weather.cycleStatus !== "valid") {
        blocked = true;
        warnings.push("Cycling is excluded during this heavy-rain scenario.");
      }
    }
    segment.minutes += segment.delay;
    elapsedMinutes += segment.minutes;
    return segment;
  });
  const duration = Math.ceil(segments.reduce((sum, s) => sum + s.minutes, 0));
  const crowd = worstCrowd(
    segments.filter((s) => s.mode !== "walk").map((s) => s.crowd),
  );
  const uncertainty =
    Math.max(4, Math.ceil(duration * 0.14)) +
    (conditions.weather.walkStatus !== "valid" ? 4 : 0) +
    (segments.some((s) => s.affected) ? 8 : 0);
  const walkMinutes = segments
    .filter((s) => s.mode === "walk")
    .reduce((sum, s) => sum + s.minutes, 0);
  const exposed = segments
    .filter((s) => s.mode === "walk")
    .reduce((sum, s) => sum + s.minutes * shelterExposureRatio(s), 0);
  const score =
    duration +
    (request.preferences.avoidCrowds
      ? crowd === "high"
        ? 22
        : crowd === "moderate"
          ? 5
          : 0
      : 0) +
    (request.preferences.sheltered || conditions.weather.walkStatus !== "valid"
      ? exposed * 0.8
      : 0) +
    (request.preferences.stepFree ? walkMinutes * 0.6 : 0) +
    (blocked ? 10000 : 0);
  if (request.preferences.stepFree)
    warnings.push(
      "Step-free access is not fully verified. Mapped stairs and known lift outages are excluded. Confirm station lifts and final access before travelling.",
    );
  if (liveBusSegments) warnings.push(LIVE_BUS_WARNING);
  if (fallbackBusSegments) warnings.push(BUS_FALLBACK_WARNING);
  if (
    conditions.feeds.some(
      (f) => f.status === "unavailable" || f.status === "stale",
    )
  )
    warnings.push(
      "Some live conditions are unavailable. Verify official service information before travelling.",
    );
  return {
    ...journey,
    segments,
    duration,
    range: journeyDurationRange(segments, duration, {
      departure: request.departure,
      stepFree: request.preferences.stepFree,
      baseUpper: uncertainty,
    }),
    arrival: new Date(
      Date.parse(request.departure) + duration * 60000,
    ).toISOString(),
    walkMinutes,
    crowd,
    score,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    source: liveBusSegments
      ? `${journey.source.replace(/ · LTA DataMall BusArrival/g, "")} · LTA DataMall BusArrival`
      : journey.source.replace(/ · LTA DataMall BusArrival/g, ""),
    blocked,
  };
}
function journeyFromSegments(
  segments: Segment[],
  source = "Local OSM walking/rail · DataMall bus connections · estimated timings",
): Journey {
  const duration = Math.ceil(segments.reduce((s, e) => s + e.minutes, 0));
  const transit = segments.filter((s) => s.mode === "rail" || s.mode === "bus");
  const lines = [...new Set(transit.map((s) => s.line))];
  const id = createHash("sha256")
    .update(
      segments.map((s) => `${s.mode}:${s.line}:${s.from}:${s.to}`).join("|"),
    )
    .digest("hex")
    .slice(0, 12);
  return {
    id,
    title: lines.length
      ? lines.map((l) => (/^\d/.test(l) ? `Bus ${l}` : l)).join(" → ")
      : segments[0]?.mode === "cycle"
        ? "Cycle all the way"
        : "Walk all the way",
    segments,
    duration,
    baselineDuration: duration,
    range: [duration - 3, duration + 8],
    arrival: "",
    distance: segments.reduce((s, e) => s + e.distance, 0),
    walkMinutes: segments
      .filter((s) => s.mode === "walk")
      .reduce((t, s) => t + s.minutes, 0),
    transfers: Math.max(0, transit.length - 1),
    crowd: "unknown",
    score: duration,
    reasons: [],
    warnings: [
      "Timings use distance, estimated speed, dwell and waiting allowances; they are not a published timetable.",
      ...(segments.some((s) => s.geometryKind === "schematic")
        ? [
            "Bus map highlights served stops where road geometry is unavailable. Bus distance uses DataMall; road-specific conditions cannot be verified on those sections.",
          ]
        : []),
    ],
    source,
    blocked: false,
  };
}

function applyRailSchedule(
  journey: Journey,
  request: PlanRequest,
  snapshot: RailScheduleSnapshot | undefined,
) {
  if (!journey.segments.some((segment) => segment.mode === "rail"))
    return journey;
  const timing = evaluateRailSegments(
    journey.segments,
    request.departure,
    snapshot,
    request.preferences.stepFree
      ? { stationAccessMinutes: 4, interchangeMinutes: 5 }
      : { stationAccessMinutes: 2, interchangeMinutes: 3 },
  );
  const duration = Math.ceil(
    timing.segments.reduce((total, segment) => total + segment.minutes, 0),
  );
  const warnings = journey.warnings.filter(
    (warning) =>
      warning !==
      "Timings use distance, estimated speed, dwell and waiting allowances; they are not a published timetable.",
  );
  if (timing.scheduledSegments)
    warnings.push(
      "Rail departures and ride times use the dated LTA GTFS Schedule. Walking, station access and live-condition effects remain estimates.",
    );
  if (timing.fallbackSegments)
    warnings.push(
      "Scheduled timing was unavailable for at least one rail leg, so that leg uses the local distance estimate.",
    );
  return {
    ...journey,
    segments: timing.segments,
    duration,
    baselineDuration: duration,
    range: journeyDurationRange(timing.segments, duration, {
      departure: request.departure,
      stepFree: request.preferences.stepFree,
    }),
    score: duration,
    warnings,
    source: timing.scheduledSegments
      ? `${journey.source} · LTA DataMall GTFS Schedule · estimated access and walking`
      : journey.source,
  };
}

export function localJourneys(
  request: PlanRequest,
  conditions: Conditions,
  railSchedule = loadRailScheduleSnapshot(),
): Journey[] {
  const hour = (new Date(request.departure).getUTCHours() + 8) % 24;
  const minute = new Date(request.departure).getUTCMinutes();
  if (hour >= 1 && (hour < 5 || (hour === 5 && minute < 30))) return [];
  const net = getNetwork();
  const origin: [number, number] = [request.origin.lat, request.origin.lon],
    destination: [number, number] = [
      request.destination.lat,
      request.destination.lon,
    ];
  const all = [...net.stations.values()];
  function accessLeg(
    station: (typeof all)[number],
    endpoint: [number, number],
    name: string,
    outbound: boolean,
  ) {
    const exits = station.mode === "rail" ? stationExits(station.name) : [];
    const candidates = exits
      .map((exit) => ({
        exit,
        leg: outbound
          ? walkSegment(
              exit.coord,
              endpoint,
              station.name,
              name,
              request.preferences,
            )
          : walkSegment(
              endpoint,
              exit.coord,
              name,
              station.name,
              request.preferences,
            ),
      }))
      .filter((candidate) => candidate.leg !== null)
      .sort((a, b) => a.leg!.minutes - b.leg!.minutes);
    if (candidates[0]) {
      const { leg, exit } = candidates[0];
      if (outbound) leg!.minutes += request.preferences.stepFree ? 4 : 2;
      leg!.instructions += ` Use ${station.name} exit ${exit.exit} (LTA location); entrance-to-platform access remains estimated and step-free access is unverified.`;
      leg!.source += " · LTA TrainStationExit";
      return leg;
    }
    return outbound
      ? walkSegment(
          station.coord,
          endpoint,
          station.name,
          name,
          request.preferences,
        )
      : walkSegment(
          endpoint,
          station.coord,
          name,
          station.name,
          request.preferences,
        );
  }
  function nearby(c: [number, number]) {
    return ["rail", "bus"].flatMap((mode) =>
      all
        .filter(
          (s) =>
            s.mode === mode &&
            distance(c, s.coord) < request.preferences.maxWalk,
        )
        .sort((a, b) => distance(c, a.coord) - distance(c, b.coord))
        .slice(0, mode === "rail" ? 5 : 3),
    );
  }
  const starts = nearby(origin)
    .map((s) => ({
      s,
      leg: accessLeg(s, origin, request.origin.name, false),
    }))
    .filter((x) => x.leg !== null);
  const ends = new Map(
    nearby(destination)
      .map((s) => [
        s.id,
        accessLeg(s, destination, request.destination.name, true),
      ])
      .filter((x) => x[1] !== null) as [string, Segment][],
  );
  if (request.preferences.cycling && !conditions.weather.rain) {
    const bikeStation = all
      .filter(
        (s) =>
          s.mode === "rail" &&
          distance(origin, s.coord) > 500 &&
          distance(origin, s.coord) < 2000,
      )
      .sort((a, b) => distance(origin, a.coord) - distance(origin, b.coord))[0];
    if (bikeStation) {
      const leg = walkSegment(
        origin,
        bikeStation.coord,
        request.origin.name,
        bikeStation.name,
        request.preferences,
        true,
      );
      if (leg) starts.push({ s: bikeStation, leg });
    }
  }
  const found: Journey[] = [];
  // A transfer walk is independent of the bus used to reach its start stop.
  // Keep each walk result for this request so the larger bus graph cannot churn
  // the process-wide bounded walking cache on every service/direction state.
  const transferLegs = new Map<string, Segment | null>();
  const direct = walkSegment(
    origin,
    destination,
    request.origin.name,
    request.destination.name,
    request.preferences,
  );
  if (direct) found.push(journeyFromSegments([direct]));
  // An optimistic reverse graph (no boarding waits or condition penalties)
  // provides an admissible lower bound for A*. This keeps national bus coverage
  // from requiring a near-exhaustive islandwide search for every alternative.
  const reverse = new Map<string, { from: string; minutes: number }[]>();
  const reverseAdd = (to: string, from: string, minutes: number) => {
    const rows = reverse.get(to) ?? [];
    rows.push({ from, minutes });
    reverse.set(to, rows);
  };
  for (const edges of net.transit.values())
    for (const edge of edges) reverseAdd(edge.to, edge.from, edge.minutes);
  for (const [from, links] of net.connectors)
    for (const link of links)
      reverseAdd(
        link.to,
        from,
        link.distance / request.preferences.walkingSpeed,
      );
  const remaining = new Map<string, number>();
  const reverseHeap = new Heap<string>();
  for (const [id, leg] of ends) {
    remaining.set(id, leg.minutes);
    reverseHeap.push(leg.minutes, id);
  }
  while (reverseHeap.size) {
    const { cost, value: id } = reverseHeap.pop()!;
    if (cost !== remaining.get(id)) continue;
    for (const edge of reverse.get(id) ?? []) {
      const next = cost + edge.minutes;
      if (next >= (remaining.get(edge.from) ?? Infinity)) continue;
      remaining.set(edge.from, next);
      reverseHeap.push(next, edge.from);
    }
  }
  const variants = [
    { avoid: "", live: false, busOnly: false },
    { avoid: "", live: true, busOnly: false },
    { avoid: "EWL", live: true, busOnly: false },
    { avoid: "DTL", live: true, busOnly: false },
    { avoid: "", live: true, busOnly: true },
  ];
  for (const variant of variants) {
    type State = {
      station: string;
      line: string;
      segments: Segment[];
      cost: number;
    };
    const heap = new Heap<State>();
    const best = new Map<string, number>();
    const bestTransfer = new Map<string, number>();
    for (const start of starts) {
      const state = {
        station: start.s.id,
        line: "",
        segments: [start.leg!],
        cost: start.leg!.minutes,
      };
      if (!remaining.has(state.station)) continue;
      heap.push(state.cost + remaining.get(state.station)!, state);
      best.set(`${state.station}|`, state.cost);
    }
    let visited = 0;
    let goal: { cost: number; journey: Journey } | undefined;
    while (heap.size && visited++ < 12000) {
      const { value: state } = heap.pop()!;
      if (state.cost > (best.get(`${state.station}|${state.line}`) ?? Infinity))
        continue;
      if (
        goal &&
        state.cost + (remaining.get(state.station) ?? Infinity) >= goal.cost
      )
        break;
      const end = ends.get(state.station);
      if (
        end &&
        state.segments.some((s) => s.mode === "rail" || s.mode === "bus") &&
        (!goal || state.cost + end.minutes < goal.cost)
      ) {
        goal = {
          cost: state.cost + end.minutes,
          journey: journeyFromSegments([...state.segments, end]),
        };
      }
      for (const edge of net.transit.get(state.station) ?? []) {
        if (!remaining.has(edge.to)) continue;
        if (
          (variant.busOnly && edge.mode !== "bus") ||
          edge.line === variant.avoid
        )
          continue;
        const from = net.stations.get(edge.from)!,
          to = net.stations.get(edge.to)!;
        const codes = [...from.codes, ...to.codes, from.name, to.name];
        const hop = {
          from: from.name,
          to: to.name,
          codes,
          geometry: edge.geometry,
        };
        const probe: Segment = {
          geometryKind: edge.geometryKind,
          roadNames: edge.roadNames,
          busReference: edge.busReference,
          id: "",
          mode: edge.mode,
          line: edge.line,
          direction: edge.direction,
          from: from.name,
          to: to.name,
          minutes: edge.minutes,
          distance: edge.distance,
          geometry: edge.geometry,
          stops: codes,
          hops: [hop],
          crowd: "unknown",
          affected: false,
          delay: 0,
          sheltered: true,
          accessibility: "unknown",
          instructions: "",
          source: edge.busReference
            ? `LTA DataMall stop sequence and distance · ${edge.geometryKind === "schematic" ? "served stops highlighted; road geometry unavailable" : "OSM matched map geometry"}`
            : "OpenStreetMap route relation",
        };
        const impacted = variant.live
          ? conditions.notices.filter(
              (n) =>
                noticeActive(n, request.departure) && segmentAffected(n, probe),
            )
          : [];
        if (
          impacted.some(
            (n) =>
              n.kind === "planned" ||
              (n.kind === "lift" && request.preferences.stepFree),
          )
        )
          continue;
        // Include the stop occurrence: loop routes may visit the same stop twice.
        const serviceKey = edge.busReference
          ? `${edge.busReference.key}|${edge.busReference.boarding.stopSequence + 1}`
          : edge.line;
        const changed = edge.busReference
          ? state.line !==
            `${edge.busReference.key}|${edge.busReference.boarding.stopSequence}`
          : state.line !== edge.line;
        const readyAt = Date.parse(request.departure) + state.cost * 60000;
        if (
          changed &&
          edge.busReference &&
          busOperating(edge.busReference.boarding, readyAt) === false
        )
          continue;
        const wait = changed
          ? (frequencyWait(edge.busReference?.service, readyAt) ??
            (state.line ? 5 : 4))
          : 0;
        const crowd = crowdAt(
          conditions,
          codes,
          edge.line,
          atJourneyMinute(request.departure, state.cost + wait),
        );
        const penalty =
          impacted.reduce(
            (s, n) => s + (n.kind === "disruption" ? n.delayMinutes : 0),
            0,
          ) + (request.preferences.avoidCrowds && crowd === "high" ? 5 : 0);
        const nextCost = state.cost + edge.minutes + wait + penalty;
        const key = `${edge.to}|${serviceKey}`;
        if (nextCost >= (best.get(key) ?? Infinity)) continue;
        best.set(key, nextCost);
        const segments = state.segments.map((s) => ({ ...s }));
        const last = segments.at(-1);
        if (!changed && last?.line === edge.line) {
          last.to = to.name;
          last.minutes += edge.minutes;
          last.distance += edge.distance;
          last.geometry = [...last.geometry, ...edge.geometry];
          last.stops = [...new Set([...last.stops, ...codes])];
          last.hops = [...(last.hops ?? []), hop];
          if (edge.geometryKind === "schematic") {
            last.geometryKind = "schematic";
            last.source =
              "LTA DataMall stop sequence and distance · served stops highlighted; road geometry unavailable";
          }
          last.instructions = `Take ${edge.mode === "bus" ? "bus " : ""}${edge.line} towards ${edge.direction}. Alight at ${to.name}. Includes an estimated boarding wait.`;
        } else
          segments.push({
            ...probe,
            id: edge.busReference
              ? `${edge.busReference.key}-${edge.busReference.boarding.stopSequence}`
              : `${edge.line}-${from.name}`,
            minutes: edge.minutes + wait,
            waitMinutes: wait,
            instructions: `${state.line ? "Change to" : "Board"} ${edge.mode === "bus" ? "bus " : ""}${edge.line} towards ${edge.direction}. Alight at ${to.name}. Allow ${wait} min for ${state.line ? "transfer and boarding" : "boarding"}.`,
          });
        heap.push(nextCost + remaining.get(edge.to)!, {
          station: edge.to,
          line: serviceKey,
          segments,
          cost: nextCost,
        });
      }
      if (state.segments.at(-1)?.mode === "walk") continue;
      if (state.cost >= (bestTransfer.get(state.station) ?? Infinity)) continue;
      bestTransfer.set(state.station, state.cost);
      for (const link of net.connectors.get(state.station) ?? []) {
        if (!remaining.has(link.to)) continue;
        const from = net.stations.get(state.station)!,
          to = net.stations.get(link.to)!;
        const transferKey = `${from.id}|${to.id}`;
        if (!transferLegs.has(transferKey))
          transferLegs.set(
            transferKey,
            walkSegment(
              from.coord,
              to.coord,
              from.name,
              to.name,
              request.preferences,
            ),
          );
        const leg = transferLegs.get(transferKey);
        if (!leg) continue;
        const key = `${link.to}|`;
        const nextCost = state.cost + leg.minutes + 2;
        if (nextCost >= (best.get(key) ?? Infinity)) continue;
        best.set(key, nextCost);
        heap.push(nextCost + remaining.get(link.to)!, {
          station: link.to,
          line: "",
          segments: [...state.segments, leg],
          cost: nextCost,
        });
      }
    }
    if (goal) found.push(goal.journey);
  }
  const unique = [...new Map(found.map((j) => [j.id, j])).values()];
  return unique.map((journey) =>
    applyRailSchedule(journey, request, railSchedule),
  );
}
export class NoUsableRouteError extends Error {
  constructor(
    message = "No usable route found in the bundled map extract. Try a mapped station or supported Singapore place, or increase the walking limit.",
  ) {
    super(message);
    this.name = "NoUsableRouteError";
  }
}

export async function planJourney(request: PlanRequest): Promise<PlanResponse> {
  const conditions = await getConditions(request);
  // Limited weather temporarily prefers shelter for this plan. It never turns
  // that preference into a strict requirement or changes the saved setting.
  const routingRequest: PlanRequest = {
    ...request,
    preferences: {
      ...request.preferences,
      sheltered:
        request.preferences.sheltered ||
        conditions.weather.walkStatus !== "valid",
      shelterMode: request.preferences.sheltered
        ? request.preferences.shelterMode
        : "prefer",
      cycling:
        request.preferences.cycling &&
        conditions.weather.cycleStatus === "valid",
    },
  };
  conditions.feeds.unshift({
    name: "Bundled OSM map & routing",
    status: "local",
    updatedAt: getNetwork().timestamp,
    detail:
      "Hosted with Wayce; route geometry is local and travel times are estimates",
  });
  const railSchedule = loadRailScheduleSnapshot();
  conditions.feeds.push({
    name: "LTA local routing layers",
    status: getGeospatial().accessedAt ? "local" : "unavailable",
    updatedAt: getGeospatial().accessedAt,
    detail: `Station exits, covered links and cycling paths. DataMall bus graph: ${getNetwork().busCoverage.services} services, ${getNetwork().busCoverage.directions} directions; ${getNetwork().busCoverage.matched} OSM-matched and ${getNetwork().busCoverage.schematic} schematic hops, ${getNetwork().busCoverage.missing} rejected. Walking coverage remains limited.`,
  });
  const departureDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(request.departure));
  const scheduleCovered =
    !!railSchedule &&
    departureDate >= railSchedule.validFrom &&
    departureDate <= railSchedule.validUntil;
  conditions.feeds.unshift({
    name: "LTA train schedule",
    status: railSchedule
      ? scheduleCovered
        ? "local"
        : "stale"
      : "unavailable",
    updatedAt: railSchedule?.accessedAt,
    detail: railSchedule
      ? `Committed schedule covers ${railSchedule.validFrom} to ${railSchedule.validUntil}. Singapore Open Data Licence v1.0: ${LTA_OPEN_DATA_LICENCE}`
      : "No committed train schedule is available; rail timing uses the labelled local estimate",
  });
  let base = localJourneys(routingRequest, conditions, railSchedule);
  // The bundled extract can miss a usable station when the user's normal
  // walking preference is conservative. Retry with the supported upper
  // bound before reporting that no route exists; this does not mutate the
  // saved preference or silently invent a route.
  if (!base.length && routingRequest.preferences.maxWalk < 3500) {
    base = localJourneys(
      {
        ...routingRequest,
        preferences: { ...routingRequest.preferences, maxWalk: 3500 },
      },
      conditions,
      railSchedule,
    );
  }
  if (!base.length) {
    if (effectiveShelterMode(routingRequest.preferences) === "require")
      throw new NoUsableRouteError(
        "No route with complete mapped shelter is available. Choose Prefer mapped shelter to see the least-exposed options, or change the endpoints.",
      );
    throw new NoUsableRouteError();
  }
  if (request.dataMode === "live") {
    const crowdLines = crowdFeedLinesForSegments(
      base.flatMap((journey) => journey.segments),
    );
    const railCrowding = await getRailCrowding(crowdLines);
    conditions.crowd.push(...railCrowding.crowd);
    conditions.feeds.push(...railCrowding.feeds);
  }
  if (request.timeline && request.dataMode === "demo") {
    const input = timelineInputs(request.timeline);
    const stops = new Map<string, Set<string>>();
    for (const journey of base)
      for (const segment of journey.segments) {
        const stop = segment.mode === "bus" && busBoardingStop(segment);
        if (stop) {
          const services = stops.get(stop) ?? new Set<string>();
          services.add(segment.line);
          stops.set(stop, services);
        }
      }
    for (const [stop, services] of stops)
      conditions.buses.push(
        ...parseBuses(input.bus(stop, [...services]), stop).map((bus) => ({
          ...bus,
          status: "demo" as const,
        })),
      );
    base = base.map((journey) =>
      applyBusArrivalTiming(journey, conditions.buses, request.departure),
    );
  }
  if (request.dataMode === "live") {
    const stops = [
      ...new Set(
        base.flatMap((j) =>
          j.segments
            .filter((s) => s.mode === "bus")
            .map(busBoardingStop)
            .filter((s): s is string => !!s),
        ),
      ),
    ].slice(0, 4);
    await Promise.allSettled(
      stops.map(async (stop) => {
        try {
          const arrivals = await getBusArrivals(stop);
          conditions.buses.push(...arrivals.buses);
          conditions.feeds.push({
            name: `${arrivals.simulated ? "SIMULATED · " : ""}Bus arrivals ${stop}`,
            status: arrivals.status as
              "live" | "unavailable" | "stale" | "demo",
            detail: arrivals.simulated
              ? "Local DataMall simulator · authored bus arrivals"
              : "Per-vehicle occupancy and wheelchair availability",
          });
        } catch {
          conditions.feeds.push({
            name: `Bus arrivals ${stop}`,
            status: "unavailable",
            detail: "Arrival feed unavailable",
          });
        }
      }),
    );
    base = base.map((journey) =>
      applyBusArrivalTiming(journey, conditions.buses, request.departure),
    );
  }
  const baseline = [...base].sort((a, b) => a.duration - b.duration)[0];
  const original = applyConditions(baseline, conditions, request);
  const ranked = base
    .map((j) => applyConditions(j, conditions, request))
    .sort((a, b) => a.score - b.score);
  const recommended = ranked.find((j) => !j.blocked) ?? ranked[0];
  const travelDecision = recommended.blocked ? "wait" : "travel";
  const hasExposedRainWalk =
    conditions.weather.rain &&
    recommended.segments.some(
      (segment) =>
        segment.mode === "walk" && shelterExposureRatio(segment) > 0,
    );
  const risk = estimateRisk(conditions, original);
  const date = Date.parse(request.departure);
  const deadline = request.arriveBy ? Date.parse(request.arriveBy) : null;
  const safeArrival = date + recommended.range[1] * 60000;
  let advice =
    travelDecision === "wait"
      ? "Wait and re-plan before leaving. No verified usable route is available under the current conditions."
      : recommended.id !== original.id
        ? `Take ${recommended.title}. ${original.blocked ? "Avoid the affected route." : `Save about ${Math.max(0, original.duration - recommended.duration)} min compared with your usual route.`}`
        : `Take ${recommended.title}. ${recommended.reasons[0] ?? "Your route is the best fit for the available conditions."}`;
  if (travelDecision === "travel") {
    if (hasExposedRainWalk) advice += ` ${RAIN_WALKING_WARNING}`;
    if (deadline && safeArrival > deadline)
      advice += ` Leave about ${Math.ceil((safeArrival - deadline) / 60000)} min earlier to keep an arrival buffer.`;
    else advice += ` Arrive around ${sgTime(recommended.arrival)}.`;
  }
  return {
    request,
    recommended,
    original,
    alternatives: ranked.filter((j) => j.id !== recommended.id).slice(0, 3),
    travelDecision,
    conditions,
    risk,
    advice,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
}
