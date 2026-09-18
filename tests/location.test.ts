import { describe, expect, it } from "vitest";
import {
  demoJourneyFix,
  demoLocationFix,
  isSupportedLocation,
  locationErrorMessage,
  locationPlace,
} from "../src/location";

const origin = {
  id: "tampines-home",
  name: "Tampines Central",
  subtitle: "Our Tampines Hub",
  lat: 1.35285,
  lon: 103.9405,
};

describe("location helpers", () => {
  it("creates a deterministic and explicitly simulated demo location", () => {
    const fix = demoLocationFix(origin, 1234);
    expect(fix).toEqual({
      lat: 1.3533,
      lon: 103.9401,
      accuracy: 12,
      timestamp: 1234,
      source: "demo",
    });
    expect(locationPlace(fix)).toMatchObject({
      id: "demo-current-location",
      name: "Simulated current location",
      subtitle: "Demo position · not your device location",
    });
  });

  it("moves a simulated journey fix to the end of each completed step", () => {
    const segments = [
      { geometry: [[1.3, 103.8], [1.31, 103.81]] as [number, number][] },
      { geometry: [[1.31, 103.81], [1.32, 103.82]] as [number, number][] },
    ];
    expect(demoJourneyFix(segments, 0, 1)).toMatchObject({
      lat: 1.3,
      lon: 103.8,
      source: "demo",
    });
    expect(demoJourneyFix(segments, 2, 1)).toMatchObject({
      lat: 1.32,
      lon: 103.82,
    });
  });

  it("rejects device fixes outside the supported Singapore routing area", () => {
    expect(isSupportedLocation({ lat: 1.3521, lon: 103.8198 })).toBe(true);
    expect(isSupportedLocation({ lat: 51.5072, lon: -0.1276 })).toBe(false);
  });

  it("turns browser permission failures into actionable copy", () => {
    expect(locationErrorMessage({ code: 1 })).toContain(
      "Location permission was not granted",
    );
  });
});
