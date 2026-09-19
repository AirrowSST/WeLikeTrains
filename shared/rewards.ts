import type { Journey, PlanResponse } from "./types";

export interface JourneyPoints {
  activeTravel: number;
  quieterRoute: number;
  total: number;
}
export interface PointsEntry extends JourneyPoints {
  id: string;
  title: string;
  completedAt: string;
}
export interface PointsWallet {
  entries: PointsEntry[];
  redemptions?: RewardRedemption[];
}
export interface RewardRedemption {
  id: string;
  rewardId: string;
  title: string;
  cost: number;
  redeemedAt: string;
}
export const demoRewards = [
  {
    id: "coffee",
    title: "A coffee on the way",
    description: "A little pick-me-up for your next adventure.",
    cost: 50,
    icon: "coffee",
  },
  {
    id: "smoothie",
    title: "A refreshing smoothie",
    description: "A bright little treat after a greener journey.",
    cost: 100,
    icon: "smoothie",
  },
  {
    id: "cycle",
    title: "A weekend cycle",
    description: "Imagine a bike-hire treat for your next day out.",
    cost: 200,
    icon: "cycle",
  },
] as const;

export function journeyPoints(
  journey: Journey,
  original: Journey,
): JourneyPoints {
  if (journey.blocked) return { activeTravel: 0, quieterRoute: 0, total: 0 };
  const metres = journey.segments.reduce(
    (sum, segment) =>
      sum +
      ((segment.mode === "walk" || segment.mode === "cycle") &&
      Number.isFinite(segment.distance) &&
      segment.distance > 0
        ? segment.distance
        : 0),
    0,
  );
  const crowdRank = { low: 0, moderate: 1, high: 2 };
  const quieterRoute =
    journey.id !== original.id &&
    journey.crowd !== "unknown" &&
    original.crowd !== "unknown" &&
    crowdRank[journey.crowd] < crowdRank[original.crowd]
      ? 20
      : 0;
  const activeTravel = Math.floor(metres / 100);
  return { activeTravel, quieterRoute, total: activeTravel + quieterRoute };
}

// One completion per planned departure and endpoint pair, even if another
// alternative is opened or the same plan is refreshed/reloaded.
export function pointsJourneyId(plan: PlanResponse) {
  const { origin, destination, departure } = plan.request;
  return JSON.stringify([
    origin.lat,
    origin.lon,
    destination.lat,
    destination.lon,
    new Date(departure).toISOString(),
  ]);
}

export function creditJourney(
  wallet: PointsWallet,
  entry: PointsEntry,
): PointsWallet {
  if (
    entry.total <= 0 ||
    wallet.entries.some((previous) => previous.id === entry.id)
  )
    return wallet;
  return { ...wallet, entries: [entry, ...wallet.entries] };
}

export const pointsBalance = (wallet: PointsWallet) =>
  wallet.entries.reduce((sum, entry) => sum + entry.total, 0) -
  (wallet.redemptions ?? []).reduce(
    (sum, redemption) => sum + redemption.cost,
    0,
  );

export function redeemReward(
  wallet: PointsWallet,
  rewardId: string,
  id: string,
  redeemedAt: string,
): PointsWallet {
  const reward = demoRewards.find((item) => item.id === rewardId);
  if (
    !reward ||
    pointsBalance(wallet) < reward.cost ||
    wallet.redemptions?.some((item) => item.id === id)
  )
    return wallet;
  return {
    ...wallet,
    redemptions: [
      { id, rewardId, title: reward.title, cost: reward.cost, redeemedAt },
      ...(wallet.redemptions ?? []),
    ],
  };
}

export function readPointsWallet(value: unknown): PointsWallet {
  if (
    !value ||
    typeof value !== "object" ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  )
    return { entries: [] };
  const ids = new Set<string>();
  const entries = value.entries.filter((entry): entry is PointsEntry => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      ids.has(entry.id) ||
      typeof entry.title !== "string" ||
      typeof entry.completedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.completedAt)) ||
      ![entry.activeTravel, entry.quieterRoute, entry.total].every(
        (points) => Number.isSafeInteger(points) && points >= 0,
      ) ||
      entry.total !== entry.activeTravel + entry.quieterRoute
    )
      return false;
    ids.add(entry.id);
    return true;
  });
  let wallet: PointsWallet = { entries };
  if ("redemptions" in value && Array.isArray(value.redemptions)) {
    for (const item of [...value.redemptions].reverse()) {
      if (
        item &&
        typeof item.id === "string" &&
        typeof item.redeemedAt === "string" &&
        Number.isFinite(Date.parse(item.redeemedAt))
      ) {
        wallet = redeemReward(wallet, item.rewardId, item.id, item.redeemedAt);
      }
    }
  }
  return wallet;
}
