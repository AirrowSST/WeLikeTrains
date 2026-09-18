import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { PlanResponse } from "../../shared/types";

async function useDeterministicPlans(page: Page) {
  const templates = new Map<string, PlanResponse>();
  let latestTemplate: PlanResponse | undefined;
  await page.route("**/api/plan", async (route) => {
    const request = route.request().postDataJSON();
    const fixtureKey = request.scenario ?? "normal";
    let template = templates.get(fixtureKey);
    if (!template) {
      const response = await route.fetch({
        postData: JSON.stringify({
          ...request,
          dataMode: "demo",
        }),
      });
      if (!response.ok())
        throw new Error(
          `Fixture plan request failed: HTTP ${response.status()}`,
        );
      const fetchedTemplate = (await response.json()) as PlanResponse;
      templates.set(fixtureKey, fetchedTemplate);
      template = fetchedTemplate;
    }
    const plan = template;
    latestTemplate = plan;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...plan,
        request,
        conditions: { ...plan.conditions, mode: request.dataMode },
      }),
    });
  });
  return () => latestTemplate;
}
function startJourneyButton(page: Page) {
  return page.getByRole("button", { name: "Start", exact: true });
}
test("plans, compares, saves, interviews preferences and shows planned notices", async ({
  page,
}, info) => {
  await useDeterministicPlans(page);
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        message: "I can favour quieter routes and mapped shelter.",
        provider: "local",
        preferences: { avoidCrowds: true, sheltered: true },
      }),
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Wayce — A better way to your everyday");
  await expect(page.getByRole("link", { name: "Wayce home" })).toContainText(
    "Wayce",
  );
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        family: getComputedStyle(document.body).fontFamily,
        loaded: document.fonts.check('16px "Public Sans"'),
      };
    }),
  ).toEqual({ family: '"Public Sans", sans-serif', loaded: true });
  await expect(startJourneyButton(page)).toBeEnabled();
  await expect(page.locator(".demo-toolbar")).toContainText("Live LTA + NEA");
  await expect(
    page.getByRole("link", { name: "OpenStreetMap contributors" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const shell = await page.locator(".app-shell").boundingBox();
  expect(shell!.width).toBeLessThanOrEqual(480);
  const recommendation = await page.locator(".recommendation").boundingBox();
  const planner = await page.locator(".planner-card").boundingBox();
  expect(planner!.y).toBeLessThan(recommendation!.y);
  const navigation = await page.getByRole("navigation").boundingBox();
  expect(navigation!.y).toBeGreaterThan(page.viewportSize()!.height - 100);
  const preferencesButton = page.getByRole("button", {
    name: "Journey preferences",
    exact: true,
  });
  await expect(preferencesButton).toBeVisible();
  await expect(page.locator(".journey-preferences-button")).toHaveCount(1);
  await preferencesButton.click();
  await expect(page.getByRole("dialog")).toContainText("Preferences");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-map-source",
    "bundled-osm",
  );
  await expect(page.locator(".map-extract")).toContainText("Bundled OSM map");
  await expect(page.getByRole("link", { name: "OneMap" })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("onemap.gov.sg")),
    ),
  ).toBe(false);
  await expect(page.locator(".route-mode-marker.walk").first()).toBeVisible();
  await expect(page.locator(".route-mode-marker.rail").first()).toBeVisible();
  await expect(page.locator(".map-mode-key")).toContainText("Walk");
  await expect(page.locator(".map-mode-key")).toContainText("Train");
  await page.screenshot({
    path: `test-results/${info.project.name}-journey.png`,
    fullPage: true,
  });
  await page.getByLabel("Disruption simulator").selectOption("rain");
  await expect(page.locator(".rain-zone").first()).toBeVisible();
  await expect(page.locator(".map-mode-key")).toContainText("Rain area");
  await page.getByLabel("Disruption simulator").selectOption("normal");
  await expect(page.getByLabel("Disruption simulator")).toHaveValue("normal");
  await expect(page.locator(".map-mode-key")).not.toContainText("Rain area");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await startJourneyButton(page).click();
  await expect(page.getByRole("dialog")).toContainText("STEP 1");
  await page.getByRole("button", { name: "I’m here" }).click();
  await expect(page.getByRole("dialog")).toContainText("STEP 2");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("I avoid crowds and need sheltered walks");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Apply & re-plan" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply & re-plan" }).click();
  await expect(
    page.getByRole("button", { name: "Applied", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", {
      name: "Disruptions",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "On your radar" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("mobile interface passes automated WCAG A/AA checks", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  for (const name of ["leave time", "arrive time"] as const) {
    const trigger = page.getByRole("button", { name, exact: true });
    await expect(trigger).toHaveCount(1);
    await expect(
      trigger.locator("a[href], button, input, select, textarea"),
    ).toHaveCount(0);
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});
test("resizes the mobile journey sheet by drag and keyboard", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();

  const handle = page.getByRole("button", { name: /Resize journey panel/ });
  await expect(handle).toBeVisible();
  const map = page.locator(".map-wrap");
  const initialHeight = (await map.boundingBox())!.height;
  const handleBox = await handle.boundingBox();

  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y - 150,
    { steps: 5 },
  );
  await page.mouse.up();

  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  expect((await map.boundingBox())!.height).toBeLessThan(initialHeight - 80);

  await handle.press("End");
  await expect(handle).toHaveAttribute("data-sheet-snap", "collapsed");
  expect((await map.boundingBox())!.height).toBeGreaterThan(initialHeight + 80);
});
test("keeps the draggable phone sheet and full-width map on wide screens", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();

  const handle = page.getByRole("button", { name: /Resize journey panel/ });
  await expect(handle).toBeVisible();

  const shell = await page.locator(".app-shell").boundingBox();
  const map = await page.locator(".map-wrap").boundingBox();
  expect(shell!.width).toBeLessThanOrEqual(480);
  expect(map!.x).toBeCloseTo(shell!.x, 0);
  expect(map!.width).toBeCloseTo(shell!.width, 0);

  await handle.press("End");
  await expect(handle).toHaveAttribute("data-sheet-snap", "collapsed");
});
test("renders validated route cards when the companion displays routes", async ({
  page,
}, info) => {
  const currentPlan = await useDeterministicPlans(page);
  await page.route("**/api/chat", async (route) => {
    const plan = currentPlan();
    if (!plan) throw new Error("Fixture plan was not created.");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        message: "Here are the available routes from your current plan.",
        provider: "vertex",
        displayedRouteIds: [
          plan.recommended.id,
          ...plan.alternatives
            .filter((candidate) => !candidate.blocked)
            .slice(0, 1)
            .map((candidate) => candidate.id),
        ],
      }),
    });
  });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Show me my route options" }).click();
  const routeCards = page.locator(".chat-route-card");
  await expect(routeCards.first()).toBeVisible();
  await expect(routeCards.first()).toContainText("min");
  await expect(routeCards.first()).toContainText("Arrive");
  await expect(routeCards.first().locator(".line-pill").first()).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-chat-routes.png`,
    fullPage: true,
  });
  const results = await new AxeBuilder({ page })
    .include(".chat-route-list")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await routeCards.first().click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Selected");
});
test("shows labelled simulated location and follows manual demo progress", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page.getByRole("button", { name: "Demo mode", exact: true }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await page.getByRole("button", { name: "Use simulated location" }).click();
  await expect(page.getByLabel("FROM")).toHaveValue(
    "Simulated current location",
  );
  await expect(page.getByRole("status")).toContainText(
    "Simulated location active",
  );
  await expect(page.locator(".current-location-marker.demo")).toBeVisible();
  await expect(page.locator(".route-options")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await startJourneyButton(page).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Simulated position follows each confirmed step",
  );
  await page.getByRole("button", { name: "I’m here" }).click();
  await expect(page.getByRole("dialog")).toContainText("STEP 2");
});
test("uses browser geolocation in live mode only after explicit action", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await context.grantPermissions(["geolocation"], {
    origin: new URL(page.url()).origin,
  });
  await context.setGeolocation({ latitude: 1.3521, longitude: 103.9398 });
  await expect(startJourneyButton(page)).toBeEnabled();
  await expect(page.locator(".demo-toolbar")).toContainText("Live LTA + NEA");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByLabel("FROM")).toHaveValue("Current location");
  await expect(page.locator(".current-location-marker.device")).toBeVisible();
  await expect(page.getByText(/Device location · ±/)).toBeVisible();
  await expect(page.locator(".route-options")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await startJourneyButton(page).click();
  await page.getByRole("button", { name: "Start live location" }).click();
  await expect(page.getByRole("dialog")).toContainText("Live location on");
});
test("fits a narrow phone without horizontal overflow", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page.getByRole("button", { name: "Demo mode", exact: true }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await page.getByRole("button", { name: "Use simulated location" }).click();
  await expect(page.getByText("Simulated location active")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const button = await startJourneyButton(page).boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
});
test("supports large text and preserves a previously loaded journey offline", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page
    .getByRole("button", { name: "Open profile and preferences" })
    .click();
  await page.getByLabel("Larger, easier-to-read text").check();
  await page.getByRole("button", { name: "Apply my preferences" }).click();
  await expect(page.locator("html")).toHaveClass("large-text");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText(
      "You’re offline. Your saved map and journey are available. Conditions may have changed.",
    ),
  ).toBeVisible();
  await expect(page.locator(".map-source-note")).toContainText(
    "showing offline roads",
  );
  await expect(startJourneyButton(page)).toBeEnabled();
  await context.setOffline(false);
});
