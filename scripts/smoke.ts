import { planJourney } from "../server/planner";
import { places, profiles } from "../shared/catalog";
import type { PlanRequest, Scenario } from "../shared/types";
for (const profile of profiles) {
  for (const scenario of [
    "normal",
    "disruption",
    "maintenance",
  ] as Scenario[]) {
    const request: PlanRequest = {
      origin: places.find((p) => p.id === profile.origin)!,
      destination: places.find((p) => p.id === profile.destination)!,
      departure: "2026-09-21T07:40:00+08:00",
      arriveBy: "2026-09-21T08:45:00+08:00",
      preferences: profile.preferences,
      dataMode: "demo",
      scenario,
    };
    const start = performance.now();
    try {
      const result = await planJourney(request);
      console.log(
        JSON.stringify({
          profile: profile.id,
          scenario,
          ms: Math.round(performance.now() - start),
          original: [result.original.title, result.original.duration],
          recommended: [
            result.recommended.title,
            result.recommended.duration,
            result.recommended.blocked,
          ],
          legs: result.recommended.segments.map((s) => [
            s.mode,
            s.from,
            s.to,
            Math.round(s.distance),
            Math.ceil(s.minutes),
          ]),
          options: result.alternatives.map((j) => [j.title, j.duration]),
        }),
      );
    } catch (e) {
      console.error(profile.id, scenario, e);
    }
  }
}
