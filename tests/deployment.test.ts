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

  it("keeps full verification as the default and makes fast deployment explicit", () => {
    const deployScript = readFileSync(
      resolve(root, "scripts", "deploy-code.ps1"),
      "utf8",
    );
    const packageScripts = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ).scripts;

    expect(deployScript).toContain("[ValidateSet('Full', 'Fast')]");
    expect(deployScript).toContain("$VerificationMode = 'Full'");
    expect(deployScript).toContain("'verify:deploy:fast'");
    expect(deployScript).toContain("wayce-verification");
    expect(deployScript).toContain("wayce-source");
    expect(packageScripts["verify:deploy:fast"]).toBe(
      "npm run build && npm test",
    );
  });

  it("isolates Playwright runs instead of sharing a fixed test port", () => {
    const config = readFileSync(resolve(root, "playwright.config.ts"), "utf8");
    const runner = readFileSync(
      resolve(root, "scripts", "run-e2e.mjs"),
      "utf8",
    );
    const packageScripts = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ).scripts;

    expect(config).toContain("WAYCE_E2E_PORT");
    expect(config).not.toContain('const e2eBaseUrl = "http://localhost:8081"');
    expect(runner).toContain('listen(0, "127.0.0.1"');
    expect(runner).toContain("WAYCE_E2E_PORT");
    expect(runner).toContain("WAYCE_E2E_RUN_ID");
    expect(config).toContain("outputDir");
    expect(packageScripts["test:e2e:run"]).toContain("scripts/run-e2e.mjs");
  });
});
