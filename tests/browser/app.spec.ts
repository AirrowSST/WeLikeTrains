import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AccountState, PlanResponse } from "../../shared/types";
import { places, profiles } from "../../shared/catalog";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function useDeterministicPlans(
  page: Page,
  loadOneMap = false,
  seedSavedRoute = true,
  showOnboarding = false,
) {
  if (!showOnboarding) {
    await page.addInitScript(() => {
      localStorage.setItem("wlt-onboarding-v1", "true");
    });
  }
  if (seedSavedRoute) {
    const departure = "2026-09-21T07:40:00+08:00";
    const request = {
      origin: places[0],
      destination: places[1],
      departure,
      arriveBy: "2026-09-21T08:45:00+08:00",
      preferences: profiles[0].preferences,
      scenario: "normal" as const,
      dataMode: "live" as const,
    };
    await page.addInitScript((seededRequest) => {
      if (localStorage.getItem("wlt-guest-v2")) return;
      localStorage.setItem(
        "wlt-guest-v2",
        JSON.stringify({
          preferences: seededRequest.preferences,
          hardPreferences: {},
          commutes: [
            {
              id: "seeded-route",
              label: "Tampines Central to Raffles Place",
              request: seededRequest,
              hardPreferences: {},
              timeSensitive: "08:45",
              savedAt: seededRequest.departure,
            },
          ],
          largeText: false,
          updatedAt: seededRequest.departure,
        }),
      );
    }, request);
  }
  await page.route("https://www.onemap.gov.sg/maps/tiles/**", async (route) => {
    if (!loadOneMap) {
      await route.abort();
      return;
    }
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  const templates = new Map<string, Promise<PlanResponse>>();
  let latestTemplate: PlanResponse | undefined;
  await page.route("**/api/plan", async (route) => {
    const request = route.request().postDataJSON();
    const fixtureKey = request.scenario ?? "normal";
    let template = templates.get(fixtureKey);
    if (!template) {
      template = (async () => {
        const response = await page.request.post(route.request().url(), {
          data: {
            ...request,
            origin:
              request.origin?.id === "device-current-location"
                ? places[0]
                : request.origin,
            departure: "2026-09-21T07:40:00+08:00",
            arriveBy: request.arriveBy
              ? "2026-09-21T08:45:00+08:00"
              : undefined,
            dataMode: "demo",
          },
        });
        if (!response.ok())
          throw new Error(
            `Fixture plan request failed: HTTP ${response.status()}`,
          );
        return (await response.json()) as PlanResponse;
      })();
      templates.set(fixtureKey, template);
    }
    const plan = await template;
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
async function openDeveloperDemos(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await page.getByLabel("Developer mode").check();
  await page.getByRole("button", { name: "Open demo presets" }).click();
}
test("lets a fresh guest save or skip onboarding preferences", async ({
  page,
}) => {
  await useDeterministicPlans(page, false, false, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const onboarding = page.getByRole("dialog", { name: "Welcome to Wayce" });
  await expect(onboarding).toBeVisible();
  await expect(onboarding).toContainText(
    "Nothing here is required—you can skip this",
  );
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(
    onboarding.getByRole("button", { name: "Skip for now" }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole("button", { name: "Save preferences" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const onboardingAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(onboardingAccessibility.violations).toEqual([]);
  await onboarding.getByRole("checkbox", { name: /Avoid stairs/ }).check();
  await onboarding.getByLabel("Maximum walk").fill("900");
  await onboarding
    .getByLabel("Alert me when a delay adds")
    .fill("6");
  await onboarding
    .getByRole("checkbox", { name: /Larger, easier-to-read text/ })
    .check();
  await onboarding.getByRole("button", { name: "Save preferences" }).click();

  await expect(onboarding).toBeHidden();
  await expect(page.locator("html")).toHaveClass(/large-text/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("wlt-guest-v2") ?? "{}");
        return {
          onboarding: JSON.parse(
            localStorage.getItem("wlt-onboarding-v1") ?? "false",
          ),
          stepFree: state.preferences?.stepFree,
          walkingSpeed: state.preferences?.walkingSpeed,
          maxWalk: state.preferences?.maxWalk,
          alertThreshold: state.preferences?.alertThreshold,
        };
      }),
    )
    .toEqual({
      onboarding: true,
      stepFree: true,
      walkingSpeed: 40,
      maxWalk: 900,
      alertThreshold: 6,
    });
  await page.reload();
  await expect(onboarding).toHaveCount(0);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const freshOnboarding = page.getByRole("dialog", {
    name: "Welcome to Wayce",
  });
  await expect(freshOnboarding).toBeVisible();
  await freshOnboarding.getByRole("button", { name: "Skip for now" }).click();
  await expect(freshOnboarding).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        onboarding: JSON.parse(
          localStorage.getItem("wlt-onboarding-v1") ?? "false",
        ),
        guestCreated: localStorage.getItem("wlt-guest-v2") !== null,
      })),
    )
    .toEqual({ onboarding: true, guestCreated: true });
});
test("plans, compares, saves, interviews preferences and shows planned notices", async ({
  page,
}, info) => {
  let basemapRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/data/basemap.json")) basemapRequests += 1;
  });
  await useDeterministicPlans(page, true);
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
  const startButtonBox = await startJourneyButton(page).boundingBox();
  const directionsBox = await page
    .getByRole("heading", { name: "Directions" })
    .boundingBox();
  expect(startButtonBox!.y).toBeLessThan(directionsBox!.y);
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
  const journeyNavItem = page
    .getByRole("navigation")
    .getByRole("button", { name: "My journey", exact: true });
  await expect(journeyNavItem).toHaveClass(/journey-nav-item/);
  const journeyNavBox = await journeyNavItem.boundingBox();
  expect(
    Math.abs(
      journeyNavBox!.x + journeyNavBox!.width / 2 -
        (navigation!.x + navigation!.width / 2),
    ),
  ).toBeLessThan(4);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Preferences", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".bottom-controls")).toHaveCount(0);
  const notificationsButton = page.getByRole("button", {
    name: "View disruption alerts",
  });
  const recenterButton = page.getByRole("button", { name: "Recenter map" });
  await expect(notificationsButton).toBeVisible();
  await expect(recenterButton).toBeVisible();
  await expect(page.locator(".leaflet-control-zoom")).toHaveCount(0);
  expect(
    await notificationsButton.evaluate(
      (button) => button.closest(".map-controls") !== null,
    ),
  ).toBe(true);
  const notificationsBox = await notificationsButton.boundingBox();
  const recenterBox = await recenterButton.boundingBox();
  expect(recenterBox!.y).toBeGreaterThan(notificationsBox!.y);
  expect(notificationsBox!.width).toBe(notificationsBox!.height);
  expect(recenterBox!.width).toBe(recenterBox!.height);
  const preferencesButton = page.getByRole("button", {
    name: "Journey preferences",
    exact: true,
  });
  await expect(preferencesButton).toBeVisible();
  await expect(page.locator(".journey-preferences-button")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Swap origin and destination" }),
  ).toHaveCount(0);
  await expect(page.locator(".planner-card .field-marker")).toHaveCount(0);
  await expect(page.locator(".planner-card .time-sequence-arrow")).toHaveCount(
    0,
  );
  await expect(page.locator(".planner-card .location-button svg")).toHaveCount(
    0,
  );
  await expect(page.locator(".planner-card .section-title svg")).toHaveCount(0);
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  await page.getByRole("button", { name: "leave time" }).click();
  const timeDialog = page.getByRole("dialog", {
    name: "Choose leave time",
  });
  await expect(timeDialog).toBeVisible();
  await expect(
    timeDialog.getByRole("button", { name: "Add one hour" }),
  ).toBeVisible();
  await expect(
    timeDialog.getByRole("button", { name: "Add five minutes" }),
  ).toBeVisible();
  await timeDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(timeDialog).toBeHidden();
  await expect(page.locator(".planner-card .plan-button svg")).toHaveCount(0);
  await expect(page.getByText("Leave", { exact: true })).toBeVisible();
  await expect(page.getByText("Arrive", { exact: true })).toBeVisible();
  await preferencesButton.click();
  const preferencesPage = page.getByRole("main", { name: "Preferences" });
  await expect(preferencesPage).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Preferences" })).toHaveCount(
    0,
  );
  await expect(preferencesPage).not.toHaveCSS("border-radius", "17px");
  const preferencesBounds = await preferencesPage.boundingBox();
  const shellBounds = await page.locator(".app-shell").boundingBox();
  expect(preferencesBounds!.x).toBeCloseTo(shellBounds!.x, 0);
  expect(preferencesBounds!.width).toBeCloseTo(shellBounds!.width, 0);
  expect(preferencesBounds!.height).toBeGreaterThan(
    page.viewportSize()!.height - 100,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "My journey", exact: true })
    .click();
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-map-source",
    "onemap",
  );
  await expect(page.locator(".map-extract")).toContainText("OneMap · online");
  await expect(page.locator(".local-map-feature")).toHaveCount(0);
  await expect(page.locator(".leaflet-local-basemap-pane canvas")).toHaveCount(
    0,
  );
  expect(basemapRequests).toBe(0);
  await expect(page.getByRole("link", { name: "OneMap" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("onemap.gov.sg")),
    ),
  ).toBe(true);
  await expect(page.locator(".route-mode-marker.walk").first()).toBeVisible();
  await expect(page.locator(".route-mode-marker.rail").first()).toBeVisible();
  await expect(page.locator(".map-mode-key")).toContainText("Walk");
  await expect(page.locator(".map-mode-key")).toContainText("Train");
  await page.screenshot({
    path: `test-results/${info.project.name}-journey.png`,
    fullPage: true,
  });
  await expect(page.getByLabel("Demo test controls")).toHaveCount(0);
  await openDeveloperDemos(page);
  await page.getByLabel("Demo weather").selectOption("storm");
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.locator(".rain-zone").first()).toBeVisible();
  await expect(page.locator(".map-mode-key")).toContainText("Rain area");
  await page.getByRole("button", { name: "Exit demo" }).click();
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
  await page
    .getByRole("checkbox", {
      name: "I agree to this companion and voice data use.",
    })
    .click();
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
test("opens local MRT and bus-stop details from map icons", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page, true);
  await page.goto("/");
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-ready",
    "true",
  );

  const railStop = page.locator(".transit-stop-marker.rail").first();
  await expect(railStop).toBeVisible();
  await expect(railStop).toHaveAttribute("aria-label", /MRT \/ LRT station/);
  await railStop.click();
  await expect(page.locator(".transit-stop-popup")).toContainText(
    "MRT / LRT station",
  );

  const mapBox = await page.locator(".journey-map").boundingBox();
  const mapCenter = {
    x: Math.round(mapBox!.x + mapBox!.width / 2),
    y: Math.round(mapBox!.y + Math.min(mapBox!.height / 2, 180)),
  };
  if (
    await page.evaluate(() =>
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    )
  ) {
    await page.mouse.move(mapCenter.x, mapCenter.y);
    await page.mouse.wheel(0, -700);
  } else {
    const cdp = await context.newCDPSession(page);
    for (
      let zoom = 0;
      zoom < 4 && (await page.locator(".transit-stop-marker.bus").count()) === 0;
      zoom++
    ) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: mapCenter.x - 20, y: mapCenter.y, id: 1 },
          { x: mapCenter.x + 20, y: mapCenter.y, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: mapCenter.x - 55, y: mapCenter.y, id: 1 },
          { x: mapCenter.x + 55, y: mapCenter.y, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForTimeout(250);
    }
  }
  const busStop = page.locator(".transit-stop-marker.bus").first();
  await expect(busStop).toBeVisible();
  await expect(busStop).toHaveAttribute("aria-label", /bus stop/);
  await busStop.click();
  await expect(page.locator(".transit-stop-popup")).toContainText("Bus stop");
});

