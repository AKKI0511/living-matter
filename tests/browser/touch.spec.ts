import { expect, observeJump, test } from "./fixtures";

declare global { interface Window { cancelledJump?: Promise<boolean> } }

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("stick tracks the finger, walks then sprints, and handles simultaneous look/jump and rotation", async ({ page }) => {
  await page.goto("/play?diagnostics");
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  const snapshot = () => page.evaluate(() => window.__livingMatter!.snapshot() as { velocity: number[]; grounded: boolean; player: number[]; diagnostics: { input: { sprint: boolean; right: number; forward: number; jump: boolean; yaw: number } } });
  await expect.poll(async () => (await snapshot()).grounded).toBe(true);
  const stick = page.getByLabel("Movement joystick"), thumb = stick.locator("span");
  const box = (await stick.boundingBox())!;
  const center = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { id: number; x: number; y: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [center]);
  await touch("touchMove", [{ ...center, y: center.y - 20 }]);
  await expect(thumb).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -20)");
  await expect.poll(async () => Math.abs((await snapshot()).velocity[2])).toBeGreaterThan(1);
  expect((await snapshot()).diagnostics.input.sprint).toBe(false);
  const running = { ...center, y: center.y - 60 };
  await touch("touchMove", [running]);
  await expect(thumb).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -36)");
  await expect.poll(async () => Math.abs((await snapshot()).velocity[2])).toBeGreaterThan(5.5);
  expect((await snapshot()).diagnostics.input.sprint).toBe(true);
  const yaw = (await snapshot()).diagnostics.input.yaw;
  const looking = { id: 2, x: 300, y: 250 };
  await touch("touchStart", [running, looking]);
  await touch("touchMove", [running, { ...looking, x: 320 }]);
  await expect.poll(async () => (await snapshot()).diagnostics.input.yaw).toBeLessThan(yaw - .05);
  const jump = (await page.getByLabel("Jump", { exact: true }).boundingBox())!;
  const jumping = { id: 3, x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 };
  const jumped = observeJump(page, (await snapshot()).player[1] + .3);
  await touch("touchStart", [running, { ...looking, x: 320 }, jumping]);
  await jumped;
  await touch("touchEnd", []);
  await expect(thumb).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect.poll(async () => (await snapshot()).diagnostics.input.sprint).toBe(false);
  // Rotation during a held stick clears all old gesture coordinates.
  await touch("touchStart", [center]);
  await touch("touchMove", [running]);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(thumb).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect.poll(async () => (await snapshot()).diagnostics.input.sprint).toBe(false);
  await touch("touchEnd", []);
  for (const control of [stick, page.getByLabel("Jump", { exact: true }), page.getByLabel("Pause", { exact: true })]) {
    await expect(control).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(844); expect(bounds.y + bounds.height).toBeLessThanOrEqual(390);
  }
  const landscapeStick = (await stick.boundingBox())!;
  const landscapeCenter = { id: 1, x: landscapeStick.x + landscapeStick.width / 2, y: landscapeStick.y + landscapeStick.height / 2 };
  await touch("touchStart", [landscapeCenter]);
  await touch("touchMove", [{ ...landscapeCenter, y: landscapeCenter.y - 40 }]);
  await expect.poll(async () => (await snapshot()).diagnostics.input.sprint).toBe(true);
  await touch("touchEnd", []);
  await page.getByLabel("Pause", { exact: true }).tap();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(844);
});

test("cancelled jump pointers do not jump, while a quick tap still does", async ({ page }) => {
  await page.goto("/play?diagnostics");
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  const state = () => page.evaluate(() => window.__livingMatter!.snapshot() as { time: number; grounded: boolean; player: number[] });
  await expect.poll(async () => (await state()).grounded).toBe(true);
  const jump = page.getByLabel("Jump", { exact: true });
  for (const type of ["pointercancel", "lostpointercapture"]) {
    await jump.evaluate((button, type) => {
      window.cancelledJump = new Promise(resolve => {
        // React handles the press at the root before this document listener.
        document.addEventListener("pointerdown", event => {
          button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: event.pointerId }));
          const start = (window.__livingMatter!.snapshot() as { time: number }).time;
          let jumped = false;
          const sample = () => {
            const state = window.__livingMatter!.snapshot() as { time: number; grounded: boolean };
            jumped ||= !state.grounded;
            if (state.time > start + .3) resolve(jumped);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, { once: true });
      });
    }, type);
    await jump.tap();
    expect(await page.evaluate(() => window.cancelledJump)).toBe(false);
  }
  const jumped = observeJump(page, (await state()).player[1] + .3);
  await jump.tap();
  await jumped;
});

test("supported phones can leave automatic fullscreen and resume in the browser", async ({ page }) => {
  await page.goto("/play");
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  if (await page.evaluate(() => !!document.fullscreenEnabled)) {
    await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await page.getByRole("button", { name: "Resume", exact: true }).tap();
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  }
  await expect(page.getByLabel("Movement joystick")).toBeVisible();
});

test("the mobile fallback notice is small and touch-dismissible", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "Requires mocked live failures");
  await page.route("**/api/decision", route => route.fulfill({ status: 503 }));
  await page.goto("/play");
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, .825, -23]); window.__livingMatter!.look(.6, 0); });
  const notice = page.getByLabel("Preview mode", { exact: true });
  await expect(notice).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as { states: { phase: string }[] }).states[0].phase)).toBe("active");
  await page.screenshot({ path: "artifacts/fallback-mobile.png" });
  await page.getByRole("button", { name: "Dismiss preview notice", exact: true }).tap();
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "Pause", exact: true }).tap();
  await page.getByRole("button", { name: "Resume", exact: true }).tap();
  await expect(notice).toHaveCount(0);
});
