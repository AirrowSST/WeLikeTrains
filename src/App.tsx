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
type ModalName = "profile" | "chat" | "sources" | "journey" | "help" | null;
interface Saved {
  profile: Persona;
  preferences: Preferences;
  request: PlanRequest;
  savedAt: string;
}
const PROFILE_KEY = "wlt-profile-v1",
  PLAN_KEY = "wlt-journey-v1";
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
function makeRequest(persona: Persona): PlanRequest {
  const p = profiles.find((x) => x.id === persona)!;
  const departure = nextDeparture(p.departure);
  return {
    origin: places.find((x) => x.id === p.origin)!,
    destination: places.find((x) => x.id === p.destination)!,
    departure,
    arriveBy: `${dateValue(departure)}T${p.arriveBy}:00+08:00`,
    preferences: p.preferences,
    dataMode: "demo",
    scenario: "disruption",
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
  return (
    <span className={`crowd-badge ${crowd}`}>
      <UsersRound size={14} />
      {crowd === "low"
        ? "Room to breathe"
        : crowd === "moderate"
          ? "Moderate crowd"
          : crowd === "high"
            ? "Very crowded"
            : "Crowd unknown"}
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
        .catch(() =>
          setResults(localResults),
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
              No match. Try a station, landmark, or full address.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const saved = useRef(readSaved<Saved>(PROFILE_KEY));
  const [persona, setPersona] = useState<Persona>(
    saved.current?.profile ?? "rachel",
  );
  const [request, setRequest] = useState<PlanRequest>(
    saved.current?.request ?? makeRequest("rachel"),
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
  const [savedRoutine, setSavedRoutine] = useState(!!saved.current);
  const activeRequest = useRef<AbortController | null>(null);
  const profile = profiles.find((p) => p.id === persona)!;
  const selected = plan
    ? ([plan.recommended, ...plan.alternatives, plan.original].find(
        (j) => j.id === selectedId,
      ) ?? plan.recommended)
    : null;
  const notify = (message: string) => setToast(message);
  const updateRequest = (value: Partial<PlanRequest>) =>
    setRequest((previous) => ({ ...previous, ...value }));
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
      if (activeRequest.current !== control) return;
      if (!response.ok)
        throw new Error(data.error ?? "Unable to plan your journey");
      setPlan(data);
      setSelectedId(null);
      persist(PLAN_KEY, data);
    } catch (e: any) {
      if (e.name !== "AbortError" && activeRequest.current === control)
        setError(
          navigator.onLine
            ? e.message
            : "You’re offline. Your last saved journey is shown; conditions may have changed.",
        );
    } finally {
      if (activeRequest.current === control) setLoading(false);
    }
  }, []);
  const updateRequestAndPlan = (value: Partial<PlanRequest>) => {
    const next = { ...request, ...value };
    setRequest(next);
    void runPlan(next);
  };
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
  const choosePersona = (id: Persona) => {
    setPersona(id);
    const value = {
      ...makeRequest(id),
      dataMode: request.dataMode,
      scenario: request.scenario,
    };
    setRequest(value);
    setSavedRoutine(false);
    void runPlan(value);
    if (id === "lim") setLargeText(true);
  };
  const saveCommute = () => {
    persist(PROFILE_KEY, {
      profile: persona,
      preferences: request.preferences,
      request,
      savedAt: new Date().toISOString(),
    });
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
        body: JSON.stringify({ request, subscription, consent: true }),
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
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to journey
      </a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="WeLikeTrains home">
          <span className="brand-icon">
            <TrainFront size={23} />
          </span>
          <span>
            WeLike<span className="brand-light">Trains</span>
            <i />
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(
            [
              { id: "today", label: "My journey", icon: Route },
              { id: "commutes", label: "Saved commutes", icon: Bookmark },
              { id: "updates", label: "Network updates", icon: Radio },
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
            {persona === "lim" ? "ML" : profile.name[0]}
          </button>
        </div>
      </header>
      {!online && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} /> You’re offline. Your saved map and journey are
          available. Conditions may have changed.
        </div>
      )}
      <main id="main">
        <section className="greeting">
          <div>
            <div className="eyebrow">
              <span className="tiny-line" /> A LITTLE FORESIGHT. A BETTER
              COMMUTE.
            </div>
            <h1>
              {tab === "today" ? (
                <>
                  Your day, on the right track<span>.</span>
                </>
              ) : tab === "commutes" ? (
                <>
                  Your everyday, remembered<span>.</span>
                </>
              ) : (
                <>
                  A heads-up for the way ahead<span>.</span>
                </>
              )}
            </h1>
            <p>
              {tab === "today"
                ? `Hello, ${profile.name}. Let’s make the way there a little easier.`
                : tab === "commutes"
                  ? "The journeys you know. A companion that knows what matters."
                  : "What’s happening, what’s coming, and what it means for you."}
            </p>
          </div>
          <div className="today-meta">
            <span>
              <CalendarDays size={15} />
              {dateLabel}
            </span>
            <span>
              <CloudSun size={18} />
              {plan?.conditions.weather.temperature
                ? `${plan.conditions.weather.temperature}° · `
                : ""}
              {plan?.conditions.weather.forecast ?? "Checking the skies"}
            </span>
          </div>
        </section>
        <div className="demo-toolbar">
          <span>
            <span
              className={`status-dot ${request.dataMode === "demo" ? "amber" : ""}`}
            />
            {request.dataMode === "demo"
              ? "Demo experience"
              : "Live connections"}
            <small>
              {request.dataMode === "demo"
                ? "Real OSM routes · simulated conditions"
                : "Official feeds · availability shown below"}
            </small>
          </span>
          <label className="mode-toggle">
            <span>Demo</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Use demo mode"
              checked={request.dataMode === "demo"}
              onChange={(e) =>
                updateRequestAndPlan({
                  dataMode: e.target.checked ? "demo" : "live",
                })
              }
            />
            <span className="mode-toggle-track" aria-hidden="true" />
          </label>
          <label className="scenario-select">
            <span className="sr-only">Demo scenario</span>
            <select
              aria-label="Demo scenario"
              value={request.scenario}
              disabled={request.dataMode === "live"}
              onChange={(e) => {
                const value = {
                  ...request,
                  scenario: e.target.value as Scenario,
                };
                setRequest(value);
                void runPlan(value);
              }}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <button
            className="text-button data-source-button"
            onClick={() => setModal("sources")}
          >
            Data & sources <ArrowRight size={14} />
          </button>
        </div>
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
                    <h2>Where are we headed?</h2>
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
                        onChange={(p) => updateRequestAndPlan({ origin: p })}
                      />
                      <button
                        type="button"
                        className="swap-button"
                        onClick={() =>
                          updateRequestAndPlan({
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
                        onChange={(p) =>
                          updateRequestAndPlan({ destination: p })
                        }
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
                      <span>We’ll keep a buffer.</span>
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
                      {loading ? "Finding your way…" : "Find my best route"}
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
                  <h2>Your options</h2>
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
                    [plan.recommended, ...plan.alternatives].map(
                      (journey, i) => (
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
                                <TriangleAlert size={13} /> Affected by closure
                                or access restriction
                              </span>
                            )}
                            {journey.duration > journey.baselineDuration && (
                              <span className="route-warning">
                                +{journey.duration - journey.baselineDuration}{" "}
                                min from current conditions
                              </span>
                            )}
                          </button>
                        </article>
                      ),
                    )}
                </div>
                <button
                  className={`save-button ${savedRoutine ? "saved" : ""}`}
                  onClick={saveCommute}
                >
                  {savedRoutine ? (
                    <CheckCheck size={17} />
                  ) : (
                    <Bookmark size={17} />
                  )}{" "}
                  {savedRoutine ? "Commute saved" : "Save this commute"}
                  <span>Make tomorrow easier</span>
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
                    <span className="eyebrow">ONE STEP AHEAD</span>
                    <h2>
                      {plan
                        ? plan.recommended.id !== plan.original.id
                          ? `A little detour. A better morning.`
                          : plan.recommended.blocked
                            ? "Let’s check before you leave."
                            : "You’re on the right track."
                        : "A smarter journey is on its way."}
                    </h2>
                    <p>
                      {plan?.advice ??
                        "We’re finding a route that works for your day."}
                    </p>
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
                      <ShieldCheck size={20} />
                    </span>
                    <span>
                      <small>Journey risk signal</small>
                      <strong>
                        {plan?.risk.level === "high"
                          ? "Extra care today"
                          : plan?.risk.level === "moderate"
                            ? "A little buffer helps"
                            : "Looking steady"}
                      </strong>
                    </span>
                    <button
                      aria-label="Explain the journey risk"
                      className="icon-button compact"
                      onClick={() => setModal("chat")}
                    >
                      <Info size={15} />
                    </button>
                  </div>
                  <div>
                    <span className="insight-icon">
                      <Footprints size={20} />
                    </span>
                    <span>
                      <small>Total walking time</small>
                      <strong>
                        {selected
                          ? `${Math.ceil(selected.walkMinutes)} min across your journey`
                          : "Included in your journey"}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <span className="insight-icon">
                      <Leaf size={20} />
                    </span>
                    <span>
                      <small>A lighter footprint</small>
                      <strong>Shared journeys matter</strong>
                    </span>
                  </div>
                </div>
                {selected && (
                  <section className="steps-card">
                    <div className="section-title">
                      <div>
                        <span className="eyebrow">THE WAY THERE</span>
                        <h2>Your journey, step by step</h2>
                      </div>
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
                              {s.mode === "walk"
                                ? `${Math.round(s.distance)} m · ${s.sheltered ? "Sheltered route mapped" : "Shelter may vary along this walk"}`
                                : `From ${s.from}${s.affected ? " · Service affected" : ""}`}
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
                    <div className="start-journey">
                      <span>
                        <ShieldCheck size={16} /> Saved for the moments without
                        signal
                      </span>
                      <button
                        className="primary-button"
                        disabled={selected.blocked}
                        onClick={() => {
                          setStarted(true);
                          setJourneyStep(0);
                          setModal("journey");
                        }}
                      >
                        <Navigation size={16} /> Start my journey{" "}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </section>
                )}
              </div>
            </div>
            <section className="heads-up-strip">
              <span className="heads-up-icon">
                <CalendarDays size={24} />
              </span>
              <div>
                <span className="eyebrow">TOMORROW DESERVES A HEAD START</span>
                <h3>
                  {plan?.conditions.notices.find((n) => n.kind === "planned")
                    ?.title ?? "Keep your next journey in view"}
                </h3>
                <p>
                  {plan?.conditions.mode === "demo"
                    ? "A simulated planned notice. See what proactive advice looks like before a closure."
                    : "Check planned works and access notices before your next journey."}
                </p>
              </div>
              <button className="text-button" onClick={() => setTab("updates")}>
                See planned updates <ArrowRight size={16} />
              </button>
            </section>
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
                {profile.label} · Leave at {sgTime(request.departure)}
                {request.arriveBy
                  ? ` · Arrive by ${sgTime(request.arriveBy)}`
                  : ""}
              </p>
              <div className="preference-chips">
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
        <footer className="site-footer">
          <span className="footer-brand">
            <TrainFront size={16} /> Made for the way you move.
          </span>
          <span>
            {plan
              ? `${stale ? "Last saved" : "Updated"} ${sgTime(plan.generatedAt)} SGT`
              : "Planning your journey"}{" "}
            ·{" "}
            <button onClick={() => setModal("sources")}>Data & privacy</button>
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
      {modal === "profile" && (
        <Modal
          title="A commute that feels like you"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p className="muted">
              Choose a starting point. Make the preferences your own.
            </p>
            <div className="persona-options">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => choosePersona(p.id)}
                  className={persona === p.id ? "persona active" : "persona"}
                >
                  <span className="persona-avatar">
                    {p.id === "lim" ? "ML" : p.name[0]}
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.label}</small>
                  </span>
                  {persona === p.id && <Check size={18} />}
                </button>
              ))}
            </div>
            <p className="persona-description">“{profile.description}”</p>
            <h3>The little things that matter</h3>
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
                    updateRequest({
                      preferences: {
                        ...request.preferences,
                        [p.key]: e.target.checked,
                        ...(p.key === "stepFree"
                          ? { walkingSpeed: e.target.checked ? 40 : 75 }
                          : {}),
                      },
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
                    updateRequest({
                      preferences: {
                        ...request.preferences,
                        maxWalk: Math.min(
                          3500,
                          Math.max(200, Number(e.target.value)),
                        ),
                      },
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
                    updateRequest({
                      preferences: {
                        ...request.preferences,
                        alertThreshold: Math.min(
                          60,
                          Math.max(3, Number(e.target.value)),
                        ),
                      },
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
      {modal === "sources" && (
        <Modal
          title="Good advice starts with honest data"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <div className="mode-switch">
              <button
                className={request.dataMode === "demo" ? "active" : ""}
                onClick={() => {
                  const value = { ...request, dataMode: "demo" as const };
                  setRequest(value);
                  void runPlan(value);
                }}
              >
                Demo scenarios
              </button>
              <button
                className={request.dataMode === "live" ? "active" : ""}
                onClick={() => {
                  const value = { ...request, dataMode: "live" as const };
                  setRequest(value);
                  void runPlan(value);
                }}
              >
                Live connections
              </button>
            </div>
            <p>
              Demo scenarios use actual OpenStreetMap routes with simulated
              disruptions, crowds, weather and works. Live mode uses connected
              official feeds, and explicitly marks unavailable signals.
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
                Choose your doors, departure and arrival deadline. You can
                select one of three commuter profiles.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>See the change before you leave.</h3>
              <p>
                Try the labelled demo scenarios. Compare the original route with
                the recommendation and its estimated time range.
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
