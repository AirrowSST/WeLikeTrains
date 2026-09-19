import { describe, expect, it } from "vitest";
import { googleSelectionToPlace } from "../src/google-places";

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
      subtitle: "Google Places · online result",
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
});
