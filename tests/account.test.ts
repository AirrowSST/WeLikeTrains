import { describe, expect, it } from "vitest";
import type { AccountState, PlanRequest } from "../shared/types";
import { places, profiles } from "../shared/catalog";
import {
  createSessionToken,
  mergeAccountStates,
  readSessionToken,
} from "../server/accounts";
import { accountStateSchema, planSchema } from "../server/validation";

const preferences = profiles[0].preferences;
const request = (dataMode: "live" | "demo" = "live"): PlanRequest => ({
  origin: places[0],
  destination: places[1],
  departure: "2026-09-21T07:40:00+08:00",
  arriveBy: "2026-09-21T08:45:00+08:00",
  preferences,
  scenario: dataMode === "demo" ? "disruption" : "normal",
  dataMode,
});
const state = (
  updatedAt: string,
  id: string,
  maxWalk = preferences.maxWalk,
): AccountState => ({
  preferences: { ...preferences, maxWalk },
  hardPreferences: { maxWalk },
  commutes: [
    {
      id,
      label: `Commute ${id}`,
      request: { ...request(), preferences: { ...preferences, maxWalk } },
      hardPreferences: { maxWalk },
      timeSensitive: "08:45",
      savedAt: updatedAt,
    },
  ],
  largeText: false,
  updatedAt,
});

describe("Google account state", () => {
  it("merges guest commutes without replacing newer account preferences", () => {
    const stored = state("2026-09-19T08:00:00.000Z", "work", 1200);
    const guest = state("2026-09-18T08:00:00.000Z", "school", 2200);
    const merged = mergeAccountStates(stored, guest);

    expect(merged.preferences.maxWalk).toBe(1200);
    expect(merged.commutes.map((commute) => commute.id)).toEqual([
      "work",
      "school",
    ]);
  });

  it("does not let untouched guest defaults overwrite a synced account", () => {
    const stored = state("2026-09-19T08:00:00.000Z", "work", 1200);
    const untouchedGuest: AccountState = {
      preferences: { ...preferences, maxWalk: 2200 },
      hardPreferences: {},
      commutes: [],
      largeText: false,
      updatedAt: "2026-09-20T08:00:00.000Z",
    };

    const merged = mergeAccountStates(stored, untouchedGuest);

    expect(merged.preferences.maxWalk).toBe(1200);
    expect(merged.commutes.map((commute) => commute.id)).toEqual(["work"]);
  });

  it("rejects tampered and expired account sessions", () => {
    const secret = "s".repeat(32);
    const token = createSessionToken(
      { subject: "google-subject", name: "Rachel", email: "r@example.com" },
      secret,
      1_000,
    );

    expect(readSessionToken(token, secret, 2_000)?.email).toBe("r@example.com");
    expect(readSessionToken(`${token}x`, secret, 2_000)).toBeNull();
    expect(
      readSessionToken(token, secret, 31 * 24 * 60 * 60 * 1000),
    ).toBeNull();
  });

  it("keeps simulated weather and demo commutes out of live account data", () => {
    expect(
      planSchema.safeParse({
        ...request(),
        demoWeather: { kind: "storm", rainfallMm: 10, temperature: 29 },
      }).success,
    ).toBe(false);
    expect(
      planSchema.safeParse({
        ...request("demo"),
        demoWeather: { kind: "storm", rainfallMm: 10, temperature: 29 },
      }).success,
    ).toBe(true);
    expect(
      accountStateSchema.safeParse({
        ...state("2026-09-19T08:00:00.000Z", "demo"),
        commutes: [
          {
            ...state("2026-09-19T08:00:00.000Z", "demo").commutes[0],
            request: request("demo"),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
