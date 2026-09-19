import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { places, profiles } from "../../shared/catalog";
import type { Journey, PlanRequest, Segment } from "../../shared/types";

const request: PlanRequest = {
  origin: places[0],
  destination: places[1],
  departure: "2026-09-21T07:40:00+08:00",
  preferences: profiles[0].preferences,
  scenario: "normal",
  dataMode: "live",
};
const base: Segment = {
  id: "walk",
  mode: "walk",
  line: "Walk",
  from: "Home",
  to: "Bus stop",
  minutes: 3,
  distance: 200,
  geometry: [
    [1.352, 103.945],
    [1.354, 103.944],
  ],
  stops: [],
  crowd: "unknown",
  affected: false,
  delay: 0,
  sheltered: false,
  accessibility: "unknown",
  instructions: "Walk to the bus stop.",
  source: "Synthetic fixture",
};
const segments: Segment[] = [
  base,
  {
    ...base,
    id: "bus",
    mode: "bus",
    line: "27",
    from: "Tampines stop",
    to: "Tampines MRT",
    direction: "Tampines",
    stops: ["76141", "76149"],
    waitMinutes: 5,
  },
  {
    ...base,
    id: "rail",
    mode: "rail",
    line: "EWL",
    from: "Tampines",
    to: "Raffles Place",
    direction: "Tuas Link",
    stops: ["EW2", "EW14"],
    waitMinutes: 4,
  },
  { ...base, id: "last-walk", from: "Raffles Place", to: "Office" },
];
const journey: Journey = {
  id: "route",
  title: "Bus and train",
  segments,
  duration: 30,
  baselineDuration: 30,
  range: [30, 35],
  arrival: "2026-09-21T08:10:00+08:00",
  distance: 4000,
  walkMinutes: 6,
  transfers: 1,
  crowd: "unknown",
  score: 0,
  reasons: [],
  warnings: [],
  source: "Synthetic fixture",
  blocked: false,
};
async function setup(page: Page) {
  await page.addInitScript((request) => {
    localStorage.setItem("wlt-onboarding-v1", "true");
    localStorage.setItem(
      "wlt-guest-v2",
      JSON.stringify({
        preferences: request.preferences,
        hardPreferences: {},
        largeText: false,
        updatedAt: request.departure,
        commutes: [
          {
            id: "test",
            label: "Test",
            request,
            hardPreferences: {},
            timeSensitive: "08:45",
            savedAt: request.departure,
          },
        ],
      }),
    );
  }, request);
  await page.route("https://www.onemap.gov.sg/**", (route) => route.abort());
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { integrations: {} } }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.route("**/api/plan", (route) =>
    route.fulfill({
      json: {
        request: route.request().postDataJSON(),
        recommended: journey,
        original: journey,
        alternatives: [],
        travelDecision: "travel",
        conditions: {
          notices: [],
          crowd: [],
          buses: [],
          traffic: [],
          feeds: [],
          weather: {
            forecast: "Clear",
            rain: false,
            walkStatus: "valid",
            cycleStatus: "valid",
          },
          mode: route.request().postDataJSON().dataMode,
          updatedAt: request.departure,
        },
        risk: {
          level: "low",
          score: 0,
          factors: [],
          model: "test",
          disclaimer: "Synthetic",
        },
        advice: "Take the bus then train.",
        generatedAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00Z",
      },
    }),
  );
}
test("shows upcoming bus and train times, refreshes only while open and handles stale/offline data", async ({
  page,
  context,
}, info) => {
  await setup(page);
  if (info.project.name === "mobile-chromium")
    await page.setViewportSize({ width: 320, height: 750 });
  let busCalls = 0;
  let stale = false;
  await page.route("**/api/buses/*", (route) => {
    busCalls++;
    const now = Date.now();
    return route.fulfill({
      json: {
        status: stale ? "stale" : "live",
        updatedAt: new Date(now).toISOString(),
        buses: [1, 5, 9].map((minutes) => ({
          service: "27",
          stop: "76141",
          eta: new Date(now + minutes * 60000).toISOString(),
          monitored: true,
          status: "live",
          load: "low",
        })),
      },
    });
  });
  let trainRequest: any;
  await page.route("**/api/train-arrivals", (route) => {
    trainRequest = route.request().postDataJSON();
    return route.fulfill({
      json: {
        status: "scheduled",
        accessedOn: "2026-09-19",
        departures: [2, 6, 10].map((minutes) => ({
          departureAt: new Date(Date.now() + minutes * 60000).toISOString(),
        })),
      },
    });
  });
  await page.clock.install();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeEnabled();
  expect(busCalls).toBe(0);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const busBoard = page.getByRole("region", { name: "Bus arrival times" });
  await expect(busBoard).toContainText("Next boarding · Tampines stop (76141)");
  await expect(busBoard.locator(".arrival-times li")).toHaveCount(3);
  await expect(busBoard).toContainText("Live bus arrivals");
  const initial = busCalls;
  await page.clock.fastForward(30000);
  await expect.poll(() => busCalls).toBeGreaterThan(initial);
  stale = true;
  await busBoard.getByRole("button", { name: "Refresh arrival times" }).click();
  await expect(busBoard).toContainText("Stale data");
  await expect(busBoard.locator(".arrival-times")).toHaveCount(0);
  await expect(busBoard).toContainText("about 5 min");
  await page.getByRole("button", { name: "I’m here" }).click();
  await expect(busBoard).toContainText("Boarding at · Tampines stop");
  await page.getByRole("button", { name: "I’m here" }).click();
  const trainBoard = page.getByRole("region", {
    name: "Train departure times",
  });
  await expect(trainBoard.locator(".arrival-times li")).toHaveCount(3);
  await expect(trainBoard).toContainText(
    "Timetable only, not live train tracking",
  );
  expect(trainRequest).toMatchObject({ line: "EWL", stops: ["EW2", "EW14"] });
  expect(trainRequest.at).toBeUndefined();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".transit-arrivals")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-train-arrivals.png`,
  });
  await context.setOffline(true);
  await expect(trainBoard).toContainText("Offline");
  await expect(trainBoard.locator(".arrival-times")).toHaveCount(0);
  await page.getByRole("button", { name: "I’m here" }).click();
  await expect(page.locator(".transit-arrivals")).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  const finalCalls = busCalls;
  await context.setOffline(false);
  await page.clock.fastForward(60000);
  expect(busCalls).toBe(finalCalls);
});

test("uses demo time for train schedules and never fetches live buses in a demo", async ({
  page,
}) => {
  await setup(page);
  let busCalls = 0;
  await page.route("**/api/buses/*", (route) => {
    busCalls++;
    return route.abort();
  });
  let queriedAt = "";
  await page.route("**/api/train-arrivals", (route) => {
    queriedAt = route.request().postDataJSON().at;
    return route.fulfill({
      json: {
        status: "scheduled",
        departures: [
          {
            departureAt: new Date(Date.parse(queriedAt) + 120000).toISOString(),
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account" })
    .click();
  await page.getByLabel("Developer mode").check();
  await page.getByRole("button", { name: "Open demo presets" }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Bus arrival times" }),
  ).toContainText("Demo clock · Simulated");
  expect(busCalls).toBe(0);
  await page.getByRole("button", { name: "I’m here" }).click();
  await page.getByRole("button", { name: "I’m here" }).click();
  const board = page.getByRole("region", { name: "Train departure times" });
  await expect(board).toContainText("Demo clock · Scheduled departures");
  await expect(board).toContainText("2 min");
  expect(queriedAt).toBe("2026-09-20T23:46:00.000Z");
  expect(busCalls).toBe(0);
});
