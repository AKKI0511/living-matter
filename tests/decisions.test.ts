import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DecisionGate,
  ScenarioDecisions,
  type Candidate,
  type Intervention,
} from "../src/game/decisions";
import { createWeave, weaveRoute, weaveCandidates } from "../src/game/weave";
import { describeMatter, describePhysical } from "../src/game/semantic";
import { sites, type Vec3 } from "../src/game/world";
const candidate = {
  id: "reach:bridge",
  siteId: "reach",
  kind: "bridge" as const,
};
const context = { observations: [], candidates: [candidate] };
test("scenario source selects a validated candidate; empty contexts permit no intervention", async () => {
  const gate = new DecisionGate(new ScenarioDecisions());
  assert.deepEqual(await gate.request(context), candidate);
  assert.equal(await gate.request({ observations: [], candidates: [] }), null);
});

test("preview follows sideways/backward travel while gaze alone can choose a different route", async () => {
  const options: Candidate[] = [["ahead", 0, -6], ["right", 6, 0], ["behind", 0, 6]].map(([id, x, z]) => ({
    ...candidate, id: String(id), kind: "weave", physical: { from: [0, 0, 0], to: [Number(x), 0, Number(z)], distance: 1, span: 6, rise: 0, medium: "air" },
  }));
  const o = { time: 5, position: [0, .825, 0] as Vec3, velocity: [4, 0, 0] as Vec3, gaze: [0, 0, -1] as Vec3, grounded: true, activeStructure: null };
  const source = new ScenarioDecisions(), signal = new AbortController().signal;
  const select = (velocity: Vec3, gaze = o.gaze) => source.select({ generation: 0, candidates: options, observations: [{ ...o, velocity, gaze }] }, signal);
  assert.equal((await select([4, 0, 0])).candidateId, "right");
  assert.equal((await select([0, 0, 4])).candidateId, "behind");
  assert.equal((await select([0, 0, 0])).candidateId, "ahead");
  assert.equal((await select([0, 0, 0], [0, -.95, -.31])).candidateId, "ahead");
  assert.equal((await source.select({ generation: 0, candidates: options, observations: [o], current: { candidateId: "ahead", phase: "forming" } }, signal)).hold, true);
});

test("preview uses recent jumps for rides and forgets old jump intent", async () => {
  const physical = { from: [0, 0, 0] as Vec3, to: [0, 3, -6] as Vec3, distance: 1, span: 6, rise: 3, medium: "air" as const };
  const candidates = [{ ...candidate, id: "walk", kind: "weave" as const, physical }, { ...candidate, id: "ride", kind: "platform" as const, physical }];
  const o = { time: 5, position: [0, .825, 0] as Vec3, velocity: [0, 0, 0] as Vec3, gaze: [0, 0, -1] as Vec3, grounded: true, activeStructure: null };
  const source = new ScenarioDecisions(), signal = new AbortController().signal;
  for (const [time, expected] of [[4.7, "ride"], [3, "walk"]] as const) {
    const result = await source.select({ generation: 0, candidates, observations: [{ ...o, time, velocity: [0, 3, 0] }, o] }, signal);
    assert.equal(result.candidateId, expected);
  }
});

