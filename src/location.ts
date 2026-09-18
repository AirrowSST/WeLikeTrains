import type { Coord, Place } from "../shared/types";

export type LocationSource = "device" | "demo";

export interface LocationFix {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
  source: LocationSource;
}

const SINGAPORE_BOUNDS = {
  minLat: 1.2,
  maxLat: 1.48,
  minLon: 103.6,
  maxLon: 104.1,
};

export function isSupportedLocation(fix: Pick<LocationFix, "lat" | "lon">) {
  return (
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    fix.lat >= SINGAPORE_BOUNDS.minLat &&
    fix.lat <= SINGAPORE_BOUNDS.maxLat &&
    fix.lon >= SINGAPORE_BOUNDS.minLon &&
    fix.lon <= SINGAPORE_BOUNDS.maxLon
  );
}

export function deviceLocationFix(position: GeolocationPosition): LocationFix {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: Math.max(0, position.coords.accuracy),
    timestamp: position.timestamp,
    source: "device",
  };
}

export function demoLocationFix(origin: Place, timestamp = Date.now()): LocationFix {
  return {
    // A small, deterministic offset makes the simulation visible without
    // pretending that the profile's saved place is a device reading.
    lat: Number(
      Math.min(SINGAPORE_BOUNDS.maxLat, origin.lat + 0.00045).toFixed(6),
    ),
    lon: Number(
      Math.max(SINGAPORE_BOUNDS.minLon, origin.lon - 0.0004).toFixed(6),
    ),
    accuracy: 12,
    timestamp,
    source: "demo",
  };
}

export function demoJourneyFix(
  segments: { geometry: Coord[] }[],
  completedSteps: number,
  timestamp = Date.now(),
): LocationFix | null {
  const first = segments[0]?.geometry[0];
  const completed = segments[Math.min(completedSteps, segments.length) - 1];
  const coord = completed?.geometry.at(-1) ?? first;
  if (!coord) return null;
  return {
    lat: coord[0],
    lon: coord[1],
    accuracy: 8,
    timestamp,
    source: "demo",
  };
}

export function locationPlace(fix: LocationFix): Place {
  const simulated = fix.source === "demo";
  return {
    id: simulated ? "demo-current-location" : "device-current-location",
    name: simulated ? "Simulated current location" : "Current location",
    subtitle: simulated
      ? "Demo position · not your device location"
      : `Device location · accurate to about ${Math.round(fix.accuracy)} m`,
    lat: fix.lat,
    lon: fix.lon,
  };
}

export function locationErrorMessage(error: Pick<GeolocationPositionError, "code">) {
  if (error.code === 1)
    return "Location permission was not granted. You can enable it in your browser settings or choose an origin manually.";
  if (error.code === 2)
    return "Your device could not determine its location. Try again outdoors or choose an origin manually.";
  if (error.code === 3)
    return "Finding your location took too long. Try again or choose an origin manually.";
  return "Your location is unavailable. Choose an origin manually.";
}
