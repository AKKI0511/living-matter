import { expect, test } from "./fixtures";
import { snapshot, go } from "./steering-helpers";

test("a player can depart west from the starting island and turn north in open water", async ({ page }) => {
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  // The new west overlook is permanent ground; depart beyond its southern end.
  await page.evaluate(() => { window.__livingMatter!.teleport([-9, 0.825, -16]); window.__livingMatter!.look(Math.PI / 2, 0); });
  await expect.poll(async () => (await snapshot(page)).states.some(s => s.phase === "active")).toBe(true);
  const initial = (await snapshot(page)).weave!;
  expect(initial.banks[0].to[0]).toBeLessThan(-15);
  const occupied = initial.banks[1];
  const along = occupied.from.map((v, i) => v * 0.35 + occupied.to[i] * 0.65);
  const revision = initial.revision;
  // Place the player on the western half before turning. Steering tests cover
  // walking; this test isolates the decision to build north from open water.
  await page.evaluate(p => { window.__livingMatter!.teleport([p[0], p[1] + 0.885, p[2]]); window.__livingMatter!.look(0, 0); }, along);
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await expect.poll(async () => (await snapshot(page)).weave!.revision).toBeGreaterThan(revision);
  const state = (await snapshot(page)).weave!;
  expect(state.banks[1]).toEqual(occupied);
  expect(state.banks[0].to[2]).toBeLessThan(occupied.to[2] - 5);
  expect((await snapshot(page)).grounded).toBe(true);
});

for (const side of [-1, 1]) test(`an inclined side connector is traversable on side ${side}`, async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "This physical join check needs the mocked live transport to select the specified side; preview can legitimately choose nearby land.");
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([-14, 0.825, -67]); window.__livingMatter!.formation(1, "weave", 0); });
  await expect.poll(async () => (await snapshot(page)).states[1].phase).toBe("active");
  const original = (await snapshot(page)).weave!.banks[0];
  const middle = original.from.map((v, i) => (v + original.to[i]) / 2);
  const dx = original.to[0] - original.from[0], dz = original.to[2] - original.from[2];
  const direction = [-dz * side, dx * side];
  // Ask for this physical side join explicitly; selection preference is checked
  // separately by the journey tests, which may legitimately prefer nearby land.
  await page.route("**/api/decision", async route => {
    const candidates = route.request().postDataJSON().candidates as { id: string; attachment?: string; physical: { from: number[]; to: number[] } }[];
    const branch = candidates.find(c => c.attachment === "middle" &&
      (c.physical.to[0] - c.physical.from[0]) * direction[0] + (c.physical.to[2] - c.physical.from[2]) * direction[1] > 0);
    await route.fulfill({ json: branch ? { candidateId: branch.id } : { candidateId: null, hold: true } });
  });
  await page.evaluate(({ p, yaw }) => { window.__livingMatter!.teleport([p[0], p[1] + 0.885, p[2]]); window.__livingMatter!.look(yaw, 0); }, { p: middle, yaw: Math.atan2(-direction[0], -direction[1]) });
  await expect.poll(async () => (await snapshot(page)).weave!.revision).toBeGreaterThan(0);
  const branch = (await snapshot(page)).weave!.banks[1];
  expect((await snapshot(page)).weave!.banks[0]).toEqual(original);
  expect(Math.hypot(branch.from[0] - middle[0], branch.from[2] - middle[2])).toBeCloseTo(1.8);
  expect(Math.abs(branch.crossSlope!)).toBeGreaterThan(0.3);
  // Keep this physics check on the same two sections; the journey tests cover recycling.
  await page.route("**/api/decision", route => route.fulfill({ json: { candidateId: null, hold: true } }));
  await page.waitForTimeout(1800);
  await go(page, branch.from.map((v, i) => v * 0.3 + branch.to[i] * 0.7));
  await go(page, middle);
  expect((await snapshot(page)).recoveries).toBe(0);
});
