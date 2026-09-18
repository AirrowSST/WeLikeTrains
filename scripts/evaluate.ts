import { writeFile } from "node:fs/promises";
import { planJourney } from "../server/planner";
import { extractPreferences, localChat } from "../server/providers";
import { places, profiles } from "../shared/catalog";
import type {
  Persona,
  PlanRequest,
  Scenario,
  Preferences,
} from "../shared/types";

const cases: { persona: Persona; scenario: Scenario }[] = [
  { persona: "rachel", scenario: "normal" },
  { persona: "rachel", scenario: "disruption" },
  { persona: "rachel", scenario: "closure" },
  { persona: "rachel", scenario: "rain" },
  { persona: "rachel", scenario: "crowded" },
  { persona: "arjun", scenario: "normal" },
  { persona: "arjun", scenario: "rain" },
  { persona: "lim", scenario: "normal" },
  { persona: "lim", scenario: "maintenance" },
];
const url = process.argv.find((arg) => arg.startsWith("--url="))?.slice(6);
const output = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
const results: Record<string, unknown>[] = [];
let failures = 0;
for (const fixture of cases) {
  const profile = profiles.find((p) => p.id === fixture.persona)!;
  const request: PlanRequest = {
    origin: places.find((p) => p.id === profile.origin)!,
    destination: places.find((p) => p.id === profile.destination)!,
    departure: `2026-09-21T${profile.departure}:00+08:00`,
    arriveBy: `2026-09-21T${profile.arriveBy}:00+08:00`,
    preferences: profile.preferences,
    scenario: fixture.scenario,
    dataMode: "demo",
  };
  const start = performance.now();
  const plan = await planJourney(request);
  const message =
    "Explain which route I should take and the uncertainty. Is the risk a probability?";
  const response = url
    ? await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, request, cloudConsent: true }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Chat HTTP ${r.status}`);
        return r.json();
      })
    : localChat(message, plan);
  const routes = [plan.recommended, ...plan.alternatives];
  const checks = {
    demoLabel: plan.conditions.mode === "demo",
    firstAndLastAccessLeg:
      ["walk", "cycle"].includes(plan.recommended.segments[0].mode) &&
      plan.recommended.segments.at(-1)?.mode === "walk",
    geometry: plan.recommended.segments.every((s) => s.geometry.length >= 2),
    usableRoute: !plan.recommended.blocked,
    uncertaintyShown: plan.recommended.range[1] > plan.recommended.duration,
    riskNotProbability: plan.risk.disclaimer.includes(
      "not a disruption probability",
    ),
    groundedRouteId:
      !response.recommendedRouteId ||
      routes.some((r) => r.id === response.recommendedRouteId && !r.blocked),
    boundedResponse:
      typeof response.message === "string" &&
      response.message.length > 0 &&
      response.message.length <= 1800,
    ...(url ? { cloudModelActuallyUsed: response.provider === "vertex" } : {}),
  };
  failures += Object.values(checks).filter((v) => !v).length;
  results.push({
    ...fixture,
    elapsedMs: Math.round(performance.now() - start),
    recommended: plan.recommended.title,
    duration: plan.recommended.duration,
    originalDuration: plan.original.duration,
    crowd: plan.recommended.crowd,
    provider: response.provider,
    checks,
    ...(url ? { response: response.message } : {}),
  });
}
const preferenceCases: [string, Partial<Preferences>][] = [
  ["I need step-free access", { stepFree: true }],
  [
    "I avoid crowds and need sheltered walks",
    { avoidCrowds: true, sheltered: true },
  ],
  ["I like cycling", { cycling: true }],
  ["I cannot cycle", { cycling: false }],
  ["Stairs are fine", { stepFree: false }],
  ["I don't mind crowds", { avoidCrowds: false }],
];
for (const [message, expected] of preferenceCases) {
  const actual = extractPreferences(message);
  const pass = Object.entries(expected).every(
    ([key, value]) => actual[key as keyof Preferences] === value,
  );
  if (!pass) failures++;
  results.push({ message, expected, actual, pass });
}
const report = {
  generatedAt: new Date().toISOString(),
  mode: url
    ? "hosted Vertex AI + deterministic routing"
    : "no-cost local fallback + deterministic routing",
  limitations:
    "Synthetic labelled fixtures, not historical ground truth. Structural checks are not an accuracy or safety claim. Review recorded cloud answers manually; no real-phone validation is implied.",
  failures,
  results,
};
if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (failures) process.exitCode = 1;
