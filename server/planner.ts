import { createHash } from "node:crypto";
import type {
  Conditions,
  Crowd,
  Journey,
  Notice,
  PlanRequest,
  PlanResponse,
  Segment,
} from "../shared/types";
import { sgTime } from "../shared/catalog";
import { estimateRisk } from "../shared/risk";
import {
  distance,
  getNetwork,
  Heap,
  walkSegment,
  type TransitEdge,
} from "./network";
import { getConditions, getBusArrivals } from "./feeds";
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
function crowdAt(
  c: Conditions,
  stationCodes: string[],
  line: string,
  departure: string,
): Crowd {
  const time = Date.parse(departure);
  const rows = c.crowd.filter(
    (r) =>
      r.line === line &&
      (stationCodes.includes(r.station) || !stationCodes.length) &&
      (!r.start || Date.parse(r.start) <= time) &&
      (!r.end || Date.parse(r.end) > time),
  );
  return worstCrowd(rows.map((r) => r.level));
}
function atJourneyMinute(departure: string, elapsedMinutes: number) {
  return new Date(Date.parse(departure) + elapsedMinutes * 60000).toISOString();
}
export function applyConditions(
  journey: Journey,
  conditions: Conditions,
  request: PlanRequest,
): Journey {
  const seenDelay = new Set<string>();
  let blocked = false;
  let elapsedMinutes = 0;
  const reasons: string[] = [];
  const warnings = [...journey.warnings];
  const segments = journey.segments.map((s) => {
    const boardingAt = atJourneyMinute(
      request.departure,
      elapsedMinutes + (s.waitMinutes ?? 0),
    );
    const segment = {
      ...s,
      geometry: s.geometry.map((c) => [...c] as [number, number]),
    };
    segment.crowd =
      s.mode === "rail"
        ? crowdAt(conditions, s.stops, s.line, boardingAt)
        : s.crowd;
    segment.delay = 0;
    segment.affected = false;
    segment.affectedGeometry = [];
    segment.issues = segment.sheltered && s.mode === "walk" ? ["shelter"] : [];
    if (s.mode === "bus") {
      const boardingTime = Date.parse(boardingAt);
      const bus = conditions.buses
        .filter(
          (b) =>
            b.service === s.line &&
            s.stops.includes(b.stop) &&
            Date.parse(b.eta) >= boardingTime &&
            Date.parse(b.eta) - boardingTime < 30 * 60000,
        )
        .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))[0];
      if (bus) {
        segment.crowd = bus.load;
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
      for (const traffic of conditions.traffic) {
        if (
          traffic.delayMinutes <= 0 ||
          !traffic.location ||
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
      !s.sheltered &&
      conditions.weather.walkStatus !== "valid"
    ) {
      segment.issues.push(conditions.weather.rain ? "rain" : "heat");
      segment.delay += Math.ceil(
        s.minutes * (conditions.weather.walkStatus === "invalid" ? 0.5 : 0.2),
      );
      if (conditions.weather.walkStatus === "invalid") {
        blocked = true;
        warnings.push(
          "An exposed walking section is unsafe in the current weather. Use a mapped sheltered alternative or wait for conditions to improve.",
        );
      }
    }
    if (conditions.weather.rain) {
      if (s.mode === "bus") segment.delay += Math.ceil(s.minutes * 0.15);
      if (s.mode === "cycle" && conditions.weather.cycleStatus !== "valid") {
        blocked = true;
        warnings.push("Cycling is excluded during this heavy-rain scenario.");
      }
    }
    segment.minutes = s.minutes + segment.delay;
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
    .filter((s) => s.mode === "walk" && !s.sheltered)
    .reduce((sum, s) => sum + s.minutes, 0);
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
    range: [Math.max(1, duration - 3), duration + uncertainty],
    arrival: new Date(
      Date.parse(request.departure) + duration * 60000,
    ).toISOString(),
    walkMinutes,
    crowd,
    score,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    blocked,
  };
}
function journeyFromSegments(
  segments: Segment[],
  source = "OpenStreetMap network · estimated timings",
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
  if (!journey.segments.some((segment) => segment.mode === "rail")) return journey;
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
    range: [Math.max(1, duration - 3), duration + 8] as [number, number],
    score: duration,
    warnings,
    source: timing.scheduledSegments
      ? "OpenStreetMap route geometry · LTA DataMall GTFS Schedule · estimated access and walking"
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
      leg: walkSegment(
        origin,
        s.coord,
        request.origin.name,
        s.name,
        request.preferences,
      ),
    }))
    .filter((x) => x.leg !== null);
  const ends = new Map(
    nearby(destination)
      .map((s) => [
        s.id,
        walkSegment(
          s.coord,
          destination,
          s.name,
          request.destination.name,
          request.preferences,
        ),
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
  const direct = walkSegment(
    origin,
    destination,
    request.origin.name,
    request.destination.name,
    request.preferences,
  );
  if (direct) found.push(journeyFromSegments([direct]));
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
    for (const start of starts) {
      const state = {
        station: start.s.id,
        line: "",
        segments: [start.leg!],
        cost: start.leg!.minutes,
      };
      heap.push(state.cost, state);
      best.set(`${state.station}|`, state.cost);
    }
    let visited = 0;
    let goal: { cost: number; journey: Journey } | undefined;
    while (heap.size && visited++ < 12000) {
      const { value: state } = heap.pop()!;
      if (state.cost > (best.get(`${state.station}|${state.line}`) ?? Infinity))
        continue;
      if (goal && state.cost >= goal.cost) break;
      const end = ends.get(state.station);
      if (end && (!goal || state.cost + end.minutes < goal.cost)) {
        goal = {
          cost: state.cost + end.minutes,
          journey: journeyFromSegments([...state.segments, end]),
        };
      }
      for (const edge of net.transit.get(state.station) ?? []) {
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
          source: "OpenStreetMap route relation",
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
        const changed = state.line !== edge.line;
        const wait = changed ? (state.line ? 5 : 4) : 0;
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
        const key = `${edge.to}|${edge.line}`;
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
          last.instructions = `Take ${edge.mode === "bus" ? "bus " : ""}${edge.line} towards ${edge.direction}. Alight at ${to.name}. Includes an estimated boarding wait.`;
        } else
          segments.push({
            ...probe,
            id: `${edge.line}-${from.name}`,
            minutes: edge.minutes + wait,
            waitMinutes: wait,
            instructions: `${state.line ? "Change to" : "Board"} ${edge.mode === "bus" ? "bus " : ""}${edge.line} towards ${edge.direction}. Alight at ${to.name}. Allow ${wait} min for ${state.line ? "transfer and boarding" : "boarding"}.`,
          });
        heap.push(nextCost, {
          station: edge.to,
          line: edge.line,
          segments,
          cost: nextCost,
        });
      }
      for (const link of net.connectors.get(state.station) ?? []) {
        if (state.segments.at(-1)?.mode === "walk") continue;
        const from = net.stations.get(state.station)!,
          to = net.stations.get(link.to)!;
        const leg = walkSegment(
          from.coord,
          to.coord,
          from.name,
          to.name,
          request.preferences,
        );
        if (!leg) continue;
        const key = `${link.to}|`;
        const nextCost = state.cost + leg.minutes + 2;
        if (nextCost >= (best.get(key) ?? Infinity)) continue;
        best.set(key, nextCost);
        heap.push(nextCost, {
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
export async function planJourney(request: PlanRequest): Promise<PlanResponse> {
  const conditions = await getConditions(request);
  // Weather may make a user's ordinary preference a safety requirement for
  // this plan. The saved preference remains unchanged; this only affects the
  // route calculation for the current journey.
  const routingRequest: PlanRequest = {
    ...request,
    preferences: {
      ...request.preferences,
      sheltered:
        request.preferences.sheltered ||
        conditions.weather.walkStatus !== "valid",
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
    status: railSchedule ? (scheduleCovered ? "local" : "stale") : "unavailable",
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
  if (!base.length)
    throw new Error(
      "No usable route found in the bundled map extract. Try a mapped station or supported Singapore place, or increase the walking limit.",
    );
  if (request.dataMode === "live") {
    const stops = [
      ...new Set(
        base.flatMap((j) =>
          j.segments
            .filter((s) => s.mode === "bus")
            .map((s) => s.stops.find((code) => /^\d{5}$/.test(code)))
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
            name: `Bus arrivals ${stop}`,
            status: arrivals.status as "live" | "unavailable" | "stale",
            detail: "Per-vehicle occupancy and wheelchair availability",
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
  }
  const baseline = [...base].sort((a, b) => a.duration - b.duration)[0];
  const original = applyConditions(baseline, conditions, request);
  const ranked = base
    .map((j) => applyConditions(j, conditions, request))
    .sort((a, b) => a.score - b.score);
  const recommended = ranked.find((j) => !j.blocked) ?? ranked[0];
  const travelDecision = recommended.blocked ? "wait" : "travel";
  const weatherBlocksEveryRoute =
    travelDecision === "wait" &&
    conditions.weather.walkStatus === "invalid" &&
    ranked.every((journey) => journey.blocked);
  const risk = estimateRisk(conditions, original);
  const date = Date.parse(request.departure);
  const deadline = request.arriveBy ? Date.parse(request.arriveBy) : null;
  const safeArrival = date + recommended.range[1] * 60000;
  let advice =
    travelDecision === "wait"
      ? weatherBlocksEveryRoute
        ? "Wait for the heavy weather to pass, then re-plan. Every mapped option currently includes an exposed section, so Wayce is not recommending a journey yet."
        : "Wait and re-plan before leaving. No verified usable route is available under the current conditions."
    : recommended.id !== original.id
      ? `Take ${recommended.title}. ${original.blocked ? "Avoid the affected route." : `Save about ${Math.max(0, original.duration - recommended.duration)} min compared with your usual route.`}`
      : `Take ${recommended.title}. ${recommended.reasons[0] ?? "Your route is the best fit for the available conditions."}`;
  if (travelDecision === "travel") {
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
