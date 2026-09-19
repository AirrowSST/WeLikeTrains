import { describe, expect, it } from "vitest";
import {
  creditJourney,
  journeyPoints,
  pointsBalance,
  pointsJourneyId,
  readPointsWallet,
  redeemReward,
} from "../shared/rewards";
import type { Journey, PlanResponse, Segment } from "../shared/types";

const original = { id: "usual", crowd: "high" } as Journey;
function route(overrides: Partial<Journey> = {}): Journey {
  return {
    id: "quiet",
    crowd: "low",
    blocked: false,
    segments: [
      { mode: "walk", distance: 350 },
      { mode: "cycle", distance: 1250 },
      { mode: "rail", distance: 12000 },
    ] as Segment[],
    ...overrides,
  } as Journey;
}
const entry = {
  id: "trip-1",
  title: "Quieter route",
  completedAt: "2026-09-19T01:00:00Z",
  activeTravel: 30,
  quieterRoute: 20,
  total: 50,
};

describe("journey points", () => {
  it("adds walking and cycling distance, excludes motorised distance, and rewards a quieter alternative", () => {
    expect(journeyPoints(route(), original)).toEqual({
      activeTravel: 16,
      quieterRoute: 20,
      total: 36,
    });
    expect(
      journeyPoints(
        route({ segments: [{ mode: "walk", distance: 99 }] as Segment[] }),
        original,
      ).activeTravel,
    ).toBe(0);
  });
  it("never invents a crowd improvement from unknown levels or the original route", () => {
    for (const selected of [
      route({ crowd: "unknown" }),
      route({ crowd: "high" }),
      route({ id: "usual" }),
    ])
      expect(journeyPoints(selected, original).quieterRoute).toBe(0);
    expect(
      journeyPoints(route(), { ...original, crowd: "unknown" }).quieterRoute,
    ).toBe(0);
    expect(
      journeyPoints(route(), { ...original, crowd: "low" }).quieterRoute,
    ).toBe(0);
  });
  it("awards nothing for a blocked route and ignores invalid distances", () => {
    expect(journeyPoints(route({ blocked: true }), original).total).toBe(0);
    expect(
      journeyPoints(
        route({
          segments: [
            { mode: "walk", distance: -100 },
            { mode: "cycle", distance: NaN },
          ] as Segment[],
        }),
        original,
      ).activeTravel,
    ).toBe(0);
  });
  it("credits one planned journey once, including after storage reload and alternative selection", () => {
    const wallet = creditJourney({ entries: [] }, entry);
    expect(pointsBalance(wallet)).toBe(50);
    expect(
      pointsBalance(
        creditJourney(readPointsWallet(wallet), {
          ...entry,
          total: 70,
          activeTravel: 50,
        }),
      ),
    ).toBe(50);
    const plan = {
      request: {
        origin: { lat: 1, lon: 103 },
        destination: { lat: 2, lon: 104 },
        departure: "2026-09-19T08:00:00+08:00",
      },
    } as PlanResponse;
    expect(pointsJourneyId(plan)).toBe(
      pointsJourneyId({ ...plan, recommended: route() }),
    );
    expect(pointsJourneyId(plan)).not.toBe(
      pointsJourneyId({
        ...plan,
        request: { ...plan.request, departure: "2026-09-19T10:00:00+08:00" },
      }),
    );
  });
  it("spends points on demo rewards, persists redemptions and prevents overspending or duplicate redemption", () => {
    const earned = creditJourney({ entries: [] }, entry);
    expect(redeemReward(earned, "smoothie", "r-1", entry.completedAt)).toBe(
      earned,
    );
    expect(redeemReward(earned, "invented", "r-1", entry.completedAt)).toBe(
      earned,
    );
    const redeemed = redeemReward(earned, "coffee", "r-1", entry.completedAt);
    expect(pointsBalance(redeemed)).toBe(0);
    expect(readPointsWallet(JSON.parse(JSON.stringify(redeemed)))).toEqual(
      redeemed,
    );
    expect(redeemReward(redeemed, "coffee", "r-2", entry.completedAt)).toBe(
      redeemed,
    );
    const next = creditJourney(redeemed, { ...entry, id: "trip-2" });
    expect(pointsBalance(next)).toBe(50);
    expect(redeemReward(next, "coffee", "r-1", entry.completedAt)).toBe(next);
  });
  it("recovers from malformed local data and drops duplicate entries", () => {
    expect(readPointsWallet(null)).toEqual({ entries: [] });
    expect(
      readPointsWallet({
        entries: [entry, entry, { ...entry, id: "bad", total: -10 }],
      }),
    ).toEqual({ entries: [entry] });
  });
});
