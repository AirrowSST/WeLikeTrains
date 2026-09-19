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
import { ltaConnection } from "./lta-client";
import { trainRealtime } from "./rail-realtime";
import { timelineInputs } from "../shared/timelines";

type Obj = Record<string, any>;
export const LTA_ENDPOINTS = {
  floodAlerts: "PubFloodAlerts",
  trafficSpeedBands: "v4/TrafficSpeedBands",
  estimatedTravelTimes: "EstTravelTimes",
} as const;
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
        redirect: headers.AccountKey ? "error" : "follow",
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
      const start = timestamp(v.StartTime ?? v.Start ?? v.Time);
      const end = timestamp(v.EndTime ?? v.End);
      const startMs = Date.parse(start);
      const endMs = end ? Date.parse(end) : startMs + 1800000;
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)
        result.push({
          station: name,
          line: canonicalLine(line),
          level: crowdValue(v.CrowdLevel),
          start,
          end: new Date(endMs).toISOString(),
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
              monitored:
                s[key].Monitored === 1 || String(s[key].Monitored) === "1",
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
const coordinateOf = (
  latitude: unknown,
  longitude: unknown,
): [number, number] | undefined => {
  const lat = numberAt(latitude);
  const lon = numberAt(longitude);
  return lat !== undefined && lon !== undefined ? [lat, lon] : undefined;
};
export function parseTrafficSpeedBands(raw: Obj): TrafficReading[] {
  return toList(raw.value ?? raw)
    .slice(0, 500)
    .map((row, index) => {
      const linkId = String(row.LinkID ?? index);
      const roadName = String(row.RoadName ?? "Unnamed road").trim();
      const speedBand = numberAt(row.SpeedBand);
      const minimumSpeed = numberAt(row.MinimumSpeed);
      const maximumSpeed = numberAt(row.MaximumSpeed);
      const speedText =
        minimumSpeed !== undefined && maximumSpeed !== undefined
          ? `${minimumSpeed}–${maximumSpeed} km/h`
          : speedBand !== undefined
            ? `speed band ${speedBand}`
            : "speed unavailable";
      return {
        id: `speed-band-${linkId}`,
        kind: "congestion" as const,
        severity:
          maximumSpeed !== undefined && maximumSpeed < 20
            ? ("critical" as const)
            : maximumSpeed !== undefined && maximumSpeed < 40
              ? ("high" as const)
              : ("moderate" as const),
        description: `${roadName}: ${speedText}`,
        roadName,
        roadCategory: row.RoadCategory ? String(row.RoadCategory) : undefined,
        location: coordinateOf(row.StartLat, row.StartLon),
        endLocation: coordinateOf(row.EndLat, row.EndLon),
        linkId,
        speedBand,
        minimumSpeed,
        maximumSpeed,
        // Stage 0 records road speed only. It must not be treated as bus delay
        // until a later route-match and bus-speed correction is calibrated.
        delayMinutes: 0,
        source: "LTA DataMall TrafficSpeedBands v4",
      };
    });
}
export function parseEstimatedTravelTimes(raw: Obj): TrafficReading[] {
  return toList(raw.value ?? raw)
    .slice(0, 120)
    .map((row, index) => {
      const expressway = String(row.Name ?? "Expressway").trim();
      const direction = String(row.Direction ?? "").trim();
      const farEndPoint = String(row.FarEndPoint ?? "").trim();
      const startPoint = String(row.StartPoint ?? "").trim();
      const endPoint = String(row.EndPoint ?? "").trim();
      const estimatedMinutes = numberAt(row.EstTime);
      const section = [startPoint, endPoint].filter(Boolean).join(" to ");
      const destination = farEndPoint ? ` towards ${farEndPoint}` : "";
      const timing =
        estimatedMinutes !== undefined
          ? `: ${estimatedMinutes} min`
          : ": time unavailable";
      return {
        id: `expressway-${expressway}-${direction || index}-${startPoint}-${endPoint}`,
        kind: "expressway" as const,
        severity: "moderate" as const,
        description: `${expressway}${destination}${section ? `, ${section}` : ""}${timing}`,
        roadName: expressway,
        expressway,
        direction: direction || undefined,
        farEndPoint: farEndPoint || undefined,
        startPoint: startPoint || undefined,
        endPoint: endPoint || undefined,
        estimatedMinutes,
        // EstTime is a whole-section ETA, not an additive delay.
        delayMinutes: 0,
        source: "LTA DataMall EstTravelTimes",
      };
    });
}
const floodLocationOf = (row: Obj) => {
  const [latitude, longitude] = String(row.circle ?? "")
    .trim()
    .split(/[\s,]+/);
  return coordinateOf(latitude, longitude) ?? locationOf(row);
};
const floodSeverityOf = (severity: unknown): Notice["severity"] => {
  const value = String(severity ?? "").toLowerCase();
  if (value === "extreme" || value === "severe") return "critical";
  if (value === "moderate") return "warning";
  return "info";
};
export function parseFloodAlerts(
  raw: Obj,
  now = new Date().toISOString(),
): Notice[] {
  return toList(raw.value ?? raw)
    .slice(0, 80)
    .map((row, index) => {
      const location = floodLocationOf(row);
      const place = String(
        row.areaDesc ??
          row.Location ??
          row.RoadName ??
          row.description ??
          row.Description ??
          "Reported location",
      );
      const description = [
        row.description ?? row.Message ?? row.Description,
        row.instruction,
      ]
        .filter(Boolean)
        .map(String)
        .filter(
          (value, itemIndex, values) => values.indexOf(value) === itemIndex,
        )
        .join(" ");
      return {
        id: `pub-flood-${row.alertId ?? `${index}-${place}`}`,
        title: String(row.headline ?? row.event ?? `Flood alert: ${place}`),
        description:
          description || "Avoid the affected road and nearby walkways.",
        stations: [],
        severity: row.severity
          ? floodSeverityOf(row.severity)
          : ("critical" as const),
        kind: "flood" as const,
        startsAt: row.dateTime ?? row.StartDate ?? row.StartTime ?? now,
        endsAt: row.expires ?? row.EndDate ?? row.EndTime,
        delayMinutes: 0,
        location,
        roadName: String(row.areaDesc ?? roadNameOf(row)).trim() || undefined,
        source: "PUB Flood Alerts via LTA DataMall",
      };
    });
}
export function nearestReading(
  raw: Obj,
  origin: { lat: number; lon: number },
  now = Date.now(),
) {
  const stations = new Map<string, [number, number]>();
  for (const station of raw?.data?.stations ?? []) {
    const point = locationOf(station.location ?? station);
    if (point) stations.set(station.id, point);
  }
  const latest = [...(raw?.data?.readings ?? [])].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
  )[0];
  const timestamp = Date.parse(latest?.timestamp);
  if (
    !Number.isFinite(timestamp) ||
    now - timestamp > 20 * 60000 ||
    timestamp > now + 60000
  )
    return undefined;
  return (latest.data ?? [])
    .map((row: Obj) => ({
      value: numberAt(row.value),
      coord: stations.get(row.stationId),
    }))
    .filter((row: any) => row.value !== undefined && row.coord)
    .sort(
      (a: any, b: any) =>
        Math.hypot(a.coord[0] - origin.lat, a.coord[1] - origin.lon) -
        Math.hypot(b.coord[0] - origin.lat, b.coord[1] - origin.lon),
    )[0]?.value as number | undefined;
}
export function demoConditions(
  scenario: Scenario,
  departure: string,
  weatherOverride?: PlanRequest["demoWeather"],
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
  const customWeather = weatherOverride
    ? (() => {
        const rain =
          weatherOverride.kind === "showers" ||
          weatherOverride.kind === "storm" ||
          weatherOverride.rainfallMm > 0;
        const heavyRain =
          weatherOverride.kind === "storm" || weatherOverride.rainfallMm >= 7.2;
        const heat =
          weatherOverride.kind === "heat" || weatherOverride.temperature >= 33;
        return {
          forecast: {
            clear: "Clear demo conditions",
            showers: "Scattered demo showers",
            storm: "Heavy demo thunderstorms",
            heat: "Hot demo conditions",
          }[weatherOverride.kind],
          rain,
          rainfallMm: weatherOverride.rainfallMm,
          temperature: weatherOverride.temperature,
          walkStatus: heavyRain
            ? "invalid"
            : rain || heat
              ? "limited"
              : "valid",
          cycleStatus:
            heavyRain || weatherOverride.temperature >= 34
              ? "invalid"
              : rain || heat
                ? "limited"
                : "valid",
        } satisfies Conditions["weather"];
      })()
    : undefined;
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
    weather: customWeather ?? {
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
        detail: customWeather ? "Custom simulated weather" : "Scenario weather",
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

export async function getLiveWeather(request: {
  departure: string;
  origin?: { lat: number; lon: number };
}): Promise<Pick<Conditions, "weather" | "feeds" | "updatedAt">> {
  const result: Pick<Conditions, "weather" | "feeds" | "updatedAt"> = {
    weather: {
      forecast: "Weather unavailable",
      rain: false,
      walkStatus: "valid",
      cycleStatus: "valid",
    },
    feeds: [],
    updatedAt: new Date().toISOString(),
  };
  try {
    const horizon = (Date.parse(request.departure) - Date.now()) / 3600000;
    const endpoint =
      horizon <= 2
        ? "two-hr-forecast"
        : horizon <= 24
          ? "twenty-four-hr-forecast"
          : "four-day-outlook";
    const response = await cachedFetch(
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
      horizon <= 2 && rainfall.status === "fulfilled" && !rainfall.value.stale
        ? nearestReading(rainfall.value.value, origin)
        : undefined;
    const temperature =
      horizon <= 2 &&
      airTemperature.status === "fulfilled" &&
      !airTemperature.value.stale
        ? nearestReading(airTemperature.value.value, origin)
        : undefined;
    const record =
      response.value?.data?.items?.[0] ?? response.value?.data?.records?.[0];
    const at = Date.parse(request.departure);
    const inWindow = (window: Obj) =>
      window && Date.parse(window.start) <= at && Date.parse(window.end) >= at;
    let text = "Weather unavailable for this travel window";
    let valid = false;
    let detail = "data.gov.sg official forecast";
    if (endpoint === "two-hr-forecast" && inWindow(record?.valid_period)) {
      const area = [...response.value.data.area_metadata].sort(
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
        record.forecasts.find((forecast: Obj) => forecast.area === area)
          ?.forecast ?? text;
      valid = true;
      detail += `; ${area}, matches departure time`;
    } else if (endpoint === "twenty-four-hr-forecast") {
      const period = record?.periods?.find((period: Obj) =>
        inWindow(period.timePeriod),
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
      const forecast = record?.forecasts?.find((forecast: Obj) =>
        String(forecast.timestamp).startsWith(day),
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
    const heavyRain = (rainfallMm ?? 0) >= 7.2 || /heavy|thunder/i.test(text);
    const heat =
      (temperature ?? 0) >= 33 ||
      ((temperature ?? 0) >= 32 && /fair|sunny|partly cloudy/i.test(text));
    result.weather = {
      forecast: text,
      rain,
      rainfallMm,
      temperature,
      walkStatus: heavyRain ? "invalid" : rain || heat ? "limited" : "valid",
      cycleStatus:
        heavyRain || (temperature ?? 0) >= 34
          ? "invalid"
          : rain || heat
            ? "limited"
            : "valid",
    };
    result.feeds.push({
      name: `NEA ${endpoint}`,
      status: response.stale ? "stale" : valid ? "live" : "unavailable",
      updatedAt:
        record?.update_timestamp ??
        record?.timestamp ??
        new Date(response.at).toISOString(),
      detail,
    });
    result.feeds.push({
      name: "NEA rainfall & air temperature",
      status:
        rainfallMm !== undefined || temperature !== undefined
          ? "live"
          : "unavailable",
      updatedAt: new Date().toISOString(),
      detail: "Nearest available weather station to the journey origin",
    });
  } catch {
    result.feeds.push({
      name: "NEA 2-hour forecast",
      status: "unavailable",
      detail: "Weather could not be reached",
    });
  }
  return result;
}

export async function getConditions(
  request: Pick<
    PlanRequest,
    "dataMode" | "scenario" | "departure" | "demoWeather" | "timeline"
  > &
    Partial<Pick<PlanRequest, "origin" | "destination">>,
): Promise<Conditions> {
  const connection = ltaConnection();
  if (request.dataMode === "demo" && request.timeline) {
    const input = timelineInputs(request.timeline);
    const forecast = input.weather.data.items[0].forecasts[0].forecast;
    const rain = /showers/i.test(forecast);
    const notices = parseTrainAlerts(input.alerts, input.at);
    for (const lift of input.maintenance.value)
      notices.push({
        id: "timeline-lift",
        title: lift.LiftDesc,
        description: lift.LiftDesc,
        kind: "lift",
        severity: "warning",
        stations: [lift.StationCode],
        stationNames: [lift.StationName],
        startsAt: lift.StartDate,
        endsAt: lift.EndDate,
        delayMinutes: 0,
        source: "SIMULATED DataMall FacilitiesMaintenance",
      });
    return {
      notices: notices.map((n) => ({
        ...n,
        title: n.title.startsWith("SIMULATED")
          ? n.title
          : `SIMULATED · ${n.title}`,
        source: `SIMULATED · ${n.source}`,
      })),
      crowd: parseCrowds(input.crowd, input.line),
      buses: [],
      traffic: [],
      weather: {
        forecast: `SIMULATED · ${forecast}`,
        rain,
        rainfallMm: rain ? 10 : 0,
        temperature: 29,
        walkStatus: rain ? "invalid" : "valid",
        cycleStatus: rain ? "invalid" : "valid",
      },
      feeds: ["DataMall transport", "NEA weather"].map((name) => ({
        name: `SIMULATED · ${name}`,
        status: "demo" as const,
        updatedAt: input.at,
        detail: `${request.timeline!.id} · minute ${request.timeline!.minute} · authored API inputs`,
      })),
      updatedAt: input.at,
      mode: "demo",
    };
  }
  if (request.dataMode === "demo")
    return demoConditions(
      request.scenario,
      request.departure,
      request.demoWeather,
    );
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
    const connection = ltaConnection();
    if (!connection.key) {
      conditions.feeds.push({
        name,
        status: "unavailable",
        detail: "LTA AccountKey has not been configured",
      });
      return;
    }
    try {
      const item = await cachedFetch(
        `${connection.base}/${endpoint}`,
        `${connection.base}/${endpoint}`,
        ttl,
        { AccountKey: connection.key, Accept: "application/json" },
      );
      // Expired occupancy is not a usable crowd reading for a new journey.
      if (!item.stale || !/station crowds|crowd forecast/.test(name))
        consume(item.value);
      conditions.feeds.push({
        name: connection.simulated ? `SIMULATED · ${name}` : name,
        status: item.stale ? "stale" : connection.simulated ? "demo" : "live",
        updatedAt: new Date(item.at).toISOString(),
        detail: connection.simulated
          ? `Local DataMall simulator${item.stale ? " · cached after a synthetic outage" : " · authored test data"}`
          : item.stale
            ? "Cached after an upstream failure"
            : "Official LTA DataMall",
      });
    } catch {
      conditions.feeds.push({
        name: connection.simulated ? `SIMULATED · ${name}` : name,
        status: "unavailable",
        detail: connection.simulated
          ? "Local DataMall simulator unavailable"
          : "Official feed could not be reached; no normal-service claim is made",
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
    ...(
      [
        "GTFSRealtimeTrainTripUpdates",
        "GTFSRealTimeTrainServiceAlerts",
      ] as const
    ).map(async (endpoint) => {
      const result = await trainRealtime(endpoint);
      conditions.trainUpdates = [
        ...(conditions.trainUpdates ?? []),
        ...result.updates,
      ];
      conditions.notices.push(...result.notices);
      conditions.feeds.push(result.feed);
    }),
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
    lta(LTA_ENDPOINTS.floodAlerts, "PUB flood alerts", 60000, (r) =>
      conditions.notices.push(...parseFloodAlerts(r, conditions.updatedAt)),
    ),
    lta("TrafficIncidents", "Traffic incidents", 60000, (r) =>
      conditions.traffic.push(...parseTraffic(r)),
    ),
    lta(LTA_ENDPOINTS.trafficSpeedBands, "Traffic speeds", 60000, (r) =>
      conditions.traffic.push(...parseTrafficSpeedBands(r)),
    ),
    lta(
      LTA_ENDPOINTS.estimatedTravelTimes,
      "Expressway travel times",
      60000,
      (r) => conditions.traffic.push(...parseEstimatedTravelTimes(r)),
    ),
    (async () => {
      const weather = await getLiveWeather(request);
      conditions.weather = weather.weather;
      conditions.feeds.push(...weather.feeds);
    })(),
  ]);
  if (connection.simulated) {
    for (const notice of conditions.notices) {
      notice.title = `SIMULATED · ${notice.title}`;
      notice.source = `Local DataMall simulator · ${notice.source}`;
    }
    for (const traffic of conditions.traffic)
      traffic.source = `SIMULATED · ${traffic.source}`;
  }
  return conditions;
}
export async function getBusArrivals(stop: string) {
  const connection = ltaConnection();
  if (!connection.key)
    return { buses: [], status: "unavailable", simulated: false };
  const result = await cachedFetch(
    `${connection.base}/bus-${stop}`,
    `${connection.base}/v3/BusArrival?BusStopCode=${encodeURIComponent(stop)}`,
    30000,
    { AccountKey: connection.key },
  );
  const status: "live" | "demo" | "stale" = result.stale
    ? "stale"
    : connection.simulated
      ? "demo"
      : "live";
  return {
    buses: parseBuses(result.value, stop).map((bus) => ({ ...bus, status })),
    status,
    simulated: connection.simulated,
    updatedAt: new Date(result.at).toISOString(),
  };
}
export const feedCache = cache;
