export type Coord = [number, number]; // latitude, longitude; OSM WGS84
export type Crowd = "low" | "moderate" | "high" | "unknown";
export type Mode = "walk" | "rail" | "bus" | "cycle";
export type SurfaceStatus = "valid" | "limited" | "invalid";
export type SegmentIssue =
  | "shelter"
  | "rain"
  | "heat"
  | "flood"
  | "road-closure"
  | "accident"
  | "congestion"
  | "crowd"
  | "disruption"
  | "bridging-bus";
export type Scenario =
  "normal" | "disruption" | "rain" | "crowded" | "maintenance" | "closure";
export type Persona = "rachel" | "arjun" | "lim";
export type DemoWeatherKind = "clear" | "showers" | "storm" | "heat";
export interface Place {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
}
export interface Preferences {
  stepFree: boolean;
  sheltered: boolean;
  avoidCrowds: boolean;
  cycling: boolean;
  walkingSpeed: number;
  maxWalk: number;
  alertThreshold: number;
}
export interface Profile {
  id: Persona;
  name: string;
  label: string;
  description: string;
  origin: string;
  destination: string;
  departure: string;
  arriveBy: string;
  preferences: Preferences;
}
export interface PlanRequest {
  origin: Place;
  destination: Place;
  departure: string;
  arriveBy?: string;
  preferences: Preferences;
  scenario: Scenario;
  dataMode: "demo" | "live";
  demoWeather?: {
    kind: DemoWeatherKind;
    rainfallMm: number;
    temperature: number;
  };
}
export interface SavedCommute {
  id: string;
  label: string;
  request: PlanRequest;
  hardPreferences: Partial<Preferences>;
  timeSensitive: string;
  inferred?: boolean;
  savedAt: string;
}
export interface AccountState {
  preferences: Preferences;
  hardPreferences: Partial<Preferences>;
  commutes: SavedCommute[];
  largeText: boolean;
  updatedAt: string;
}
export interface AccountUser {
  name: string;
  email: string;
  picture?: string;
}
export interface Segment {
  id: string;
  mode: Mode;
  line: string;
  direction?: string;
  from: string;
  to: string;
  minutes: number;
  distance: number;
  geometry: Coord[];
  stops: string[];
  crowd: Crowd;
  affected: boolean;
  delay: number;
  sheltered: boolean;
  accessibility: "verified" | "unknown";
  instructions: string;
  source: string;
  waitMinutes?: number;
  hops?: { from: string; to: string; codes: string[]; geometry: Coord[] }[];
  affectedGeometry?: Coord[][];
  issues?: SegmentIssue[];
}
export interface Journey {
  id: string;
  title: string;
  segments: Segment[];
  duration: number;
  baselineDuration: number;
  range: [number, number];
  arrival: string;
  distance: number;
  walkMinutes: number;
  transfers: number;
  crowd: Crowd;
  score: number;
  reasons: string[];
  warnings: string[];
  source: string;
  blocked: boolean;
}
export interface Notice {
  id: string;
  title: string;
  description: string;
  line?: string;
  stations: string[];
  stationNames?: string[];
  severity: "info" | "warning" | "critical";
  kind:
    | "disruption"
    | "planned"
    | "lift"
    | "weather"
    | "crowd"
    | "advisory"
    | "flood"
    | "traffic"
    | "bridging";
  startsAt: string;
  endsAt?: string;
  delayMinutes: number;
  freeBus?: string;
  shuttle?: string;
  direction?: string;
  location?: Coord;
  roadName?: string;
  source: string;
}
export interface TrafficReading {
  id: string;
  kind: "incident" | "congestion" | "expressway" | "road-closure";
  severity: "moderate" | "high" | "critical";
  description: string;
  roadName?: string;
  location?: Coord;
  delayMinutes: number;
  source: string;
}
export interface FeedStatus {
  name: string;
  status: "live" | "local" | "demo" | "stale" | "unavailable";
  updatedAt?: string;
  detail: string;
}
export interface CrowdReading {
  station: string;
  line: string;
  level: Crowd;
  start: string;
  end: string;
  forecast: boolean;
}
export interface BusArrival {
  service: string;
  stop: string;
  eta: string;
  load: Crowd;
  wheelchair: boolean;
  type: string;
}
export interface Conditions {
  notices: Notice[];
  crowd: CrowdReading[];
  buses: BusArrival[];
  weather: {
    forecast: string;
    rain: boolean;
    rainfallMm?: number;
    temperature?: number;
    walkStatus: SurfaceStatus;
    cycleStatus: SurfaceStatus;
  };
  traffic: TrafficReading[];
  feeds: FeedStatus[];
  updatedAt: string;
  mode: "demo" | "live";
}
export interface Risk {
  level: "low" | "moderate" | "high";
  score: number;
  factors: string[];
  model: string;
  disclaimer: string;
}
export interface PlanResponse {
  request: PlanRequest;
  recommended: Journey;
  original: Journey;
  alternatives: Journey[];
  travelDecision: "travel" | "wait";
  conditions: Conditions;
  risk: Risk;
  advice: string;
  generatedAt: string;
  expiresAt: string;
}
export interface ChatResponse {
  message: string;
  provider: "vertex" | "local";
  preferences?: Partial<Preferences>;
  recommendedRouteId?: string;
  displayedRouteIds?: string[];
}
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
