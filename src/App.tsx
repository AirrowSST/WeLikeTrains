import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  Bike,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleUserRound,
  Clock3,
  CloudLightning,
  CloudRain,
  CloudSun,
  DoorOpen,
  Footprints,
  Gift,
  Heart,
  HelpCircle,
  House,
  Info,
  Leaf,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  Mic,
  Minus,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrainFront,
  TriangleAlert,
  Umbrella,
  UsersRound,
  Volume2,
  WifiOff,
  X,
  Accessibility,
  Bookmark,
  BusFront,
  Sun,
  Trash2,
} from "lucide-react";
import type {
  AccountState,
  AccountUser,
  ChatResponse,
  Journey,
  Persona,
  Place,
  PlanRequest,
  PlanResponse,
  Preferences,
  SavedCommute,
  Scenario,
  Segment,
} from "../shared/types";
import {
  lineColors,
  nextDeparture,
  places,
  profiles,
  sgTime,
} from "../shared/catalog";
import { meetsDelayAlertThreshold } from "../shared/alerts";
import { crowdDescription } from "../shared/crowding";
import { stationColor, stationTextColor } from "../shared/transit-details";
import {
  shelterMode as effectiveShelterMode,
  shelterSummary,
} from "../shared/shelter";
import {
  timelineDefinition,
  timelineTime,
  type TimelineId,
} from "../shared/timelines";
import { TimelineControls } from "./TimelineControls";
import Rewards from "./Rewards";
import TransitArrivals from "./TransitArrivals";
import {
  creditJourney,
  journeyPoints,
  pointsBalance,
  pointsJourneyId,
  readPointsWallet,
  redeemReward,
  type PointsEntry,
  type PointsWallet,
} from "../shared/rewards";
import JourneyMap from "./Map";
import { useJourneySheet } from "./useJourneySheet";
import GoogleSignIn, { disableGoogleAutoSelect } from "./GoogleSignIn";
import {
  createGooglePlaceSearchSession,
  type GooglePlaceSearchSession,
  type GooglePlaceSuggestion,
} from "./google-places";
import {
  demoJourneyFix,
  demoLocationFix,
  deviceLocationFix,
  isSupportedLocation,
  locationErrorMessage,
  locationPlace,
  type LocationFix,
} from "./location";

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
}
interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};
const getSpeechRecognition = () => {
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
};

type Tab = "today" | "commutes" | "updates" | "rewards";
type ModalName =
  | "profile"
  | "preferences"
  | "demo"
  | "chat"
  | "sources"
  | "journey"
  | "help"
  | "proactive"
  | "alerts"
  | "weather"
  | "route-warning"
  | null;
interface LegacySaved {
  profile: "profile-1";
  preferences: Preferences;
  request: PlanRequest;
  hardPreferences?: Partial<Preferences>;
  timeSensitive: string;
  inferred?: boolean;
  savedAt: string;
}
interface Activity {
  originId: string;
  destinationId: string;
  timeBand: string;
  weekday: string;
  date: string;
}
type WeatherSnapshot = Pick<
  PlanResponse["conditions"],
  "weather" | "feeds" | "updatedAt"
>;
const PROFILE_KEY = "wlt-profile-v1",
  GUEST_KEY = "wlt-guest-v2",
  PLAN_KEY = "wlt-journey-v1",
  ACTIVITY_KEY = "wlt-activity-v1",
  COMPANION_CONSENT_KEY = "wlt-companion-consent-v1",
  DEVELOPER_KEY = "wlt-developer-mode",
  ONBOARDING_KEY = "wlt-onboarding-v1";
const POINTS_KEY = "wlt-points-v1:";
const UNSET_ORIGIN: Place = {
  id: "origin-unset",
  name: "",
  subtitle: "Location turns on automatically",
  lat: 0,
  lon: 0,
};
const UNSET_DESTINATION: Place = {
  id: "destination-unset",
  name: "",
  subtitle: "Search indexed stations, bus stops, or landmarks",
  lat: 0,
  lon: 0,
};
const isPlannable = (request: PlanRequest) =>
  request.origin.id !== UNSET_ORIGIN.id &&
  request.destination.id !== UNSET_DESTINATION.id;
