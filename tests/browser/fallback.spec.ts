import { expect, test } from "./fixtures";

test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "Requires the live-mode bundle; every service response is mocked.");

const state = (page: import("@playwright/test").Page) => page.evaluate(() => window.__livingMatter!.snapshot() as { states: { phase: string }[]; player: number[]; grounded: boolean });

test("a rate-limited run keeps forming in preview and its notice is only shown during play", async ({ page }) => {
  await page.route("**/api/decision", route => route.fulfill({ status: 429, headers: { "Retry-After": "60" }, json: { error: "busy" } }));
  await page.goto("/");
  await expect(page.getByLabel("Preview mode", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, .825, -23]); window.__livingMatter!.look(.6, 0); });
  const notice = page.getByLabel("Preview mode", { exact: true });
  await expect(notice).toBeVisible();
  await expect.poll(async () => (await state(page)).states[0].phase).toBe("active");
  await page.screenshot({ path: "artifacts/fallback-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.keyboard.press("h");
  await expect(notice).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, .825, -23]); window.__livingMatter!.look(.6, 0); });
  await expect.poll(async () => (await state(page)).states[0].phase).toBe("active");
  await expect(notice).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(notice).toHaveCount(0);
});

test("a timeout falls back, the notice expires, and live recovery clears it", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/decision", async route => {
    calls++;
    if (calls === 1) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      await route.fulfill({ status: 503 }).catch(() => {});
    } else await route.fulfill({ json: { candidateId: null, hold: true } });
  });
  await page.goto("/play");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, .825, -23]); window.__livingMatter!.look(.6, 0); });
  const notice = page.getByLabel("Preview mode", { exact: true });
  await expect(notice).toBeVisible();
  await expect.poll(async () => (await state(page)).states[0].phase).toBe("active");
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
  // A new physical question after the cooldown triggers a live probe.
  await page.evaluate(() => { window.__livingMatter!.teleport([-21.5, .825, -57]); window.__livingMatter!.look(Math.PI / 2, 0); });
  await expect.poll(() => calls).toBeGreaterThan(1);
  await expect(notice).toHaveCount(0);
});
