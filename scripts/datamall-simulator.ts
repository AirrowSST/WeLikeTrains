import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import {
  timelineIds,
  timelineInputs,
  type TimelineId,
} from "../shared/timelines";

export const scenarios = [
  "normal",
  "missed-first-bus",
  "partial-failure",
  "stale",
  "timeout",
  "rate-limited",
  "malformed",
] as const;
export type SimulatorScenario = (typeof scenarios)[number];

export async function startDatamallSimulator(
  options: {
    port?: number;
    now?: () => number;
    scenario?: SimulatorScenario;
  } = {},
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Simulator is development-only");
  const now = options.now ?? Date.now;
  let scenario = options.scenario ?? "normal";
  const counts = new Map<string, number>();
  const links = new Map<string, number>();
  let sequence = 0;
  const archive = zipSync(
    Object.fromEntries(
      [
        "routes",
        "stops",
        "trips",
        "stop_times",
        "calendar",
        "calendar_dates",
      ].map((name) => [
        name + ".txt",
        strToU8(
          readFileSync(
            new URL(`../tests/fixtures/gtfs/${name}.txt`, import.meta.url),
            "utf8",
          ),
        ),
      ]),
    ),
  );
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "X-Wayce-Simulated": "true",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") return send(405, { error: "GET only" });
    if (url.pathname === "/health")
      return send(200, { simulated: true, scenario });
    if (url.pathname === "/gtfs.zip") {
      const expiry = links.get(url.searchParams.get("ticket") ?? "");
      if (!expiry || now() >= expiry)
        return send(403, { error: "Expired or unknown fixture link" });
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "X-Wayce-Simulated": "true",
      });
      return res.end(archive);
    }
    if (req.headers.accountkey !== "local-test-key")
      return send(401, { error: "Use local-test-key only" });
    if (!url.pathname.startsWith("/ltaodataservice/"))
      return send(404, { error: "Unknown endpoint" });
    const endpoint = url.pathname.slice("/ltaodataservice/".length);
    if (url.searchParams.has("timeline")) {
      const id = url.searchParams.get("timeline") as TimelineId;
      const minute = Number(url.searchParams.get("minute") ?? 0);
      if (
        !timelineIds.includes(id) ||
        !Number.isInteger(minute) ||
        minute < 0 ||
        minute > 60
      )
        return send(400, { error: "Invalid timeline or minute" });
      const input = timelineInputs({ id, minute });
      if (endpoint === "TrainServiceAlerts") return send(200, input.alerts);
      if (endpoint === "v2/FacilitiesMaintenance")
        return send(200, input.maintenance);
      if (endpoint === "PCDRealTime" || endpoint === "PCDForecast")
        return send(
          200,
          url.searchParams.get("TrainLine") === input.line
            ? input.crowd
            : { value: [] },
        );
      if (endpoint === "two-hr-forecast") return send(200, input.weather);
      if (endpoint === "v3/BusArrival") {
        const stop = url.searchParams.get("BusStopCode") ?? "";
        if (!/^\d{5}$/.test(stop))
          return send(400, { error: "Invalid BusStopCode" });
        return send(
          200,
          input.bus(stop, ["27", "67", "12", "34", "196", "2", "172"]),
        );
      }
      if (
        [
          "v4/TrafficSpeedBands",
          "EstTravelTimes",
          "PubFloodAlerts",
          "TrafficIncidents",
        ].includes(endpoint)
      )
        return send(200, { value: [] });
      return send(404, { error: "Endpoint not simulated for timelines" });
    }
    const count = (counts.get(endpoint) ?? 0) + 1;
    counts.set(endpoint, count);
    if (scenario === "timeout") return; // Client must abort; close() destroys remaining connections.
    if (scenario === "rate-limited") {
      res.setHeader("Retry-After", "30");
      return send(429, { error: "Synthetic rate limit" });
    }
    if (
      (scenario === "partial-failure" && endpoint === "v4/TrafficSpeedBands") ||
      (scenario === "stale" && count > 1)
    )
      return send(503, { error: "Synthetic outage" });
    if (scenario === "malformed") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("{broken");
    }
    if (endpoint === "GTFSScheduleTrain") {
      const ticket = String(++sequence);
      links.set(ticket, now() + 15 * 60_000);
      return send(200, {
        value: [{ Link: `${baseOrigin}/gtfs.zip?ticket=${ticket}` }],
      });
    }
    if (endpoint === "v3/BusArrival") {
      const stop = url.searchParams.get("BusStopCode");
      if (!stop || !/^\d{5}$/.test(stop))
        return send(400, { error: "BusStopCode requires five digits" });
      const bus = (minutes: number, load: string) => ({
        EstimatedArrival: new Date(now() + minutes * 60_000).toISOString(),
        Latitude: "1.3536548",
        Longitude: "103.9461424",
        VisitNumber: "1",
        Load: load,
        Feature: "WAB",
        Type: "SD",
        Monitored: 1,
      });
      return send(200, {
        BusStopCode: stop,
        Services: [
          {
            ServiceNo: "27",
            Operator: "SBST",
            NextBus: bus(scenario === "missed-first-bus" ? 6 : 10, "SEA"),
            NextBus2: bus(11, "SDA"),
            NextBus3: bus(18, "LSD"),
          },
        ],
      });
    }
    if (["BusStops", "BusRoutes", "BusServices"].includes(endpoint)) {
      const skip = Number(url.searchParams.get("$skip") ?? 0);
      if (!Number.isSafeInteger(skip) || skip < 0)
        return send(400, { error: "Invalid $skip" });
      const rows = Array.from({ length: 501 }, (_, i) =>
        endpoint === "BusStops"
          ? {
              BusStopCode: String(10000 + i),
              RoadName: "Synthetic Road",
              Description: `Synthetic stop ${i}`,
              Latitude: 1.35,
              Longitude: 103.94,
            }
          : endpoint === "BusRoutes"
            ? {
                ServiceNo: "27",
                Operator: "SBST",
                Direction: 1,
                StopSequence: i + 1,
                BusStopCode: String(10000 + i),
                Distance: i * 0.1,
                WD_FirstBus: "0530",
                WD_LastBus: "2350",
              }
            : {
                ServiceNo: String(i + 1),
                Operator: "SBST",
                Direction: 1,
                Category: "TRUNK",
                OriginCode: "10000",
                DestinationCode: "10500",
                AM_Peak_Freq: "5-10",
                AM_Offpeak_Freq: "10-15",
                PM_Peak_Freq: "5-10",
                PM_Offpeak_Freq: "10-15",
              },
      );
      return send(200, { value: rows.slice(skip, skip + 500) });
    }
    if (endpoint === "TrainServiceAlerts")
      return send(200, {
        value: {
          Status: 1,
          AffectedSegments: [],
          Message: [
            {
              Content:
                "SIMULATED DataMall development server; no live service claim.",
              CreatedDate: new Date(now()).toISOString(),
            },
          ],
        },
      });
    const fixture = {
      "v4/TrafficSpeedBands": "traffic-speed-bands-v4",
      EstTravelTimes: "estimated-travel-times",
      PubFloodAlerts: "pub-flood-alerts",
    }[endpoint];
    if (fixture)
      return send(
        200,
        JSON.parse(
          readFileSync(
            new URL(
              `../tests/fixtures/datamall/${fixture}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
    if (
      [
        "PCDRealTime",
        "PCDForecast",
        "v2/FacilitiesMaintenance",
        "TrafficIncidents",
      ].includes(endpoint)
    )
      return send(200, { value: [] });
    return send(404, { error: "Endpoint not simulated" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing simulator address");
  const baseOrigin = `http://127.0.0.1:${address.port}`;
  return {
    base: `${baseOrigin}/ltaodataservice`,
    setScenario(value: SimulatorScenario) {
      scenario = value;
      counts.clear();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
