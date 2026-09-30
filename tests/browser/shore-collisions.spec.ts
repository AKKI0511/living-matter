import { test, expect } from "./fixtures";
import { go, snapshot } from "./steering-helpers";
import { architectureBoxes, columns, walkableGround } from "../../src/game/world";

for (const x of [-6.4, -8.7]) {
  test(`offset approach ${x} leaves the first shore on adjacent matter`, async ({ page }) => {
    await page.goto("/play");
    await page.getByRole("button", { name: /^Play$/ }).click();
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
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  const obstacles = architectureBoxes.flatMap(b => {
    const ground=walkableGround.find(g => Math.abs(b.position[0]-g.position[0])<=g.size[0]/2 && Math.abs(b.position[2]-g.position[2])<g.size[2]/2 && b.position[1]-b.size[1]/2<=g.position[1]+g.size[1]/2+.1);
    if(!ground || b.size[1]<1 || b.size[0]>3)return [];
    return [{x:b.position[0],z:b.position[2],half:b.size[0]/2,top:ground.position[1]+ground.size[1]/2,side:b.position[0]>ground.position[0]?-1:1,round:false}];
  });
  for (const c of columns.slice(3, 6)) obstacles.push({ x: c.position[0], z: c.position[2], half: c.bottomRadius, top: 6, side: 1, round: true });
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
    if (o.round) {
      expect(Math.hypot(state.player[0] - o.x, state.player[2] - o.z)).toBeGreaterThan(o.half + 0.1);
      expect(Math.hypot(state.player[0] - o.x, state.player[2] - o.z)).toBeLessThan(4);
    } else {
      expect((state.player[0] - o.x) * o.side).toBeGreaterThan(o.half + 0.2);
      expect((state.player[0] - o.x) * o.side).toBeLessThan(2);
    }
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
  // A rounded contact can either stop or slide the capsule at the lower arc.
  expect(atRing.player[2] > -211.5 || Math.abs(atRing.player[0] - 4) > 0.2).toBe(true);
  expect(atRing.phase).toBe("playing");
});
