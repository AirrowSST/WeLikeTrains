import { readFileSync } from "node:fs";
import type { Coord, Preferences, Segment } from "../shared/types";
import { canonicalLine } from "../shared/catalog";
interface RawWay {
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}
interface RawRoute {
  id: number;
  tags: Record<string, string>;
  stops: ({ id: number; lat: number; lon: number } & Record<string, any>)[];
  ways: number[];
}
interface RawNetwork {
  nodes: [number, number, number][];
  ways: RawWay[];
  routes: RawRoute[];
  timestamp: string;
}
export interface Station {
  id: string;
  name: string;
  coord: Coord;
  codes: string[];
  mode: "rail" | "bus";
}
export interface TransitEdge {
  from: string;
  to: string;
  line: string;
  mode: "rail" | "bus";
  distance: number;
  minutes: number;
  geometry: Coord[];
  direction: string;
}
interface WalkEdge {
  to: number;
  distance: number;
  covered: boolean;
  steps: boolean;
  cycle: boolean;
  name: string;
}
export function distance(a: Coord, b: Coord) {
  const rad = Math.PI / 180;
  const lat = (b[0] - a[0]) * rad;
  const lon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export class Heap<T> {
  private items: { cost: number; value: T }[] = [];
  push(cost: number, value: T) {
    let i = this.items.length;
    this.items.push({ cost, value });
    while (i) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= cost) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = { cost, value };
  }
  pop() {
    const first = this.items[0];
    const end = this.items.pop();
    if (this.items.length && end) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].cost < this.items[child].cost
        )
          child++;
        if (this.items[child].cost >= end.cost) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = end;
    }
    return first;
  }
  get size() {
    return this.items.length;
  }
}

