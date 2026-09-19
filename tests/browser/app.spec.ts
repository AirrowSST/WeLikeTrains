import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AccountState, PlanResponse } from "../../shared/types";
import { places, profiles } from "../../shared/catalog";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Wayce place search supplies Google coordinates to the local planner", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    class MockAutocompleteSessionToken {}
    const browserWindow = window as unknown as {
      google?: {
        maps: { importLibrary: () => Promise<Record<string, unknown>> };
      };
      googleAutocompleteRequest?: Record<string, unknown>;
    };
    browserWindow.google = {
      maps: {
        importLibrary: async () => ({
          AutocompleteSessionToken: MockAutocompleteSessionToken,
          AutocompleteSuggestion: {
            fetchAutocompleteSuggestions: async (request: {
              input: string;
              includedRegionCodes: string[];
              locationRestriction: Record<string, number>;
              region: string;
              sessionToken: unknown;
            }) => {
              browserWindow.googleAutocompleteRequest = {
                input: request.input,
                includedRegionCodes: request.includedRegionCodes,
                locationRestriction: request.locationRestriction,
                region: request.region,
                hasSessionToken:
                  request.sessionToken instanceof MockAutocompleteSessionToken,
              };
              const selectedPlace: {
                id: string;
                displayName?: string;
                formattedAddress?: string;
                location?: { lat: number; lng: number };
                fetchFields: () => Promise<void>;
              } = {
                id: "ChIJ-gallery-test",
                fetchFields: async () => {
                  selectedPlace.displayName = "National Gallery Singapore";
                  selectedPlace.formattedAddress =
                    "1 St Andrew's Road, Singapore";
                  selectedPlace.location = {
                    lat: 1.29027,
                    lng: 103.851959,
                  };
                },
              };
              return {
                suggestions: [
                  {
                    placePrediction: {
                      placeId: selectedPlace.id,
                      mainText: { text: "National Gallery Singapore" },
                      secondaryText: {
                        text: "1 St Andrew's Road, Singapore",
                      },
                      text: {
                        text: "National Gallery Singapore, Singapore",
                      },
                      toPlace: () => selectedPlace,
                    },
                  },
                ],
              };
            },
          },
        }),
      },
    };
  });
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        integrations: { googlePlaces: true },
        googlePlacesApiKey: "referrer-restricted-test-key",
      },
    }),
  );
  await useDeterministicPlans(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Back to navigation" }).click();

  const destination = page.locator("#place-B");
  await expect(destination).toBeVisible();
  await expect(
    page.locator("gmp-basic-place-autocomplete, gmp-place-details-compact"),
  ).toHaveCount(0);
  await destination.fill("National Gallery");
  await expect(
    page.getByRole("option").getByRole("button", {
      name: /National Gallery Singapore/,
    }),
  ).toBeVisible();
  await expect(page.getByText("Results from Google Maps")).toBeVisible();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-google-place-search.png`,
  });
  await page
    .getByRole("option")
    .getByRole("button", { name: /National Gallery Singapore/ })
    .click();

  await expect(page.locator(".place-field").nth(1)).toContainText(
    "1 St Andrew's Road, Singapore · Google Maps",
  );
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            googleAutocompleteRequest: Record<string, unknown>;
          }
        ).googleAutocompleteRequest,
    ),
  ).toMatchObject({
    input: "National Gallery",
    includedRegionCodes: ["sg"],
    region: "sg",
    hasSessionToken: true,
  });
  const selectedPlan = page.waitForRequest((request) => {
    if (!request.url().endsWith("/api/plan")) return false;
    return (
      request.postDataJSON()?.destination?.id === "google:ChIJ-gallery-test"
    );
  });
  await page.getByRole("button", { name: "Find my best route" }).click();
  const body = (await selectedPlan).postDataJSON();
  expect(body.destination).toMatchObject({
    id: "google:ChIJ-gallery-test",
    name: "National Gallery Singapore",
    lat: 1.29027,
    lon: 103.851959,
  });
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
  schematicBuses = false,
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
  await page.route("**/api/weather?*", (route) =>
    route.fulfill({
      json: {
        weather: {
          forecast: "Partly cloudy",
          rain: false,
          temperature: 29,
          walkStatus: "valid",
          cycleStatus: "valid",
        },
        feeds: [
          {
            name: "NEA two-hr-forecast",
            status: "live",
            updatedAt: "2026-09-21T07:40:00+08:00",
            detail: "Test weather",
          },
        ],
        updatedAt: "2026-09-21T07:40:00+08:00",
      },
    }),
  );
  const templates = new Map<string, Promise<PlanResponse>>();
  let latestTemplate: PlanResponse | undefined;
  await page.route("**/api/plan", async (route) => {
    const request = route.request().postDataJSON();
    const fixtureKey = request.timeline
      ? JSON.stringify(request.timeline)
      : (request.scenario ?? "normal");
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
            departure: request.timeline
              ? request.departure
              : "2026-09-21T07:40:00+08:00",
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
    if (schematicBuses)
      for (const journey of [
        plan.recommended,
        plan.original,
        ...plan.alternatives,
      ]) {
        for (const segment of journey.segments)
          if (segment.mode === "bus") segment.geometryKind = "schematic";
      }
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
  return page
    .locator(".route-results-start, .route-start-action .primary-button")
    .first();
}
async function selectFirstRoute(page: Page) {
  const focusedRoute = page.locator(".trip-select").first();
  const route = (await focusedRoute.count())
    ? focusedRoute
    : page.locator(".route-select").first();
  await expect(route).toBeEnabled();
  await route.click();
  return startJourneyButton(page);
}
async function expectRouteResults(page: Page) {
  const results = page.getByRole("region", { name: "Route results" });
  await expect(results).toBeVisible();
  return results;
}

test("shows planning failures beside the route action", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Back to navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
  ).toBeEnabled();

  await page.unroute("**/api/plan");
  await page.route("**/api/plan", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Planning is temporarily unavailable" }),
    }),
  );
  const planButton = page.getByRole("button", { name: "Find my best route" });
  await planButton.click();
  const warning = page.locator(".planner-warning");
  await expect(warning).toContainText("Planning is temporarily unavailable");

  expect((await warning.boundingBox())!.y).toBeLessThan(
    (await planButton.boundingBox())!.y,
  );
});

test("replaces the journey sheet with the route results map after a search", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Back to navigation" }).click();

  await expect(page.locator(".companion-button")).toHaveCSS(
    "animation-name",
    "waycey-float",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".companion-button")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(
    page.getByRole("button", { name: /Resize journey panel/ }),
  ).toHaveAttribute("data-sheet-snap", "expanded");

  await page.getByRole("button", { name: "Find my best route" }).click();

  await expect(
    page.getByRole("region", { name: "Route results" }),
  ).toBeVisible();
  await expect(page.locator(".route-results-map")).toBeVisible();
  await expect(page.locator(".journey-sheet")).toHaveCount(0);
});

test("keeps the route action compact in a very short visual viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 341, height: 171 });
  await page.goto("/");
  const planButton = page.getByRole("button", { name: "Find my best route" });
  await planButton.scrollIntoViewIfNeeded();
  const action = (await planButton.boundingBox())!;

  expect(action.height).toBeGreaterThanOrEqual(36);
  expect(action.height).toBeLessThanOrEqual(42);
});

test("shows a route-specific start action only after explicit selection", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Route results" }),
  ).toBeVisible();
  await expect(startJourneyButton(page)).toHaveCount(0);

  const routes = page.locator(".trip-card");
  const first = routes.first();
  const firstChoice = first.locator(".trip-select");
  await firstChoice.click();

  await expect(first).toHaveClass(/selected/);
  await expect(startJourneyButton(page)).toBeVisible();
  await expect(page.locator(".route-results-start")).toHaveCount(1);
  await expect(first.locator(".trip-metrics")).toContainText(/crowd/i);
  await expect(first.locator(".trip-metrics")).toContainText(/walking/i);

  if ((await routes.count()) > 1) {
    const second = routes.nth(1);
    await second.locator(".trip-select").click();
    await expect(first).not.toHaveClass(/selected/);
    await expect(second).toHaveClass(/selected/);
    await expect(startJourneyButton(page)).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("keeps the route summary and map above the focused trip list", async ({
  page,
}, testInfo) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await openDeveloperDemos(page);
  const demos = page.getByRole("dialog", { name: "Developer demos" });
  await demos.getByRole("button", { name: /Arjun/ }).click();
  await demos.getByRole("button", { name: "Start demo" }).click();
  const results = page.getByRole("region", { name: "Route results" });
  await expect(results).toBeVisible();
  const summary = page.locator(".route-results-summary");
  const map = page.locator(".route-results-map");
  const trips = page.locator(".trip-list");
  const [summaryBox, mapBox, tripsBox] = await Promise.all([
    summary.boundingBox(),
    map.boundingBox(),
    trips.boundingBox(),
  ]);
  expect(summaryBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(tripsBox).not.toBeNull();
  expect(mapBox!.y).toBeGreaterThanOrEqual(
    summaryBox!.y + summaryBox!.height,
  );
  expect(tripsBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-route-results-layout.png`,
  });
});

