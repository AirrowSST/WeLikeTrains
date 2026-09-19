import type { Segment } from "./types";

/** Platform density is not an observation of occupancy inside a train. */
export function crowdDescription(
  segment: Pick<Segment, "mode" | "crowd" | "crowdSource">,
): string {
  const scope =
    segment.mode === "rail" ? "Station/platform crowding" : "Bus occupancy";
  const level = segment.crowd[0].toUpperCase() + segment.crowd.slice(1);
  if (segment.crowd === "unknown")
    return `${scope}: Unknown · No usable reading`;
  const source =
    segment.crowdSource === "simulated"
      ? "Simulated"
      : segment.crowdSource === "forecast"
        ? "Forecast"
        : segment.crowdSource === "mixed"
          ? "Current / forecast"
          : segment.crowdSource === "current"
            ? segment.mode === "bus"
              ? "Selected arriving bus"
              : "Current reading"
            : "Reading time unverified";
  return `${scope}: ${level} · ${source}`;
}
