import { defineConfig, devices } from "@playwright/test";

const e2eBaseUrl = "http://localhost:8081";

export default defineConfig({
  testDir: "./tests/browser",
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
    env: { DISABLE_RATE_LIMITS: "true", NODE_ENV: "e2e", PORT: "8081" },
  },
});
