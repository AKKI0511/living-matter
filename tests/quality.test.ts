import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDpr, QUALITY, frameSummary, QualityMonitor } from "../src/game/quality";
test("presets bound the pixel budget at 1080p, 4K and high device DPR", () => {
  for (const q of ["low", "high"] as const) for (const [w,h,d] of [[1920,1080,1],[3840,2160,2],[390,844,3]]) {
    const ratio=renderDpr(q,w,h,d);
    assert.ok(ratio <= QUALITY[q].maxDpr);
    assert.ok(w*h*ratio**2 <= Math.max(QUALITY[q].pixels,w*h*.25)+1);
  }
  assert.ok(renderDpr("high",1920,1080,1)>renderDpr("low",1920,1080,1));
  assert.ok(renderDpr("high",1440,900,1)>1, "High improves edges on a DPR-1 laptop");
  assert.deepEqual(frameSummary([40,16,17,15,16]), {median:16,p95:40});
});

test("Auto ignores compilation, requires sustained samples and lowers at most once", () => {
  const monitor = new QualityMonitor();
  // A compilation spike is excluded from the sustained frame window.
  assert.equal(monitor.sample(2), null);
  const decisions = Array.from({ length: 125 }, () => monitor.sample(1 / 60)).filter(Boolean);
  assert.deepEqual(decisions, ["high"]);
  // One isolated dropped frame must not demote an otherwise smooth scene.
  assert.equal(monitor.sample(0.1), null);
  const smooth = Array.from({ length: 125 }, () => monitor.sample(1 / 60)).filter(Boolean);
  assert.deepEqual(smooth, ["high"]);
  const slow = Array.from({ length: 65 }, () => monitor.sample(1 / 30)).filter(Boolean);
  assert.deepEqual(slow, ["low"]);
  assert.ok(Array.from({ length: 500 }, () => monitor.sample(1 / 60)).every(value => value === null));
});

test("Auto requires sustained evidence but can escape a severely overloaded GPU", () => {
  const monitor = new QualityMonitor();
  monitor.sample(0.5);
  for (let i = 0; i < 19; i++) assert.equal(monitor.sample(0.2), null);
  assert.equal(monitor.sample(0.2), "low");
});
