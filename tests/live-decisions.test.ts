import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  buildDecisionRequest,
  composeDecision,
  decisionSchema,
} from "../src/server/decision-request";
import { availableCandidates } from "../src/game/affordances";
import {
  applyWeave,
  bankProgress,
  createWeave,
  guardWeaveEdge,
  weaveCandidates,
  weaveRoute,
} from "../src/game/weave";
import { sites, type Vec3 } from "../src/game/world";
import { DecisionGate, type DecisionContext } from "../src/game/decisions";

test("primitive composition preserves uncertainty, supports withdrawal, and resists small score changes", async () => {
  const candidates = availableCandidates([0, 0.825, -22]);
  const context = decisionSchema.parse({
    generation: 0,
    candidates,
    observations: [
      {
        time: 1,
        position: [0, 0.825, -22],
        velocity: [0, 0, 0],
        gaze: [0, 0, -1],
        grounded: true,
        activeStructure: null,
      },
    ],
    current: { candidateId: candidates[1].id, phase: "active" },
  });
  type Answers = Parameters<typeof composeDecision>[1];
  const makeAnswers = (target: number, withdrawal = 0.1): Answers =>
    Object.fromEntries(
      Object.entries(buildDecisionRequest(context).questions).map(
        ([key, q]) => [
          key,
          q.type === "noul"
            ? {
                type: "noul",
                noul:
                  key === "withdraw"
                    ? withdrawal
                    : key === "redirect"
                      ? 0.1
                      : target,
              }
            : {
                type: "score",
                score: key === "fit_1" ? 2.6 : 2.8,
                confidence: 0,
                probabilities: { "0": 0, "1": 0, "2": 0.2, "3": 0.8 },
                legend: {
                  "0": "contradicts",
                  "1": "unknown",
                  "2": "compatible",
                  "3": "direct match",
                },
              },
        ],
      ),
    );
  const uncertain = composeDecision(context, makeAnswers(0.5));
  assert.equal(uncertain.hold, true);
  const gate = new DecisionGate({ select: async () => uncertain });
  assert.equal(
    (await gate.requestResult(context as DecisionContext)).valid,
    false,
  );
  assert.equal(
    composeDecision(context, makeAnswers(0.95)).candidateId,
    context.current!.candidateId,
  );
  const abandoned = composeDecision(context, makeAnswers(0.1, 0.95));
  assert.equal(abandoned.candidateId, null);
  assert.equal(abandoned.hold, undefined);
});

test("SDK batches destination and traversal judgments in one request; transport is entirely mocked", async () => {
  let calls = 0;
  const context = decisionSchema.parse({
    generation: 1,
    candidates: availableCandidates([0, 0.825, -22]),
    observations: [
      {
        time: 1,
        position: [0, 0.825, -22],
        velocity: [0, 0, -2],
        gaze: [0, 0, -1],
        grounded: true,
        activeStructure: null,
      },
    ],
  });
  const client = new TypeSafeClient({
    apiKey: "test-not-a-real-key",
    defaultModel: "jev-1.13.0",
    retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      assert.equal(Object.keys(body.questions).length, 6);
      assert.equal(body.questions.target_0.type, "noul");
      assert.equal(body.questions.fit_0.type, "score");
      assert.equal(body.questions.action, undefined);
      assert.equal(body.state.observations.length, 1);
      assert.ok(
        body.state.options.some(
          (c: { steps: unknown[] }) => c.steps.length > 1,
        ),
      );
      assert.equal(JSON.stringify(body.state).includes("reach"), false);
      return Response.json({
        model: "jev-1.13.0",
        usage: { input_tokens: 600, output_tokens: 60 },
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([key, q]) => [
            key,
            (q as { type: string }).type === "noul"
              ? { type: "noul", noul: key === "redirect" ? 0.1 : 0.95 }
              : {
                  type: "score",
                  score: key === "fit_0" ? 1 : 2.8,
                  confidence: 0.4,
                  probabilities: { "0": 0, "1": 0, "2": 0.2, "3": 0.8 },
                  legend: {
                    "0": "contradicts",
                    "1": "unknown",
                    "2": "compatible",
                    "3": "direct match",
                  },
                },
          ]),
        ),
      });
    },
  });
  const result = await client.systemOne(buildDecisionRequest(context));
  assert.equal(calls, 1);
  const decision = composeDecision(context, result.answers);
  assert.equal(
    context.candidates.find((c) => c.id === decision.candidateId)?.kind,
    "weave",
  );
  assert.equal(decision.recheckAfterMs, 6000);
});

test("rolling matter preserves occupied support, offers branches and rebuilds a return path", () => {
  const weave = createWeave(weaveRoute(sites[0]), 0);
  const occupied = weave.banks[1];
  const p: Vec3 = [0, 2.085, -32.5];
  assert.ok(bankProgress(occupied, p).supported);
  const next = weaveCandidates(weave, sites[0], p, 4)!;
  assert.equal(next.bank, 0);
  assert.equal(next.candidates.length, 3);
  applyWeave(weave, next.bank, next.segment, next.candidates[1].route!, 4);
  assert.equal(weave.banks[1], occupied);
  const guarded = guardWeaveEdge(
    weave,
    [0, 2.085, -34.55],
    [0, -0.01, -0.1],
    4.2,
  );
  assert.equal(guarded[2], 0);
  const back = weaveCandidates(weave, sites[0], p, 7)!;
  assert.equal(back.segment, 0);
  assert.equal(back.bank, 0);
  assert.equal(back.candidates[0].physical!.to[2], -25);
});