test("formats the simulated leave time as a readable card", async ({
  page,
}, testInfo) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await openDeveloperDemos(page);
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.getByLabel("Timeline minute")).toHaveValue("0");
  await expectRouteResults(page);
  await page.getByRole("button", { name: "Back to navigation" }).click();

  const card = page.locator(".demo-time-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute(
    "aria-label",
    "Simulated leave time 07:40 AM",
  );
  await expect(card).toContainText("Leave");
  await expect(card).toContainText("Simulated");
  await expect(card).toContainText("07:40");
  await expect(card).toContainText("AM");
  await expect(card).toContainText("Timeline controlled");
  await expect(card).not.toContainText("Use timeline controls");

  const [cardBox, headingBox, valueBox, helperBox] = await Promise.all([
    card.boundingBox(),
    card.locator(".demo-time-heading").boundingBox(),
    card.locator(".demo-time-value").boundingBox(),
    card.locator(".demo-time-helper").boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(valueBox).not.toBeNull();
  expect(helperBox).not.toBeNull();
  expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(valueBox!.y);
  expect(valueBox!.y + valueBox!.height).toBeLessThanOrEqual(helperBox!.y);
  expect(headingBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
  expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(
    cardBox!.x + cardBox!.width,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-demo-time-card.png`,
  });
});

test("makes the active journey map the hero with guidance docked below", async ({
  page,
}, testInfo) => {
  await useDeterministicPlans(page);
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 750 });
  }
  await page.goto("/");
  await expectRouteResults(page);

  const start = await selectFirstRoute(page);
  await start.click();

  const dialog = page.locator(".journey-navigation-modal");
  const map = dialog.getByRole("region", {
    name: /showing your active navigation route/,
  });
  const guidance = dialog.getByRole("region", {
    name: "One step at a time guidance",
  });
  await expect(dialog).toBeVisible();
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-ready", "true");
  await expect(guidance).toBeVisible();
  await expect(guidance).toContainText("STEP 1 OF");
  await expect(
    guidance.getByRole("button", { name: "I’m here" }),
  ).toBeVisible();

  const activeLeg = dialog.locator(".navigation-active");
  await expect(activeLeg).toHaveCount(1);
  const [dialogBox, mapBox, guidanceBox, activeLegBox] = await Promise.all([
    dialog.boundingBox(),
    map.boundingBox(),
    guidance.boundingBox(),
    activeLeg.boundingBox(),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(guidanceBox).not.toBeNull();
  expect(activeLegBox).not.toBeNull();
  expect(dialogBox!.width).toBeLessThanOrEqual(480);
  expect(mapBox!.width).toBeGreaterThanOrEqual(dialogBox!.width - 2);
  expect(mapBox!.height).toBeGreaterThanOrEqual(dialogBox!.height - 2);
  expect(guidanceBox!.height).toBeLessThan(dialogBox!.height * 0.55);
  expect(
    Math.abs(
      guidanceBox!.y + guidanceBox!.height - (dialogBox!.y + dialogBox!.height),
    ),
  ).toBeLessThanOrEqual(2);
  expect(activeLegBox!.y).toBeLessThan(guidanceBox!.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.screenshot({
    path: `test-results/${test.info().project.name}-active-navigation.png`,
  });
});

test("drags and keyboard-resizes the active journey guidance sheet", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectRouteResults(page);
  const start = await selectFirstRoute(page);
  await start.click();

  const stage = page.locator(".journey-navigation-stage");
  const sheet = page.locator(".active-journey-sheet");
  const map = stage.locator(".map-wrap");
  const handle = page.getByRole("button", {
    name: /Resize One step at a time panel/,
  });
  await expect(handle).toHaveAttribute("data-sheet-snap", "middle");
  const initialSheetHeight = (await sheet.boundingBox())!.height;
  const initialMapHeight = (await map.boundingBox())!.height;
  const handleBox = (await handle.boundingBox())!;
  const touchX = handleBox.x + handleBox.width / 2;
  const touchY = handleBox.y + handleBox.height / 2;

  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchX, y: touchY, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchX, y: touchY - 96, id: 1 }],
  });
  await expect(stage).toHaveClass(/sheet-dragging/);
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialSheetHeight + 96, 0);
  expect((await map.boundingBox())!.height).toBeCloseTo(initialMapHeight, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialMapHeight, 0);
  await handle.press("ArrowDown");
  await expect(handle).toHaveAttribute("data-sheet-snap", "middle");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialSheetHeight, 0);
  await handle.press("End");
  await expect(handle).toHaveAttribute("data-sheet-snap", "collapsed");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeLessThanOrEqual(73);
  await handle.press("Home");
  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await expect(page.getByRole("button", { name: "I’m here" })).toBeVisible();
});

async function startTimelineAt(page: Page, minute: number) {
  await page.getByLabel("Demo timeline preset").selectOption("eventful");
  await page.getByRole("button", { name: "Start demo" }).click();
  await expectRouteResults(page);
  await page.locator(".route-results-timeline").evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
  await page.getByLabel("Jump to timeline event").selectOption(String(minute));
  await expect(page.getByLabel("Timeline minute")).toHaveValue(String(minute));
  await expectRouteResults(page);
}
async function openDeveloperDemos(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await page.getByLabel("Developer mode").check();
  await page.getByRole("button", { name: "Open demo presets" }).click();
}
test("plays profile timelines, jumps through recovery and restores the guest", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto("/");
  await expect(await selectFirstRoute(page)).toBeEnabled();
  const guest = await page.evaluate(() => localStorage.getItem("wlt-guest-v2"));
  await openDeveloperDemos(page);
  await expect(page.getByLabel("Demo timeline preset")).toHaveValue("control");
  await expect(page.getByLabel("Demo weather")).toHaveCount(0);
  await page.getByLabel("Demo timeline preset").selectOption("eventful");
  await page.getByRole("button", { name: "Start demo" }).click();
  await expectRouteResults(page);
  await page.locator(".route-results-timeline").evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
  await expect(page.getByLabel("Timeline minute")).toHaveValue("0");
  await expect(page.locator(".timeline-controls")).toContainText(
    "disruption and heavy rain begin",
  );
  await expect(page.locator(".route-results-advice")).toContainText(
    "Bring an umbrella",
  );
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await page.getByLabel("Jump to timeline event").selectOption("40");
  await expect(page.locator(".timeline-controls")).toContainText(
    "Service and lifts restored",
  );
  await expectRouteResults(page);
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await page.getByRole("button", { name: "Restart timeline" }).click();
  await expect(page.getByLabel("Timeline minute")).toHaveValue("0");
  await page.getByLabel("Timeline speed").selectOption("60");
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(page.getByLabel("Timeline minute")).not.toHaveValue("0");
  await page.getByRole("button", { name: "Pause timeline" }).click();
  const paused = await page.getByLabel("Timeline minute").inputValue();
  await page.waitForTimeout(1400);
  await expect(page.getByLabel("Timeline minute")).toHaveValue(paused);
  for (const profile of ["arjun", "lim"]) {
    await page.getByRole("button", { name: "Back to navigation" }).click();
    await page.getByLabel("Demo profile").selectOption(profile);
    await expect(page.getByLabel("Timeline minute")).toHaveValue("0");
    await expectRouteResults(page);
    await page.locator(".route-results-timeline").evaluate((details) => {
      (details as HTMLDetailsElement).open = true;
    });
    await expect(page.locator(".timeline-controls")).toContainText(
      "disruption and heavy rain begin",
    );
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to navigation" }).click();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.getByLabel("Timeline minute")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("wlt-guest-v2"))).toBe(
    guest,
  );
});
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
  await onboarding.getByLabel("Alert me when a delay adds").fill("6");
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
        loaded: document.fonts.check('16px "Satoshi"'),
      };
    }),
  ).toEqual({ family: "Satoshi, sans-serif", loaded: true });
  await expectRouteResults(page);
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await expect(page.locator(".route-results-advice")).toBeVisible();
  await expect(page.locator(".trip-metrics").first()).toContainText(/crowd/i);
  await expect(page.locator(".trip-metrics").first()).toContainText(/walking/i);
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
  const navigation = await page.getByRole("navigation").boundingBox();
  expect(navigation!.y).toBeGreaterThan(page.viewportSize()!.height - 100);
  const journeyNavItem = page
    .getByRole("navigation")
    .getByRole("button", { name: "Journey", exact: true });
  await expect(journeyNavItem).toHaveClass(/journey-nav-item/);
  const journeyNavBox = await journeyNavItem.boundingBox();
  expect(
    Math.abs(
      journeyNavBox!.x +
        journeyNavBox!.width / 2 -
        (navigation!.x + navigation!.width / 2),
    ),
  ).toBeLessThan(4);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Rewards", exact: true }),
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
  const locationButton = page.getByRole("button", { name: "Go to location" });
  const fullRouteButton = page.getByRole("button", { name: "Show full route" });
  await expect(notificationsButton).toBeVisible();
  await expect(locationButton).toBeVisible();
  await expect(fullRouteButton).toBeVisible();
  await expect(page.locator(".leaflet-control-zoom")).toHaveCount(0);
  expect(
    await notificationsButton.evaluate(
      (button) => button.closest(".map-controls") !== null,
    ),
  ).toBe(true);
  const notificationsBox = await notificationsButton.boundingBox();
  const locationBox = await locationButton.boundingBox();
  const fullRouteBox = await fullRouteButton.boundingBox();
  expect(locationBox!.y).toBeGreaterThan(notificationsBox!.y);
  expect(fullRouteBox!.y).toBeGreaterThan(locationBox!.y);
  expect(notificationsBox!.width).toBe(notificationsBox!.height);
  expect(locationBox!.width).toBe(locationBox!.height);
  expect(fullRouteBox!.width).toBe(fullRouteBox!.height);
  await page.getByRole("button", { name: "Back to navigation" }).click();
  await expect(page.locator(".demo-toolbar")).toContainText("Live LTA + NEA");
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
  const shelterPreference = page.getByLabel("Sheltered walking preference");
  await expect(shelterPreference).toHaveValue("prefer");
  await shelterPreference.selectOption("require");
  await expect(shelterPreference).toHaveValue("require");
  await shelterPreference.selectOption("prefer");
  const preferencesBounds = await preferencesPage.boundingBox();
  const shellBounds = await page.locator(".app-shell").boundingBox();
  expect(preferencesBounds!.x).toBeCloseTo(shellBounds!.x, 0);
  expect(preferencesBounds!.width).toBeCloseTo(shellBounds!.width, 0);
  expect(preferencesBounds!.height).toBeGreaterThan(
    page.viewportSize()!.height - 100,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Journey", exact: true })
    .click();
  await page.getByRole("button", { name: "Find my best route" }).click();
  await expectRouteResults(page);
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
  await expect
    .poll(() => page.locator(".walk-shelter-section.exposed").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".walk-shelter-section.unknown").count())
    .toBeGreaterThan(0);
  await expect(page.locator(".walk-shelter-label.exposed")).toBeVisible();
  await expect(page.locator(".shelter-map-legend")).toContainText("Exposed");
  await expect(page.locator(".shelter-map-legend")).toContainText("Unknown");
  await expect(page.locator(".map-mode-key")).toContainText("Walk");
  await expect(page.locator(".map-mode-key")).toContainText("Train");
  await page.screenshot({
    path: `test-results/${info.project.name}-journey.png`,
    fullPage: true,
  });
  await expect(page.getByLabel("Demo test controls")).toHaveCount(0);
  await openDeveloperDemos(page);
  await startTimelineAt(page, 0);
  await expect(page.locator(".rain-zone").first()).toBeVisible();
  await expect(page.locator(".map-mode-key")).toContainText("Rain area");
  await page.getByRole("button", { name: "Back to navigation" }).click();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expectRouteResults(page);
  await expect(page.locator(".map-mode-key")).not.toContainText("Rain area");
  await (await selectFirstRoute(page)).click();
  await expect(page.getByRole("dialog")).toContainText("STEP 1");
  await page.getByRole("button", { name: "I’m here" }).click();
  await expect(page.getByRole("dialog")).toContainText("STEP 2");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Open Chatbot" }).click();
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
test("opens transit details when a selected journey path is chosen", async ({
  page,
}) => {
  await useDeterministicPlans(page, true);
  await page.goto("/");
  await expectRouteResults(page);

  const trainPath = page.locator(".route-segment-hit.rail").first();
  await expect(trainPath).toHaveAttribute("role", "button");
  await expect(trainPath).toHaveAttribute(
    "aria-label",
    /Open Train .+ journey section details/,
  );
  await trainPath.dispatchEvent("click");

  const details = page.locator(".route-segment-popup");
  await expect(details).toBeVisible();
  await expect(details.locator(".route-segment-popup-mode")).toContainText(
    "Train",
  );
  await expect(details).toContainText("Board");
  await expect(details).toContainText("Alight");
  await expect(details).toContainText("Crowding");
  await expect(details).toContainText("Timing:");
  await expect(details).toContainText("Station/platform crowding:");
  await expect(
    page.locator(".timeline .segment-crowding").first(),
  ).toContainText("Station/platform crowding:");
});
test("opens schematic bus details from a served-stop marker on a narrow phone", async ({
  page,
}) => {
  await useDeterministicPlans(page, true, false, false, true);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await openDeveloperDemos(page);
  await page.getByRole("button", { name: /Mdm Lim/ }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await page
    .locator(".trip-card")
    .filter({ hasText: "Bus 31" })
    .first()
    .locator(".trip-select")
    .click();
  await expect(page.locator(".bus-route-schematic")).toBeAttached();
  await expect(page.locator(".bus-route-label.board")).toContainText(
    "Board Bus 31",
  );
  await expect(page.locator(".bus-route-label.alight")).toContainText(
    "Alight Bus 31",
  );

  const busStop = page.locator(".bus-route-stop").first();
  await expect(busStop).toHaveAttribute("role", "button");
  await expect(busStop).toHaveAttribute("aria-label", /Bus 31/);
  await busStop.focus();
  await busStop.press("Enter");

  const details = page.locator(".route-segment-popup");
  await expect(details).toBeVisible();
  await expect(details.locator(".route-segment-popup-mode")).toContainText(
    "Bus",
  );
  await expect(details).toContainText("Board");
  await expect(details).toContainText("Alight");
  await expect(details).toContainText("Crowding");
  await expect(details).toContainText("Bus occupancy:");
  await expect(details).toContainText("Served stops highlighted");
  await expect(page.locator(".timeline")).toContainText(
    "Served stops highlighted",
  );
  await expect(
    page.locator(".timeline .segment-crowding").first(),
  ).toContainText("Bus occupancy:");
  await expect
    .poll(async () => {
      const box = await details.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 320;
    })
    .toBe(true);
});
test("opens local MRT and bus-stop details from map icons", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page, true);
  await page.route("**/api/station-board?*", (route) =>
    route.fulfill({
      json: {
        groups: [
          {
            line: "EWL",
            towards: "Tuas Link",
            times: [new Date(Date.now() + 300000).toISOString()],
          },
        ],
        crowds: [
          { line: "EWL", level: "moderate", status: "current platform crowd" },
        ],
        forecasts: ["low", "moderate", "high"].map((level, i) => ({
          line: "EWL",
          level,
          status: "forecast",
          start: new Date(Date.now() + i * 1800000).toISOString(),
          end: new Date(Date.now() + (i + 1) * 1800000).toISOString(),
        })),
      },
    }),
  );
  await page.goto("/");
  await expectRouteResults(page);
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-ready",
    "true",
  );

  const railStops = page.locator(".transit-stop-marker.rail");
  await expect(railStops.first()).toBeVisible();
  const clickableRailIndex = await railStops.evaluateAll((markers) =>
    markers.findIndex((marker) => {
      const box = marker.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return topmost === marker || marker.contains(topmost);
    }),
  );
  expect(clickableRailIndex).toBeGreaterThanOrEqual(0);
  const railStop = railStops.nth(clickableRailIndex);
  await expect(railStop).toHaveAttribute("aria-label", /MRT \/ LRT station/);
  await expect(
    page
      .locator(".transit-stop-marker.rail.show-label .transit-stop-label")
      .first(),
  ).toBeVisible();
  await railStop.click();
  const transitPopup = page.locator(".transit-stop-popup");
  await expect(transitPopup).not.toContainText("MRT / LRT station");
  await expect(transitPopup).not.toContainText("Expand station information");
  await expect(transitPopup).toContainText("More info");
  await page
    .getByRole("button", { name: /Show .+ station information/ })
    .click();
  const details = page.getByRole("dialog", { name: /information/ });
  await expect(details).toContainText("Scheduled departures");
  await expect(
    details.getByRole("heading", { name: "Predicted crowdedness" }),
  ).toBeVisible();
  await expect(
    details.getByRole("img", { name: "Moderate crowdedness" }),
  ).toHaveCount(2);
  await expect(
    details.getByRole("img", { name: "Low crowdedness" }),
  ).toBeVisible();
  await expect(
    details.getByRole("img", { name: "High crowdedness" }),
  ).toBeVisible();
  expect(
    await details
      .getByRole("img", { name: "High crowdedness" })
      .locator(".filled")
      .count(),
  ).toBe(3);
  await expect(details).toContainText("Tuas Link");
  await expect(details).toContainText("not live train tracking");
  await page
    .getByRole("button", { name: "Close station or stop information" })
    .click();
  await page.locator(".leaflet-popup-close-button").click();

  const mapBox = await page.locator(".journey-map").boundingBox();
  const mapCenter = {
    x: Math.round(mapBox!.x + mapBox!.width / 2),
    y: Math.round(mapBox!.y + Math.min(mapBox!.height / 2, 180)),
  };
  const finePointer = await page.evaluate(
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  if (finePointer) {
    await page.mouse.move(mapCenter.x, mapCenter.y);
    for (
      let zoom = 0;
      zoom < 4 &&
      (await page.locator(".transit-stop-marker.bus").count()) === 0;
      zoom++
    ) {
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(600);
    }
  } else {
    const cdp = await context.newCDPSession(page);
    for (
      let zoom = 0;
      zoom < 4 &&
      (await page.locator(".transit-stop-marker.bus").count()) === 0;
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
      await page.waitForTimeout(600);
    }
  }
  const busStops = page.locator(".transit-stop-marker.bus");
  await expect(busStops.first()).toBeVisible();
  const tappableBusId = () =>
    busStops.evaluateAll((markers) =>
      markers
        .find((marker) => {
          const box = marker.getBoundingClientRect();
          const topmost = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return topmost === marker || marker.contains(topmost);
        })
        ?.getAttribute("data-transit-stop-id"),
    );
  let clickableBusId = await tappableBusId();
  for (let pan = 0; pan < 3 && !clickableBusId; pan++) {
    const panStart = {
      x: mapCenter.x,
      y: Math.round(mapBox!.y + Math.min(mapBox!.height - 80, 300)),
    };
    if (finePointer) {
      await page.mouse.move(panStart.x, panStart.y);
      await page.mouse.down();
      await page.mouse.move(panStart.x, panStart.y - 140, { steps: 4 });
      await page.mouse.up();
    } else {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...panStart, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: panStart.x, y: panStart.y - 140, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    await page.waitForTimeout(600);
    clickableBusId = await tappableBusId();
  }
  expect(clickableBusId).toBeTruthy();
  const busStop = page.locator(
    `.transit-stop-marker.bus[data-transit-stop-id="${clickableBusId}"]`,
  );
  await expect(busStop).toHaveAttribute("aria-label", /bus stop/);
  if (finePointer) {
    await busStop.focus();
    await busStop.press("Enter");
  } else {
    await busStop.click();
  }
  await expect(page.locator(".transit-stop-popup")).not.toContainText(
    "Bus stop",
  );
  const serviceButton = page.locator(".stop-service-buttons button").first();
  const service = (await serviceButton.textContent())!;
  await page.route("**/api/buses/*", (route) =>
    route.fulfill({
      json: {
        status: "live",
        updatedAt: new Date().toISOString(),
        buses: [
          {
            service,
            stop: clickableBusId!.replace("lta-bus:", ""),
            eta: new Date(Date.now() + 240000).toISOString(),
            monitored: true,
            status: "live",
            load: "high",
            type: "DD",
            wheelchair: true,
          },
        ],
      },
    }),
  );
  await expect(page.locator(".transit-stop-popup")).not.toContainText(
    "More stop information",
  );
  await page.getByRole("button", { name: /Show .+ stop information/ }).click();
  await expect(details).toContainText("Live bus arrivals");
  await expect(details).toContainText("Crowding: high");
  await expect(details).toContainText("Double-deck bus");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await details.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page
    .getByRole("button", { name: "Close station or stop information" })
    .click();
  await serviceButton.click();
  await expect(
    page.getByRole("region", { name: "Bus service map" }),
  ).toContainText("Stops served");
  await expect(page.locator(".bus-line-stop").first()).toBeAttached();
  await expect(page.locator(".bus-service-schematic")).toBeAttached();
  const busMapPanel = page.getByRole("region", { name: "Bus service map" });
  const pointsChip = page.locator(".points-counter");
  const [busMapPanelBox, pointsChipBox] = await Promise.all([
    busMapPanel.boundingBox(),
    pointsChip.boundingBox(),
  ]);
  expect(busMapPanelBox!.y).toBeGreaterThanOrEqual(
    pointsChipBox!.y + pointsChipBox!.height + 6,
  );
  expect(
    await page
      .locator(".bus-line-stop")
      .first()
      .evaluate((marker) =>
        marker.parentElement?.className.includes("bus-service-stop-pane"),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "Clear bus stops" }).click();
  await expect(page.locator(".bus-line-stop")).toHaveCount(0);
});

test("keeps Commutes and Disruptions content inside the phone gutter", async ({
  page,
}) => {
  await useDeterministicPlans(page, true);
  await page.goto("/");

  for (const tab of ["Commutes", "Disruptions"] as const) {
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
  await startTimelineAt(page, 0);

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

  const routeCards = page.locator(".trip-card");
  await expect(routeCards.first().locator(".crowd-badge")).toContainText(
    /crowd/i,
  );
  await expect(page.locator(".crowd-badge")).toHaveCount(
    await routeCards.count(),
  );
  await expect(page.locator(".route-results-advice p")).toHaveText(
    currentPlan()!.advice,
  );
});
test("keeps the rainy journey usable while confirming weather and rail warnings", async ({
  page,
}, testInfo) => {
  await useDeterministicPlans(page, true);
  await page.goto("/");
  await openDeveloperDemos(page);
  await startTimelineAt(page, 0);

  await expect(page.locator(".route-results-advice")).toContainText(
    "Bring an umbrella",
  );
  await expect(page.locator(".route-results-advice")).toContainText("slippery");
  await expect(page.locator(".route-results-advice")).toContainText(
    "visibility may be reduced",
  );
  await expect(page.locator(".trip-card").first()).not.toContainText(
    "WAIT FOR SAFER CONDITIONS",
  );
  const ewlTrip = page.locator(".trip-card").filter({ hasText: "EWL" }).first();
  await ewlTrip.locator(".trip-select").click();
  const startWithWarning = page.locator(".route-results-start");
  await expect(startWithWarning).toBeVisible();
  await startWithWarning.click();

  const warning = page.getByRole("dialog", {
    name: "Review route warnings",
  });
  await expect(warning).toContainText("cannot verify");
  await expect(warning).toContainText("Severe weather warning");
  await expect(warning).toContainText("EWL service disruption");
  const disruptionWarning = warning.locator('[data-notice-id="lta-train-0"]');
  await expect(disruptionWarning.locator("strong")).toHaveText(
    "EWL service disruption",
  );
  await expect(disruptionWarning.locator("em")).toHaveText("Simulated");
  await expect(disruptionWarning).toContainText(
    "Affected stations: EW2, EW3, EW4, EW5, EW6, EW7, EW8, EW9, EW10, EW11, EW12, EW13, EW14",
  );
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-weather-route-start.png`,
  });
  await warning
    .getByRole("button", { name: "I understand — start EWL" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "One step at a time" }),
  ).toBeVisible();
  const activeWarnings = page.getByLabel("Current route warnings");
  await expect(activeWarnings).toContainText("Severe weather warning");
  await expect(activeWarnings).toContainText("EWL service disruption");
});

