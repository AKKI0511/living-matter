import { expect, test, type Page } from "./fixtures";
import { sites, type FormationKind } from "../../src/game/world";
type Snapshot = {
  time: number;
  player: number[];
  grounded: boolean;
  recoveries: number;
  states: { phase: string; offset: number[]; rideSince: number }[];
};
const snapshot = (page: Page) =>
  page.evaluate(() => window.__livingMatter!.snapshot() as Snapshot);

for (const [index, kind] of [
  [0, "platform"],
  [1, "platform"],
  [2, "bridge"],
  [3, "platform"],
] as [number, FormationKind][]) {
  test(`${sites[index].id} also supports ${kind} with real traversal`, async ({
    page,
  }, info) => {
    const site = sites[index];
    await page.goto("/");
    await page.getByRole("button", { name: /Enter the world/ }).click();
    await page.evaluate(
      ({ index, kind, start }) => {
        window.__livingMatter!.teleport([start[0], start[1] + 1, start[2] + 7]);
        window.__livingMatter!.formation(index, kind);
      },
      { index, kind, start: site.start },
    );
    await expect
      .poll(async () => (await snapshot(page)).states[index].phase)
      .toBe("active");
    if (kind === "platform") {
      await page.keyboard.down("w");
      await expect
        .poll(async () => (await snapshot(page)).player[2], { intervals: [50] })
        .toBeLessThan(site.start[2] - 1.3);
      await page.keyboard.up("w");
      await expect
        .poll(async () => (await snapshot(page)).player[2], {
          timeout: 18_000,
          intervals: [100],
        })
        .toBeLessThan(site.end[2] + 4);
    }
    await page.keyboard.down("w");
    await expect
      .poll(async () => (await snapshot(page)).player[2], {
        timeout: 12_000,
        intervals: [80],
      })
      .toBeLessThan(site.end[2] - 4);
    await page.keyboard.up("w");
    await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
    await info.attach("landing-state", {
      body: JSON.stringify(await snapshot(page)),
      contentType: "application/json",
    });
    await expect
      .poll(async () => (await snapshot(page)).player[1], { timeout: 4000 })
      .toBeLessThan(site.end[1] + 1);
    const state = await snapshot(page);
    expect(state.recoveries).toBe(0);
    expect(state.player[1]).toBeGreaterThan(site.end[1] + 0.7);
    expect(state.player[1]).toBeLessThan(site.end[1] + 1);
  });
}

test("largest formation keeps a stable render loop", async ({ page }, info) => {
  test.skip(
    !!process.env.CI,
    "Frame-time budgets require a hardware-accelerated browser.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([7, 7, -151]);
    window.__livingMatter!.look(0.55, -0.2);
  });
  await page.waitForTimeout(4500);
  await page.evaluate(() =>
    window.__livingMatter!.formation(3, "floating-path"),
  );
  const measurement = page.evaluate(
    () =>
      new Promise<{
        median: number;
        p95: number;
        over50ms: number;
        frames: number;
      }>((resolve) => {
        const intervals: number[] = [];
        let previous = performance.now(),
          elapsed = 0;
        function frame(now: number) {
          const delta = now - previous;
          previous = now;
          elapsed += delta;
          intervals.push(delta);
          if (elapsed < 5000) requestAnimationFrame(frame);
          else {
            const sorted = intervals.slice().sort((a, b) => a - b);
            resolve({
              median: sorted[Math.floor(sorted.length / 2)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              over50ms: sorted.filter((n) => n > 50).length,
              frames: sorted.length,
            });
          }
        }
        requestAnimationFrame(frame);
      }),
  );
  await page.waitForTimeout(1700);
  await page.screenshot({ path: info.outputPath("transformation.png") });
  const timing = await measurement;
  console.log("Transformation frame times:", timing);
  await info.attach("frame-times", {
    body: JSON.stringify(timing),
    contentType: "application/json",
  });
  expect(timing.p95).toBeLessThan(50);
  expect(timing.frames).toBeGreaterThan(150);
});

test("jumping aboard a moving platform preserves transport momentum", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 7, -104]);
    window.__livingMatter!.formation(2, "platform");
  });
  await expect
    .poll(async () => (await snapshot(page)).states[2].phase)
    .toBe("active");
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await snapshot(page)).player[2], { intervals: [50] })
    .toBeLessThan(-112.3);
  await page.keyboard.up("w");
  await expect
    .poll(async () => (await snapshot(page)).states[2].offset[2], {
      intervals: [50],
    })
    .toBeLessThan(-8);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await snapshot(page)).grounded, { intervals: [50] })
    .toBe(false);
  await expect
    .poll(async () => (await snapshot(page)).grounded, { intervals: [50] })
    .toBe(true);
  expect((await snapshot(page)).recoveries).toBe(0);
  await page.waitForTimeout(1500);
  expect((await snapshot(page)).recoveries).toBe(0);
});
