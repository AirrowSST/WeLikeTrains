// Explicit, manually invoked OSM snapshot import. Never called by the app or CI.
import { mkdir, readFile, writeFile } from "node:fs/promises";
const bbox = "1.23,103.60,1.47,104.04";
const busRefs = "2|12|17|27|34|36|67|118|172|190|196";
const primaryWalkBbox = "1.265,103.778,1.417,103.966";
const westWalkBbox = "1.33,103.675,1.405,103.765";
const query = `[out:json][timeout:60];(
relation[route~"^(subway|light_rail|monorail)$"](${bbox});
relation[route=bus][ref~"^(${busRefs})$"](${bbox});
);out body;>;out body;
(way[highway~"^(footway|path|pedestrian|steps|cycleway|residential|service|unclassified|tertiary|secondary|primary|trunk)$"][access!=private](${primaryWalkBbox});way[highway~"^(footway|path|pedestrian|steps|cycleway|residential|service|unclassified|tertiary|secondary|primary|trunk)$"][access!=private](${westWalkBbox}););out body;>;out skel;
(way[natural=water](${bbox});way[landuse=forest](${bbox});way[leisure=park](${bbox});way[natural=coastline](${bbox}););out geom;`;
await mkdir(".cache", { recursive: true });
await mkdir("public/data", { recursive: true });
await mkdir("data", { recursive: true });
let raw;
try {
  raw = JSON.parse(await readFile(".cache/osm-raw.json", "utf8"));
} catch {
  const parts = [
    `[out:json][timeout:25];relation[route~"^(subway|light_rail|monorail)$"](${bbox});out body;>;out body;`,
    `[out:json][timeout:25];relation[route=bus][ref~"^(${busRefs})$"](${bbox});out body;>;out body;`,
    ...[
      "1.265,103.778,1.32,103.87",
      "1.32,103.778,1.365,103.87",
      "1.265,103.87,1.365,103.966",
      "1.365,103.87,1.417,103.93",
    ].map(
      (box) =>
        `[out:json][timeout:25];way[highway~"^(footway|path|pedestrian|steps|cycleway|residential|service|unclassified|tertiary|secondary|primary|trunk)$"][access!=private](${box});out body;>;out skel;`,
    ),
    `[out:json][timeout:25];(way[natural=water](${bbox});way[leisure=park](${bbox});way[natural=coastline](${bbox}););out geom;`,
  ];
  raw = { elements: [] };
  for (const [index, part] of parts.entries()) {
    let result;
    try {
      result = JSON.parse(
        await readFile(`.cache/osm-part-${index}.json`, "utf8"),
      );
    } catch {
      console.log(
        `Fetching bounded extract ${index + 1}/${parts.length} (cached on disk)…`,
      );
      const response = await fetch(
        process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          body: new URLSearchParams({ data: part }),
          signal: AbortSignal.timeout(60000),
          headers: {
            Accept: "application/json",
            "User-Agent":
              "WeLikeTrains/1.0 (+https://github.com/AirrowSST/WeLikeTrains)",
          },
        },
      );
      if (!response.ok)
        throw new Error(`Overpass HTTP ${response.status}, part ${index}`);
      result = await response.json();
      if (result.remark) throw new Error(result.remark);
      await writeFile(`.cache/osm-part-${index}.json`, JSON.stringify(result));
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
    raw.elements = raw.elements.concat(result.elements);
    raw.osm3s = result.osm3s;
  }
  await writeFile(".cache/osm-raw.json", JSON.stringify(raw));
}
// Keep the base snapshot stable while allowing small, explicit coverage
// expansions to be fetched and cached independently. This corridor connects
// Choa Chu Kang/Boon Lay to Jalan Bahar via service 172.
const westExpansion = [
  `[out:json][timeout:25];relation[route=bus][ref="172"](${bbox});out body;>;out body;`,
  ...[
    "1.33,103.675,1.3675,103.72",
    "1.378,103.735,1.392,103.752",
  ].map(
    (box) =>
      `[out:json][timeout:25];way[highway~"^(footway|path|pedestrian|steps|cycleway|residential|service|unclassified|tertiary|secondary|primary|trunk)$"][access!=private](${box});out body;>;out skel;`,
  ),
];
for (const [index, part] of westExpansion.entries()) {
  let result;
  try {
    result = JSON.parse(
      await readFile(`.cache/osm-west-expansion-${index}.json`, "utf8"),
    );
  } catch {
    console.log(`Fetching bounded western expansion ${index + 1}/${westExpansion.length}…`);
    const response = await fetch(
      process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: new URLSearchParams({ data: part }),
        signal: AbortSignal.timeout(60000),
        headers: {
          Accept: "application/json",
          "User-Agent":
            "WeLikeTrains/1.0 (+https://github.com/AirrowSST/WeLikeTrains)",
        },
      },
    );
    if (!response.ok)
      throw new Error(`Overpass HTTP ${response.status}, western expansion ${index}`);
    result = await response.json();
    if (result.remark) throw new Error(result.remark);
    await writeFile(
      `.cache/osm-west-expansion-${index}.json`,
      JSON.stringify(result),
    );
    if (index < westExpansion.length - 1)
      await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  raw.elements = raw.elements.concat(result.elements);
  raw.osm3s = result.osm3s ?? raw.osm3s;
}
// Stop positions often omit station codes. Join actual station features by name.
const stationQuery = `[out:json][timeout:25];nwr[railway=station](${bbox});out tags center;`;
let stationData;
try {
  stationData = JSON.parse(await readFile(".cache/osm-stations.json", "utf8"));
} catch {
  const response = await fetch(
    process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
    {
      method: "POST",
      body: new URLSearchParams({ data: stationQuery }),
      signal: AbortSignal.timeout(60000),
      headers: {
        Accept: "application/json",
        "User-Agent":
          "WeLikeTrains/1.0 (+https://github.com/AirrowSST/WeLikeTrains)",
      },
    },
  );
  if (!response.ok)
    throw new Error(`Station references HTTP ${response.status}`);
  stationData = await response.json();
  if (stationData.remark) throw new Error(stationData.remark);
  await writeFile(".cache/osm-stations.json", JSON.stringify(stationData));
}
const stationCodes = new Map();
for (const station of stationData.elements) {
  const name = station.tags?.["name:en"] ?? station.tags?.name;
  const ref = station.tags?.ref ?? station.tags?.["ref:operator"];
  if (name && ref) stationCodes.set(name.toLowerCase(), ref);
}
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
const nodes = all.filter((x) => x.type === "node");
const ways = all.filter((x) => x.type === "way");
const coords = (id) => {
  const n = byId.get(`node/${id}`);
  return n ? [n.lat, n.lon] : null;
};
const routes = all
  .filter(
    (x) =>
      x.type === "relation" &&
      x.tags?.route &&
      !["JRL", "Skytrain"].includes(x.tags.ref),
  )
  .map((r) => ({
    id: r.id,
    tags: r.tags,
    stops: r.members
      .filter(
        (m) =>
          m.type === "node" &&
          (r.tags.route === "bus"
            ? /platform|stop/.test(m.role)
            : /stop/.test(m.role)),
      )
      .map((m) => {
        const n = byId.get(`node/${m.ref}`);
        return n
          ? {
              id: n.id,
              lat: n.lat,
              lon: n.lon,
              ...n.tags,
              ref:
                n.tags?.ref ??
                stationCodes.get(
                  (n.tags?.["name:en"] ?? n.tags?.name ?? "").toLowerCase(),
                ) ??
                "",
            }
          : null;
      })
      .filter(Boolean),
    ways: r.members
      .filter((m) => m.type === "way" && !/platform/.test(m.role))
      .map((m) => m.ref),
  }))
  .filter((r) => r.stops.length > 1);
