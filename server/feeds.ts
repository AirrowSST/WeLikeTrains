import type {
  BusArrival,
  Conditions,
  CrowdReading,
  FeedStatus,
  Notice,
  PlanRequest,
  Scenario,
  TrafficReading,
} from "../shared/types";
import { canonicalLine, crowdValue } from "../shared/catalog";

type Obj = Record<string, any>;
const cache = new Map<string, { value: unknown; at: number }>();
const pending = new Map<string, Promise<{ value: unknown; at: number }>>();
export async function cachedFetch(
  key: string,
  url: string,
  ttl: number,
  headers: Record<string, string> = {},
): Promise<{ value: any; at: number; stale: boolean }> {
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < ttl)
    return { ...previous, stale: false };
  let task = pending.get(key);
  if (!task) {
    task = (async () => {
      const r = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
      const entry = { value: await r.json(), at: Date.now() };
      cache.set(key, entry);
      return entry;
    })();
    pending.set(key, task);
  }
  try {
    return { ...(await task), stale: false };
  } catch (e) {
    if (previous && Date.now() - previous.at < 3600000)
      return { ...previous, stale: true };
    throw e;
  } finally {
    pending.delete(key);
  }
}
const toList = (v: any): Obj[] => (Array.isArray(v) ? v : v ? [v] : []);
export function parseTrainAlerts(
  raw: Obj,
  now = new Date().toISOString(),
): Notice[] {
  const root = Array.isArray(raw.value)
    ? (raw.value[0] ?? {})
    : (raw.value ?? raw);
  const messages = toList(root.Message);
  const notices = toList(root.AffectedSegments).map((s, i): Notice => ({
    id: `lta-train-${i}`,
    title: `${canonicalLine(s.Line ?? "")} service disruption`,
    description:
      messages
        .map((m) => m.Content)
        .filter(Boolean)
        .join("\n") ||
      "Official service disruption. Follow station staff instructions.",
    line: canonicalLine(s.Line ?? ""),
    stations: String(s.Stations ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    severity: String(root.Status) === "2" ? "critical" : "warning",
    kind: "disruption",
    startsAt: messages[0]?.CreatedDate
      ? new Date(messages[0].CreatedDate).toISOString()
      : now,
    delayMinutes: 15,
    freeBus: s.FreePublicBus || undefined,
    shuttle: s.FreeMRTShuttle || undefined,
    direction: s.Direction,
    source: "LTA TrainServiceAlerts; delay allowance is an app estimate",
  }));
  if (!notices.length)
    for (const [i, m] of messages.entries())
      if (m.Content)
        notices.push({
          id: `lta-advisory-${i}`,
          title: "Official service advisory",
          description: m.Content,
          stations: [],
          severity: "info",
          kind: "advisory",
          startsAt: m.CreatedDate || now,
          delayMinutes: 0,
          source: "LTA TrainServiceAlerts",
        });
  return notices;
}
export function parseCrowds(
  raw: Obj,
  line: string,
  forecast = false,
): CrowdReading[] {
  const result: CrowdReading[] = [];
  function visit(v: any, station?: string, date?: string) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((x) => visit(x, station, date));
      return;
    }
    const name = v.Station ?? station;
    const day = v.Date ?? date;
    if (name && v.CrowdLevel !== undefined) {
      const timestamp = (s: any) =>
        s
          ? /^\d{2}:/.test(String(s)) && day
            ? `${String(day).slice(0, 10)}T${s}+08:00`
            : String(s)
          : "";
      const start = timestamp(v.StartTime ?? v.Time);
      result.push({
        station: name,
        line: canonicalLine(line),
        level: crowdValue(v.CrowdLevel),
        start,
        end:
          timestamp(v.EndTime) ||
          (start
            ? new Date(new Date(start).getTime() + 1800000).toISOString()
            : ""),
        forecast,
      });
    }
    for (const [key, item] of Object.entries(v))
      if (item && typeof item === "object") visit(item, name, day);
  }
  visit(raw);
  return result;
}
export function parseBuses(raw: Obj, stop: string): BusArrival[] {
  return toList(raw.Services).flatMap((s) =>
    ["NextBus", "NextBus2", "NextBus3"].flatMap((key) =>
      s[key]?.EstimatedArrival
        ? [
            {
              service: String(s.ServiceNo),
              stop,
              eta: s[key].EstimatedArrival,
              load: crowdValue(s[key].Load),
              wheelchair: s[key].Feature === "WAB",
              type: s[key].Type ?? "",
            },
          ]
        : [],
    ),
  );
}
const numberAt = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const locationOf = (row: Obj): [number, number] | undefined => {
  const lat = numberAt(row.Latitude ?? row.latitude ?? row.Lat ?? row.lat);
  const lon = numberAt(
    row.Longitude ?? row.longitude ?? row.Long ?? row.lon ?? row.Lng,
  );
  return lat !== undefined && lon !== undefined ? [lat, lon] : undefined;
};
const roadNameOf = (row: Obj) =>
  String(row.RoadName ?? row.Road ?? row.Name ?? row.Expressway ?? "").trim();
