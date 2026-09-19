import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import L from "leaflet";
import {
  ArrowRight,
  BusFront,
  CircleAlert,
  Database,
  FlaskConical,
  Gift,
  RefreshCw,
  TrainFront,
  UsersRound,
} from "lucide-react";
import type {
  BusArrival,
  Crowd,
  CrowdReading,
  FeedStatus,
  TransitStop,
} from "../../shared/types";
import type { BusServiceMap } from "../../shared/transit-details";
import { canonicalLine, lineColors } from "../../shared/catalog";
import {
  calculateRewardFlow,
  dashboardCrowdLines,
  stationCodeForLine,
  type DashboardCrowdLine,
} from "../../shared/crowd-dashboard";
import "leaflet/dist/leaflet.css";
import "./styles.css";

type TimeLayer = "current" | "forecast";
type NetworkLayer = "rail" | "bus";

interface RailPayload {
  line: DashboardCrowdLine;
  stations: TransitStop[];
  readings: CrowdReading[];
  feeds: FeedStatus[];
}

interface CrowdNode {
  id: string;
  name: string;
  code: string;
  lat: number;
  lon: number;
  crowd: Crowd;
  status: string;
  window?: string;
  sequence?: number;
}

interface BusObservation {
  crowd: Crowd;
  status: string;
  eta?: string;
  vehicleType?: string;
}

const crowdMeta: Record<Crowd, { label: string; color: string }> = {
  low: { label: "Low", color: "#3aa676" },
  moderate: { label: "Moderate", color: "#e1a83b" },
  high: { label: "High", color: "#df665a" },
  unknown: { label: "Unknown", color: "#80918b" },
};

const lineNames: Record<DashboardCrowdLine, string> = {
  EWL: "East West Line",
  DTL: "Downtown Line",
  NEL: "North East Line",
  CCL: "Circle Line",
  TEL: "Thomson–East Coast Line",
  NSL: "North South Line",
  CGL: "Changi Airport branch",
  CEL: "Circle extension",
  SLRT: "Sengkang LRT",
  PLRT: "Punggol LRT",
  BPL: "Bukit Panjang LRT",
};

function formatWindow(reading?: CrowdReading) {
  if (!reading) return undefined;
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-SG", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Singapore",
    }).format(new Date(value));
  return `${format(reading.start)}–${format(reading.end)}`;
}

function selectedReading(
  readings: CrowdReading[],
  code: string,
  layer: TimeLayer,
) {
  const now = Date.now();
  const candidates = readings.filter(
    (reading) =>
      reading.station === code && reading.forecast === (layer === "forecast"),
  );
  if (layer === "forecast")
    return candidates
      .filter((reading) => Date.parse(reading.end) > now)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  return candidates
    .filter(
      (reading) =>
        Date.parse(reading.start) <= now && Date.parse(reading.end) > now,
    )
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
}

function previewCrowd(index: number, length: number): Crowd {
  const progress = index / Math.max(1, length - 1);
  if (progress > 0.43 && progress < 0.64) return "high";
  if (progress > 0.25 && progress < 0.8) return "moderate";
  return "low";
}

function routeSampleStops(stops: (TransitStop & { sequence: number })[]) {
  if (!stops.length) return [];
  const preferredIndexes = [0, 0.25, 0.5, 0.75, 1].map((fraction) =>
    Math.round((stops.length - 1) * fraction),
  );
  const selected: (TransitStop & { sequence: number })[] = [];
  const seenCodes = new Set<string>();
  const add = (stop: TransitStop & { sequence: number }) => {
    const code = stop.codes[0];
    if (!seenCodes.has(code) && selected.length < 5) {
      seenCodes.add(code);
      selected.push(stop);
    }
  };
  preferredIndexes.forEach((index) => add(stops[index]));
  stops.forEach(add);
  return selected;
}

function CrowdPill({ crowd }: { crowd: Crowd }) {
  return (
    <span className={`crowd-pill ${crowd}`}>
      <span aria-hidden="true" />
      {crowdMeta[crowd].label}
    </span>
  );
}

const nodeCodeLabel = (node?: CrowdNode) =>
  node ? `${node.code}${node.sequence ? ` · stop ${node.sequence}` : ""}` : "—";

