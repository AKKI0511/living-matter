import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblyProgress, angleBlend, assemblySupportsPlayer, assemblyDetour } from "../src/game/assembly";
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

test("forming collision requires an airborne landing and never lifts an intersected capsule", () => {
  const contact = { above: false, landed: false };
  const motion = (feet: number, grounded: boolean, velocityY: number) => ({
    player: [0, feet + .825, 0], velocity: [0, velocityY, 0], grounded,
  });
  assert.equal(assemblySupportsPlayer(1, motion(1, true, -.6), contact), false);
  assert.equal(assemblySupportsPlayer(1, motion(.98, false, -.9), contact), false);
  assert.equal(assemblySupportsPlayer(1, motion(1.6, false, 3), contact), false);
  assert.equal(assemblySupportsPlayer(1, motion(1.4, false, -2), contact), false);
  assert.equal(assemblySupportsPlayer(1, motion(1.05, false, -4), contact), true);
  assert.equal(assemblySupportsPlayer(1, motion(1, true, -.6), contact), true);
  assert.equal(assemblySupportsPlayer(1, motion(.5, false, -4), contact), false);
  assert.equal(assemblySupportsPlayer(1, motion(.5, false, -4)), true);
});

test("loose pieces detour around the capsule and settle at the destination", () => {
  const left = assemblyDetour(0, 1, 0, [0, 1, 0], .5, 0);
  const right = assemblyDetour(0, 1, 0, [0, 1, 0], .5, 1);
  assert.ok(Math.hypot(left[0], left[2]) >= .89);
  assert.ok(left[2] * right[2] < 0);
  assert.deepEqual(assemblyDetour(0, 1, 0, [0, 1, 0], 1, 0), [0, 1, 0]);
});
