import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("plans, compares, saves, interviews preferences and shows planned notices", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start my journey" }),
  ).toBeEnabled();
  await expect(page.locator(".demo-toolbar")).toContainText("Demo experience");
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
  expect(recommendation!.y).toBeLessThan(planner!.y);
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
  await page.getByLabel("Demo scenario").selectOption("normal");
  await expect(
    page.getByText("You’re on the right track.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save this commute", exact: false })
    .click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.getByRole("button", { name: "Start my journey" }).click();
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
    .getByRole("button", { name: "Network updates", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Plan ahead: EWL evening maintenance" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("mobile interface passes automated WCAG A/AA checks", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start my journey" }),
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
test("fits a narrow phone without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start my journey" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const button = await page
    .getByRole("button", { name: "Find my best route" })
    .boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
});
test("supports large text and preserves a previously loaded journey offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start my journey" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Open profile and preferences" })
    .click();
  await page.getByLabel("Larger, easier-to-read text").check();
  await page.getByRole("button", { name: "Apply my preferences" }).click();
  await expect(page.locator("html")).toHaveClass("large-text");
  await expect(
    page.getByRole("button", { name: "Find my best route" }),
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
    page.getByRole("button", { name: "Start my journey" }),
  ).toBeEnabled();
  await context.setOffline(false);
});
