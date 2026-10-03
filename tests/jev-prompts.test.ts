import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { assertSemanticPrompt } from "../src/game/decision-state";
import { buildDecisionRequest, composeDecision, decisionOptions, type DecisionRequestContext } from "../src/server/decision-request";
import { edgeContext, shoreContext } from "./helpers/jev-context";

type Answers = Parameters<typeof composeDecision>[1];
function judgments(context: DecisionRequestContext, selected: string, probabilities?: Record<string, number>, confidence = .9): Answers {
  const questions = buildDecisionRequest(context).questions;
  const labels = Object.keys(questions.best_candidate.criteria!);
  return {
    ...Object.fromEntries(Object.entries(questions).filter(([, value]) => value.type === "noul").map(([key]) => [key, { type: "noul", noul: key === "action_needed" ? .9 : .1 }])),
    best_candidate: { type: "choice", choice: selected, confidence,
      probabilities: probabilities ?? Object.fromEntries(labels.map(label => [label, label === selected ? 1 : 0])),
    },
  } as Answers;
}

test("every prompt branch is text-only, digit-free and independent of engine identifiers", async () => {
  for (const context of [shoreContext(), edgeContext()]) {
    const request = buildDecisionRequest(context);
    assert.doesNotThrow(() => assertSemanticPrompt(request));
    assert.doesNotMatch(JSON.stringify(request), /\d|distance_units|degrees|length_units|rise_units|weave|siteId|sessionId/);
    let sent = false;
    const client = new TypeSafeClient({ apiKey: "mock", fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.state, request.state);
      assert.deepEqual(body.questions, request.questions);
      assertSemanticPrompt({ state: body.state, questions: body.questions });
      sent = true;
      return Response.json({ model: "mock", answers: {}, usage: {} });
    } });
    await client.systemOne(request);
    assert.ok(sent);
  }
});

test("the physical menu keeps rides, turns, climbs, descents, side branches and tilted surfaces distinguishable", () => {
  const shore = decisionOptions(shoreContext());
  assert.ok(shore.some(option => option.description.formation === "moving deck"));
  assert.ok(shore.some(option => option.description.path_shape.startsWith("bends left")));
  assert.ok(shore.some(option => option.description.path_shape.startsWith("bends right")));
  const edge = edgeContext();
  const menu = decisionOptions(edge);
  for (const predicate of [
    (description: Record<string, string>) => description.vertical_change === "higher",
    (description: Record<string, string>) => description.vertical_change === "lower",
    (description: Record<string, string>) => description.path_shape === "gentle left turn",
    (description: Record<string, string>) => description.path_shape === "gentle right turn",
    (description: Record<string, string>) => description.formation === "side branch with a broad base",
    (description: Record<string, string>) => description.surface_tilt === "level across its width",
  ]) assert.ok(menu.some(option => predicate(option.description)));
  const tilted = structuredClone(edge);
  tilted.candidates[0].crossSlope = .25;
  assert.ok(decisionOptions(tilted).some(option => option.description.surface_tilt === "tilted across its width"));
  for (const option of menu) {
    const result = composeDecision(edge, judgments(edge, option.label));
    assert.ok(option.candidates.some(candidate => candidate.id === result.candidateId));
  }
});

test("whole physical form families are not collapsed into the same walking option", () => {
  const context = shoreContext();
  const original = context.candidates[0];
  context.candidates = ["bridge", "stairs", "platform", "floating-path", "weave"].map(kind => ({
    ...original, id: `test:${kind}`, kind: kind as typeof original.kind, route: undefined,
  }));
  assert.equal(new Set(decisionOptions(context).map(option => option.description.formation)).size, context.candidates.length);
  assertSemanticPrompt(buildDecisionRequest(context));
});

test("reordered and renamed engine candidates preserve exact semantic labels and physical selections", () => {
  const original = edgeContext();
  const changed = structuredClone(original);
  changed.candidates.reverse();
  changed.candidates.forEach((candidate, index) => { candidate.id = `renamed:${index}`; candidate.siteId = "unrelated-stage"; });
  assert.deepEqual(buildDecisionRequest(changed), buildDecisionRequest(original));
  for (const option of decisionOptions(original)) {
    const before = composeDecision(original, judgments(original, option.label));
    const after = composeDecision(changed, judgments(changed, option.label));
    assert.deepEqual(original.candidates.find(candidate => candidate.id === before.candidateId)?.physical,
      changed.candidates.find(candidate => candidate.id === after.candidateId)?.physical);
  }
});

