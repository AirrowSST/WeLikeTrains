import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { PlanResponse } from "../../shared/types";

async function useDeterministicPlans(page: Page) {
  let template: PlanResponse | undefined;
  await page.route("**/api/plan", async (route) => {
    const request = route.request().postDataJSON();
    if (!template) {
      const response = await route.fetch({
        postData: JSON.stringify({
          ...request,
          dataMode: "demo",
        }),
      });
      if (!response.ok())
        throw new Error(`Fixture plan request failed: HTTP ${response.status()}`);
      template = await response.json();
    }
    const plan = template;
    if (!plan) throw new Error("Fixture plan was not created.");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...plan,
        request,
        conditions: { ...plan.conditions, mode: request.dataMode },
      }),
    });
  });
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
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
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
  await expect(page.locator(".journey-map")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-journey.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save route", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.getByRole("button", { name: "Start", exact: true }).click();
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
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
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
test("shows labelled simulated location and follows manual demo progress", async ({
  page,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Demo mode", exact: true }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await page
    .getByRole("button", { name: "Use simulated location" })
    .click();
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
  await page.getByRole("button", { name: "Start", exact: true }).click();
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
  await context.grantPermissions(["geolocation"], {
    origin: "http://localhost:8080",
  });
  await context.setGeolocation({ latitude: 1.3521, longitude: 103.9398 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
  await expect(page.locator(".demo-toolbar")).toContainText("Live LTA + NEA");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByLabel("FROM")).toHaveValue("Current location");
  await expect(page.locator(".current-location-marker.device")).toBeVisible();
  await expect(page.getByText(/Device location · ±/)).toBeVisible();
  await expect(page.locator(".route-options")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Start live location" }).click();
  await expect(page.getByRole("dialog")).toContainText("Live location on");
});
test("fits a narrow phone without horizontal overflow", async ({ page }) => {
  await useDeterministicPlans(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Demo mode", exact: true }).click();
  await page.getByRole("button", { name: "Start demo" }).click();
  await page
    .getByRole("button", { name: "Use simulated location" })
    .click();
  await expect(page.getByText("Simulated location active")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const button = await page
    .getByRole("button", { name: "Start directions" })
    .boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
});
test("supports large text and preserves a previously loaded journey offline", async ({
  page,
  context,
}) => {
  await useDeterministicPlans(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Open profile and preferences" })
    .click();
  await page.getByLabel("Larger, easier-to-read text").check();
  await page.getByRole("button", { name: "Apply my preferences" }).click();
  await expect(page.locator("html")).toHaveClass("large-text");
  await expect(
    page.getByRole("button", { name: "Start directions" }),
  ).toBeEnabled();
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
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeEnabled();
  await context.setOffline(false);
});