test("keeps Routes and Disruptions content inside the phone gutter", async ({
  page,
}) => {
  await useDeterministicPlans(page, true);
  await page.goto("/");

  for (const tab of ["Routes", "Disruptions"] as const) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    const shell = await page.locator(".app-shell").boundingBox();
    const toolbar = await page.locator(".demo-toolbar").boundingBox();
    const footer = await page.locator(".site-footer").boundingBox();

    for (const section of [toolbar, footer]) {
      expect(section!.x - shell!.x).toBeGreaterThanOrEqual(15);
      expect(
        shell!.x + shell!.width - (section!.x + section!.width),
      ).toBeGreaterThanOrEqual(15);
    }
  }
});
test("compares original, affected and revised routes with complete crowd labels", async ({
  page,
}) => {
  const currentPlan = await useDeterministicPlans(page, true);
  await page.goto("/");
  await openDeveloperDemos(page);
  await page.getByLabel("Network condition").selectOption("disruption");
  await page.getByLabel("Demo weather").selectOption("clear");
  await page.getByRole("button", { name: "Start demo" }).click();

  await expect
    .poll(() => page.locator(".route-original").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".route-original-affected").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".route-revised").count())
    .toBeGreaterThan(0);
  await expect(page.locator(".map-comparison-marker")).toContainText(
    "Affected original",
  );
  await expect(page.locator(".map-legend")).toContainText("Original route");
  await expect(page.locator(".map-legend")).toContainText("Affected original");
  await expect(page.locator(".map-legend")).toContainText("Revised route");

  const routeCards = page.locator(".route-card");
  await expect(routeCards.first().locator(".crowd-badge")).toContainText(
    /crowd/i,
  );
  await expect(page.locator(".crowd-badge")).toHaveCount(
    await routeCards.count(),
  );
  await expect(page.locator(".recommendation p")).toHaveText(
    currentPlan()!.advice,
  );
});
test("tells the commuter to wait when heavy weather blocks every route", async ({
  page,
}) => {
  await useDeterministicPlans(page, true);
  await page.goto("/");
  await openDeveloperDemos(page);
  await page.getByLabel("Network condition").selectOption("rain");
  await page.getByLabel("Demo weather").selectOption("storm");
  await page.getByRole("button", { name: "Start demo" }).click();

  await expect(page.locator(".recommendation")).toContainText(
    "Route unavailable",
  );
  await expect(page.locator(".recommendation")).toContainText(
    "Wait for the heavy weather to pass",
  );
  await expect(page.locator(".route-card").first()).toContainText(
    "WAIT FOR SAFER CONDITIONS",
  );
  await expect(startJourneyButton(page)).toBeDisabled();
});
test("mobile interface passes automated WCAG A/AA checks", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await expect(page.locator(".route-options")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
  ).toBeEnabled();
  await page.waitForLoadState("networkidle");
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
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  const accountPage = page.getByRole("main", { name: "Account" });
  await expect(accountPage).toBeVisible();
  await expect(
    accountPage.getByLabel("Larger, easier-to-read text"),
  ).toHaveCount(0);
  await expect(
    accountPage.getByRole("button", { name: "Help & app guide" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Account" })).toHaveCount(0);
  const optionsResults = await new AxeBuilder({ page })
    .include(".nav-page")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    optionsResults.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});
test("bell shows only service-disruption alerts", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await openDeveloperDemos(page);
  await page.getByLabel("Network condition").selectOption("disruption");
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(startJourneyButton(page)).toBeEnabled();

  await page.getByRole("button", { name: "View disruption alerts" }).click();
  const dialog = page.getByRole("dialog", { name: "Service disruptions" });
  await expect(dialog).toContainText("Signalling fault on the East West Line");
  await expect(dialog).toContainText("DISRUPTION");
  await expect(dialog).not.toContainText("Know what you’re looking at.");
  await expect(dialog).not.toContainText("Heavy rain along your journey");
});
test("moves the visible journey pane after the page has been scrolled", async ({ page, context }) => {
  await useDeterministicPlans(page, false, false);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  for (const input of ["mouse", "touch"] as const) {
    await page.goto("/");
    const handle = page.locator(".sheet-drag-handle");
    await expect(handle).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 180));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(180);
    const start = (await handle.boundingBox())!;
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    if (input === "mouse") {
      await page.mouse.move(x, y);
      await page.mouse.down();
    } else {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    }
    for (const delta of [-40, -80, -120]) {
      if (input === "mouse") await page.mouse.move(x, y + delta);
      else await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + delta, id: 1 }] });
      // Assert the actual grip's screen position, not just the map height or state.
      await expect.poll(async () => Math.abs((await handle.boundingBox())!.y - (start.y + delta))).toBeLessThan(2);
      expect(await page.evaluate(() => window.scrollY)).toBe(180);
    }
    if (input === "mouse") await page.mouse.up();
    else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  }
});

