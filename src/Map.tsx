import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Bell, Layers, LocateFixed, Route } from "lucide-react";
import type {
  Journey,
  Mode,
  PlanResponse,
  Segment,
  TransitStop,
  PlanRequest,
} from "../shared/types";
import StopDetails from "./StopDetails";
import {
  stationColor,
  stationTextColor,
  type BusServiceMap,
} from "../shared/transit-details";
import { lineColors } from "../shared/catalog";
import { crowdDescription } from "../shared/crowding";
import { shelterSummary } from "../shared/shelter";
import type { LocationFix } from "./location";

let basemapPromise: Promise<any> | undefined;

// Match the committed OSM fallback's east/west coverage so a horizontal drag
// cannot reveal a blank map beyond the available detail.
const singaporeBounds = L.latLngBounds([1.144, 103.595], [1.494, 104.086]);
const oneMapTiles =
  "https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png";
const oneMapAttribution =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:16px;width:16px;vertical-align:text-bottom" />&nbsp;<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;|&nbsp;<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';
// Bus-stop density becomes useful only once the map is at neighbourhood scale.
const busStopsMinZoom = 15;

const mapIcons: Record<Mode | "landmark" | "rain", string> = {
  walk: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 5Zm-2.2 4.1 2.4 2.2 1.5 4.1 2.2 5.2h2.6l-2.4-6.4-1.2-4.4 2.4 1.4 1.5 2.6 2-1.1-1.9-3.4-4.4-2.6c-.8-.5-1.8-.7-2.7-.4l-4.1 1.4-2.4 4.1 2 1.2 2.5-3.9Zm.3 4-2.2 3.1L5 20.2l1.7 1.9 4.3-3.8 2-2.7-1.9-2Z"/></svg>`,
  rail: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="15" rx="4"/><path d="M8 6h8M8 11h8M8 17l-3 5m11-5 3 5M8 20h8"/></svg>`,
  bus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V6c0-2 1.5-3 3.5-3h7C17.5 3 19 4 19 6v10"/><path d="M6 9h12M7 16h10M8 19v2m8-2v2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>`,
  cycle: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m6 17 4-8 4 8m-6-4h7l3-5m-8 1-2-2h3"/></svg>`,
  landmark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5M9 11h1m4 0h1"/></svg>`,
  rain: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.4 8.5 3.5 3.5 0 0 0 7 15Z"/><path d="m8 18-1 2m5-2-1 3m5-3-1 2"/></svg>`,
};

const modeNames: Record<Mode, string> = {
  walk: "Walk",
  rail: "Train",
  bus: "Bus",
  cycle: "Cycle",
};

function labelledIcon(
  className: string,
  icon: keyof typeof mapIcons,
  label: string,
) {
  const root = document.createElement("span");
  root.className = className;
  const symbol = document.createElement("span");
  symbol.className = "map-symbol";
  symbol.innerHTML = mapIcons[icon];
  const text = document.createElement("strong");
  text.textContent = label;
  root.append(symbol, text);
  return root;
}

function transitStopIcon(stop: TransitStop) {
  const root = document.createElement("span");
  root.className = "transit-stop-content";
  root.setAttribute("aria-hidden", "true");
  const symbol = document.createElement("span");
  symbol.className = "transit-stop-symbol";
  symbol.innerHTML = mapIcons[stop.mode];
  if (stop.mode === "rail") {
    const colors = [
      ...new Set(stop.codes.map((code) => stationColor(code, stop.lines))),
    ];
    symbol.style.background =
      colors.length > 1
        ? `linear-gradient(135deg, ${colors.map((color, i) => `${color} ${(i / colors.length) * 100}%, ${color} ${((i + 1) / colors.length) * 100}%`).join(", ")})`
        : stationColor(stop.codes[0] ?? "", stop.lines);
    const label = document.createElement("span");
    label.className = "transit-stop-label";
    label.style.setProperty(
      "--station-line-colors",
      colors.length > 1
        ? `linear-gradient(90deg, ${colors.join(", ")})`
        : (colors[0] ?? stationColor(stop.codes[0] ?? "", stop.lines)),
    );
    const codes = document.createElement("span");
    codes.className = "transit-stop-label-codes";
    stop.codes.forEach((code) => {
      const badge = document.createElement("b");
      badge.textContent = code;
      badge.style.background = stationColor(code, stop.lines);
      badge.style.color = stationTextColor(stationColor(code, stop.lines));
      codes.append(badge);
    });
    const name = document.createElement("strong");
    name.textContent = stop.name;
    label.append(codes, name);
    root.append(symbol, label);
  } else {
    root.append(symbol);
  }
  return root;
}

function transitStopPopup(
  stop: TransitStop,
  onExpand: () => void,
  onService: (service: string) => void,
) {
  const root = document.createElement("section");
  root.className = "transit-stop-popup";
  const heading = document.createElement("button");
  heading.className = "transit-stop-popup-heading";
  heading.type = "button";
  heading.setAttribute(
    "aria-label",
    `Show ${stop.name} ${stop.mode === "rail" ? "station" : "stop"} information`,
  );
  heading.onclick = onExpand;
  if (stop.codes.length) {
    const codes = document.createElement("small");
    codes.className = "station-code-list";
    stop.codes.forEach((code) => {
      const badge = document.createElement("b");
      badge.className = "station-code";
      badge.textContent = code;
      badge.style.background = stationColor(code, stop.lines);
      badge.style.color = stationTextColor(stationColor(code, stop.lines));
      codes.append(badge);
    });
    heading.append(codes);
  }
  const name = document.createElement("strong");
  name.textContent = stop.name;
  heading.append(name);
  const more = document.createElement("span");
  more.className = "transit-stop-more";
  more.textContent = "More info";
  heading.append(more);
  root.append(heading);
  if (stop.mode === "bus" && stop.lines.length) {
    const lines = document.createElement("div");
    lines.className = "stop-service-buttons";
    stop.lines.forEach((service) => {
      const button = document.createElement("button");
      button.textContent = service;
      button.setAttribute("aria-label", `Show bus ${service} stops`);
      button.onclick = () => onService(service);
      lines.append(button);
    });
    root.append(lines);
  }
  return root;
}

