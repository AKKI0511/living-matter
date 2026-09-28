import { test, expect } from "./fixtures";
import { go, snapshot } from "./steering-helpers";
import { architectureBoxes, columns } from "../../src/game/world";

for (const x of [-6.4, -8.7]) {
  test(`offset approach ${x} leaves the first shore on adjacent matter`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Enter the world/ }).click();
    await page.evaluate(x => {
      window.__livingMatter!.teleport([x, 0.825, -23.8]);
      window.__livingMatter!.look(0.3, -0.2);
    }, x);
    await expect.poll(async () => (await snapshot(page)).states[0].phase).toBe("active");
    const first = (await snapshot(page)).weave!.banks[0];
    expect(Math.abs(first.from[0] - x)).toBeLessThanOrEqual(2.4);
    await go(page, first.from.map((v, i) => v * 0.4 + first.to[i] * 0.6));
    // This checks the shore seam, not which later branch a changing gaze asks
    // for while the other half is being recycled.
    expect((await snapshot(page)).player[2]).toBeLessThan(-27);
    expect((await snapshot(page)).recoveries).toBe(0);
  });
}

test("shore pillars and formerly decorative columns stop physical movement", async ({ page }) => {
  await page.route("**/api/decision**", route => route.fulfill({ json: { candidateId: null, hold: true } }));
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  const obstacles = architectureBoxes.filter((_, i) => i !== 2).map((b, i) => ({
    x: b.position[0], z: b.position[2], half: b.size[0] / 2,
    top: i < 3 ? 0 : 6, side: b.position[0] === 7.8 || b.position[0] === -7.2 || b.position[0] === -5 ? -1 : 1,
  }));
  for (const c of columns.slice(3, 6)) obstacles.push({ x: c.position[0], z: c.position[2], half: 0.9, top: 6, side: 1 });
  for (const o of obstacles) {
    await page.evaluate(o => {
      window.__livingMatter!.teleport([o.x + o.side * 3, o.top + 0.825, o.z]);
      window.__livingMatter!.look(o.side * Math.PI / 2, 0);
    }, o);
    await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
    await page.bringToFront();
    await page.keyboard.down("w");
    await expect.poll(async () => Math.abs((await snapshot(page)).player[0] - (o.x + o.side * 3)), { timeout: 6000 })
      .toBeGreaterThan(0.3);
    await page.waitForTimeout(900);
    await page.keyboard.up("w");
    const state = await snapshot(page);
    expect((state.player[0] - o.x) * o.side).toBeGreaterThan(o.half + 0.2);
    expect((state.player[0] - o.x) * o.side).toBeLessThan(2);
    expect(state.recoveries).toBe(0);
  }
  // The solid ring is also reachable from beside the completion area.
  await page.evaluate(() => {
    window.__livingMatter!.teleport([4, 6.825, -206]);
    window.__livingMatter!.look(0, 0);
  });
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.down("w");
  await page.waitForTimeout(2000);
  await page.keyboard.up("w");
  const atRing = await snapshot(page);
  // A rounded contact slides the capsule sideways around the ring's lower arc.
  expect(Math.abs(atRing.player[0] - 4)).toBeGreaterThan(0.8);
  expect(atRing.recoveries).toBe(0);
  expect(atRing.phase).toBe("playing");
});
