import { expect, test } from "./fixtures";

test("graphics context loss presents a recoverable error", async ({ page }) => {
  await page.goto("/play");
  await expect(
    page.getByRole("button", { name: /^Play$/ }),
  ).toBeVisible();
  await page.evaluate(() =>
    document
      .querySelector("canvas")!
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context")!
      .loseContext(),
  );
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();
  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(
    page.getByRole("button", { name: /^Play$/ }),
  ).toBeVisible();
});
