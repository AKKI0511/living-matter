import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSemanticPrompt, currentDirectionServed, decisionState } from "../src/game/decision-state";
import { describeCandidate, describePhysical, PhysicalHistory, type SemanticState } from "../src/game/semantic";
import { createWeave } from "../src/game/weave";
import { JevDecisions } from "../src/game/decision-backend";
import { availableCandidates } from "../src/game/affordances";
import type { Observation } from "../src/game/decisions";

const now = { support: "permanent ground", motion: "walking forward", facing_into: "walkable ground", view_height: "looking roughly level" };
const semantic: SemanticState = { player_now: now, recent_behavior_oldest_to_newest: [now], matter_now: { state: "idle", player_supported_by_matter: false } };

test("compact state retains traversal evidence and omits repeated current and engine rules", () => {
  const jumped = { ...now, motion: "jumped and landed back on the same support", facing_into: "open air" };
  const state = decisionState({ ...semantic, recent_behavior_oldest_to_newest: [jumped, now], matter_now: { ...semantic.matter_now, occupied_section: "protected by the engine" } });
  assert.equal(state.recent_behavior_oldest_to_newest.length, 1);
  assert.equal(state.recent_behavior_oldest_to_newest[0].motion, jumped.motion);
  assert.equal(state.recent_behavior_oldest_to_newest[0].facing_into, "gap without a continuous walking surface");
  assert.equal(state.player_now.support, "solid ground");
  assert.equal("occupied_section" in state.material_now, false);
  assert.match(state.scene, /living matter reshapes/);
  assert.doesNotThrow(() => assertSemanticPrompt(state));
});

test("history keeps latest transitions without reviving older attempts or height looks", () => {
  const events = [
    { ...now, motion: "jumped and landed back on the same support", facing_into: "open air" },
    { ...now, motion: "walking right" },
    { ...now, motion: "standing", position_on_support: "near an edge", view_height: "looking upward" },
    { ...now, motion: "standing", position_on_support: "at an edge", view_height: "looking downward" },
    { ...now, motion: "walking left" },
    { ...now, motion: "running forward" },
  ];
  const result = decisionState({ ...semantic, recent_behavior_oldest_to_newest: events });
  assert.deepEqual(result.recent_behavior_oldest_to_newest.map(event => event.motion), ["walking left", "running forward"]);
  assert.ok(result.recent_behavior_oldest_to_newest.every(event => !("view_height" in event)));
  assert.equal(result.player_now.view_height, "looking roughly level");
  assert.match(result.directions, /history uses earlier views/);
});

test("view commitment distinguishes holding a view from scanning without exposing time or angles", () => {
  const sample: Observation = { time: 1, position: [0,.825,-23], gaze: [0,.3,-1], velocity: [0,0,0], grounded: true, activeStructure: null };
  const held = [sample, { ...sample, time: 1.3 }, { ...sample, time: 1.7 }];
  assert.equal(decisionState(semantic, held).player_now.view_attention, "view held in the same direction");
  assert.equal(decisionState(semantic, [sample, { ...sample, time: 1.7, gaze: [1,0,0] }]).player_now.view_attention, "view is changing direction");
  assert.equal(decisionState(semantic, [sample]).player_now.view_attention, "view persistence not observed");
});

test("numeric details and arbitrary client vocabulary cannot enter the semantic prompt", () => {
  for (const value of [3, true, { option_2: "left" }, { heading: "thirty degrees" }, { time: "two seconds" }, { count: "one" }])
    assert.throws(() => assertSemanticPrompt(value));
  const result = decisionState({ ...semantic, player_now: { ...now, motion: "run 30 units", view_height: "pitch 40" },
    matter_now: { ...semantic.matter_now, form: "512 cubes" } });
  assert.doesNotThrow(() => assertSemanticPrompt(result));
  assert.equal(result.player_now.motion, "movement not observed");
  assert.equal(result.player_now.view_height, undefined);
});

test("repeated current descriptions are removed after translating engine vocabulary", () => {
  const state = decisionState({ ...semantic, recent_behavior_oldest_to_newest: [now,now,now] });
  assert.deepEqual(state.recent_behavior_oldest_to_newest,[]);
});

test("continuous forward support holds without transport; gaps, lateral and backward intent still reach Jev", async t => {
  let calls = 0, time = 0;
  t.mock.method(performance, "now", () => time);
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ candidateId: null, hold: true }); });
  const sample: Observation = { time: 1, position: [0, 0.825, -23], gaze: [0,0,-1], velocity: [0,0,-2], grounded: true, activeStructure: null };
  const context = { generation: 0, observations: [sample], candidates: availableCandidates(sample.position), semantic };
  const source = new JevDecisions(), signal = new AbortController().signal;
  assert.equal((await source.select(context, signal)).hold, true);
  assert.equal(calls, 0);
  for (const change of [{ facing_into: "open air" }, { motion: "walking behind" }, { motion: "walking right" }, { view_height: "looking upward" }]) {
    time += 2000;
    await source.select({ ...context, semantic: { ...semantic, player_now: { ...now, ...change } } }, signal);
  }
  assert.equal(calls, 3); // An upward glance inside continuous ground needs no call.
  assert.equal(currentDirectionServed({ ...semantic, player_now: { ...now, motion: "standing" }, recent_behavior_oldest_to_newest: [{ ...now, motion: "walking behind" }] }), false);
});

