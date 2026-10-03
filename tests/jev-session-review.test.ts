import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { buildDecisionRequest, decisionPolicy } from "../src/server/decision-request";
import { createSessionReview, exportSessionDataset, replaySession } from "../src/server/jev-session-review";

test("offline replay preserves order, compares policies, and exports only valid human labels", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "living-matter-review-"));
  t.after(async () => { assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  const sessionId = randomUUID(), callId = randomUUID(), pendingId = randomUUID();
  const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));
  await mkdir(join(directory, "calls", callId), { recursive: true });
  await mkdir(join(directory, "calls", pendingId));
  await save(join(directory, "session.json"), { session_id: sessionId, revision: "example", decision_policy: decisionPolicy });
  const event = { support: "permanent ground", motion: "walking forward" };
  const context = {
    sessionId, generation: 0,
    semantic: { player_now: event, recent_behavior_oldest_to_newest: [event], matter_now: { state: "idle" as const, player_supported_by_matter: false } },
    observations: [{ time: 3, position: [0, 1, 0] as [number, number, number], velocity: [0, 0, -1] as [number, number, number], gaze: [0, 0, -1] as [number, number, number], grounded: true, activeStructure: null }],
    candidates: [{ id: "test:weave", siteId: "test", kind: "weave" as const, physical: { from: [0, 0, 0] as [number, number, number], to: [0, 0, -10] as [number, number, number], distance: 10, span: 10, rise: 0, medium: "air" as const } }],
  };
  const path = join(directory, "calls", callId);
  const request = { model: "jev-1.13.0", ...buildDecisionRequest(context) };
  await save(join(path, "started.json"), { sequence: 0, started_at: "2026-09-27T00:00:00Z" });
  await save(join(directory, "calls", pendingId, "started.json"), { sequence: 1 });
  await save(join(path, "game-context.json"), context);
  await save(join(path, "jev-request.json"), request);
  await save(join(path, "jev-response.json"), { answers: { action_needed: { type: "noul", noul: 0.9 }, best_candidate: { type: "choice", choice: "option_a", confidence: 1, probabilities: { option_a: 1, none: 0 } } } });
  await save(join(path, "audit.json"), { status: "success", decision: { candidateId: null, hold: true } });
  const replay = await replaySession(directory);
  assert.deepEqual(replay.calls.map((call) => call.call_id), [callId, pendingId]);
  assert.equal(replay.calls[0].decision_changed, true);
  assert.equal(replay.calls[0].request_changed, false);
  assert.equal(replay.calls[1].status, "pending");
  const review = await createSessionReview(directory);
  await assert.rejects(createSessionReview(directory), { code: "EEXIST" });
  assert.deepEqual(await exportSessionDataset(directory), []);
  Object.assign(review.calls[0], { include: true, expected_answers: { action_needed: true, best_candidate: "option_a" }, notes: "Human verified forward traversal", tags: ["forward"] });
  await save(join(directory, "review.json"), review);
  const rows = await exportSessionDataset(directory);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].input, request);
  assert.deepEqual(rows[0].expected_answers, { action_needed: true, best_candidate: "option_a" });
  const oldRequest = { ...request, questions: { ...request.questions, best_candidate: { type: "choice", instructions: "Choose the route", criteria: { candidate_0: "forward route", none: "no match" } } } };
  await save(join(path, "jev-request.json"), oldRequest);
  const oldReplay = await replaySession(directory);
  assert.equal(oldReplay.calls[0].request_changed, true);
  assert.equal(oldReplay.calls[0].status, "prompt_changed");
  assert.equal(oldReplay.calls[0].replayed_decision, null);
  Object.assign(review.calls[0], { expected_answers: { action_needed: true, best_candidate: "candidate_0" } });
  await save(join(directory, "review.json"), review);
  assert.deepEqual((await exportSessionDataset(directory))[0].input, oldRequest);
  Object.assign(review.calls[0], { expected_answers: { best_candidate: "candidate_99" } });
  await save(join(directory, "review.json"), review);
  await assert.rejects(exportSessionDataset(directory), /Invalid expected answer/);
});
