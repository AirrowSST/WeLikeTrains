import { useEffect, useState } from "react";
import { BusFront, RefreshCw, TrainFront } from "lucide-react";
import type { BusArrival, Segment } from "../shared/types";
import { sgTime } from "../shared/catalog";

interface ArrivalBoard {
  status: "live" | "scheduled" | "demo" | "stale" | "unavailable";
  times: string[];
  updatedAt?: string;
  accessedOn?: string;
}
export function matchingBusTimes(
  buses: BusArrival[],
  stop: string,
  service: string,
  now: number,
) {
  return [
    ...new Set(
      buses
        .filter(
          (bus) =>
            bus.stop === stop &&
            bus.service === service &&
            bus.monitored === true &&
            bus.status !== "stale" &&
            Number.isFinite(Date.parse(bus.eta)) &&
            Date.parse(bus.eta) >= now,
        )
        .map((bus) => bus.eta),
    ),
  ]
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .slice(0, 3);
}

export default function TransitArrivals({
  segments,
  step,
  demo,
  departure,
  demoBuses,
}: {
  segments: Segment[];
  step: number;
  demo: boolean;
  departure: string;
  demoBuses: BusArrival[];
}) {
  const index = segments.findIndex(
    (segment, i) =>
      i >= step && (segment.mode === "bus" || segment.mode === "rail"),
  );
  if (index < 0) return null;
  const journeyAt =
    Date.parse(departure) +
    segments
      .slice(0, step)
      .reduce((sum, segment) => sum + segment.minutes * 60000, 0);
  const segmentAt =
    Date.parse(departure) +
    segments
      .slice(0, index)
      .reduce((sum, segment) => sum + segment.minutes * 60000, 0);
  const scheduledAt = segmentAt + (segments[index].waitMinutes ?? 0) * 60000;
  return (
    <Board
      key={`${step}:${index}:${segments[index].id}`}
      segment={segments[index]}
      upcoming={index > step}
      demo={demo}
      departure={departure}
      journeyAt={journeyAt}
      scheduledAt={scheduledAt}
      demoBuses={demoBuses}
    />
  );
}