let network: ReturnType<typeof buildNetwork> | undefined;
function buildNetwork() {
  const raw: RawNetwork = JSON.parse(
    readFileSync(new URL("../data/network.json", import.meta.url), "utf8"),
  );
  const coords = new Map<number, Coord>(
    raw.nodes.map(([id, lat, lon]) => [id, [lat, lon]]),
  );
  const ways = new Map(raw.ways.map((w) => [w.id, w]));
  const walk = new Map<number, WalkEdge[]>();
  const stations = new Map<string, Station>();
  const transit = new Map<string, TransitEdge[]>();
  for (const way of raw.ways) {
    const t = way.tags;
    if (
      !t.highway ||
      ["motorway", "trunk", "motorway_link", "trunk_link"].includes(
        t.highway,
      ) ||
      ["no", "private"].includes(t.foot ?? "") ||
      ["private", "no"].includes(t.access ?? "") ||
      (["primary", "secondary"].includes(t.highway) &&
        !["yes", "designated"].includes(t.foot ?? "") &&
        !t.sidewalk)
    )
      continue;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1],
        b = way.nodes[i];
      const ac = coords.get(a),
        bc = coords.get(b);
      if (!ac || !bc) continue;
      const edge = {
        distance: distance(ac, bc),
        covered:
          ["yes", "arcade", "colonnade"].includes(t.covered) ||
          t.tunnel === "yes",
        steps: t.highway === "steps",
        cycle:
          t.bicycle !== "no" &&
          (["yes", "designated", "permissive"].includes(t.bicycle) ||
            [
              "cycleway",
              "residential",
              "service",
              "tertiary",
              "unclassified",
            ].includes(t.highway)),
        name:
          t.name ??
          (t.highway === "steps"
            ? "Steps"
            : t.highway === "footway"
              ? "Footpath"
              : "Local path"),
      };
      if (!walk.has(a)) walk.set(a, []);
      if (!walk.has(b)) walk.set(b, []);
      walk.get(a)!.push({ ...edge, to: b });
      walk.get(b)!.push({ ...edge, to: a });
    }
  }
  for (const route of raw.routes) {
    const mode = route.tags.route === "bus" ? "bus" : "rail";
    const line =
      mode === "bus" ? route.tags.ref : canonicalLine(route.tags.ref ?? "");
    if (!line) continue;
    const stops = route.stops
      .filter((s) => s.name || s["name:en"])
      .map((s) => {
        const name = String(s["name:en"] ?? s.name);
        const id =
          mode === "rail" ? `rail:${name.toLowerCase()}` : `bus:${s.id}`;
        const station: Station = {
          id,
          name,
          coord: [s.lat, s.lon],
          codes: String(s.ref ?? s["ref:operator"] ?? "")
            .split(/[;,/ ]/)
            .filter(Boolean),
          mode,
        };
        const existing = stations.get(id);
        if (existing)
          existing.codes = [...new Set([...existing.codes, ...station.codes])];
        else stations.set(id, station);
        return { ...station, nodeId: s.id };
      });
    let path: Coord[] = [];
    for (const id of route.ways) {
      const w = ways.get(id);
      if (!w) continue;
      let p = w.nodes.map((n) => coords.get(n)).filter((x): x is Coord => !!x);
      if (
        path.length &&
        p.length &&
        distance(path.at(-1)!, p.at(-1)!) < distance(path.at(-1)!, p[0])
      )
        p = p.toReversed();
      path.push(...p);
    }
    const nearestIndex = (c: Coord) => {
      let best = Infinity,
        index = 0;
      path.forEach((p, i) => {
        const d = distance(c, p);
        if (d < best) {
          best = d;
          index = i;
        }
      });
      return index;
    };
    for (let i = 1; i < stops.length; i++) {
      const from = stops[i - 1],
        to = stops[i];
      if (from.id === to.id) continue;
      const a = nearestIndex(from.coord),
        b = nearestIndex(to.coord);
      let geometry =
        a <= b ? path.slice(a, b + 1) : path.slice(b, a + 1).toReversed();
      if (geometry.length < 2) geometry = [from.coord, to.coord];
      let metres = geometry
        .slice(1)
        .reduce((sum, c, j) => sum + distance(geometry[j], c), 0);
      if (metres > distance(from.coord, to.coord) * 4) {
        geometry = [from.coord, to.coord];
        metres = distance(from.coord, to.coord) * 1.15;
      }
      const edge: TransitEdge = {
        from: from.id,
        to: to.id,
        line,
        mode,
        distance: metres,
        minutes:
          metres / (mode === "rail" ? 630 : 320) +
          (mode === "rail" ? 0.65 : 0.45),
        geometry,
        direction: route.tags.to ?? to.name,
      };
      if (!transit.has(from.id)) transit.set(from.id, []);
      transit.get(from.id)!.push(edge);
    }
  }
  // Transfer between distinct, nearby surface stops. All are visible walking legs.
  const list = [...stations.values()];
  const connectors = new Map<string, { to: string; distance: number }[]>();
  for (const s of list) {
    const nearby = list.filter(
      (t) =>
        t.id !== s.id &&
        (s.mode !== t.mode || s.mode === "bus") &&
        distance(s.coord, t.coord) < 180,
    );
    connectors.set(
      s.id,
      nearby.map((t) => ({ to: t.id, distance: distance(s.coord, t.coord) })),
    );
  }
  // Snap access points to the connected public walking network, not isolated indoor paths.
  const seen = new Set<number>();
  let largest: number[] = [];
  for (const id of walk.keys()) {
    if (seen.has(id)) continue;
    const component = [id];
    seen.add(id);
    for (let i = 0; i < component.length; i++)
      for (const e of walk.get(component[i]) ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          component.push(e.to);
        }
      }
    if (component.length > largest.length) largest = component;
  }
  const grid = new Map<string, number[]>();
  for (const id of largest) {
    const c = coords.get(id)!;
    const key = `${Math.floor(c[0] * 500)},${Math.floor(c[1] * 500)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(id);
  }
  return {
    coords,
    walk,
    stations,
    transit,
    connectors,
    grid,
    timestamp: raw.timestamp,
  };
}
export function getNetwork() {
  return (network ??= buildNetwork());
}
const walkingCache = new Map<string, ReturnType<typeof calculateWalkingPath>>();
export function walkingPath(
  from: Coord,
  to: Coord,
  preferences: Preferences,
  cycle = false,
): {
  geometry: Coord[];
  distance: number;
  sheltered: boolean;
  verified: boolean;
  instructions: string;
} | null {
  const key = `${from.join(",")}:${to.join(",")}:${preferences.stepFree}:${preferences.sheltered}:${cycle}`;
  if (walkingCache.has(key)) return walkingCache.get(key)!;
  const result = calculateWalkingPath(from, to, preferences, cycle);
  if (walkingCache.size > 4000) walkingCache.clear();
  walkingCache.set(key, result);
  return result;
}
function calculateWalkingPath(
  from: Coord,
  to: Coord,
  preferences: Preferences,
  cycle = false,
): {
  geometry: Coord[];
  distance: number;
  sheltered: boolean;
  verified: boolean;
  instructions: string;
} | null {
  const { coords, walk, grid } = getNetwork();
  const nearest = (c: Coord) => {
    let best = Infinity,
      id = 0;
    const gx = Math.floor(c[0] * 500),
      gy = Math.floor(c[1] * 500);
    for (let x = -2; x <= 2; x++)
      for (let y = -2; y <= 2; y++)
        for (const n of grid.get(`${gx + x},${gy + y}`) ?? []) {
          const d = distance(c, coords.get(n)!);
          if (d < best && (!cycle || walk.get(n)?.some((e) => e.cycle))) {
            best = d;
            id = n;
          }
        }
    return { id, distance: best };
  };
  const a = nearest(from),
    b = nearest(to);
  if (a.distance > 400 || b.distance > 400) return null;
  const heap = new Heap<number>();
  heap.push(0, a.id);
  const costs = new Map([[a.id, 0]]);
  const prev = new Map<number, { node: number; edge: WalkEdge }>();
  let visits = 0;
  const closed = new Set<number>();
  while (heap.size && visits++ < 30000) {
    const item = heap.pop()!;
    const id = item.value;
    if (closed.has(id)) continue;
    closed.add(id);
    if (id === b.id) break;
    const current = costs.get(id)!;
    for (const e of walk.get(id) ?? []) {
      if (
        closed.has(e.to) ||
        (preferences.stepFree && e.steps) ||
        (cycle && !e.cycle)
      )
        continue;
      const next =
        current + e.distance * (preferences.sheltered && !e.covered ? 1.12 : 1);
      if (next < (costs.get(e.to) ?? Infinity)) {
        costs.set(e.to, next);
        prev.set(e.to, { node: id, edge: e });
        heap.push(next + distance(coords.get(e.to)!, coords.get(b.id)!), e.to);
      }
    }
  }
  if (!prev.has(b.id) && a.id !== b.id) return null;
  const ids = [b.id];
  const edges: WalkEdge[] = [];
  let id = b.id;
  while (id !== a.id) {
    const p = prev.get(id);
    if (!p) return null;
    edges.unshift(p.edge);
    id = p.node;
    ids.unshift(id);
  }
  const metres =
    edges.reduce((s, e) => s + e.distance, 0) + a.distance + b.distance;
  const names = [
    ...new Set(
      edges
        .map((e) => e.name)
        .filter((n) => !["Local path", "Footpath"].includes(n)),
    ),
  ];
  return {
    geometry: [from, ...ids.map((n) => coords.get(n)!), to],
    distance: metres,
    sheltered: edges.length > 0 && edges.every((e) => e.covered),
    verified: false,
    instructions: `${cycle ? "Cycle" : "Walk"} ${Math.round(metres)} m${names.length ? " via " + names.slice(0, 3).join(", ") : " along the mapped footpaths"}. ${a.distance > 50 || b.distance > 50 ? "Station/building access connection is approximate. " : ""}${preferences.stepFree ? "Mapped stairs are excluded; lifts, kerbs and station access still need confirmation." : ""}`,
  };
}
export function walkSegment(
  from: Coord,
  to: Coord,
  fromName: string,
  toName: string,
  preferences: Preferences,
  cycle = false,
): Segment | null {
  const path = walkingPath(from, to, preferences, cycle);
  if (!path || path.distance > preferences.maxWalk * (cycle ? 3 : 1))
    return null;
  return {
    id: `${cycle ? "cycle" : "walk"}-${fromName}-${toName}`,
    mode: cycle ? "cycle" : "walk",
    line: cycle ? "cycle" : "walk",
    from: fromName,
    to: toName,
    minutes: Math.max(
      1,
      Math.ceil(path.distance / (cycle ? 220 : preferences.walkingSpeed)),
    ),
    distance: path.distance,
    geometry: path.geometry,
    stops: [],
    crowd: "unknown",
    affected: false,
    delay: 0,
    sheltered: path.sheltered,
    accessibility: "unknown",
    instructions: path.instructions,
    source:
      "Bundled OpenStreetMap pedestrian graph; access connections approximate",
  };
}
