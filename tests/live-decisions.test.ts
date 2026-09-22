import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  buildDecisionRequest,
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

test("SDK sends three judgments in one request; transport is entirely mocked", async () => {
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
      assert.equal(Object.keys(body.questions).length, 3);
      assert.equal(body.state.observations.length, 1);
      assert.ok(body.state.candidates.some((c: { route: unknown }) => c.route));
      assert.equal(JSON.stringify(body.state).includes("reach"), false);
      return Response.json({
        model: "jev-1.13.0",
        usage: { input_tokens: 600, output_tokens: 60 },
        answers: {
          action: {
            type: "choice",
            choice: "c0",
            confidence: 0.8,
            probabilities: { c0: 0.9, none: 0.1 },
          },
          assistance: { type: "noul", noul: 0.95 },
          changing: { type: "noul", noul: 0.2 },
        },
      });
    },
  });
  const result = await client.systemOne(buildDecisionRequest(context));
  assert.equal(calls, 1);
  assert.equal(result.answers.action.choice, "c0");
  assert.equal(result.answers.assistance.noul, 0.95);
});

test("rolling matter preserves occupied support, offers branches and rebuilds a return path", () => {
  const weave = createWeave(weaveRoute(sites[0]), 0);
  const occupied = weave.banks[1];
  const p: Vec3 = [0, 0.885, -32.5];
  assert.ok(bankProgress(occupied, p).supported);
  const next = weaveCandidates(weave, sites[0], p, 4)!;
  assert.equal(next.bank, 0);
  assert.equal(next.candidates.length, 3);
  applyWeave(weave, next.bank, next.segment, next.candidates[1].route!, 4);
  assert.equal(weave.banks[1], occupied);
  const guarded = guardWeaveEdge(
    weave,
    [0, 0.885, -34.55],
    [0, -0.01, -0.1],
    4.2,
  );
  assert.equal(guarded[2], 0);
  const back = weaveCandidates(weave, sites[0], p, 7)!;
  assert.equal(back.segment, 0);
  assert.equal(back.bank, 0);
  assert.equal(back.candidates[0].physical!.to[2], -25);
});
