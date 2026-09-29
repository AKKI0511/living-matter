import { test } from "node:test";
import assert from "node:assert/strict";
import { JevDecisions } from "../src/game/decision-backend";
import { availableCandidates } from "../src/game/affordances";
import type { DecisionContext, Observation } from "../src/game/decisions";

test("unchanged holds are cached and a changed candidate meaning triggers a new call", async (t) => {
  let now = 0, calls = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ candidateId: null, hold: true, recheckAfterMs: 1800, auditId: "first-call" });
  });
  const latest: Observation = { time: 1, position: [0, 0.825, -23], velocity: [0, 0, 0], gaze: [0, 0, -1], grounded: true, activeStructure: null };
  const context: DecisionContext = { generation: 0, observations: [latest], candidates: availableCandidates(latest.position) };
  const source = new JevDecisions(), signal = new AbortController().signal;
  await source.select(context, signal);
  now = 2000;
  assert.equal((await source.select(context, signal)).auditId, undefined);
  now = 7900;
  await source.select(context, signal);
  assert.equal(calls, 1);
  await source.select({ ...context, observations: [{ ...latest, gaze: [1, 0, 0] }] }, signal);
  assert.equal(calls, 2);
  now = 16000;
  await source.select(context, signal);
  assert.equal(calls, 3);
});
