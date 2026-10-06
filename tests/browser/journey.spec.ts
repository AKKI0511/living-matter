import { expect, observeJump, test, type Page } from "./fixtures";
import { go, snapshot } from "./steering-helpers";
import { sites } from "../../src/game/world";

async function begin(page: Page) {
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe("playing");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
}

test("each crossing can form before arrival completes and restarts", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error" || e.type() === "warning") errors.push(`${e.text()} ${e.location().url}`);
  });
  await begin(page);
  await page.screenshot({ path: info.outputPath("arrival.png") });
  // The formation specs physically traverse the crossings. Here each stage
  // starts from a stable shore so completion and restart do not depend on a
  // scripted bot steering every live branch that preview can offer.
  for (let i = 0; i < sites.length; i++) {
    await page.evaluate(index => window.__livingMatter!.formation(index, "weave"), i);
    await expect.poll(async () => (await snapshot(page)).states[i].phase).toBe("active");
    await page.evaluate(end => window.__livingMatter!.teleport([end[0], end[1] + 0.825, end[2] - 2]), sites[i].end);
    await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  }
  await go(page, [10, 6, -202], 0.5);
  await expect(
    page.getByRole("button", { name: /^Play again$/ }),
  ).toBeVisible();
  const finished = await snapshot(page);
  expect(finished.phase).toBe("complete");
  await expect(page.locator(".menu :focus")).toHaveCount(0);
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await page.keyboard.press("w");
  expect((await snapshot(page)).phase).toBe("complete");
  expect((await snapshot(page)).time).toBe(finished.time);
  await page.screenshot({ path: info.outputPath("complete.png") });
  await page.getByRole("button", { name: /^Play again$/ }).click();
  await expect.poll(async () => (await snapshot(page)).time).toBeLessThan(2);
  const restarted = await snapshot(page);
  expect(restarted.player[2]).toBeGreaterThan(0.5);
  expect(restarted.states.every((s) => s.phase === "idle")).toBe(true);
  expect(restarted.recoveries).toBe(0);
  expect(errors).toEqual([]);
});

test("jump, fall recovery, pause and restart remain usable", async ({
  page,
}) => {
  await begin(page);
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  const jumped = observeJump(page, 1.5);
  await page.keyboard.down("Space");
  await jumped;
  await page.keyboard.up("Space");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  // Only the selected platform may collide; the unselected bridge over this
  // water must not catch the player and prevent checkpoint recovery.
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 2, -36]);
    window.__livingMatter!.formation(0, "platform");
  });
  await expect
    .poll(async () => (await snapshot(page)).recoveries, { timeout: 10_000 })
    .toBe(1);
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Resume$/ })).toBeVisible();
  const frozen = (await snapshot(page)).time;
  await page.waitForTimeout(500);
  expect((await snapshot(page)).time).toBe(frozen);
  await page.getByRole("button", { name: /^Restart$/ }).click();
  expect((await snapshot(page)).recoveries).toBe(0);
});
