import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Layers, LocateFixed } from "lucide-react";
import type { Journey, PlanResponse } from "../shared/types";
import type { Mode } from "../shared/types";
import { lineColors } from "../shared/catalog";
import type { LocationFix } from "./location";

let basemapPromise: Promise<any> | undefined;

const singaporeBounds = L.latLngBounds([1.144, 103.535], [1.494, 104.502]);
const oneMapTiles =
  "https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png";
const oneMapAttribution =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:16px;width:16px;vertical-align:text-bottom" />&nbsp;<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;|&nbsp;<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';

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

export default function JourneyMap({
  plan,
  selected,
  location,
}: {
  plan: PlanResponse | null;
  selected: Journey | null;
  location: LocationFix | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routes = useRef<L.LayerGroup | null>(null);
  const position = useRef<L.LayerGroup | null>(null);
  const centeredOnLocation = useRef(false);
  const [mapError, setMapError] = useState(false);
  const [mapDetail, setMapDetail] = useState<
    "loading" | "detailed" | "offline"
  >("loading");
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      zoomControl: false,
      attributionControl: true,
      // The bundled basemap keeps its explicit canvas renderer below; route
      // overlays use SVG so Leaflet cannot run a queued canvas redraw after
      // this tab unmounts on some mobile Chromium builds.
      preferCanvas: false,
      scrollWheelZoom: false,
      maxBounds: singaporeBounds,
      maxBoundsViscosity: 0.85,
      minZoom: 11,
    }).setView([1.325, 103.882], 12);
    map.current = m;
    L.control.zoom({ position: "bottomright" }).addTo(m);
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
      minZoom: 11,
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
      if (localBasemap && m.hasLayer(localBasemap))
        m.removeLayer(localBasemap);
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
    routes.current = L.layerGroup().addTo(m);
    position.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current);
    return () => {
      alive = false;
      window.removeEventListener("offline", loadLocalBasemap);
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current,
      group = routes.current;
    if (!m || !group || !plan) return;
    group.clearLayers();
    const journey = selected ?? plan.recommended;
    const comparing = journey.id !== plan.original.id;
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
        weight: s.mode === "walk" ? 8 : 11,
        opacity: 0.9,
        interactive: false,
      }).addTo(group);
      L.polyline(s.geometry, {
        color: colour,
        weight: s.mode === "walk" ? 4 : s.mode === "rail" ? 7 : 6,
        opacity: 1,
        className: comparing
          ? "route-selected route-revised"
          : "route-selected",
        dashArray:
          s.mode === "walk"
            ? "2 8"
            : s.mode === "bus"
              ? "12 7"
              : s.mode === "cycle"
                ? "4 5"
                : undefined,
        lineCap: "round",
      })
        .bindTooltip(tooltip, { sticky: true })
        .addTo(group);
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
    const points = [
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
        paddingBottomRight: [58, 110],
        maxZoom: 15,
        animate: false,
      });
    }
  }, [plan, selected]);
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
      m.setView(coord, 15, { animate: false });
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
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    })
      .bindTooltip(
        location.source === "demo"
          ? "Simulated demo location"
          : `Live device location · about ${Math.round(location.accuracy)} m accuracy`,
      )
      .addTo(group);
  }, [location]);
  const recenter = () => {
    const points =
      (selected ?? plan?.recommended)?.segments.flatMap((s) => s.geometry) ??
      [];
    if (location) points.push([location.lat, location.lon]);
    if (points?.length)
      map.current?.fitBounds(L.latLngBounds(points), {
        padding: [55, 70],
        maxZoom: 15,
      });
  };
  const journey = selected ?? plan?.recommended;
  const comparing = !!plan && !!journey && journey.id !== plan.original.id;
  const visibleModes = (["walk", "bus", "rail", "cycle"] as Mode[]).filter(
    (mode) => journey?.segments.some((segment) => segment.mode === mode),
  );
  return (
    <div className="map-wrap">
      <div
        ref={element}
        className="journey-map"
        role="region"
        aria-label={`${mapDetail === "detailed" ? "OneMap" : "Bundled OpenStreetMap"} showing ${comparing ? "the original route, its affected portion and the revised route" : "your selected route and walking legs"}${location ? `, plus your ${location.source === "demo" ? "simulated" : "device"} location` : ""}`}
      />
      <div className="map-top">
        <button
          className="icon-button"
          onClick={recenter}
          aria-label="Recenter route"
        >
          <LocateFixed size={19} />
        </button>
      </div>
      <div className="map-legend">
        {comparing ? (
          <>
            <span>
              <i className="legend-line dashed" /> Original route
            </span>
            <span>
              <i className="legend-line affected" /> Affected original
            </span>
            <span>
              <i className="legend-line" /> Revised route
            </span>
          </>
        ) : (
          <span>
            <i className="legend-line" /> Selected route
          </span>
        )}
        {location && (
          <span>
            <i className={`legend-location ${location.source}`} />
            {location.source === "demo" ? "Simulated" : "You"}
          </span>
        )}
      </div>
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