test("highlights every station across the affected NEL sector", async ({
  page,
}, testInfo) => {
  await useDeterministicPlans(page, true);
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto("/");
  await openDeveloperDemos(page);
  await page
    .getByRole("dialog", { name: "Developer demos" })
    .getByRole("button", { name: /Arjun/ })
    .click();
  await startTimelineAt(page, 0);

  const nelTrip = page.locator(".trip-card").filter({ hasText: "NEL" }).first();
  await nelTrip.locator(".trip-select").click();

  for (const code of ["NE12", "NE13", "NE14", "NE15", "NE16", "NE17"]) {
    await expect(
      page.locator(
        `.transit-stop-marker.rail.affected[data-transit-codes~="${code}"]`,
      ),
    ).toHaveCount(1);
  }
  await expect(
    page.locator(
      '.transit-stop-marker.rail.affected[data-transit-codes~="NE11"]',
    ),
  ).toHaveCount(0);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-nel-sector-map.png`,
  });

  await page.locator(".route-results-start").click();
  const warning = page.getByRole("dialog", { name: "Review route warnings" });
  await expect(warning).toContainText(
    "Affected stations: NE12, NE13, NE14, NE15, NE16, NE17",
  );
  await expect(warning).not.toContainText("NE1,");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-nel-sector-warning.png`,
  });
});
test("mobile interface passes automated WCAG A/AA checks", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(startJourneyButton(page)).toHaveCount(0);
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await expectRouteResults(page);
  const routeResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(routeResults.violations).toEqual([]);
  await page.getByRole("button", { name: "Back to navigation" }).click();
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
  await startTimelineAt(page, 0);
  const alertsButton = page.getByRole("button", {
    name: "View disruption alerts",
  });
  await expect(alertsButton).toBeEnabled();
  await alertsButton.click();
  const dialog = page.getByRole("dialog", { name: "Service disruptions" });
  await expect(dialog).toContainText("SIMULATED service disruption");
  await expect(dialog).toContainText("DISRUPTION");
  await expect(dialog).not.toContainText("Know what you’re looking at.");
  await expect(dialog).not.toContainText("Heavy rain along your journey");
});
test("keeps the page fixed while the journey pane moves", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page, false, false);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  for (const input of ["mouse", "touch"] as const) {
    await page.goto("/");
    const handle = page.locator(".sheet-drag-handle");
    const sheet = page.locator(".journey-sheet");
    await expect(handle).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 180));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const start = (await handle.boundingBox())!;
    const startSheetHeight = (await sheet.boundingBox())!.height;
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    if (input === "mouse") {
      await page.mouse.move(x, y);
      await page.mouse.down();
    } else {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
    }
    for (const delta of [-40, -80, -120]) {
      if (input === "mouse") await page.mouse.move(x, y + delta);
      else
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + delta, id: 1 }],
        });
      // Assert the grip itself moves while the document remains stationary.
      await expect
        .poll(async () =>
          Math.abs((await handle.boundingBox())!.y - (start.y + delta)),
        )
        .toBeLessThan(2);
      await expect
        .poll(async () => (await sheet.boundingBox())!.height)
        .toBeCloseTo(startSheetHeight - delta, 0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
    if (input === "mouse") await page.mouse.up();
    else
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  }
});

