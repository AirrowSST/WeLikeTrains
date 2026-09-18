import { defineConfig, devices } from "@playwright/test";

const requestedPort = Number.parseInt(process.env.WAYCE_E2E_PORT ?? "", 10);
const e2ePort =
  Number.isInteger(requestedPort) &&
  requestedPort >= 1024 &&
  requestedPort <= 65535
    ? requestedPort
    : 8081;
const e2eBaseUrl = `http://localhost:${e2ePort}`;
const e2eRunId = (process.env.WAYCE_E2E_RUN_ID ?? "direct")
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-");

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: `test-results/playwright-${e2eRunId}`,
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 30000 },
  use: { baseURL: e2eBaseUrl, trace: "retain-on-failure" },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    {
      name: "wide-screen-mobile-ui",
      use: { viewport: { width: 1440, height: 1050 } },
    },
  ],
  webServer: {
    command: "node dist-server/index.js",
    url: `${e2eBaseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DISABLE_RATE_LIMITS: "true",
      NODE_ENV: "e2e",
      PORT: String(e2ePort),
    },
  },
});
