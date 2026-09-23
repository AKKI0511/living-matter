import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { availableCandidates } from "../src/game/affordances";
import { DecisionGate, type Observation } from "../src/game/decisions";
import { createRuntime, physicalScene, semanticSnapshot } from "../src/game/runtime";
import { PhysicalHistory, describeCandidate, describePhysical, describeMatter, relativeDirection } from "../src/game/semantic";
import {
  buildDecisionRequest,
  composeDecision,
  decisionSchema,
} from "../src/server/decision-request";
import {
  applyWeave, bankProgress, createWeave, guardWeaveEdge,
  weaveCandidates, weaveRoute,
} from "../src/game/weave";
import { sites, type Vec3 } from "../src/game/world";

const observation = (position: Vec3, motion: Vec3, gaze: Vec3, time: number, grounded = true): Observation => ({
  time, position, velocity: motion, gaze, grounded, activeStructure: null,
});
function reachContext() {
  const runtime = createRuntime();
  const samples = [
    observation([0, 0.825, -19], [0, 0, -5.5], [0, 0, -1], 1),
    observation([0, 0.825, -22], [0, 0, -5.5], [0, 0, -1], 2),
    observation([0, 1.6, -24], [0, 4, -2], [0, 0, -1], 3, false),
    observation([0, 0.825, -23], [0, 0, 0], [0, 0, -1], 4),
    observation([0, 0.825, -20], [0, 0, 3], [0, 0, 1], 5),
    observation([0, 0.825, -22], [0, 0, -4], [0, 0, -1], 6),
    observation([0, 0.825, -23], [0, 0, 0], [0, 0, -1], 7),
  ];
  for (const sample of samples) {
    runtime.history.push(sample);
    runtime.physicalHistory.record(sample, physicalScene(runtime));
  }
  return decisionSchema.parse({
    sessionId: runtime.sessionId,
    generation: 0,
    observations: runtime.history,
    semantic: semanticSnapshot(runtime),
    candidates: availableCandidates(samples.at(-1)!.position),
  });
}
type Answers = Parameters<typeof composeDecision>[1];
function answers(action = 0.9, selected = "candidate_0", confidence = 0.8, abandonment?: number): Answers {
  return {
    action_needed: { type: "noul", noul: action },
    best_candidate: {
      type: "choice", choice: selected, confidence,
      probabilities: { candidate_0: selected === "candidate_0" ? 0.9 : 0.1, candidate_1: selected === "candidate_1" ? 0.9 : 0.1 },
    },
    ...(abandonment === undefined ? {} : { abandoned_current: { type: "noul", noul: abandonment } }),
  } as Answers;
}

test("physical history is event based and preserves attempts before waiting", () => {
  const context = reachContext();
  const events = context.semantic.recent_behavior_oldest_to_newest;
  assert.ok(events.length <= 8);
  assert.equal(context.semantic.player_now.motion, "standing");
  assert.ok(events.some((e) => e.motion === "jumped and landed back on the same support"));
  assert.ok(events.some((e) => e.motion === "walking forward"));
  assert.equal(context.semantic.player_now.facing_into, "open air");
  assert.equal(context.semantic.player_now.surface_beyond_facing, "separate walkable ground at similar height");
  assert.equal(JSON.stringify(buildDecisionRequest(context).state).includes("-23"), false);
});

test("Jev receives one action Noul and one candidate Choice with no authored directions", () => {
  const request = buildDecisionRequest(reachContext());
  assert.deepEqual(Object.keys(request.questions), ["action_needed", "best_candidate"]);
  assert.equal(request.questions.action_needed.type, "noul");
  assert.equal(request.questions.best_candidate.type, "choice");
  const criteria = request.questions.best_candidate.criteria as Record<string, Record<string, string>>;
  assert.ok(Object.keys(criteria).length >= 2);
  assert.ok(Object.values(criteria).some((c) => c.player_use === "walk on it under their own movement"));
  assert.ok(Object.values(criteria).some((c) => c.player_use === "stand on it while it carries the player"));
  assert.equal(JSON.stringify(request).includes("reach"), false);
  assert.equal(JSON.stringify(request).includes("span"), false);
});

test("thresholds hold uncertainty, act on a clear Choice, and retract only off matter", () => {
  const context = reachContext();
  assert.equal(composeDecision(context, answers(0.59)).hold, true);
  assert.equal(composeDecision(context, answers(0.9, "candidate_0", 0.29)).hold, true);
  assert.equal(composeDecision(context, answers(0.9, "candidate_1")).candidateId, context.candidates[1].id);
  assert.equal(composeDecision(context, answers(0.9, "candidate_99")).hold, true);
  const existing = decisionSchema.parse({ ...context, current: { candidateId: context.candidates[0].id, phase: "active" }, semantic: { ...context.semantic, matter_now: { state: "active", player_supported_by_matter: false } } });
  assert.ok(buildDecisionRequest(existing).questions.abandoned_current);
  assert.equal(composeDecision(existing, answers(0.9, "candidate_0", 0.8, 0.81)).candidateId, null);
  assert.equal(composeDecision(existing, answers(0.9, "candidate_0", 0.8, 0.79)).candidateId, context.candidates[0].id);
  const occupied = decisionSchema.parse({ ...existing, semantic: { ...existing.semantic, matter_now: { state: "active", player_supported_by_matter: true } } });
  assert.equal(buildDecisionRequest(occupied).questions.abandoned_current, undefined);
});