const routingWays = ways
  .filter((w) => w.tags?.highway || w.tags?.railway)
  .map((w) => ({ id: w.id, nodes: w.nodes, tags: w.tags }));
const used = new Set(routingWays.flatMap((w) => w.nodes));
const graph = {
  timestamp: raw.osm3s?.timestamp_osm_base,
  attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0",
  query,
  nodes: nodes.filter((n) => used.has(n.id)).map((n) => [n.id, n.lat, n.lon]),
  ways: routingWays,
  routes,
};
await writeFile("data/network.json", JSON.stringify(graph));
const features = ways
  .filter(
    (w) =>
      (w.tags?.highway &&
        /^(primary|secondary|tertiary|trunk)$/.test(w.tags.highway)) ||
      w.tags?.natural ||
      w.tags?.leisure === "park" ||
      w.tags?.landuse === "forest",
  )
  .map((w) => {
    const original =
      w.geometry?.map((p) => [p.lon, p.lat]) ??
      w.nodes
        ?.map(coords)
        .filter(Boolean)
        .map((c) => [c[1], c[0]]) ??
      [];
    let last;
    const points = original
      .filter((p, i) => {
        if (
          i === 0 ||
          i === original.length - 1 ||
          Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.00018
        ) {
          last = p;
          return true;
        }
        return false;
      })
      .map((p) => p.map((n) => Number(n.toFixed(6))));
    const closed =
      points.length > 3 &&
      points[0][0] === points.at(-1)[0] &&
      points[0][1] === points.at(-1)[1];
    return {
      type: "Feature",
      properties: {
        kind: w.tags?.highway
          ? "road"
          : w.tags?.natural === "water"
            ? "water"
            : w.tags?.natural === "coastline"
              ? "coast"
              : "park",
        name: w.tags?.name ?? "",
      },
      geometry: {
        type: closed && !w.tags?.highway ? "Polygon" : "LineString",
        coordinates: closed && !w.tags?.highway ? [points] : points,
      },
    };
  })
  .filter(
    (f) =>
      (f.geometry.type === "Polygon"
        ? f.geometry.coordinates[0]
        : f.geometry.coordinates
      ).length > 1,
  );
await writeFile(
  "public/data/basemap.json",
  JSON.stringify({ type: "FeatureCollection", features }),
);
await writeFile(
  "data/OSM-PROVENANCE.json",
  JSON.stringify(
    {
      source: "https://overpass-api.de/api/interpreter",
      fetchedAt: new Date().toISOString(),
      dataTimestamp: graph.timestamp,
      license: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: graph.attribution,
      bbox,
      query,
      stationQuery,
      queryNote:
        "Large walking/basemap query is split into seven cached bounded requests; see scripts/import-osm.mjs for exact parts.",
      routes: routes.length,
      nodes: graph.nodes.length,
      ways: routingWays.length,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      routes: routes.length,
      nodes: graph.nodes.length,
      ways: routingWays.length,
      features: features.length,
    },
    null,
    2,
  ),
);
