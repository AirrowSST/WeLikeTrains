import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 30000 },
  use: { baseURL: "http://localhost:8080", trace: "retain-on-failure" },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    {
      name: "wide-screen-mobile-ui",
      use: { viewport: { width: 1440, height: 1050 } },
    },
  ],
  webServer: {
    command: "npm start",
    url: "http://localhost:8080/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
