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
  Clock3,
  CloudSun,
  Footprints,
  Heart,
  HelpCircle,
  House,
  Info,
  Leaf,
  LoaderCircle,
  MapPin,
  MessageCircle,
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
  ChatResponse,
  Journey,
  Persona,
  Place,
  PlanRequest,
  PlanResponse,
  Preferences,
  Scenario,
  Segment,
} from "../shared/types";
import {
  lineColors,
  nextDeparture,
  places,
  profiles,
  scenarios,
  sgTime,
} from "../shared/catalog";
import JourneyMap from "./Map";

type Tab = "today" | "commutes" | "updates";
type ModalName =
  | "profile"
  | "demo"
  | "chat"
  | "sources"
  | "journey"
  | "help"
  | "proactive"
  | null;
interface Saved {
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
const PROFILE_KEY = "wlt-profile-v1",
  PLAN_KEY = "wlt-journey-v1",
  ACTIVITY_KEY = "wlt-activity-v1";
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
function dateValue(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
function makeRequest(
  persona: Persona = "lim",
  dataMode: "demo" | "live" = "live",
  scenario: Scenario = "normal",
): PlanRequest {
  // Profile 1 begins with the accessibility-safe defaults formerly used for
  // the elderly journey. Habit learning can relax these only when the user
  // has not supplied a manual preference.
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
function CrowdBadge({ crowd }: { crowd: Journey["crowd"] }) {
  if (crowd !== "high") return null;
  return (
    <span className={`crowd-badge ${crowd}`}>
      <UsersRound size={14} />
      Crowded
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
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
function PlacePicker({
  label,
  value,
  onChange,
  marker,
}: {
  label: string;
  value: Place;
  onChange: (p: Place) => void;
  marker: string;
}) {
  const [query, setQuery] = useState(value.name);
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState(places);
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(value.name), [value]);
  useEffect(() => {
    if (!editing) return;
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
        .catch(() =>
          setResults(
            places.filter((p) =>
              p.name.toLowerCase().includes(query.toLowerCase()),
            ),
          ),
        )
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [query, editing]);
  return (
    <div className="place-field" ref={container}>
      <span className={`field-marker ${marker === "B" ? "filled" : ""}`}>
        {marker}
      </span>
      <div>
        <label htmlFor={`place-${marker}`}>{label}</label>
        <input
          id={`place-${marker}`}
          autoComplete="off"
          role="combobox"
          aria-expanded={editing}
          aria-controls={`places-${marker}`}
          value={query}
          onFocus={() => {
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
        <small>{value.subtitle}</small>
      </div>
      {editing && (
        <ul className="place-results" id={`places-${marker}`} role="listbox">
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
                <MapPin size={16} />
                <span>
                  {p.name}
                  <small>{p.subtitle}</small>
                </span>
              </button>
            </li>
          ))}
          {!busy && !results.length && (
            <li className="searching">
              No match. Wider address search needs OneMap.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const saved = useRef(readSaved<Saved>(PROFILE_KEY));
  const [request, setRequest] = useState<PlanRequest>(() =>
    saved.current?.request
      ? {
          ...saved.current.request,
          dataMode: "live",
          scenario: "normal",
        }
      : makeRequest(),
  );
  const [plan, setPlan] = useState<PlanResponse | null>(
    readSaved<PlanResponse>(PLAN_KEY),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [modal, setModal] = useState<ModalName>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
  const [largeText, setLargeText] = useState(
    localStorage.getItem("wlt-large-text") === "true",
  );
  const [config, setConfig] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [journeyStep, setJourneyStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [proactiveWarning, setProactiveWarning] = useState<{
    delay: number;
    leaveAt: string;
    targetTime: string;
  } | null>(null);
  const [savedRoutine, setSavedRoutine] = useState(!!saved.current);
  const [demoPersona, setDemoPersona] = useState<Persona>("rachel");
  const [demoScenario, setDemoScenario] = useState<Scenario>("disruption");
  const [hardPreferences, setHardPreferences] = useState<Partial<Preferences>>(
    saved.current?.hardPreferences ?? {},
  );
  const activeRequest = useRef<AbortController | null>(null);
  const normalRequest = useRef<PlanRequest | null>(null);
  const lastProactiveWarning = useRef("");
  const profile = profiles.find((p) => p.id === "lim")!;
  const selected = plan
    ? ([plan.recommended, ...plan.alternatives, plan.original].find(
        (j) => j.id === selectedId,
      ) ?? plan.recommended)
    : null;
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
  const runPlan = useCallback(async (value: PlanRequest) => {
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
      persist(PLAN_KEY, data);
    } catch (e: any) {
      if (e.name !== "AbortError")
        setError(
          navigator.onLine
            ? e.message
            : "You’re offline. Your last saved journey is shown; conditions may have changed.",
        );
    } finally {
      if (activeRequest.current === control) setLoading(false);
    }
  }, []);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
    if (navigator.onLine) void runPlan(request);
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
      activeRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.documentElement.classList.toggle("large-text", largeText);
    persist("wlt-large-text", largeText);
  }, [largeText]);
  useEffect(() => {
    const commonRoute = saved.current;
    if (commonRoute && !commonRoute.timeSensitive) {
      const migrated: Saved = {
        ...commonRoute,
        timeSensitive: sgTime(
          commonRoute.request.arriveBy ?? commonRoute.request.departure,
        ),
      };
      persist(PROFILE_KEY, migrated);
      saved.current = migrated;
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        navigator.onLine &&
        document.visibilityState === "visible" &&
        plan &&
        !loading
      )
        void runPlan(plan.request);
    }, 300000);
    return () => clearInterval(timer);
  }, [plan, loading, runPlan]);
  useEffect(() => {
    if (!plan) return;
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
      setSavedRoutine(true);
      const existing = readSaved<Saved>(PROFILE_KEY);
      if (!existing || existing.inferred) {
        const learned: Saved = {
          profile: "profile-1",
          preferences: plan.request.preferences,
          request: plan.request,
          hardPreferences,
          timeSensitive: sgTime(
            plan.request.arriveBy ?? plan.request.departure,
          ),
          inferred: true,
          savedAt: new Date().toISOString(),
        };
        persist(PROFILE_KEY, learned);
        saved.current = learned;
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
    if (delay <= 15) return;
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
  const startDemo = () => {
    if (request.dataMode === "live") normalRequest.current = request;
    const value = makeRequest(demoPersona, "demo", demoScenario);
    setRequest(value);
    setModal(null);
    void runPlan(value);
  };
  const exitDemo = () => {
    const stored =
      normalRequest.current ?? saved.current?.request ?? makeRequest();
    const value: PlanRequest = {
      ...stored,
      dataMode: "live",
      scenario: "normal",
      preferences: {
        ...stored.preferences,
        ...hardPreferences,
      },
    };
    setRequest(value);
    setModal(null);
    void runPlan(value);
  };
  const saveCommute = () => {
    const commonRoute: Saved = {
      profile: "profile-1",
      preferences: request.preferences,
      request,
      hardPreferences,
      timeSensitive: sgTime(request.arriveBy ?? request.departure),
      inferred: false,
      savedAt: new Date().toISOString(),
    };
    persist(PROFILE_KEY, commonRoute);
    saved.current = commonRoute;
    setSavedRoutine(true);
    notify("Your commute is saved on this device for 30 days.");
  };
  const enableReminders = async () => {
    try {
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
      saveCommute();
      notify(
        "Reminders enabled. We’ll check before departure and the day before planned work.",
      );
    } catch (e: any) {
      notify(e.message);
    }
  };
  const deleteData = async () => {
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
    for (const key of [
      PROFILE_KEY,
      PLAN_KEY,
      "wlt-device-token",
      "wlt-large-text",
    ])
      localStorage.removeItem(key);
    setSavedRoutine(false);
    notify("Saved commute, journey and cloud reminder deleted.");
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
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to journey
      </a>
      <header className="site-header">
        <nav aria-label="Main navigation">
          {(
            [
              { id: "today", label: "My journey", icon: Route },
              {
                id: "updates",
                label: "Disruptions / interruptions",
                icon: Radio,
              },
              { id: "commutes", label: "Common routes", icon: Bookmark },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={tab === item.id ? "nav-item active" : "nav-item"}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <item.icon size={17} />
              {item.label}
              {item.id === "updates" &&
                plan?.conditions.notices.some(
                  (n) => n.severity === "critical",
                ) && <i className="notification-dot" />}
            </button>
          ))}
        </nav>
      </header>
      <div className="bottom-controls" aria-label="App controls">
        <a className="brand" href="/" aria-label="WeLikeTrains home">
          <span className="brand-icon">
            <TrainFront size={23} />
          </span>
          <span>
            WeLike<span className="brand-light">Trains</span>
            <i />
          </span>
        </a>
        <div className="header-actions">
          <button
            className="icon-button help-button"
            onClick={() => setModal("help")}
            aria-label="Help"
          >
            <HelpCircle size={21} />
          </button>
          <button
            className="icon-button"
            onClick={() => setTab("updates")}
            aria-label="View commute alerts"
          >
            <Bell size={21} />
            <i className="notification-dot" />
          </button>
          <button
            className="avatar"
            onClick={() => setModal("profile")}
            aria-label="Open profile and preferences"
          >
            1
          </button>
        </div>
      </div>
      {!online && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} /> You’re offline. Your saved map and journey are
          available. Conditions may have changed.
        </div>
      )}
      <main id="main">
        {tab !== "today" && (
          <section className="greeting">
            <div>
              <h1>
                {tab === "commutes"
                  ? "Common routes"
                  : "Disruptions / interruptions"}
              </h1>
            </div>
          </section>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button onClick={() => runPlan(request)} className="text-button">
              Retry
            </button>
          </div>
        )}
        {tab === "today" && (
          <>
            <div className="journey-layout">
              <aside className="planner-column">
                <section className="planner-card">
                  <div className="section-title">
                    <h2>Navigate</h2>
                    <button
                      className="icon-button compact"
                      onClick={() => setModal("profile")}
                      aria-label="Journey preferences"
                    >
                      <Settings2 size={18} />
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runPlan(request);
                    }}
                  >
                    <div className="place-inputs">
                      <PlacePicker
                        label="FROM"
                        marker="A"
                        value={request.origin}
                        onChange={(p) => updateRequest({ origin: p })}
                      />
                      <button
                        type="button"
                        className="swap-button"
                        onClick={() =>
                          updateRequest({
                            origin: request.destination,
                            destination: request.origin,
                          })
                        }
                        aria-label="Swap origin and destination"
                      >
                        <ArrowDownUp size={16} />
                      </button>
                      <PlacePicker
                        label="TO"
                        marker="B"
                        value={request.destination}
                        onChange={(p) => updateRequest({ destination: p })}
                      />
                    </div>
                    <div className="time-fields">
                      <label>
                        <Clock3 size={16} />
                        <span>
                          Leave at
                          <input
                            aria-label="Departure time"
                            type="time"
                            value={sgTime(request.departure)}
                            onChange={(e) => {
                              if (e.target.value)
                                updateRequest({
                                  departure: `${dateValue(request.departure)}T${e.target.value}:00+08:00`,
                                });
                            }}
                          />
                        </span>
                      </label>
                      <label>
                        <CalendarDays size={16} />
                        <span>
                          Travel date
                          <input
                            aria-label="Travel date"
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
                            }}
                          />
                        </span>
                      </label>
                    </div>
                    <div className="arrival-field">
                      <label htmlFor="arrive-by">Arrive by</label>
                      <input
                        id="arrive-by"
                        aria-label="Arrive by"
                        type="time"
                        value={request.arriveBy ? sgTime(request.arriveBy) : ""}
                        onChange={(e) =>
                          updateRequest({
                            arriveBy: e.target.value
                              ? `${dateValue(request.departure)}T${e.target.value}:00+08:00`
                              : undefined,
                          })
                        }
                      />
                    </div>
                    <button
                      className="primary-button plan-button"
                      disabled={loading || !online}
                    >
                      {loading ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <Route size={18} />
                      )}{" "}
                      {loading ? "Loading directions…" : "Start directions"}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                  <div className="preference-chips">
                    <button onClick={() => setModal("profile")}>
                      {request.preferences.stepFree ? (
                        <Accessibility size={13} />
                      ) : (
                        <Umbrella size={13} />
                      )}{" "}
                      {request.preferences.stepFree
                        ? "Step-free preference"
                        : request.preferences.sheltered
                          ? "Sheltered walks"
                          : "Your preferences"}
                    </button>
                    <button onClick={() => setModal("profile")}>
                      <UsersRound size={13} />
                      {request.preferences.avoidCrowds
                        ? "Quieter rides"
                        : "Balanced journey"}
                    </button>
                  </div>
                </section>
                <div className="routes-heading">
                  <h2>Routes</h2>
                  <span>
                    {plan
                      ? `${1 + plan.alternatives.length} routes`
                      : "Planning…"}
                  </span>
                </div>
                <div
                  className={`route-options ${loading ? "updating" : ""}`}
                  aria-busy={loading}
                >
                  {!plan && (
                    <div className="loading-card">
                      <LoaderCircle size={22} className="spin" />
                      <p>Connecting your door to your destination…</p>
                    </div>
                  )}
                  {plan &&
                    visibleRouteChoices.map((journey, i) => (
                      <article
                        className={`route-card ${selected?.id === journey.id ? "selected" : ""} ${journey.blocked ? "blocked" : ""}`}
                        key={journey.id}
                      >
                        <button
                          className="route-select"
                          onClick={() => setSelectedId(journey.id)}
                          aria-label={`View ${journey.title}, ${journey.duration} minutes`}
                          aria-pressed={selected?.id === journey.id}
                        >
                          <div className="route-card-top">
                            <span
                              className={
                                i === 0
                                  ? "recommended-label"
                                  : "alternative-label"
                              }
                            >
                              {i === 0 ? (
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
                              {selected?.id === journey.id && (
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
                          {journey.blocked && (
                            <span className="route-warning">
                              <TriangleAlert size={13} /> Affected by closure or
                              access restriction
                            </span>
                          )}
                          {journey.duration > journey.baselineDuration && (
                            <span className="route-warning">
                              +{journey.duration - journey.baselineDuration} min
                              from current conditions
                            </span>
                          )}
                        </button>
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
                    {showAllRoutes ? "Show fewer routes" : "Load more routes"}
                    <ChevronDown
                      size={16}
                      className={showAllRoutes ? "expanded" : ""}
                    />
                  </button>
                )}
                <button
                  className={`save-button ${savedRoutine ? "saved" : ""}`}
                  onClick={saveCommute}
                >
                  {savedRoutine ? (
                    <CheckCheck size={17} />
                  ) : (
                    <Bookmark size={17} />
                  )}{" "}
                  {savedRoutine ? "Route saved" : "Save route"}
                </button>
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
                          ? "Route unavailable"
                          : `Use ${plan.recommended.title}`
                        : "Finding route"}
                    </h2>
                    <p>{plan?.advice ?? "Checking routes and conditions."}</p>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setModal("chat")}
                    aria-label="Ask why this route was recommended"
                  >
                    <ArrowRight size={21} />
                  </button>
                </section>
                <JourneyMap plan={plan} selected={selected} />
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
                              color: lineColors[s.line] ?? lineColors[s.mode],
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
                                  : `${s.mode === "bus" ? "Bus " : ""}${s.line} to ${s.to}`}
                            </h3>
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
                            {expanded === selected.id && (
                              <p className="step-detail">{s.instructions}</p>
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
                        <p>{selected.source} · © OpenStreetMap contributors</p>
                      </div>
                    )}
                    <div className="start-journey single">
                      <button
                        className="primary-button"
                        disabled={selected.blocked}
                        onClick={() => {
                          setStarted(true);
                          setJourneyStep(0);
                          setModal("journey");
                        }}
                      >
                        <Navigation size={16} /> Start <ArrowRight size={16} />
                      </button>
                    </div>
                  </section>
                )}
              </div>
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
          </>
        )}
        {tab === "commutes" && (
          <section className="saved-page">
            <div className="saved-journey-card">
              <div className="routine-top">
                <span className="routine-icon">
                  <House size={27} />
                </span>
                <span className="tag">
                  {savedRoutine
                    ? "SAVED ON THIS DEVICE"
                    : "YOUR SUGGESTED ROUTINE"}
                </span>
                <button
                  className="icon-button"
                  aria-label="Edit commute"
                  onClick={() => {
                    setTab("today");
                  }}
                >
                  <Settings2 size={18} />
                </button>
              </div>
              <h2>
                {request.origin.name} <ArrowRight size={19} />{" "}
                {request.destination.name}
              </h2>
              <p>
                Profile 1 · Leave at {sgTime(request.departure)}
                {request.arriveBy
                  ? ` · Arrive by ${sgTime(request.arriveBy)}`
                  : ""}
              </p>
              <div className="preference-chips">
                <span>
                  Time-sensitive ·{" "}
                  {saved.current?.timeSensitive ??
                    sgTime(request.arriveBy ?? request.departure)}
                </span>
                <span>
                  {request.preferences.stepFree
                    ? "Step-free preference"
                    : "Sheltered walks"}
                </span>
                <span>
                  Alert only at +{request.preferences.alertThreshold} min
                </span>
              </div>
              <button
                className="primary-button"
                onClick={() => {
                  setTab("today");
                  void runPlan(request);
                }}
              >
                Check my commute <ArrowRight size={16} />
              </button>
            </div>
            <div className="reminder-card">
              <BellRing size={29} />
              <h2>A heads-up, before you head out.</h2>
              <p>
                Check conditions before your departure and planned closures the
                day before. We’ll interrupt only when the change meets your
                threshold.
              </p>
              <p className="privacy-note">
                Enabling reminders shares your route, departure time,
                preferences and push subscription with our Google Cloud backend
                for 30 days. Remove them in preferences at any time.
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
            <button
              className="add-commute"
              onClick={() => {
                setModal("profile");
              }}
            >
              <Plus size={22} />
              <span>
                Explore a different routine
                <small>Try Rachel, Arjun or Mdm Lim</small>
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
            <>
              <label className="scenario-select">
                <span className="sr-only">Demo scenario</span>
                <select
                  aria-label="Demo scenario"
                  value={request.scenario}
                  onChange={(event) => {
                    const scenario = event.target.value as Scenario;
                    setDemoScenario(scenario);
                    const value = { ...request, scenario };
                    setRequest(value);
                    void runPlan(value);
                  }}
                >
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <button className="text-button" onClick={exitDemo}>
                Exit demo
              </button>
            </>
          )}
          <button
            className="text-button data-source-button"
            onClick={() => setModal("sources")}
          >
            Data & sources <ArrowRight size={14} />
          </button>
        </div>
        <footer className="site-footer">
          <span>
            {plan
              ? `${stale ? "Last saved" : "Updated"} ${sgTime(plan.generatedAt)} SGT`
              : "Planning your journey"}{" "}
            ·{" "}
            <button onClick={() => setModal("sources")}>Data & privacy</button>
            {" · "}
            <button onClick={() => setModal("demo")}>Demo mode</button>
            <span className="footer-credit">© OpenStreetMap contributors</span>
          </span>
        </footer>
      </main>
      <button className="companion-button" onClick={() => setModal("chat")}>
        <span>
          <Sparkles size={20} />
        </span>{" "}
        A little help for the journey <MessageCircle size={17} />
      </button>
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
      {modal === "profile" && (
        <Modal title="Profile 1" onClose={() => setModal(null)}>
          <div className="modal-body">
            <p className="muted">
              Your regular route and time are learned after three matching
              workdays. Changes you make here are kept as your preferences and
              are never replaced by habit learning.
            </p>
            <h3>Preferences</h3>
            {(
              [
                {
                  key: "stepFree",
                  title: "Avoid stairs",
                  description: "Exclude mapped stairs and known lift outages",
                  icon: Accessibility,
                },
                {
                  key: "sheltered",
                  title: "Stay out of the rain",
                  description: "Prefer mapped covered walking paths",
                  icon: Umbrella,
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
                void runPlan(request);
                saveCommute();
                setModal(null);
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
        </Modal>
      )}
      {modal === "chat" && (
        <Modal
          title="Your companion for the way"
          onClose={() => setModal(null)}
        >
          <Companion
            plan={plan}
            request={request}
            onApply={(preferences) => {
              const value = {
                ...request,
                preferences: { ...request.preferences, ...preferences },
              };
              setHardPreferences((previous) => ({
                ...previous,
                ...preferences,
              }));
              setRequest(value);
              void runPlan(value);
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
        <Modal title="Demo mode" onClose={() => setModal(null)}>
          <div className="modal-body">
            <p className="muted">
              Choose a presentation profile and a hypothetical network
              condition. Demo data is clearly separated from live LTA data.
            </p>
            <h3>Profile</h3>
            <div className="persona-options">
              {profiles.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setDemoPersona(candidate.id)}
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
            <h3>Hypothetical situation</h3>
            <label className="demo-scenario-field">
              <span>Network condition</span>
              <select
                value={demoScenario}
                onChange={(event) =>
                  setDemoScenario(event.target.value as Scenario)
                }
              >
                {scenarios.map((scenario) => (
                  <option value={scenario.id} key={scenario.id}>
                    {scenario.label} — {scenario.description}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button full" onClick={startDemo}>
              Start demo <ArrowRight size={17} />
            </button>
            {request.dataMode === "demo" && (
              <button className="secondary-button full" onClick={exitDemo}>
                Return to Profile 1 and live data
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
              marks every signal with its source and availability.
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
              , ODbL. The bundled extract powers the map and local routing. No
              public tile requests. Local timings are estimates; station access
              and shelter are not fully verified. OneMap can supply official
              itineraries when connected.
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
              Saved preferences and the most recent journey stay on this device
              for up to 30 days. Chat is processed only after consent; our app
              does not store chat history. Optional reminders store your route
              and push subscription in Google Cloud for 30 days. No background
              location tracking or analytics.
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
                Choose your origin, destination, departure and arrival deadline.
                Profile 1 learns repeated weekday routes on this device.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>See the change before you leave.</h3>
              <p>
                Route warnings appear only when a live condition affects the
                selected journey. Demo mode is available at the end of the page.
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
      {modal === "journey" && selected && (
        <Modal
          title={
            journeyStep >= selected.segments.length
              ? "You’ve made it."
              : "One step at a time"
          }
          onClose={() => setModal(null)}
        >
          <div className="modal-body active-journey">
            <span className="tag">
              {request.dataMode === "demo" ? "DEMO JOURNEY" : "YOUR JOURNEY"} ·{" "}
              {online ? "SAVED FOR OFFLINE" : "OFFLINE · LAST SAVED PLAN"}
            </span>
            {journeyStep < selected.segments.length ? (
              <>
                <span className="active-step-icon">
                  <ModeIcon
                    mode={selected.segments[journeyStep].mode}
                    size={44}
                  />
                </span>
                <p className="eyebrow">
                  STEP {journeyStep + 1} OF {selected.segments.length}
                </p>
                <h2>{selected.segments[journeyStep].to}</h2>
                <p>{selected.segments[journeyStep].instructions}</p>
                <div className="active-step-meta">
                  <Clock3 size={19} />
                  {Math.ceil(selected.segments[journeyStep].minutes)} min ·{" "}
                  {Math.round(selected.segments[journeyStep].distance)} m
                </div>
                <p className="privacy-note">
                  Manual progress. This app does not track your location. Access
                  and timing remain estimates.
                </p>
                <div className="journey-progress">
                  {selected.segments.map((_, i) => (
                    <i key={i} className={i <= journeyStep ? "done" : ""} />
                  ))}
                </div>
                <div className="journey-controls">
                  <button
                    className="secondary-button"
                    disabled={!journeyStep}
                    onClick={() => setJourneyStep(journeyStep - 1)}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => setJourneyStep(journeyStep + 1)}
                  >
                    I’m here <ArrowRight size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="active-step-icon">
                  <CheckCheck size={44} />
                </span>
                <h2>
                  A little less rush.
                  <br />A little more day.
                </h2>
                <p>
                  You’ve reached {request.destination.name}. Your routine is
                  ready for next time.
                </p>
                <button
                  className="primary-button full"
                  onClick={() => {
                    saveCommute();
                    setModal(null);
                  }}
                >
                  Save this commute <Heart size={17} />
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Companion({
  plan,
  request,
  onApply,
  config,
  onSelectRoute,
}: {
  plan: PlanResponse | null;
  request: PlanRequest;
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
      applied?: boolean;
    }[]
  >([
    {
      role: "assistant",
      text: "Hi, I’m your companion for the way. I can explain your route, help you plan around a disruption, or learn what makes a journey work for you.",
    },
  ]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  const send = async (text: string) => {
    if (!text.trim() || busy || !consent) return;
    setMessage("");
    setMessages((previous) => [...previous, { role: "user", text }]);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          request: plan?.request ?? request,
          cloudConsent: consent,
        }),
      });
      const data: ChatResponse & { error?: string } = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: data.message,
          preferences: data.preferences,
          provider: data.provider,
          recommendedRouteId: data.recommendedRouteId,
        },
      ]);
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: navigator.onLine
            ? "The companion could not connect. Your route and journey steps are still available."
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
  return (
    <div className="chat-panel">
      <div className="chat-intro">
        <span>
          <Sparkles size={20} />
        </span>
        <p>
          A calmer commute starts with a conversation.
          <small>
            {config?.integrations.vertex
              ? "Vertex AI connected · grounded in your route"
              : "Local companion · connect Vertex AI for generative advice"}
          </small>
        </p>
      </div>
      <div className="chat-messages" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.role}`}>
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
            {m.recommendedRouteId && (
              <button
                className="secondary-button"
                onClick={() => onSelectRoute(m.recommendedRouteId!)}
              >
                View suggested route <ArrowRight size={15} />
              </button>
            )}
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
              "I prefer quieter, sheltered journeys",
              "Are there free shuttle buses?",
            ].map((p) => (
              <button key={p} disabled={!consent} onClick={() => send(p)}>
                {p}
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        )}
        <label className="chat-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I agree to send this message and route context to the companion,
            including Google Vertex AI when connected. We don’t store chat
            history.
          </span>
        </label>
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
              consent
                ? "What would make your journey better?"
                : "Check the consent box to start"
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1500}
            disabled={!consent || busy}
          />
          <button
            aria-label="Send message"
            disabled={!consent || !message.trim() || busy}
          >
            <Send size={18} />
          </button>
        </form>
        {speechStatus && (
          <p className="privacy-note" role="status">
            {speechStatus}
          </p>
        )}
      </div>
    </div>
  );
}
