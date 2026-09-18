import { describe, expect, it } from "vitest";
import { meetsDelayAlertThreshold } from "../shared/alerts";

describe("delay alert threshold", () => {
  it("alerts at the configured boundary, including exactly 15 minutes", () => {
    expect(meetsDelayAlertThreshold(15, 15)).toBe(true);
  });

  it("does not alert below the configured threshold", () => {
    expect(meetsDelayAlertThreshold(14, 15)).toBe(false);
    expect(meetsDelayAlertThreshold(5, 6)).toBe(false);
  });

  it("uses custom saved thresholds instead of a fixed 15-minute rule", () => {
    expect(meetsDelayAlertThreshold(6, 6)).toBe(true);
    expect(meetsDelayAlertThreshold(20, 30)).toBe(false);
  });
});
