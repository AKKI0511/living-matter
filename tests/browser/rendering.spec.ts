import { expect, test } from "./fixtures";

test("High keeps linear intermediate color and follows DPR changes at fixed CSS size", async ({ page }) => {
  test.skip(!!process.env.CI, "DPR and GPU resource checks run on local hardware");
  await page.goto("/play");
  const graphics = page.getByLabel("Graphics", { exact: true });
  const inspect = () => page.evaluate(() => {
    const gl = document.querySelector("canvas")!.getContext("webgl2")!;
    return { buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], ...window.__livingMatter!.renderInfo() };
  });
  await graphics.selectOption("high");
  await expect.poll(async () => (await inspect()).pipeline?.gammaCorrection).toBe(false);
  expect((await inspect()).pipeline?.buffer).toEqual((await inspect()).buffer);
  const cssSize = await page.locator("canvas").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1.4, mobile: false,
  });
  await page.evaluate(() => dispatchEvent(new Event("resize")));
  // Fractional DPR is represented with floating-point rounding by Chrome.
  await expect.poll(async () => (await inspect()).buffer[0]).toBeGreaterThanOrEqual(2015);
  const resized = (await inspect()).buffer;
  await expect.poll(async () => (await inspect()).pipeline?.buffer).toEqual(resized);
  expect((await inspect()).pipeline?.aoBuffer).toEqual(resized);
  expect(await page.locator("canvas").boundingBox()).toEqual(cssSize);
  // Three allocates render-target textures lazily on the first composed frame.
  await expect.poll(async () => (await inspect()).textures).toBeGreaterThan(6);
  const initial = await inspect();
  for (let cycle = 0; cycle < 3; cycle++) {
    await graphics.selectOption("low");
    await expect.poll(async () => (await inspect()).pipeline).toBeNull();
    await graphics.selectOption("high");
    await expect.poll(async () => (await inspect()).pipeline?.buffer).toEqual(resized);
    await expect.poll(async () => {
      const current = await inspect();
      return { textures: current.textures, geometries: current.geometries };
    }).toEqual({ textures: initial.textures, geometries: initial.geometries });
  }
  await cdp.detach();
});

test("Auto finishes a formation before switching effects and keeps drawing during the handoff", async ({ page }) => {
  test.skip(!!process.env.CI, "Auto upgrade and frame checks run on local hardware");
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const draw = prototype.drawElementsInstanced;
    let worldDraws = 0;
    const frames: { time: number; draws: number }[] = [];
    Object.assign(window, { __worldFrames: frames });
    prototype.drawElementsInstanced = function(...args) {
      worldDraws++;
      return Reflect.apply(draw, this, args);
    };
    const frame = () => {
      const runtime = window.__livingMatter?.snapshot() as { time: number; phase: string } | undefined;
      if (runtime?.phase === "playing" && runtime.time > 8) frames.push({ time: runtime.time, draws: worldDraws });
      worldDraws = 0; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto("/play");
  await page.getByLabel("Graphics", { exact: true }).selectOption("auto");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => (window.__livingMatter!.snapshot() as { time: number }).time >= 10, undefined, { polling: "raf" });
  await page.evaluate(() => window.__livingMatter!.formation(0, "weave"));
  await page.waitForFunction(() => {
    const state = window.__livingMatter!.snapshot() as { time: number; states: { since: number }[] };
    return state.time - state.states[0].since >= 2;
  }, undefined, { polling: "raf" });
  expect(await page.evaluate(() => window.__livingMatter!.renderInfo().pipeline)).toBeNull();
  await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as { states: { phase: string }[] }).states[0].phase)).toBe("active");
  await expect.poll(() => page.evaluate(() => window.__livingMatter!.renderInfo().pipeline)).not.toBeNull();
  await page.waitForFunction(() => (window.__livingMatter!.snapshot() as { time: number }).time > 16, undefined, { polling: "raf" });
  const frames = await page.evaluate(() => (window as unknown as { __worldFrames: { time: number; draws: number }[] }).__worldFrames);
  expect(frames.length).toBeGreaterThan(120);
  // Browser task scheduling may split a boundary, but an unready composer must
  // never leave a consecutive run of frames without drawing world geometry.
  let emptyRun = 0;
  for (const frame of frames) {
    emptyRun = frame.draws ? 0 : emptyRun + 1;
    expect(emptyRun).toBeLessThan(3);
  }
});
