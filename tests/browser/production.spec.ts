import { expect, test } from "@playwright/test";

test("production preview plays through without debug hooks or external services", async ({
  page,
}, info) => {
  test.skip(
    !process.env.PLAYTEST_URL,
    "Set PLAYTEST_URL to a running preview-mode production server.",
  );
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(`${message.text()} ${message.location().url}`);
  });
  page.on("request", (request) => {
    if (
      request.url().startsWith("http") &&
      !request.url().startsWith(process.env.PLAYTEST_URL!)
    )
      external.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  expect(await page.evaluate(() => window.__livingMatter)).toBeUndefined();
  await page.keyboard.press("t");
  await expect(
    page.getByRole("button", { name: "Switch to day" }),
  ).toBeVisible();
  await page.keyboard.down("w");
  await page.waitForTimeout(28_000);
  await page.keyboard.up("w");
  await page.screenshot({ path: info.outputPath("boarding.png") });
  await page.waitForTimeout(6000);
  await page.keyboard.down("w");
  await expect(page.getByRole("button", { name: /Wander again/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.keyboard.up("w");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: info.outputPath("finale.png") });
  await page.getByRole("button", { name: /Wander again/ }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
