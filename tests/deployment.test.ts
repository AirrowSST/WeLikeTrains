import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("deployment guardrails", () => {
  it("keeps deployment manual and skips workstation hooks in the container build", () => {
    const workflowDirectory = resolve(root, ".github", "workflows");
    const workflows = existsSync(workflowDirectory)
      ? readdirSync(workflowDirectory)
      : [];
    expect(workflows).toEqual([]);
    expect(readFileSync(resolve(root, "Dockerfile"), "utf8")).toContain(
      "RUN npm ci --ignore-scripts",
    );
  });

  it.each([".gcloudignore", ".dockerignore"])(
    "excludes temporary credentials from %s",
    (filename) => {
      const ignored = readFileSync(resolve(root, filename), "utf8");
      expect(ignored).toContain("gha-creds-*.json");
      expect(ignored).toContain("temp.txt");
    },
  );
});
