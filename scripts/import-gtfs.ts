import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { ltaConnection } from "../server/lta-client";
import { config } from "dotenv";
import { gzipSync, strFromU8, strToU8, unzipSync } from "fflate";
import {
  buildRailScheduleSnapshot,
  LTA_GTFS_ENDPOINT,
  LTA_OPEN_DATA_LICENCE,
  type GtfsScheduleFiles,
} from "../server/rail-schedule";

config({ quiet: true });
const connection = ltaConnection();

const outputArgument = process.argv.indexOf("--output");
const outputPath = resolve(
  outputArgument >= 0 && process.argv[outputArgument + 1]
    ? process.argv[outputArgument + 1]
    : connection.simulated
      ? ".cache/datamall/train-schedule.json.gz"
      : "data/train-schedule.json.gz",
);
if (connection.simulated) {
  const within = relative(resolve(".cache"), outputPath);
  if (within.startsWith("..") || isAbsolute(within))
    throw new Error("Simulated GTFS output must stay under .cache");
}
const provenancePath = resolve(dirname(outputPath), "GTFS-PROVENANCE.json");
const accountKey = connection.key;
if (!accountKey) {
  throw new Error(
    "LTA_ACCOUNT_KEY is required for the explicit GTFS maintenance import.",
  );
}

const metadataResponse = await fetch(`${connection.base}/GTFSScheduleTrain`, {
  redirect: "error",
  headers: { AccountKey: accountKey, Accept: "application/json" },
});
if (!metadataResponse.ok)
  throw new Error(
    `LTA GTFS metadata request failed (${metadataResponse.status})`,
  );
const metadata = (await metadataResponse.json()) as unknown;
const findDownloadLink = (value: unknown): string | undefined => {
  if (typeof value === "string")
    return (value.startsWith("https://") ||
      (connection.simulated && value.startsWith("http://127.0.0.1:"))) &&
      (value.includes(".zip") || value.includes("X-Amz-"))
      ? value
      : undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDownloadLink(entry);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      const found = findDownloadLink(entry);
      if (found) return found;
    }
  }
  return undefined;
};
const downloadLink = findDownloadLink(metadata);
if (
  !downloadLink ||
  (connection.simulated
    ? new URL(downloadLink).origin !== new URL(connection.base).origin
    : !downloadLink.startsWith("https://"))
)
  throw new Error(
    "LTA GTFS metadata response did not contain a secure download link",
  );

const archiveResponse = await fetch(downloadLink, { redirect: "error" });
if (!archiveResponse.ok)
  throw new Error(
    `LTA GTFS archive download failed (${archiveResponse.status})`,
  );
const archive = unzipSync(new Uint8Array(await archiveResponse.arrayBuffer()));
const files = new Map(
  Object.entries(archive).map(([name, bytes]) => [
    name.replaceAll("\\", "/").split("/").at(-1)!.toLowerCase(),
    strFromU8(bytes),
  ]),
);
const required = (
  [
    ["routes", "routes.txt"],
    ["stops", "stops.txt"],
    ["trips", "trips.txt"],
    ["stopTimes", "stop_times.txt"],
    ["calendar", "calendar.txt"],
    ["calendarDates", "calendar_dates.txt"],
  ] as const
).map(([key, name]) => {
  const contents = files.get(name);
  if (contents === undefined)
    throw new Error(`GTFS archive is missing ${name}`);
  return [key, contents] as const;
});
const accessedAt = new Date().toISOString();
const snapshot = buildRailScheduleSnapshot(
  Object.fromEntries(required) as unknown as GtfsScheduleFiles,
  accessedAt,
);
if (connection.simulated) {
  snapshot.source = "SIMULATED · authored GTFS fixtures";
  snapshot.licence = "Authored test fixture; not LTA data";
}
const compressed = gzipSync(strToU8(JSON.stringify(snapshot)), { level: 9 });
const hash = createHash("sha256").update(compressed).digest("hex");
const provenance = {
  generatedAt: accessedAt,
  source: connection.simulated ? snapshot.source : LTA_GTFS_ENDPOINT,
  licence: connection.simulated ? snapshot.licence : LTA_OPEN_DATA_LICENCE,
  simulated: connection.simulated,
  licenceNotice: connection.simulated
    ? "SIMULATED · authored GTFS fixtures, not an official schedule"
    : "Contains information from LTA DataMall GTFS Schedule (Train), accessed on " +
      snapshot.accessedOn +
      ", made available under the Singapore Open Data Licence version 1.0.",
  derivedFile: outputPath.split(/[\\/]/).at(-1),
  sha256: hash,
  validFrom: snapshot.validFrom,
  validUntil: snapshot.validUntil,
  serviceCount: snapshot.services.length,
  tripCount: snapshot.trips.length,
  refresh: "Explicit maintenance only: npm run data:gtfs",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, compressed);
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(
  `Wrote ${snapshot.trips.length} train trips covering ${snapshot.validFrom} to ${snapshot.validUntil}.`,
);
console.log(`Snapshot: ${outputPath}`);
console.log(`Provenance: ${provenancePath}`);
