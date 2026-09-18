// Explicit one-time expansion for western access around Jalan Bahar.
// This is never called by app startup, tests, or requests.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const overpass =
  process.env.OVERPASS_URL || "https://overpass.kumi.systems/api/interpreter";
const singapore = "1.23,103.60,1.47,104.04";
const westWalkBbox = "1.33,103.675,1.405,103.765";
const westWalkBoxes = [
  "1.33,103.675,1.3675,103.72",
  "1.378,103.735,1.392,103.752",
];
const queries = [
  `[out:json][timeout:60];relation[route=bus][ref="172"](${singapore});out body;>;out body;`,
  ...westWalkBoxes.map(
    (box) =>
      `[out:json][timeout:60];way[highway~"^(footway|path|pedestrian|steps|cycleway|residential|service|unclassified|tertiary|secondary|primary|trunk)$"][access!=private](${box});out body;>;out skel;`,
  ),
];

await mkdir(".cache", { recursive: true });
const raw = { elements: [] };
for (const [index, query] of queries.entries()) {
  const cachePath = `.cache/osm-west-expansion-${index}.json`;
  let result;
  try {
    result = JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    console.log(`Fetching western OSM expansion ${index + 1}/${queries.length}…`);
    const response = await fetch(overpass, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(120000),
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Wayce/1.0 (+https://github.com/AirrowSST/WeLikeTrains)",
      },
    });
    if (!response.ok)
      throw new Error(`Overpass HTTP ${response.status}, expansion ${index}`);
    result = await response.json();
    if (result.remark) throw new Error(result.remark);
    await writeFile(cachePath, JSON.stringify(result));
    if (index < queries.length - 1)
      await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  raw.elements.push(...result.elements);
  raw.osm3s = result.osm3s ?? raw.osm3s;
}

const graph = JSON.parse(await readFile("data/network.json", "utf8"));
const byId = new Map();
for (const item of raw.elements) {
  const key = `${item.type}/${item.id}`;
  byId.set(key, {
    ...byId.get(key),
    ...item,
    tags: { ...byId.get(key)?.tags, ...item.tags },
  });
}
const all = [...byId.values()];
const ways = all.filter((item) => item.type === "way" && item.tags?.highway);
const routes = all
  .filter(
    (item) =>
      item.type === "relation" &&
      item.tags?.route === "bus" &&
      item.tags?.ref === "172",
  )
  .map((route) => ({
    id: route.id,
    tags: route.tags,
    stops: route.members
      .filter(
        (member) =>
          member.type === "node" && /platform|stop/.test(member.role),
      )
      .map((member) => {
        const node = byId.get(`node/${member.ref}`);
        return node
          ? { id: node.id, lat: node.lat, lon: node.lon, ...node.tags }
          : null;
      })
      .filter(Boolean),
    ways: route.members
      .filter(
        (member) => member.type === "way" && !/platform/.test(member.role),
      )
      .map((member) => member.ref),
  }))
  .filter((route) => route.stops.length > 1);

const expandedWays = ways.map((way) => ({
  id: way.id,
  nodes: way.nodes,
  tags: way.tags,
}));
const usedNodes = new Set(expandedWays.flatMap((way) => way.nodes));
const expandedNodes = all
  .filter((item) => item.type === "node" && usedNodes.has(item.id))
  .map((node) => [node.id, node.lat, node.lon]);
const mergeById = (existing, additions) => [
  ...new Map([...existing, ...additions].map((item) => [item.id ?? item[0], item])).values(),
];

graph.nodes = mergeById(graph.nodes, expandedNodes);
graph.ways = mergeById(graph.ways, expandedWays);
graph.routes = mergeById(graph.routes, routes);
graph.timestamp = raw.osm3s?.timestamp_osm_base ?? graph.timestamp;
graph.query = `${graph.query}\n/* western expansion: bus 172 and walking network ${westWalkBbox} */`;
await writeFile("data/network.json", JSON.stringify(graph));

const provenance = JSON.parse(
  await readFile("data/OSM-PROVENANCE.json", "utf8"),
);
provenance.fetchedAt = new Date().toISOString();
provenance.dataTimestamp = graph.timestamp;
provenance.expansions = [
  ...(provenance.expansions ?? []).filter(
    (item) => item.id !== "jalan-bahar-172",
  ),
  {
    id: "jalan-bahar-172",
    source: overpass,
    bbox: westWalkBbox,
    queries,
    purpose:
      "Service 172 and mapped walking access for Choa Chu Kang/Boon Lay to Civil Defence Academy",
  },
];
provenance.routes = graph.routes.length;
provenance.nodes = graph.nodes.length;
provenance.ways = graph.ways.length;
await writeFile(
  "data/OSM-PROVENANCE.json",
  JSON.stringify(provenance, null, 2),
);

console.log(
  JSON.stringify({
    addedRoutes: routes.length,
    addedNodes: expandedNodes.length,
    addedWays: expandedWays.length,
    routes: graph.routes.length,
    nodes: graph.nodes.length,
    ways: graph.ways.length,
  }),
);
