import type { Preferences, Segment, ShelterMode } from "./types";

type ShelterMeasurement = Pick<
  Segment,
  | "mode"
  | "distance"
  | "sheltered"
  | "coveredDistance"
  | "exposedDistance"
  | "unknownDistance"
>;

export function shelterMode(
  preferences: Pick<Preferences, "sheltered" | "shelterMode">,
): "none" | ShelterMode {
  if (!preferences.sheltered) return "none";
  return preferences.shelterMode === "require" ? "require" : "prefer";
}

export function shelterDistances(segment: ShelterMeasurement) {
  if (segment.mode !== "walk")
    return { covered: 0, exposed: 0, unknown: 0, total: 0 };
  const hasBreakdown =
    segment.coveredDistance !== undefined ||
    segment.exposedDistance !== undefined ||
    segment.unknownDistance !== undefined;
  const covered = hasBreakdown
    ? (segment.coveredDistance ?? 0)
    : segment.sheltered
      ? segment.distance
      : 0;
  const exposed = hasBreakdown ? (segment.exposedDistance ?? 0) : 0;
  // Old cached plans cannot distinguish exposed from unmapped. Keep that
  // distance unknown instead of presenting it as measured exposure.
  const unknown = hasBreakdown
    ? (segment.unknownDistance ?? 0)
    : segment.sheltered
      ? 0
      : segment.distance;
  return {
    covered,
    exposed,
    unknown,
    total: covered + exposed + unknown,
  };
}

export function shelterExposureRatio(segment: ShelterMeasurement) {
  const distances = shelterDistances(segment);
  if (distances.total <= 0) return 0;
  return (distances.exposed + distances.unknown) / distances.total;
}

export function shelterSummary(segment: ShelterMeasurement) {
  const { covered, exposed, unknown, total } = shelterDistances(segment);
  if (total <= 0) return "No walking distance";
  const parts = [
    covered > 0 && `${Math.round(covered)} m covered`,
    exposed > 0 && `${Math.round(exposed)} m exposed`,
    unknown > 0 && `${Math.round(unknown)} m shelter unknown`,
  ].filter(Boolean);
  return parts.join(" · ");
}