function mapTooltip(title: string, subtitle: string, detail: string) {
  const container = document.createElement("div");
  const heading = document.createElement("strong");
  const description = document.createElement("span");
  const note = document.createElement("small");
  heading.textContent = title;
  description.textContent = subtitle;
  note.textContent = detail;
  container.append(heading, document.createElement("br"), description);
  container.append(document.createElement("br"), note);
  return container;
}

function NetworkMap({
  layer,
  railNodes,
  railLine,
  busStops,
  busObservations,
  source,
  alternative,
  shiftedTrips,
  onSelectBusStop,
}: {
  layer: NetworkLayer;
  railNodes: CrowdNode[];
  railLine: DashboardCrowdLine;
  busStops: (TransitStop & { sequence: number })[];
  busObservations: Record<string, BusObservation>;
  source?: CrowdNode;
  alternative?: CrowdNode;
  shiftedTrips: number;
  onSelectBusStop: (stop: TransitStop & { sequence: number }) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!element.current || map.current) return;
    const instance = L.map(element.current, {
      center: [1.3521, 103.8198],
      zoom: 12,
      minZoom: 11,
      maxZoom: 18,
      zoomControl: true,
    });
    L.tileLayer(
      "https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png",
      {
        detectRetina: true,
        minZoom: 11,
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution:
          '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>',
      },
    ).addTo(instance);
    overlay.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      overlay.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const group = overlay.current;
    if (!instance || !group) return;
    group.clearLayers();
    const points: L.LatLngExpression[] = [];

    if (layer === "rail") {
      const byPrefix = new Map<string, CrowdNode[]>();
      railNodes.forEach((node) => {
        const prefix = node.code.match(/^[A-Z]+/)?.[0] ?? railLine;
        const branch = byPrefix.get(prefix) ?? [];
        branch.push(node);
        byPrefix.set(prefix, branch);
      });
      byPrefix.forEach((nodes) => {
        if (nodes.length > 1)
          L.polyline(
            nodes.map((node) => [node.lat, node.lon] as L.LatLngTuple),
            {
              color: lineColors[canonicalLine(railLine)] ?? "#315f56",
              weight: 5,
              opacity: 0.75,
            },
          ).addTo(group);
      });
      railNodes.forEach((node) => {
        points.push([node.lat, node.lon]);
        L.circleMarker([node.lat, node.lon], {
          radius:
            node.crowd === "high" ? 10 : node.crowd === "moderate" ? 8 : 6,
          color: "#ffffff",
          weight: 2,
          fillColor: crowdMeta[node.crowd].color,
          fillOpacity: 1,
        })
          .bindTooltip(
            mapTooltip(
              node.name,
              `${node.code} · ${crowdMeta[node.crowd].label}`,
              `${node.status}${node.window ? ` · ${node.window}` : ""}`,
            ),
          )
          .addTo(group);
      });
    } else if (busStops.length) {
      L.polyline(
        busStops.map((stop) => [stop.lat, stop.lon] as L.LatLngTuple),
        {
          color: "#6650a7",
          weight: 4,
          opacity: 0.82,
          dashArray: "3 7",
        },
      ).addTo(group);
      busStops.forEach((stop) => {
        points.push([stop.lat, stop.lon]);
        const observation = busObservations[stop.codes[0]];
        const crowd = observation?.crowd ?? "unknown";
        L.circleMarker([stop.lat, stop.lon], {
          radius: observation ? 8 : 5,
          color: "#ffffff",
          weight: 2,
          fillColor: crowdMeta[crowd].color,
          fillOpacity: 1,
        })
          .bindTooltip(
            mapTooltip(
              `${stop.sequence}. ${stop.name}`,
              `${stop.codes[0]} · ${observation ? crowdMeta[crowd].label : "Not sampled"}`,
              observation?.status ?? "Click to request this stop",
            ),
          )
          .on("click", () => onSelectBusStop(stop))
          .addTo(group);
      });
    }

    if (source && alternative && shiftedTrips > 0) {
      L.polyline(
        [
          [source.lat, source.lon],
          [alternative.lat, alternative.lon],
        ],
        {
          color: "#7f5bd7",
          weight: Math.min(11, 3 + shiftedTrips / 12),
          opacity: 0.88,
          dashArray: "9 9",
        },
      )
        .bindTooltip(`${shiftedTrips} assumed redirected trips / 15 min`)
        .addTo(group);
    }

    if (points.length)
      instance.fitBounds(L.latLngBounds(points), {
        padding: [34, 34],
        maxZoom: layer === "bus" ? 14 : 13,
      });
  }, [
    layer,
    railNodes,
    railLine,
    busStops,
    busObservations,
    source,
    alternative,
    shiftedTrips,
    onSelectBusStop,
  ]);

  return <div className="network-map" ref={element} aria-label="Crowd map" />;
}

