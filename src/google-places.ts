import type { Place } from "../shared/types";

type LatLngLike =
  | { lat: number; lng: number }
  | { lat: () => number; lng: () => number };

export interface GooglePlaceSelection {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  location?: LatLngLike;
  fetchFields?: (request: { fields: string[] }) => Promise<void>;
}

interface GoogleFormattableText {
  text: string;
}

interface GooglePlacePrediction {
  placeId: string;
  mainText?: GoogleFormattableText;
  secondaryText?: GoogleFormattableText;
  text: GoogleFormattableText;
  toPlace: () => GooglePlaceSelection;
}

interface GoogleAutocompleteSuggestion {
  placePrediction?: GooglePlacePrediction;
}

export interface GooglePlaceSuggestion {
  id: string;
  name: string;
  subtitle: string;
  prediction: GooglePlacePrediction;
}

export interface GooglePlaceSearchSession {
  suggest: (input: string) => Promise<GooglePlaceSuggestion[]>;
  resolve: (suggestion: GooglePlaceSuggestion) => Promise<Place | null>;
}

interface PlacesDataLibrary {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      includedRegionCodes: string[];
      language: string;
      locationRestriction: {
        west: number;
        north: number;
        east: number;
        south: number;
      };
      region: string;
      sessionToken: unknown;
    }) => Promise<{ suggestions: GoogleAutocompleteSuggestion[] }>;
  };
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

let placesLibrary: Promise<PlacesDataLibrary> | undefined;

export function loadGooglePlacesData(
  apiKey: string,
): Promise<PlacesDataLibrary> {
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
    script.id = "wayce-google-places-data";
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
      reject(new Error("Google Places data API could not be loaded"));
    };
    document.head.append(script);
  })
    .then(async () => {
      const imported = await mapsApi()?.importLibrary?.("places");
      const library = imported as Partial<PlacesDataLibrary> | undefined;
      if (
        !library?.AutocompleteSessionToken ||
        !library.AutocompleteSuggestion?.fetchAutocompleteSuggestions
      )
        throw new Error("Google Place Autocomplete Data API is unavailable");
      return library as PlacesDataLibrary;
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
  const formattedAddress = selection.formattedAddress?.trim();
  return {
    id: `google:${selection.id}`.slice(0, 200),
    name,
    subtitle: (
      formattedAddress
        ? `${formattedAddress} · Google Maps`
        : "Google Maps · online result"
    ).slice(0, 300),
    lat,
    lon,
  };
}

export function googleDetailsToPlace(
  selection: GooglePlaceSelection,
  fallbackId: string,
  typedLabel: string,
): Place | null {
  // Google Place fields can be prototype accessors. Read each field explicitly;
  // spreading the object drops those accessors, including `location`.
  return googleSelectionToPlace(
    {
      id: selection.id || fallbackId,
      displayName: selection.displayName,
      formattedAddress: selection.formattedAddress,
      location: selection.location,
    },
    typedLabel,
  );
}

const predictionText = (value?: GoogleFormattableText) =>
  value?.text?.trim() || "";

export async function createGooglePlaceSearchSession(
  apiKey: string,
): Promise<GooglePlaceSearchSession> {
  const library = await loadGooglePlacesData(apiKey);
  const sessionToken = new library.AutocompleteSessionToken();
  return {
    async suggest(input) {
      const query = input.trim();
      if (query.length < 2) return [];
      const { suggestions } =
        await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          includedRegionCodes: ["sg"],
          language: "en",
          locationRestriction: {
            west: 103.6,
            north: 1.48,
            east: 104.1,
            south: 1.2,
          },
          region: "sg",
          sessionToken,
        });
      return suggestions.flatMap((suggestion) => {
        const prediction = suggestion.placePrediction;
        if (!prediction?.placeId) return [];
        const name =
          predictionText(prediction.mainText) || predictionText(prediction.text);
        if (!name) return [];
        return [
          {
            id: prediction.placeId,
            name,
            subtitle: predictionText(prediction.secondaryText),
            prediction,
          },
        ];
      });
    },
    async resolve(suggestion) {
      const selected = suggestion.prediction.toPlace();
      if (!selected.fetchFields) return null;
      await selected.fetchFields({
        fields: ["displayName", "formattedAddress", "location"],
      });
      return googleDetailsToPlace(selected, suggestion.id, suggestion.name);
    },
  };
}
