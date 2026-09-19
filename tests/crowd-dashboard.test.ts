import { describe, expect, it } from "vitest";
import {
  calculateRewardFlow,
  stationsForCrowdLine,
} from "../shared/crowd-dashboard";
import type { TransitStop } from "../shared/types";

const stop = (
  name: string,
  codes: string[],
  mode: TransitStop["mode"] = "rail",
): TransitStop => ({
  id: name,
  name,
  mode,
  codes,
  lines: [],
  lat: 1.3,
  lon: 103.8,
});

describe("crowd dashboard", () => {
  it("keeps selected line stations in public code order", () => {
    const stations = stationsForCrowdLine(
      [
        stop("Ten", ["EW10"]),
        stop("Bus", ["01019"], "bus"),
        stop("Branch", ["CG2"]),
        stop("Two", ["EW2", "DT32"]),
      ],
      "EWL",
    );
    expect(stations.map((station) => station.name)).toEqual(["Two", "Ten"]);
    expect(
      stationsForCrowdLine(
        [stop("Expo", ["CG1", "DT35"]), stop("Tanah Merah", ["CG0", "EW4"])],
        "CGL",
      ).map((station) => station.name),
    ).toEqual(["Tanah Merah", "Expo"]);
  });

  it("uses the current quieter-route rule without inventing an uptake model", () => {
    expect(
      calculateRewardFlow({
        sourceCrowd: "high",
        alternativeCrowd: "moderate",
        eligibleTrips: 250,
        assumedUptakePercent: 12,
      }),
    ).toMatchObject({
      canRedirect: true,
      shiftedTrips: 30,
      remainingTrips: 220,
      rewardPoints: 600,
      quieterRouteBonus: 20,
    });
  });

  it("does not treat unknown or equal crowd levels as an improvement", () => {
    expect(
      calculateRewardFlow({
        sourceCrowd: "unknown",
        alternativeCrowd: "low",
        eligibleTrips: 100,
        assumedUptakePercent: 30,
      }).shiftedTrips,
    ).toBe(0);
    expect(
      calculateRewardFlow({
        sourceCrowd: "moderate",
        alternativeCrowd: "moderate",
        eligibleTrips: 100,
        assumedUptakePercent: 30,
      }).shiftedTrips,
    ).toBe(0);
  });
});
