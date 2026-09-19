import type { Crowd, TransitStop } from "./types";
import { QUIETER_ROUTE_BONUS } from "./rewards";

export const dashboardCrowdLines = [
  "EWL",
  "DTL",
  "NEL",
  "CCL",
  "TEL",
  "NSL",
  "CGL",
  "CEL",
  "SLRT",
  "PLRT",
  "BPL",
] as const;

export type DashboardCrowdLine = (typeof dashboardCrowdLines)[number];

const prefixesByLine: Record<DashboardCrowdLine, string[]> = {
  EWL: ["EW"],
  DTL: ["DT"],
  NEL: ["NE"],
  CCL: ["CC"],
  TEL: ["TE"],
  NSL: ["NS"],
  CGL: ["CG"],
  CEL: ["CE"],
  SLRT: ["SE", "SW"],
  PLRT: ["PE", "PW"],
  BPL: ["BP"],
};

export function stationCodeForLine(
  stop: Pick<TransitStop, "codes">,
  line: DashboardCrowdLine,
) {
  return stop.codes.find((code) =>
    prefixesByLine[line].some((prefix) => code.startsWith(prefix)),
  );
}

export function stationsForCrowdLine(
  stops: TransitStop[],
  line: DashboardCrowdLine,
) {
  const branchOrder = new Map(
    prefixesByLine[line].map((prefix, i) => [prefix, i]),
  );
  return stops
    .filter((stop) => stop.mode === "rail" && stationCodeForLine(stop, line))
    .sort((a, b) => {
      const aCode = stationCodeForLine(a, line)!;
      const bCode = stationCodeForLine(b, line)!;
      const aPrefix = aCode.match(/^[A-Z]+/)?.[0] ?? "";
      const bPrefix = bCode.match(/^[A-Z]+/)?.[0] ?? "";
      return (
        (branchOrder.get(aPrefix) ?? 99) - (branchOrder.get(bPrefix) ?? 99) ||
        Number(aCode.match(/\d+/)?.[0] ?? 0) -
          Number(bCode.match(/\d+/)?.[0] ?? 0) ||
        a.name.localeCompare(b.name)
      );
    });
}

const crowdRank: Record<Crowd, number | null> = {
  low: 0,
  moderate: 1,
  high: 2,
  unknown: null,
};

export interface RewardFlowInput {
  sourceCrowd: Crowd;
  alternativeCrowd: Crowd;
  eligibleTrips: number;
  assumedUptakePercent: number;
}

export interface RewardFlowResult {
  canRedirect: boolean;
  shiftedTrips: number;
  remainingTrips: number;
  rewardPoints: number;
  quieterRouteBonus: number;
  reason: string;
}

export function calculateRewardFlow(input: RewardFlowInput): RewardFlowResult {
  const eligibleTrips = Math.max(0, Math.round(input.eligibleTrips));
  const uptake = Math.min(100, Math.max(0, input.assumedUptakePercent));
  const sourceRank = crowdRank[input.sourceCrowd];
  const alternativeRank = crowdRank[input.alternativeCrowd];
  const canRedirect =
    sourceRank !== null &&
    alternativeRank !== null &&
    alternativeRank < sourceRank;
  const shiftedTrips = canRedirect
    ? Math.round((eligibleTrips * uptake) / 100)
    : 0;
  let reason = "The selected alternative has a lower known crowd level.";
  if (sourceRank === null || alternativeRank === null)
    reason = "Unknown crowd data cannot establish a quieter alternative.";
  else if (alternativeRank >= sourceRank)
    reason = "The alternative is not less crowded than the source.";
  return {
    canRedirect,
    shiftedTrips,
    remainingTrips: eligibleTrips - shiftedTrips,
    rewardPoints: shiftedTrips * QUIETER_ROUTE_BONUS,
    quieterRouteBonus: QUIETER_ROUTE_BONUS,
    reason,
  };
}
