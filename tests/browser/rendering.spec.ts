import { expect, test } from "./fixtures";
import { go } from "./steering-helpers";
import { sites } from "../../src/game/world";

test("restarts release scene resources", async ({ page }) => {
  test.skip(!!process.env.CI, "GPU resource checks run on local hardware");
  await page.goto("/play");
  await page.getByLabel("Graphics", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const warmed = () => page.waitForFunction(() =>
    (window.__livingMatter!.snapshot() as { time: number }).time > .8);
  await warmed();
  const baseline = await page.evaluate(() => window.__livingMatter!.renderInfo());
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await expect.poll(() => page.evaluate(() =>
      (window.__livingMatter!.snapshot() as { time: number }).time)).toBeLessThan(.5);
    await warmed();
  }
  const final = await page.evaluate(() => window.__livingMatter!.renderInfo());
  expect(final.geometries).toBeLessThanOrEqual(baseline.geometries + 2);
  expect(final.textures).toBeLessThanOrEqual(baseline.textures + 2);
});

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

test("explicit High stays selected during movement and formation traversal", async ({ page }) => {
  await page.goto("/play");
  await page.getByLabel("Graphics", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 1, -23]);
    window.__livingMatter!.formation(0, "weave");
  });
  await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as {
    states: { phase: string }[];
  }).states[0].phase)).toBe("active");
  await go(page, [sites[0].end[0], sites[0].end[1], sites[0].end[2] - 2]);
  const state = await page.evaluate(() => ({
    ...window.__livingMatter!.snapshot() as { grounded: boolean; recoveries: number },
    pipeline: window.__livingMatter!.renderInfo().pipeline,
  }));
  expect(state.grounded).toBe(true);
  expect(state.recoveries).toBe(0);
  expect(state.pipeline).not.toBeNull();
});

test("Auto prepares before Play and never introduces cold High effects during a formation", async ({ page }) => {
  test.skip(!!process.env.CI, "Auto calibration and frame checks run on local hardware");
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const draw = prototype.drawElementsInstanced;
    const compile = prototype.compileShader;
    let playingCompiles = 0;
    let worldDraws = 0;
    const frames: { time: number; draws: number; high: boolean }[] = [];
    Object.assign(window, { __worldFrames: frames });
    Object.assign(window, { __playingCompiles: () => playingCompiles });
    prototype.compileShader = function(...args) {
      if ((window.__livingMatter?.snapshot() as { phase: string } | undefined)?.phase === "playing") playingCompiles++;
      return Reflect.apply(compile, this, args);
    };
    prototype.drawElementsInstanced = function(...args) {
      worldDraws++;
      return Reflect.apply(draw, this, args);
    };
    const frame = () => {
      const runtime = window.__livingMatter?.snapshot() as { time: number; phase: string } | undefined;
      if (runtime?.phase === "playing") frames.push({ time: runtime.time, draws: worldDraws,
        high: !!window.__livingMatter?.renderInfo().pipeline });
      worldDraws = 0; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto("/play");
  await page.getByLabel("Graphics", { exact: true }).selectOption("auto");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, 1, -23]); window.__livingMatter!.formation(0, "weave"); });
  await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as { states: { phase: string }[] }).states[0].phase)).toBe("active");
  await page.waitForFunction(() => (window.__livingMatter!.snapshot() as { time: number }).time > 16, undefined, { polling: "raf" });
  const frames = await page.evaluate(() => (window as unknown as { __worldFrames: { time: number; draws: number; high: boolean }[] }).__worldFrames);
  expect(frames.length).toBeGreaterThan(120);
  expect(await page.evaluate(() => (window as unknown as { __playingCompiles: () => number }).__playingCompiles())).toBe(0);
  let lowered = !frames[0].high;
  // Browser task scheduling may split a boundary, but an unready composer must
  // never leave a consecutive run of frames without drawing world geometry.
  let emptyRun = 0;
  for (const frame of frames) {
    if (!frame.high) lowered = true;
    if (lowered) expect(frame.high).toBe(false);
    emptyRun = frame.draws ? 0 : emptyRun + 1;
    expect(emptyRun).toBeLessThan(3);
  }
});
