import type { Conditions, Journey, Risk } from "./types";
// Explainable precursor index. This is deliberately not a calibrated probability.
export function estimateRisk(conditions: Conditions, journey: Journey): Risk {
  const relevant = new Set(journey.segments.map((s) => s.line));
  const disruptions = conditions.notices.filter(
    (n) =>
      n.kind === "disruption" &&
      (!n.line || relevant.has(n.line)) &&
      new Date(n.startsAt).getTime() <= new Date(journey.arrival).getTime() &&
      (!n.endsAt ||
        new Date(n.endsAt).getTime() >=
          new Date(journey.arrival).getTime() - journey.duration * 60000),
  );
  const highCrowd = journey.segments.some((s) => s.crowd === "high");
  const stale = conditions.feeds.some(
    (f) => f.status === "stale" || f.status === "unavailable",
  );
  const score = Math.min(
    95,
    10 +
      disruptions.length * 45 +
      (highCrowd ? 20 : 0) +
      (conditions.weather.rain ? 15 : 0) +
      (stale ? 10 : 0),
  );
  const factors = [
    ...(disruptions.length
      ? ["An active incident intersects your original route"]
      : []),
    ...(highCrowd ? ["High crowd density can extend boarding time"] : []),
    ...(conditions.weather.rain
      ? ["Rain increases walking and surface-transport uncertainty"]
      : []),
    ...(stale ? ["Some live signals are unavailable or stale"] : []),
  ];
  return {
    level: score >= 65 ? "high" : score >= 30 ? "moderate" : "low",
    score,
    factors: factors.length
      ? factors
      : ["No elevated signal in the available inputs"],
    model: "Explainable risk index v1",
    disclaimer:
      "A rule-based risk index, not a disruption probability or a trained forecast. Gemini can explain these signals when connected.",
  };
}