function Dashboard() {
  const [networkLayer, setNetworkLayer] = useState<NetworkLayer>("rail");
  const [railLine, setRailLine] = useState<DashboardCrowdLine>("EWL");
  const [timeLayer, setTimeLayer] = useState<TimeLayer>("current");
  const [railPayload, setRailPayload] = useState<RailPayload | null>(null);
  const [railLoading, setRailLoading] = useState(false);
  const [railError, setRailError] = useState("");
  const [preview, setPreview] = useState(false);
  const [busService, setBusService] = useState("27");
  const [busAnchor, setBusAnchor] = useState("64009");
  const [busMap, setBusMap] = useState<BusServiceMap | null>(null);
  const [busDirection, setBusDirection] = useState(0);
  const [busLoading, setBusLoading] = useState(false);
  const [busError, setBusError] = useState("");
  const [busObservations, setBusObservations] = useState<
    Record<string, BusObservation>
  >({});
  const [sampling, setSampling] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [alternativeId, setAlternativeId] = useState("");
  const [eligibleTrips, setEligibleTrips] = useState(250);
  const [uptake, setUptake] = useState(12);

  const loadRail = async (line = railLine) => {
    setRailLoading(true);
    setRailError("");
    try {
      const response = await fetch(
        `/api/crowd-dashboard/rail?line=${encodeURIComponent(line)}`,
      );
      if (!response.ok) throw new Error("Crowd feed request failed");
      setRailPayload(await response.json());
    } catch {
      setRailError("The rail crowd layer could not be loaded.");
    } finally {
      setRailLoading(false);
    }
  };

  useEffect(() => {
    setPreview(false);
    void loadRail(railLine);
  }, [railLine]);

  const railNodes = useMemo<CrowdNode[]>(() => {
    if (!railPayload) return [];
    return railPayload.stations.flatMap((station, index) => {
      const code = stationCodeForLine(station, railLine);
      if (!code) return [];
      const reading = selectedReading(railPayload.readings, code, timeLayer);
      const crowd = preview
        ? previewCrowd(index, railPayload.stations.length)
        : (reading?.level ?? "unknown");
      return [
        {
          id: `rail:${code}`,
          name: station.name,
          code,
          lat: station.lat,
          lon: station.lon,
          crowd,
          status: preview
            ? "Illustrative preview"
            : reading
              ? timeLayer === "forecast"
                ? "DataMall forecast"
                : "DataMall current"
              : "Unavailable / unknown",
          window: preview ? "not a live reading" : formatWindow(reading),
        },
      ];
    });
  }, [railPayload, railLine, timeLayer, preview]);

  const direction = busMap?.directions[busDirection];
  const busStops = direction?.stops ?? [];
  const busNodes = useMemo<CrowdNode[]>(
    () =>
      busStops.map((stop) => {
        const observation = busObservations[stop.codes[0]];
        return {
          id: `bus:${direction?.direction ?? busDirection}:${stop.sequence}:${stop.codes[0]}`,
          name: stop.name,
          code: stop.codes[0],
          lat: stop.lat,
          lon: stop.lon,
          crowd: observation?.crowd ?? "unknown",
          status: observation?.status ?? "Not sampled",
          sequence: stop.sequence,
        };
      }),
    [busStops, busObservations, direction?.direction, busDirection],
  );
  const activeNodes = networkLayer === "rail" ? railNodes : busNodes;

  useEffect(() => {
    if (!activeNodes.length) return;
    const known = activeNodes.filter((node) => node.crowd !== "unknown");
    const rank = { low: 0, moderate: 1, high: 2, unknown: -1 };
    const source = [...known].sort((a, b) => rank[b.crowd] - rank[a.crowd])[0];
    const alternative = [...known]
      .filter((node) => source && rank[node.crowd] < rank[source.crowd])
      .sort((a, b) => rank[a.crowd] - rank[b.crowd])[0];
    setSourceId(source?.id ?? activeNodes[0].id);
    setAlternativeId(alternative?.id ?? activeNodes.at(-1)!.id);
  }, [activeNodes]);

  const source = activeNodes.find((node) => node.id === sourceId);
  const alternative = activeNodes.find((node) => node.id === alternativeId);
  const flow = calculateRewardFlow({
    sourceCrowd: source?.crowd ?? "unknown",
    alternativeCrowd: alternative?.crowd ?? "unknown",
    eligibleTrips,
    assumedUptakePercent: uptake,
  });

  const loadBusRoute = async () => {
    setBusLoading(true);
    setBusError("");
    setBusObservations({});
    try {
      const query = new URLSearchParams({
        service: busService.trim(),
        stop: busAnchor.trim(),
      });
      const response = await fetch(`/api/bus-service?${query}`);
      if (!response.ok) throw new Error();
      const payload: BusServiceMap = await response.json();
      if (!payload.directions.length)
        throw new Error("No matching service and stop were found.");
      setBusMap(payload);
      setBusDirection(0);
    } catch (error) {
      setBusMap(null);
      setBusError(
        error instanceof Error && error.message
          ? error.message
          : "The bus route could not be loaded.",
      );
    } finally {
      setBusLoading(false);
    }
  };

  const observeBusStop = async (stop: TransitStop & { sequence: number }) => {
    const code = stop.codes[0];
    setBusObservations((current) => ({
      ...current,
      [code]: { crowd: "unknown", status: "Loading…" },
    }));
    try {
      const response = await fetch(`/api/buses/${encodeURIComponent(code)}`);
      if (!response.ok) throw new Error();
      const payload: {
        buses: BusArrival[];
        status: string;
        simulated?: boolean;
      } = await response.json();
      const arrival = payload.buses
        .filter((bus) => bus.service === busService.trim())
        .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))[0];
      setBusObservations((current) => ({
        ...current,
        [code]: {
          crowd: arrival?.load ?? "unknown",
          status: arrival
            ? `${payload.simulated ? "Simulated" : payload.status} arriving vehicle`
            : `${payload.status} · no matching arrival`,
          eta: arrival?.eta,
          vehicleType: arrival?.type,
        },
      }));
    } catch {
      setBusObservations((current) => ({
        ...current,
        [code]: { crowd: "unknown", status: "Unavailable" },
      }));
    }
  };

  const sampleBusRoute = async () => {
    if (!busStops.length) return;
    setSampling(true);
    for (const stop of routeSampleStops(busStops)) await observeBusStop(stop);
    setSampling(false);
  };

  const previewBusRoute = () => {
    if (!busStops.length) return;
    const sample: Record<string, BusObservation> = {};
    const stops = routeSampleStops(busStops);
    stops.forEach((stop, position) => {
      sample[stop.codes[0]] = {
        crowd: previewCrowd(position, stops.length),
        status: "Illustrative preview · not live",
      };
    });
    setBusObservations(sample);
  };

  const feedUnavailable =
    !railLoading &&
    !preview &&
    railNodes.every((node) => node.crowd === "unknown");
  const sampledBusStops = Object.keys(busObservations).length;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <div>
            <strong>Wayce Crowd Flow Lab</strong>
            <span>Separate exploration UI · not part of the commuter app</span>
          </div>
        </div>
        <div className="header-status">
          <span className="prototype-chip">
            <FlaskConical size={15} /> Prototype
          </span>
          <span>Singapore · 15-minute view</span>
        </div>
      </header>

      <section className="dashboard-intro">
        <div>
          <span className="eyebrow">Network operations concept</span>
          <h1>See crowd pressure. Test a gentler nudge.</h1>
          <p>
            Inspect DataMall crowd observations, then explore how the existing
            quieter-route bonus could redistribute a user-defined group of
            eligible journeys.
          </p>
        </div>
        <div className="legend" aria-label="Crowd level legend">
          {(Object.keys(crowdMeta) as Crowd[]).map((crowd) => (
            <CrowdPill crowd={crowd} key={crowd} />
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <aside className="control-panel panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">01</span>
              <h2>Observed layer</h2>
            </div>
            <Database size={20} />
          </div>

          <div className="segmented-control" aria-label="Network layer">
            <button
              className={networkLayer === "rail" ? "active" : ""}
              onClick={() => setNetworkLayer("rail")}
            >
              <TrainFront size={17} /> Rail
            </button>
            <button
              className={networkLayer === "bus" ? "active" : ""}
              onClick={() => setNetworkLayer("bus")}
            >
              <BusFront size={17} /> Bus
            </button>
          </div>

          {networkLayer === "rail" ? (
            <>
              <label>
                Rail line
                <select
                  value={railLine}
                  onChange={(event) =>
                    setRailLine(event.target.value as DashboardCrowdLine)
                  }
                >
                  {dashboardCrowdLines.map((line) => (
                    <option value={line} key={line}>
                      {line} · {lineNames[line]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="segmented-control small" aria-label="Time layer">
                <button
                  className={timeLayer === "current" ? "active" : ""}
                  onClick={() => setTimeLayer("current")}
                >
                  Current
                </button>
                <button
                  className={timeLayer === "forecast" ? "active" : ""}
                  onClick={() => setTimeLayer("forecast")}
                >
                  Forecast
                </button>
              </div>
              <button
                className="secondary-button"
                onClick={() => void loadRail()}
                disabled={railLoading}
              >
                <RefreshCw size={16} className={railLoading ? "spin" : ""} />
                {railLoading ? "Refreshing…" : "Refresh selected line"}
              </button>
              {(feedUnavailable || railError || preview) && (
                <button
                  className={`preview-button ${preview ? "active" : ""}`}
                  onClick={() => setPreview((value) => !value)}
                >
                  <FlaskConical size={16} />
                  {preview
                    ? "Hide illustrative preview"
                    : "Show illustrative preview"}
                </button>
              )}
              <div className="source-card">
                <span className={`source-dot ${preview ? "preview" : ""}`} />
                <div>
                  <strong>
                    {preview
                      ? "Illustrative data"
                      : railPayload?.feeds.some(
                            (feed) => feed.status === "live",
                          )
                        ? "Official DataMall"
                        : railPayload?.feeds.some(
                              (feed) => feed.status === "demo",
                            )
                          ? "Local simulator"
                          : "Feed unavailable"}
                  </strong>
                  <span>
                    {preview
                      ? "For interaction review only"
                      : `${railNodes.filter((node) => node.crowd !== "unknown").length}/${railNodes.length} stations have a ${timeLayer} reading`}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="field-row">
                <label>
                  Service
                  <input
                    value={busService}
                    onChange={(event) => setBusService(event.target.value)}
                    maxLength={12}
                  />
                </label>
                <label>
                  Known stop
                  <input
                    value={busAnchor}
                    onChange={(event) => setBusAnchor(event.target.value)}
                    inputMode="numeric"
                    maxLength={5}
                  />
                </label>
              </div>
              <button
                className="primary-button"
                onClick={() => void loadBusRoute()}
                disabled={busLoading}
              >
                <BusFront size={16} />
                {busLoading ? "Loading route…" : "Load bus route"}
              </button>
              {busMap && busMap.directions.length > 1 && (
                <label>
                  Direction
                  <select
                    value={busDirection}
                    onChange={(event) =>
                      setBusDirection(Number(event.target.value))
                    }
                  >
                    {busMap.directions.map((item, index) => (
                      <option value={index} key={item.direction}>
                        Direction {item.direction}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="secondary-button"
                onClick={() => void sampleBusRoute()}
                disabled={!busStops.length || sampling}
              >
                <RefreshCw size={16} className={sampling ? "spin" : ""} />
                {sampling ? "Sampling 5 stops…" : "Sample 5 route stops"}
              </button>
              <button
                className="preview-button"
                onClick={previewBusRoute}
                disabled={!busStops.length}
              >
                <FlaskConical size={16} /> Show illustrative preview
              </button>
              <p className="field-note">
                Bus occupancy describes the next arriving vehicles at sampled
                stops—not every bus along the whole route. Click any stop to
                request it individually.
              </p>
              <div className="source-card">
                <span className="source-dot bus" />
                <div>
                  <strong>
                    {busMap ? `Bus ${busService}` : "Route not loaded"}
                  </strong>
                  <span>
                    {busMap
                      ? `${sampledBusStops}/${busStops.length} stops sampled`
                      : "Try the bundled example: 27 at 64009"}
                  </span>
                </div>
              </div>
            </>
          )}

          {(railError || busError) && (
            <p className="error-note" role="alert">
              <CircleAlert size={16} /> {railError || busError}
            </p>
          )}

          <div className="method-note">
            <CircleAlert size={17} />
            <p>
              Unknown, stale and unavailable data stays unknown. It is never
              shown as low crowding.
            </p>
          </div>
        </aside>

        <section className="map-panel panel">
          <div className="map-toolbar">
            <div>
              <span className="eyebrow">Live evidence layer</span>
              <h2>
                {networkLayer === "rail"
                  ? `${railLine} · ${timeLayer}`
                  : busMap
                    ? `Bus ${busService} · direction ${direction?.direction}`
                    : "Bus route"}
              </h2>
            </div>
            <span className="map-caption">
              {networkLayer === "bus"
                ? "Dotted line is schematic between ordered DataMall stops"
                : "Marker size follows categorical crowd severity"}
            </span>
          </div>
          <NetworkMap
            layer={networkLayer}
            railNodes={railNodes}
            railLine={railLine}
            busStops={busStops}
            busObservations={busObservations}
            source={source}
            alternative={alternative}
            shiftedTrips={flow.shiftedTrips}
            onSelectBusStop={(stop) => void observeBusStop(stop)}
          />
          <div className="map-footnote">
            <span>
              <i className="route-swatch rail" /> Rail connection
            </span>
            <span>
              <i className="route-swatch bus" /> Bus stop sequence
            </span>
            <span>
              <i className="route-swatch flow" /> Illustrative redirection
            </span>
          </div>
        </section>

        <aside className="scenario-panel panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">02</span>
              <h2>Reward scenario</h2>
            </div>
            <Gift size={20} />
          </div>

          <div className="reward-rule">
            <span>Current quieter-route bonus</span>
            <strong>+{flow.quieterRouteBonus} points</strong>
            <small>Awarded only after final-step confirmation</small>
          </div>
          <p className="field-note">
            The live app compares whole-journey crowd levels. In this draft, the
            two selected map nodes stand in for the original and alternative
            route observations.
          </p>

          <label>
            Crowded source
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {activeNodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {nodeCodeLabel(node)} · {node.name} ·{" "}
                  {crowdMeta[node.crowd].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lower-crowd alternative
            <select
              value={alternativeId}
              onChange={(event) => setAlternativeId(event.target.value)}
            >
              {activeNodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {nodeCodeLabel(node)} · {node.name} ·{" "}
                  {crowdMeta[node.crowd].label}
                </option>
              ))}
            </select>
          </label>

          <div className="crowd-comparison">
            <div>
              <span>From</span>
              <strong>{nodeCodeLabel(source)}</strong>
              <CrowdPill crowd={source?.crowd ?? "unknown"} />
            </div>
            <ArrowRight size={21} aria-hidden="true" />
            <div>
              <span>To</span>
              <strong>{nodeCodeLabel(alternative)}</strong>
              <CrowdPill crowd={alternative?.crowd ?? "unknown"} />
            </div>
          </div>

          <label className="range-label">
            <span>
              Eligible journeys / 15 min <strong>{eligibleTrips}</strong>
            </span>
            <input
              type="range"
              min="50"
              max="1000"
              step="50"
              value={eligibleTrips}
              onChange={(event) => setEligibleTrips(Number(event.target.value))}
            />
          </label>
          <label className="range-label">
            <span>
              Assumed uptake <strong>{uptake}%</strong>
            </span>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={uptake}
              onChange={(event) => setUptake(Number(event.target.value))}
            />
          </label>
          <p className="field-note">
            Uptake is your scenario input. Wayce has no measured behavioural
            response curve connecting points to route choice.
          </p>

          <div
            className={`flow-result ${flow.canRedirect ? "valid" : "invalid"}`}
          >
            <div>
              <UsersRound size={21} />
              <span>Illustrative shift</span>
            </div>
            <strong>{flow.shiftedTrips}</strong>
            <span>journeys redirected / 15 min</span>
            <div className="flow-bar" aria-hidden="true">
              <span
                style={{
                  width: `${eligibleTrips ? (flow.shiftedTrips / eligibleTrips) * 100 : 0}%`,
                }}
              />
            </div>
            <small>{flow.reason}</small>
          </div>

          <div className="impact-grid">
            <div>
              <span>Stay on source</span>
              <strong>{flow.remainingTrips}</strong>
            </div>
            <div>
              <span>Bonus liability</span>
              <strong>{flow.rewardPoints.toLocaleString()} pts</strong>
            </div>
          </div>

          <div className="method-note accent">
            <FlaskConical size={17} />
            <p>
              This is a deterministic sandbox, not a passenger forecast. A pilot
              would need anonymised aggregate outcomes to validate actual uptake
              and avoid overloading the alternative.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("crowd-dashboard-root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
