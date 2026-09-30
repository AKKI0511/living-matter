import { expect, observeJump, test, type Page } from "./fixtures";
import { go } from "./steering-helpers";
import { sites } from "../../src/game/world";

type Snapshot = {
  time: number;
  player: number[];
  grounded: boolean;
  recoveries: number;
  phase: string;
  states: {
    phase: string;
    kind: string;
    offset: number[];
    rideSince: number;
  }[];
};
const snapshot = (page: Page) =>
  page.evaluate(() => window.__livingMatter!.snapshot() as Snapshot);
async function begin(page: Page) {
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe("playing");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
}
async function walkTo(page: Page, z: number, timeout = 40_000) {
  await page.keyboard.down("w");
  try {
    await expect
      .poll(async () => (await snapshot(page)).player[2], {
        timeout,
        intervals: [80],
      })
      .toBeLessThan(z);
  } finally {
    await page.keyboard.up("w");
  }
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
  await page.screenshot({ path: info.outputPath("complete.png") });
  await page.getByRole("button", { name: /^Play again$/ }).click();
  await expect.poll(async () => (await snapshot(page)).time).toBeLessThan(2);
  const restarted = await snapshot(page);
  expect(restarted.player[2]).toBeGreaterThan(0.5);
  expect(restarted.states.every((s) => s.phase === "idle")).toBe(true);
  expect(restarted.recoveries).toBe(0);
  expect(errors).toEqual([]);
});

test("jump, fall recovery, pause, and detail controls remain usable", async ({
  page,
}) => {
  await begin(page);
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  const jumped = observeJump(page, 1.5);
  await page.keyboard.down("Space");
  await jumped;
  await page.keyboard.up("Space");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.down("d");
  await expect
    .poll(async () => (await snapshot(page)).recoveries, { timeout: 10_000 })
    .toBe(1);
  await page.keyboard.up("d");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Resume$/ })).toBeVisible();
  const frozen = (await snapshot(page)).time;
  await page.waitForTimeout(500);
  expect((await snapshot(page)).time).toBe(frozen);
  const detail = page.getByLabel("Graphics", { exact: true });
  await detail.selectOption("high");
  await expect(detail).toHaveValue("high");
  await page.getByRole("button", { name: /^Restart$/ }).click();
  expect((await snapshot(page)).recoveries).toBe(0);
});

test("waiting to inspect a formation does not repeatedly dissolve it", async ({
  page,
}) => {
  await begin(page);
  await walkTo(page, -22.5);
  await expect
    .poll(async () => (await snapshot(page)).states[0].phase)
    .toBe("active");
  await page.waitForTimeout(7000);
  expect((await snapshot(page)).states[0].phase).toBe("active");
});

test("repeated restarts release scene resources", async ({ page }) => {
  await begin(page);
  await page.keyboard.press("Escape");
  await page.getByLabel("Graphics", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForTimeout(1000);
  const baseline = await page.evaluate(() =>
    window.__livingMatter!.renderInfo(),
  );
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape");
    await page.getByLabel("Graphics", { exact: true }).selectOption("low");
    await page.waitForTimeout(100);
    await page.getByLabel("Graphics", { exact: true }).selectOption("high");
    await page.getByRole("button", { name: /^Restart$/ }).click();
    await page.waitForTimeout(400);
  }
  const final = await page.evaluate(() => window.__livingMatter!.renderInfo());
  expect(final.geometries).toBeLessThanOrEqual(baseline.geometries + 2);
  expect(final.textures).toBeLessThanOrEqual(baseline.textures + 2);
});
