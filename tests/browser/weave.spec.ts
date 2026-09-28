import { expect, test } from "./fixtures";
import { cross } from "./steering-helpers";

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
