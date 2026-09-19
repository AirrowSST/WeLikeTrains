import type { Segment, TrafficReading, Coord } from "../shared/types";
import { aligned, pointSegmentDistance } from "./spatial";

/** Conservative road-speed correction. Road traffic is not measured bus speed. */
export function trafficAllowance(segment: Segment, readings: TrafficReading[]) {
  if (segment.mode !== "bus" || segment.geometryKind === "schematic") return 0;
  let extra = 0;
  for (let i = 1; i < segment.geometry.length; i++) {
    const a = segment.geometry[i - 1],
      b = segment.geometry[i];
    const length = Math.hypot(
      (b[0] - a[0]) * 111320,
      (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180),
    );
    if (length <= 0 || length > 500) continue; // Do not match approximate long connectors.
    const mid: Coord = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const matches = readings.filter(
      (r) =>
        r.linkId &&
        r.location &&
        r.endLocation &&
        r.minimumSpeed !== undefined &&
        r.maximumSpeed !== undefined &&
        aligned(a, b, r.location, r.endLocation, true) &&
        [a, mid, b].every(
          (p) => pointSegmentDistance(p, r.location!, r.endLocation!) <= 15,
        ),
    );
    if (!matches.length) continue;
    const speed = Math.max(
      5,
      Math.min(...matches.map((r) => (r.minimumSpeed! + r.maximumSpeed!) / 2)),
    );
    // Never speed up buses because a road happens to be free flowing.
    extra += Math.max(0, length / ((speed * 1000) / 60) - length / 320);
  }
  return Math.min(
    extra,
    Math.max(0, segment.minutes - (segment.waitMinutes ?? 0)) * 0.75,
  );
}
