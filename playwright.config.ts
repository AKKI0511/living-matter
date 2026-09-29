import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  expect: { timeout: process.env.CI ? 30_000 : 12_000 },
  use: {
    baseURL: process.env.PLAYTEST_URL || "http://localhost:3000",
    channel: process.env.CI ? "chromium" : "chrome",
    headless: true,
    viewport: process.env.CI ? { width: 640, height: 400 } : { width: 1440, height: 900 },
    deviceScaleFactor: process.env.CI ? 0.5 : 1,
    launchOptions: process.env.CI ? {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    } : undefined,
    screenshot: "only-on-failure",
    video: process.env.CI ? "off" : "retain-on-failure",
    // Software-rendered CI stalls on GPU readback. Keep action/network traces
    // and failure screenshots without snapshots or screencasting every frame.
    trace: { mode: "retain-on-failure", screenshots: !process.env.CI, snapshots: !process.env.CI, sources: true },
  },
  webServer: process.env.PLAYTEST_URL ? undefined : {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
