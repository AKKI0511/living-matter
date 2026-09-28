import { expect, test } from "./fixtures";
import { cross, snapshot, walkWorld } from "./steering-helpers";

test("ordinary walking completes staggered crossings without warnings", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", m => { if (m.type() === "warning" || m.type() === "error") warnings.push(m.text()); });
  page.on("pageerror", e => warnings.push(e.message));
  await page.goto("/");
  await expect(page.getByText(/(Deterministic preview|Live intelligence)/)).toBeVisible();
  await page.getByRole("button", { name: /Enter the world/ }).click();
  await walkWorld(page);
  expect((await snapshot(page)).phase).toBe("complete");
  expect((await snapshot(page)).recoveries).toBe(0);
  await page.getByRole("button", { name: /Wander again/ }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe("playing");
  expect((await snapshot(page)).recoveries).toBe(0);
  expect(warnings).toEqual([]);
});

test("rolling matter crosses an offset gap and keeps exactly 512 units", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
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