function Board({
  segment,
  upcoming,
  demo,
  departure,
  journeyAt,
  scheduledAt,
  demoBuses,
}: {
  segment: Segment;
  upcoming: boolean;
  demo: boolean;
  departure: string;
  journeyAt: number;
  scheduledAt: number;
  demoBuses: BusArrival[];
}) {
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [board, setBoard] = useState<ArrivalBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const bus = segment.mode === "bus";
  const clock = bus && !demo ? now : journeyAt;
  const stop =
    segment.hops?.[0]?.codes.find((code) => /^\d{5}$/.test(code)) ??
    segment.stops.find((code) => /^\d{5}$/.test(code));
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 10000);
    const on = () => {
      setOnline(true);
      setRefresh((n) => n + 1);
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let active: AbortController | undefined;
    let pending = false;
    const fetchBoard = async () => {
      if (pending || document.visibilityState === "hidden") return;
      if (demo && bus) {
        setBoard({
          status: "demo",
          times: stop
            ? matchingBusTimes(demoBuses, stop, segment.line, journeyAt)
            : [],
        });
        return;
      }
      if (!online || (bus && !stop)) {
        setBoard({ status: "unavailable", times: [] });
        return;
      }
      pending = true;
      setBusy(true);
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), 10000);
      try {
        const response = await fetch(
          bus ? `/api/buses/${stop}` : "/api/train-arrivals",
          {
            ...(bus
              ? {}
              : {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    line: segment.line,
                    from: segment.from,
                    to: segment.to,
                    stops: segment.stops,
                    at: new Date(scheduledAt).toISOString(),
                  }),
                }),
            signal: active.signal,
          },
        );
        if (!response.ok) throw new Error("Arrival data unavailable");
        const data = await response.json();
        if (disposed) return;
        if (bus) {
          const stale =
            data.status === "stale" ||
            !Number.isFinite(Date.parse(data.updatedAt)) ||
            Date.now() - Date.parse(data.updatedAt) > 90000;
          setBoard({
            status: stale
              ? "stale"
              : data.simulated || data.status === "demo"
                ? "demo"
                : data.status === "live"
                  ? "live"
                  : "unavailable",
            times: stale
              ? []
              : matchingBusTimes(
                  data.buses ?? [],
                  stop!,
                  segment.line,
                  Date.now(),
                ),
            updatedAt: data.updatedAt,
          });
        } else
          setBoard({
            status: data.status === "scheduled" ? "scheduled" : "unavailable",
            times: (data.departures ?? [])
              .map((row: { departureAt: string }) => row.departureAt)
              .filter((at: string) => Number.isFinite(Date.parse(at)))
              .slice(0, 3),
            updatedAt: data.updatedAt,
            accessedOn: data.accessedOn,
          });
      } catch {
        if (!disposed) setBoard({ status: "unavailable", times: [] });
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!disposed) setBusy(false);
      }
    };
    void fetchBoard();
    const timer = setInterval(() => {
      if (navigator.onLine) void fetchBoard();
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void fetchBoard();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      active?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    segment,
    stop,
    demo,
    journeyAt,
    scheduledAt,
    demoBuses,
    bus,
    online,
    refresh,
  ]);

  const stale =
    board?.status === "stale" ||
    (!demo &&
      bus &&
      board?.updatedAt &&
      now - Date.parse(board.updatedAt) > 90000);
  const times =
    (online || (demo && bus)) && !stale
      ? (board?.times ?? []).filter((at) => Date.parse(at) >= clock)
      : [];
  const label =
    !online && !(demo && bus)
      ? "Offline"
      : stale
        ? "Stale data"
        : board?.status === "demo"
          ? "Simulated"
          : bus
            ? board?.status === "live"
              ? "Live bus arrivals"
              : "Bus arrivals"
            : "Scheduled departures";
  const Icon = bus ? BusFront : TrainFront;
  return (
    <section
      className="transit-arrivals"
      aria-label={bus ? "Bus arrival times" : "Train departure times"}
    >
      <header>
        <Icon size={21} />
        <div>
          <strong>
            {bus ? `Bus ${segment.line}` : `${segment.line} train`}
          </strong>
          <small>
            {upcoming ? "Next boarding" : "Boarding at"} · {segment.from}
            {bus && stop ? ` (${stop})` : ""}
          </small>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh arrival times"
          disabled={busy || !online || (demo && bus)}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      <p className="arrival-direction">
        Towards {segment.direction ?? segment.to}
      </p>
      <span className="arrival-source">
        {demo ? "Demo clock · " : ""}
        {label}
        {!bus ? ` · Journey leaves ${sgTime(departure)}` : ""}
      </span>
      {times.length > 0 ? (
        <ol className="arrival-times">
          {times.map((at) => (
            <li key={at}>
              <strong>
                {Math.ceil((Date.parse(at) - clock) / 60000) < 1
                  ? "Due"
                  : `${Math.ceil((Date.parse(at) - clock) / 60000)} min`}
              </strong>
              <span>{sgTime(at)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="arrival-empty" role="status">
          {busy
            ? "Checking arrival times…"
            : !online
              ? "Reconnect to check upcoming services."
              : stale
                ? "The last bus update is stale. Fresh arrivals are unavailable."
                : "No upcoming times available for this service."}
        </p>
      )}
      {!times.length && !busy && (
        <p className="arrival-note">
          {segment.waitMinutes !== undefined
            ? `Route plan allowed about ${Math.ceil(segment.waitMinutes)} min for boarding, including any station access. This is an estimate, not a current arrival.`
            : "Follow station or bus-stop information for the next service."}
        </p>
      )}
      {!bus && (
        <p className="arrival-note">
          Timetable for the journey time selected on the planning screen, not
          live train tracking. Delays may change these times.
          {board?.accessedOn ? ` Schedule accessed ${board.accessedOn}.` : ""}
        </p>
      )}
      {upcoming && (
        <p className="arrival-note">
          Times are at the boarding stop; allow time to finish your walk or
          transfer.
        </p>
      )}
      {bus && board?.updatedAt && (
        <small className="arrival-updated">
          Last update {sgTime(board.updatedAt)} · checks every 30 seconds while
          open
        </small>
      )}
    </section>
  );
}