test("resizes the mobile journey sheet by drag and keyboard", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => {
      throw new DOMException("Pointer capture unavailable", "NotSupportedError");
    };
  });
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();

  const handle = page.getByRole("button", { name: /Resize journey panel/ });
  await expect(handle).toBeVisible();
  const map = page.locator(".map-wrap");
  const initialHeight = (await map.boundingBox())!.height;
  const dragSurface = page.locator(".planner-card .sheet-drag-surface");
  const dragSurfaceBox = await dragSurface.boundingBox();
  const dragX = dragSurfaceBox!.x + dragSurfaceBox!.width / 3;
  const dragStartY = dragSurfaceBox!.y + dragSurfaceBox!.height / 2;

  const handleBox = await handle.boundingBox();
  const touchX = handleBox!.x + handleBox!.width / 2;
  const touchStartY = handleBox!.y + handleBox!.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchX, y: touchStartY, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchX, y: touchStartY - 96, id: 1 }],
  });
  await expect
    .poll(async () => (await map.boundingBox())!.height)
    .toBeCloseTo(initialHeight - 96, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await handle.press("ArrowDown");
  await expect(handle).toHaveAttribute("data-sheet-snap", "middle");
  await expect
    .poll(async () => (await map.boundingBox())!.height)
    .toBeCloseTo(initialHeight, 0);

  await page.mouse.move(dragX, dragStartY);
  await page.mouse.down();
  for (const delta of [-60, -120, -180]) {
    await page.mouse.move(dragX, dragStartY + delta);
    await expect(page.locator(".journey-layout")).toHaveClass(
      /sheet-dragging/,
    );
    await expect
      .poll(async () => (await map.boundingBox())!.height)
      .toBeCloseTo(initialHeight + delta, 0);
  }
  await page.mouse.move(dragX, dragStartY - 420, { steps: 5 });
  await page.mouse.up();

  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await expect
    .poll(async () => (await map.boundingBox())!.height)
    .toBeLessThanOrEqual(30);
  await expect
    .poll(async () => (await page.locator(".planner-card").boundingBox())!.y)
    .toBeLessThan(75);
  const showMap = page.getByRole("button", {
    name: "Show map and collapse journey panel",
  });
  await expect(showMap).toBeVisible();
  await showMap.click();

  await expect(handle).toHaveAttribute("data-sheet-snap", "collapsed");
  await expect
    .poll(async () => (await map.boundingBox())!.height)
    .toBeGreaterThan(initialHeight + 80);
  expect(
    (await page.locator(".planner-card").boundingBox())!.height,
  ).toBeLessThan(70);
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
  ).toBeHidden();

  await handle.press("Home");
  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await map.boundingBox())!.height)
    .toBeLessThanOrEqual(30);

  const expandedDragSurfaceBox = await dragSurface.boundingBox();
  await page.mouse.move(
    expandedDragSurfaceBox!.x + expandedDragSurfaceBox!.width / 3,
    expandedDragSurfaceBox!.y + expandedDragSurfaceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    expandedDragSurfaceBox!.x + expandedDragSurfaceBox!.width / 3,
    expandedDragSurfaceBox!.y + 450,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(handle).toHaveAttribute("data-sheet-snap", "middle");
  await expect
    .poll(async () => (await map.boundingBox())!.height)
    .toBeGreaterThan(300);

  await page.setViewportSize({ width: 320, height: 700 });
  await handle.press("Home");
  await expect(showMap).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
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
  expect(
    (await page.locator(".planner-card").boundingBox())!.height,
  ).toBeLessThan(70);
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
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I agree to this companion and voice data use.",
    })
    .click();
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
test("keeps unfinished guest route context out of companion requests", async ({
  page,
}) => {
  await useDeterministicPlans(page, false, false);
  await page.setViewportSize({ width: 320, height: 700 });
  let chatRequest: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    chatRequest = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        message: "I can still help before you choose a destination.",
        provider: "local",
      }),
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I agree to this companion and voice data use.",
    })
    .click();
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("What can you help me with?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(
    page.getByText("I can still help before you choose a destination."),
  ).toBeVisible();
  expect(chatRequest).toMatchObject({
    message: "What can you help me with?",
    cloudConsent: true,
  });
  expect(chatRequest).not.toHaveProperty("request");
});
test("shows the companion service error when a request is rejected", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Too many messages. Please wait a minute and try again.",
      }),
    });
  });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I agree to this companion and voice data use.",
    })
    .click();
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("What changed?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(
    page.getByText(
      "The companion could not respond: Too many messages. Please wait a minute and try again. Your route and journey steps are still available.",
    ),
  ).toBeVisible();
});
test("shows companion data agreement once and lets Preferences revoke it", async ({
  page,
}, info) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();

  const agreement = page.locator(".chat-consent-overlay");
  await expect(agreement).toBeVisible();
  await expect(
    agreement.getByRole("heading", { name: "Before you chat or use voice" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page })
    .include(".chat-consent-overlay")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-companion-consent.png`,
    fullPage: true,
  });

  await agreement
    .getByRole("checkbox", {
      name: "I agree to this companion and voice data use.",
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wlt-companion-consent-v1") ?? "false"),
    ),
  ).toBe(true);
  await expect(page.locator(".chat-bottom .chat-consent")).toHaveCount(0);

  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(startJourneyButton(page)).toBeEnabled();
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await expect(agreement).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Preferences", exact: true })
    .click();
  const setting = page.getByRole("checkbox", {
    name: "Companion data sharing",
  });
  await expect(setting).toBeChecked();
  await setting.uncheck();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "My journey", exact: true })
    .click();
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await expect(agreement).toBeVisible();
});
test("transcribes voice input into a reviewable chat draft", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onstart: (() => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onstart?.();
        this.onresult?.({
          resultIndex: 0,
          results: [
            {
              0: { transcript: "Show me quieter route options" },
              isFinal: true,
              length: 1,
            },
          ],
        });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
  });
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "A little help for the journey" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I agree to this companion and voice data use.",
    })
    .click();
  await page.getByRole("button", { name: "Start voice input" }).click();

  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toHaveValue("Show me quieter route options");
  await expect(
    page.getByText("Voice draft ready", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".chat-message.user")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .include(".chat-input")
    .include("#voice-input-note")
    .include(".chat-bottom > .privacy-note")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});
test("shows labelled simulated location and follows manual demo progress", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await openDeveloperDemos(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.getByLabel("FROM")).toHaveValue(
    "Simulated current location",
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
test("keeps faux demo accounts isolated and restores the guest space", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  await openDeveloperDemos(page);
  await page.getByRole("button", { name: /Mdm Lim/ }).click();
  await page.getByLabel("Demo weather").selectOption("heat");
  await page.getByRole("button", { name: "Start demo" }).click();

  await expect(page.locator("html")).toHaveClass(
    /(?:^|\s)large-text(?:\s|$)/,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  const demoAccountPage = page.getByRole("main", { name: "Account" });
  await expect(demoAccountPage).toContainText(
    "Mdm Lim · Faux account",
  );
  await expect(demoAccountPage).toContainText("never synced");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "My journey", exact: true })
    .click();

  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.locator("html")).not.toHaveClass(
    /(?:^|\s)large-text(?:\s|$)/,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await expect(page.getByRole("main", { name: "Account" })).toContainText(
    "Guest",
  );
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await expect(page.getByText("SAVED IN GUEST SPACE").first()).toBeVisible();
});
test("preserves the guest snapshot timestamp during Google sign-in", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  const guestPreferences = { ...profiles[0].preferences, maxWalk: 2200 };
  const guestUpdatedAt = "2026-09-18T08:00:00.000Z";
  const request = {
    origin: places[0],
    destination: places[1],
    departure: "2026-09-21T07:40:00+08:00",
    arriveBy: "2026-09-21T08:45:00+08:00",
    preferences: guestPreferences,
    scenario: "normal" as const,
    dataMode: "live" as const,
  };
  const guestState: AccountState = {
    preferences: guestPreferences,
    hardPreferences: { maxWalk: 2200 },
    commutes: [
      {
        id: "guest-commute",
        label: "Guest commute",
        request,
        hardPreferences: { maxWalk: 2200 },
        timeSensitive: "08:45",
        savedAt: guestUpdatedAt,
      },
    ],
    largeText: false,
    updatedAt: guestUpdatedAt,
  };
  const accountPreferences = { ...profiles[0].preferences, maxWalk: 900 };
  const accountState: AccountState = {
    ...guestState,
    preferences: accountPreferences,
    hardPreferences: { maxWalk: 900 },
    commutes: [],
    updatedAt: "2026-09-19T08:00:00.000Z",
  };
  let submittedGuestState: AccountState | undefined;

  await page.addInitScript((state) => {
    localStorage.setItem("wlt-guest-v2", JSON.stringify(state));
    const browserWindow = window as typeof window & {
      google?: {
        accounts: {
          id: {
            initialize(options: {
              callback: (response: { credential: string }) => void;
            }): void;
            renderButton(parent: HTMLElement): void;
            disableAutoSelect(): void;
          };
        };
      };
      googleCredentialCallback?: (response: { credential: string }) => void;
    };
    browserWindow.google = {
      accounts: {
        id: {
          initialize: ({ callback }) => {
            browserWindow.googleCredentialCallback = callback;
          },
          renderButton: (parent) => {
            const button = document.createElement("button");
            button.textContent = "Continue with Google";
            button.addEventListener("click", () =>
              browserWindow.googleCredentialCallback?.({
                credential: "c".repeat(120),
              }),
            );
            parent.append(button);
          },
          disableAutoSelect: () => {},
        },
      },
    };
  }, guestState);
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        integrations: {
          googleAccounts: true,
          push: false,
          tts: false,
          vertex: false,
        },
        googleClientId: "123-test.apps.googleusercontent.com",
      }),
    });
  });
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    });
  });
  await page.route("**/api/auth/google", async (route) => {
    submittedGuestState = route.request().postDataJSON().guestState;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: { name: "Test commuter", email: "commuter@example.test" },
        state: accountState,
      }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect.poll(() => submittedGuestState?.updatedAt).toBe(guestUpdatedAt);
});
test("starts with automatic location, a Where to prompt, and leave now", async ({
  page,
  context,
  baseURL,
}) => {
  await useDeterministicPlans(page, false, false);
  await context.grantPermissions(["geolocation"], {
    origin: new URL(baseURL!).origin,
  });
  await context.setGeolocation({ latitude: 1.3521, longitude: 103.9398 });
  const locationPlan = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/plan")) return false;
    return (
      response.request().postDataJSON()?.origin?.id ===
      "device-current-location"
    );
  });
  await page.goto("/");
  await expect(page.getByLabel("FROM")).toHaveValue("Current location");
  await expect(page.getByLabel("TO")).toHaveAttribute(
    "placeholder",
    "Where to?",
  );
  await expect(page.getByLabel("TO")).toHaveValue("");
  await expect(page.getByRole("button", { name: "leave time" })).toContainText(
    "Now",
  );
  await expect(page.getByRole("button", { name: "arrive time" })).toContainText(
    "Any time",
  );
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
  ).toBeDisabled();
  await page.getByLabel("TO").click();
  await page.getByRole("option", { name: /Raffles Place/ }).click();
  await page.getByRole("button", { name: "Find my best route" }).click();
  const plannedResponse = await locationPlan;
  const plannedRequest = plannedResponse.request().postDataJSON();
  expect(
    Math.abs(Date.now() - Date.parse(plannedRequest.departure)),
  ).toBeLessThan(30_000);
  expect(plannedRequest.arriveBy).toBeUndefined();
  await expect(page.locator(".current-location-marker.device")).toBeVisible();
  await expect(page.getByText(/Device location · ±/)).toBeVisible();
  await expect(page.locator(".route-options")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await startJourneyButton(page).click();
  await page.getByRole("button", { name: "Start live location" }).click();
  await expect(page.getByRole("dialog")).toContainText("Live location on");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
test("automatic location keeps a saved commute origin", async ({
  page,
  context,
  baseURL,
}) => {
  await useDeterministicPlans(page);
  await context.grantPermissions(["geolocation"], {
    origin: new URL(baseURL!).origin,
  });
  await context.setGeolocation({ latitude: 1.3521, longitude: 103.9398 });

  await page.goto("/");

  await expect(page.getByLabel("FROM", { exact: true })).toHaveValue(
    "Tampines Central",
  );
  await expect(page.getByLabel("TO", { exact: true })).toHaveValue(
    "Raffles Place",
  );
  await expect(page.getByText(/Device location · ±/)).toBeVisible();
});
test("fits a narrow phone without horizontal overflow", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(startJourneyButton(page)).toBeEnabled();
  await openDeveloperDemos(page);
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.getByLabel("FROM")).toHaveValue(
    "Simulated current location",
  );
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
    .getByRole("navigation")
    .getByRole("button", { name: "Preferences", exact: true })
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
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-map-source",
    "bundled-osm",
  );
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator(".leaflet-local-basemap-pane canvas")).toHaveCount(
    1,
  );
  await expect(page.locator(".local-map-feature")).toHaveCount(0);
  await expect(startJourneyButton(page)).toBeEnabled();
  await context.setOffline(false);
});