test("a successful reconstruction clears attempts that the new geometry already served", () => {
  const history = new PhysicalHistory();
  const scene = { time: 1, activeSite: null, phase: "idle" as const, weave: null };
  history.record({ time: 1, position: [0,.825,-23], gaze: [0,0,-1], velocity: [0,0,-2], grounded: true, activeStructure: null }, scene);
  history.clear();
  const current = { ...now, motion: "standing" };
  assert.deepEqual(history.snapshot(current), [current]);
});

test("a player at the side rim can ask for a new direction while the old deck continues ahead", () => {
  const atRim: SemanticState = {
    ...semantic,
    player_now: { ...now, support: "living matter", facing_into: "living matter", position_on_support: "at an edge" },
    matter_now: { state: "active", player_supported_by_matter: true },
  };
  assert.equal(currentDirectionServed(atRim), false);
  assert.equal(currentDirectionServed({ ...atRim, player_now: { ...atRim.player_now, position_on_support: "inside the support" } }), true);
});

test("arrival on continuous ground closes old jumps and falls before another gap", () => {
  for (const arrival of ["jumped and landed back on the same support", "jumped and landed on another support", "fell off the support and returned"]) {
    const gap = { ...now, motion: "standing", facing_into: "open air" };
    const state=decisionState({...semantic,player_now:gap,recent_behavior_oldest_to_newest:[
      {...gap,motion:"jumped and landed back on the same support"},
      {...now,motion:arrival},
      {...gap,motion:"walking forward"},gap,
    ]});
    assert.equal(state.recent_behavior_oldest_to_newest.length,1);
    assert.equal(state.recent_behavior_oldest_to_newest[0].motion,"walking forward");
    assertSemanticPrompt(state);
  }
});

test("occupied slope axes describe along, diagonal and across views without an invisible forward end", () => {
  const weave = createWeave([[0,1,-25],[0,2.5,-31],[0,4,-37]], 0);
  const scene = { time: 5, activeSite: 0, phase: "active" as const, kind: "weave", weave };
  const sample: Observation = { time: 5, position: [0,2.635,-28], gaze: [0,0,-1], velocity: [0,0,0], grounded: true, activeStructure: "reach" };
  for (const [gaze, expected] of [
    [[0,0,-1], "ahead to behind"], [[0,0,1], "ahead to behind"],
    [[1,0,0], "left to right across view"], [[-1,0,0], "left to right across view"],
    [[.5,0,-.866], "ahead-left to behind-right"], [[-.5,0,-.866], "ahead-right to behind-left"],
  ] as [Observation["gaze"], string][]) {
    const event = describePhysical({ ...sample, gaze }, scene);
    assert.equal(event.walkway_axis, expected);
    const state = decisionState({ ...semantic, player_now: event });
    assert.equal(state.player_now.view_to_walkway, expected === "ahead to behind" ? "along the walkway" :
      expected === "left to right across view" ? "across the walkway toward its side" : "diagonally across the walkway");
    assert.equal("walkway_axis" in state.player_now, false);
    assertSemanticPrompt(state);
    const reversed = structuredClone(scene);
    [reversed.weave.banks[0].from, reversed.weave.banks[0].to] = [reversed.weave.banks[0].to, reversed.weave.banks[0].from];
    assert.equal(describePhysical({ ...sample, gaze }, reversed).walkway_axis, expected);
    // Rotate the world and view together: meaning must remain unchanged.
    const rotated = structuredClone(scene);
    const rotate = ([x,y,z]: Observation["position"]): Observation["position"] => [-z,y,x];
    for (const bank of rotated.weave.banks) { bank.from = rotate(bank.from); bank.to = rotate(bank.to); }
    assert.equal(describePhysical({ ...sample, gaze: rotate(gaze), position: rotate(sample.position) }, rotated).walkway_axis, expected);
  }
  assert.equal(describePhysical({ ...sample, grounded: false }, scene).walkway_axis, undefined);
  const shore = decisionState({ ...semantic, player_now: { ...now, walkway_axis: "left to right across view" } });
  assert.equal(shore.player_now.view_to_walkway, undefined);
  const injected = decisionState({ ...semantic, player_now: { ...now, support: "living matter", walkway_axis: "turn 90 degrees" } });
  assert.equal(injected.player_now.view_to_walkway, undefined);
});

test("slow lateral movement and formation alignment tell Jev the same travel intent", () => {
  const scene = { time: 1, activeSite: null, phase: "idle" as const, weave: null };
  for (const speed of [.3775170606, .5311250033, .6, .61, 4]) {
    const sample: Observation = { time: 1, position: [0,.825,-23], gaze: [0,0,-1], velocity: [speed,0,0], grounded: true, activeStructure: null };
    const event = describePhysical(sample, scene);
    const candidate = availableCandidates(sample.position)[0];
    const description = describeCandidate(candidate, sample, false);
    assert.equal(event.motion, speed <= .6 ? "standing" : "walking right");
    assert.equal(description.movement_alignment === "not moving horizontally", speed <= .6);
    const state = decisionState({ ...semantic, player_now: event });
    assert.equal(state.player_now.motion, event.motion);
    assertSemanticPrompt(state);
  }
  const air: Observation = { time: 1, position: [0,1.5,-23], gaze: [0,0,-1], velocity: [.4,3,0], grounded: false, activeStructure: null };
  assert.equal(describePhysical(air, scene).motion, "jumping");
});
