import { expect, observeJump, test, type Page } from "./fixtures";
import { sites } from "../../src/game/world";
import { boardPlatform, snapshot as snap } from "./steering-helpers";

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
  await boardPlatform(page, 2);
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
