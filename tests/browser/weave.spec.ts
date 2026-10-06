import { expect, test } from "./fixtures";
import { cross, snapshot } from "./steering-helpers";

test("small glances keep the next half usable through the first handoff", async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error("Drag fallback")); });
  await page.goto("/play");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, .825, -23]); window.__livingMatter!.formation(0, "weave"); });
  await expect.poll(async () => (await snapshot(page)).states[0].phase).toBe("active");
  const initial = (await snapshot(page)).weave!;
  const first = initial.banks[0], next = initial.banks[1];
  const position = first.from.map((v, i) => v * .14 + first.to[i] * .86 + (i === 1 ? .885 : 0));
  const yaw = Math.atan2(-(first.to[0] - first.from[0]), -(first.to[2] - first.from[2]));
  await page.evaluate(({ position, yaw }) => { window.__livingMatter!.teleport(position as [number, number, number]); window.__livingMatter!.look(yaw, .23); }, { position, yaw });
  await expect.poll(async () => (await snapshot(page)).player[2]).toBeLessThan(-29);
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  const time = await page.evaluate(() => (window.__livingMatter!.snapshot() as { time: number }).time);
  await page.waitForFunction(time => (window.__livingMatter!.snapshot() as { time: number }).time > time + .65, time);
  expect((await snapshot(page)).weave!.banks).toEqual(initial.banks);
  const target = next.from.map((v, i) => v * .3 + next.to[i] * .7);
  const walked = page.waitForFunction(({ target, next }) => {
    const state = window.__livingMatter!.snapshot() as {
      player: number[]; recoveries: number; weave: { banks: unknown[] };
    };
    const p = state.player;
    if (state.recoveries !== 0) throw new Error("The handoff recovered the player");
    if (JSON.stringify(state.weave.banks[1]) !== JSON.stringify(next))
      throw new Error("The approaching half changed during the handoff");
    if (Math.hypot(p[0] - target[0], p[2] - target[2]) < .65) return true;
    // Steer and inspect the same frame so slow protocol samples cannot turn
    // a small glance into an unintended reversal after passing the target.
    window.__livingMatter!.look(
      Math.atan2(-(target[0] - p[0]), -(target[2] - p[2])) + Math.sin(p[2] * 3) * .06,
      Math.sin(p[2]) * .26,
    );
    return false;
  }, { target, next }, { polling: "raf", timeout: 25_000 });
  await page.keyboard.down("w");
  try {
    await walked;
  } finally { await page.keyboard.up("w"); }
  expect((await snapshot(page)).grounded).toBe(true);
});

test("rolling matter crosses an offset gap and keeps exactly 512 units", async ({ page }) => {
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 1, -23]);
    window.__livingMatter!.formation(0, "weave");
  });
  await cross(page, 0);
  const result = await page.evaluate(() => window.__livingMatter!.snapshot() as {
    recoveries: number; matterUnits: number; matterMeshes: number; weave: { revision: number };
  });
  expect(result.recoveries).toBe(0);
  expect(result.matterUnits).toBe(512);
  expect(result.matterMeshes).toBe(1);
  expect(result.weave.revision).toBeGreaterThanOrEqual(2);
});
