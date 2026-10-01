import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblyProgress, angleBlend } from "../src/game/assembly";
import { FORMATION_SECONDS } from "../src/game/world";

test("assembly keeps moving until the existing support deadline without a capped plateau", () => {
  for (const duration of [FORMATION_SECONDS, 1.6]) for (const index of [0, 31, 255, 511]) {
    let previous = 0;
    for (let time = duration * 0.7; time < duration - 1 / 60; time += 1 / 120) {
      const progress = assemblyProgress(time, duration, index, false);
      assert.ok(progress > previous);
      assert.ok(progress < 1);
      previous = progress;
    }
    const waiting = assemblyProgress(duration, duration, index, false);
    assert.ok(waiting < 1);
    assert.ok(1 - waiting < 0.0001, "support activation must not snap the final pose");
    assert.equal(assemblyProgress(duration, duration, index, true), 1);
  }
});

test("recycled piece yaw starts at its actual orientation and takes the short turn", () => {
  assert.equal(angleBlend(2.9, -2.9, 0), 2.9);
  assert.ok(Math.abs(angleBlend(2.9, -2.9, 0.5) - Math.PI) < 0.001);
});
