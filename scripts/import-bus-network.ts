import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { config } from "dotenv";
import { gzipSync, strToU8 } from "fflate";
import {
  buildBusNetworkSnapshot,
  fetchBusReferenceRows,
  LTA_BUS_REFERENCE_ENDPOINTS,
  LTA_OPEN_DATA_LICENCE,
} from "../server/bus-network";
import { ltaConnection } from "../server/lta-client";

config({ quiet: true });
const connection = ltaConnection();
const outputArgument = process.argv.indexOf("--output");
const outputPath = resolve(
  outputArgument >= 0 && process.argv[outputArgument + 1]
    ? process.argv[outputArgument + 1]
    : connection.simulated
      ? ".cache/datamall/bus-network.json.gz"
      : "data/bus-network.json.gz",
);
if (connection.simulated) {
  const within = relative(resolve(".cache"), outputPath);
  if (within.startsWith("..") || isAbsolute(within))
    throw new Error("Simulated bus-network output must stay under .cache");
}
const accountKey = connection.key;
if (!accountKey)
  throw new Error(
    "LTA_ACCOUNT_KEY is required for the explicit bus-network maintenance import.",
  );

const accessedAt = new Date().toISOString();
const rows = await fetchBusReferenceRows({
  base: connection.base,
  key: accountKey,
});
const snapshot = buildBusNetworkSnapshot(rows, accessedAt);
if (connection.simulated) {
  snapshot.source = "SIMULATED · authored DataMall reference fixtures";
  snapshot.licence = "Authored test fixture; not LTA data";
}
const compressed = gzipSync(strToU8(JSON.stringify(snapshot)), { level: 9 });
const hash = createHash("sha256").update(compressed).digest("hex");
const knownStops = new Set(snapshot.stops.map((stop) => stop.code));
const orphanRouteStopCount = snapshot.routes.filter(
  (route) => !knownStops.has(route.stopCode),
).length;
const provenancePath = resolve(
  dirname(outputPath),
  "BUS-NETWORK-PROVENANCE.json",
);
const provenance = {
  generatedAt: accessedAt,
  source: connection.simulated
    ? snapshot.source
    : LTA_BUS_REFERENCE_ENDPOINTS.map(
        (endpoint) => `${connection.base}/${endpoint}`,
      ),
  licence: connection.simulated ? snapshot.licence : LTA_OPEN_DATA_LICENCE,
  simulated: connection.simulated,
  licenceNotice: connection.simulated
    ? "SIMULATED · authored reference fixtures, not official bus data"
    : `Contains information from LTA DataMall, accessed on ${snapshot.accessedOn}, made available under the Singapore Open Data Licence version 1.0.`,
  derivedFile: outputPath.split(/[\\/]/).at(-1),
  sha256: hash,
  stopCount: snapshot.stops.length,
  routeRowCount: snapshot.routes.length,
  serviceDirectionCount: snapshot.services.length,
  orphanRouteStopCount,
  refresh: "Explicit maintenance only: npm run data:buses",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, compressed);
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(
  `Wrote ${snapshot.stops.length} stops, ${snapshot.routes.length} route rows and ${snapshot.services.length} service directions.`,
);
console.log(`Snapshot: ${outputPath}`);
console.log(`Provenance: ${provenancePath}`);
