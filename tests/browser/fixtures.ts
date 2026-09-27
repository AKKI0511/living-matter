import { test as base } from "@playwright/test";
export { expect, type Page } from "@playwright/test";

export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [async ({ page }, use, info) => {
    await use();
    if (info.status === info.expectedStatus || page.isClosed()) return;
    const diagnostics = await page.evaluate(() => {
      const gl = document.querySelector("canvas")?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        visible: document.visibilityState,
        pixel_ratio: window.devicePixelRatio,
        canvas_size: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
        renderer: extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
        snapshot: window.__livingMatter?.snapshot(),
      };
    }).catch(() => ({ error: "Browser diagnostics unavailable" }));
    console.log("Browser failure diagnostics:", JSON.stringify(diagnostics));
    await info.attach("browser-diagnostics", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
  }, { auto: true }],
});