export function parseTraffic(raw: Obj): TrafficReading[] {
  const rows = toList(raw.value ?? raw);
  return rows.slice(0, 120).map((row, index) => {
    const text = String(
      row.Message ??
        row.Description ??
        row.Incident ??
        row.Type ??
        "Traffic update",
    );
    const type = String(row.Type ?? row.IncidentType ?? "").toLowerCase();
    const closure = /block|closure|closed|diversion/.test(
      type + text.toLowerCase(),
    );
    const accident = /accident|breakdown|collision/.test(
      type + text.toLowerCase(),
    );
    return {
      id: `traffic-${index}-${roadNameOf(row) || type || "road"}`,
      kind: closure ? "road-closure" : accident ? "incident" : "congestion",
      severity: closure ? "critical" : accident ? "high" : "moderate",
      description: text,
      roadName: roadNameOf(row) || undefined,
      location: locationOf(row),
      delayMinutes: closure ? 12 : accident ? 8 : 4,
      source: "LTA DataMall traffic feed",
    };
  });
}
export function parseFloodAlerts(
  raw: Obj,
  now = new Date().toISOString(),
): Notice[] {
  return toList(raw.value ?? raw)
    .slice(0, 80)
    .map((row, index) => {
      const location = locationOf(row);
      const place = String(
        row.Location ?? row.RoadName ?? row.Description ?? "Reported location",
      );
      return {
        id: `pub-flood-${index}-${place}`,
        title: `Flood alert: ${place}`,
        description: String(
          row.Message ??
            row.Description ??
            "Avoid the affected road and nearby walkways.",
        ),
        stations: [],
        severity: "critical" as const,
        kind: "flood" as const,
        startsAt: row.StartDate ?? row.StartTime ?? now,
        endsAt: row.EndDate ?? row.EndTime,
        delayMinutes: 0,
        location,
        roadName: roadNameOf(row) || undefined,
        source: "PUB Flood Alerts via LTA DataMall",
      };
    });
}
function nearestReading(raw: Obj, origin: { lat: number; lon: number }) {
  const candidates: { value: number; lat?: number; lon?: number }[] = [];
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const reading = numberAt(value.value ?? value.Value ?? value.reading);
    const point = locationOf(value);
    if (reading !== undefined)
      candidates.push({ value: reading, lat: point?.[0], lon: point?.[1] });
    Object.values(value).forEach(visit);
  };
  visit(raw?.data?.records ?? raw?.data?.items ?? raw);
  return candidates.sort(
    (a, b) =>
      Math.hypot(
        (a.lat ?? origin.lat) - origin.lat,
        (a.lon ?? origin.lon) - origin.lon,
      ) -
      Math.hypot(
        (b.lat ?? origin.lat) - origin.lat,
        (b.lon ?? origin.lon) - origin.lon,
      ),
  )[0]?.value;
}
export function demoConditions(
  scenario: Scenario,
  departure: string,
): Conditions {
  const when = new Date(departure);
  const at = new Date(when.getTime() - 1800000).toISOString();
  const end = new Date(when.getTime() + 7200000).toISOString();
  const base = {
    stations: [] as string[],
    startsAt: at,
    endsAt: end,
    source: "SIMULATED demo scenario",
    delayMinutes: 0,
  };
  const notices: Notice[] = [];
  if (scenario === "disruption")
    notices.push({
      ...base,
      id: "demo-ewl",
      title: "Signalling fault on the East West Line",
      description:
        "Allow 20 extra minutes between Paya Lebar and Bugis. Consider the Downtown Line before leaving home.",
      line: "EWL",
      stations: ["EW8", "EW9", "EW10", "EW11", "EW12"],
      stationNames: ["Paya Lebar", "Aljunied", "Kallang", "Lavender", "Bugis"],
      severity: "critical",
      kind: "disruption",
      delayMinutes: 20,
      freeBus:
        "Free boarding at Paya Lebar, Aljunied, Kallang, Lavender and Bugis",
      shuttle: "Paya Lebar ↔ Bugis",
      direction: "Both",
    });
  if (scenario === "rain")
    notices.push({
      ...base,
      id: "demo-rain",
      title: "Heavy rain along your journey",
      description:
        "Thunderstorms expected. Allow more time for exposed walks and bus journeys. Cycling is not recommended during thunderstorms.",
      severity: "warning",
      kind: "weather",
      delayMinutes: 5,
    });
  if (scenario === "crowded")
    notices.push({
      ...base,
      id: "demo-crowd",
      title: "A busier morning on the EWL",
      description:
        "High platform crowding is forecast for your travel window. A different line or a later departure could be more comfortable.",
      line: "EWL",
      stations: ["EW2", "EW5", "EW8", "EW13", "EW14"],
      severity: "warning",
      kind: "crowd",
      delayMinutes: 5,
    });
  if (scenario === "maintenance")
    notices.push({
      ...base,
      id: "demo-lift",
      title: "Outram Park lift maintenance",
      description:
        "Simulated lift closure affecting the hospital-side exit. Check with station staff or use an alternative station; step-free access cannot be assumed.",
      line: "EWL",
      stations: ["EW16", "NE3", "TE17"],
      stationNames: ["Outram Park"],
      severity: "warning",
      kind: "lift",
      startsAt: new Date(when.getTime() - 86400000).toISOString(),
      delayMinutes: 0,
    });
  if (scenario === "closure")
    notices.push({
      ...base,
      id: "demo-closure",
      title: "Planned EWL track works",
      description:
        "Selected EWL stations are closed for scheduled works during this replay. Choose an alternative before you set off.",
      line: "EWL",
      stations: ["EW8", "EW9", "EW10", "EW11", "EW12", "EW13", "EW14"],
      stationNames: [
        "Paya Lebar",
        "Aljunied",
        "Kallang",
        "Lavender",
        "Bugis",
        "City Hall",
        "Raffles Place",
      ],
      severity: "critical",
      kind: "planned",
      delayMinutes: 40,
    });
  // This scheduled event is always visible, but affects only journeys in its window.
  const tomorrow = new Date(when.getTime() + 86400000);
  notices.push({
    id: "demo-weekend",
    title: "Plan ahead: EWL evening maintenance",
    description:
      "Demo notice: leave before 23:00 or use the Downtown Line. This is a fictional planned event for judging.",
    line: "EWL",
    stations: ["EW8", "EW9", "EW10", "EW11", "EW12"],
    stationNames: ["Paya Lebar", "Aljunied", "Kallang", "Lavender", "Bugis"],
    severity: "info",
    kind: "planned",
    startsAt: `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow)}T23:00:00+08:00`,
    endsAt: new Date(tomorrow.getTime() + 86400000).toISOString(),
    delayMinutes: 35,
    source: "SIMULATED planned event",
  });
  const crowd: CrowdReading[] = [
    "EW2",
    "EW5",
    "EW8",
    "EW13",
    "EW14",
    "DT32",
    "DT18",
    "NE17",
    "CC23",
  ].map((station) => ({
    station,
    line: canonicalLine(station.replace(/\d/g, "")),
    level:
      scenario === "crowded" && station.startsWith("EW")
        ? "high"
        : station.startsWith("DT")
          ? "low"
          : "moderate",
    start: at,
    end,
    forecast: true,
  }));
  return {
    notices,
    crowd,
    buses: [
      {
        service: "196",
        stop: "84009",
        eta: new Date(when.getTime() + 240000).toISOString(),
        load: "low",
        wheelchair: true,
        type: "DD",
      },
    ],
    weather: {
      forecast:
        scenario === "rain" ? "Heavy thundery showers" : "Partly cloudy",
      rain: scenario === "rain",
      rainfallMm: scenario === "rain" ? 8 : 0,
      temperature: 29,
      walkStatus: scenario === "rain" ? "invalid" : "valid",
      cycleStatus: scenario === "rain" ? "invalid" : "valid",
    },
    traffic: [],
    feeds: [
      {
        name: "LTA service alerts",
        status: "demo",
        updatedAt: at,
        detail: "Injected replay, not a live incident",
      },
      {
        name: "Station crowds & forecasts",
        status: "demo",
        updatedAt: at,
        detail: "Synthetic crowd readings",
      },
      {
        name: "Bus arrivals & occupancy",
        status: "demo",
        updatedAt: at,
        detail: "Synthetic bus arrival",
      },
      {
        name: "Weather",
        status: "demo",
        updatedAt: at,
        detail: "Scenario weather",
      },
      {
        name: "Planned works & lifts",
        status: "demo",
        updatedAt: at,
        detail: "Simulated planned events",
      },
    ],
    updatedAt: new Date().toISOString(),
    mode: "demo",
  };
}

