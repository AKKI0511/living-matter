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

test("offset shoreline approaches have adjacent support in both travel directions", () => {
  for (const site of sites) for (const from of [site.start, site.end]) {
    for (const offset of [-8, -6.4, -4, 0, 4, 6.4, 8]) {
      const p: Vec3 = [from[0] + offset, from[1] + 0.825, from[2]];
      const candidates = availableCandidates(p).filter(c => c.siteId === site.id && c.route);
      assert.ok(candidates.some(c => c.physical!.distance <= 2.15), `${site.id} ${JSON.stringify(p)}`);
      assert.ok(availableCandidates(p).length <= 16);
      assert.ok(candidates.every(c => c.route![0].every((v, i) => v === c.physical!.from[i])));
    }
  }
});

test("shore ports remain the same physical action during a short walk", () => {
  const before = availableCandidates([-6.4, 0.825, -23.8]);
  const after = availableCandidates([-6.2, 0.825, -24.4]);
  for (const candidate of before.filter(c => c.physical!.from[0] === -8)) {
    const current = after.find(c => c.id === candidate.id);
    assert.ok(current);
    assert.deepEqual(current.route, candidate.route);
    assert.deepEqual(current.physical!.from, candidate.physical!.from);
  }
});

test("preview does not form an off-centre dock while walking normally across an island", async () => {
  const source = new ScenarioDecisions();
  const current = observation([-9.6, 0.825, -57], [-0.5, 0, -0.9], [-2, 0, -4]);
  const result = await source.select({
    generation: 0, observations: [current], candidates: availableCandidates(current.position),
    semantic: {
      player_now: { support: "permanent ground", motion: "walking forward", facing_into: "walkable ground" },
      recent_behavior_oldest_to_newest: [{ support: "permanent ground", motion: "walking forward" }],
      matter_now: { state: "idle", player_supported_by_matter: false },
    },
  }, new AbortController().signal);
  assert.equal(result.candidateId, null);
  assert.equal(result.hold, true);
});

test("selection depends on physical geometry and behavior, not stage identity or order", async () => {
  const source = new ScenarioDecisions(),
    signal = new AbortController().signal;
  const scene = [...sites].reverse().map((s, i) => ({
    ...s,
    id: `unknown-${i}`,
    preferred: "bridge" as const,
  }));
  const candidates = availableCandidates([14, 6.825, -104], scene).reverse();
  const result = await source.select(
    {
      observations: [observation([14, 6.825, -104], [-0.76, 0, -0.65])],
      candidates,
      generation: 0,
    },
    signal,
  );
  assert.equal(
    candidates.find((c) => c.id === result.candidateId)?.kind,
    "weave",
  );
  const reverse = availableCandidates([-14, 0.825, -52], scene);
  const returning = await source.select(
    {
      observations: [observation([-14, 0.825, -52], [0.57, 0, 0.82], [1, 0, 2])],
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
  const candidates = availableCandidates([-14, 0.825, -62]);
  assert.equal(
    (
      await source.select(
        {
          observations: [observation([-14, 0.825, -62], [-1, 0, 0])],
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
      observations: [observation([-14, 0.825, -62], [0.8, 0.4, -0.45])],
      candidates,
      generation: 0,
    },
    signal,
  );
  const jumping = await source.select(
    {
      observations: [observation([-14, 1.2, -62], [0.8, 0.4, -0.45], [0, 4, -1])],
      candidates,
      generation: 0,
    },
    signal,
  );
  assert.equal(
    candidates.find((c) => c.id === walking.candidateId)?.kind,
    "weave",
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
