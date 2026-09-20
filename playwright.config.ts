import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  workers: 1,
  expect: { timeout: 12_000 },
  use: {
    baseURL: process.env.PLAYTEST_URL || "http://localhost:3000",
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