export async function getConditions(
  request: Pick<PlanRequest, "dataMode" | "scenario" | "departure"> &
    Partial<Pick<PlanRequest, "origin" | "destination">>,
): Promise<Conditions> {
  if (request.dataMode === "demo")
    return demoConditions(request.scenario, request.departure);
  const conditions: Conditions = {
    notices: [],
    crowd: [],
    buses: [],
    weather: {
      forecast: "Weather unavailable",
      rain: false,
      walkStatus: "valid",
      cycleStatus: "valid",
    },
    traffic: [],
    feeds: [],
    updatedAt: new Date().toISOString(),
    mode: "live",
  };
  async function lta(
    endpoint: string,
    name: string,
    ttl: number,
    consume: (raw: Obj) => void,
  ) {
    if (!process.env.LTA_ACCOUNT_KEY) {
      conditions.feeds.push({
        name,
        status: "unavailable",
        detail: "LTA AccountKey has not been configured",
      });
      return;
    }
    try {
      const item = await cachedFetch(
        endpoint,
        `https://datamall2.mytransport.sg/ltaodataservice/${endpoint}`,
        ttl,
        { AccountKey: process.env.LTA_ACCOUNT_KEY, Accept: "application/json" },
      );
      consume(item.value);
      conditions.feeds.push({
        name,
        status: item.stale ? "stale" : "live",
        updatedAt: new Date(item.at).toISOString(),
        detail: item.stale
          ? "Cached after an upstream failure"
          : "Official LTA DataMall",
      });
    } catch {
      conditions.feeds.push({
        name,
        status: "unavailable",
        detail:
          "Official feed could not be reached; no normal-service claim is made",
      });
    }
  }
  const lines = [
    "EWL",
    "DTL",
    "NEL",
    "CCL",
    "TEL",
    "NSL",
    "CGL",
    "CEL",
    "SLRT",
    "PLRT",
    "BPL",
  ];
  await Promise.allSettled([
    lta("TrainServiceAlerts", "LTA service alerts", 60000, (r) =>
      conditions.notices.push(...parseTrainAlerts(r)),
    ),
    ...lines.flatMap((line) => [
      lta(
        `PCDRealTime?TrainLine=${line}`,
        `${line} station crowds`,
        600000,
        (r) => conditions.crowd.push(...parseCrowds(r, line)),
      ),
      lta(
        `PCDForecast?TrainLine=${line}`,
        `${line} crowd forecast`,
        21600000,
        (r) => conditions.crowd.push(...parseCrowds(r, line, true)),
      ),
    ]),
    lta("v2/FacilitiesMaintenance", "Lift maintenance", 1800000, (r) => {
      for (const [i, v] of toList(r.value).entries()) {
        const detail = String(
          v.LiftDesc ??
            v.Description ??
            v.LiftMaintenanceDetails ??
            v.MaintenanceReason ??
            v.Message ??
            "Lift maintenance reported; verify the affected exit with station staff.",
        );
        conditions.notices.push({
          id: `lift-${i}`,
          title: `${v.StationName ?? v.Station ?? "Station"} lift maintenance`,
          description: `${v.LiftID ? `Lift ${v.LiftID}: ` : ""}${detail}`,
          line: canonicalLine(v.Line ?? ""),
          stations: String(v.StationCode ?? v.Station ?? "")
            .split(",")
            .filter(Boolean),
          stationNames: [v.StationName].filter(Boolean),
          kind: "lift",
          severity: "warning",
          startsAt: v.StartDate ?? v.StartTime ?? conditions.updatedAt,
          endsAt: v.EndDate ?? v.EndTime,
          delayMinutes: 0,
          source:
            "LTA FacilitiesMaintenance · affected lift and exit supplied by LTA",
        });
      }
    }),
    lta("RoadWorks", "Planned road works", 3600000, (r) => {
      for (const [i, v] of toList(r.value).slice(0, 15).entries())
        conditions.notices.push({
          id: `road-${i}`,
          title: v.RoadName ?? "Planned road works",
          description:
            v.Description ??
            `Works from ${v.StartDate ?? "announced date"} to ${v.EndDate ?? "further notice"}. Check nearby bus diversions.`,
          stations: [],
          kind: "advisory",
          severity: "info",
          startsAt: v.StartDate ?? conditions.updatedAt,
          endsAt: v.EndDate,
          delayMinutes: 0,
          source: "LTA RoadWorks; informational until geospatially matched",
        });
    }),
    lta("FloodAlerts", "PUB flood alerts", 60000, (r) =>
      conditions.notices.push(...parseFloodAlerts(r, conditions.updatedAt)),
    ),
    lta("TrafficIncidents", "Traffic incidents", 60000, (r) =>
      conditions.traffic.push(...parseTraffic(r)),
    ),
    lta("TrafficSpeedBands", "Traffic speeds", 60000, (r) =>
      conditions.traffic.push(...parseTraffic(r)),
    ),
    lta("EstimatedTravelTimes", "Expressway travel times", 60000, (r) =>
      conditions.traffic.push(
        ...parseTraffic(r).map((reading) => ({
          ...reading,
          kind: "expressway" as const,
          delayMinutes: Math.max(reading.delayMinutes, 5),
        })),
      ),
    ),
    (async () => {
      try {
        const horizon = (Date.parse(request.departure) - Date.now()) / 3600000;
        const endpoint =
          horizon <= 2
            ? "two-hr-forecast"
            : horizon <= 24
              ? "twenty-four-hr-forecast"
              : "four-day-outlook";
        const r = await cachedFetch(
          `weather-${endpoint}`,
          `https://api-open.data.gov.sg/v2/real-time/api/${endpoint}`,
          600000,
        );
        const origin = request.origin ?? { lat: 1.35285, lon: 103.9405 };
        const [rainfall, airTemperature] = await Promise.allSettled([
          cachedFetch(
            "weather-rainfall",
            "https://api-open.data.gov.sg/v2/real-time/api/rainfall",
            300000,
          ),
          cachedFetch(
            "weather-air-temperature",
            "https://api-open.data.gov.sg/v2/real-time/api/air-temperature",
            300000,
          ),
        ]);
        const rainfallMm =
          rainfall.status === "fulfilled"
            ? nearestReading(rainfall.value.value, origin)
            : undefined;
        const temperature =
          airTemperature.status === "fulfilled"
            ? nearestReading(airTemperature.value.value, origin)
            : undefined;
        const record = r.value?.data?.items?.[0] ?? r.value?.data?.records?.[0];
        const at = Date.parse(request.departure);
        const inWindow = (window: Obj) =>
          window &&
          Date.parse(window.start) <= at &&
          Date.parse(window.end) >= at;
        let text = "Weather unavailable for this travel window";
        let valid = false;
        let detail = "data.gov.sg official forecast";
        if (endpoint === "two-hr-forecast" && inWindow(record?.valid_period)) {
          const area = [...r.value.data.area_metadata].sort(
            (a: Obj, b: Obj) =>
              Math.hypot(
                a.label_location.latitude - origin.lat,
                a.label_location.longitude - origin.lon,
              ) -
              Math.hypot(
                b.label_location.latitude - origin.lat,
                b.label_location.longitude - origin.lon,
              ),
          )[0]?.name;
          text =
            record.forecasts.find((f: Obj) => f.area === area)?.forecast ??
            text;
          valid = true;
          detail += `; ${area}, matches departure time`;
        } else if (endpoint === "twenty-four-hr-forecast") {
          const period = record?.periods?.find((p: Obj) =>
            inWindow(p.timePeriod),
          );
          const region =
            origin.lon > 103.89
              ? "east"
              : origin.lon < 103.8
                ? "west"
                : origin.lat > 1.37
                  ? "north"
                  : origin.lat < 1.31
                    ? "south"
                    : "central";
          if (period) {
            text =
              period.regions?.[region]?.text ??
              record.general?.forecast?.text ??
              text;
            valid = true;
            detail += `; ${region} region, matches departure time`;
          } else if (inWindow(record?.general?.validPeriod)) {
            text = record.general.forecast.text;
            valid = true;
            detail += "; broad 24-hour outlook";
          }
        } else if (endpoint === "four-day-outlook") {
          const day = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Singapore",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(request.departure));
          const forecast = record?.forecasts?.find((f: Obj) =>
            String(f.timestamp).startsWith(day),
          );
          if (forecast) {
            text = forecast.forecast.summary ?? forecast.forecast.text;
            valid = true;
            detail += "; broad daily outlook, not an hour-specific prediction";
          }
        }
        const rain =
          valid &&
          endpoint !== "four-day-outlook" &&
          /rain|showers|thunder/i.test(text);
        const heavyRain =
          (rainfallMm ?? 0) >= 7.2 || /heavy|thunder/i.test(text);
        const heat =
          (temperature ?? 0) >= 33 ||
          ((temperature ?? 0) >= 32 && /fair|sunny|partly cloudy/i.test(text));
        conditions.weather = {
          forecast: text,
          rain,
          rainfallMm,
          temperature,
          walkStatus: heavyRain
            ? "invalid"
            : rain || heat
              ? "limited"
              : "valid",
          cycleStatus:
            heavyRain || (temperature ?? 0) >= 34
              ? "invalid"
              : rain || heat
                ? "limited"
                : "valid",
        };
        conditions.feeds.push({
          name: `NEA ${endpoint}`,
          status: r.stale ? "stale" : valid ? "live" : "unavailable",
          updatedAt:
            record?.update_timestamp ??
            record?.timestamp ??
            new Date(r.at).toISOString(),
          detail,
        });
        conditions.feeds.push({
          name: "NEA rainfall & air temperature",
          status:
            rainfall.status === "fulfilled" ||
            airTemperature.status === "fulfilled"
              ? "live"
              : "unavailable",
          updatedAt: new Date().toISOString(),
          detail: "Nearest available weather station to the journey origin",
        });
      } catch {
        conditions.feeds.push({
          name: "NEA 2-hour forecast",
          status: "unavailable",
          detail: "Weather could not be reached",
        });
      }
    })(),
  ]);
  return conditions;
}
export async function getBusArrivals(stop: string) {
  if (!process.env.LTA_ACCOUNT_KEY) return { buses: [], status: "unavailable" };
  const result = await cachedFetch(
    `bus-${stop}`,
    `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${stop}`,
    30000,
    { AccountKey: process.env.LTA_ACCOUNT_KEY },
  );
  return {
    buses: parseBuses(result.value, stop),
    status: result.stale ? "stale" : "live",
    updatedAt: new Date(result.at).toISOString(),
  };
}
export const feedCache = cache;
