import { describe, it, expect } from "vitest";
import { places, profiles } from "../shared/catalog";
import {
  applyBusArrivalTiming,
  applyConditions,
  planJourney,
  segmentAffected,
} from "../server/planner";
import type {
  Conditions,
  Journey,
  Persona,
  PlanRequest,
  Scenario,
  Segment,
} from "../shared/types";
const request = (
  persona: Persona = "rachel",
  scenario: Scenario = "normal",
): PlanRequest => {
  const p = profiles.find((p) => p.id === persona)!;
  return {
    origin: places.find((s) => s.id === p.origin)!,
    destination: places.find((s) => s.id === p.destination)!,
    departure: "2026-09-21T07:40:00+08:00",
    arriveBy: "2026-09-21T08:45:00+08:00",
    preferences: p.preferences,
    dataMode: "demo",
    scenario,
  };
};
const segment = (
  id: string,
  mode: Segment["mode"],
  minutes: number,
  overrides: Partial<Segment> = {},
): Segment => ({
  id,
  mode,
  line: "",
  from: id,
  to: `${id}-end`,
  minutes,
  distance: 500,
  geometry: [
    [1.3, 103.8],
    [1.31, 103.81],
  ],
  stops: [],
  crowd: "unknown",
  affected: false,
  delay: 0,
  sheltered: true,
  accessibility: "unknown",
  instructions: id,
  source: "test",
  ...overrides,
});
const journey = (segments: Segment[]): Journey => ({
  id: "timed-conditions",
  title: "Timed conditions",
  segments,
  duration: segments.reduce((total, item) => total + item.minutes, 0),
  baselineDuration: segments.reduce((total, item) => total + item.minutes, 0),
  range: [20, 30],
  arrival: "2026-09-20T23:10:00.000Z",
  distance: 1500,
  walkMinutes: 10,
  transfers: 0,
  crowd: "unknown",
  score: 25,
  reasons: [],
  warnings: [],
  source: "test",
  blocked: false,
});
const conditions = (overrides: Partial<Conditions>): Conditions => ({
  notices: [],
  crowd: [],
  buses: [],
  weather: {
    forecast: "Clear",
    rain: false,
    walkStatus: "valid",
    cycleStatus: "valid",
  },
  traffic: [],
  feeds: [],
  updatedAt: "2026-09-20T23:40:00.000Z",
  mode: "demo",
  ...overrides,
});
describe("real OSM journeys", () => {
  it("plans Rachel door-to-door with walking legs and visible uncertainty", async () => {
    const p = await planJourney(request());
    expect(p.recommended.segments[0].mode).toBe("walk");
    expect(p.recommended.segments.at(-1)?.mode).toBe("walk");
    expect(p.recommended.segments.some((s) => s.line === "EWL")).toBe(true);
    const rail = p.recommended.segments.find((s) => s.line === "EWL")!;
    expect(rail.source).toContain("LTA DataMall GTFS Schedule");
    expect(rail.waitMinutes).not.toBe(4);
    expect(
      p.conditions.feeds.find((feed) => feed.name === "LTA train schedule"),
    ).toMatchObject({ status: "local" });
    expect(p.recommended.duration).toBeGreaterThan(30);
    expect(p.recommended.range[1]).toBeGreaterThan(p.recommended.duration);
    expect(p.recommended.segments.every((s) => s.geometry.length >= 2)).toBe(
      true,
    );
    expect(p.conditions.mode).toBe("demo");
  });
  it("reroutes EWL disruption and retains the affected original for comparison", async () => {
    const p = await planJourney(request("rachel", "disruption"));
    expect(
      p.original.segments.some((s) => s.line === "EWL" && s.affected),
    ).toBe(true);
    expect(p.original.duration).toBeGreaterThan(p.original.baselineDuration);
    expect(p.recommended.id).not.toBe(p.original.id);
    expect(p.recommended.duration).toBeLessThan(p.original.duration);
    expect(p.recommended.crowd).toBe("low");
    expect(p.recommended.segments.some((s) => s.stops.includes("DT31"))).toBe(
      true,
    );
  });
  it("rejects routes through a planned rail closure", async () => {
    const p = await planJourney(request("rachel", "closure"));
    expect(p.original.blocked).toBe(true);
    expect(p.recommended.blocked).toBe(false);
    expect(p.recommended.segments.every((s) => !s.affected)).toBe(true);
  });
  it("lets rain change timing without pretending it changes the rail timetable", async () => {
    const dry = await planJourney(request());
    const rain = await planJourney(request("rachel", "rain"));
    expect(rain.recommended.duration).toBeGreaterThan(dry.recommended.duration);
    expect(rain.conditions.weather.rain).toBe(true);
    expect(rain.recommended.blocked).toBe(true);
    expect(rain.travelDecision).toBe("wait");
    expect(rain.advice).toContain("Wait for the heavy weather to pass");
    expect(rain.advice).not.toContain("Arrive around");
    expect(rain.risk.disclaimer).toContain("not a disruption probability");
  });
  it("provides Arjun a followable multimodal route to one-north", async () => {
    const p = await planJourney(request("arjun"));
    expect(p.recommended.segments.some((s) => s.line === "NEL")).toBe(true);
    expect(p.recommended.segments.at(-1)?.to).toBe("one-north");
    expect(p.recommended.blocked).toBe(false);
  });
  it("does not bypass a closed station lift by merely changing its rail line", async () => {
    const p = await planJourney(request("lim", "maintenance"));
    expect(p.recommended.blocked).toBe(false);
    expect(
      p.recommended.segments.every(
        (s) => s.to !== "Outram Park" && s.from !== "Outram Park",
      ),
    ).toBe(true);
    expect(
      p.recommended.warnings.some((w) => w.includes("not fully verified")),
    ).toBe(true);
  });
  it("routes to Civil Defence Academy using bus 172 and an approximate final access connector", async () => {
    const civilDefenceRequest = {
      ...request(),
      origin: {
        id: "bellewaters",
        name: "Bellewaters",
        subtitle: "25 Anchorvale Crescent",
        lat: 1.399854865356343,
        lon: 103.8912902982522,
      },
      destination: {
        id: "civil-defence-academy",
        name: "Civil Defence Academy",
        subtitle: "101 Jalan Bahar",
        lat: 1.367337763964952,
        lon: 103.6921041432306,
      },
    };
    const p = await planJourney(civilDefenceRequest);
    expect(
      p.recommended.segments.some((segment) => segment.line === "172"),
    ).toBe(true);
    expect(p.recommended.segments.at(-1)?.mode).toBe("walk");
    expect(p.recommended.segments.at(-1)?.instructions).toContain(
      "access connection is approximate",
    );
    const busSegment = p.recommended.segments.find(
      (segment) => segment.line === "172",
    )!;
    const withInformationalRoadSpeed = applyConditions(
      p.recommended,
      {
        ...p.conditions,
        traffic: [
          {
            id: "speed-band-fixture",
            kind: "congestion",
            severity: "high",
            description: "Road speed is 30–39 km/h",
            roadName: "Test road",
            location: busSegment.geometry[0],
            delayMinutes: 0,
            source: "LTA DataMall TrafficSpeedBands v4",
          },
        ],
      },
      civilDefenceRequest,
    );
    expect(
      withInformationalRoadSpeed.segments.find(
        (segment) => segment.line === "172",
      ),
    ).toMatchObject({ affected: false, delay: 0 });
    expect(withInformationalRoadSpeed.reasons).not.toContain(
      "Road speed is 30–39 km/h",
    );
  });
  it("uses the bundled western walking component for a searched NTU address", async () => {
    const p = await planJourney({
      ...request(),
      origin: {
        id: "local-ntu",
        name: "Nanyang Technological University",
        subtitle: "94 Nanyang Crescent",
        lat: 1.352949370203277,
        lon: 103.6892235086704,
      },
      destination: places.find((place) => place.id === "raffles-work")!,
    });

    expect(p.recommended.blocked).toBe(false);
    expect(p.recommended.segments[0].mode).toBe("walk");
    expect(
      p.recommended.segments.some((segment) => segment.line === "172"),
    ).toBe(true);
    expect(p.recommended.segments[0].geometry.length).toBeGreaterThan(2);
    expect(p.recommended.segments[0].instructions).not.toContain(
      "short access connection is approximate",
    );
  });
});

