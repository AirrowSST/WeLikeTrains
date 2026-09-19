import { config } from "dotenv";
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ltaConnection } from "../server/lta-client";
import {
  loadBusNetworkSnapshot,
  buildBusNetworkSnapshot,
} from "../server/bus-network";
import { releasedPlannedRows } from "../server/planned-buses";
config({ quiet: true });
const connection = ltaConnection();
if (connection.simulated || !connection.key)
  throw new Error("Official LTA connection required");
const snapshot = loadBusNetworkSnapshot();
if (!snapshot) throw new Error("Import bus references first");
const published: Record<string, unknown>[] = [];
const now = Date.now();
for (let skip = 0; ; skip += 500) {
  if (skip > 200000) throw new Error("Planned route safety cap exceeded");
  const response = await fetch(
    `${connection.base}/PlannedBusRoutes?$skip=${skip}`,
    {
      headers: { AccountKey: connection.key },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(`Planned bus metadata HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.value))
    throw new Error("Invalid planned route response");
  published.push(...releasedPlannedRows(body.value, now));
  if (body.value.length < 500) break;
}
// Only the latest already-effective complete route version is eligible.
const latest = new Map<string, string>();
for (const row of published) {
  const key = `${row.ServiceNo}|${row.Operator}|${row.Direction}`;
  const date = String(row.EffectiveDate);
  if (date > (latest.get(key) ?? "")) latest.set(key, date);
}
const rows = published.filter(
  (r) =>
    String(r.EffectiveDate) ===
      latest.get(`${r.ServiceNo}|${r.Operator}|${r.Direction}`) &&
    String(r.EffectiveDate).replaceAll("-", "").slice(0, 8) >=
      snapshot.accessedOn.replaceAll("-", ""),
);
const normalized = buildBusNetworkSnapshot(
  {
    BusStops: snapshot.stops.map((s) => ({
      BusStopCode: s.code,
      Description: s.name,
      RoadName: s.roadName,
      Latitude: s.lat,
      Longitude: s.lon,
    })),
    BusServices: [],
    BusRoutes: rows,
  },
  new Date(now).toISOString(),
);
const compressed = gzipSync(
  JSON.stringify({
    version: 1,
    baseAccessedAt: snapshot.accessedAt,
    accessedAt: new Date(now).toISOString(),
    routes: normalized.routes,
  }),
);
writeFileSync("data/planned-buses.json.gz", compressed);
writeFileSync(
  "data/PLANNED-BUSES-PROVENANCE.json",
  JSON.stringify(
    {
      source: `${connection.base}/PlannedBusRoutes`,
      accessedAt: new Date(now).toISOString(),
      releasedRows: normalized.routes.length,
      licence: "Singapore Open Data Licence v1.0",
      sha256: createHash("sha256").update(compressed).digest("hex"),
      restriction:
        "Only rows already effective at import time are retained; refresh explicitly with npm run data:planned-buses",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${normalized.routes.length} released route-stop rows; unpublished rows were neither saved nor logged.`,
);
