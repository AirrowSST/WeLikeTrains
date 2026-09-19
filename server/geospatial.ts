import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Coord } from "../shared/types";
import { LineIndex } from "./spatial";

interface Feature {
  properties: Record<string, string>;
  geometry: { type: string; coordinates: any };
}
export interface GeospatialSnapshot {
  version: 1;
  accessedAt: string;
  layers: Record<string, Feature[]>;
}
let cached: ReturnType<typeof buildGeospatial> | undefined;
export function buildGeospatial(snapshot?: GeospatialSnapshot) {
  const lines = (layer: string): Coord[][] =>
    (snapshot?.layers[layer] ?? []).flatMap((f) => {
      const parts =
        f.geometry.type === "LineString"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiLineString"
            ? f.geometry.coordinates
            : [];
      return parts.map((part: number[][]) =>
        part.map(([lon, lat]) => [lat, lon] as Coord),
      );
    });
  return {
    accessedAt: snapshot?.accessedAt,
    covered: new LineIndex(lines("CoveredLinkWay")),
    cycling: new LineIndex(lines("CyclingPath")),
    exits: (snapshot?.layers.TrainStationExit ?? [])
      .filter((f) => f.geometry.type === "Point")
      .map((f) => ({
        station: f.properties.stn_name,
        exit: f.properties.exit_code,
        coord: [f.geometry.coordinates[1], f.geometry.coordinates[0]] as Coord,
      })),
  };
}
export function getGeospatial() {
  if (!cached) {
    try {
      const snapshot = JSON.parse(
        gunzipSync(
          readFileSync(
            new URL("../data/lta-geospatial.json.gz", import.meta.url),
          ),
        ).toString(),
      );
      if (snapshot.version !== 1) throw new Error("Unknown snapshot");
      cached = buildGeospatial(snapshot);
    } catch {
      cached = buildGeospatial();
    }
  }
  return cached;
}
export function stationExits(name: string) {
  const normal = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(mrt|lrt|station)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  return getGeospatial().exits.filter(
    (e) => normal(e.station) === normal(name),
  );
}
