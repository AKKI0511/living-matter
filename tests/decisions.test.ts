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
