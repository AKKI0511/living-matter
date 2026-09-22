import { expect, test } from "@playwright/test";

test("rolling matter crosses a gap, recycles behind, and keeps exactly 512 units", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 1, -23]);
    window.__livingMatter!.formation(0, "weave");
    window.__livingMatter!.look(0, 0);
  });
  const snapshot = () =>
    page.evaluate(
      () =>
        window.__livingMatter!.snapshot() as {
          player: number[];
          recoveries: number;
          matterUnits: number;
          states: { phase: string }[];
          weave: { revision: number; banks: { segment: number }[] };
        },
    );
  await expect
    .poll(async () => (await snapshot()).states[0].phase)
    .toBe("active");
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await snapshot()).player[2], { timeout: 20000 })
    .toBeLessThan(-46);
  await page.keyboard.up("w");
  const result = await snapshot();
  expect(result.recoveries).toBe(0);
  expect(result.matterUnits).toBe(512);
  expect(result.weave.revision).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("t");
  await page.screenshot({ path: "artifacts/weave-night.png" });
  expect(errors).toEqual([]);
});

test("curved elevated matter rebuilds behind a player who doubles back", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 1, -23]);
    window.__livingMatter!.formation(0, "weave", 1);
  });
  const snapshot = () =>
    page.evaluate(
      () =>
        window.__livingMatter!.snapshot() as {
          player: number[];
          recoveries: number;
          states: { phase: string }[];
          weave: {
            revision: number;
            route: number[][];
            banks: { segment: number }[];
          };
        },
    );
  await expect
    .poll(async () => (await snapshot()).states[0].phase)
    .toBe("active");
  async function go(target: number[]) {
    const until = Date.now() + 14000;
    try {
      await page.keyboard.down("w");
      while (Date.now() < until) {
        const p = (await snapshot()).player;
        if (Math.hypot(p[0] - target[0], p[2] - target[2]) < 0.35) return;
        const yaw = Math.atan2(-(target[0] - p[0]), -(target[2] - p[2]));
        await page.evaluate((y) => window.__livingMatter!.look(y, 0), yaw);
        await page.waitForTimeout(65);
      }
      throw new Error("Could not reach curved waypoint");
    } finally {
      await page.keyboard.up("w");
    }
  }
  const route = (await snapshot()).weave.route;
  await go(route[1]);
  await go(route[1].map((v, i) => (v + route[2][i]) / 2));
  await expect
    .poll(async () => (await snapshot()).weave.revision)
    .toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/weave-curved.png" });
  await go(route[1]);
  await go(route[0]);
  await go([0, 0, -23]);
  const result = await snapshot();
  expect(result.recoveries).toBe(0);
  expect(result.weave.banks.some((b) => b.segment === 0)).toBe(true);
});
