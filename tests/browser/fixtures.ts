import { test as base, type Page } from "@playwright/test";
import { ScenarioDecisions } from "../../src/game/decisions";
export { expect, type Page } from "@playwright/test";

/** Start before input so a brief jump cannot finish between protocol samples. */
export function observeJump(page: Page, minimumHeight: number | null = null) {
  return page.waitForFunction((minimumHeight) => {
    const state = window.__livingMatter!.snapshot() as { player: number[]; grounded: boolean };
    return minimumHeight === null ? !state.grounded : state.player[1] > minimumHeight;
  }, minimumHeight, { polling: "raf", timeout: process.env.CI ? 30_000 : 12_000 });
}

export const test = base.extend<{ browserDiagnostics: void; decisionTransport: void }>({
  decisionTransport: [async ({ page }, use) => {
    const source = new ScenarioDecisions();
    // Browser verification never spends API credits or writes session audits.
    // Individual transport tests can override this route with a delayed mock.
    await page.route("**/api/decision**", async route => {
      if (new URL(route.request().url()).pathname !== "/api/decision") {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      const result = await source.select(route.request().postDataJSON(), new AbortController().signal);
      await route.fulfill({ json: result.candidateId ? result : { candidateId: null, hold: true } });
    });
    await use();
  }, { auto: true }],
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
