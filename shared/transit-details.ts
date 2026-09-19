import { canonicalLine, lineColors } from "./catalog";
import type { Crowd, TransitStop } from "./types";

export function stationColor(code: string, lines: string[] = []) {
  const prefix = code.match(/^[A-Z]+/)?.[0] ?? "";
  const line = (
    {
      EW: "EWL",
      CG: "EWL",
      NS: "NSL",
      NE: "NEL",
      CC: "CCL",
      CE: "CCL",
      DT: "DTL",
      TE: "TEL",
      BP: "BPL",
      SE: "SLRT",
      SW: "SLRT",
      PE: "PLRT",
      PW: "PLRT",
    } as Record<string, string>
  )[prefix];
  return lineColors[line ?? canonicalLine(lines[0] ?? "")] ?? "#52665c";
}
export function stationTextColor(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#000000"
    : "#ffffff";
}
export interface BusServiceMap {
  service: string;
  directions: {
    direction: number;
    stops: (TransitStop & { sequence: number })[];
  }[];
}
export interface StationBoard {
  groups: { line: string; towards: string; times: string[] }[];
  crowds: StationCrowd[];
  forecasts?: StationCrowd[];
  accessedOn?: string;
}
export interface StationCrowd {
  line: string;
  level: Crowd;
  status: string;
  start?: string;
  end?: string;
}
