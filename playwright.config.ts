import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  expect: { timeout: 12_000 },
  use: {
    baseURL: process.env.PLAYTEST_URL || "http://localhost:3000",
    channel: process.env.CI ? "chromium" : "chrome",
    headless: !process.env.CI,
    viewport: process.env.CI ? { width: 800, height: 500 } : { width: 1440, height: 900 },
    deviceScaleFactor: process.env.CI ? 0.5 : 1,
    launchOptions: process.env.CI ? {
      args: ["--use-gl=angle", "--use-angle=gl", "--use-cmd-decoder=passthrough"],
    } : undefined,
    screenshot: "only-on-failure",
    video: process.env.CI ? "off" : "retain-on-failure",
    // Software-rendered CI stalls on GPU readback. Keep action/network traces
    // and failure screenshots without snapshots or screencasting every frame.
    trace: { mode: "retain-on-failure", screenshots: !process.env.CI, snapshots: !process.env.CI, sources: true },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
