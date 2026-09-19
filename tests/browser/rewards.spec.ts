import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { places, profiles } from "../../shared/catalog";
import type {
  Journey,
  PlanRequest,
  PlanResponse,
  Segment,
} from "../../shared/types";

const request: PlanRequest = {
  origin: places[0],
  destination: places[1],
  departure: "2026-09-21T07:40:00+08:00",
  preferences: profiles[0].preferences,
  dataMode: "live",
  scenario: "normal",
};
const walking: Segment = {
  id: "walk",
  mode: "walk",
  line: "Walk",
  from: "Tampines Central",
  to: "Raffles Place",
  minutes: 40,
  distance: 3000,
  geometry: [
    [1.3525, 103.9447],
    [1.284, 103.851],
  ],
  stops: [],
  crowd: "low",
  affected: false,
  delay: 0,
  sheltered: false,
  accessibility: "unknown",
  instructions: "Follow the mapped walking route.",
  source: "Synthetic browser fixture",
};
const quiet: Journey = {
  id: "quieter-walk",
  title: "A quieter walk",
  segments: [walking],
  duration: 40,
  baselineDuration: 40,
  range: [40, 45],
  arrival: "2026-09-21T08:20:00+08:00",
  distance: 3000,
  walkMinutes: 40,
  transfers: 0,
  crowd: "low",
  score: 0,
  reasons: [],
  warnings: [],
  source: "Synthetic browser fixture",
  blocked: false,
};
async function setup(page: Page) {
  await page.addInitScript((request) => {
    localStorage.setItem("wlt-onboarding-v1", "true");
    if (!localStorage.getItem("wlt-guest-v2"))
      localStorage.setItem(
        "wlt-guest-v2",
        JSON.stringify({
          preferences: request.preferences,
          hardPreferences: {},
          largeText: false,
          updatedAt: request.departure,
          commutes: [
            {
              id: "saved",
              label: "Morning journey",
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
  await page.route("https://cdn.fontshare.com/**", (route) => route.abort());
  await page.route("https://api.fontshare.com/**", (route) => route.abort());
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { integrations: {} } }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.route("**/api/plan", (route) => {
    const requested = route.request().postDataJSON();
    const original = {
      ...quiet,
      id: "usual",
      title: "Usual busy route",
      crowd: "high" as const,
    };
    const plan: PlanResponse = {
      request: requested,
      original,
      recommended: quiet,
      alternatives: [original],
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
        updatedAt: requested.departure,
        mode: requested.dataMode,
      },
      risk: {
        level: "low",
        score: 0,
        factors: [],
        model: "fixture",
        disclaimer: "Synthetic",
      },
      advice: "Try a quieter walk.",
      generatedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00Z",
    };
    return route.fulfill({ json: plan });
  });
}
const nav = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("button", { name, exact: true });
async function selectFirstRoute(page: Page) {
  await page.locator(".route-select").first().click();
  return page.getByRole("button", { name: /^Start / }).first();
}
async function finish(page: Page) {
  await (await selectFirstRoute(page)).click();
  await page.getByRole("button", { name: "I’m here" }).click();
}

test("previews points, credits only completion, redeems demo rewards and persists without double credit", async ({
  page,
}, info) => {
  await setup(page);
  if (info.project.name === "mobile-chromium")
    await page.setViewportSize({ width: 320, height: 750 });
  await page.goto("/");
  await expect(page.locator(".route-card").first()).toContainText(
    "50 points on completion",
  );
  await expect(page.locator(".points-counter")).toContainText("0");
  await expect(nav(page, "Preferences")).toHaveCount(0);
  await nav(page, "Account").click();
  await page
    .getByRole("button", { name: /Preferences Travel choices/ })
    .click();
  await page.getByLabel("Maximum walk (m)").fill("2500");
  await page.getByRole("button", { name: "Apply my preferences" }).click();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await nav(page, "Journey").click();
  await (await selectFirstRoute(page)).click();
  await expect(page.locator(".points-counter")).toContainText("0");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".points-counter")).toContainText("0");
  await finish(page);
  await expect(page.locator(".journey-points-earned")).toContainText(
    "+50 points earned",
  );
  await page.getByRole("button", { name: "View rewards", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Points balance" }),
  ).toContainText("50");
  expect(
    (await page.locator(".app-shell").boundingBox())!.width,
  ).toBeLessThanOrEqual(480);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-rewards.png`,
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .include(".rewards-page")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Redeem a coffee on the way" })
    .click();
  await page.getByRole("button", { name: "Confirm demo redemption" }).click();
  await expect(page.locator(".points-counter")).toContainText("0");
  await expect(page.getByRole("region", { name: "My rewards" })).toContainText(
    "A coffee on the way",
  );
  await expect(
    page.getByRole("button", { name: "50 more points to go" }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Start / })).toHaveCount(0);
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await finish(page);
  await expect(page.locator(".journey-points-earned")).toContainText(
    "No new points",
  );
  await page.getByRole("button", { name: "View rewards", exact: true }).click();
  await expect(page.getByRole("region", { name: "My rewards" })).toContainText(
    "A coffee on the way",
  );
  await expect(page.locator(".points-counter")).toContainText("0");
});

test("demo points stay isolated and guest balance is restored on exit", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await finish(page);
  await page.getByRole("button", { name: "View rewards", exact: true }).click();
  await nav(page, "Account").click();
  await page.getByLabel("Developer mode").check();
  await page.getByRole("button", { name: "Open demo presets" }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await nav(page, "Journey").click();
  await expect(page.locator(".points-counter")).toHaveText("0demo pts");
  await finish(page);
  await expect(page.locator(".journey-points-earned")).toContainText(
    "+50 demo points earned",
  );
  await page.getByRole("button", { name: "View rewards", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Points balance" }),
  ).toContainText("discarded");
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.locator(".points-counter")).toHaveText("50pts");
  const guestWallet = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wlt-points-v1:guest")!),
  );
  expect(guestWallet.entries).toHaveLength(1);
});

test("signed-in points stay separate from the guest wallet and survive session restoration", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await finish(page);
  await page.getByRole("button", { name: "View rewards", exact: true }).click();
  await page.route("**/api/auth/session", async (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: { name: "Rewards tester", email: "rewards@example.test" },
        state: {
          preferences: request.preferences,
          hardPreferences: {},
          largeText: false,
          updatedAt: request.departure,
          commutes: [
            {
              id: "saved",
              label: "Morning journey",
              request,
              hardPreferences: {},
              timeSensitive: "08:45",
              savedAt: request.departure,
            },
          ],
        },
      },
    }),
  );
  await page.reload();
  await nav(page, "Account").click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".points-counter")).toHaveText("0pts");
  await nav(page, "Journey").click();
  await finish(page);
  await page.getByRole("button", { name: "View rewards", exact: true }).click();
  await page
    .getByRole("button", { name: "Redeem a coffee on the way" })
    .click();
  await page.getByRole("button", { name: "Confirm demo redemption" }).click();
  await page.reload();
  await nav(page, "Account").click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await nav(page, "Rewards").click();
  await expect(page.getByRole("region", { name: "My rewards" })).toContainText(
    "A coffee on the way",
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await nav(page, "Account").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".points-counter")).toHaveText("50pts");
  await nav(page, "Rewards").click();
  await expect(page.getByRole("region", { name: "My rewards" })).toContainText(
    "Your redeemed demo rewards will live here.",
  );
});
