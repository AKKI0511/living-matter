import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DecisionGate,
  ScenarioDecisions,
  type Intervention,
} from "../src/game/decisions";
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

test("preview considers a branch at a matter rim even when the old deck continues ahead", async () => {
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
  assert.equal((await source.select(base, signal)).candidateId, branch.id);
  assert.equal((await source.select({ ...base, semantic: { ...base.semantic,
    player_now: { ...player, position_on_support: "inside the support" } } }, signal)).hold, true);
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