test("resizes the mobile journey sheet by drag and keyboard", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => {
      throw new DOMException(
        "Pointer capture unavailable",
        "NotSupportedError",
      );
    };
  });
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(await selectFirstRoute(page)).toBeEnabled();

  const handle = page.getByRole("button", { name: /Resize journey panel/ });
  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS("background-color", "rgb(241, 243, 242)");
  const map = page.locator(".map-wrap");
  const sheet = page.locator(".journey-sheet");
  const initialMapHeight = (await map.boundingBox())!.height;
  const initialHeight = (await sheet.boundingBox())!.height;
  const dragSurface = page.locator(".planner-card .sheet-drag-surface");

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
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialHeight + 96, 0);
  expect((await map.boundingBox())!.height).toBeCloseTo(initialMapHeight, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await handle.press("ArrowDown");
  await expect(handle).toHaveAttribute("data-sheet-snap", "middle");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialHeight, 0);

  await dragSurface.scrollIntoViewIfNeeded();
  const dragSurfaceBox = await dragSurface.boundingBox();
  const dragX = dragSurfaceBox!.x + dragSurfaceBox!.width / 3;
  const dragStartY = dragSurfaceBox!.y + dragSurfaceBox!.height / 2;
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest(".sheet-drag-surface")
          ?.className,
      { x: dragX, y: dragStartY },
    ),
  ).toContain("sheet-drag-surface");
  await page.mouse.move(dragX, dragStartY);
  await page.mouse.down();
  for (const delta of [-60, -120, -180]) {
    await page.mouse.move(dragX, dragStartY + delta);
    await expect(page.locator(".journey-layout")).toHaveClass(/sheet-dragging/);
    await expect
      .poll(async () => (await sheet.boundingBox())!.height)
      .toBeCloseTo(initialHeight - delta, 0);
  }
  await page.mouse.move(dragX, dragStartY - 420, { steps: 5 });
  await page.mouse.up();

  await expect(handle).toHaveAttribute("data-sheet-snap", "expanded");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialMapHeight, 0);
  expect((await map.boundingBox())!.height).toBeCloseTo(initialMapHeight, 0);
  await expect
    .poll(async () => (await page.locator(".planner-card").boundingBox())!.y)
    .toBeLessThan(77);
  const showMap = page.getByRole("button", {
    name: "Show map and collapse journey panel",
  });
  await expect(showMap).toBeVisible();
  await expect(showMap).toContainText("Show map");
  await expect(showMap.locator("svg")).toHaveCount(3);
  await expect(showMap).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(showMap).toHaveCSS("border-top-width", "0px");
  await expect(showMap.locator(".map-collapse-content")).toHaveCSS(
    "animation-name",
    "map-collapse-chevron-bounce",
  );
  const expandedHandleBox = (await handle.boundingBox())!;
  const showMapBox = (await showMap.boundingBox())!;
  expect(showMapBox.y).toBeGreaterThanOrEqual(
    expandedHandleBox.y + expandedHandleBox.height,
  );
  expect(
    Math.abs(
      showMapBox.x +
        showMapBox.width / 2 -
        (expandedHandleBox.x + expandedHandleBox.width / 2),
    ),
  ).toBeLessThan(1);
  await showMap.click();

  await expect(handle).toHaveAttribute("data-sheet-snap", "collapsed");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeLessThanOrEqual(73);
  expect((await map.boundingBox())!.height).toBeCloseTo(initialMapHeight, 0);
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
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeCloseTo(initialMapHeight, 0);

  const expandedHandle = await handle.boundingBox();
  await page.mouse.move(
    expandedHandle!.x + expandedHandle!.width / 2,
    expandedHandle!.y + expandedHandle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    expandedHandle!.x + expandedHandle!.width / 2,
    expandedHandle!.y + 450,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(handle).toHaveAttribute("data-sheet-snap", "middle");
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeGreaterThan(300);

  await page.setViewportSize({ width: 320, height: 700 });
  await handle.press("Home");
  await expect(showMap).toBeVisible();
  const sheetScroll = page.locator(".journey-sheet-scroll");
  const sheetScrollBox = (await sheetScroll.boundingBox())!;
  await page.mouse.move(
    sheetScrollBox.x + sheetScrollBox.width / 2,
    sheetScrollBox.y + sheetScrollBox.height / 2,
  );
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => sheetScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(showMap).toBeVisible();
  expect((await page.locator(".planner-card").boundingBox())!.y).toBeLessThan(
    (await handle.boundingBox())!.y + (await handle.boundingBox())!.height,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
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
  await expect(await selectFirstRoute(page)).toBeEnabled();

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
  await page.getByRole("button", { name: "Open Chatbot" }).click();
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
  await page.getByRole("button", { name: "Open Chatbot" }).click();
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
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await page.getByRole("button", { name: "Open Chatbot" }).click();
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
  await page.getByRole("button", { name: "Open Chatbot" }).click();

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
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await page.getByRole("button", { name: "Open Chatbot" }).click();
  await expect(agreement).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Preferences Travel choices/ })
    .click();
  const setting = page.getByRole("checkbox", {
    name: "Companion data sharing",
  });
  await expect(setting).toBeChecked();
  await setting.uncheck();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Journey", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chatbot" }).click();
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
  await page.getByRole("button", { name: "Open Chatbot" }).click();
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
  await expect(await selectFirstRoute(page)).toBeEnabled();
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
  await expectRouteResults(page);
  await (await selectFirstRoute(page)).click();
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
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await openDeveloperDemos(page);
  await page.getByRole("button", { name: /Mdm Lim/ }).click();
  await page.getByLabel("Demo timeline preset").selectOption("eventful");
  await page.getByRole("button", { name: "Start demo" }).click();

  await expect(page.locator("html")).toHaveClass(/(?:^|\s)large-text(?:\s|$)/);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  const demoAccountPage = page.getByRole("main", { name: "Account" });
  await expect(demoAccountPage).toContainText("Mdm Lim · Faux account");
  await expect(demoAccountPage).toContainText("never synced");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Journey", exact: true })
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
  await page.getByRole("button", { name: "Commutes", exact: true }).click();
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
  await expect(page.locator(".weather-status")).toContainText(
    "29° · Partly cloudy",
  );
  await expect(page.locator(".weather-status time")).toHaveText(
    /\d{1,2}:\d{2}\s*(am|pm)/i,
  );
  await page.getByRole("button", { name: /Open weather details/ }).click();
  const weatherDialog = page.getByRole("dialog", {
    name: "Weather right now",
  });
  await expect(weatherDialog).toContainText("Partly cloudy");
  await expect(weatherDialog).toContainText("29°C");
  await expect(weatherDialog).toContainText("NEA two-hr-forecast");
  await page.getByRole("button", { name: "Close dialog" }).click();
  const destinationInput = page.getByLabel("TO", { exact: true });
  const locationMarker = page.locator(".current-location-marker.device");
  await expect(locationMarker).toBeVisible();
  const mapBox = (await page.locator(".map-wrap").boundingBox())!;
  const markerBox = (await locationMarker.boundingBox())!;
  expect(markerBox.y + markerBox.height / 2).toBeLessThan(
    mapBox.y + mapBox.height / 2 - 50,
  );
  await expect(destinationInput).toHaveAttribute("placeholder", "Where to?");
  await expect(destinationInput).toHaveValue("");
  await expect(page.getByRole("button", { name: "leave time" })).toContainText(
    "Now",
  );
  await expect(page.getByRole("button", { name: "arrive time" })).toContainText(
    "Any time",
  );
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
  ).toBeDisabled();
  await destinationInput.click();
  await page.getByRole("option", { name: /Raffles Place/ }).click();
  await page.getByRole("button", { name: "Find my best route" }).click();
  const plannedResponse = await locationPlan;
  const plannedRequest = plannedResponse.request().postDataJSON();
  expect(
    Math.abs(Date.now() - Date.parse(plannedRequest.departure)),
  ).toBeLessThan(30_000);
  expect(plannedRequest.arriveBy).toBeUndefined();
  await expect(locationMarker).toBeVisible();
  await expect(page.getByText(/Device location · ±/)).toBeVisible();
  await expectRouteResults(page);
  await (await selectFirstRoute(page)).click();
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
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await openDeveloperDemos(page);
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.locator(".weather-status time")).toHaveText(/7:40\s*am/i);
  await expect(page.getByLabel("FROM")).toHaveValue(
    "Simulated current location",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const topStatus = (await page.locator(".top-status").boundingBox())!;
  const weatherStatus = (await page.locator(".weather-status").boundingBox())!;
  const pointsCounter = (await page.locator(".points-counter").boundingBox())!;
  const alertControl = (await page
    .locator(".map-controls .icon-button")
    .first()
    .boundingBox())!;
  expect(topStatus.x + topStatus.width).toBeLessThanOrEqual(alertControl.x);
  expect(weatherStatus.y + weatherStatus.height).toBeLessThanOrEqual(
    pointsCounter.y,
  );
  const button = await (await selectFirstRoute(page)).boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
});
test("supports large text and preserves a previously loaded journey offline", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Preferences Travel choices/ })
    .click();
  await page.getByLabel("Larger, easier-to-read text").check();
  await page.getByRole("button", { name: "Apply my preferences" }).click();
  await expect(page.locator("html")).toHaveClass("large-text");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Journey", exact: true })
    .click();
  await expect(await selectFirstRoute(page)).toBeEnabled();
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
  await expect(await selectFirstRoute(page)).toBeEnabled();
  await context.setOffline(false);
});
