import { test } from "node:test";
import assert from "node:assert/strict";
import { availableCandidates } from "../src/game/affordances";
import {
  ScenarioDecisions,
  DecisionGate,
  type Observation,
} from "../src/game/decisions";
import { sites, type Vec3 } from "../src/game/world";
const observation = (
  position: Vec3,
  gaze: Vec3,
  velocity: Vec3 = [0, 0, 0],
): Observation => ({
  time: 1,
  position,
  gaze,
  velocity,
  grounded: true,
  activeStructure: null,
});

test("selection depends on physical geometry and behavior, not stage identity or order", async () => {
  const source = new ScenarioDecisions(),
    signal = new AbortController().signal;
  const scene = [...sites].reverse().map((s, i) => ({
    ...s,
    id: `unknown-${i}`,
    preferred: "bridge" as const,
  }));
  const candidates = availableCandidates([0, 6.825, -104], scene).reverse();
  const result = await source.select(
    {
      observations: [observation([0, 6.825, -104], [0, 0, -1])],
      candidates,
      generation: 0,
    },
    signal,
  );
  assert.equal(
    candidates.find((c) => c.id === result.candidateId)?.kind,
    "platform",
  );
  const reverse = availableCandidates([0, 0.825, -52], scene);
  const returning = await source.select(
    {
      observations: [observation([0, 0.825, -52], [0, 0, 1], [0, 0, 2])],
      candidates: reverse,
      generation: 0,
    },
    signal,
  );
  assert.equal(
    reverse.find((c) => c.id === returning.candidateId)?.physical?.to[2],
    -25,
  );
});

test("looking away produces no intervention, while repeated jumps can change assistance", async () => {
  const source = new ScenarioDecisions(),
    signal = new AbortController().signal;
  const candidates = availableCandidates([0, 0.825, -62]);
  assert.equal(
    (
      await source.select(
        {
          observations: [observation([0, 0.825, -62], [1, 0, 0])],
          candidates,
          generation: 0,
        },
        signal,
      )
    ).candidateId,
    null,
  );
  const walking = await source.select(
    {
      observations: [observation([0, 0.825, -62], [0, 0.4, -0.9])],
      candidates,
      generation: 0,
    },
    signal,
  );
  const jumping = await source.select(
    {
      observations: [observation([0, 1.2, -62], [0, 0.4, -0.9], [0, 4, -1])],
      candidates,
      generation: 0,
    },
    signal,
  );
  assert.equal(
    candidates.find((c) => c.id === walking.candidateId)?.kind,
    "stairs",
  );
  assert.equal(
    candidates.find((c) => c.id === jumping.candidateId)?.kind,
    "platform",
  );
});

test("a stalled future provider times out and can be queried again", async () => {
  let calls = 0;
  const gate = new DecisionGate(
    {
      select: async () => {
        calls++;
        return new Promise(() => {});
      },
    },
    20,
  );
  assert.equal(await gate.request({ observations: [], candidates: [] }), null);
  assert.equal(await gate.request({ observations: [], candidates: [] }), null);
  assert.equal(calls, 2);
});