function routeSegmentPopup(segment: Segment) {
  const root = document.createElement("section");
  root.className = "route-segment-popup";

  const mode = document.createElement("span");
  mode.className = `route-segment-popup-mode ${segment.mode}`;
  mode.textContent =
    segment.mode === "rail"
      ? `Train ${segment.line}`
      : segment.mode === "bus"
        ? `Bus ${segment.line}`
        : modeNames[segment.mode];

  const heading = document.createElement("strong");
  heading.textContent = `${segment.from} → ${segment.to}`;

  const summary = document.createElement("span");
  summary.className = "route-segment-popup-summary";
  summary.textContent = `About ${Math.ceil(segment.minutes)} min`;

  const details = document.createElement("dl");
  const addDetail = (label: string, value: string) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    details.append(row);
  };

  if (segment.mode === "rail" || segment.mode === "bus") {
    addDetail("Board", segment.from);
    addDetail("Alight", segment.to);
    if (segment.geometryKind === "schematic")
      addDetail("Map", "Served stops highlighted · road geometry unavailable");
    if (segment.direction) addDetail("Towards", segment.direction);
    if (segment.waitMinutes !== undefined)
      addDetail("Wait", `${Math.ceil(segment.waitMinutes)} min`);
    addDetail("Crowding", crowdDescription(segment));
  } else {
    addDetail("Distance", `${Math.round(segment.distance)} m`);
    if (segment.mode === "walk") addDetail("Shelter", shelterSummary(segment));
  }

  const instructions = document.createElement("p");
  instructions.textContent = segment.instructions;

  root.append(mode, heading, summary, details, instructions);
  if (segment.mode === "rail" || segment.mode === "bus") {
    const source = document.createElement("small");
    source.textContent = `Timing: ${segment.source}`;
    root.append(source);
  }
  return root;
}

const routeStationCodePattern =
  /^(?:EW|CG|NS|NE|CC|CE|DT|TE|BP|PE|PW|SW|SE)\d+$/i;

function routeStationCodes(codes: string[] | undefined) {
  return Array.from(
    new Set((codes ?? []).filter((code) => routeStationCodePattern.test(code))),
  ).join("/");
}

function routeTransitLabel(
  label: string,
  mode: "bus" | "rail",
  colour: string,
) {
  const root = document.createElement("span");
  root.className = `route-transit-label ${mode}`;
  if (mode === "rail") {
    label.split("/").forEach((code) => {
      const block = document.createElement("b");
      const stationColour = stationColor(code);
      block.textContent = code;
      block.style.backgroundColor = stationColour;
      block.style.color = stationTextColor(stationColour);
      root.append(block);
    });
  } else {
    root.textContent = label;
    root.style.setProperty("--route-transit-colour", colour);
  }
  return root;
}

function centerMapOnLocation(map: L.Map, coord: L.LatLngExpression) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const container = map.getContainer();
  const sheet =
    container
      .closest(".journey-navigation-stage")
      ?.querySelector<HTMLElement>(".active-journey-sheet") ??
    container
      .closest(".journey-layout")
      ?.querySelector<HTMLElement>(".journey-sheet");
  const sheetRect = sheet?.getBoundingClientRect();
  const coveredHeight = sheetRect
    ? Math.max(
        0,
        Math.min(mapRect.bottom, sheetRect.bottom) -
          Math.max(mapRect.top, sheetRect.top),
      )
    : 0;
  const upwardOffset = Math.min(110, Math.round(coveredHeight * 0.25));
  map.setView(coord, 15, { animate: false });
  if (upwardOffset) {
    const shiftedCenter = map.unproject(
      map.project(L.latLng(coord), 15).add([0, upwardOffset]),
      15,
    );
    map.setView(shiftedCenter, 15, { animate: false });
  }
}

