import { expect, test } from "./fixtures";

test.describe("touch viewport", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  test("entry, joystick, jump, and pause work on a narrow screen", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Enter the world/ }).tap();
    await expect(page.getByLabel("Movement joystick")).toBeVisible();
    const before = await page.evaluate(
      () =>
        (window.__livingMatter!.snapshot() as { player: number[] }).player[2],
    );
    const box = (await page.getByLabel("Movement joystick").boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const touch = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...touch, y: touch.y - 42 }],
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window.__livingMatter!.snapshot() as { player: number[] })
              .player[2],
        ),
      )
      .toBeLessThan(before - 2);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.getByRole("button", { name: "Jump", exact: true }).tap();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window.__livingMatter!.snapshot() as { player: number[] })
              .player[1],
        ),
      )
      .toBeGreaterThan(1);
    await page.getByRole("button", { name: "Pause", exact: true }).tap();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
    await page.screenshot({ path: "artifacts/touch-pause.png" });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
  });
});

test("graphics context loss presents a recoverable error", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Enter the world/ }),
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
    page.getByRole("button", { name: /Enter the world/ }),
  ).toBeVisible();
});
