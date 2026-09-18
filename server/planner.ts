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
import { oneMapJourneys } from "./providers";

export function noticeActive(n: Notice, departure: string, duration = 120) {
  const start = Date.parse(n.startsAt),
    end = n.endsAt ? Date.parse(n.endsAt) : Infinity;
  const at = Date.parse(departure);
  return Number.isFinite(start) && start <= at + duration * 60000 && end >= at;
}
export function segmentAffected(n: Notice, s: Segment) {
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
export function applyConditions(
  journey: Journey,
  conditions: Conditions,
  request: PlanRequest,
): Journey {
  const seenDelay = new Set<string>();
  let blocked = false;
  const reasons: string[] = [];
  const warnings = [...journey.warnings];
  const segments = journey.segments.map((s) => {
    const segment = {
      ...s,
      geometry: s.geometry.map((c) => [...c] as [number, number]),
    };
    segment.crowd =
      s.mode === "rail"
        ? crowdAt(conditions, s.stops, s.line, request.departure)
        : s.crowd;
    segment.delay = 0;
    segment.affected = false;
    segment.affectedGeometry = [];
    if (s.mode === "bus") {
      const bus = conditions.buses.find(
        (b) =>
          b.service === s.line &&
          s.stops.includes(b.stop) &&
          Date.parse(b.eta) >= Date.parse(request.departure) &&
          Date.parse(b.eta) - Date.parse(request.departure) < 30 * 60000,
      );
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
      if (["disruption", "planned", "lift"].includes(notice.kind)) {
        segment.affected = true;
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
        if (notice.kind === "planned" || notice.kind === "lift") blocked = true;
      }
    }
    if (segment.crowd === "high" && s.mode === "rail") {
      segment.delay += 3;
      if (!reasons.includes("Allow extra boarding time at crowded platforms"))
        reasons.push("Allow extra boarding time at crowded platforms");
    }
    if (conditions.weather.rain) {
      if (s.mode === "walk" && !s.sheltered)
        segment.delay += Math.ceil(s.minutes * 0.3);
      if (s.mode === "bus") segment.delay += Math.ceil(s.minutes * 0.15);
      if (s.mode === "cycle") {
        blocked = true;
        warnings.push("Cycling is excluded during this heavy-rain scenario.");
      }
    }
    segment.minutes = s.minutes + segment.delay;
    return segment;
  });
  const duration = Math.ceil(segments.reduce((sum, s) => sum + s.minutes, 0));
  const crowd = worstCrowd(
    segments.filter((s) => s.mode !== "walk").map((s) => s.crowd),
  );
  const uncertainty =
    Math.max(4, Math.ceil(duration * 0.14)) +
    (conditions.weather.rain ? 4 : 0) +
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
    (request.preferences.sheltered ? exposed * 0.5 : 0) +
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
export function localJourneys(
  request: PlanRequest,
  conditions: Conditions,
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
  const accessLeg = (
    from: [number, number],
    to: [number, number],
    fromName: string,
    toName: string,
  ) => {
    const mapped = walkSegment(from, to, fromName, toName, request.preferences);
    if (mapped) return mapped;
    const metres = distance(from, to);
    // A place returned by search can be just outside the bundled pedestrian
    // extract. Keep access to a nearby stop usable, but make the approximation
    // explicit rather than presenting it as a verified walking path.
    if (metres > Math.max(request.preferences.maxWalk, 2500)) return null;
    return {
      id: `walk-${fromName}-${toName}`,
      mode: "walk" as const,
      line: "walk",
      from: fromName,
      to: toName,
      minutes: Math.ceil(metres / request.preferences.walkingSpeed),
      distance: metres,
      geometry: [from, to],
      stops: [],
      crowd: "unknown" as const,
      affected: false,
      delay: 0,
      sheltered: false,
      accessibility: "unknown" as const,
      instructions: `Walk about ${Math.round(metres)} m to ${toName}. This access leg is estimated because the local walking map does not cover the full connection.`,
      source: "Estimated station access outside bundled walking map",
    };
  };
  function nearby(c: [number, number]) {
    return ["rail", "bus"].flatMap((mode) => {
      const candidates = all
        .filter(
          (s) => s.mode === mode,
        )
        .sort((a, b) => distance(c, a.coord) - distance(c, b.coord))
        .filter((s) => distance(c, s.coord) < request.preferences.maxWalk)
        .slice(0, mode === "rail" ? 5 : 3);
      if (candidates.length) return candidates;
      const closest = all
        .filter((s) => s.mode === mode)
        .sort((a, b) => distance(c, a.coord) - distance(c, b.coord))[0];
      return closest && distance(c, closest.coord) <= 2500 ? [closest] : [];
    });
  }
  const starts = nearby(origin)
    .map((s) => ({
      s,
      leg: accessLeg(
        origin,
        s.coord,
        request.origin.name,
        s.name,
      ),
    }))
    .filter((x) => x.leg !== null);
  const ends = new Map(
    nearby(destination)
      .map((s) => [
        s.id,
        accessLeg(
          s.coord,
          destination,
          s.name,
          request.destination.name,
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
        const crowd = crowdAt(conditions, codes, edge.line, request.departure);
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
  return unique;
}
export async function planJourney(request: PlanRequest): Promise<PlanResponse> {
  const conditions = await getConditions(request);
  let base: Journey[] = [];
  if (request.dataMode === "live")
    try {
      base = await oneMapJourneys(request, journeyFromSegments);
    } catch {
      conditions.feeds.push({
        name: "OneMap routing",
        status: "unavailable",
        detail: "Using the bundled OSM network and estimated times",
      });
    }
  if (base.length) {
    conditions.feeds.push({
      name: "OneMap routing",
      status: "live",
      updatedAt: new Date().toISOString(),
      detail: "Official Singapore routing itineraries",
    });
    // OneMap cannot accept our live closures or cycling-to-transit preferences.
    // Keep its baseline, but supply independently routed OSM alternatives when needed.
    const impacted = base.some((journey) =>
      journey.segments.some((segment) =>
        conditions.notices.some(
          (notice) =>
            noticeActive(notice, request.departure) &&
            segmentAffected(notice, segment) &&
            notice.kind !== "advisory",
        ),
      ),
    );
    if (
      impacted ||
      request.preferences.cycling ||
      request.preferences.stepFree
    ) {
      base.push(...localJourneys(request, conditions));
      base = [
        ...new Map(base.map((journey) => [journey.id, journey])).values(),
      ];
      if (request.preferences.stepFree) {
        // OneMap PT cannot verify stairs; use our stairs-excluding walking graph.
        base = base.filter((journey) => !journey.source.includes("OneMap"));
      }
    }
  } else base = localJourneys(request, conditions);
  if (!base.length)
    throw new Error(
      "No usable route found in this map extract. Try the supported Singapore places, increase the walking limit, or connect OneMap for wider coverage.",
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
  const risk = estimateRisk(conditions, original);
  const date = Date.parse(request.departure);
  const deadline = request.arriveBy ? Date.parse(request.arriveBy) : null;
  const safeArrival = date + recommended.range[1] * 60000;
  let advice = recommended.blocked
    ? "No verified usable alternative is available. Check official advice before leaving."
    : recommended.id !== original.id
      ? `Take ${recommended.title}. ${original.blocked ? "Avoid the affected route." : `Save about ${Math.max(0, original.duration - recommended.duration)} min compared with your usual route.`}`
      : `Take ${recommended.title}. ${recommended.reasons[0] ?? "Your route is the best fit for the available conditions."}`;
  if (deadline && safeArrival > deadline)
    advice += ` Leave about ${Math.ceil((safeArrival - deadline) / 60000)} min earlier to keep an arrival buffer.`;
  else advice += ` Arrive around ${sgTime(recommended.arrival)}.`;
  return {
    request,
    recommended,
    original,
    alternatives: ranked.filter((j) => j.id !== recommended.id).slice(0, 3),
    conditions,
    risk,
    advice,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
}
