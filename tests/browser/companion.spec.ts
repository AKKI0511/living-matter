import { expect, observeJump, test, type Page } from "./fixtures";
import { sites, structureBoxes } from "../../src/game/world";
import { go } from "./steering-helpers";

const snap = (page: Page) => page.evaluate(() => window.__livingMatter!.snapshot() as {
  time: number; player: number[]; grounded: boolean; recoveries: number;
  constellation: number; states: { phase: string; offset: number[] }[];
});

async function begin(page: Page) {
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
}

async function simulateFor(page: Page, seconds: number) {
  const until = (await snap(page)).time + seconds;
  await page.waitForFunction((target) =>
    (window.__livingMatter!.snapshot() as { time: number }).time >= target,
  until, { polling: "raf", timeout: 12000 });
}

test("free movement relative to a travelling platform, including reversing and jumping", async ({ page }) => {
  await begin(page);
  const site = sites[2];
  await page.evaluate(({ start }) => {
    window.__livingMatter!.teleport([start[0], start[1] + 1, start[2] + 2]);
    window.__livingMatter!.formation(2, "platform");
  }, { start: site.start });
  await expect.poll(async () => (await snap(page)).states[2].phase).toBe("active");
  await go(page, structureBoxes(site, "platform")[0].position);
  await expect.poll(async () => (await snap(page)).states[2].offset[2]).toBeLessThan(-4);
  await page.evaluate(() => window.__livingMatter!.look(0, 0));
  const relative = async () => {
    const s = await snap(page);
    return [s.player[0] - s.states[2].offset[0], s.player[2] - s.states[2].offset[2]];
  };
  let before = await relative();
  await page.keyboard.down("d");
  await simulateFor(page, 0.28);
  await page.keyboard.up("d");
  let after = await relative();
  expect(after[0] - before[0]).toBeGreaterThan(0.6);
  before = await relative();
  await page.keyboard.down("a");
  await simulateFor(page, 0.4);
  await page.keyboard.up("a");
  after = await relative();
  expect(after[0] - before[0]).toBeLessThan(-0.6);
  before = await relative();
  await page.keyboard.down("s");
  await simulateFor(page, 0.25);
  await page.keyboard.up("s");
  after = await relative();
  expect(after[1] - before[1]).toBeGreaterThan(0.45);
  before = await relative();
  await page.keyboard.down("w");
  await simulateFor(page, 0.35);
  await page.keyboard.up("w");
  after = await relative();
  expect(after[1] - before[1]).toBeLessThan(-0.5);
  const jumped = observeJump(page);
  await page.keyboard.press("Space");
  await jumped;
  await expect.poll(async () => (await snap(page)).grounded).toBe(true);
  expect((await snap(page)).recoveries).toBe(0);
});

test("night sky and controls stay legible", async ({ page }, info) => {
  await begin(page);
  await go(page, [0, 0, -12]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Switch to day" })).toBeVisible();
  await page.getByRole("button", { name: /^Resume$/ }).click();
  await page.evaluate(() => window.__livingMatter!.look(0.15, 0.55));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: info.outputPath("memory-sky.png") });
  expect(await page.locator(".pause").evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(15);
  await page.keyboard.press("t");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Switch to night" })).toBeVisible();
});

test("unselected bridge colliders cannot support a player over open air", async ({ page }) => {
  await begin(page);
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 2, -36]);
    window.__livingMatter!.formation(0, "platform");
  });
  await expect.poll(async () => (await snap(page)).recoveries, { timeout: 5000, intervals: [50] }).toBe(1);
});