export default function JourneyMap({
  plan,
  selected,
  location,
  onViewAlerts,
  hasAlerts,
  request,
  navigationMode = false,
  focusSegmentId,
  focusSelectedRoute = false,
  showComparison = false,
}: {
  plan: PlanResponse | null;
  selected: Journey | null;
  location: LocationFix | null;
  onViewAlerts: () => void;
  hasAlerts: boolean;
  request: PlanRequest;
  navigationMode?: boolean;
  focusSegmentId?: string;
  /** Results view recentres on the selected option rather than comparing it. */
  focusSelectedRoute?: boolean;
  /** Allows demo route results to show the original disrupted path beside the revised path. */
  showComparison?: boolean;
}) {
  const routeOnly = focusSelectedRoute || navigationMode;
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routes = useRef<L.LayerGroup | null>(null);
  const position = useRef<L.LayerGroup | null>(null);
  const activeSegmentId = useRef<string | null>(null);
  const activeSegmentPath = useRef<L.Polyline | null>(null);
  const segmentPaths = useRef(new Map<string, L.Polyline>());
  const transitMarkers = useRef(new Map<string, L.Marker>());
  const affectedRailCodes = useRef(new Set<string>());
  const centeredOnLocation = useRef(false);
  const labelledRailCodes = useRef(new Set<string>());
  const updateTransitStopsRef = useRef<() => void>(() => undefined);
  labelledRailCodes.current = new Set(
    (selected ?? plan?.recommended)?.segments
      .filter((segment) => segment.mode === "rail")
      .flatMap((segment) => [segment.stops[0], segment.stops.at(-1)])
      .filter((code): code is string => !!code) ?? [],
  );
  const [detailStop, setDetailStop] = useState<TransitStop | null>(null);
  const [busSelection, setBusSelection] = useState<{
    stop: TransitStop;
    service: string;
  } | null>(null);
  const [busMap, setBusMap] = useState<BusServiceMap | null>(null);
  const [busDirection, setBusDirection] = useState(0);
  const [busError, setBusError] = useState(false);
  useEffect(() => {
    setDetailStop(null);
    setBusSelection(null);
  }, [request.dataMode, request.timeline?.id]);
  useEffect(() => {
    setBusMap(null);
    setBusError(false);
    setBusDirection(0);
    if (!busSelection) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      service: busSelection.service,
      stop: busSelection.stop.codes[0],
    });
    fetch(`/api/bus-service?${query}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setBusMap(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBusError(true);
      });
    return () => controller.abort();
  }, [busSelection]);
  useEffect(() => {
    const m = map.current;
    const direction = busMap?.directions[busDirection];
    if (!m || !direction?.stops.length) return;
    const serviceStopPane = "bus-service-stop-pane";
    if (!m.getPane(serviceStopPane)) {
      // Keep the selected service's numbered stops readable above the normal
      // transit markers and their labels, while leaving popups on top.
      m.createPane(serviceStopPane).style.zIndex = "675";
    }
    const layer = L.layerGroup().addTo(m);
    // DataMall supplies an ordered stop sequence, not road geometry. Mark the
    // served stops with a deliberately thin dotted schematic connector, not a
    // depiction of the roads travelled.
    L.polyline(
      direction.stops.map((stop) => L.latLng(stop.lat, stop.lon)),
      {
        className: "bus-service-schematic",
        color: "#6852b8",
        weight: 2,
        opacity: 0.8,
        dashArray: "3 6",
        lineCap: "round",
        interactive: false,
      },
    ).addTo(layer);
    direction.stops.forEach((stop) => {
      const label = document.createElement("span");
      label.textContent = `${stop.sequence}. ${stop.name} (${stop.codes[0]})`;
      const number = document.createElement("span");
      number.textContent = String(stop.sequence);
      L.marker([stop.lat, stop.lon], {
        title: label.textContent,
        pane: serviceStopPane,
        zIndexOffset: 1_000,
        icon: L.divIcon({
          className: "bus-line-stop",
          html: number,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
      })
        .bindTooltip(label)
        .bindPopup(
          transitStopPopup(
            stop,
            () => setDetailStop(stop),
            (service) => setBusSelection({ stop, service }),
          ),
        )
        .addTo(layer);
    });
    m.closePopup();
    m.fitBounds(L.latLngBounds(direction.stops.map((s) => [s.lat, s.lon])), {
      paddingTopLeft: [35, 160],
      paddingBottomRight: [35, 240],
      maxZoom: 15,
    });
    return () => {
      layer.remove();
    };
  }, [busMap, busDirection]);
  const [mapError, setMapError] = useState(false);
  const [mapDetail, setMapDetail] = useState<
    "loading" | "detailed" | "offline"
  >("loading");
  useEffect(() => {
    if (!element.current) return;
    // Keep touch-first map gestures on phones, while allowing a desktop mouse
    // wheel to stand in for pinch zoom during desktop browser testing.
    const allowMouseWheelZoom = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    ).matches;
    const m = L.map(element.current, {
      zoomControl: false,
      attributionControl: true,
      // The bundled basemap keeps its explicit canvas renderer below; route
      // overlays use SVG so Leaflet cannot run a queued canvas redraw after
      // this tab unmounts on some mobile Chromium builds.
      preferCanvas: false,
      scrollWheelZoom: allowMouseWheelZoom,
      maxBounds: singaporeBounds,
      maxBoundsViscosity: 1,
      minZoom: 12,
      // Keep the map aligned with the highest detail supplied by OneMap and
      // avoid an empty, over-zoomed view when the bundled OSM fallback is on.
      maxZoom: 19,
    }).setView([1.325, 103.882], 12);
    map.current = m;
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution(
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    );
    const localPane = m.createPane("local-basemap");
    localPane.style.zIndex = "190";
    localPane.style.display = "none";
    element.current.setAttribute("data-map-source", "loading");
    let alive = true;
    let localBasemap: L.GeoJSON | null = null;
    let localBasemapLoading = false;
    let loadedTileCount = 0;
    let failedTileCount = 0;
    const stopRequest = new AbortController();
    const localRenderer = L.canvas({ pane: "local-basemap" });
    const loadLocalBasemap = () => {
      if (!alive) return;
      localPane.style.display = "block";
      setMapDetail("offline");
      element.current?.setAttribute("data-map-source", "bundled-osm");
      if (localBasemap) {
        if (!m.hasLayer(localBasemap)) localBasemap.addTo(m);
        element.current?.setAttribute("data-ready", "true");
        return;
      }
      if (localBasemapLoading) return;
      localBasemapLoading = true;
      basemapPromise ??= fetch("/data/basemap.json").then((response) => {
        if (!response.ok) throw new Error("Map unavailable");
        return response.json();
      });
      basemapPromise
        .then((data) => {
          if (!alive) return;
          localBasemap = L.geoJSON(data, {
            interactive: false,
            pane: "local-basemap",
            style: (feature) => {
              const kind = feature?.properties.kind;
              const style: L.PathOptions =
                kind === "water"
                  ? {
                      className: "local-map-feature local-map-water",
                      color: "#88b6bb",
                      weight: 1.2,
                      fillColor: "#b8d9d8",
                      fillOpacity: 0.95,
                    }
                  : kind === "park"
                    ? {
                        className: "local-map-feature local-map-park",
                        color: "#b9d1b2",
                        weight: 0.8,
                        fillColor: "#d2e4cc",
                        fillOpacity: 0.92,
                      }
                    : kind === "coast"
                      ? {
                          className: "local-map-feature local-map-coast",
                          color: "#719c96",
                          weight: 1.8,
                          opacity: 0.95,
                        }
                      : {
                          className: "local-map-feature local-map-road",
                          color: "#a5b1ab",
                          weight: 2.35,
                          opacity: 1,
                          lineCap: "round",
                          lineJoin: "round",
                        };
              return { ...style, renderer: localRenderer };
            },
          });
          if (
            element.current?.getAttribute("data-map-source") === "bundled-osm"
          )
            localBasemap.addTo(m);
          element.current?.setAttribute("data-ready", "true");
        })
        .catch(() => {
          if (alive && !loadedTileCount) setMapError(true);
        })
        .finally(() => {
          localBasemapLoading = false;
        });
    };
    const detailedTiles = L.tileLayer(oneMapTiles, {
      detectRetina: true,
      minZoom: 12,
      maxZoom: 19,
      maxNativeZoom: 19,
      bounds: singaporeBounds,
      className: "onemap-tiles",
      attribution: oneMapAttribution,
    }).addTo(m);
    detailedTiles.on("tileload", () => {
      loadedTileCount += 1;
      failedTileCount = 0;
      setMapError(false);
      setMapDetail("detailed");
      localPane.style.display = "none";
      if (localBasemap && m.hasLayer(localBasemap)) m.removeLayer(localBasemap);
      element.current?.setAttribute("data-map-source", "onemap");
      element.current?.setAttribute("data-ready", "true");
    });
    detailedTiles.on("tileerror", () => {
      failedTileCount += 1;
      if (failedTileCount >= 2) loadLocalBasemap();
    });
    window.addEventListener("offline", loadLocalBasemap);
    if (!navigator.onLine) loadLocalBasemap();
    const landmarks: [string, number, number][] = [
      ["Our Tampines Hub", 1.3529, 103.9405],
      ["Singapore Sports Hub", 1.3048, 103.8745],
      ["Marina Bay Sands", 1.2834, 103.8607],
      ["Jewel Changi Airport", 1.3602, 103.9898],
    ];
    landmarks.forEach(([name, lat, lng]) =>
      L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        zIndexOffset: 100,
        icon: L.divIcon({
          className: "map-landmark-anchor",
          html: labelledIcon("map-landmark", "landmark", name),
          iconSize: [150, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(m),
    );
    const transitLayer = L.layerGroup().addTo(m);
    let transitStops: TransitStop[] = [];
    const updateTransitStops = () => {
      if (!alive) return;
      if (routeOnly) {
        transitLayer.clearLayers();
        transitMarkers.current.clear();
        return;
      }
      const zoom = m.getZoom();
      const bounds = m.getBounds().pad(0.12);
      const showBusStops = zoom >= busStopsMinZoom;
      const candidates =
        zoom < 12
          ? []
          : transitStops
              .filter(
                (stop) =>
                  (stop.mode === "rail" || showBusStops) &&
                  bounds.contains([stop.lat, stop.lon]),
              )
              .sort(
                (a, b) =>
                  Number(a.mode === "bus") - Number(b.mode === "bus") ||
                  Number(
                    !a.codes.some((code) =>
                      affectedRailCodes.current.has(code),
                    ),
                  ) -
                    Number(
                      !b.codes.some((code) =>
                        affectedRailCodes.current.has(code),
                      ),
                    ) ||
                  m.distance(m.getCenter(), [a.lat, a.lon]) -
                    m.distance(m.getCenter(), [b.lat, b.lon]),
              );
      // Rail stations remain individually discoverable even when their icons
      // overlap at the current zoom level.
      const visibleStops = new Set(candidates.map((stop) => stop.id));
      for (const [id, marker] of transitMarkers.current)
        if (!visibleStops.has(id) && !marker.isPopupOpen()) {
          transitLayer.removeLayer(marker);
          transitMarkers.current.delete(id);
        }
      for (const stop of transitStops) {
        if (!visibleStops.has(stop.id)) continue;
        const affected =
          stop.mode === "rail" &&
          stop.codes.some((code) => affectedRailCodes.current.has(code));
        const showLabel =
          stop.mode === "rail" &&
          (zoom >= 14 ||
            affected ||
            stop.codes.some((code) => labelledRailCodes.current.has(code)));
        const existing = transitMarkers.current.get(stop.id);
        if (existing) {
          const existingElement = existing.getElement();
          existingElement?.classList.toggle("show-label", showLabel);
          existingElement?.classList.toggle("affected", affected);
          existingElement?.setAttribute(
            "aria-label",
            `${existingElement.dataset.transitLabel ?? "Rail station"}${affected ? ", affected by service disruption" : ""}`,
          );
          continue;
        }
        const kind = stop.mode === "rail" ? "MRT / LRT station" : "bus stop";
        const markerLabel = `${stop.name} ${kind}`;
        const marker = L.marker([stop.lat, stop.lon], {
          keyboard: true,
          title: `Open ${stop.name} ${kind} details`,
          alt: `${stop.name} ${kind}`,
          zIndexOffset: stop.mode === "rail" ? 220 : 180,
          icon: L.divIcon({
            className: `transit-stop-marker ${stop.mode}${showLabel ? " show-label" : ""}${affected ? " affected" : ""}`,
            html: transitStopIcon(stop),
            iconSize: [44, 44],
            iconAnchor: [22, 22],
            popupAnchor: [0, -19],
          }),
        })
          .bindPopup(
            transitStopPopup(
              stop,
              () => setDetailStop(stop),
              (service) => setBusSelection({ stop, service }),
            ),
            {
              maxWidth: 260,
              keepInView: true,
              autoPanPaddingTopLeft: [16, 72],
              autoPanPaddingBottomRight: [16, 100],
            },
          )
          .addTo(transitLayer);
        marker.on("popupclose", updateTransitStops);
        const markerElement = marker.getElement();
        markerElement?.setAttribute(
          "aria-label",
          `${markerLabel}${affected ? ", affected by service disruption" : ""}`,
        );
        if (markerElement) {
          markerElement.dataset.transitStopId = stop.id;
          markerElement.dataset.transitCodes = stop.codes.join(" ");
          markerElement.dataset.transitLabel = markerLabel;
        }
        transitMarkers.current.set(stop.id, marker);
      }
    };
    updateTransitStopsRef.current = updateTransitStops;
    m.on("moveend zoomend", updateTransitStops);
    fetch("/api/transit-stops", { signal: stopRequest.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Transit stops unavailable");
        return response.json() as Promise<TransitStop[]>;
      })
      .then((stops) => {
        if (!alive) return;
        const merged = new Map<string, TransitStop>();
        stops.forEach((stop) => {
          if (stop.mode !== "rail") {
            merged.set(stop.id, stop);
            return;
          }
          const key = `${stop.mode}:${stop.lat.toFixed(4)}:${stop.lon.toFixed(4)}`;
          const existing = merged.get(key);
          if (!existing) {
            merged.set(key, { ...stop, id: key, codes: [...stop.codes] });
            return;
          }
          merged.set(key, {
            ...existing,
            name: existing.name || stop.name,
            codes: Array.from(new Set([...existing.codes, ...stop.codes])),
          });
        });
        transitStops = Array.from(merged.values());
        updateTransitStops();
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      });
    routes.current = L.layerGroup().addTo(m);
    position.current = L.layerGroup().addTo(m);
    let resizeFrame: number | null = null;
    const resizeMap = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        m.invalidateSize({ pan: false, debounceMoveend: true });
      });
    };
    const observer = new ResizeObserver(() => {
      if (document.querySelector(".sheet-dragging")) return;
      resizeMap();
    });
    observer.observe(element.current);
    window.addEventListener("wayce:journey-sheet-resized", resizeMap);
    return () => {
      alive = false;
      stopRequest.abort();
      window.removeEventListener("offline", loadLocalBasemap);
      window.removeEventListener("wayce:journey-sheet-resized", resizeMap);
      m.off("moveend zoomend", updateTransitStops);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      updateTransitStopsRef.current = () => undefined;
      m.remove();
      map.current = null;
      transitMarkers.current.clear();
    };
  }, []);
  useEffect(() => {
    affectedRailCodes.current = new Set(
      plan?.conditions.notices
        .filter((notice) =>
          ["disruption", "planned", "lift", "bridging"].includes(notice.kind),
        )
        .flatMap((notice) => notice.stations) ?? [],
    );
    updateTransitStopsRef.current();
  }, [plan, selected]);
  useEffect(() => {
    const m = map.current,
      group = routes.current;
    if (!m || !group || !plan) return;
    const segmentToRestore = activeSegmentId.current;
    let restoredActiveSegment = false;
    group.clearLayers();
    segmentPaths.current.clear();
    activeSegmentId.current = segmentToRestore;
    const journey = selected ?? plan.recommended;
    const comparing =
      !navigationMode &&
      (showComparison || !focusSelectedRoute) &&
      journey.id !== plan.original.id;
    if (comparing) {
      plan.original.segments.forEach((segment) => {
        L.polyline(segment.geometry, {
          color: "#65736d",
          weight: 5,
          opacity: 0.68,
          dashArray: "8 10",
          lineCap: "butt",
          className: "route-original",
          interactive: false,
        })
          .bindTooltip("Original route", { sticky: true })
          .addTo(group);
      });
      let affectedLabelled = false;
      plan.original.segments.forEach((segment) => {
        const affectedGeometry = segment.affectedGeometry?.length
          ? segment.affectedGeometry
          : segment.affected
            ? [segment.geometry]
            : [];
        affectedGeometry.forEach((geometry) => {
          L.polyline(geometry, {
            color: "#b5483e",
            weight: 8,
            opacity: 0.92,
            dashArray: "2 8",
            lineCap: "round",
            className: "route-original-affected",
            interactive: false,
          })
            .bindTooltip("Affected part of original route", { sticky: true })
            .addTo(group);
          const midpoint = geometry[Math.floor(geometry.length / 2)];
          if (!affectedLabelled && midpoint) {
            affectedLabelled = true;
            L.marker(midpoint, {
              interactive: false,
              keyboard: false,
              zIndexOffset: 1050,
              icon: L.divIcon({
                className: "map-comparison-anchor",
                html: labelledIcon(
                  "map-comparison-marker",
                  "landmark",
                  "Affected original",
                ),
                iconSize: [124, 28],
                iconAnchor: [62, -10],
              }),
            }).addTo(group);
          }
        });
      });
    }
    const rainySegments = journey.segments.filter((segment) =>
      segment.issues?.includes("rain"),
    );
    // An interchange belongs to the junction between two rail legs. Build the
    // labels once here instead of adding one for each leg, which avoids two
    // overlapping badges for the same station.
    const interchangeLabels = new Map<
      string,
      { coord: [number, number]; codes: string[]; line: string }
    >();
    journey.segments.forEach((segment, index) => {
      const next = journey.segments[index + 1];
      if (segment.mode !== "rail" || next?.mode !== "rail") return;
      const terminal = segment.hops?.at(-1);
      const following = next.hops?.[0];
      // `hop.codes` includes codes from both ends of the hop. At a transfer it
      // would therefore pull in the next station as well. Only the previous
      // leg's end and following leg's start identify the interchange itself.
      const endpointCodes = [
        ...(terminal?.toCodes ?? []),
        ...(following?.fromCodes ?? []),
      ].filter((code) => routeStationCodePattern.test(code));
      const codes = Array.from(
        new Map(
          endpointCodes.map((code) => [stationColor(code), code]),
        ).values(),
      );
      if (codes.length < 2) return;
      const coord = segment.geometry.at(-1) ?? next.geometry[0];
      if (!coord) return;
      const key = `${coord[0].toFixed(5)}:${coord[1].toFixed(5)}:${codes.slice().sort().join("/")}`;
      interchangeLabels.set(key, { coord, codes, line: next.line });
    });
    if (plan.conditions.weather.rain) {
      const affected = rainySegments.length
        ? rainySegments
        : journey.segments
            .filter((segment) => segment.mode === "walk")
            .slice(0, 1);
      affected.forEach((segment) => {
        const midpoint =
          segment.geometry[Math.floor(segment.geometry.length / 2)];
        if (!midpoint) return;
        L.circle(midpoint, {
          radius: 850,
          color: "#147ead",
          weight: 3,
          opacity: 0.9,
          fillColor: "#42bce8",
          fillOpacity: 0.38,
          dashArray: "5 7",
          className: "rain-zone",
          interactive: false,
        }).addTo(group);
        L.marker(midpoint, {
          interactive: false,
          keyboard: false,
          zIndexOffset: 1200,
          icon: L.divIcon({
            className: "map-weather-anchor",
            html: labelledIcon("map-weather-marker", "rain", "Rain area"),
            iconSize: [94, 28],
            iconAnchor: [0, 45],
          }),
        }).addTo(group);
      });
    }
    const firstRailSegment = journey.segments.findIndex(
      (segment) => segment.mode === "rail",
    );
    const lastRailSegment = journey.segments.findLastIndex(
      (segment) => segment.mode === "rail",
    );
    journey.segments.forEach((s, segmentIndex) => {
      const focused = navigationMode && s.id === focusSegmentId;
      const issues = s.issues ?? [];
      const severe =
        issues.includes("flood") || issues.includes("road-closure");
      const colour = severe
        ? "#171a19"
        : issues.includes("accident") || issues.includes("disruption")
          ? "#c55c40"
          : issues.includes("congestion")
            ? "#d99216"
              : s.mode === "walk"
               ? "#7d8581"
               : s.mode === "bus"
                 ? "#8cc8a3"
                : s.mode === "cycle"
                  ? "#d06c18"
                  : (lineColors[s.line] ?? "#235ba8");
      const tooltip = document.createElement("span");
      tooltip.textContent = `${s.from} → ${s.to}`;
      L.polyline(s.geometry, {
        color: "#fff",
        weight: focused ? 17 : s.mode === "walk" ? 9 : 13,
        opacity: 0.9,
        interactive: false,
      }).addTo(group);
      const routeWeight = s.mode === "walk" ? 4 : s.mode === "rail" ? 9 : 8;
      const visibleClassName = `${
        comparing ? "route-selected route-revised" : "route-selected"
      } segment-${s.mode}${focused ? " navigation-active" : ""}`;
      const visiblePath = L.polyline(s.geometry, {
        color: colour,
        weight: focused ? routeWeight + 3 : routeWeight,
        opacity: navigationMode && focusSegmentId && !focused ? 0.42 : 1,
        className: visibleClassName,
        dashArray:
          s.mode === "walk"
            ? "3 9"
            : s.mode === "cycle"
              ? "4 5"
              : undefined,
        lineCap: "round",
        interactive: false,
      }).addTo(group);
      if (s.mode === "walk" && !routeOnly) {
        const sections = s.shelterSections?.length
          ? s.shelterSections
          : [
              {
                status: "unknown" as const,
                distance: s.distance,
                geometry: s.geometry,
              },
            ];
        const shelterStyles = {
          covered: { color: "#18775c", dashArray: undefined },
          exposed: { color: "#c33f2b", dashArray: "10 6" },
          unknown: { color: "#8a6f3f", dashArray: "2 7" },
        } as const;
        sections.forEach((section) => {
          const style = shelterStyles[section.status];
          L.polyline(section.geometry, {
            color: style.color,
            weight: focused ? routeWeight + 5 : routeWeight + 2,
            opacity: navigationMode && focusSegmentId && !focused ? 0.42 : 1,
            dashArray: style.dashArray,
            lineCap: "round",
            className: `walk-shelter-section ${section.status}`,
            interactive: false,
          })
            .bindTooltip(
              `${Math.round(section.distance)} m ${section.status === "covered" ? "mapped covered" : section.status}`,
              { sticky: true },
            )
            .addTo(group);
        });
      }
      const hitClassName = `route-segment-hit ${s.mode}`;
      const hitPath = L.polyline(s.geometry, {
        color: colour,
        weight: 24,
        opacity: 0.01,
        lineCap: "round",
        className: hitClassName,
      })
        .bindTooltip(tooltip, { sticky: true })
        .bindPopup(routeSegmentPopup(s), {
          className: "route-segment-detail-popover",
          maxWidth: 270,
          keepInView: true,
          autoPanPaddingTopLeft: [16, 72],
          autoPanPaddingBottomRight: [16, 120],
        })
        .addTo(group);
      segmentPaths.current.set(s.id, hitPath);
      const hitElement = hitPath.getElement() as SVGPathElement | null;
      if (hitElement) {
        const detailLabel =
          s.mode === "rail"
            ? `Train ${s.line}`
            : s.mode === "bus"
              ? `Bus ${s.line}`
              : modeNames[s.mode];
        hitElement.setAttribute("role", "button");
        hitElement.setAttribute("tabindex", "0");
        hitElement.setAttribute(
          "aria-label",
          `Open ${detailLabel} journey section details, ${s.from} to ${s.to}`,
        );
        hitElement.setAttribute("aria-expanded", "false");
        hitElement.setAttribute("data-segment-id", s.id);
        hitElement.addEventListener("keydown", (event) => {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ")
            return;
          keyboardEvent.preventDefault();
          const midpoint = s.geometry[Math.floor(s.geometry.length / 2)];
          hitPath.openPopup(midpoint);
        });
      }
      const showSelectedPath = () => {
        const currentPath = segmentPaths.current.get(s.id) ?? hitPath;
        activeSegmentId.current = s.id;
        activeSegmentPath.current = currentPath;
        currentPath.options.className = `${hitClassName} route-selected segment-active`;
        currentPath.setStyle({ weight: 10, opacity: 0.35 });
        const element = currentPath.getElement();
        element?.classList.add("route-selected", "segment-active");
        element?.setAttribute("aria-expanded", "true");
      };
      const clearSelectedPath = () => {
        hitPath.options.className = hitClassName;
        hitPath.setStyle({ weight: 24, opacity: 0.01 });
        const element = hitPath.getElement();
        element?.classList.remove("route-selected", "segment-active");
        element?.setAttribute("aria-expanded", "false");
        if (activeSegmentPath.current === hitPath) {
          activeSegmentId.current = null;
          activeSegmentPath.current = null;
        }
      };
      hitPath.on("click popupopen", showSelectedPath);
      hitPath.on("popupclose", clearSelectedPath);
      if (segmentToRestore === s.id) {
        restoredActiveSegment = true;
        const midpoint = s.geometry[Math.floor(s.geometry.length / 2)];
        showSelectedPath();
        hitPath.openPopup(midpoint);
      }
      if (s.mode === "rail" || s.mode === "bus") {
        const stopCoords = [
          s.geometry[0],
          ...(s.hops?.map((hop) => hop.geometry.at(-1)) ?? []),
          s.geometry.at(-1),
        ]
          .filter((coord): coord is [number, number] => !!coord)
          .filter(
            (coord, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate[0] === coord[0] && candidate[1] === coord[1],
              ) === index,
          );
        for (const coord of stopCoords)
          L.circleMarker(coord, {
            radius: 5.5,
            color: colour,
            weight: 3,
            fillColor: "#fff",
            fillOpacity: 1,
          }).addTo(group);

        if (navigationMode && s.mode === "bus") {
          const label = s.line.replace(/\s*(?:\/|,|\|)\s*/g, " \\ ");
          const midpoint = s.geometry[Math.floor(s.geometry.length / 2)];
          if (midpoint) {
            L.marker(midpoint, {
              interactive: false,
              keyboard: false,
              zIndexOffset: 1150,
              icon: L.divIcon({
                className: "route-transit-label-anchor",
                html: routeTransitLabel(label, "bus", colour),
                iconSize: [72, 26],
                iconAnchor: [36, 35],
              }),
            }).addTo(group);
          }
        }
        if (
          navigationMode &&
          s.mode === "rail" &&
          (segmentIndex === firstRailSegment || segmentIndex === lastRailSegment)
        ) {
          const terminalLabels = [
            ...(segmentIndex === firstRailSegment
              ? [
                  {
                    coord: s.geometry[0],
                    code:
                      routeStationCodes(s.hops?.[0]?.fromCodes) ||
                      (s.hops?.[0]?.codes ?? []).find((code) =>
                        routeStationCodePattern.test(code),
                      ),
                  },
                ]
              : []),
            ...(segmentIndex === lastRailSegment
              ? [
                  {
                    coord: s.geometry.at(-1),
                    code:
                      routeStationCodes(s.hops?.at(-1)?.toCodes) ||
                      [...(s.hops?.at(-1)?.codes ?? [])]
                        .reverse()
                        .find((code) => routeStationCodePattern.test(code)),
                  },
                ]
              : []),
          ];
          terminalLabels.forEach(({ coord, code }) => {
            if (!coord || !code) return;
            L.marker(coord, {
              interactive: false,
              keyboard: false,
              zIndexOffset: 1150,
              icon: L.divIcon({
                className: "route-transit-label-anchor",
                html: routeTransitLabel(code, "rail", colour),
                iconSize: [84, 26],
                iconAnchor: [42, 35],
              }),
            }).addTo(group);
          });
        }
      }
      const midpoint = s.geometry[Math.floor(s.geometry.length / 2)];
      if (midpoint && !routeOnly) {
        const label =
          s.mode === "rail" || s.mode === "bus" ? s.line : modeNames[s.mode];
        L.marker(midpoint, {
          interactive: false,
          keyboard: false,
          zIndexOffset: 1100,
          icon: L.divIcon({
            className: "route-mode-anchor",
            html: labelledIcon(`route-mode-marker ${s.mode}`, s.mode, label),
            iconSize: [88, 30],
            iconAnchor: [44, 40],
          }),
        }).addTo(group);
      }
      const issue = issues.find(
        (item) => item !== "shelter" && item !== "rain",
      );
      if (midpoint && issue)
        L.marker(midpoint, {
          interactive: false,
          keyboard: false,
          zIndexOffset: 900,
          icon: L.divIcon({
            className: `map-issue ${issue}`,
            html: severe ? "×" : "!",
            iconSize: [20, 20],
            iconAnchor: [10, -6],
          }),
        }).addTo(group);
    });
    interchangeLabels.forEach(({ coord, codes, line }) => {
      const label = codes.join("/");
      const width = Math.max(74, codes.length * 44);
      L.marker(coord, {
        interactive: false,
        keyboard: false,
        zIndexOffset: 1180,
        icon: L.divIcon({
          className: "route-interchange-label-anchor",
          html: routeTransitLabel(label, "rail", lineColors[line] ?? "#235ba8"),
          iconSize: [width, 28],
          iconAnchor: [width / 2, 36],
        }),
      })
        .bindTooltip(`${label} interchange`, { sticky: true })
        .addTo(group);
    });
    const longestExposedSection = routeOnly
      ? undefined
      : journey.segments
      .filter((segment) => segment.mode === "walk")
      .flatMap((segment) => segment.shelterSections ?? [])
      .filter((section) => section.status === "exposed")
      .sort((a, b) => b.distance - a.distance)[0];
    const exposedMidpoint =
      longestExposedSection?.geometry[
        Math.floor(longestExposedSection.geometry.length / 2)
      ];
    if (exposedMidpoint) {
      const label = document.createElement("span");
      label.className = "walk-shelter-label exposed";
      label.textContent = `Exposed · ${Math.round(longestExposedSection.distance)} m`;
      L.marker(exposedMidpoint, {
        interactive: false,
        keyboard: false,
        zIndexOffset: 1250,
        icon: L.divIcon({
          className: "walk-shelter-anchor",
          html: label,
          iconSize: [92, 24],
          iconAnchor: [46, 30],
        }),
      }).addTo(group);
    }
    if (segmentToRestore && !restoredActiveSegment) {
      activeSegmentId.current = null;
      activeSegmentPath.current = null;
    }
    const focusedSegment = journey.segments.find(
      (segment) => segment.id === focusSegmentId,
    );
    const points =
      navigationMode && focusedSegment?.geometry.length
        ? focusedSegment.geometry
        : [
            ...journey.segments.flatMap((s) => s.geometry),
            ...(comparing
              ? plan.original.segments.flatMap((s) => s.geometry)
              : []),
          ];
    if (points.length) {
      const marker = (
        coord: [number, number],
        label: string,
        name: string,
        kind: string,
      ) =>
        L.marker(coord, {
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000,
          icon: L.divIcon({
            className: "map-pin-anchor",
            html: labelledIcon(`map-pin ${kind}`, "landmark", label),
            iconSize: [48, 34],
            iconAnchor: [18, 34],
          }),
        })
          .bindTooltip(name, { direction: "top", offset: [0, -28] })
          .addTo(group);
      marker(
        [plan.request.origin.lat, plan.request.origin.lon],
        "A",
        plan.request.origin.name,
        "origin",
      );
      marker(
        [plan.request.destination.lat, plan.request.destination.lon],
        "B",
        plan.request.destination.name,
        "destination",
      );
      m.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [58, 84],
        paddingBottomRight: [58, navigationMode ? 300 : 110],
        maxZoom: 15,
        animate: false,
      });
    }
  }, [
    focusSegmentId,
    focusSelectedRoute,
    navigationMode,
    plan,
    routeOnly,
    selected,
  ]);
  useEffect(() => {
    const m = map.current;
    const group = position.current;
    if (!m || !group) return;
    group.clearLayers();
    if (!location) {
      centeredOnLocation.current = false;
      return;
    }
    const coord: [number, number] = [location.lat, location.lon];
    if (!centeredOnLocation.current) {
      centerMapOnLocation(m, coord);
      centeredOnLocation.current = true;
    }
    if (location.source === "device" && location.accuracy > 0)
      L.circle(coord, {
        radius: location.accuracy,
        color: "#2479a9",
        fillColor: "#77bce0",
        fillOpacity: 0.12,
        weight: 1,
        interactive: false,
      }).addTo(group);
    L.marker(coord, {
      keyboard: false,
      icon: L.divIcon({
        className: `current-location-marker ${location.source}`,
        html: "<span></span>",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    })
      .bindTooltip(
        location.source === "demo"
          ? "Simulated demo location"
          : `Live device location · about ${Math.round(location.accuracy)} m accuracy`,
      )
      .addTo(group);
  }, [location]);
  const goToLocation = () => {
    if (location && map.current) {
      centerMapOnLocation(map.current, [location.lat, location.lon]);
    }
  };
  const journey = selected ?? plan?.recommended;
  const comparing =
    !navigationMode &&
    (showComparison || !focusSelectedRoute) &&
    !!plan &&
    !!journey &&
    journey.id !== plan.original.id;
  const shelterStatuses = new Set(
    journey?.segments
      .filter((segment) => segment.mode === "walk")
      .flatMap((segment) =>
        segment.shelterSections?.length
          ? segment.shelterSections.map((section) => section.status)
          : ["unknown" as const],
      ) ?? [],
  );
  const showFullRoute = () => {
    const points = [
      ...(journey?.segments.flatMap((segment) => segment.geometry) ?? []),
      ...(comparing
        ? plan.original.segments.flatMap((segment) => segment.geometry)
        : []),
    ];
    if (!points.length || !map.current) return;

    const mapRect = map.current.getContainer().getBoundingClientRect();
    const container = map.current.getContainer();
    const sheet =
      container
        .closest(".journey-navigation-stage")
        ?.querySelector<HTMLElement>(".active-journey-sheet") ??
      container
        .closest(".journey-layout")
        ?.querySelector<HTMLElement>(".journey-sheet");
    const sheetRect = sheet?.getBoundingClientRect();
    const coveredHeight = sheetRect
      ? Math.max(
          0,
          Math.min(mapRect.bottom, sheetRect.bottom) -
            Math.max(mapRect.top, sheetRect.top),
        )
      : 0;
    map.current.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [55, 70],
      paddingBottomRight: [55, Math.round(coveredHeight) + 32],
      maxZoom: 15,
    });
  };
  const visibleModes = (["walk", "bus", "rail", "cycle"] as Mode[]).filter(
    (mode) => journey?.segments.some((segment) => segment.mode === mode),
  );
  return (
    <div className="map-wrap">
      {detailStop && (
        <StopDetails
          key={`${request.dataMode}:${detailStop.id}`}
          stop={detailStop}
          demo={request.dataMode === "demo"}
          at={request.departure}
          conditions={plan?.conditions}
          onClose={() => setDetailStop(null)}
        />
      )}
      {busSelection && (
        <section className="bus-map-panel" aria-label="Bus service map">
          <div>
            <strong>Bus {busSelection.service}</strong>
            <button
              className="text-button"
              onClick={() => setBusSelection(null)}
            >
              Clear bus stops
            </button>
          </div>
          <small>Stops served · road geometry unavailable</small>
          {busMap?.directions.length ? (
            <label>
              Direction
              <select
                value={busDirection}
                onChange={(e) => setBusDirection(Number(e.target.value))}
              >
                {busMap.directions.map((d, i) => (
                  <option key={d.direction} value={i}>
                    {d.direction} · {d.stops[0]?.name} → {d.stops.at(-1)?.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p role="status">
              {busError || busMap
                ? "Service map unavailable."
                : "Loading stops…"}
            </p>
          )}
        </section>
      )}
      <div
        ref={element}
        className="journey-map"
        role="region"
        aria-label={`${mapDetail === "detailed" ? "OneMap" : "Bundled OpenStreetMap"} showing ${navigationMode ? "your active navigation route" : comparing ? "the original route, its affected portion and the revised route" : "your selected route and walking legs"}${!routeOnly && shelterStatuses.size ? ", with covered, exposed and unknown shelter sections distinguished" : ""}${location ? `, plus your ${location.source === "demo" ? "simulated" : "device"} location` : ""}`}
      />
      <div className="map-controls">
        {!navigationMode && (
          <button
            className="icon-button"
            onClick={onViewAlerts}
            aria-label="View disruption alerts"
          >
            <Bell size={21} />
            {hasAlerts && <i className="notification-dot" />}
          </button>
        )}
        <button
          className="icon-button"
          onClick={goToLocation}
          aria-label="Go to location"
          disabled={!location}
        >
          <LocateFixed size={19} />
        </button>
        <button
          className="icon-button"
          onClick={showFullRoute}
          aria-label="Show full route"
          disabled={!journey}
        >
          <Route size={19} />
        </button>
      </div>
      {comparing && (
        <div className="map-legend">
          <span>
            <i className="legend-line dashed" /> Original route
          </span>
          <span>
            <i className="legend-line affected" /> Affected original
          </span>
          <span>
            <i className="legend-line" /> Revised route
          </span>
        </div>
      )}
      {!routeOnly && shelterStatuses.size > 0 && (
        <div
          className={`shelter-map-legend${comparing ? " with-comparison" : ""}`}
          aria-label="Walking shelter map legend"
        >
          {shelterStatuses.has("covered") && (
            <span>
              <i className="shelter-legend-line covered" /> Covered
            </span>
          )}
          {shelterStatuses.has("exposed") && (
            <span>
              <i className="shelter-legend-line exposed" /> Exposed
            </span>
          )}
          {shelterStatuses.has("unknown") && (
            <span>
              <i className="shelter-legend-line unknown" /> Unknown
            </span>
          )}
        </div>
      )}
      <span className="map-extract">
        <Layers size={12} />
        {mapDetail === "detailed"
          ? "OneMap · online"
          : mapDetail === "offline"
            ? "Bundled OSM · offline fallback"
            : "Loading detailed map…"}
      </span>
      <div className="map-mode-key" aria-label="Map route legend">
        {visibleModes.map((mode) => (
          <span className={`map-key-item ${mode}`} key={mode}>
            <span
              className="map-key-icon"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: mapIcons[mode] }}
            />
            {modeNames[mode]}
          </span>
        ))}
        {plan?.conditions.weather.rain && (
          <span className="map-key-item rain">
            <span
              className="map-key-icon"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: mapIcons.rain }}
            />
            Rain area
          </span>
        )}
      </div>
      {mapError && (
        <div className="map-error">
          Map extract unavailable. Your journey steps are still below.
        </div>
      )}
    </div>
  );
}
