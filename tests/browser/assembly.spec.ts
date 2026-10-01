import { expect, test } from "./fixtures";

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
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.__livingMatter!.formation(0, "bridge"));
  await expect.poll(() => page.evaluate(() => (window.__livingMatter!.snapshot() as { states: { phase: string }[] }).states[0].phase)).toBe("active");
  const samples = await page.evaluate(() => (window as unknown as { __assemblySamples: { elapsed: number; position: number[] }[] }).__assemblySamples);
  // Observe actual matrix uploads: the former progress cap froze this entire
  // interval even though the simulation and provider continued running.
  const early = samples.find(s => s.elapsed >= 2.8)!;
  const middle = samples.find(s => s.elapsed >= 3.0)!;
  const late = samples.find(s => s.elapsed >= 3.2)!;
  expect(early).toBeDefined(); expect(middle).toBeDefined(); expect(late).toBeDefined();
  const distance = (a: typeof early, b: typeof early) => Math.hypot(...a.position.map((v, i) => v - b.position[i]));
  expect(distance(early, middle)).toBeGreaterThan(0.01);
  expect(distance(middle, late)).toBeGreaterThan(0.01);
});