test("SDK batches the exact state and questions in one mocked request", async () => {
  const context = reachContext();
  let calls = 0;
  const client = new TypeSafeClient({
    apiKey: "test-not-a-real-key",
    defaultModel: "jev-1.13.0",
    retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.state, context.semantic);
      assert.deepEqual(Object.keys(body.questions), ["action_needed", "best_candidate"]);
      assert.equal(body.questions.best_candidate.type, "choice");
      assert.equal(body.state.observations, undefined);
      return Response.json({
        model: "jev-1.13.0", usage: { input_tokens: 300, output_tokens: 50 },
        answers: answers(0.92, "candidate_0", 0.75),
      });
    },
  });
  const result = await client.systemOne(buildDecisionRequest(context));
  assert.equal(calls, 1);
  assert.equal(composeDecision(context, result.answers).candidateId, context.candidates[0].id);
});

test("server endpoint composes a mocked Jev response without a live call", async (t) => {
  const context = reachContext();
  const auditRoot = await mkdtemp(join(tmpdir(), "living-matter-audit-route-"));
  t.after(async () => { assert.equal(dirname(auditRoot), resolve(tmpdir())); await rm(auditRoot, { recursive: true, force: true }); });
  const previousFetch = globalThis.fetch;
  const previousBackend = process.env.NEXT_PUBLIC_DECISION_BACKEND;
  const previousKey = process.env.TYPESAFE_API_KEY;
  const previousModel = process.env.TYPESAFE_DEFAULT_MODEL;
  const previousAuditRoot = process.env.JEV_SESSION_DIR;
  const previousAuditFlag = process.env.NEXT_PUBLIC_JEV_SESSION_AUDIT;
  const previousNodeEnv = process.env.NODE_ENV;
  const mutableEnv = process.env as Record<string, string | undefined>;
  let calls = 0;
  try {
    mutableEnv.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_DECISION_BACKEND = "jev";
    process.env.NEXT_PUBLIC_JEV_SESSION_AUDIT = "0";
    process.env.TYPESAFE_API_KEY = "test-not-a-real-key";
    process.env.TYPESAFE_DEFAULT_MODEL = "jev-1.13.0";
    process.env.JEV_SESSION_DIR = auditRoot;
    globalThis.fetch = async (_input, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.state, context.semantic);
      assert.equal(body.model, "jev-1.13.0");
      assert.equal(body.questions.best_candidate.type, "choice");
      return Response.json({ model: "jev-1.13.0", usage: { input_tokens: 300, output_tokens: 40 }, answers: answers(0.91, "candidate_2", 0.8), request_id: "mock-provider-request", evaluation_time_ms: 143.4 });
    };
    const { POST: startSession } = await import("../src/app/api/decision/session/route");
    assert.equal((await startSession(new Request("http://localhost:3000/api/decision/session", { method: "POST", body: JSON.stringify({ sessionId: context.sessionId }) }))).status, 409);
    const { POST } = await import("../src/app/api/decision/route");
    const unaudited = await POST(new Request("http://localhost:3000/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) }));
    assert.equal(unaudited.status, 200);
    assert.equal((await unaudited.json()).auditId, undefined);
    assert.deepEqual(await readdir(auditRoot), []);

    process.env.NEXT_PUBLIC_JEV_SESSION_AUDIT = "1";
    const started = await startSession(new Request("http://localhost:3000/api/decision/session", { method: "POST", body: JSON.stringify({ sessionId: context.sessionId }) }));
    assert.equal(started.status, 200);
    const response = await POST(new Request("http://localhost:3000/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) }));
    assert.equal(response.status, 200);
    const decision = await response.json();
    assert.equal(decision.candidateId, context.candidates[2].id);
    assert.match(decision.auditId, /^[0-9a-f-]{36}$/);
    const { POST: outcome } = await import("../src/app/api/decision/outcome/route");
    const reported = await outcome(new Request("http://localhost:3000/api/decision/outcome", { method: "POST", body: JSON.stringify({ sessionId: context.sessionId, auditId: decision.auditId, status: "applied", reason: "form_created", browserRoundTripMs: 250 }) }));
    assert.equal(reported.status, 200);
    const callDir = join(auditRoot, context.sessionId, "calls", decision.auditId);
    const savedRequest = JSON.parse(await readFile(join(callDir, "jev-request.json"), "utf8"));
    assert.deepEqual(savedRequest.state, context.semantic);
    const savedResponse = JSON.parse(await readFile(join(callDir, "jev-response.json"), "utf8"));
    assert.equal(savedResponse.request_id, "mock-provider-request");
    assert.equal(savedResponse.evaluation_time_ms, 143.4);
    const summary = JSON.parse(await readFile(join(auditRoot, context.sessionId, "summary.json"), "utf8"));
    assert.equal(summary.successful_calls, 1);
    assert.equal(summary.total_input_tokens, 300);
    assert.equal(summary.cost.known_estimated_usd, 0.0000126);
    assert.equal(summary.confirmed_game_outcomes.applied, 1);
    assert.equal(calls, 2);

    mutableEnv.NODE_ENV = "production";
    const productionContext = reachContext();
    assert.equal((await startSession(new Request("http://localhost:3000/api/decision/session", { method: "POST", body: JSON.stringify({ sessionId: productionContext.sessionId }) }))).status, 409);
    const productionResponse = await POST(new Request("http://localhost:3000/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(productionContext) }));
    assert.equal(productionResponse.status, 200);
    assert.equal((await productionResponse.json()).auditId, undefined);
    assert.deepEqual(await readdir(auditRoot), [context.sessionId]);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBackend === undefined) delete process.env.NEXT_PUBLIC_DECISION_BACKEND;
    else process.env.NEXT_PUBLIC_DECISION_BACKEND = previousBackend;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.TYPESAFE_DEFAULT_MODEL;
    else process.env.TYPESAFE_DEFAULT_MODEL = previousModel;
    if (previousAuditRoot === undefined) delete process.env.JEV_SESSION_DIR;
    else process.env.JEV_SESSION_DIR = previousAuditRoot;
    if (previousAuditFlag === undefined) delete process.env.NEXT_PUBLIC_JEV_SESSION_AUDIT;
    else process.env.NEXT_PUBLIC_JEV_SESSION_AUDIT = previousAuditFlag;
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
  }
});

test("egocentric descriptions rotate and mirror without changing physical meaning", () => {
  const a = observation([0, 0.825, -23], [0, 0, -2], [0, 0, -1], 1);
  const rotated = observation([23, 0.825, 0], [2, 0, 0], [1, 0, 0], 1);
  assert.equal(relativeDirection(a.position, [0, 0, -40], a.gaze), "ahead");
  assert.equal(relativeDirection(rotated.position, [40, 0, 0], rotated.gaze), "ahead");
  assert.equal(relativeDirection(a.position, [12, 0, -35], a.gaze), "ahead-right");
  assert.equal(relativeDirection(a.position, [-12, 0, -35], a.gaze), "ahead-left");
  const scene = { time: 1, activeSite: null, phase: "idle" as const, weave: null };
  assert.equal(describePhysical(a, scene).support, "permanent ground");
});

test("occupied weave remains protected while the free section can rebuild behind or ahead", () => {
  const weave = createWeave(weaveRoute(sites[0]), 0);
  const occupied = weave.banks[1];
  const p: Vec3 = [0, 2.085, -32.5];
  assert.ok(bankProgress(occupied, p).supported);
  assert.equal(describePhysical(observation(p, [0, 0, 0], [0, 0, 1], 4), { time: 4, activeSite: 0, phase: "active", kind: "weave", weave }).facing_into, "living matter");
  const next = weaveCandidates(weave, sites[0], p, 4)!;
  assert.equal(next.bank, 0);
  assert.equal(next.candidates.length, 3);
  applyWeave(weave, next.bank, next.segment, next.candidates[1].route!, 4);
  assert.equal(weave.banks[1], occupied);
  const guarded = guardWeaveEdge(weave, [0, 2.085, -34.55], [0, -0.01, -0.1], 4.2);
  assert.equal(guarded[2], 0);
  const back = weaveCandidates(weave, sites[0], p, 7)!;
  assert.equal(back.segment, 0);
  assert.equal(back.bank, 0);
  assert.equal(back.candidates[0].physical!.to[2], -25);
  const facing: Vec3 = [0, 0, 1];
  const state = describeMatter(observation(p, [0, 0, 0], facing, 7), { time: 7, activeSite: 0, phase: "active", kind: "weave", weave });
  assert.equal(state.player_supported_by_matter, true);
  assert.equal(state.reusable_section_relative_to_player, "behind");
  assert.equal(describeCandidate(back.candidates[0], observation(p, [0, 0, 0], facing, 7), true).extends, "ahead of the player's current facing");
});

test("reset invalidates a pending response after direction changes", async () => {
  const context = reachContext();
  let resolve!: (value: { candidateId: string }) => void;
  const gate = new DecisionGate({ select: () => new Promise((r) => { resolve = r; }) });
  const pending = gate.requestResult(context);
  gate.reset();
  resolve({ candidateId: context.candidates[0].id });
  assert.equal((await pending).valid, false);
});
