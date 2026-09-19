import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import CrowdIndicator from "./CrowdIndicator";
import { sgTime } from "../shared/catalog";
import {
  stationColor,
  stationTextColor,
  type StationBoard,
  type StationCrowd,
} from "../shared/transit-details";
import type { BusArrival, Conditions, TransitStop } from "../shared/types";

export default function StopDetails({
  stop,
  demo,
  at,
  conditions,
  onClose,
}: {
  stop: TransitStop;
  demo: boolean;
  at: string;
  conditions?: Conditions;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [board, setBoard] = useState<StationBoard | null>(null);
  const [buses, setBuses] = useState<BusArrival[]>([]);
  const [status, setStatus] = useState("Loading…");
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [updated, setUpdated] = useState<number>();
  const clock = demo ? Date.parse(at) : now;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 10000);
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (pending || document.hidden) return;
      if (demo && stop.mode === "bus") {
        setBuses(
          conditions?.buses.filter((b) => stop.codes.includes(b.stop)) ?? [],
        );
        setStatus("Simulated");
        return;
      }
      if (!online) {
        setStatus("Offline");
        return;
      }
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const query = new URLSearchParams({
          id: stop.id,
          ...(demo ? { demo: "true", at } : {}),
        });
        const response = await fetch(
          stop.mode === "bus"
            ? `/api/buses/${stop.codes[0]}`
            : `/api/station-board?${query}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (disposed) return;
        if (stop.mode === "rail") {
          setBoard(data);
          setStatus("Scheduled departures");
        } else {
          const stamp = Date.parse(data.updatedAt);
          setUpdated(stamp);
          const stale =
            data.status === "stale" ||
            (data.status !== "unavailable" &&
              (!Number.isFinite(stamp) || Date.now() - stamp > 90000));
          setStatus(
            stale
              ? "Stale data"
              : data.simulated || data.status === "demo"
                ? "Simulated"
                : data.status === "live"
                  ? "Live bus arrivals"
                  : "Unavailable",
          );
          setBuses(
            stale || data.status === "unavailable" ? [] : (data.buses ?? []),
          );
        }
      } catch {
        if (!disposed) {
          setStatus("Unavailable");
          setBuses([]);
          setBoard(null);
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [stop, demo, at, conditions, online]);
  const stale =
    !demo &&
    stop.mode === "bus" &&
    updated !== undefined &&
    now - updated > 90000;
  const usable = (online || (demo && stop.mode === "bus")) && !stale;
  const time = (value: string) =>
    `${Math.max(0, Math.ceil((Date.parse(value) - clock) / 60000))} min · ${sgTime(value)}`;
  const demoCrowds =
    conditions?.crowd
      .filter(
        (c) =>
          stop.codes.includes(c.station) &&
          !c.forecast &&
          Date.parse(c.start) <= clock &&
          Date.parse(c.end) > clock,
      )
      .map((c) => ({
        line: c.line,
        level: c.level,
        status: "simulated platform crowd",
        start: c.start,
        end: c.end,
      })) ?? [];
  const crowds = demo ? demoCrowds : (board?.crowds ?? []);
  const forecasts: StationCrowd[] = demo
    ? (conditions?.crowd ?? [])
        .filter(
          (c) =>
            stop.codes.includes(c.station) &&
            c.forecast &&
            Date.parse(c.end) > clock,
        )
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .filter(
          (c, i, rows) =>
            rows.slice(0, i).filter((r) => r.line === c.line).length < 3,
        )
        .map((c) => ({ ...c, status: "simulated forecast" }))
    : (board?.forecasts ?? []);
  const crowdCards = (rows: StationCrowd[], forecast: boolean) => {
    const available = demo || usable;
    const entries: StationCrowd[] = rows.length
      ? rows
      : [{ line: "", level: "unknown", status: "unavailable" }];
    return (
      <div className="station-crowd-cards">
        {entries.map((c, i) => {
          const expired = !!c.end && Date.parse(c.end) <= clock;
          const level = available && !expired ? c.level : "unknown";
          return (
            <div
              className="station-crowd-card"
              key={`${c.line}:${c.start ?? i}`}
            >
              <div>
                <strong>{c.line || "Station"}</strong>
                <small>
                  {forecast ? "Forecast" : "Now"}
                  {c.start && c.end
                    ? ` · ${sgTime(c.start)}–${sgTime(c.end)}`
                    : ""}
                </small>
              </div>
              <CrowdIndicator level={level} />
              {(!available ||
                expired ||
                c.status === "stale" ||
                c.status === "unavailable" ||
                demo ||
                c.status === "simulated") && (
                <small className="station-crowd-note">
                  {!available
                    ? "Offline · fresh data unavailable"
                    : expired
                      ? "Expired reading"
                      : c.status}
                </small>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="modal stop-details"
      aria-label={`${stop.name} information`}
      onCancel={onClose}
    >
      <div className="modal-header">
        <h2>{stop.name}</h2>
        <button
          className="icon-button"
          aria-label="Close station or stop information"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="stop-detail-body">
        <div className="station-code-list">
          {stop.codes.map((code) => (
            <span
              key={code}
              className="station-code"
              style={{
                background: stationColor(code, stop.lines),
                color: stationTextColor(stationColor(code, stop.lines)),
              }}
            >
              {code}
            </span>
          ))}
        </div>
        <p role="status">
          {demo ? "Demo clock · " : ""}
          {!online && !(demo && stop.mode === "bus")
            ? "Offline · reconnect for arrival information"
            : stale
              ? "Stale data · fresh arrivals unavailable"
              : status}
        </p>
        {stop.mode === "rail" ? (
          <>
            <h3>Current crowdedness</h3>
            {crowdCards(crowds, false)}
            <h3>Predicted crowdedness</h3>
            {crowdCards(forecasts, true)}
            <p className="station-crowd-caption">
              1 person: low · 2: moderate · 3: high. Forecasts are predictions
              for the displayed time slots.
            </p>
            <h3>Next trains</h3>
            {usable && board?.groups.length ? (
              board.groups.map((group, index) => (
                <section className="stop-service-card" key={index}>
                  <strong
                    style={{
                      borderLeft: `5px solid ${stationColor("", [group.line])}`,
                      paddingLeft: 8,
                    }}
                  >
                    {group.line} · towards {group.towards}
                  </strong>
                  <ul>
                    {group.times
                      .filter((t) => Date.parse(t) >= clock)
                      .map((t) => (
                        <li key={t}>{time(t)}</li>
                      ))}
                  </ul>
                </section>
              ))
            ) : (
              <p>No upcoming scheduled departures available.</p>
            )}
            <p className="muted">
              Timetable only, not live train tracking. Delays may change these
              times. Crowd readings describe the platform, not each train.
            </p>
          </>
        ) : (
          <>
            <h3>Next buses</h3>
            {stop.lines.map((service) => {
              const arrivals = usable
                ? buses
                    .filter(
                      (b) =>
                        b.service === service &&
                        b.monitored &&
                        b.status !== "stale" &&
                        Date.parse(b.eta) >= clock,
                    )
                    .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))
                    .slice(0, 3)
                : [];
              return (
                <section className="stop-service-card" key={service}>
                  <h4>Bus {service}</h4>
                  {arrivals.length ? (
                    arrivals.map((b, i) => (
                      <div className="bus-arrival-row" key={`${b.eta}:${i}`}>
                        <strong>{time(b.eta)}</strong>
                        <span>
                          Crowding:{" "}
                          {b.load === "unknown" ? "Unavailable" : b.load}
                        </span>
                        <span>
                          {(
                            {
                              SD: "Single-deck bus",
                              DD: "Double-deck bus",
                              BD: "Bendy bus",
                            } as Record<string, string>
                          )[b.type] ?? "Bus type unavailable"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>Arrivals, crowding and bus type unavailable.</p>
                  )}
                </section>
              );
            })}
            {!stop.lines.length && (
              <p>No bundled services available for this stop.</p>
            )}
          </>
        )}
        <small>Refreshes every 30 seconds while open.</small>
      </div>
    </dialog>,
    document.querySelector(".app-shell") ?? document.body,
  );
}