test("option order varies across sessions without rerolling an unchanged scene or changing option meaning", () => {
  const context = edgeContext();
  const first = new Set<string>();
  const initial = buildDecisionRequest(context);
  for (let index = 0; index < 40; index++) {
    const next = { ...context, sessionId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` };
    const request = buildDecisionRequest(next);
    first.add(Object.keys(request.questions.best_candidate.criteria!)[0]);
    for (const option of decisionOptions(next)) {
      assert.equal(composeDecision(next, judgments(next, option.label)).candidateId, option.candidates[0].id);
    }
  }
  assert.ok(first.size > 3);
  assert.deepEqual(buildDecisionRequest(context), initial);
});

test("shared height and attachment facts remain present when every option has them", () => {
  const context = edgeContext();
  context.candidates = context.candidates.filter(candidate => candidate.physical.rise > 1);
  const question = buildDecisionRequest(context).questions.best_candidate;
  const instructions = question.instructions as { shared_option_facts: Record<string, string> };
  assert.equal(instructions.shared_option_facts.vertical_change, "higher");
  assert.equal(instructions.shared_option_facts.attachment, "end of existing walking surface");
  assert.equal((question.criteria as Record<string, unknown>).none, "The available formations do not serve the indicated direction or height.");
});

test("clear intent with equally useful walking and riding alternatives can act despite low Choice concentration", () => {
  const original = shoreContext();
  original.candidates = original.candidates.filter(candidate => candidate.kind === "platform" || candidate.kind === "weave" && candidate.id === "reach:weave:1");
  const options = decisionOptions(original);
  assert.equal(options.length, 2);
  const distribution = Object.fromEntries([...options.map(option => [option.label, .49]), ["none", .02]]);
  const chosen = new Set<string>();
  for (let index = 0; index < 40; index++) {
    const context = { ...original, sessionId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` };
    const result = composeDecision(context, judgments(context, options[0].label, distribution, .05));
    assert.ok(result.candidateId);
    chosen.add(context.candidates.find(candidate => candidate.id === result.candidateId)!.kind);
    assert.deepEqual(composeDecision(context, judgments(context, options[0].label, distribution, .05)), result);
  }
  assert.deepEqual(chosen, new Set(["weave", "platform"]));
});

test("unclear intent, no-match uncertainty, opposing alternatives and malformed probabilities cannot trigger a formation", () => {
  const context = shoreContext();
  const options = decisionOptions(context);
  const labels = [...options.map(option => option.label), "none"];
  const low = Object.fromEntries(labels.map(label => [label, label === "none" ? .4 : .6 / options.length]));
  assert.equal(composeDecision(context, judgments(context, options[0].label, low, .05)).hold, true);
  const clear = { ...judgments(context, options[0].label), action_needed: { type: "noul" as const, noul: .59 } };
  assert.equal(composeDecision(context, clear).hold, true);
  const spuriousBranch = { ...clear, branch_intent: { type: "noul" as const, noul: .99 } }; // Not asked at this ground edge.
  assert.equal(composeDecision(context, spuriousBranch).hold, true);
  assert.equal(composeDecision(context, judgments(context, "none")).hold, true);
  assert.throws(() => composeDecision(context, judgments(context, options[0].label, { none: .01 }, .05)), /probabilities/);
  assert.throws(() => composeDecision(context, judgments(context, options[0].label, { ...low, invented: .2 }, .05)), /probabilities/);
  const backwards = structuredClone(context);
  backwards.observations.forEach(observation => { observation.gaze = [0,0,1]; });
  const backOptions = decisionOptions(backwards);
  const backProbabilities = Object.fromEntries([...backOptions.map(option => [option.label, .98 / backOptions.length]), ["none", .02]]);
  assert.equal(composeDecision(backwards, judgments(backwards, backOptions[0].label, backProbabilities, .05)).hold, true);
});

test("a missing view height does not request a speculative height judgment", () => {
  const context = edgeContext();
  delete context.semantic.player_now.view_height;
  assert.ok(buildDecisionRequest(context).questions.branch_intent);
  assert.equal(buildDecisionRequest(context).questions.height_intent, undefined);
});

test("comparable options must serve known higher ground when no separate height question is needed", () => {
  const context = edgeContext();
  context.semantic.player_now.view_height = "looking roughly level";
  context.semantic.player_now.surface_beyond_facing = "separate walkable ground higher";
  context.observations.forEach(observation => { observation.gaze = [0,0,-1]; });
  const turning = context.candidates.filter(candidate => candidate.attachment === "far end" && candidate.turnDegrees === 35);
  context.candidates = [turning.find(candidate => Math.abs(candidate.physical.rise) < .1)!,
    turning.find(candidate => candidate.physical.rise > 1)!];
  const options = decisionOptions(context);
  assert.equal(options.length, 2);
  const distribution = Object.fromEntries([...options.map(option => [option.label,.49]),["none",.02]]);
  const decision = composeDecision(context,judgments(context,options[0].label,distribution,.05));
  assert.ok(context.candidates.find(candidate => candidate.id === decision.candidateId)!.physical.rise > 0);
});

test("a confident Choice with a malformed distribution is rejected as an invalid provider reply", () => {
  const context = shoreContext();
  const option = decisionOptions(context)[0];
  assert.throws(() => composeDecision(context,judgments(context,option.label,{ [option.label]:1 },.9)), /probabilities/);
});

test("forming material holds even when a newly ordered menu receives a different confident answer", () => {
  const context = edgeContext();
  context.current = { candidateId: context.candidates[0].id, phase: "forming" };
  for (const option of decisionOptions(context))
    assert.equal(composeDecision(context, judgments(context, option.label)).hold, true);
});

test("an equivalent option keeps the current physical commitment rather than replacing it with an alias", () => {
  const context = shoreContext();
  const current = context.candidates[0];
  context.candidates.unshift({ ...structuredClone(current), id: "equivalent-alias" });
  context.current = { candidateId: current.id, phase: "active" };
  const option = decisionOptions(context).find(option => option.candidates.some(candidate => candidate.id === current.id))!;
  assert.equal(option.candidates[0].id,"equivalent-alias");
  assert.equal(composeDecision(context,judgments(context,option.label)).candidateId,current.id);
});