function readSaved<T>(key: string): T | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!v) return null;
    const at = v.savedAt ?? v.generatedAt;
    if (at && Date.now() - Date.parse(at) > 30 * 86400000) {
      localStorage.removeItem(key);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be full or disabled */
  }
}
function readLocal<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function dateValue(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
function TimeScrollPicker({
  label,
  value,
  onChange,
  isNow = false,
  onNow,
}: {
  label: "Leave" | "Arrive";
  value?: string;
  onChange: (value: string) => void;
  isNow?: boolean;
  onNow?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState(0);
  const defaultTime = sgTime(new Date(Date.now() + 60 * 60 * 1000));
  const [hourText = "09", minuteText = "00"] = (value ?? defaultTime).split(
    ":",
  );
  const hour24 = Number(hourText);
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  const displayTime = `${String(hour12).padStart(2, "0")}:${minuteText} ${period}`;
  const draftHour24 = Math.floor(draftMinutes / 60);
  const draftHour12 = draftHour24 % 12 || 12;
  const draftMinute = draftMinutes % 60;
  const draftPeriod = draftHour24 >= 12 ? "PM" : "AM";
  const draftDisplayTime = `${String(draftHour12).padStart(2, "0")}:${String(draftMinute).padStart(2, "0")} ${draftPeriod}`;
  const openPicker = () => {
    const current = new Date();
    const currentMinutes =
      Number(sgTime(current).slice(0, 2)) * 60 +
      Number(sgTime(current).slice(3, 5));
    setDraftMinutes(isNow ? currentMinutes : hour24 * 60 + Number(minuteText));
    setOpen(true);
  };
  const adjustTime = (amount: number) =>
    setDraftMinutes((current) => (current + amount + 1440) % 1440);
  const setPeriod = (nextPeriod: "AM" | "PM") => {
    setDraftMinutes((current) => {
      const currentHour = Math.floor(current / 60);
      const minute = current % 60;
      const nextHour =
        nextPeriod === "AM"
          ? currentHour >= 12
            ? currentHour - 12
            : currentHour
          : currentHour < 12
            ? currentHour + 12
            : currentHour;
      return nextHour * 60 + minute;
    });
  };
  const applyTime = () => {
    onChange(
      `${String(draftHour24).padStart(2, "0")}:${String(draftMinute).padStart(2, "0")}`,
    );
    setOpen(false);
  };

  return (
    <div className="time-picker-control">
      <button
        type="button"
        className="time-picker-card"
        aria-label={`${label.toLowerCase()} time`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPicker}
      >
        <span className="time-picker-heading">
          <Clock3 size={18} />
          <strong className="time-label">{label}</strong>
        </span>
        <span className="time-picker-value">
          {isNow ? "Now" : value ? displayTime : "Any time"}{" "}
          <ChevronDown size={17} />
        </span>
      </button>
      {open && (
        <Modal
          title={`Choose ${label.toLowerCase()} time`}
          onClose={() => setOpen(false)}
          className="time-picker-modal"
        >
          <div className="modal-body time-picker-panel">
            <div className="time-picker-preview" aria-live="polite">
              <Clock3 size={22} />
              <span>
                <small>{label}</small>
                <strong>{draftDisplayTime}</strong>
              </span>
            </div>
            <div className="time-adjusters">
              <div className="time-adjuster" role="group" aria-label="Hour">
                <span>Hour</span>
                <button
                  type="button"
                  onClick={() => adjustTime(60)}
                  aria-label="Add one hour"
                >
                  <Plus size={20} />
                </button>
                <output aria-label={`${draftHour12} hours`}>
                  {String(draftHour12).padStart(2, "0")}
                </output>
                <button
                  type="button"
                  onClick={() => adjustTime(-60)}
                  aria-label="Subtract one hour"
                >
                  <Minus size={20} />
                </button>
              </div>
              <span className="time-adjuster-colon" aria-hidden="true">
                :
              </span>
              <div className="time-adjuster" role="group" aria-label="Minute">
                <span>Minute</span>
                <button
                  type="button"
                  onClick={() => adjustTime(5)}
                  aria-label="Add five minutes"
                >
                  <Plus size={20} />
                </button>
                <output aria-label={`${draftMinute} minutes`}>
                  {String(draftMinute).padStart(2, "0")}
                </output>
                <button
                  type="button"
                  onClick={() => adjustTime(-5)}
                  aria-label="Subtract five minutes"
                >
                  <Minus size={20} />
                </button>
              </div>
            </div>
            <div
              className="time-period-toggle"
              role="group"
              aria-label="Time period"
            >
              {(["AM", "PM"] as const).map((option) => (
                <button
                  type="button"
                  className={draftPeriod === option ? "active" : ""}
                  aria-pressed={draftPeriod === option}
                  onClick={() => setPeriod(option)}
                  key={option}
                >
                  {option}
                </button>
              ))}
            </div>
            {label === "Leave" && onNow && (
              <button
                type="button"
                className="secondary-button full"
                onClick={() => {
                  onNow();
                  setOpen(false);
                }}
              >
                Leave now
              </button>
            )}
            <div className="time-picker-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={applyTime}
              >
                Set {label.toLowerCase()} time
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TimelineTimeCard({ value }: { value: string }) {
  const [hourText = "00", minuteText = "00"] = sgTime(value).split(":");
  const hour24 = Number(hourText);
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  const displayHour = String(hour12).padStart(2, "0");

  return (
    <div
      className="time-control demo-time-card"
      role="group"
      aria-label={`Simulated leave time ${displayHour}:${minuteText} ${period}`}
    >
      <span className="demo-time-heading">
        <Clock3 size={18} aria-hidden="true" />
        <strong>Leave</strong>
        <span>Simulated</span>
      </span>
      <strong className="demo-time-value">
        {displayHour}:{minuteText}
        <small>{period}</small>
      </strong>
      <span className="demo-time-helper">
        <Radio size={13} aria-hidden="true" /> Timeline controlled
      </span>
    </div>
  );
}

function makeRequest(
  persona: Persona = "rachel",
  dataMode: "demo" | "live" = "live",
  scenario: Scenario = "normal",
  demoWeather?: PlanRequest["demoWeather"],
): PlanRequest {
  const p = profiles.find((x) => x.id === persona)!;
  const departure = nextDeparture(p.departure);
  return {
    origin: places.find((x) => x.id === p.origin)!,
    destination: places.find((x) => x.id === p.destination)!,
    departure,
    arriveBy: `${dateValue(departure)}T${p.arriveBy}:00+08:00`,
    preferences: p.preferences,
    dataMode,
    scenario,
    ...(dataMode === "demo" && demoWeather ? { demoWeather } : {}),
  };
}
function makeStartRequest(preferences: Preferences): PlanRequest {
  return {
    ...makeRequest("rachel", "live", "normal"),
    origin: UNSET_ORIGIN,
    destination: UNSET_DESTINATION,
    departure: new Date().toISOString(),
    arriveBy: undefined,
    preferences,
  };
}
function liveRequest(request: PlanRequest): PlanRequest {
  const { demoWeather: _demoWeather, timeline: _timeline, ...rest } = request;
  return { ...rest, dataMode: "live", scenario: "normal" };
}
function commuteId(request: PlanRequest) {
  return `${request.origin.id}:${request.destination.id}:${sgTime(
    request.arriveBy ?? request.departure,
  )}`;
}
function savedCommute(
  request: PlanRequest,
  hardPreferences: Partial<Preferences>,
  inferred = false,
): SavedCommute {
  const live = liveRequest(request);
  return {
    id: commuteId(live),
    label: `${live.origin.name} to ${live.destination.name}`,
    request: live,
    hardPreferences,
    timeSensitive: sgTime(live.arriveBy ?? live.departure),
    inferred,
    savedAt: new Date().toISOString(),
  };
}
function initialGuestState(): AccountState {
  const stored = readLocal<AccountState>(GUEST_KEY);
  if (stored?.preferences && Array.isArray(stored.commutes)) return stored;
  const legacy = readSaved<LegacySaved>(PROFILE_KEY);
  const request = legacy?.request
    ? liveRequest(legacy.request)
    : makeRequest("rachel", "live", "normal");
  const migrated = legacy
    ? [savedCommute(request, legacy.hardPreferences ?? {}, !!legacy.inferred)]
    : [];
  return {
    preferences: legacy?.preferences ?? request.preferences,
    hardPreferences: legacy?.hardPreferences ?? {},
    commutes: migrated,
    largeText: localStorage.getItem("wlt-large-text") === "true",
    updatedAt: legacy?.savedAt ?? new Date().toISOString(),
  };
}
const ModeIcon = ({ mode, size = 17 }: { mode: string; size?: number }) =>
  mode === "walk" ? (
    <Footprints size={size} />
  ) : mode === "bus" ? (
    <BusFront size={size} />
  ) : mode === "cycle" ? (
    <Bike size={size} />
  ) : (
    <TrainFront size={size} />
  );
function WeatherStatusIcon({
  forecast,
  rain,
}: {
  forecast: string;
  rain: boolean;
}) {
  const normalized = forecast.toLowerCase();
  if (/thunder|lightning/.test(normalized))
    return <CloudLightning size={20} aria-hidden="true" />;
  if (rain || /rain|showers/.test(normalized))
    return <CloudRain size={20} aria-hidden="true" />;
  if (/fair|clear|sunny/.test(normalized))
    return <Sun size={20} aria-hidden="true" />;
  return <CloudSun size={20} aria-hidden="true" />;
}
function LinePill({ segment }: { segment: Segment }) {
  return (
    <span
      className="line-pill"
      style={
        {
          "--line-color": lineColors[segment.line] ?? lineColors[segment.mode],
        } as React.CSSProperties
      }
    >
      <ModeIcon mode={segment.mode} size={13} />
      {segment.mode === "walk"
        ? `${Math.ceil(segment.minutes)} min`
        : segment.line === "cycle"
          ? "Cycle"
          : segment.line}
    </span>
  );
}

function busActionLabel(segment: Segment, previous?: Segment) {
  return previous?.mode === "bus" || previous?.mode === "rail"
    ? `Transfer to Bus ${segment.line}`
    : `Board Bus ${segment.line}`;
}

function precedingTransitSegment(segments: Segment[], index: number) {
  for (let current = index - 1; current >= 0; current -= 1) {
    const segment = segments[current];
    if (segment.mode === "bus" || segment.mode === "rail") return segment;
  }
  return undefined;
}

function BusStopLabels({
  segment,
  previous,
}: {
  segment: Segment;
  previous?: Segment;
}) {
  return (
    <div className="bus-stop-labels" aria-label={`Bus ${segment.line} stops`}>
      <p>
        <strong>{busActionLabel(segment, previous)}</strong> at {segment.from}
      </p>
      <p>
        <strong>Alight Bus {segment.line}</strong> at {segment.to}
      </p>
    </div>
  );
}

const stationCodePattern =
  /^(?:EW|CG|NS|NE|CC|CE|DT|TE|BP|PE|PW|SW|SE)\d+$/i;

function stationCodes(codes: string[] | undefined) {
  return Array.from(
    new Set((codes ?? []).filter((code) => stationCodePattern.test(code))),
  ).join("/");
}

function instructionEta(segments: Segment[], index: number, departure: string) {
  const elapsedMinutes = segments
    .slice(0, index + 1)
    .reduce(
      (total, segment) =>
        total + segment.minutes + (segment.waitMinutes ?? 0),
      0,
    );
  return sgTime(new Date(Date.parse(departure) + elapsedMinutes * 60_000));
}

function railEndpointCodes(segment: Segment) {
  const firstHop = segment.hops?.[0];
  const lastHop = segment.hops?.at(-1);
  const fallbackFromCode = (firstHop?.codes ?? []).find((code) =>
    stationCodePattern.test(code),
  );
  const fallbackToCode = [...(lastHop?.codes ?? [])]
    .reverse()
    .find((code) => stationCodePattern.test(code));
  return {
    fromCode: stationCodes(firstHop?.fromCodes) || fallbackFromCode,
    toCode: stationCodes(lastHop?.toCodes) || fallbackToCode,
  };
}

function StationCodeBadges({ codes, line }: { codes?: string; line: string }) {
  if (!codes) return null;
  return (
    <span className="active-station-codes" aria-label={codes}>
      {codes.split("/").map((code, index) => {
        const colour = stationColor(code, [line]);
        return (
          <span key={code}>
            {index > 0 && <i aria-hidden="true">/</i>}
            <b
              style={{
                backgroundColor: colour,
                color: stationTextColor(colour),
              }}
            >
              {code}
            </b>
          </span>
        );
      })}
    </span>
  );
}

function RailDiagramStation({
  codes,
  line,
  fallback,
}: {
  codes?: string;
  line: string;
  fallback: string;
}) {
  const values = codes?.split("/").filter(Boolean) ?? [];
  if (!values.length) values.push(fallback);
  return (
    <span
      className={`transit-diagram-station ${values.length > 1 ? "interchange" : ""}`}
      aria-label={values.join(" interchange ")}
    >
      {values.map((code) => {
        const colour = stationColor(code, [line]);
        return (
          <b
            key={code}
            style={{
              backgroundColor: colour,
              color: stationTextColor(colour),
            }}
          >
            {code}
          </b>
        );
      })}
    </span>
  );
}

function TransitDiagramArrow() {
  return (
    <span className="transit-diagram-arrow" aria-hidden="true">
      <ArrowRight size={22} strokeWidth={2.8} />
    </span>
  );
}

function TransitInstructionDiagram({ segment }: { segment: Segment }) {
  if (segment.mode === "rail") {
    const { fromCode, toCode } = railEndpointCodes(segment);
    return (
      <span className="transit-instruction-diagram rail" aria-hidden="true">
        <RailDiagramStation
          codes={fromCode}
          line={segment.line}
          fallback={segment.from}
        />
        <TransitDiagramArrow />
        <RailDiagramStation
          codes={toCode}
          line={segment.line}
          fallback={segment.to}
        />
      </span>
    );
  }
  if (segment.mode === "bus") {
    const services = segment.line.replace(/\s*(?:\/|,|\|)\s*/g, " \\ ");
    return (
      <span className="transit-instruction-diagram bus" aria-hidden="true">
        <span className="transit-diagram-origin">{segment.from}</span>
        <TransitDiagramArrow />
        <span className="transit-diagram-destination">{segment.to}</span>
        <b className="transit-diagram-bus">{services}</b>
      </span>
    );
  }
  return null;
}

function RailActiveInstruction({
  segment,
  index,
  segments,
  departure,
}: {
  segment: Segment;
  index: number;
  segments: Segment[];
  departure: string;
}) {
  const { fromCode, toCode } = railEndpointCodes(segment);
  const direction =
    segment.direction ??
    segment.instructions.match(/towards ([^.]+)/i)?.[1] ??
    segment.to;
  return (
    <span>
      MRT: Board at {segment.from}{" "}
      <StationCodeBadges codes={fromCode} line={segment.line} /> to{" "}
      {segment.to} <StationCodeBadges codes={toCode} line={segment.line} /> in
      the direction of {direction} · ETA{" "}
      {instructionEta(segments, index, departure)}
    </span>
  );
}

function activeInstruction(
  segment: Segment,
  index: number,
  segments: Segment[],
  departure: string,
) {
  const eta = instructionEta(segments, index, departure);
  if (segment.mode === "bus")
    return `Bus ${segment.line} from ${segment.from} to ${segment.to} · ETA ${eta}`;
  if (segment.mode === "walk") {
    const action = /overhead bridge/i.test(segment.instructions)
      ? "across the overhead bridge"
      : `from ${segment.from} to ${segment.to}`;
    return `Walk ${action} · ${Math.round(segment.distance)} m · ${Math.ceil(segment.minutes)} min`;
  }
  return `${segment.mode}: ${segment.from} to ${segment.to} · ETA ${eta}`;
}

function CrowdBadge({ crowd }: { crowd: Journey["crowd"] }) {
  const labels: Record<Journey["crowd"], string> = {
    low: "Low crowd",
    moderate: "Moderate crowd",
    high: "High crowd",
    unknown: "Crowd unknown",
  };
  return (
    <span className={`crowd-badge ${crowd}`}>
      <UsersRound size={14} />
      {labels[crowd]}
    </span>
  );
}

function canStartWithWeatherWarning(journey: Journey, plan: PlanResponse) {
  const severeWeather =
    plan.conditions.weather.walkStatus === "invalid" ||
    plan.conditions.weather.cycleStatus === "invalid";
  const hasWeatherAffectedSection = journey.segments.some(
    (segment) =>
      segment.issues?.some((issue) => issue === "rain" || issue === "heat") ||
      (segment.mode === "cycle" &&
        plan.conditions.weather.cycleStatus === "invalid"),
  );
  const hasHardBlock = journey.segments.some(
    (segment) =>
      segment.unavailable ||
      segment.issues?.some(
        (issue) => issue === "flood" || issue === "road-closure",
      ),
  );
  return severeWeather && hasWeatherAffectedSection && !hasHardBlock;
}

function routeTransitNotices(journey: Journey, plan: PlanResponse) {
  const reasons = new Set(journey.reasons);
  return plan.conditions.notices.filter(
    (notice) =>
      ["disruption", "planned", "lift", "bridging"].includes(notice.kind) &&
      reasons.has(notice.title),
  );
}

function withoutSimulatedPrefix(value: string) {
  const clean = value.replace(/^SIMULATED\s*(?:[·:–—-]\s*)?/i, "").trim();
  return clean ? `${clean[0].toUpperCase()}${clean.slice(1)}` : value;
}

function RouteConditionWarnings({
  journey,
  plan,
  compact = false,
}: {
  journey: Journey;
  plan: PlanResponse;
  compact?: boolean;
}) {
  const transitNotices = routeTransitNotices(journey, plan);
  const simulated = plan.conditions.mode === "demo";
  const showWeather = canStartWithWeatherWarning(journey, plan);

  return (
    <div
      className={`route-condition-warnings ${compact ? "compact" : ""}`}
      aria-label="Current route warnings"
    >
      {showWeather && (
        <div className="route-condition-warning weather">
          <TriangleAlert size={compact ? 17 : 20} aria-hidden="true" />
          <span>
            <span className="route-condition-title">
              <strong>Severe weather warning</strong>
              {simulated && <em>Simulated</em>}
            </span>
            <span>
              Exposed sections remain affected. Check current conditions and
              official safety advice as you travel.
            </span>
          </span>
        </div>
      )}
      {transitNotices.map((notice) => (
        <div
          className="route-condition-warning disruption"
          data-notice-id={notice.id}
          key={notice.id}
        >
          <TrainFront size={compact ? 17 : 20} aria-hidden="true" />
          <span>
            <span className="route-condition-title">
              <strong>{withoutSimulatedPrefix(notice.title)}</strong>
              {simulated && <em>Simulated</em>}
            </span>
            <span>{withoutSimulatedPrefix(notice.description)}</span>
            {!!notice.stations.length && (
              <small>Affected stations: {notice.stations.join(", ")}.</small>
            )}
            {notice.delayMinutes > 0 && (
              <small>Allow about {notice.delayMinutes} extra minutes.</small>
            )}
            {notice.freeBus && <small>{notice.freeBus}.</small>}
            {notice.shuttle && <small>Shuttle: {notice.shuttle}.</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${className}`.trim()}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

const sheetSnapNames = ["expanded", "middle", "collapsed"] as const;
const sheetSnapDescriptions = ["expanded", "half open", "collapsed"] as const;

function SheetDragHandle({
  controls,
  label,
  sheetSnap,
  sheetMoved,
  snapJourneySheet,
  startSheetDrag,
}: {
  controls: string;
  label: string;
  sheetSnap: ReturnType<typeof useJourneySheet>["sheetSnap"];
  sheetMoved: ReturnType<typeof useJourneySheet>["sheetMoved"];
  snapJourneySheet: ReturnType<typeof useJourneySheet>["snapJourneySheet"];
  startSheetDrag: ReturnType<typeof useJourneySheet>["startSheetDrag"];
}) {
  return (
    <button
      type="button"
      className="sheet-drag-handle"
      aria-label={`Resize ${label}, ${sheetSnapDescriptions[sheetSnap]}`}
      aria-controls={controls}
      data-sheet-snap={sheetSnapNames[sheetSnap]}
      title={`Drag to resize ${label}`}
      onPointerDown={startSheetDrag}
      onClick={(event) => {
        if (sheetMoved.current) {
          sheetMoved.current = false;
          event.preventDefault();
          return;
        }
        snapJourneySheet(sheetSnap === 0 ? 2 : 0);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          snapJourneySheet(sheetSnap - 1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          snapJourneySheet(sheetSnap + 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          snapJourneySheet(0);
        } else if (event.key === "End") {
          event.preventDefault();
          snapJourneySheet(2);
        }
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function Onboarding({
  preferences,
  largeText,
  onSave,
  onSkip,
}: {
  preferences: Preferences;
  largeText: boolean;
  onSave: (preferences: Preferences, largeText: boolean) => void;
  onSkip: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(preferences);
  const [draftLargeText, setDraftLargeText] = useState(largeText);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  const choices = [
    {
      key: "stepFree",
      title: "Avoid stairs",
      description: "Prefer mapped step-free paths and known working lifts",
      icon: Accessibility,
    },
    {
      key: "sheltered",
      title: "Stay out of the rain",
      description: "Give mapped covered walking paths more weight",
      icon: Umbrella,
    },
    {
      key: "avoidCrowds",
      title: "A little more breathing room",
      description: "Favour quieter rides when the data is available",
      icon: UsersRound,
    },
    {
      key: "cycling",
      title: "Bring cycling into the mix",
      description: "Consider cycling to a station and parking before boarding",
      icon: Bike,
    },
  ] as const;
  return (
    <dialog
      ref={ref}
      className="onboarding-modal"
      aria-label="Welcome to Wayce"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="onboarding-header">
        <span className="onboarding-mark" aria-hidden="true">
          <Route size={25} />
        </span>
        <p className="eyebrow">WELCOME TO WAYCE</p>
        <h1 tabIndex={-1} autoFocus>
          Let’s make every journey feel more like yours.
        </h1>
        <p>
          Pick what matters and we’ll use it when comparing routes. Nothing here
          is required—you can skip this and change it later in Preferences.
        </p>
      </div>
      <div className="onboarding-body">
        <fieldset className="onboarding-choices">
          <legend>What matters on your way?</legend>
          {choices.map((choice) => (
            <label className="onboarding-choice" key={choice.key}>
              <choice.icon size={21} />
              <span>
                <strong>{choice.title}</strong>
                <small>{choice.description}</small>
              </span>
              <input
                type="checkbox"
                checked={draft[choice.key]}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [choice.key]: event.target.checked,
                    ...(choice.key === "stepFree"
                      ? { walkingSpeed: event.target.checked ? 40 : 75 }
                      : {}),
                  }))
                }
              />
            </label>
          ))}
        </fieldset>
        <div className="onboarding-fields">
          <label>
            <span>Maximum walk</span>
            <small>Between 200 and 3,500 metres</small>
            <div className="onboarding-number">
              <input
                type="number"
                min="200"
                max="3500"
                step="100"
                value={draft.maxWalk}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxWalk: Math.min(
                      3500,
                      Math.max(200, Number(event.target.value)),
                    ),
                  }))
                }
              />
              <span>m</span>
            </div>
          </label>
          <label>
            <span>Alert me when a delay adds</span>
            <small>Between 3 and 60 minutes</small>
            <div className="onboarding-number">
              <input
                type="number"
                min="3"
                max="60"
                value={draft.alertThreshold}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    alertThreshold: Math.min(
                      60,
                      Math.max(3, Number(event.target.value)),
                    ),
                  }))
                }
              />
              <span>min</span>
            </div>
          </label>
        </div>
        <label className="onboarding-choice onboarding-text-choice">
          <span className="text-size-icon">Aa</span>
          <span>
            <strong>Larger, easier-to-read text</strong>
            <small>Add a little more space throughout Wayce</small>
          </span>
          <input
            type="checkbox"
            checked={draftLargeText}
            onChange={(event) => setDraftLargeText(event.target.checked)}
          />
        </label>
      </div>
      <div className="onboarding-actions">
        <button type="button" className="text-button" onClick={onSkip}>
          Skip for now
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => onSave(draft, draftLargeText)}
        >
          Save preferences <ArrowRight size={17} />
        </button>
      </div>
    </dialog>
  );
}
function GooglePlacesInput({
  apiKey,
  controlId,
  value,
  placeholder,
  clearValueOnFocus,
  onChange,
  onUnavailable,
}: {
  apiKey: string;
  controlId: string;
  value: Place;
  placeholder?: string;
  clearValueOnFocus?: boolean;
  onChange: (place: Place) => void;
  onUnavailable: (message: string, typedQuery: string) => void;
}) {
  const [query, setQuery] = useState(value.name);
  const [editing, setEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const session = useRef<Promise<GooglePlaceSearchSession> | null>(null);
  const onChangeRef = useRef(onChange);
  const onUnavailableRef = useRef(onUnavailable);
  onChangeRef.current = onChange;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => setQuery(value.name), [value]);

  useEffect(() => {
    if (!editing) return;
    const normalized = query.trim();
    if (normalized.length < 2) {
      setSuggestions([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      const activeSession =
        session.current ?? createGooglePlaceSearchSession(apiKey);
      session.current = activeSession;
      activeSession
        .then((search) => search.suggest(normalized))
        .then((next) => {
          if (!cancelled) setSuggestions(next.slice(0, 6));
        })
        .catch(() => {
          if (!cancelled)
            onUnavailableRef.current(
              "Online address search is unavailable. Using the offline index.",
              query,
            );
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiKey, editing, query]);

  const chooseSuggestion = async (suggestion: GooglePlaceSuggestion) => {
    setBusy(true);
    try {
      const activeSession =
        session.current ?? createGooglePlaceSearchSession(apiKey);
      session.current = activeSession;
      const place = await (await activeSession).resolve(suggestion);
      if (!place) {
        onUnavailableRef.current(
          "That result has no routable Singapore coordinate. Try another place.",
          query,
        );
        return;
      }
      setQuery(place.name);
      setEditing(false);
      setSuggestions([]);
      session.current = null;
      onChangeRef.current(place);
    } catch {
      onUnavailableRef.current(
        "Online address search is unavailable. Using the offline index.",
        query,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="google-place-shell">
      <input
        id={controlId}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={editing}
        aria-controls={`google-places-${controlId}`}
        value={query}
        placeholder={placeholder}
        onFocus={() => {
          if (clearValueOnFocus) setQuery("");
          session.current = null;
          setSuggestions([]);
          setEditing(true);
        }}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={() =>
          setTimeout(() => {
            setEditing(false);
            setQuery(value.name);
          }, 150)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setEditing(false);
            setQuery(value.name);
          }
          if (event.key === "Enter" && editing && suggestions[0]) {
            event.preventDefault();
            void chooseSuggestion(suggestions[0]);
          }
        }}
      />
      {editing && (
        <ul
          className="place-results google-place-results"
          id={`google-places-${controlId}`}
          role="listbox"
        >
          {busy && <li className="searching">Finding places…</li>}
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void chooseSuggestion(suggestion)}
              >
                <span>
                  {suggestion.name}
                  {suggestion.subtitle && <small>{suggestion.subtitle}</small>}
                </span>
              </button>
            </li>
          ))}
          {!busy && query.trim().length >= 2 && !suggestions.length && (
            <li className="searching">
              No Singapore match. Try a street, building, station, or landmark.
            </li>
          )}
          {!!suggestions.length && (
            <li className="google-maps-attribution">
              Results from <span translate="no">Google Maps</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
function PlacePicker({
  label,
  value,
  onChange,
  fieldKey,
  placeholder,
  googlePlacesApiKey,
  online,
  onActivate,
}: {
  label: string;
  value: Place;
  onChange: (p: Place) => void;
  fieldKey: "A" | "B";
  placeholder?: string;
  googlePlacesApiKey?: string;
  online: boolean;
  onActivate?: () => void;
}) {
  const [query, setQuery] = useState(value.name);
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState(places);
  const [busy, setBusy] = useState(false);
  const [googleUnavailable, setGoogleUnavailable] = useState(false);
  const [searchNote, setSearchNote] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const useGoogle = !!googlePlacesApiKey && online && !googleUnavailable;
  const clearValueOnFocus =
    fieldKey === "A" &&
    (value.id === "device-current-location" ||
      value.id === "demo-current-location");
  useEffect(() => {
    if (googlePlacesApiKey && online) setGoogleUnavailable(false);
  }, [googlePlacesApiKey, online]);
  useEffect(() => setQuery(value.name), [value]);
  useEffect(() => {
    if (!editing) return;
    const normalized = query.trim().toLowerCase();
    const localResults = normalized
      ? places.filter((p) =>
          `${p.name} ${p.subtitle}`.toLowerCase().includes(normalized),
        )
      : places;
    setResults(localResults);
    setBusy(false);
    const control = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      fetch(`/api/places?q=${encodeURIComponent(query || " ")}`, {
        signal: control.signal,
      })
        .then((r) => r.json())
        .then((v) => {
          if (Array.isArray(v)) setResults(v);
        })
        .catch(() => setResults(localResults))
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [query, editing]);
  return (
    <div
      className="place-field"
      ref={container}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLInputElement) onActivate?.();
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, button, .place-results")) return;
        container.current?.querySelector<HTMLInputElement>("input")?.focus();
      }}
    >
      <div>
        <label htmlFor={`place-${fieldKey}`}>{label}</label>
        {useGoogle ? (
          <GooglePlacesInput
            apiKey={googlePlacesApiKey}
            controlId={`place-${fieldKey}`}
            value={value}
            placeholder={placeholder}
            clearValueOnFocus={clearValueOnFocus}
            onChange={(place) => {
              setQuery(place.name);
              setSearchNote("");
              onChange(place);
            }}
            onUnavailable={(message, typedQuery) => {
              setQuery(typedQuery);
              setEditing(true);
              setSearchNote(message);
              setGoogleUnavailable(true);
            }}
          />
        ) : (
          <input
            id={`place-${fieldKey}`}
            autoComplete="off"
            role="combobox"
            aria-expanded={editing}
            aria-controls={`places-${fieldKey}`}
            value={query}
            placeholder={placeholder}
            onFocus={() => {
              if (clearValueOnFocus) setQuery("");
              setEditing(true);
              setResults(places);
            }}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() =>
              setTimeout(() => {
                setEditing(false);
                setQuery(value.name);
              }, 150)
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                setQuery(value.name);
              }
              if (e.key === "Enter" && editing) {
                e.preventDefault();
                if (results[0]) {
                  onChange(results[0]);
                  setEditing(false);
                }
              }
            }}
          />
        )}
        <small>{searchNote || value.subtitle}</small>
      </div>
      {editing && !useGoogle && query.trim().length > 0 && (
        <ul className="place-results" id={`places-${fieldKey}`} role="listbox">
          {busy && <li className="searching">Finding places…</li>}
          {results.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === value.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p);
                  setEditing(false);
                }}
              >
                <span>
                  {p.name}
                  <small>{p.subtitle}</small>
                </span>
              </button>
            </li>
          ))}
          {!busy && !results.length && (
            <li className="searching">
              No match. Try an indexed station, bus stop, or landmark.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const guest = useRef<AccountState | null>(null);
  if (!guest.current) guest.current = initialGuestState();
  const saved = useRef<SavedCommute | null>(guest.current.commutes[0] ?? null);
  const [request, setRequest] = useState<PlanRequest>(() =>
    saved.current?.request
      ? liveRequest(saved.current.request)
      : makeStartRequest({
          ...makeRequest().preferences,
          ...guest.current!.preferences,
        }),
  );
  const [plan, setPlan] = useState<PlanResponse | null>(
    saved.current || !navigator.onLine
      ? readSaved<PlanResponse>(PLAN_KEY)
      : null,
  );
  const [liveWeather, setLiveWeather] = useState<WeatherSnapshot | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keep the first two route cards legible by default. The divider still lets
  // people grow the map when they want to inspect the route more closely.
  const [routeMapShare, setRouteMapShare] = useState(34);
  const [tab, setTab] = useState<Tab>("today");
  const [modal, setModal] = useState<ModalName>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    () =>
      readLocal<boolean>(ONBOARDING_KEY) !== true &&
      localStorage.getItem(GUEST_KEY) === null &&
      localStorage.getItem(PROFILE_KEY) === null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
  const [largeText, setLargeText] = useState(guest.current.largeText);
  const [config, setConfig] = useState<any>(null);
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [wallets, setWallets] = useState<Record<string, PointsWallet>>({});
  const [demoWallet, setDemoWallet] = useState<PointsWallet>({ entries: [] });
  const pointsScope = accountUser ? `account:${accountUser.email}` : "guest";
  const wallet =
    request.dataMode === "demo"
      ? demoWallet
      : (wallets[pointsScope] ??
        readPointsWallet(readLocal(POINTS_KEY + pointsScope)));
  const balance = pointsBalance(wallet);
  const [activeJourney, setActiveJourney] = useState<{
    route: Journey;
    entry: PointsEntry;
    demo: boolean;
    scope: string;
    destination: string;
    departure: string;
    buses: PlanResponse["conditions"]["buses"];
  } | null>(null);
  const [completionPoints, setCompletionPoints] = useState<number | null>(null);
  const completionRecorded = useRef(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [commutes, setCommutes] = useState<SavedCommute[]>(
    guest.current.commutes,
  );
  const [developerMode, setDeveloperMode] = useState(
    localStorage.getItem(DEVELOPER_KEY) === "true",
  );
  const [companionConsent, setCompanionConsent] = useState(
    readLocal<boolean>(COMPANION_CONSENT_KEY) === true,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [journeyStep, setJourneyStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [proactiveWarning, setProactiveWarning] = useState<{
    delay: number;
    leaveAt: string;
    targetTime: string;
  } | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationFix | null>(
    null,
  );
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [trackingLocation, setTrackingLocation] = useState(false);
  const [leaveNow, setLeaveNow] = useState(!saved.current);
  const [demoPersona, setDemoPersona] = useState<Persona>("rachel");
  const [timelineKind, setTimelineKind] = useState<"control" | "eventful">(
    "control",
  );
  const {
    journeyLayout,
    sheetSnap,
    sheetDragging,
    sheetMoved,
    snapJourneySheet,
    startSheetDrag,
  } = useJourneySheet(
    tab === "today" && modal !== "preferences" && modal !== "profile",
  );
  const {
    journeyLayout: activeJourneyLayout,
    sheetSnap: activeJourneySheetSnap,
    sheetDragging: activeJourneySheetDragging,
    sheetMoved: activeJourneySheetMoved,
    snapJourneySheet: snapActiveJourneySheet,
    startSheetDrag: startActiveJourneySheetDrag,
  } = useJourneySheet(modal === "journey", {
    sheetSelector: ".active-journey-sheet",
    scrollSelector: ".active-journey-scroll",
    lockDocument: false,
    middleRatio: 0.32,
    middleMaxHeight: 290,
  });
  const [hardPreferences, setHardPreferences] = useState<Partial<Preferences>>(
    guest.current.hardPreferences,
  );
  const activeRequest = useRef<AbortController | null>(null);
  const normalState = useRef<{
    request: PlanRequest;
    hardPreferences: Partial<Preferences>;
    commutes: SavedCommute[];
    saved: SavedCommute | null;
    largeText: boolean;
    leaveNow: boolean;
  } | null>(null);
  const lastProactiveWarning = useRef("");
  const locationWatch = useRef<number | null>(null);
  const demoProfiles = (["arjun", "rachel", "lim"] as Persona[]).map((id) =>
    profiles.find((candidate) => candidate.id === id)!,
  );
  const selectedDemoProfile =
    demoProfiles.find((candidate) => candidate.id === demoPersona) ??
    demoProfiles[0];

  const selected =
    activeJourney?.route ??
    (plan
      ? ([plan.recommended, ...plan.alternatives, plan.original].find(
          (j) => j.id === selectedId,
        ) ?? plan.recommended)
      : null);
  const savedRoutine = commutes.some(
    (commute) => commute.id === commuteId(request),
  );
  const preferenceSummary = [
    request.preferences.sheltered &&
      (effectiveShelterMode(request.preferences) === "require"
        ? "Mapped shelter required"
        : "Sheltered walks preferred"),
    request.preferences.stepFree && "Avoid stairs",
    request.preferences.avoidCrowds && "Quieter rides",
    request.preferences.cycling && "Cycling",
  ].filter(Boolean) as string[];
  const tomorrow = dateValue(new Date(Date.now() + 86400000).toISOString());
  const relevantPlannedNotice =
    dateValue(request.departure) === tomorrow
      ? plan?.conditions.notices.find((notice) => {
          if (notice.kind !== "planned" || !selected) return false;
          const departure = Date.parse(request.departure);
          const arrival = departure + selected.duration * 60000;
          const starts = Date.parse(notice.startsAt);
          const ends = notice.endsAt ? Date.parse(notice.endsAt) : Infinity;
          const timeMatches = starts <= arrival && ends >= departure;
          const routeMatches = selected.segments.some(
            (segment) =>
              (!notice.line || notice.line === segment.line) &&
              (!notice.stations.length ||
                notice.stations.some((station) =>
                  segment.stops.includes(station),
                )),
          );
          return timeMatches && routeMatches;
        })
      : undefined;
  const notify = (message: string) => setToast(message);
  const updateRequest = (value: Partial<PlanRequest>) =>
    setRequest((previous) => ({ ...previous, ...value }));
  const updatePreferences = (value: Partial<Preferences>) => {
    setHardPreferences((previous) => ({ ...previous, ...value }));
    setRequest((previous) => ({
      ...previous,
      preferences: { ...previous.preferences, ...value },
    }));
  };
  const runPlan = useCallback(
    async (value: PlanRequest, focusMapOnSuccess = false) => {
      if (!isPlannable(value)) {
        setPlan(null);
        setLoading(false);
        return;
      }
      activeRequest.current?.abort();
      const control = new AbortController();
      activeRequest.current = control;
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
          signal: control.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Unable to plan your journey");
        setPlan(data);
        setShowAllRoutes(false);
        setSelectedId(null);
        if (focusMapOnSuccess) snapJourneySheet(2);
        if (value.dataMode === "live") persist(PLAN_KEY, data);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          if (navigator.onLine) {
            setPlan(null);
            setSelectedId(null);
          }
          setError(
            navigator.onLine
              ? e.message
              : "You’re offline. Your last saved journey is shown; conditions may have changed.",
          );
        }
      } finally {
        if (activeRequest.current === control) setLoading(false);
      }
    },
    [],
  );
  const buildAccountState = (
    overrides: Partial<
      Pick<
        AccountState,
        "preferences" | "hardPreferences" | "commutes" | "largeText"
      >
    > = {},
  ): AccountState => ({
    preferences: overrides.preferences ?? request.preferences,
    hardPreferences: overrides.hardPreferences ?? hardPreferences,
    commutes: overrides.commutes ?? commutes,
    largeText: overrides.largeText ?? largeText,
    updatedAt: new Date().toISOString(),
  });
  const storeRealState = async (state: AccountState) => {
    if (request.dataMode === "demo") return;
    if (!accountUser) {
      guest.current = state;
      persist(GUEST_KEY, state);
      persist("wlt-large-text", state.largeText);
      return;
    }
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Account sync failed");
      setAccountError("");
    } catch (reason: any) {
      setAccountError(reason.message ?? "Account sync failed");
      notify(
        "Your changes are active for this session, but account sync is unavailable.",
      );
    }
  };
  const finishOnboarding = (
    preferences?: Preferences,
    nextLargeText = largeText,
  ) => {
    const nextPreferences = preferences ?? request.preferences;
    const nextHardPreferences = preferences
      ? { ...hardPreferences, ...preferences }
      : hardPreferences;
    const nextRequest = { ...request, preferences: nextPreferences };
    const nextState = buildAccountState({
      preferences: nextPreferences,
      hardPreferences: nextHardPreferences,
      largeText: nextLargeText,
    });
    setRequest(nextRequest);
    setHardPreferences(nextHardPreferences);
    setLargeText(nextLargeText);
    void storeRealState(nextState);
    persist(ONBOARDING_KEY, true);
    setShowOnboarding(false);
    notify(
      preferences
        ? "Preferences saved. You can change them under Account → Preferences."
        : "Setup skipped. Add preferences under Account → Preferences anytime.",
    );
  };
  const applyRealState = (state: AccountState) => {
    const primary = state.commutes[0] ?? null;
    const base = primary?.request ?? liveRequest(request);
    const next: PlanRequest = {
      ...liveRequest(base),
      preferences: {
        ...base.preferences,
        ...state.preferences,
        ...state.hardPreferences,
      },
    };
    saved.current = primary;
    setCommutes(state.commutes);
    setHardPreferences(state.hardPreferences);
    setLargeText(state.largeText);
    setLeaveNow(!primary);
    setRequest(next);
    void runPlan(next);
  };
  const signInWithGoogle = async (credential: string) => {
    setAccountBusy(true);
    setAccountError("");
    try {
      // Preserve the guest snapshot's real modification time. Rebuilding it here
      // would make stale guest data look newer than the synced account on every
      // logout/login cycle.
      const guestState = guest.current ?? buildAccountState();
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, guestState }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Google sign-in failed");
      setAccountUser(data.user);
      applyRealState(data.state);
      notify("Signed in. Your guest preferences and commutes were merged.");
    } catch (reason: any) {
      setAccountError(reason.message ?? "Google sign-in failed");
    } finally {
      setAccountBusy(false);
    }
  };
  const signOut = async () => {
    setAccountBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      disableGoogleAutoSelect();
      setAccountUser(null);
      setAccountError("");
      applyRealState(guest.current ?? initialGuestState());
      notify("Signed out. Your separate guest space is active.");
    } finally {
      setAccountBusy(false);
    }
  };
  const updateRequestAndPlan = (value: Partial<PlanRequest>) => {
    const next = { ...request, ...value };
    setRequest(next);
    void runPlan(next);
  };
  const stopLocationTracking = useCallback(() => {
    if (locationWatch.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(locationWatch.current);
      locationWatch.current = null;
    }
    setTrackingLocation(false);
  }, []);
  const clearLocation = useCallback(() => {
    stopLocationTracking();
    setCurrentLocation(null);
    setLocationBusy(false);
    setLocationError("");
  }, [stopLocationTracking]);
  const failLocation = (message: string) => {
    stopLocationTracking();
    setLocationBusy(false);
    setLocationError(message);
  };
  const acceptDeviceLocation = (
    position: GeolocationPosition,
    useAsOrigin: boolean,
    onlyIfOriginUnset = false,
  ): boolean => {
    const fix = deviceLocationFix(position);
    if (!isSupportedLocation(fix)) {
      failLocation(
        "Your device location is outside the supported Singapore routing area. Choose an origin manually.",
      );
      return false;
    }
    setCurrentLocation(fix);
    setLocationBusy(false);
    setLocationError("");
    if (useAsOrigin) {
      setRequest((previous) => {
        if (onlyIfOriginUnset && previous.origin.id !== UNSET_ORIGIN.id)
          return previous;
        const next = { ...previous, origin: locationPlace(fix) };
        if (isPlannable(next)) void runPlan(next);
        return next;
      });
    }
    return true;
  };
  const useCurrentLocation = () => {
    setLocationError("");
    if (request.dataMode === "demo") {
      const savedOrigin =
        normalState.current?.request.origin ??
        saved.current?.request.origin ??
        makeRequest().origin;
      const base =
        request.origin.id === "demo-current-location"
          ? savedOrigin
          : request.origin;
      const fix = demoLocationFix(base);
      const next = { ...request, origin: locationPlace(fix) };
      setCurrentLocation(fix);
      setRequest(next);
      void runPlan(next);
      return;
    }
    requestDeviceLocation();
  };
  const requestDeviceLocation = (onlyIfOriginUnset = false) => {
    setLocationError("");
    if (!window.isSecureContext) {
      failLocation(
        "Device location requires HTTPS. Open the secure hosted app or choose an origin manually.",
      );
      return;
    }
    if (!("geolocation" in navigator)) {
      failLocation(
        "This browser does not support location services. Choose an origin manually.",
      );
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => acceptDeviceLocation(position, true, onlyIfOriginUnset),
      (error) => failLocation(locationErrorMessage(error)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };
  const startLocationTracking = () => {
    if (!selected) return;
    setLocationError("");
    if (request.dataMode === "demo") {
      const fix = demoJourneyFix(selected.segments, journeyStep);
      if (fix) setCurrentLocation(fix);
      setTrackingLocation(true);
      return;
    }
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      failLocation(
        "Live location needs browser location support on a secure HTTPS connection.",
      );
      return;
    }
    stopLocationTracking();
    setLocationBusy(true);
    locationWatch.current = navigator.geolocation.watchPosition(
      (position) => {
        if (acceptDeviceLocation(position, false)) setTrackingLocation(true);
      },
      (error) => failLocation(locationErrorMessage(error)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  };
  const setJourneyProgress = (step: number) => {
    setJourneyStep(step);
    if (
      activeJourney &&
      step >= activeJourney.route.segments.length &&
      !completionRecorded.current
    ) {
      completionRecorded.current = true;
      const current = activeJourney.demo
        ? demoWallet
        : readPointsWallet(
            readLocal(POINTS_KEY + activeJourney.scope) ??
              wallets[activeJourney.scope],
          );
      const next = creditJourney(current, {
        ...activeJourney.entry,
        completedAt: new Date().toISOString(),
      });
      const earned = pointsBalance(next) - pointsBalance(current);
      setCompletionPoints(earned);
      if (activeJourney.demo) setDemoWallet(next);
      else {
        setWallets((previous) => ({
          ...previous,
          [activeJourney.scope]: next,
        }));
        persist(POINTS_KEY + activeJourney.scope, next);
      }
      stopLocationTracking();
      if (earned > 0)
        notify(
          `${earned} ${activeJourney.demo ? "demo " : ""}points earned. Nicely done!`,
        );
    }
    if (request.dataMode === "demo" && selected) {
      const fix = demoJourneyFix(selected.segments, step);
      if (fix) setCurrentLocation(fix);
    }
  };
  const closeJourney = () => {
    stopLocationTracking();
    setStarted(false);
    setActiveJourney(null);
    setModal(null);
  };
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((session) => {
        if (!session.authenticated || !session.user || !session.state) return;
        persist(ONBOARDING_KEY, true);
        setShowOnboarding(false);
        setAccountUser(session.user);
        applyRealState(session.state);
      })
      .catch(() => {});
    if (navigator.onLine && isPlannable(request)) void runPlan(request);
    if (request.dataMode === "live") requestDeviceLocation(true);
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
      activeRequest.current?.abort();
      stopLocationTracking();
    };
  }, []);
  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    const timer = window.setInterval(updateClock, 30000);
    window.addEventListener("focus", updateClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateClock);
    };
  }, []);
  useEffect(() => {
    if (request.dataMode !== "live" || currentLocation?.source !== "device") {
      if (request.dataMode === "live") setLiveWeather(null);
      return;
    }
    let controller: AbortController | null = null;
    const loadWeather = async () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/weather?lat=${encodeURIComponent(currentLocation.lat)}&lon=${encodeURIComponent(currentLocation.lon)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Weather request failed");
        setLiveWeather((await response.json()) as WeatherSnapshot);
      } catch (reason) {
        if ((reason as Error).name === "AbortError") return;
        setLiveWeather((previous) =>
          previous
            ? {
                ...previous,
                feeds: [
                  {
                    name: "NEA weather",
                    status: "stale",
                    updatedAt: previous.updatedAt,
                    detail: "Last weather retained after a refresh failure",
                  },
                ],
              }
            : null,
        );
      }
    };
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 300000);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [
    currentLocation?.lat,
    currentLocation?.lon,
    currentLocation?.source,
    request.dataMode,
  ]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.documentElement.classList.toggle("large-text", largeText);
    if (request.dataMode === "live" && !accountUser) {
      if (guest.current?.largeText === largeText) return;
      const next = {
        ...(guest.current ?? initialGuestState()),
        largeText,
        updatedAt: new Date().toISOString(),
      };
      guest.current = next;
      persist(GUEST_KEY, next);
      persist("wlt-large-text", largeText);
    }
  }, [accountUser, largeText, request.dataMode]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        navigator.onLine &&
        document.visibilityState === "visible" &&
        plan &&
        !started &&
        !loading
      )
        void runPlan(plan.request);
    }, 300000);
    return () => clearInterval(timer);
  }, [plan, loading, runPlan, started]);
  useEffect(() => {
    if (!plan || plan.request.dataMode === "demo") return;
    const departure = new Date(plan.request.departure);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Singapore",
      weekday: "short",
    }).format(departure);
    if (weekday === "Sat" || weekday === "Sun") return;
    const timeBand = `${String(departure.getUTCHours() + 8).padStart(2, "0")}:${String(Math.floor(departure.getUTCMinutes() / 30) * 30).padStart(2, "0")}`;
    const activity: Activity = {
      originId: plan.request.origin.id,
      destinationId: plan.request.destination.id,
      timeBand,
      weekday,
      date: dateValue(plan.request.departure),
    };
    const previous = readSaved<Activity[]>(ACTIVITY_KEY) ?? [];
    const entries = [
      ...previous.filter(
        (entry) =>
          entry.date !== activity.date ||
          entry.originId !== activity.originId ||
          entry.destinationId !== activity.destinationId ||
          entry.timeBand !== activity.timeBand,
      ),
      activity,
    ].filter(
      (entry) =>
        Date.now() - Date.parse(`${entry.date}T00:00:00+08:00`) < 35 * 86400000,
    );
    persist(ACTIVITY_KEY, entries);
    const matchingDays = new Set(
      entries
        .filter(
          (entry) =>
            entry.originId === activity.originId &&
            entry.destinationId === activity.destinationId &&
            entry.timeBand === activity.timeBand,
        )
        .map((entry) => entry.date),
    );
    if (matchingDays.size >= 3) {
      const learned = savedCommute(plan.request, hardPreferences, true);
      if (!commutes.some((commute) => commute.id === learned.id)) {
        const nextCommutes = [learned, ...commutes].slice(0, 10);
        saved.current = learned;
        setCommutes(nextCommutes);
        void storeRealState(
          buildAccountState({
            preferences: plan.request.preferences,
            commutes: nextCommutes,
          }),
        );
      }
    }
  }, [hardPreferences, plan]);
  useEffect(() => {
    const commonRoute = saved.current;
    if (!plan || !commonRoute?.timeSensitive) return;
    if (
      commonRoute.request.origin.id !== plan.request.origin.id ||
      commonRoute.request.destination.id !== plan.request.destination.id
    )
      return;
    const delay = Math.max(
      0,
      plan.original.duration - plan.original.baselineDuration,
    );
    if (
      !meetsDelayAlertThreshold(
        delay,
        commonRoute.request.preferences.alertThreshold,
      )
    )
      return;
    const routeDate = dateValue(plan.request.departure);
    let target = Date.parse(
      `${routeDate}T${commonRoute.timeSensitive}:00+08:00`,
    );
    if (!commonRoute.request.arriveBy) {
      target += plan.original.baselineDuration * 60000;
    }
    const requiredDeparture = target - plan.recommended.duration * 60000;
    const plannedDeparture = Date.parse(plan.request.departure);
    if (
      !Number.isFinite(requiredDeparture) ||
      requiredDeparture >= plannedDeparture
    )
      return;
    const fingerprint = `${routeDate}:${plan.request.origin.id}:${plan.request.destination.id}:${delay}:${plan.recommended.id}`;
    if (lastProactiveWarning.current === fingerprint) return;
    lastProactiveWarning.current = fingerprint;
    setProactiveWarning({
      delay,
      leaveAt: new Date(requiredDeparture).toISOString(),
      targetTime: commonRoute.timeSensitive,
    });
    setModal("proactive");
  }, [plan]);
  const runDemoSelection = (persona: Persona, kind: "control" | "eventful") => {
    setDemoWallet({ entries: [] });
    setActiveJourney(null);
    setStarted(false);
    if (request.dataMode === "live") {
      normalState.current = {
        request,
        hardPreferences,
        commutes,
        saved: saved.current,
        largeText,
        leaveNow,
      };
    }
    stopLocationTracking();
    const timeline = { id: `${persona}-${kind}` as TimelineId, minute: 0 };
    const base = {
      ...makeRequest(persona, "demo", "normal"),
      timeline,
      departure: timelineTime(timeline),
      arriveBy: `2026-09-21T${profiles.find((p) => p.id === persona)!.arriveBy}:00+08:00`,
    };
    const fix = demoLocationFix(base.origin);
    const value: PlanRequest = { ...base, origin: locationPlace(fix) };
    const fauxCommute = savedCommute(base, base.preferences);
    saved.current = fauxCommute;
    setHardPreferences(base.preferences);
    setCommutes([fauxCommute]);
    setLargeText(persona === "lim");
    setCurrentLocation(fix);
    setLocationError("");
    setLeaveNow(false);
    setRequest(value);
    setModal(null);
    void runPlan(value);
  };
  const startDemo = () => runDemoSelection(demoPersona, timelineKind);
  const exitDemo = () => {
    setDemoWallet({ entries: [] });
    setActiveJourney(null);
    setStarted(false);
    clearLocation();
    const stored = normalState.current;
    const value = liveRequest(
      stored?.request ?? saved.current?.request ?? makeRequest(),
    );
    setHardPreferences(stored?.hardPreferences ?? {});
    setCommutes(stored?.commutes ?? []);
    setLargeText(stored?.largeText ?? false);
    setLeaveNow(stored?.leaveNow ?? false);
    saved.current = stored?.saved ?? null;
    normalState.current = null;
    setRequest(value);
    void runPlan(value);
    requestDeviceLocation();
  };
  const saveCommute = async () => {
    if (request.dataMode === "demo") {
      notify("Demo commutes stay in the faux account and are never saved.");
      return;
    }
    const commonRoute = savedCommute(request, hardPreferences);
    const nextCommutes = [
      commonRoute,
      ...commutes.filter((commute) => commute.id !== commonRoute.id),
    ].slice(0, 10);
    saved.current = commonRoute;
    setCommutes(nextCommutes);
    await storeRealState(
      buildAccountState({
        preferences: request.preferences,
        commutes: nextCommutes,
      }),
    );
    notify(
      accountUser
        ? "Your daily commute is saved to your account."
        : "Your daily commute is saved in your guest space.",
    );
  };
  const loadCommute = (commute: SavedCommute) => {
    if (request.dataMode === "demo") {
      setTab("today");
      runDemoSelection(demoPersona, timelineKind);
      return;
    }
    clearLocation();
    const departure = nextDeparture(sgTime(commute.request.departure));
    const next: PlanRequest = {
      ...liveRequest(commute.request),
      departure,
      arriveBy: commute.request.arriveBy
        ? `${dateValue(departure)}T${commute.timeSensitive}:00+08:00`
        : undefined,
      preferences: {
        ...commute.request.preferences,
        ...commute.hardPreferences,
      },
    };
    saved.current = commute;
    setHardPreferences(commute.hardPreferences);
    setLeaveNow(false);
    setRequest(next);
    setTab("today");
    void runPlan(next);
  };
  const removeCommute = async (commute: SavedCommute) => {
    if (request.dataMode === "demo") {
      notify("Faux demo commutes are restored from their preset.");
      return;
    }
    const nextCommutes = commutes.filter((item) => item.id !== commute.id);
    setCommutes(nextCommutes);
    if (saved.current?.id === commute.id)
      saved.current = nextCommutes[0] ?? null;
    await storeRealState(buildAccountState({ commutes: nextCommutes }));
    notify("Daily commute removed.");
  };
  const enableReminders = async () => {
    try {
      if (request.dataMode === "demo")
        throw new Error("Reminders cannot be enabled for simulated commutes.");
      if (!config?.integrations.push) {
        notify(
          "Background reminders need Cloud Scheduler, Firestore and push credentials. Your commute can still be saved locally.",
        );
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error(
          "This browser does not support background reminders. On iPhone, add this app to the Home Screen first.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications were not enabled. You can change this in your browser settings.",
        );
      const registration = await navigator.serviceWorker.ready;
      const key = String(config.vapidPublicKey)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      let token = localStorage.getItem("wlt-device-token");
      if (!token) {
        token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        localStorage.setItem("wlt-device-token", token);
      }
      const r = await fetch("/api/routine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Token": token,
        },
        body: JSON.stringify({
          request,
          subscription,
          consent: true,
          timeSensitive: sgTime(request.arriveBy ?? request.departure),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await saveCommute();
      notify(
        "Reminders enabled. We’ll check before departure and the day before planned work.",
      );
    } catch (e: any) {
      notify(e.message);
    }
  };
  const deleteData = async () => {
    if (request.dataMode === "demo") {
      notify("Exit demo before deleting real saved data.");
      return;
    }
    const token = localStorage.getItem("wlt-device-token");
    if (token) {
      try {
        const r = await fetch("/api/routine", {
          method: "DELETE",
          headers: { "X-Device-Token": token },
        });
        if (!r.ok) throw new Error();
        const registration = await navigator.serviceWorker.getRegistration();
        await (
          await registration?.pushManager.getSubscription()
        )?.unsubscribe();
      } catch {
        notify(
          "Could not delete your cloud reminder while offline. Please reconnect and try again.",
        );
        return;
      }
    }
    if (accountUser) {
      try {
        const response = await fetch("/api/account", { method: "DELETE" });
        if (!response.ok) throw new Error();
        disableGoogleAutoSelect();
        setAccountUser(null);
      } catch {
        notify(
          "Could not delete your account data. Please reconnect and try again.",
        );
        return;
      }
    }
    for (const key of [
      PROFILE_KEY,
      GUEST_KEY,
      PLAN_KEY,
      ACTIVITY_KEY,
      COMPANION_CONSENT_KEY,
      ONBOARDING_KEY,
      "wlt-device-token",
      "wlt-large-text",
    ])
      localStorage.removeItem(key);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(POINTS_KEY)) localStorage.removeItem(key);
    }
    setWallets({});
    setDemoWallet({ entries: [] });
    const clean = initialGuestState();
    guest.current = clean;
    saved.current = null;
    setCommutes([]);
    setHardPreferences({});
    setLargeText(false);
    setCompanionConsent(false);
    const next = makeStartRequest(clean.preferences);
    setLeaveNow(true);
    setRequest(next);
    setPlan(null);
    setModal(null);
    setShowOnboarding(true);
    requestDeviceLocation();
    notify("Saved guest, account, journey and reminder data deleted.");
  };
  const dateLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "Asia/Singapore",
  }).format(new Date(request.departure));
  const stale = !!plan && Date.parse(plan.expiresAt) < Date.now();
  const routeChoices = plan ? [plan.recommended, ...plan.alternatives] : [];
  const visibleRouteChoices = showAllRoutes
    ? routeChoices
    : routeChoices.slice(0, 2);
  const tripChoices = routeChoices.slice(0, 3);
  const showRouteResults = Boolean(plan);
  const resultPlan = plan as PlanResponse;
  const selectedJourney = routeChoices.find(
    (journey) => journey.id === selectedId,
  );
  // The bell is intentionally narrower than the full Disruptions tab. It is
  // reserved for service interruptions (including scheduled closures), not
  // weather, crowds, accessibility notices, or feed diagnostics.
  const disruptionAlerts =
    plan?.conditions.notices.filter(
      (notice) => notice.kind === "disruption" || notice.kind === "planned",
    ) ?? [];
  const primaryPage = modal === "preferences" || modal === "profile";
  const pointsAlreadyCollected =
    !!plan &&
    wallet.entries.some((entry) => entry.id === pointsJourneyId(plan));
  const headerConditions =
    request.dataMode === "demo"
      ? plan?.conditions
      : (liveWeather ??
        (plan?.conditions.mode === "live" ? plan.conditions : null));
  const headerWeather = headerConditions?.weather;
  const weatherFeed = headerConditions?.feeds.find((feed) =>
    /weather|NEA .*forecast/i.test(feed.name),
  );
  const forecast = (
    headerWeather?.forecast ??
    (currentLocation?.source === "device"
      ? "Updating weather"
      : "Weather unavailable")
  ).replace(/^SIMULATED ·\s*/i, "");
  const weatherState = !online
    ? "Offline"
    : request.dataMode === "demo"
      ? "Demo"
      : weatherFeed?.status === "stale"
        ? "Stale"
        : weatherFeed?.status === "unavailable"
          ? "Unavailable"
          : "";
  const weatherPrefix =
    weatherState === "Unavailable" && /unavailable/i.test(forecast)
      ? ""
      : weatherState
        ? `${weatherState} · `
        : "";
  const weatherLabel = `${weatherPrefix}${
    headerWeather?.temperature !== undefined
      ? `${Math.round(headerWeather.temperature)}° · `
      : ""
  }${forecast}`;
  const clockDate = request.timeline
    ? new Date(timelineTime(request.timeline))
    : new Date(clockNow);
  const clockLabel = new Intl.DateTimeFormat("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  }).format(clockDate);
  const beginJourney = (
    journey: Journey,
    acknowledgeWeatherWarning = false,
  ) => {
    if (
      !plan ||
      (journey.blocked &&
        (!acknowledgeWeatherWarning ||
          !canStartWithWeatherWarning(journey, plan)))
    )
      return;
    completionRecorded.current = false;
    setCompletionPoints(null);
    setActiveJourney({
      route: journey,
      entry: {
        ...journeyPoints(journey, plan.original),
        id: pointsJourneyId(plan),
        title: journey.title,
        completedAt: "",
      },
      demo: request.dataMode === "demo",
      scope: pointsScope,
      destination: plan.request.destination.name,
      departure: plan.request.departure,
      buses: plan.conditions.buses,
    });
    setStarted(true);
    setJourneyProgress(0);
    if (request.dataMode === "demo") setTrackingLocation(true);
    setModal("journey");
  };
  const startRouteMapResize = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    const stage = event.currentTarget.closest<HTMLElement>(
      ".route-results-stage",
    );
    if (!stage) return;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const resize = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      pointer.preventDefault();
      const bounds = stage.getBoundingClientRect();
      const headerHeight =
        stage.querySelector<HTMLElement>(".route-results-summary")
          ?.offsetHeight ?? 0;
      const availableHeight = Math.max(1, bounds.height - headerHeight - 28);
      const next =
        ((pointer.clientY - bounds.top - headerHeight) / availableHeight) *
        100;
      setRouteMapShare(Math.max(24, Math.min(68, Math.round(next))));
    };
    const finish = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
    };
    event.preventDefault();
    handle.setPointerCapture(pointerId);
    window.addEventListener("pointermove", resize, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to journey
      </a>
      <div
        className={`top-status ${tab === "today" && !primaryPage ? "on-map" : ""} ${
          tab === "today" && sheetSnap === 0 ? "sheet-expanded" : ""
        } ${showRouteResults || modal === "journey" ? "route-view-hidden" : ""}`}
      >
        <button
          type="button"
          className="weather-status"
          aria-label={`${weatherLabel}. Singapore time ${clockLabel}. Open weather details`}
          title={`${weatherLabel} · ${clockLabel}`}
          onClick={() => setModal("weather")}
        >
          <WeatherStatusIcon
            forecast={forecast}
            rain={headerWeather?.rain ?? false}
          />
          <span>
            <strong>{weatherLabel}</strong>
            <time dateTime={clockDate.toISOString()}>{clockLabel}</time>
          </span>
        </button>
      </div>
      <header className="site-header">
        <nav aria-label="Main navigation">
          <button
            type="button"
            onClick={() => {
              setTab("rewards");
              setModal(null);
            }}
            className={
              !primaryPage && tab === "rewards" ? "nav-item active" : "nav-item"
            }
            aria-current={
              !primaryPage && tab === "rewards" ? "page" : undefined
            }
          >
            <Gift size={17} />
            Rewards
          </button>
          {(
            [
              {
                id: "updates",
                label: "Disruptions",
                icon: Radio,
                featured: false,
              },
              { id: "today", label: "Journey", icon: Route, featured: true },
              {
                id: "commutes",
                label: "Commutes",
                icon: Bookmark,
                featured: false,
              },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setModal(null);
              }}
              className={`${!primaryPage && tab === item.id ? "nav-item active" : "nav-item"}${
                "featured" in item && item.featured ? " journey-nav-item" : ""
              }`}
              aria-current={
                !primaryPage && tab === item.id ? "page" : undefined
              }
            >
              <item.icon size={17} />
              {item.label}
              {item.id === "updates" &&
                plan?.conditions.notices.some(
                  (n) => n.severity === "critical",
                ) && <i className="notification-dot" />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setModal("profile")}
            className={primaryPage ? "nav-item active" : "nav-item"}
            aria-current={primaryPage ? "page" : undefined}
            aria-label="Account"
          >
            <CircleUserRound size={17} />
            Account
          </button>
        </nav>
      </header>
      {!online && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} /> You’re offline. Your saved map and journey are
          available. Conditions may have changed.
        </div>
      )}
      <main
        id="main"
        className={tab === "today" ? "journey-page" : "secondary-tab-page"}
        hidden={primaryPage}
      >
        {tab !== "today" && (
          <section className="greeting">
            <div>
              <h1>
                {tab === "rewards"
                  ? "Rewards"
                  : tab === "commutes"
                    ? "Routes"
                    : "Disruptions"}
              </h1>
            </div>
          </section>
        )}
        {tab === "rewards" && (
          <Rewards
            key={request.dataMode === "demo" ? "demo" : pointsScope}
            wallet={wallet}
            demo={request.dataMode === "demo"}
            onRedeem={(rewardId) => {
              const current =
                request.dataMode === "demo"
                  ? demoWallet
                  : readPointsWallet(readLocal(POINTS_KEY + pointsScope));
              const next = redeemReward(
                current,
                rewardId,
                crypto.randomUUID(),
                new Date().toISOString(),
              );
              if (next === current) {
                notify("You need more points for this reward.");
                return;
              }
              if (request.dataMode === "demo") setDemoWallet(next);
              else {
                setWallets((previous) => ({
                  ...previous,
                  [pointsScope]: next,
                }));
                persist(POINTS_KEY + pointsScope, next);
              }
              notify(
                "Demo reward redeemed! Find it in My rewards. No real-world value.",
              );
            }}
          />
        )}
        {tab === "today" && (
          <>
            {showRouteResults ? (
              <section
                className="route-results-stage"
                aria-label="Route results"
                style={
                  {
                    "--trip-count": tripChoices.length,
                    "--route-map-share": `${routeMapShare}%`,
                  } as React.CSSProperties
                }
              >
                <header className="route-results-summary">
                  <div>
                    <span>From</span>
                    <strong title={request.origin.name}>{request.origin.name}</strong>
                  </div>
                  <div>
                    <span>To</span>
                    <strong title={request.destination.name}>
                      {request.destination.name}
                    </strong>
                  </div>
                  <div>
                    <span>Arrive</span>
                    <strong>
                      {sgTime(selected?.arrival ?? resultPlan.recommended.arrival)}
                    </strong>
                  </div>
                </header>
                <button
                  type="button"
                  className="route-results-back"
                  onClick={() => {
                    setPlan(null);
                    setSelectedId(null);
                    snapJourneySheet(0);
                  }}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back to navigation
                </button>
                <div className="route-results-map">
                  <JourneyMap
                    request={request}
                    plan={resultPlan}
                    selected={selected}
                    location={currentLocation}
                    focusSelectedRoute
                    onViewAlerts={() => setModal("alerts")}
                    hasAlerts={disruptionAlerts.length > 0}
                  />
                </div>
                <button
                  type="button"
                  className="route-map-slider"
                  onPointerDown={startRouteMapResize}
                  aria-label="Drag down to enlarge the map, or up to show more trips"
                  aria-valuetext={`${routeMapShare}% of the screen for the map`}
                >
                  <span aria-hidden="true" />
                </button>
                <div className="trip-list" aria-label="Available trips">
                  {tripChoices.map((journey, tripIndex) => {
                    const segments = journey.segments.filter(
                      (segment) =>
                        segment.mode !== "walk" || Math.ceil(segment.minutes) >= 5,
                    );
                    const isSelected = selected?.id === journey.id;
                    return (
                      <article
                        className={`trip-card ${isSelected ? "selected" : ""} ${journey.blocked ? "blocked" : ""}`}
                        key={journey.id}
                      >
                        <button
                          type="button"
                          className="trip-select"
                          onClick={() => setSelectedId(journey.id)}
                          aria-label={`View Trip ${tripIndex + 1}, arriving ${sgTime(journey.arrival)}`}
                          aria-pressed={isSelected}
                        >
                          <span className="trip-card-heading">
                            <strong>Trip {tripIndex + 1}</strong>
                            <span>
                              {journey.duration} min · Arrive {sgTime(journey.arrival)}
                            </span>
                          </span>
                          <span className="trip-segments">
                            {segments.map((segment, segmentIndex) => {
                              const stationCodes = Array.from(
                                new Set(
                                  segment.hops
                                    ?.flatMap((hop) => hop.codes)
                                    .filter((code) =>
                                      /^(?:EW|NS|NE|CC|DT|TE|BP|PE|PW|SW|SE)\d+$/i.test(
                                        code,
                                      ),
                                    ) ?? [],
                                ),
                              );
                              const stopNames = Array.from(
                                new Set(
                                  segment.hops?.flatMap((hop) => [
                                    hop.from,
                                    hop.to,
                                  ]) ?? [segment.from, segment.to],
                                ),
                              );
                              const lineColor =
                                lineColors[segment.line] ??
                                lineColors[segment.mode];
                              return (
                                <span
                                  className={`trip-segment ${segment.mode}`}
                                  key={`${segment.id}-${segmentIndex}`}
                                >
                                  <span
                                    className="trip-line"
                                    style={
                                      { "--trip-line-color": lineColor } as React.CSSProperties
                                    }
                                  >
                                    <ModeIcon mode={segment.mode} size={15} />
                                    {segment.mode === "bus"
                                      ? `Bus ${segment.line}`
                                      : segment.mode === "rail"
                                        ? segment.line
                                        : `${Math.ceil(segment.minutes)} min walk`}
                                  </span>
                                  <span className="trip-segment-copy">
                                    {segment.mode === "rail" ? (
                                      <>
                                        <span>
                                          Board at <b>{segment.from}</b>
                                          {stationCodes[0] && (
                                            <em>{stationCodes[0]}</em>
                                          )}
                                        </span>
                                        <span>
                                          Alight at <b>{segment.to}</b>
                                          {stationCodes.length > 1 && (
                                            <em>{stationCodes.at(-1)}</em>
                                          )}
                                          {segment.direction && (
                                            <small>{segment.direction} direction</small>
                                          )}
                                        </span>
                                      </>
                                    ) : segment.mode === "bus" ? (
                                      <>
                                        <span>
                                          Board at <b>{segment.from}</b>
                                        </span>
                                        <span>
                                          Alight at <b>{segment.to}</b>
                                          {segment.direction && (
                                            <small>{segment.direction} direction</small>
                                          )}
                                        </span>
                                      </>
                                    ) : (
                                      <span>Walk to <b>{segment.to}</b></span>
                                    )}
                                  </span>
                                  {(segment.mode === "rail" ||
                                    segment.mode === "bus") && (
                                    <span
                                      className="trip-stop-track"
                                      aria-label={`${stopNames.length} stops on this service`}
                                    >
                                      {stopNames.map((name, stopIndex) => (
                                        <i
                                          className={
                                            stopIndex === 0 ||
                                            stopIndex === stopNames.length - 1
                                              ? "terminal"
                                              : ""
                                          }
                                          key={`${name}-${stopIndex}`}
                                          title={name}
                                        />
                                      ))}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </span>
                          {journey.blocked && (
                            <span className="trip-status">
                              <TriangleAlert size={14} /> Route affected
                            </span>
                          )}
                        </button>
                      </article>
                    );
                  })}
                </div>
                {selected &&
                  (!selected.blocked ||
                    canStartWithWeatherWarning(selected, resultPlan)) && (
                    <button
                      type="button"
                      className="route-results-start"
                      onClick={() =>
                        canStartWithWeatherWarning(selected, resultPlan)
                          ? setModal("route-warning")
                          : beginJourney(selected)
                      }
                    >
                      <Navigation size={17} aria-hidden="true" />
                      Start trip
                    </button>
                  )}
              </section>
            ) : (
            <div
              ref={journeyLayout}
              className={`journey-layout sheet-${
                ["expanded", "middle", "collapsed"][sheetSnap]
              } ${sheetDragging ? "sheet-dragging" : ""}`}
            >
              <div className="journey-map-slot">
                <JourneyMap
                  request={request}
                  plan={plan}
                  selected={selected}
                  location={currentLocation}
                  onViewAlerts={() => setModal("alerts")}
                  hasAlerts={disruptionAlerts.length > 0}
                />
              </div>
              {sheetSnap === 2 && (
                <button
                  type="button"
                  className="sheet-collapse-button sheet-return-control"
                  onClick={() => {
                    snapJourneySheet(0);
                    window.setTimeout(() => {
                      document
                        .getElementById("place-A")
                        ?.focus({ preventScroll: true });
                    }, 240);
                  }}
                  aria-label="Back to navigation"
                >
                  <span className="map-return-content" aria-hidden="true">
                    <span className="map-return-chevrons">
                      <ChevronUp size={17} />
                      <ChevronUp size={17} />
                    </span>
                    <span>Back to navigation</span>
                  </span>
                </button>
              )}
              <section className="journey-sheet" aria-label="Journey panel">
                <SheetDragHandle
                  controls="journey-sheet-content"
                  label="journey panel"
                  sheetSnap={sheetSnap}
                  sheetMoved={sheetMoved}
                  snapJourneySheet={snapJourneySheet}
                  startSheetDrag={startSheetDrag}
                />
                {sheetSnap === 0 && (
                  <button
                    type="button"
                    className="sheet-collapse-button sheet-map-control"
                    onClick={() => snapJourneySheet(2)}
                    aria-label="Show map and collapse journey panel"
                  >
                    <span className="map-collapse-content" aria-hidden="true">
                      <MapIcon size={16} />
                      <span>Show map</span>
                      <span className="map-collapse-chevrons">
                        <ChevronDown
                          className="map-collapse-chevron"
                          size={18}
                        />
                        <ChevronDown
                          className="map-collapse-chevron"
                          size={18}
                        />
                      </span>
                    </span>
                  </button>
                )}
                <div
                  id="journey-sheet-content"
                  className="journey-sheet-scroll"
                >
                  <aside className="planner-column">
                    <section className="planner-card">
                      <div
                        className="section-title sheet-drag-surface"
                        title="Drag to resize the journey panel"
                        onPointerDown={startSheetDrag}
                      >
                        <h2>Navigate</h2>
                        <div className="sheet-title-actions">
                          <button
                            type="button"
                            className="planner-preferences-trigger"
                            onClick={() => setModal("preferences")}
                            aria-label="Journey preferences"
                          >
                            Preferences
                          </button>
                        </div>
                      </div>
                      <form
                        id="journey-planner"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const next = leaveNow
                            ? {
                                ...request,
                                departure: new Date().toISOString(),
                              }
                            : request;
                          setRequest(next);
                          void runPlan(next, true);
                        }}
                      >
                        <div className="route-input-group">
                          <div className="place-inputs">
                            <PlacePicker
                              label="FROM"
                              fieldKey="A"
                              value={request.origin}
                              placeholder="Current location"
                              onActivate={() => snapJourneySheet(0)}
                              googlePlacesApiKey={
                                request.dataMode === "live"
                                  ? config?.googlePlacesApiKey
                                  : undefined
                              }
                              online={online}
                              onChange={(p) => {
                                clearLocation();
                                updateRequestAndPlan({ origin: p });
                              }}
                            />
                            <PlacePicker
                              label="TO"
                              fieldKey="B"
                              value={request.destination}
                              placeholder="Where to?"
                              googlePlacesApiKey={
                                request.dataMode === "live"
                                  ? config?.googlePlacesApiKey
                                  : undefined
                              }
                              online={online}
                              onChange={(p) =>
                                updateRequest({ destination: p })
                              }
                            />
                            <button
                              type="button"
                              className="swap-button"
                              aria-label="Swap From and To"
                              title="Swap From and To"
                              onClick={() => {
                                const nextOrigin =
                                  request.destination.id ===
                                  UNSET_DESTINATION.id
                                    ? UNSET_ORIGIN
                                    : request.destination;
                                const nextDestination =
                                  request.origin.id === UNSET_ORIGIN.id
                                    ? UNSET_DESTINATION
                                    : request.origin;
                                const next = {
                                  ...request,
                                  origin: nextOrigin,
                                  destination: nextDestination,
                                };
                                clearLocation();
                                setRequest(next);
                                if (isPlannable(next)) void runPlan(next);
                              }}
                            >
                              <ArrowDownUp size={18} aria-hidden="true" />
                            </button>
                          </div>
                          <div className="time-fields time-sequence">
                            {request.timeline ? (
                              <TimelineTimeCard value={request.departure} />
                            ) : (
                              <TimeScrollPicker
                                label="Leave"
                                value={sgTime(request.departure)}
                                isNow={leaveNow}
                                onNow={() => {
                                  setLeaveNow(true);
                                  updateRequest({
                                    departure: new Date().toISOString(),
                                  });
                                }}
                                onChange={(value) => {
                                  setLeaveNow(false);
                                  updateRequest({
                                    departure: `${dateValue(request.departure)}T${value}:00+08:00`,
                                  });
                                }}
                              />
                            )}
                            <TimeScrollPicker
                              label="Arrive"
                              value={
                                request.arriveBy
                                  ? sgTime(request.arriveBy)
                                  : undefined
                              }
                              onChange={(value) =>
                                updateRequest({
                                  arriveBy: `${dateValue(request.departure)}T${value}:00+08:00`,
                                })
                              }
                            />
                            <button
                              type="button"
                              className="location-button time-location-button"
                              onClick={useCurrentLocation}
                            >
                              Retry location
                            </button>
                          </div>
                        </div>
                        <div className="location-control">
                          {locationBusy && (
                            <span className="location-status" role="status">
                              <LoaderCircle className="spin" size={14} />{" "}
                              Finding your location…
                            </span>
                          )}
                          {currentLocation && (
                            <span className="location-status" role="status">
                              <span
                                className={`status-dot ${currentLocation.source === "demo" ? "amber" : ""}`}
                              />
                              {currentLocation.source === "demo"
                                ? "Simulated location active"
                                : `Device location · ±${Math.round(currentLocation.accuracy)} m`}
                            </span>
                          )}
                        </div>
                        {locationError && (
                          <p className="location-error" role="alert">
                            <TriangleAlert size={14} /> {locationError}
                          </p>
                        )}
                      </form>
                      <div className="planner-secondary-controls">
                        <div className="travel-date-field">
                          <CalendarDays size={14} />
                          <label>
                            <span className="sr-only">Travel date</span>
                            <input
                              aria-label="Travel date"
                              disabled={!!request.timeline}
                              type="date"
                              value={dateValue(request.departure)}
                              onChange={(e) => {
                                if (e.target.value)
                                  updateRequest({
                                    departure: `${e.target.value}T${sgTime(request.departure)}:00+08:00`,
                                    arriveBy: request.arriveBy
                                      ? `${e.target.value}T${sgTime(request.arriveBy)}:00+08:00`
                                      : undefined,
                                  });
                                setLeaveNow(false);
                              }}
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="journey-preferences-button"
                          onClick={() => setModal("preferences")}
                          aria-label={`Journey preferences: ${preferenceSummary.length ? preferenceSummary.join(", ") : "No extra preferences"}`}
                        >
                          <span>
                            <strong>Journey preferences</strong>
                            <small>
                              {preferenceSummary.length
                                ? preferenceSummary.join(" · ")
                                : "Choose walking, access, crowd and cycling options"}
                            </small>
                          </span>
                        </button>
                      </div>
                      {error && (
                        <div
                          className="error-banner planner-warning"
                          role="alert"
                        >
                          <TriangleAlert size={18} />
                          <span>{error}</span>
                          <button
                            type="button"
                            onClick={() => runPlan(request, true)}
                            className="text-button"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      <button
                        type="submit"
                        form="journey-planner"
                        className="primary-button plan-button"
                        disabled={loading || !online || !isPlannable(request)}
                      >
                        {loading ? "Finding your way…" : "Find my best route"}
                      </button>
                    </section>
                    <div className="routes-heading">
                      <h2>Routes</h2>
                      <span>
                        {plan
                          ? `${1 + plan.alternatives.length} routes`
                          : isPlannable(request)
                            ? "Ready to plan"
                            : "Choose where to go"}
                      </span>
                    </div>
                    <div
                      className={`route-options ${loading ? "updating" : ""}`}
                      aria-busy={loading}
                    >
                      {!plan && (
                        <div className="loading-card">
                          {loading ? (
                            <LoaderCircle size={22} className="spin" />
                          ) : (
                            <Navigation size={22} />
                          )}
                          <p>
                            {loading
                              ? "Connecting your door to your destination…"
                              : isPlannable(request)
                                ? "Ready when you are. Find your best route."
                                : "Choose a destination to see your route options."}
                          </p>
                        </div>
                      )}
                      {plan &&
                        visibleRouteChoices.map((journey, i) => (
                          <article
                            className={`route-card ${selectedId === journey.id ? "selected" : ""} ${journey.blocked ? "blocked" : ""}`}
                            key={journey.id}
                          >
                            <button
                              className="route-select"
                              onClick={() => setSelectedId(journey.id)}
                              aria-label={`View ${journey.title}, ${journey.duration} minutes`}
                              aria-pressed={selectedId === journey.id}
                            >
                              <div className="route-card-top">
                                <span
                                  className={
                                    i === 0
                                      ? "recommended-label"
                                      : "alternative-label"
                                  }
                                >
                                  {i === 0 &&
                                  canStartWithWeatherWarning(journey, plan) ? (
                                    <>
                                      <TriangleAlert size={12} /> WEATHER
                                      WARNING
                                    </>
                                  ) : i === 0 && journey.blocked ? (
                                    <>
                                      <TriangleAlert size={12} /> WAIT FOR SAFER
                                      CONDITIONS
                                    </>
                                  ) : i === 0 ? (
                                    <>
                                      <Sparkles size={12} /> BEST FIT FOR YOU
                                    </>
                                  ) : journey.id === plan.original.id ? (
                                    "YOUR USUAL ROUTE"
                                  ) : (
                                    "ANOTHER WAY THERE"
                                  )}
                                </span>
                                <span className="selection-circle">
                                  {selectedId === journey.id && (
                                    <Check size={11} />
                                  )}
                                </span>
                              </div>
                              <div className="route-summary">
                                <span className="duration">
                                  {journey.duration}
                                  <small>min</small>
                                </span>
                                <span className="arrival">
                                  Arrive {sgTime(journey.arrival)}
                                  <small>
                                    {journey.range[0]}–{journey.range[1]} min
                                    estimated
                                  </small>
                                </span>
                              </div>
                              <div className="route-pills">
                                {journey.segments.map((s, index) => (
                                  <span
                                    className="pill-group"
                                    key={`${s.id}-${index}`}
                                  >
                                    <LinePill segment={s} />
                                    {index < journey.segments.length - 1 && (
                                      <ChevronRight size={11} />
                                    )}
                                  </span>
                                ))}
                              </div>
                              <div className="route-card-footer">
                                <CrowdBadge crowd={journey.crowd} />
                                <span>
                                  {journey.transfers === 0
                                    ? "No transfers"
                                    : `${journey.transfers} transfer${journey.transfers > 1 ? "s" : ""}`}
                                </span>
                              </div>
                              {!journey.blocked && (
                                <span className="route-points">
                                  <Leaf size={14} aria-hidden="true" />
                                  {pointsAlreadyCollected
                                    ? "Points already collected for this trip"
                                    : `${journeyPoints(journey, plan.original).total} ${request.dataMode === "demo" ? "demo " : ""}points on completion`}
                                  {!pointsAlreadyCollected &&
                                    journeyPoints(journey, plan.original)
                                      .quieterRoute > 0 && (
                                      <small>
                                        Includes +20 for a quieter route
                                      </small>
                                    )}
                                </span>
                              )}
                              {(journey.blocked ||
                                canStartWithWeatherWarning(journey, plan)) && (
                                <span className="route-warning">
                                  <TriangleAlert size={13} />
                                  {canStartWithWeatherWarning(journey, plan)
                                    ? "Severe weather affects exposed sections"
                                    : "Affected by closure or access restriction"}
                                </span>
                              )}
                              {journey.duration > journey.baselineDuration && (
                                <span className="route-warning">
                                  +{journey.duration - journey.baselineDuration}{" "}
                                  min from current conditions
                                </span>
                              )}
                            </button>
                            {selectedId === journey.id &&
                              (!journey.blocked ||
                                canStartWithWeatherWarning(journey, plan)) && (
                                <div className="route-start-action">
                                  <span>
                                    {canStartWithWeatherWarning(
                                      journey,
                                      plan,
                                    ) ? (
                                      <TriangleAlert
                                        size={14}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <Check size={14} aria-hidden="true" />
                                    )}{" "}
                                    {canStartWithWeatherWarning(journey, plan)
                                      ? "Weather-affected route selected"
                                      : "Selected route"}
                                  </span>
                                  <button
                                    type="button"
                                    className={`primary-button ${canStartWithWeatherWarning(journey, plan) ? "weather-warning-button" : ""}`}
                                    aria-label={
                                      canStartWithWeatherWarning(journey, plan)
                                        ? `Start ${journey.title} despite current weather warning`
                                        : `Start ${journey.title}`
                                    }
                                    onClick={() =>
                                      canStartWithWeatherWarning(journey, plan)
                                        ? setModal("route-warning")
                                        : beginJourney(journey)
                                    }
                                  >
                                    <Navigation size={17} aria-hidden="true" />
                                    {canStartWithWeatherWarning(journey, plan)
                                      ? `Review & start ${journey.title}`
                                      : `Start ${journey.title}`}
                                    <ArrowRight size={17} aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                          </article>
                        ))}
                    </div>
                    {routeChoices.length > 2 && (
                      <button
                        className="load-more-routes"
                        type="button"
                        onClick={() => setShowAllRoutes((value) => !value)}
                        aria-expanded={showAllRoutes}
                      >
                        {showAllRoutes
                          ? "Show fewer routes"
                          : "Load more routes"}
                        <ChevronDown
                          size={16}
                          className={showAllRoutes ? "expanded" : ""}
                        />
                      </button>
                    )}
                    {plan && (
                      <button
                        className={`save-button ${savedRoutine ? "saved" : ""}`}
                        onClick={() => void saveCommute()}
                        disabled={request.dataMode === "demo"}
                      >
                        {savedRoutine ? (
                          <CheckCheck size={17} />
                        ) : (
                          <Bookmark size={17} />
                        )}{" "}
                        {request.dataMode === "demo"
                          ? "Faux account route"
                          : savedRoutine
                            ? "Route saved"
                            : "Save route"}
                      </button>
                    )}
                  </aside>
                  <div className="journey-content">
                    <section
                      className={`recommendation ${plan?.recommended.blocked ? "caution" : ""}`}
                      aria-live="polite"
                    >
                      <div className="recommendation-icon">
                        {plan?.recommended.blocked ? (
                          <TriangleAlert size={23} />
                        ) : (
                          <Sparkles size={23} />
                        )}
                      </div>
                      <div>
                        <h2>
                          {plan
                            ? plan.recommended.blocked
                              ? canStartWithWeatherWarning(
                                  plan.recommended,
                                  plan,
                                )
                                ? "Severe weather on this route"
                                : "Route unavailable"
                              : `Routes · Use ${plan.recommended.title}`
                            : "Where to?"}
                        </h2>
                        <p>
                          {plan
                            ? plan.advice
                            : "Choose a destination and we’ll compare the best ways there."}
                        </p>
                      </div>
                      <button
                        className="icon-button"
                        onClick={() => setModal("chat")}
                        aria-label={
                          plan
                            ? "Ask why this route was recommended"
                            : "Open journey companion"
                        }
                      >
                        <ArrowRight size={21} />
                      </button>
                    </section>
                    <div className="journey-insights">
                      <div>
                        <span className="insight-icon">
                          <Footprints size={20} />
                        </span>
                        <span>
                          <small>Door to door</small>
                          <strong>
                            {selected
                              ? `${Math.ceil(selected.walkMinutes)} min walking`
                              : "Walking legs included"}
                          </strong>
                        </span>
                      </div>
                    </div>
                    {selected && (
                      <>
                        <section className="steps-card">
                          <div className="section-title">
                            <h2>Directions</h2>
                            <button
                              className="text-button"
                              onClick={() =>
                                setExpanded(
                                  expanded === selected.id ? null : selected.id,
                                )
                              }
                            >
                              {expanded === selected.id
                                ? "Less detail"
                                : "Full details"}{" "}
                              <ChevronDown size={16} />
                            </button>
                          </div>
                          <div className="timeline">
                            {selected.segments.map((s, i) => (
                              <div
                                className={`timeline-step ${s.affected ? "affected" : ""}`}
                                key={`${s.id}-${i}`}
                              >
                                <div
                                  className="step-icon"
                                  style={{
                                    color:
                                      lineColors[s.line] ?? lineColors[s.mode],
                                  }}
                                >
                                  <ModeIcon mode={s.mode} size={18} />
                                </div>
                                <div>
                                  <h3>
                                    {s.mode === "walk"
                                      ? `Walk to ${s.to}`
                                      : s.mode === "cycle"
                                        ? `Cycle to ${s.to}`
                                        : s.mode === "bus"
                                          ? busActionLabel(
                                              s,
                                              precedingTransitSegment(
                                                selected.segments,
                                                i,
                                              ),
                                            )
                                        : `${s.line} to ${s.to}`}
                                  </h3>
                                  {s.mode === "bus" ? (
                                    <BusStopLabels
                                      segment={s}
                                      previous={precedingTransitSegment(
                                        selected.segments,
                                        i,
                                      )}
                                    />
                                  ) : (
                                    <p>
                                      {s.mode === "walk" ? (
                                      <>
                                        {Math.round(s.distance)} m{" "}
                                        {s.sheltered && (
                                          <span
                                            className="shelter-mark"
                                            title="Mapped sheltered walkway"
                                            aria-label="Mapped sheltered walkway"
                                          >
                                            <Umbrella size={13} />
                                          </span>
                                        )}
                                      </>
                                    ) : s.mode === "rail" ? (
                                      `${s.direction ?? s.instructions.match(/towards ([^.]+)/i)?.[1] ?? s.to} direction · From ${s.from}${s.affected ? " · Service affected" : ""}`
                                    ) : (
                                      `From ${s.from}${s.affected ? " · Service affected" : ""}`
                                    )}
                                    </p>
                                  )}
                                  {s.mode === "walk" && (
                                    <p className="segment-shelter-summary">
                                      <Umbrella size={13} aria-hidden="true" />
                                      {shelterSummary(s)}
                                    </p>
                                  )}
                                  {expanded === selected.id && (
                                    <p className="step-detail">
                                      {s.instructions}
                                    </p>
                                  )}
                                  {(s.mode === "bus" || s.mode === "rail") && (
                                    <p
                                      className={`segment-crowding ${s.crowd}`}
                                    >
                                      <UsersRound
                                        size={14}
                                        aria-hidden="true"
                                      />
                                      {crowdDescription(s)}
                                    </p>
                                  )}
                                  {s.geometryKind === "schematic" && (
                                    <p className="step-detail">
                                      Served stops highlighted · road geometry
                                      unavailable
                                    </p>
                                  )}
                                </div>
                                <span className="step-duration">
                                  {Math.ceil(s.minutes)} min
                                </span>
                              </div>
                            ))}
                          </div>
                          {expanded === selected.id && (
                            <div className="journey-caveats">
                              {selected.warnings.map((w) => (
                                <p key={w}>
                                  <Info size={14} />
                                  {w}
                                </p>
                              ))}
                              <p>
                                {selected.source} · © OpenStreetMap contributors
                              </p>
                            </div>
                          )}
                        </section>
                      </>
                    )}
                  </div>
                  {relevantPlannedNotice && (
                    <section className="heads-up-strip">
                      <span className="heads-up-icon">
                        <CalendarDays size={24} />
                      </span>
                      <div>
                        <h3>{relevantPlannedNotice.title}</h3>
                        <p>{relevantPlannedNotice.description}</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setTab("updates")}
                      >
                        See planned updates <ArrowRight size={16} />
                      </button>
                    </section>
                  )}
                </div>
              </section>
            </div>
            )}
          </>
        )}
        {tab === "commutes" && (
          <section className="saved-page">
            {commutes.length ? (
              <div className="saved-commute-list">
                {commutes.map((commute) => (
                  <div className="saved-journey-card" key={commute.id}>
                    <div className="routine-top">
                      <span className="routine-icon">
                        <House size={27} />
                      </span>
                      <span className="tag">
                        {request.dataMode === "demo"
                          ? "FAUX DEMO COMMUTE"
                          : accountUser
                            ? "SYNCED WITH GOOGLE"
                            : "SAVED IN GUEST SPACE"}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${commute.label}`}
                        onClick={() => void removeCommute(commute)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <h2>
                      {commute.request.origin.name} <ArrowRight size={19} />{" "}
                      {commute.request.destination.name}
                    </h2>
                    <p>
                      Daily commute · Leave at{" "}
                      {sgTime(commute.request.departure)}
                      {commute.request.arriveBy
                        ? ` · Arrive by ${commute.timeSensitive}`
                        : ""}
                    </p>
                    <div className="preference-chips">
                      <span>Time-sensitive · {commute.timeSensitive}</span>
                      <span>
                        {commute.request.preferences.stepFree
                          ? "Step-free preference"
                          : commute.request.preferences.sheltered
                            ? effectiveShelterMode(
                                commute.request.preferences,
                              ) === "require"
                              ? "Mapped shelter required"
                              : "Sheltered walks preferred"
                            : "Standard walking"}
                      </span>
                      <span>
                        Alert only at +
                        {commute.request.preferences.alertThreshold} min
                      </span>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => loadCommute(commute)}
                    >
                      Check this commute <ArrowRight size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state saved-empty">
                <Bookmark size={30} />
                <h2>No daily commutes saved yet</h2>
                <p>
                  Plan a journey, tune its preferences, then save it here for
                  faster daily checks.
                </p>
              </div>
            )}
            {request.dataMode === "live" && commutes.length > 0 && (
              <div className="reminder-card">
                <BellRing size={29} />
                <h2>A heads-up, before you head out.</h2>
                <p>
                  Check conditions before your departure and planned closures
                  the day before. We’ll interrupt only when the change meets
                  your threshold.
                </p>
                <p className="privacy-note">
                  Enabling reminders shares your route, departure time,
                  preferences and push subscription with our Google Cloud
                  backend for 30 days. Remove them in preferences at any time.
                </p>
                <button className="secondary-button" onClick={enableReminders}>
                  Enable commute reminders <Bell size={16} />
                </button>
                {!config?.integrations.push && (
                  <small>
                    Cloud reminders are awaiting deployment configuration.
                  </small>
                )}
              </div>
            )}
            <button
              className="add-commute"
              onClick={() => {
                setTab("today");
              }}
            >
              <Plus size={22} />
              <span>
                Plan another daily commute
                <small>Choose places, time and your own preferences</small>
              </span>
              <ArrowRight size={18} />
            </button>
          </section>
        )}
        {tab === "updates" && (
          <section className="updates-page">
            <div>
              <div className="section-title">
                <h2>On your radar</h2>
                <button
                  className="text-button"
                  onClick={() => runPlan(request)}
                >
                  <RefreshCw size={15} className={loading ? "spin" : ""} />{" "}
                  Refresh
                </button>
              </div>
              {plan?.conditions.notices.length ? (
                plan.conditions.notices.map((n) => (
                  <article key={n.id} className={`notice-card ${n.severity}`}>
                    <span className="notice-icon">
                      {n.kind === "planned" ? (
                        <CalendarDays />
                      ) : n.kind === "lift" ? (
                        <Accessibility />
                      ) : n.kind === "weather" ? (
                        <Umbrella />
                      ) : (
                        <TriangleAlert />
                      )}
                    </span>
                    <div>
                      <div className="notice-meta">
                        <span className="tag">
                          {n.kind === "planned"
                            ? "PLANNED"
                            : n.kind === "lift"
                              ? "ACCESSIBILITY"
                              : n.kind.toUpperCase()}
                        </span>
                        {n.line && <b>{n.line}</b>}
                        {plan.conditions.mode === "demo" && (
                          <span className="demo-tag">SIMULATED</span>
                        )}
                      </div>
                      <h3>{n.title}</h3>
                      <p>{n.description}</p>
                      {n.freeBus && (
                        <p className="mitigation">
                          <BusFront size={16} />
                          {n.freeBus}
                        </p>
                      )}
                      {n.shuttle && (
                        <p className="mitigation">
                          <BusFront size={16} />
                          MRT shuttle: {n.shuttle}
                        </p>
                      )}
                      <small>
                        {new Date(n.startsAt).toLocaleString("en-SG", {
                          timeZone: "Asia/Singapore",
                        })}{" "}
                        · {n.source}
                      </small>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <CheckCheck size={30} />
                  <h3>No notices in the available feed</h3>
                  <p>
                    Check source availability below; an unavailable feed does
                    not mean normal service.
                  </p>
                </div>
              )}
            </div>
            <div className="feed-panel">
              <h2>Know what you’re looking at.</h2>
              <p>Source and freshness travel with every recommendation.</p>
              {plan?.conditions.feeds.map((f, i) => (
                <div className="feed-row" key={`${f.name}-${i}`}>
                  <span
                    className={`status-dot ${f.status === "demo" ? "amber" : f.status === "unavailable" || f.status === "stale" ? "muted" : ""}`}
                  />
                  <span>
                    <strong>{f.name}</strong>
                    <small>{f.detail}</small>
                  </span>
                  <span className={`feed-status ${f.status}`}>{f.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="demo-toolbar">
          <span>
            <span
              className={`status-dot ${request.dataMode === "demo" ? "amber" : ""}`}
            />
            {request.dataMode === "demo" ? "Demo mode" : "Live LTA + NEA"}
            <small>
              {request.dataMode === "demo"
                ? "Selected profile · simulated incident"
                : "Concurrent official feeds"}
            </small>
          </span>
          {request.dataMode === "demo" && (
            <button className="text-button" onClick={exitDemo}>
              Exit demo
            </button>
          )}
          <button
            className="text-button data-source-button"
            onClick={() => setModal("sources")}
          >
            Data & sources <ArrowRight size={14} />
          </button>
        </div>
        {developerMode && request.dataMode === "demo" && (
          <section className="demo-test-panel" aria-label="Demo test controls">
            <h2 className="sr-only">Demo test controls</h2>
            <label className="demo-template-option">
              <span className="demo-template-label">Profile</span>
              <span className="demo-template-value">
                {selectedDemoProfile.name}
                <ChevronDown size={15} aria-hidden="true" />
              </span>
              <select
                aria-label="Demo profile"
                value={demoPersona}
                onChange={(event) => {
                  const persona = event.target.value as Persona;
                  setDemoPersona(persona);
                  runDemoSelection(persona, timelineKind);
                }}
              >
                {demoProfiles.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="demo-template-option">
              <span className="demo-template-label">Timeline</span>
              <span className="demo-template-value">
                {timelineKind === "control"
                  ? "Control · no events"
                  : "Eventful"}
              </span>
              <select
                aria-label="Demo timeline"
                value={timelineKind}
                onChange={(event) => {
                  const kind = event.target.value as "control" | "eventful";
                  setTimelineKind(kind);
                  runDemoSelection(demoPersona, kind);
                }}
              >
                <option value="control">Control · no events</option>
                <option value="eventful">Eventful</option>
              </select>
            </label>
            {request.timeline && (
              <TimelineControls
                key={request.timeline.id}
                selection={request.timeline}
                busy={loading || modal !== null}
                onChange={(timeline) => {
                  const value = {
                    ...request,
                    timeline,
                    departure: timelineTime(timeline),
                  };
                  setRequest(value);
                  void runPlan(value);
                }}
              />
            )}
          </section>
        )}
        <footer className="site-footer">
          <span>
            {plan
              ? `${stale ? "Last saved" : "Updated"} ${sgTime(plan.generatedAt)} SGT`
              : "Planning your journey"}{" "}
            ·{" "}
            <button onClick={() => setModal("sources")}>Data & privacy</button>
            {" · "}
            {developerMode && (
              <>
                <button onClick={() => setModal("demo")}>
                  Developer demos
                </button>
                {" · "}
              </>
            )}
            <span className="footer-credit">© OpenStreetMap contributors</span>
          </span>
        </footer>
      </main>
      {!primaryPage && (
        <button
          className="companion-button"
          onClick={() => setModal("chat")}
          aria-label="Open Chatbot"
        >
          <span>
            <img src="/waycey-avatar.svg" alt="" />
          </span>
          Waycey
        </button>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-button compact"
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "route-warning" &&
        plan &&
        selectedJourney &&
        canStartWithWeatherWarning(selectedJourney, plan) && (
          <Modal title="Review route warnings" onClose={() => setModal(null)}>
            <div className="modal-body route-override-warning">
              <RouteConditionWarnings journey={selectedJourney} plan={plan} />
              <p>
                <strong>{selectedJourney.title}</strong> includes exposed travel
                during severe weather. Wayce recommends waiting and cannot
                verify that those sections are safe right now.
              </p>
              <p>
                If you choose to continue, both weather and service warnings
                will remain visible during navigation.
              </p>
              <button
                type="button"
                className="primary-button weather-warning-button full"
                onClick={() => beginJourney(selectedJourney, true)}
              >
                I understand — start {selectedJourney.title}
              </button>
              <button
                type="button"
                className="secondary-button full"
                onClick={() => setModal(null)}
              >
                Keep waiting
              </button>
            </div>
          </Modal>
        )}
      {modal === "proactive" && proactiveWarning && (
        <Modal
          title="Leave earlier or change route"
          onClose={() => setModal(null)}
        >
          <div className="modal-body proactive-warning">
            <TriangleAlert size={34} />
            <p>
              This common route is delayed by {proactiveWarning.delay} minutes.
              To keep your {proactiveWarning.targetTime} time target, leave by{" "}
              <strong>{sgTime(proactiveWarning.leaveAt)}</strong> or use the
              suggested alternative route.
            </p>
            <button
              className="primary-button"
              onClick={() => {
                setSelectedId(plan?.recommended.id ?? null);
                setTab("today");
                setModal(null);
              }}
            >
              View alternative route <ArrowRight size={16} />
            </button>
            <button className="text-button" onClick={() => setModal(null)}>
              Dismiss
            </button>
          </div>
        </Modal>
      )}
      {modal === "alerts" && (
        <Modal title="Service disruptions" onClose={() => setModal(null)}>
          <div className="modal-body disruption-alerts">
            {disruptionAlerts.length ? (
              disruptionAlerts.map((notice) => (
                <article
                  key={notice.id}
                  className={`notice-card ${notice.severity}`}
                >
                  <span className="notice-icon">
                    <TriangleAlert />
                  </span>
                  <div>
                    <div className="notice-meta">
                      <span className="tag">
                        {notice.kind === "planned"
                          ? "PLANNED DISRUPTION"
                          : "DISRUPTION"}
                      </span>
                      {notice.line && <b>{notice.line}</b>}
                      {plan?.conditions.mode === "demo" && (
                        <span className="demo-tag">SIMULATED</span>
                      )}
                    </div>
                    <h3>{notice.title}</h3>
                    <p>{notice.description}</p>
                    <small>
                      {new Date(notice.startsAt).toLocaleString("en-SG", {
                        timeZone: "Asia/Singapore",
                      })}{" "}
                      · {notice.source}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <CheckCheck size={30} />
                <h3>No service disruptions in the available feed</h3>
                <p>
                  Wayce does not predict disruptions. An unavailable feed does
                  not mean normal service.
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === "weather" && (
        <Modal title="Weather right now" onClose={() => setModal(null)}>
          <div className="modal-body weather-detail">
            <div className="weather-detail-summary">
              <span className="weather-detail-icon">
                <WeatherStatusIcon
                  forecast={forecast}
                  rain={headerWeather?.rain ?? false}
                />
              </span>
              <span>
                <small>{weatherState || "Current conditions"}</small>
                <strong>{forecast}</strong>
                <time dateTime={clockDate.toISOString()}>
                  {clockLabel} Singapore time
                </time>
              </span>
            </div>
            <div className="weather-detail-grid">
              <div>
                <small>Temperature</small>
                <strong>
                  {headerWeather?.temperature !== undefined
                    ? `${Math.round(headerWeather.temperature)}°C`
                    : "Not reported"}
                </strong>
              </div>
              <div>
                <small>Rainfall</small>
                <strong>
                  {headerWeather?.rainfallMm !== undefined
                    ? `${headerWeather.rainfallMm.toFixed(1)} mm`
                    : "Not reported"}
                </strong>
              </div>
              <div>
                <small>Walking</small>
                <strong>
                  {headerWeather?.walkStatus === "invalid"
                    ? "Not recommended"
                    : headerWeather?.walkStatus === "limited"
                      ? "Use extra care"
                      : headerWeather
                        ? "Normal"
                        : "Unavailable"}
                </strong>
              </div>
              <div>
                <small>Cycling</small>
                <strong>
                  {headerWeather?.cycleStatus === "invalid"
                    ? "Not recommended"
                    : headerWeather?.cycleStatus === "limited"
                      ? "Use extra care"
                      : headerWeather
                        ? "Normal"
                        : "Unavailable"}
                </strong>
              </div>
            </div>
            <div className="weather-detail-source">
              <span
                className={`status-dot ${request.dataMode === "demo" ? "amber" : weatherFeed?.status === "stale" || weatherFeed?.status === "unavailable" || !online ? "muted" : ""}`}
              />
              <span>
                <strong>
                  {weatherFeed?.name ?? "Weather source unavailable"}
                </strong>
                <small>
                  {!online
                    ? "Offline · showing the last available conditions"
                    : (weatherFeed?.detail ??
                      "No current weather source is available")}
                  {weatherFeed?.updatedAt
                    ? ` · Updated ${new Date(weatherFeed.updatedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", hour12: true })}`
                    : ""}
                </small>
              </span>
            </div>
            <p className="weather-detail-note">
              {request.dataMode === "demo"
                ? "Simulated weather follows the isolated demo timeline and is not a live observation."
                : "Weather is matched to your foreground device location. Conditions can change between updates."}
            </p>
          </div>
        </Modal>
      )}
      {modal === "profile" && (
        <main className="nav-page" aria-labelledby="account-page-title">
          <header className="nav-page-header">
            <h1 id="account-page-title">Account</h1>
          </header>
          <div className="modal-body nav-page-body">
            <div
              className={`account-card ${request.dataMode === "demo" ? "demo" : ""}`}
            >
              <span className="persona-avatar">
                {request.dataMode === "demo"
                  ? selectedDemoProfile.name[0]
                  : (accountUser?.name?.[0]?.toUpperCase() ?? "G")}
              </span>
              <span>
                <strong>
                  {request.dataMode === "demo"
                    ? `${selectedDemoProfile.name} · Faux account`
                    : (accountUser?.name ?? "Guest")}
                </strong>
                <small>
                  {request.dataMode === "demo"
                    ? `${demoPersona}.demo@wayce.invalid · never synced`
                    : (accountUser?.email ??
                      "Preferences and commutes stay on this device")}
                </small>
              </span>
            </div>
            {request.dataMode === "demo" ? (
              <p className="privacy-note">
                This simulated account is isolated. Changes, reminders and
                locations are discarded when you exit the demo.
              </p>
            ) : accountUser ? (
              <>
                <p className="privacy-note">
                  Preferences and up to ten daily commutes sync to your verified
                  Google account. Demo data is never uploaded.
                </p>
                <button
                  className="secondary-button full"
                  disabled={accountBusy}
                  onClick={() => void signOut()}
                >
                  <DoorOpen size={16} /> Sign out
                </button>
              </>
            ) : config?.integrations?.googleAccounts &&
              config.googleClientId ? (
              <>
                <p className="privacy-note">
                  Continue with Google to merge this guest space and sync your
                  preferences and daily commutes across sessions.
                </p>
                <GoogleSignIn
                  clientId={config.googleClientId}
                  busy={accountBusy}
                  onCredential={signInWithGoogle}
                />
              </>
            ) : (
              <p className="privacy-note">
                Google account sync is not configured on this server. Guest mode
                remains fully usable.
              </p>
            )}
            {accountError && (
              <p className="error-copy" role="alert">
                {accountError}
              </p>
            )}
            <button
              className="account-preferences-link"
              onClick={() => setModal("preferences")}
            >
              <Settings2 size={23} />
              <span>
                <strong>Preferences</strong>
                <small>Travel choices, accessibility &amp; privacy</small>
              </span>
              <ChevronRight size={20} />
            </button>
            <div className="developer-options">
              <h3>Developer options</h3>
              <label className="toggle-row">
                <Settings2 size={21} />
                <span>
                  <strong>Developer mode</strong>
                  <small>
                    Show isolated persona demos and simulation controls
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={developerMode}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setDeveloperMode(enabled);
                    persist(DEVELOPER_KEY, enabled);
                    if (!enabled && request.dataMode === "demo") exitDemo();
                  }}
                />
              </label>
              {developerMode && (
                <button
                  className="secondary-button full"
                  onClick={() => setModal("demo")}
                >
                  Open demo presets <ArrowRight size={16} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="secondary-button full"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={17} /> Help &amp; app guide
            </button>
          </div>
        </main>
      )}
      {modal === "preferences" && (
        <main className="nav-page" aria-labelledby="preferences-page-title">
          <header className="nav-page-header">
            <button className="text-button" onClick={() => setModal("profile")}>
              <ArrowLeft size={16} /> Account
            </button>
            <h1 id="preferences-page-title">Preferences</h1>
          </header>
          <div className="modal-body nav-page-body">
            {(
              [
                {
                  key: "stepFree",
                  title: "Avoid stairs",
                  description: "Exclude mapped stairs and known lift outages",
                  icon: Accessibility,
                },
                {
                  key: "avoidCrowds",
                  title: "A little more breathing room",
                  description: "Give quieter routes more weight",
                  icon: UsersRound,
                },
                {
                  key: "cycling",
                  title: "Bring cycling into the mix",
                  description:
                    "Consider a cycle to the station; park before boarding",
                  icon: Bike,
                },
              ] as const
            ).map((p) => (
              <label className="toggle-row" key={p.key}>
                <p.icon size={21} />
                <span>
                  <strong>{p.title}</strong>
                  <small>{p.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={request.preferences[p.key]}
                  onChange={(e) =>
                    updatePreferences({
                      [p.key]: e.target.checked,
                      ...(p.key === "stepFree"
                        ? { walkingSpeed: e.target.checked ? 40 : 75 }
                        : {}),
                    })
                  }
                />
              </label>
            ))}
            <label className="preference-select-row">
              <Umbrella size={21} />
              <span>
                <strong>Sheltered walking</strong>
                <small>
                  Prefer shelter, or require complete mapped coverage with only
                  a short coordinate tolerance.
                </small>
              </span>
              <select
                aria-label="Sheltered walking preference"
                value={effectiveShelterMode(request.preferences)}
                onChange={(event) => {
                  const mode = event.target.value as
                    "none" | "prefer" | "require";
                  updatePreferences({
                    sheltered: mode !== "none",
                    shelterMode: mode === "require" ? "require" : "prefer",
                  });
                }}
              >
                <option value="none">No preference</option>
                <option value="prefer">Prefer mapped shelter</option>
                <option value="require">Require mapped shelter</option>
              </select>
            </label>
            <label className="toggle-row">
              <span className="text-size-icon">Aa</span>
              <span>
                <strong>Larger, easier-to-read text</strong>
                <small>A little more space, everywhere</small>
              </span>
              <input
                type="checkbox"
                checked={largeText}
                onChange={(e) => setLargeText(e.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <ShieldCheck size={21} />
              <span>
                <strong>Companion data sharing</strong>
                <small>
                  Allow route context, recent chat and voice drafts you send.
                  Browser voice recognition may use its vendor’s online service.
                </small>
              </span>
              <input
                type="checkbox"
                aria-label="Companion data sharing"
                checked={companionConsent}
                onChange={(event) => {
                  const consent = event.target.checked;
                  setCompanionConsent(consent);
                  persist(COMPANION_CONSENT_KEY, consent);
                }}
              />
            </label>
            <div className="settings-fields">
              <label>
                Maximum walk (m)
                <input
                  type="number"
                  min="200"
                  max="3500"
                  step="100"
                  value={request.preferences.maxWalk}
                  onChange={(e) =>
                    updatePreferences({
                      maxWalk: Math.min(
                        3500,
                        Math.max(200, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
              <label>
                Alert at extra minutes
                <input
                  type="number"
                  min="3"
                  max="60"
                  value={request.preferences.alertThreshold}
                  onChange={(e) =>
                    updatePreferences({
                      alertThreshold: Math.min(
                        60,
                        Math.max(3, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <button
              className="primary-button full"
              onClick={() => {
                void storeRealState(buildAccountState());
                if (isPlannable(request)) void runPlan(request);
                notify("Preferences saved.");
                setModal("profile");
              }}
            >
              Apply my preferences <ArrowRight size={17} />
            </button>
            <button
              className="text-button danger delete-data"
              onClick={deleteData}
            >
              <Trash2 size={15} /> Delete my saved data and reminders
            </button>
          </div>
        </main>
      )}
      {modal === "chat" && (
        <Modal
          title="Waycey - Your Commute Companion"
          onClose={() => setModal(null)}
        >
          <Companion
            plan={plan}
            request={request}
            consent={companionConsent}
            onConsentChange={(consent) => {
              setCompanionConsent(consent);
              persist(COMPANION_CONSENT_KEY, consent);
            }}
            onApply={(preferences) => {
              const nextHardPreferences = {
                ...hardPreferences,
                ...preferences,
              };
              const value = {
                ...request,
                preferences: { ...request.preferences, ...preferences },
              };
              setHardPreferences(nextHardPreferences);
              setRequest(value);
              void runPlan(value);
              if (request.dataMode === "live")
                void storeRealState(
                  buildAccountState({
                    preferences: value.preferences,
                    hardPreferences: nextHardPreferences,
                  }),
                );
              notify("Preferences applied to your route.");
            }}
            config={config}
            onSelectRoute={(id) => {
              const option =
                plan &&
                [plan.recommended, ...plan.alternatives].find(
                  (j) => j.id === id && !j.blocked,
                );
              if (!option) return;
              setSelectedId(option.id);
              setModal(null);
              notify(
                `Selected ${option.title}. Review the journey before leaving.`,
              );
            }}
          />
        </Modal>
      )}
      {modal === "demo" && (
        <Modal title="Developer demos" onClose={() => setModal(null)}>
          <div className="modal-body">
            <p className="muted">
              Load a complete faux account with deterministic commute,
              preferences, time, location and simulated conditions. Nothing in
              this menu writes to a guest or Google account.
            </p>
            <h3>Faux account preset</h3>
            <div className="persona-options">
              {profiles.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    setDemoPersona(candidate.id);
                  }}
                  className={
                    demoPersona === candidate.id ? "persona active" : "persona"
                  }
                >
                  <span className="persona-avatar">
                    {candidate.id === "lim" ? "ML" : candidate.name[0]}
                  </span>
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{candidate.label}</small>
                  </span>
                  {demoPersona === candidate.id && <Check size={18} />}
                </button>
              ))}
            </div>
            <h3>Timeline</h3>
            <label className="demo-scenario-field">
              <span>Demo timeline preset</span>
              <select
                value={timelineKind}
                onChange={(event) =>
                  setTimelineKind(event.target.value as "control" | "eventful")
                }
              >
                <option value="control">Control · no events</option>
                <option value="eventful">Eventful</option>
              </select>
            </label>
            <p className="muted">
              Synthetic time starts at {selectedDemoProfile.departure} on 21
              September 2026. Playback replans from the selected origin; journey
              progress stays manual.
            </p>
            <ul>
              {timelineDefinition(
                `${demoPersona}-${timelineKind}` as TimelineId,
              ).events.map((event) => (
                <li key={event.minute}>
                  +{event.minute} min: {event.label}
                </li>
              ))}
            </ul>
            <button className="primary-button full" onClick={startDemo}>
              Start demo <ArrowRight size={17} />
            </button>
            {request.dataMode === "demo" && (
              <button className="secondary-button full" onClick={exitDemo}>
                Return to my real account and live data
              </button>
            )}
          </div>
        </Modal>
      )}
      {modal === "sources" && (
        <Modal
          title="Good advice starts with honest data"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p>
              Normal mode requests LTA DataMall and NEA feeds concurrently and
              marks every signal with its source and availability. Demo
              scenarios use local OSM and DataMall routes with simulated
              disruptions, crowds, weather and works. Demo location is labelled;
              normal live mode requests a one-shot device location when it
              opens, with a visible manual fallback if permission fails.
            </p>
            <h3>Maps & route estimates</h3>
            <p>
              ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap contributors
              </a>
              , ODbL. The bundled extract powers offline map/search fallback and
              routing. When configured in normal mode, Wayce's address-search
              interface requests Singapore suggestions from Google Maps; typed
              searches are sent to Google and the selected coordinate is routed
              on Wayce's local graph. Google does not calculate the journey.
              Local timings are estimates; coverage, station access and shelter
              are not fully verified.
            </p>
            <h3>Official transport data</h3>
            <p>
              Train schedules and live transport conditions contain information
              from LTA DataMall. The committed timetable is planned service, not
              a guarantee of actual movement, and is made available under the{" "}
              <a
                href="https://datamall.lta.gov.sg/content/datamall/en/SingaporeOpenDataLicence.html"
                target="_blank"
                rel="noreferrer"
              >
                Singapore Open Data Licence v1.0
              </a>
              . Wayce is not endorsed by LTA.
            </p>
            <h3>AI with its feet on the ground</h3>
            <p>
              Vertex AI explains supplied route options and helps interview
              preferences. The local fallback is rule-based. The disruption risk
              signal is an explainable index, not a calibrated probability. No
              model is allowed to invent a route or claim a lift works.
            </p>
            <h3>Your commute is personal</h3>
            <p>
              Guest preferences and daily commutes stay on this device. If you
              choose Google sign-in, they merge into your verified account and
              sync until you delete them. Chat is processed only after consent;
              our app does not store chat history. Optional reminders store the
              selected route and push subscription in Google Cloud for 30 days.
              No background location tracking or analytics. Live tracking stops
              when you close the active journey. Faux demo accounts never sync.
            </p>
            <h3>Connected services</h3>
            {Object.entries(config?.integrations ?? {}).map(([name, ready]) => (
              <div className="integration-row" key={name}>
                <span>{name.toUpperCase()}</span>
                <span>{ready ? "Configured" : "Awaiting credentials"}</span>
              </div>
            ))}
            <p className="privacy-note">
              Offline: the last journey and OSM map remain available after the
              first full load. Advice is clearly marked stale. New routes
              require a connection.
            </p>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A little guide to a better commute"
          onClose={() => setModal(null)}
        >
          <div className="modal-body help-content">
            <div>
              <span>01</span>
              <h3>Tell us where your day takes you.</h3>
              <p>
                We request your current location in normal live mode, then you
                choose where to go. Leave defaults to Now, and every field stays
                editable. Guest mode works without sign-in.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>See the change before you leave.</h3>
              <p>
                Route warnings appear only when a live condition affects the
                selected journey. Persona simulations are available only after
                enabling Developer mode in Account.
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>Take your journey with you.</h3>
              <p>
                Start the journey for large step-by-step directions. Your last
                plan is saved for offline use. Ask your companion to explain the
                trade-offs.
              </p>
            </div>
            <p className="privacy-note">
              Accessibility preferences avoid mapped stairs and known lift
              outages, but are not a guarantee of a continuous step-free route.
              Confirm critical access with station staff.
            </p>
          </div>
        </Modal>
      )}
      {modal === "journey" && activeJourney && (
        <Modal
          title={
            journeyStep >= activeJourney.route.segments.length
              ? "You’ve made it."
              : "One step at a time"
          }
          onClose={closeJourney}
          className="journey-navigation-modal"
        >
          <div
            ref={activeJourneyLayout}
            className={`journey-navigation-stage sheet-${
              sheetSnapNames[activeJourneySheetSnap]
            } ${activeJourneySheetDragging ? "sheet-dragging" : ""}`}
          >
            <header className="active-route-summary">
              <div>
                <span>From</span>
                <strong title={request.origin.name}>{request.origin.name}</strong>
              </div>
              <div>
                <span>To</span>
                <strong title={request.destination.name}>
                  {request.destination.name}
                </strong>
              </div>
              <div>
                <span>Arrive</span>
                <strong>{sgTime(activeJourney.route.arrival)}</strong>
              </div>
            </header>
            <JourneyMap
              plan={plan}
              selected={activeJourney.route}
              location={currentLocation}
              onViewAlerts={() => setModal("alerts")}
              hasAlerts={disruptionAlerts.length > 0}
              request={request}
              navigationMode
            />
            <section className="active-journey-sheet" aria-label="Trip instructions">
              <SheetDragHandle
                controls="active-journey-content"
                label="One step at a time panel"
                sheetSnap={activeJourneySheetSnap}
                sheetMoved={activeJourneySheetMoved}
                snapJourneySheet={snapActiveJourneySheet}
                startSheetDrag={startActiveJourneySheetDrag}
              />
              <div
                id="active-journey-content"
                className="active-journey active-journey-scroll"
              >
                {plan &&
                  (canStartWithWeatherWarning(activeJourney.route, plan) ||
                    routeTransitNotices(activeJourney.route, plan).length >
                      0) && (
                    <RouteConditionWarnings
                      journey={activeJourney.route}
                      plan={plan}
                      compact
                    />
                  )}
                <ol className="active-instruction-list">
                  {activeJourney.route.segments.map((segment, index) => (
                    <li
                      className={`active-instruction ${segment.mode}`}
                      key={segment.id}
                      style={
                        segment.mode === "rail"
                          ? ({
                              "--active-line-colour":
                                lineColors[segment.line] ?? "#235ba8",
                            } as React.CSSProperties)
                          : undefined
                      }
                    >
                      <ModeIcon mode={segment.mode} size={18} aria-hidden="true" />
                      <span className="active-instruction-content">
                        <TransitInstructionDiagram segment={segment} />
                        {segment.mode === "rail" ? (
                          <RailActiveInstruction
                            segment={segment}
                            index={index}
                            segments={activeJourney.route.segments}
                            departure={activeJourney.departure}
                          />
                        ) : (
                          activeInstruction(
                            segment,
                            index,
                            activeJourney.route.segments,
                            activeJourney.departure,
                          )
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <button
                type="button"
                className="active-route-back"
                onClick={closeJourney}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back to navigation
              </button>
            </section>
          </div>
        </Modal>
      )}
      {showOnboarding && request.dataMode === "live" && (
        <Onboarding
          preferences={request.preferences}
          largeText={largeText}
          onSave={(preferences, onboardingLargeText) =>
            finishOnboarding(preferences, onboardingLargeText)
          }
          onSkip={() => finishOnboarding()}
        />
      )}
    </div>
  );
}

function ChatRouteCards({
  routeIds,
  recommendedRouteId,
  plan,
  onSelectRoute,
}: {
  routeIds?: string[];
  recommendedRouteId?: string;
  plan: PlanResponse | null;
  onSelectRoute: (id: string) => void;
}) {
  if (!plan || !routeIds?.length) return null;
  const routes = routeIds
    .map((id) =>
      [plan.recommended, ...plan.alternatives].find(
        (route) => route.id === id && !route.blocked,
      ),
    )
    .filter((route): route is Journey => Boolean(route));
  if (!routes.length) return null;
  return (
    <div className="chat-route-list" aria-label="Route options from companion">
      {routes.map((route) => (
        <button
          type="button"
          className={`chat-route-card ${route.id === recommendedRouteId ? "recommended" : ""}`}
          key={route.id}
          onClick={() => onSelectRoute(route.id)}
          aria-label={`View ${route.title}, ${route.duration} minutes, arrive ${sgTime(route.arrival)}`}
        >
          <span className="chat-route-card-top">
            <span className="chat-route-label">
              {route.id === recommendedRouteId ? (
                <>
                  <Sparkles size={11} /> Companion pick
                </>
              ) : route.id === plan.recommended.id ? (
                "Best fit"
              ) : (
                "Route option"
              )}
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </span>
          <span className="chat-route-title">{route.title}</span>
          <span className="chat-route-timing">
            <strong>
              {route.duration}
              <small> min</small>
            </strong>
            <span>
              Arrive {sgTime(route.arrival)}
              <small>
                {route.range[0]}–{route.range[1]} min estimated
              </small>
            </span>
          </span>
          <span className="chat-route-lines" aria-label="Journey legs">
            {route.segments.map((segment, index) => (
              <span className="pill-group" key={`${segment.id}-${index}`}>
                <LinePill segment={segment} />
                {index < route.segments.length - 1 && (
                  <ChevronRight size={10} aria-hidden="true" />
                )}
              </span>
            ))}
          </span>
          <span className="chat-route-meta">
            <span>
              <Footprints size={13} /> {Math.ceil(route.walkMinutes)} min walk
            </span>
            <span>
              <ArrowDownUp size={13} />
              {route.transfers === 0
                ? "Direct"
                : `${route.transfers} transfer${route.transfers > 1 ? "s" : ""}`}
            </span>
            <span className={`chat-crowd ${route.crowd}`}>
              <UsersRound size={13} /> {route.crowd} crowd
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Companion({
  plan,
  request,
  consent,
  onConsentChange,
  onApply,
  config,
  onSelectRoute,
}: {
  plan: PlanResponse | null;
  request: PlanRequest;
  consent: boolean;
  onConsentChange: (consent: boolean) => void;
  onApply: (p: Partial<Preferences>) => void;
  config: any;
  onSelectRoute: (id: string) => void;
}) {
  const [messages, setMessages] = useState<
    {
      role: "assistant" | "user";
      text: string;
      preferences?: Partial<Preferences>;
      provider?: string;
      recommendedRouteId?: string;
      displayedRouteIds?: string[];
      applied?: boolean;
    }[]
  >([
    {
      role: "assistant",
      text: "Hi, I’m Waycey, your companion for the way. I can explain your route, help you plan around a disruption, or learn what makes a journey work for you.",
    },
  ]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const [listening, setListening] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const recognition = useRef<BrowserSpeechRecognition | null>(null);
  const voiceBaseMessage = useRef("");
  const voiceHeard = useRef(false);
  const voiceFailed = useRef(false);
  const voiceInputSupported = Boolean(getSpeechRecognition());
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  useEffect(
    () => () => {
      const activeRecognition = recognition.current;
      recognition.current = null;
      if (!activeRecognition) return;
      activeRecognition.onstart = null;
      activeRecognition.onresult = null;
      activeRecognition.onerror = null;
      activeRecognition.onend = null;
      activeRecognition.abort();
    },
    [],
  );
  const send = async (text: string) => {
    if (!text.trim() || busy || !consent) return;
    setMessage("");
    setMessages((previous) => [...previous, { role: "user", text }]);
    setBusy(true);
    try {
      const contextRequest =
        plan?.request ?? (isPlannable(request) ? request : undefined);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          request: contextRequest,
          history: messages
            .filter((entry) => entry.role === "user" || entry.provider)
            .slice(-8)
            .map((entry) => ({ role: entry.role, text: entry.text })),
          cloudConsent: consent,
        }),
      });
      const data: ChatResponse & { error?: string } = await r.json();
      if (!r.ok)
        throw new Error(
          data.error || `The companion returned HTTP ${r.status}.`,
        );
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: data.message,
          preferences: data.preferences,
          provider: data.provider,
          recommendedRouteId: data.recommendedRouteId,
          displayedRouteIds: data.displayedRouteIds,
        },
      ]);
    } catch (error) {
      const detail =
        error instanceof Error && error.message !== "Failed to fetch"
          ? error.message.trim().replace(/[.!?]+$/, "")
          : "";
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: navigator.onLine
            ? `The companion could not respond${detail ? `: ${detail}` : " right now"}. ${plan ? "Your route and journey steps are still available." : "You can continue planning your journey."}`
            : "You’re offline. Follow the saved journey steps and check updated conditions when you reconnect.",
          provider: "local",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  const speak = async (text: string) => {
    setSpeechStatus("");
    try {
      if (config?.integrations.tts) {
        const r = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (r.ok) {
          const url = URL.createObjectURL(await r.blob());
          const audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          await audio.play();
          return;
        }
      }
      if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-SG";
        utterance.rate = 0.95;
        speechSynthesis.speak(utterance);
      } else
        setSpeechStatus(
          "Speech is not supported in this browser. The full text is above.",
        );
    } catch {
      setSpeechStatus("Audio could not play. The full text is above.");
    }
  };
  const toggleVoiceInput = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setSpeechStatus(
        "Voice input is not supported in this browser. You can still type your message.",
      );
      return;
    }
    window.speechSynthesis?.cancel();
    const nextRecognition = new SpeechRecognition();
    recognition.current = nextRecognition;
    voiceBaseMessage.current = message.trim();
    voiceHeard.current = false;
    voiceFailed.current = false;
    nextRecognition.lang = "en-SG";
    nextRecognition.continuous = false;
    nextRecognition.interimResults = true;
    nextRecognition.onstart = () => {
      setListening(true);
      setSpeechStatus(
        "Listening… Speak naturally, then tap stop when finished.",
      );
    };
    nextRecognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1)
        transcript += `${event.results[i][0]?.transcript ?? ""} `;
      transcript = transcript.trim().replace(/\s+/g, " ");
      if (!transcript) return;
      voiceHeard.current = true;
      setMessage(
        [voiceBaseMessage.current, transcript]
          .filter(Boolean)
          .join(" ")
          .slice(0, 1500),
      );
      setSpeechStatus("Transcribing…");
    };
    nextRecognition.onerror = (event) => {
      voiceFailed.current = true;
      setListening(false);
      setSpeechStatus(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone permission was denied. Allow microphone access or type your message."
          : event.error === "audio-capture"
            ? "No microphone was found. You can still type your message."
            : event.error === "no-speech"
              ? "I didn’t hear anything. Tap the microphone to try again."
              : "Voice input could not finish. You can try again or type your message.",
      );
    };
    nextRecognition.onend = () => {
      recognition.current = null;
      setListening(false);
      if (voiceFailed.current) return;
      setSpeechStatus(
        voiceHeard.current
          ? "Voice draft ready. Review it before sending."
          : "I didn’t hear anything. Tap the microphone to try again.",
      );
    };
    try {
      nextRecognition.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setSpeechStatus(
        "Voice input could not start. You can try again or type your message.",
      );
    }
  };
  if (!consent)
    return (
      <div className="chat-panel consent-pending">
        <section
          className="chat-consent-overlay"
          aria-labelledby="companion-consent-title"
        >
          <span className="chat-consent-icon" aria-hidden="true">
            <ShieldCheck size={28} />
          </span>
          <p className="eyebrow">ONE-TIME AGREEMENT</p>
          <h3 id="companion-consent-title">Before you chat or use voice</h3>
          <p>
            Wayce sends the message you choose to submit, your current route
            context and recent chat context to the companion. Wayce does not
            store your chat history.
          </p>
          <p>
            If you use the microphone, your browser may use its vendor’s online
            speech service. Wayce receives only the editable transcript draft
            you decide to send, not microphone audio.
          </p>
          <label className="chat-consent-choice">
            <input
              type="checkbox"
              checked={false}
              onChange={(event) => onConsentChange(event.target.checked)}
            />
            <span>I agree to this companion and voice data use.</span>
          </label>
          <small>
            This choice stays on this device. You can change it anytime in
            Preferences.
          </small>
        </section>
      </div>
    );
  return (
    <div className="chat-panel">
      <div className="chat-messages" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.role}`}>
            {m.role === "assistant" && (
              <img
                className="waycey-avatar"
                src="/waycey-avatar.svg"
                alt="Waycey"
              />
            )}
            <p>{m.text}</p>
            {m.role === "assistant" && (
              <div className="message-actions">
                <small>
                  {m.provider === "vertex"
                    ? "Vertex AI"
                    : m.provider === "local"
                      ? "Local guide"
                      : "Your commute companion"}
                </small>
                <button
                  className="icon-button compact"
                  aria-label="Read message aloud"
                  onClick={() => speak(m.text)}
                >
                  <Volume2 size={17} />
                </button>
              </div>
            )}
            {m.preferences && Object.keys(m.preferences).length > 0 && (
              <div className="proposed-preferences">
                <strong>Suggested preferences</strong>
                <p>
                  {Object.entries(m.preferences)
                    .map(
                      ([k, v]) =>
                        `${k.replace(/([A-Z])/g, " $1")}: ${typeof v === "boolean" ? (v ? "yes" : "no") : v}`,
                    )
                    .join(" · ")}
                </p>
                <button
                  className="secondary-button"
                  disabled={m.applied}
                  onClick={() => {
                    onApply(m.preferences!);
                    setMessages((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, applied: true } : x,
                      ),
                    );
                  }}
                >
                  {m.applied ? "Applied" : "Apply & re-plan"}
                  <Check size={15} />
                </button>
              </div>
            )}
            <ChatRouteCards
              routeIds={
                m.displayedRouteIds ??
                (m.recommendedRouteId ? [m.recommendedRouteId] : undefined)
              }
              recommendedRouteId={m.recommendedRouteId}
              plan={plan}
              onSelectRoute={onSelectRoute}
            />
          </div>
        ))}
        {busy && (
          <div className="chat-thinking">
            <LoaderCircle size={16} className="spin" /> Thinking about your
            journey…
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="chat-bottom">
        {messages.length === 1 && (
          <div className="chat-prompts">
            {[
              "Why this route?",
              "Show me my route options",
              "I prefer quieter, sheltered journeys",
            ].map((p) => (
              <button key={p} disabled={!consent} onClick={() => send(p)}>
                {p}
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        )}
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send(message);
          }}
        >
          <input
            aria-label="Message your companion"
            placeholder={
              listening
                ? "Listening…"
                : consent
                  ? "What would make your journey better?"
                  : "Check the consent box to start"
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1500}
            disabled={!consent || busy || listening}
          />
          <button
            type="button"
            className={`voice-input-button ${listening ? "listening" : ""}`}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            aria-pressed={listening}
            aria-describedby="voice-input-note"
            onClick={toggleVoiceInput}
            disabled={!consent || busy || !voiceInputSupported}
          >
            <Mic size={18} />
          </button>
          <button
            aria-label="Send message"
            disabled={!consent || !message.trim() || busy || listening}
          >
            <Send size={18} />
          </button>
        </form>
        <p id="voice-input-note" className="voice-input-note">
          {voiceInputSupported
            ? "Voice transcription is handled by your browser and may use its online speech service. Wayce receives only the draft you send."
            : "Voice input is not supported in this browser. You can still type your message."}
        </p>
        {speechStatus && (
          <p className="privacy-note" role="status">
            {speechStatus}
          </p>
        )}
      </div>
    </div>
  );
}
