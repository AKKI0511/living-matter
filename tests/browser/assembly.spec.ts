import { expect, test } from "./fixtures";

// This checks uploaded transforms, not image resolution. SwiftShader needs a
// smaller canvas to provide multiple frames inside the late-assembly window.
if (process.env.CI) test.use({ viewport: { width: 320, height: 200 } });

test("rendered pieces keep approaching the route throughout late assembly", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const upload = prototype.bufferSubData;
    const samples: { elapsed: number; position: number[] }[] = [];
    Object.assign(window, { __assemblySamples: samples });
    prototype.bufferSubData = function(...args: unknown[]) {
      const value = args[2];
      if (value instanceof Float32Array && value.length === 512 * 16) {
        const state = window.__livingMatter?.snapshot() as { time: number; states: { since: number; phase: string }[] } | undefined;
        if (state?.states[0].phase === "forming") {
          const elapsed = state.time - state.states[0].since;
          if (elapsed > 2.7) samples.push({ elapsed, position: Array.from(value.subarray(12, 15)) });
        }
      }
      Reflect.apply(upload, this, args);
    };
  });
  await page.goto("/play");
  await page.getByLabel("Graphics", { exact: true }).selectOption("low");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  // Warm the actual simulation and renderer; a wall-clock wait can finish
  // during startup on software graphics and leave too few animation frames.
  await page.waitForFunction(() => (window.__livingMatter!.snapshot() as { time: number }).time >= 2, undefined, { polling: "raf" });
  await page.evaluate(() => window.__livingMatter!.formation(0, "bridge"));
  await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as { states: { phase: string }[] }).states[0].phase)).toBe("active");
  const samples = await page.evaluate(() => (window as unknown as { __assemblySamples: { elapsed: number; position: number[] }[] }).__assemblySamples);
  // Observe actual matrix uploads: the former progress cap froze this entire
  // interval even though the simulation and provider continued running.
  const distinct = samples.filter((s, i) => !i || s.elapsed > samples[i - 1].elapsed);
  expect(distinct.length).toBeGreaterThanOrEqual(2);
  const early = distinct[0], late = distinct.at(-1)!;
  const distance = (a: typeof early, b: typeof early) => Math.hypot(...a.position.map((v, i) => v - b.position[i]));
  expect(distance(early, late)).toBeGreaterThan(0.01);
  let anchor = 0, longestHold = 0;
  for (let i = 1; i < distinct.length; i++) {
    if (distance(distinct[anchor], distinct[i]) > 0.00001) anchor = i;
    else longestHold = Math.max(longestHold, distinct[i].elapsed - distinct[anchor].elapsed);
  }
  // A physics boundary can share a pose for one or two render frames. The
  // former capped plateau lasted roughly half a second, on any renderer.
  expect(longestHold).toBeLessThan(0.12);
});
