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
  const initial = await inspect();
  for (let cycle = 0; cycle < 3; cycle++) {
    await graphics.selectOption("low");
    await expect.poll(async () => (await inspect()).pipeline).toBeNull();
    await graphics.selectOption("high");
    await expect.poll(async () => (await inspect()).pipeline?.buffer).toEqual(resized);
    const current = await inspect();
    expect(current.textures).toBe(initial.textures);
    expect(current.geometries).toBe(initial.geometries);
  }
  await cdp.detach();
});