describe("condition timing", () => {
  it("advances live bus transfers chronologically and ignores stale arrivals", () => {
    const timedJourney = journey([
      segment("access", "walk", 8),
      segment("first-bus", "bus", 14, {
        line: "27",
        stops: ["64009"],
        waitMinutes: 4,
      }),
      segment("transfer", "walk", 2),
      segment("second-bus", "bus", 15, {
        line: "12",
        stops: ["75009"],
        waitMinutes: 5,
      }),
    ]);
    const result = applyBusArrivalTiming(
      timedJourney,
      [
        {
          service: "27",
          stop: "64009",
          eta: "2026-09-20T23:46:00.000Z",
          load: "low",
          wheelchair: true,
          type: "SD",
          monitored: true,
          status: "demo",
        },
        {
          service: "27",
          stop: "64009",
          eta: "2026-09-20T23:51:00.000Z",
          load: "moderate",
          wheelchair: true,
          type: "DD",
          monitored: true,
          status: "demo",
        },
        {
          service: "12",
          stop: "75009",
          eta: "2026-09-21T00:02:00.000Z",
          load: "low",
          wheelchair: true,
          type: "SD",
          monitored: true,
          status: "demo",
        },
        {
          service: "12",
          stop: "75009",
          eta: "2026-09-21T00:07:00.000Z",
          load: "moderate",
          wheelchair: true,
          type: "DD",
          monitored: true,
          status: "demo",
        },
      ],
      request().departure,
    );

    expect(result.segments[1].waitMinutes).toBe(3);
    expect(result.segments[3].waitMinutes).toBe(4);

    const stale = applyBusArrivalTiming(
      journey([
        segment("access", "walk", 8),
        segment("bus", "bus", 14, {
          line: "27",
          stops: ["64009"],
          waitMinutes: 4,
        }),
      ]),
      [
        {
          service: "27",
          stop: "64009",
          eta: "2026-09-20T23:51:00.000Z",
          load: "low",
          wheelchair: true,
          type: "SD",
          monitored: true,
          status: "stale",
        },
      ],
      request().departure,
    );
    expect(stale.segments[1]).toMatchObject({
      waitMinutes: 4,
      minutes: 14,
    });
    expect(stale.segments[1].source).toContain(
      "estimated boarding-wait fallback",
    );
  });

  it("can rerank a route after a missed first bus", () => {
    const liveRequest = {
      ...request(),
      preferences: { ...request().preferences, avoidCrowds: true },
    };
    const busJourney = {
      ...journey([
        segment("access", "walk", 8),
        segment("bus", "bus", 14, {
          line: "27",
          stops: ["64009"],
          waitMinutes: 4,
        }),
      ]),
      id: "bus-route",
    };
    const alternative = {
      ...journey([segment("walk-alternative", "walk", 22)]),
      id: "alternative-route",
    };
    const normalBuses = [
      {
        service: "27",
        stop: "64009",
        eta: "2026-09-20T23:50:00.000Z",
        load: "low" as const,
        wheelchair: true,
        type: "SD",
        monitored: true,
        status: "demo" as const,
      },
    ];
    const missedBuses = [
      {
        service: "27",
        stop: "64009",
        eta: "2026-09-20T23:46:00.000Z",
        load: "low" as const,
        wheelchair: true,
        type: "SD",
        monitored: true,
        status: "demo" as const,
      },
      {
        service: "27",
        stop: "64009",
        eta: "2026-09-20T23:51:00.000Z",
        load: "moderate" as const,
        wheelchair: true,
        type: "DD",
        monitored: true,
        status: "demo" as const,
      },
    ];
    const ranked = (buses: Conditions["buses"]) =>
      [
        applyConditions(
          applyBusArrivalTiming(busJourney, buses, liveRequest.departure),
          conditions({ buses }),
          liveRequest,
        ),
        applyConditions(alternative, conditions({ buses }), liveRequest),
      ].sort((a, b) => a.score - b.score);

    expect(ranked(normalBuses)[0].id).toBe("bus-route");
    expect(ranked(missedBuses)[0].id).toBe("alternative-route");
  });

  it("reselects a bus when an earlier condition delay makes it miss the first arrival", () => {
    const liveRequest = { ...request(), dataMode: "live" as const };
    const buses: Conditions["buses"] = [
      {
        service: "27",
        stop: "64009",
        eta: "2026-09-20T23:50:00.000Z",
        load: "low",
        wheelchair: true,
        type: "SD",
        monitored: true,
        status: "live",
      },
      {
        service: "27",
        stop: "64009",
        eta: "2026-09-20T23:55:00.000Z",
        load: "moderate",
        wheelchair: true,
        type: "DD",
        monitored: true,
        status: "live",
      },
    ];
    const base = applyBusArrivalTiming(
      journey([
        segment("rail", "rail", 8, {
          line: "EWL",
          stops: ["EW2"],
        }),
        segment("bus", "bus", 14, {
          line: "27",
          stops: ["64009"],
          waitMinutes: 4,
        }),
      ]),
      buses,
      liveRequest.departure,
    );
    expect(base.segments[1].waitMinutes).toBe(2);

    const result = applyConditions(
      base,
      conditions({
        buses,
        crowd: [
          {
            station: "EW2",
            line: "EWL",
            level: "high",
            start: "2026-09-20T23:30:00.000Z",
            end: "2026-09-21T00:30:00.000Z",
            forecast: true,
          },
        ],
      }),
      liveRequest,
    );

    expect(result.segments[0].delay).toBe(3);
    expect(result.segments[1]).toMatchObject({
      waitMinutes: 4,
      crowd: "moderate",
    });
    expect(result.segments[1].instructions).toContain("07:55");
  });

  it("selects rail crowding for the time the commuter boards the segment", () => {
    const timedJourney = journey([
      segment("access", "walk", 10),
      segment("rail", "rail", 14, {
        line: "EWL",
        stops: ["EW2"],
        waitMinutes: 4,
      }),
    ]);
    const result = applyConditions(
      timedJourney,
      conditions({
        crowd: [
          {
            station: "EW2",
            line: "EWL",
            level: "low",
            start: "2026-09-20T23:30:00.000Z",
            end: "2026-09-20T23:50:00.000Z",
            forecast: true,
          },
          {
            station: "EW2",
            line: "EWL",
            level: "high",
            start: "2026-09-20T23:50:00.000Z",
            end: "2026-09-21T00:30:00.000Z",
            forecast: true,
          },
        ],
      }),
      request(),
    );

    expect(result.segments[1]).toMatchObject({ crowd: "high", delay: 3 });
  });

  it("selects the first bus arriving after the commuter reaches the stop", () => {
    const timedJourney = journey([
      segment("access", "walk", 10),
      segment("bus", "bus", 20, {
        line: "12",
        stops: ["75009"],
        waitMinutes: 4,
      }),
    ]);
    const result = applyConditions(
      timedJourney,
      conditions({
        buses: [
          {
            service: "12",
            stop: "75009",
            eta: "2026-09-20T23:45:00.000Z",
            load: "low",
            wheelchair: true,
            type: "SD",
          },
          {
            service: "12",
            stop: "75009",
            eta: "2026-09-20T23:56:00.000Z",
            load: "high",
            wheelchair: true,
            type: "DD",
          },
        ],
      }),
      request(),
    );

    expect(result.segments[1].crowd).toBe("high");
  });

  it("applies traffic delay only when the reading is spatially relevant", () => {
    const timedJourney = journey([
      segment("bus", "bus", 20, {
        line: "12",
        stops: ["75009"],
      }),
    ]);
    const result = applyConditions(
      timedJourney,
      conditions({
        traffic: [
          {
            id: "distant-incident",
            kind: "incident",
            severity: "critical",
            description: "Incident elsewhere",
            location: [1.4, 103.95],
            delayMinutes: 12,
            source: "test",
          },
          {
            id: "nearby-incident",
            kind: "incident",
            severity: "moderate",
            description: "Incident on this route",
            location: [1.3, 103.8],
            delayMinutes: 4,
            source: "test",
          },
        ],
      }),
      request(),
    );

    expect(result.segments[0]).toMatchObject({ affected: true, delay: 4 });
    expect(result.reasons).toContain("Incident on this route");
    expect(result.reasons).not.toContain("Incident elsewhere");
  });
});
