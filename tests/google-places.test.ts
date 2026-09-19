import { describe, expect, it } from "vitest";
import {
  googleDetailsToPlace,
  googleSelectionToPlace,
} from "../src/google-places";

describe("Google Places UI selection", () => {
  it("turns a Singapore selection into the existing local routing contract", () => {
    expect(
      googleSelectionToPlace(
        {
          id: "ChIJ-test",
          location: { lat: () => 1.29027, lng: () => 103.851959 },
        },
        "National Gallery Singapore",
      ),
    ).toEqual({
      id: "google:ChIJ-test",
      name: "National Gallery Singapore",
      subtitle: "Google Maps · online result",
      lat: 1.29027,
      lon: 103.851959,
    });
  });

  it("rejects incomplete or out-of-Singapore selections", () => {
    expect(
      googleSelectionToPlace(
        { id: "outside", location: { lat: 51.5, lng: -0.1 } },
        "London",
      ),
    ).toBeNull();
    expect(googleSelectionToPlace({ id: "missing" }, "Unknown")).toBeNull();
  });

  it("retains coordinates exposed through Google Place accessors", () => {
    class WidgetPlace {
      get id() {
        return "ChIJ-widget";
      }

      get displayName() {
        return "Raffles Place MRT Station";
      }

      get formattedAddress() {
        return "Raffles Place, Singapore";
      }

      get location() {
        return { lat: () => 1.2842263, lng: () => 103.8497683 };
      }
    }

    expect(
      googleDetailsToPlace(
        new WidgetPlace(),
        "fallback-id",
        "Raffles Place",
      ),
    ).toEqual({
      id: "google:ChIJ-widget",
      name: "Raffles Place MRT Station",
      subtitle: "Raffles Place, Singapore · Google Maps",
      lat: 1.2842263,
      lon: 103.8497683,
    });
  });
});
