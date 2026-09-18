import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed, Layers, Navigation } from "lucide-react";
import type { Journey, PlanResponse } from "../shared/types";
import { lineColors } from "../shared/catalog";

let basemapPromise: Promise<any> | undefined;
export default function JourneyMap({
  plan,
  selected,
}: {
  plan: PlanResponse | null;
  selected: Journey | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routes = useRef<L.LayerGroup | null>(null);
  const [showOriginal, setShowOriginal] = useState(true);
  const [mapError, setMapError] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      scrollWheelZoom: false,
    }).setView([1.325, 103.882], 12);
    map.current = m;
    L.control.zoom({ position: "bottomright" }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution(
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    );
    m.createPane("basemap");
    m.getPane("basemap")!.style.zIndex = "210";
    const renderer = L.canvas({ pane: "basemap" });
    let alive = true;
    basemapPromise ??= fetch("/data/basemap.json").then((r) => {
      if (!r.ok) throw new Error("Map unavailable");
      return r.json();
    });
    basemapPromise
      .then((data) => {
        if (!alive) return;
        L.geoJSON(data, {
          interactive: false,
          pane: "basemap",
          style: (feature) => {
            const kind = feature?.properties.kind;
            const style: L.PathOptions =
              kind === "water"
                ? {
                    color: "#b8d7d3",
                    weight: 1,
                    fillColor: "#b8d7d3",
                    fillOpacity: 0.9,
                  }
                : kind === "park"
                  ? {
                      color: "#dce7d6",
                      weight: 0,
                      fillColor: "#dce7d6",
                      fillOpacity: 0.8,
                    }
                  : kind === "coast"
                    ? { color: "#9ebfb7", weight: 1.5 }
                    : { color: "#ffffff", weight: 2.5, opacity: 0.95 };
            return { ...style, renderer };
          },
        }).addTo(m);
        element.current?.setAttribute("data-ready", "true");
      })
      .catch(() => {
        if (alive) setMapError(true);
      });
    const labels: [string, number, number][] = [
      ["TAMPINES", 1.359, 103.946],
      ["BEDOK", 1.329, 103.927],
      ["PAYA LEBAR", 1.322, 103.893],
      ["GEYLANG", 1.311, 103.882],
      ["KALLANG", 1.313, 103.864],
      ["DOWNTOWN", 1.282, 103.854],
      ["BISHAN", 1.354, 103.844],
      ["PUNGGOL", 1.403, 103.909],
      ["QUEENSTOWN", 1.296, 103.799],
      ["MARINE PARADE", 1.304, 103.91],
      ["SINGAPORE", 1.347, 103.865],
    ];
    labels.forEach(([name, lat, lng]) =>
      L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "map-place",
          html: name,
          iconSize: [120, 20],
        }),
      }).addTo(m),
    );
    routes.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current);
    return () => {
      alive = false;
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
    if (showOriginal && plan.original.id !== journey.id)
      plan.original.segments.forEach((s) => {
        L.polyline(s.geometry, {
          color: "#89958e",
          weight: 4,
          opacity: 0.7,
          dashArray: "8 7",
          interactive: false,
        }).addTo(group);
        for (const geometry of s.affectedGeometry ?? [])
          L.polyline(geometry, {
            color: "#c55c40",
            weight: 6,
            opacity: 0.85,
            dashArray: "8 7",
            interactive: false,
          }).addTo(group);
      });
    journey.segments.forEach((s) => {
      const tooltip = document.createElement("span");
      tooltip.textContent = `${s.line.toUpperCase()}: ${s.from} → ${s.to}${s.affected ? " · affected" : ""}`;
      L.polyline(s.geometry, {
        color: "#fff",
        weight: s.mode === "walk" ? 6 : 9,
        opacity: 0.95,
        interactive: false,
      }).addTo(group);
      L.polyline(s.geometry, {
        color: s.affected
          ? "#c55c40"
          : (lineColors[s.line] ?? lineColors[s.mode]),
        weight: s.mode === "walk" ? 3 : 5,
        opacity: 1,
        dashArray: s.mode === "walk" ? "3 7" : undefined,
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
    });
    const points = journey.segments.flatMap((s) => s.geometry);
    if (points.length) {
      const marker = (coord: [number, number], label: string, kind: string) =>
        L.marker(coord, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: `map-pin ${kind}`,
            html: `<span>${label}</span>`,
            iconSize: [34, 42],
            iconAnchor: [17, 40],
          }),
        }).addTo(group);
      marker([plan.request.origin.lat, plan.request.origin.lon], "A", "origin");
      marker(
        [plan.request.destination.lat, plan.request.destination.lon],
        "B",
        "destination",
      );
      m.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [55, 70],
        paddingBottomRight: [55, 85],
        maxZoom: 15,
        animate: false,
      });
    }
  }, [plan, selected, showOriginal]);
  const recenter = () => {
    const points = (selected ?? plan?.recommended)?.segments.flatMap(
      (s) => s.geometry,
    );
    if (points?.length)
      map.current?.fitBounds(L.latLngBounds(points), {
        padding: [55, 70],
        maxZoom: 15,
      });
  };
  return (
    <div className="map-wrap">
      <div
        ref={element}
        className="journey-map"
        role="region"
        aria-label="OpenStreetMap showing your selected route, walking legs and affected portions of the original route"
      />
      <div className="map-top">
        <span className="map-label">
          <Navigation size={14} /> Your journey, in perspective
        </span>
        <button
          className="icon-button"
          onClick={recenter}
          aria-label="Recenter route"
        >
          <LocateFixed size={19} />
        </button>
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-line" /> Selected route
        </span>
        <button
          className={showOriginal ? "legend-toggle active" : "legend-toggle"}
          onClick={() => setShowOriginal(!showOriginal)}
          aria-pressed={showOriginal}
        >
          <i className="legend-line dashed" /> Original route
        </button>
        <span>
          <i className="legend-line affected" /> Affected
        </span>
      </div>
      <span className="map-extract">
        <Layers size={12} /> Offline OSM map
      </span>
      {mapError && (
        <div className="map-error">
          Map extract unavailable. Your journey steps are still below.
        </div>
      )}
    </div>
  );
}
