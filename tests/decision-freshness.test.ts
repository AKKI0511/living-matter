import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionMotionCurrent, samePhysicalCandidate } from "../src/game/decision-freshness";
import { availableCandidates } from "../src/game/affordances";
import type { Candidate, Observation } from "../src/game/decisions";

const before: Observation = { time: 1, position: [0, 0.825, -22], velocity: [0, 0, -4], gaze: [0, 0, -1], grounded: true, activeStructure: null };
test("ordinary movement and stopping preserve an in-flight decision", () => {
  assert.equal(decisionMotionCurrent(before, { ...before, position: [0, 0.825, -23], velocity: [0, 0, -6], time: 1.2 }), true);
  assert.equal(decisionMotionCurrent(before, { ...before, velocity: [0, 0, 0], gaze: [0, -0.4, -0.9] }), true);
});
test("turning after stopping, reversing, strafing and falling invalidate a direction decision", () => {
  for (const after of [
    { ...before, velocity: [0,0,0], gaze: [0, 0, 1] },
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

test("starting to move toward Jev's side exit confirms the reply while moving away or falling rejects it",()=>{
  const waiting={...before,velocity:[0,0,0] as [number,number,number]};
  const right:Candidate={id:"right",siteId:"reach",kind:"weave",physical:{from:[1.8,0,-22],to:[7.8,-1.5,-22],distance:1.8,span:6,rise:-1.5,medium:"air"}};
  assert.equal(decisionMotionCurrent(waiting,{...waiting,velocity:[4,0,0]},right),true);
  assert.equal(decisionMotionCurrent(waiting,{...waiting,gaze:[1,0,0]},right),true);
  assert.equal(decisionMotionCurrent(waiting,{...waiting,velocity:[-4,0,0]},right),false);
  assert.equal(decisionMotionCurrent(waiting,{...waiting,grounded:false},right),false);
});

test("a camera glance while continuing the same travel does not veto Jev's route choice", () => {
  const candidate: Candidate = { id: "turn", siteId: "reach", kind: "weave", physical: {
    from: [0,0,-20], to: [4,0,-15], distance: 2, span: 6, rise: 0, medium: "air",
  } };
  const glanced = { ...before, gaze: [1,0,0] as Observation["gaze"] };
  assert.equal(decisionMotionCurrent(before, glanced, candidate), true);
  assert.equal(decisionMotionCurrent(before, { ...glanced, velocity: [0,0,-2] }, candidate), true);
  assert.equal(decisionMotionCurrent(before, { ...glanced, velocity: [-4,0,0] }, candidate), false);
  assert.equal(decisionMotionCurrent(before, { ...glanced, grounded: false }, candidate), false);
  assert.equal(decisionMotionCurrent({ ...before, velocity: [0,0,0] }, { ...before, velocity: [0,0,0], gaze: [-1,0,0] }, candidate), false);
});
