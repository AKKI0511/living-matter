import { expect, test } from "./fixtures";

test("home needs no WebGL or inference and retains native navigation without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Living Matter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute("href", "https://github.com/AKKI0511/living-matter");
  await expect(page.getByRole("link", { name: "Play", exact: true })).toHaveAttribute("href", "/play");
  await expect(page.locator("canvas")).toHaveCount(0);
  await context.close();
});

test("home/play cycles, Back, pause, preferences and focus clean up the run", async ({ page }) => {
  // Exercise the mouse menu with drag-to-look; locked desktop input uses Escape.
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error("Unavailable")); });
  let decisions = 0;
  page.on("request", r => { if (new URL(r.url()).pathname === "/api/decision") decisions++; });
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole("link", { name: "Play", exact: true }).click();
    await page.getByLabel("Graphics", { exact: true }).selectOption("low");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.keyboard.down("w");
    await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as {player:number[]}).player[2])).toBeLessThan(-1);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const frozen = await page.evaluate(() => window.__livingMatter!.snapshot());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window.__livingMatter!.snapshot() as { time:number }).time)).toBe((frozen as {time:number}).time);
    await page.keyboard.up("w");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    if (cycle === 1) await page.goBack();
    else await page.getByRole("link", { name: "Back to home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await page.evaluate(() => window.__livingMatter)).toBeUndefined();
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await expect(page.getByRole("link", { name: "Play", exact: true })).toBeFocused();
  }
  expect(decisions).toBe(0);
  await page.getByRole("link", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Graphics", { exact: true })).toHaveValue("low");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("focus loss pauses and drag-to-look works when pointer lock is unavailable", async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error("Unavailable")); });
  await page.goto("/play");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.mouse.move(600,300); await page.mouse.down(); await page.mouse.move(800,300); await page.mouse.up();
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});
