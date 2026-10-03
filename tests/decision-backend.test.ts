import { test } from "node:test";
import assert from "node:assert/strict";
import { JevDecisions } from "../src/game/decision-backend";
import { availableCandidates } from "../src/game/affordances";
import { DecisionGate, type DecisionContext, type Observation } from "../src/game/decisions";
import { useGame } from "../src/game/store";

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

const latest: Observation = { time: 1, position: [0, 0.825, -23], velocity: [0, 0, -2], gaze: [0, 0, -1], grounded: true, activeStructure: null };
const context: DecisionContext = { generation: 0, observations: [latest], candidates: availableCandidates(latest.position) };

test("rate limits, exhausted budgets, outages, invalid replies and network errors use preview", async (t) => {
  for (const reply of [
    () => new Response(null, { status: 429 }),
    () => new Response(null, { status: 503 }),
    () => new Response(null, { status: 500 }),
    () => Response.json({ candidateId: "unknown" }),
    () => Response.json({ hold: true }),
    () => new Response("invalid json"),
    () => { throw new Error("offline"); },
  ]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => { calls++; return reply(); });
    useGame.setState({ providerUnavailable: false });
    const source = new JevDecisions();
    const gate = new DecisionGate(source);
    const result = await gate.requestResult(context);
    assert.equal(result.valid, true);
    assert.ok(result.candidate);
    assert.equal(useGame.getState().providerUnavailable, true);
    assert.ok((await gate.requestResult(context)).candidate);
    assert.equal(calls, 1);
    mock.mock.restore();
  }
});

test("a hanging transport or response body falls back before the outer deadline", async (t) => {
  for (const response of [
    () => new Promise<Response>(() => {}),
    () => Promise.resolve({ ok: true, headers: new Headers(), json: () => new Promise(() => {}) } as Response),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", response);
    const gate = new DecisionGate(new JevDecisions(15), 150);
    const result = await gate.requestResult(context);
    assert.equal(result.valid, true);
    assert.ok(result.candidate);
    mock.mock.restore();
  }
});

test("Retry-After is respected, resets do not hammer the provider and live recovery clears fallback", async (t) => {
  let now = 0, calls = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "60" } })
      : Response.json({ candidateId: context.candidates[0].id });
  });
  const source = new JevDecisions(), signal = new AbortController().signal;
  await source.select(context, signal);
  source.reset(); now = 30_000;
  assert.ok((await source.select(context, signal)).candidateId);
  assert.equal(calls, 1);
  now = 60_001;
  await source.select(context, signal);
  assert.equal(calls, 2);
  assert.equal(useGame.getState().providerUnavailable, false);
});

test("pause and obsolete requests do not switch backend or apply preview", async (t) => {
  let finish!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { finish = resolve; }));
  useGame.setState({ providerUnavailable: false });
  const source = new JevDecisions(40), gate = new DecisionGate(source, 150);
  const pending = gate.requestResult(context);
  gate.reset();
  finish(new Response(null, { status: 503 }));
  assert.equal((await pending).valid, false);
  assert.equal(useGame.getState().providerUnavailable, false);
});
