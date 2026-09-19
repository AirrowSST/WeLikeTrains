import { config } from "dotenv";
import { unzipSync, strFromU8 } from "fflate";
import { read } from "shapefile";
import proj4 from "proj4";
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { downloadLtaFile } from "../server/lta-download";
import { ltaConnection } from "../server/lta-client";

config({ quiet: true });
if (ltaConnection().simulated)
  throw new Error(
    "Official geospatial import does not accept simulator output",
  );
const layers: Record<string, unknown> = {};
const sources: Record<string, unknown>[] = [];
for (const layer of ["TrainStationExit", "CoveredLinkWay", "CyclingPath"]) {
  const endpoint = `GeospatialWholeIsland?ID=${layer}`;
  try {
    const archive = unzipSync(await downloadLtaFile(endpoint));
    const shp = Object.keys(archive).find((k) =>
      k.toLowerCase().endsWith(".shp"),
    );
    if (!shp) throw new Error("Missing shapefile");
    const file = (extension: string) =>
      archive[
        Object.keys(archive).find(
          (k) => k.toLowerCase() === shp.slice(0, -4).toLowerCase() + extension,
        ) ?? ""
      ];
    if (!file(".prj") || !file(".dbf"))
      throw new Error("Missing projection or attributes");
    const projection = strFromU8(file(".prj"));
    const collection = await read(archive[shp], file(".dbf"));
    function convert(value: any): any {
      if (Array.isArray(value) && typeof value[0] === "number") {
        const [lon, lat] = proj4(projection, "EPSG:4326", value);
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < 1.1 ||
          lat > 1.6 ||
          lon < 103.5 ||
          lon > 104.2
        )
          throw new Error("Coordinates outside Singapore");
        return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
      }
      return value.map(convert);
    }
    for (const feature of collection.features) {
      if (!feature.geometry || !("coordinates" in feature.geometry))
        throw new Error("Unsupported geometry");
      feature.geometry.coordinates = convert(feature.geometry.coordinates);
    }
    layers[layer] = collection.features;
    sources.push({
      layer,
      endpoint,
      count: collection.features.length,
      projection,
    });
    console.log(
      `${layer}: ${collection.features.length} features; fields: ${Object.keys(collection.features[0]?.properties ?? {}).join(", ")}`,
    );
  } catch {
    throw new Error(`${layer} import failed; existing snapshot unchanged`);
  }
}
const accessedAt = new Date().toISOString();
const compressed = gzipSync(JSON.stringify({ version: 1, accessedAt, layers }));
writeFileSync("data/lta-geospatial.json.gz", compressed);
writeFileSync(
  "data/LTA-GEOSPATIAL-PROVENANCE.json",
  JSON.stringify(
    {
      accessedAt,
      sources,
      coordinates: "WGS84 longitude, latitude",
      licence:
        "https://datamall.lta.gov.sg/content/datamall/en/SingaporeOpenDataLicence.html",
      attribution:
        "Contains information from LTA DataMall under the Singapore Open Data Licence v1.0",
      sha256: createHash("sha256").update(compressed).digest("hex"),
      refresh: "npm run data:geospatial",
    },
    null,
    2,
  ) + "\n",
);