test("preview keeps an approaching half at a rim and still permits a deliberate side departure", async () => {
  const branch = { ...candidate, id: "branch", kind: "weave" as const,
    physical: { from: [0, 0, -25] as [number, number, number], to: [0, 0, -31] as [number, number, number],
      distance: 1, span: 6, rise: 0, medium: "air" as const } };
  const observation = { time: 1, position: [0, 0.885, -26] as [number, number, number],
    velocity: [0, 0, -2] as [number, number, number], gaze: [0, 0, -1] as [number, number, number],
    grounded: true, activeStructure: null };
  const player = { support: "living matter", motion: "walking forward", facing_into: "living matter", position_on_support: "at an edge" };
  const base = { observations: [observation], candidates: [branch], generation: 0,
    semantic: { player_now: player, recent_behavior_oldest_to_newest: [player],
      matter_now: { state: "active" as const, player_supported_by_matter: true } } };
  const source = new ScenarioDecisions(), signal = new AbortController().signal;
  assert.equal((await source.select(base, signal)).hold, true);
  assert.equal((await source.select({ ...base, semantic: { ...base.semantic,
    player_now: { ...player, position_on_support: "inside the support" } } }, signal)).hold, true);
  assert.equal((await source.select({ ...base, semantic: { ...base.semantic,
    player_now: { ...player, motion: "walking right", facing_into: "open air" } } }, signal)).candidateId, branch.id);
});
test("a reset invalidates an in-flight response", async () => {
  let resolve!: (value: Intervention) => void;
  const gate = new DecisionGate({
    select: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = gate.request(context);
  gate.reset();
  resolve({ candidateId: candidate.id });
  assert.equal(await pending, null);
});

test("preview preserves ready support through pitch and small yaw changes, then allows a real turn", async () => {
  const weave = createWeave(weaveRoute(sites[0]), 0), bank = weave.banks[0];
  const position = bank.from.map((v, i) => v * .14 + bank.to[i] * .86 + (i === 1 ? .885 : 0)) as Vec3;
  const yaw = Math.atan2(-(bank.to[0] - bank.from[0]), -(bank.to[2] - bank.from[2]));
  const scene = { time: 5, activeSite: 0, phase: "active" as const, kind: "weave", weave };
  const candidates = weaveCandidates(weave, sites[0], position, 5)!.candidates;
  const source = new ScenarioDecisions();
  const choose = async (angle: number, pitch: number) => {
    const o = { time: 5, position, velocity: [0, 0, 0] as Vec3, gaze: [-Math.sin(angle) * Math.cos(pitch), Math.sin(pitch), -Math.cos(angle) * Math.cos(pitch)] as Vec3, grounded: true, activeStructure: "reach" };
    const player_now = describePhysical(o, scene);
    return source.select({ generation: 0, observations: [o], candidates,
      semantic: { player_now, recent_behavior_oldest_to_newest: [player_now], matter_now: describeMatter(o, scene) } }, new AbortController().signal);
  };
  for (const offset of [-.12, 0, .12]) for (const pitch of [-.3, 0, .3])
    assert.equal((await choose(yaw + offset, pitch)).hold, true);
  assert.ok((await choose(yaw + Math.PI / 2, 0)).candidateId);
  // Turning back here already leads to the arrival shore, so retain that route.
  assert.equal((await choose(yaw + Math.PI, 0)).hold, true);
});
test("unknown decisions, no intervention and provider failures are safe", async () => {
  for (const id of ["unknown", null]) {
    assert.equal(
      await new DecisionGate({
        select: async () => ({ candidateId: id }),
      }).request(context),
      null,
    );
  }
  assert.equal(
    await new DecisionGate({
      select: async () => {
        throw new Error("offline");
      },
    }).request(context),
    null,
  );
});
test("a pending request never queues another provider call", async () => {
  let calls = 0,
    resolve!: (value: Intervention) => void;
  const gate = new DecisionGate({
    select: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const pending = gate.request(context);
  assert.equal(await gate.request(context), null);
  assert.equal(calls, 1);
  resolve({ candidateId: null });
  await pending;
});

test("explicit no-intervention differs from an unavailable provider", async () => {
  const none = new DecisionGate({
    select: async () => ({ candidateId: null }),
  });
  assert.deepEqual(await none.requestResult(context), {
    valid: true,
    candidate: null,
  });
  const failed = new DecisionGate({
    select: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(await failed.requestResult(context), {
    valid: false,
    candidate: null,
  });
});

test("the gate retains a live audit ID when the judgment holds", async () => {
  const gate = new DecisionGate({
    select: async () => ({ candidateId: null, hold: true, auditId: "call-id", browserRoundTripMs: 212 }),
  });
  assert.deepEqual(await gate.requestResult(context), {
    valid: false,
    candidate: null,
    auditId: "call-id",
    browserRoundTripMs: 212,
    gateStatus: "hold",
  });
});
