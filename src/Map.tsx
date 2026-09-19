import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Bell, Layers, LocateFixed, Route } from "lucide-react";
import type {
  Journey,
  Mode,
  PlanResponse,
  Segment,
  TransitStop,
} from "../shared/types";
import { lineColors } from "../shared/catalog";
import { crowdDescription } from "../shared/crowding";
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
const busStopsMinZoom = 17;

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

function transitStopIcon(mode: TransitStop["mode"]) {
  const root = document.createElement("span");
  root.className = "transit-stop-symbol";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = mapIcons[mode];
  return root;
}

function transitStopPopup(stop: TransitStop) {
  const root = document.createElement("section");
  root.className = "transit-stop-popup";
  const heading = document.createElement("strong");
  heading.textContent = stop.name;
  const kind = document.createElement("span");
  kind.textContent = stop.mode === "rail" ? "MRT / LRT station" : "Bus stop";
  root.append(heading, kind);
  if (stop.codes.length) {
    const codes = document.createElement("small");
    codes.textContent = `${stop.mode === "rail" ? "Station" : "Stop"} ${stop.codes.join(" · ")}`;
    root.append(codes);
  }
  if (stop.lines.length) {
    const lines = document.createElement("small");
    lines.textContent = `${stop.mode === "rail" ? "Lines" : "Mapped services"} ${stop.lines.join(" · ")}`;
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
      addDetail("Map", "Schematic stop-to-stop line · not the roads travelled");
    if (segment.direction) addDetail("Towards", segment.direction);
    if (segment.waitMinutes !== undefined)
      addDetail("Wait", `${Math.ceil(segment.waitMinutes)} min`);
    addDetail("Crowding", crowdDescription(segment));
  } else {
    addDetail("Distance", `${Math.round(segment.distance)} m`);
    if (segment.sheltered) addDetail("Shelter", "Mapped sheltered path");
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
  navigationMode = false,
  focusSegmentId,
}: {
  plan: PlanResponse | null;
  selected: Journey | null;
  location: LocationFix | null;
  onViewAlerts: () => void;
  hasAlerts: boolean;
  navigationMode?: boolean;
  focusSegmentId?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routes = useRef<L.LayerGroup | null>(null);
  const position = useRef<L.LayerGroup | null>(null);
  const activeSegmentId = useRef<string | null>(null);
  const activeSegmentPath = useRef<L.Polyline | null>(null);
  const segmentPaths = useRef(new Map<string, L.Polyline>());
  const centeredOnLocation = useRef(false);
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
    const transitMarkers = new Map<string, L.Marker>();
    const updateTransitStops = () => {
      if (!alive) return;
      const zoom = m.getZoom();
      const bounds = m.getBounds().pad(0.12);
      const showBusStops = zoom >= busStopsMinZoom;
      const visibleLimit = zoom <= 12 ? 60 : Number.POSITIVE_INFINITY;
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
                  m.distance(m.getCenter(), [a.lat, a.lon]) -
                    m.distance(m.getCenter(), [b.lat, b.lon]),
              );
      const markerSpacing = m.distance(
        m.containerPointToLatLng([0, 0]),
        m.containerPointToLatLng([42, 0]),
      );
      const selectedRailStops: TransitStop[] = [];
      for (const stop of candidates) {
        if (stop.mode === "bus") continue;
        if (
          selectedRailStops.some(
            (selectedStop) =>
              m.distance(
                [stop.lat, stop.lon],
                [selectedStop.lat, selectedStop.lon],
              ) < markerSpacing,
          )
        )
          continue;
        selectedRailStops.push(stop);
        if (selectedRailStops.length >= visibleLimit) break;
      }
      const selectedStops = [
        ...selectedRailStops,
        ...candidates.filter((stop) => stop.mode === "bus"),
      ];
      const visibleStops = new Set(selectedStops.map((stop) => stop.id));
      for (const [id, marker] of transitMarkers)
        if (!visibleStops.has(id) && !marker.isPopupOpen()) {
          transitLayer.removeLayer(marker);
          transitMarkers.delete(id);
        }
      for (const stop of transitStops) {
        if (!visibleStops.has(stop.id) || transitMarkers.has(stop.id)) continue;
        const kind = stop.mode === "rail" ? "MRT / LRT station" : "bus stop";
        const marker = L.marker([stop.lat, stop.lon], {
          keyboard: true,
          title: `Open ${stop.name} ${kind} details`,
          alt: `${stop.name} ${kind}`,
          zIndexOffset: stop.mode === "rail" ? 220 : 180,
          icon: L.divIcon({
            className: `transit-stop-marker ${stop.mode}`,
            html: transitStopIcon(stop.mode),
            iconSize: [44, 44],
            iconAnchor: [22, 22],
            popupAnchor: [0, -19],
          }),
        })
          .bindPopup(transitStopPopup(stop), { maxWidth: 230 })
          .addTo(transitLayer);
        marker.on("popupclose", updateTransitStops);
        const markerElement = marker.getElement();
        markerElement?.setAttribute("aria-label", `${stop.name} ${kind}`);
        if (markerElement) markerElement.dataset.transitStopId = stop.id;
        transitMarkers.set(stop.id, marker);
      }
    };
    m.on("moveend zoomend", updateTransitStops);
    fetch("/api/transit-stops", { signal: stopRequest.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Transit stops unavailable");
        return response.json() as Promise<TransitStop[]>;
      })
      .then((stops) => {
        if (!alive) return;
        transitStops = stops;
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
      m.remove();
      map.current = null;
    };
  }, []);
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
    const comparing = !navigationMode && journey.id !== plan.original.id;
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
    journey.segments.forEach((s) => {
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
              ? "#4c5968"
              : s.mode === "bus"
                ? "#7b3fc6"
                : s.mode === "cycle"
                  ? "#d06c18"
                  : (lineColors[s.line] ?? "#235ba8");
      const tooltip = document.createElement("span");
      tooltip.textContent = `${s.from} → ${s.to}`;
      L.polyline(s.geometry, {
        color: "#fff",
        weight: focused ? 15 : s.mode === "walk" ? 8 : 11,
        opacity: 0.9,
        interactive: false,
      }).addTo(group);
      const routeWeight = s.mode === "walk" ? 4 : s.mode === "rail" ? 7 : 6;
      const visibleClassName = `${
        comparing ? "route-selected route-revised" : "route-selected"
      } segment-${s.mode}${focused ? " navigation-active" : ""}`;
      const visiblePath = L.polyline(s.geometry, {
        color: colour,
        weight: focused ? routeWeight + 3 : routeWeight,
        opacity: navigationMode && focusSegmentId && !focused ? 0.42 : 1,
        className: visibleClassName,
        dashArray:
          s.geometryKind === "schematic"
            ? "3 9"
            : s.mode === "walk"
              ? "2 8"
              : s.mode === "bus"
                ? "12 7"
                : s.mode === "cycle"
                  ? "4 5"
                  : undefined,
        lineCap: "round",
        interactive: false,
      }).addTo(group);
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
        for (const coord of [s.geometry[0], s.geometry.at(-1)!])
          L.circleMarker(coord, {
            radius: 5,
            color: lineColors[s.line] ?? "#184e40",
            weight: 3,
            fillColor: "#fff",
            fillOpacity: 1,
          }).addTo(group);
      }
      const midpoint = s.geometry[Math.floor(s.geometry.length / 2)];
      if (midpoint) {
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
  }, [focusSegmentId, navigationMode, plan, selected]);
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
    !navigationMode && !!plan && !!journey && journey.id !== plan.original.id;
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
      <div
        ref={element}
        className="journey-map"
        role="region"
        aria-label={`${mapDetail === "detailed" ? "OneMap" : "Bundled OpenStreetMap"} showing ${navigationMode ? "your active navigation route" : comparing ? "the original route, its affected portion and the revised route" : "your selected route and walking legs"}${location ? `, plus your ${location.source === "demo" ? "simulated" : "device"} location` : ""}`}
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
