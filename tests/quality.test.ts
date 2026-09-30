import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDpr, QUALITY, frameSummary } from "../src/game/quality";
test("presets bound the pixel budget at 1080p, 4K and high device DPR", () => {
  for (const q of ["low", "high"] as const) for (const [w,h,d] of [[1920,1080,1],[3840,2160,2],[390,844,3]]) {
    const ratio=renderDpr(q,w,h,d);
    assert.ok(ratio <= QUALITY[q].maxDpr);
    assert.ok(w*h*ratio**2 <= Math.max(QUALITY[q].pixels,w*h*.25)+1);
  }
  assert.ok(renderDpr("high",1920,1080,1)>renderDpr("low",1920,1080,1));
  assert.deepEqual(frameSummary([40,16,17,15,16]), {median:16,p95:40});
});
