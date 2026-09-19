import type { Place } from "../shared/types";

type LatLngLike =
  | { lat: number; lng: number }
  | { lat: () => number; lng: () => number };

export interface GooglePlaceSelection {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  location?: LatLngLike;
}

export interface BasicPlaceAutocompleteElement extends HTMLElement {
  placeholder: string;
  includedRegionCodes: string[];
  requestedLanguage: string;
  requestedRegion: string;
  value?: string;
}

export interface PlaceDetailsCompactElement extends HTMLElement {
  place?: GooglePlaceSelection;
}

export interface PlaceDetailsPlaceRequestElement extends HTMLElement {
  place?: GooglePlaceSelection | string;
}

interface PlacesUiLibrary {
  BasicPlaceAutocompleteElement: new () => BasicPlaceAutocompleteElement;
}

declare global {
  interface Window {
    wayceGoogleMapsReady?: () => void;
  }
}

type GoogleMapsWindow = Window & {
  google?: {
    maps?: {
      importLibrary?: (name: string) => Promise<unknown>;
    };
  };
};

const mapsApi = () => (window as GoogleMapsWindow).google?.maps;

let placesLibrary: Promise<PlacesUiLibrary> | undefined;

export function loadGooglePlacesUi(apiKey: string): Promise<PlacesUiLibrary> {
  if (placesLibrary) return placesLibrary;
  placesLibrary = new Promise<void>((resolve, reject) => {
    const ready = () => {
      delete window.wayceGoogleMapsReady;
      resolve();
    };
    if (mapsApi()?.importLibrary) {
      ready();
      return;
    }
    window.wayceGoogleMapsReady = ready;
    const script = document.createElement("script");
    script.id = "wayce-google-places-ui";
    script.async = true;
    script.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({
        key: apiKey,
        v: "weekly",
        loading: "async",
        auth_referrer_policy: "origin",
        callback: "wayceGoogleMapsReady",
      });
    script.onerror = () => {
      delete window.wayceGoogleMapsReady;
      script.remove();
      placesLibrary = undefined;
      reject(new Error("Google Places UI could not be loaded"));
    };
    document.head.append(script);
  })
    .then(async () => {
      const imported = await mapsApi()?.importLibrary?.("places");
      const library = imported as Partial<PlacesUiLibrary> | undefined;
      if (!library?.BasicPlaceAutocompleteElement)
        throw new Error("Google Places UI Kit is unavailable");
      return library as PlacesUiLibrary;
    })
    .catch((reason) => {
      placesLibrary = undefined;
      throw reason;
    });
  return placesLibrary;
}

const coordinate = (value: number | (() => number)) =>
  typeof value === "function" ? value() : value;

export function googleSelectionToPlace(
  selection: GooglePlaceSelection,
  typedLabel: string,
): Place | null {
  if (!selection.id || !selection.location) return null;
  const lat = coordinate(selection.location.lat);
  const lon = coordinate(selection.location.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < 1.2 ||
    lat > 1.48 ||
    lon < 103.6 ||
    lon > 104.1
  )
    return null;
  const name = (selection.displayName || typedLabel || "Selected place")
    .trim()
    .slice(0, 200);
  return {
    id: `google:${selection.id}`.slice(0, 200),
    name,
    subtitle: (selection.formattedAddress || "Google Places · online result").slice(
      0,
      300,
    ),
    lat,
    lon,
  };
}
