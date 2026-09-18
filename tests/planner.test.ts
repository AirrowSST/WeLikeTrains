import { describe, it, expect } from "vitest";
import { places, profiles } from "../shared/catalog";
import { planJourney, segmentAffected } from "../server/planner";
import type { Persona, PlanRequest, Scenario } from "../shared/types";
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
describe("real OSM journeys", () => {
  it("plans Rachel door-to-door with walking legs and visible uncertainty", async () => {
    const p = await planJourney(request());
    expect(p.recommended.segments[0].mode).toBe("walk");
    expect(p.recommended.segments.at(-1)?.mode).toBe("walk");
    expect(p.recommended.segments.some((s) => s.line === "EWL")).toBe(true);
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
    const p = await planJourney({
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
    });
    expect(
      p.recommended.segments.some((segment) => segment.line === "172"),
    ).toBe(true);
    expect(p.recommended.segments.at(-1)?.mode).toBe("walk");
    expect(p.recommended.segments.at(-1)?.instructions).toContain(
      "access connection is approximate",
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
