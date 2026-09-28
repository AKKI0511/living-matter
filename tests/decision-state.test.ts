import { test } from "node:test";
import assert from "node:assert/strict";
import { currentDirectionServed, decisionState } from "../src/game/decision-state";
import { PhysicalHistory, type SemanticState } from "../src/game/semantic";
import { JevDecisions } from "../src/game/decision-backend";
import { availableCandidates } from "../src/game/affordances";
import type { Observation } from "../src/game/decisions";

const now = { support: "permanent ground", motion: "walking forward", facing_into: "walkable ground", view_height: "looking roughly level" };
const semantic: SemanticState = { player_now: now, recent_behavior_oldest_to_newest: [now], matter_now: { state: "idle", player_supported_by_matter: false } };

test("compact state retains traversal evidence and omits repeated current and engine rules", () => {
  const jumped = { ...now, motion: "jumped and landed back on the same support", facing_into: "open air" };
  const state = decisionState({ ...semantic, recent_behavior_oldest_to_newest: [jumped, now], matter_now: { ...semantic.matter_now, occupied_section: "protected by the engine" } });
  assert.equal(state.recent_behavior.length, 1);
  assert.equal(state.recent_behavior[0].motion, jumped.motion);
  assert.equal(state.recent_behavior[0].facing_into, "open air");
  assert.equal(state.player_now, now);
  assert.equal("occupied_section" in state.matter_now, false);
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
  assert.equal(calls, 4);
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
