import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionMotionCurrent, samePhysicalCandidate } from "../src/game/decision-freshness";
import { availableCandidates } from "../src/game/affordances";
import type { Observation } from "../src/game/decisions";

const before: Observation = { time: 1, position: [0, 0.825, -22], velocity: [0, 0, -4], gaze: [0, 0, -1], grounded: true, activeStructure: null };
test("ordinary movement and stopping preserve an in-flight decision", () => {
  assert.equal(decisionMotionCurrent(before, { ...before, position: [0, 0.825, -23], velocity: [0, 0, -6], time: 1.2 }), true);
  assert.equal(decisionMotionCurrent(before, { ...before, velocity: [0, 0, 0], gaze: [0, -0.4, -0.9] }), true);
});
test("turning, reversing, strafing and falling invalidate a direction decision", () => {
  for (const after of [
    { ...before, gaze: [0, 0, 1] },
    { ...before, velocity: [0, 0, 4] },
    { ...before, velocity: [4, 0, 0] },
    { ...before, grounded: false },
  ] as Observation[]) assert.equal(decisionMotionCurrent(before, after), false);
});
test("reversing the shore approach invalidates the same candidate ID", () => {
  const a = availableCandidates([0, 0.825, -23])[0];
  const b = availableCandidates([-14, 0.825, -47])[0];
  assert.equal(a.id, b.id);
  assert.equal(samePhysicalCandidate(a, a), true);
  assert.equal(samePhysicalCandidate(a, b), false);
});
