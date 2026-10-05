import { test } from "node:test";
import assert from "node:assert/strict";
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

test("every prompt branch is text-only, digit-free and independent of engine identifiers", () => {
  for (const context of [shoreContext(), edgeContext()]) {
    const request = buildDecisionRequest(context);
    assert.doesNotThrow(() => assertSemanticPrompt(request));
    assert.doesNotMatch(JSON.stringify(request), /\d|distance_units|degrees|length_units|rise_units|weave|siteId|sessionId/);
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
  context.candidates = context.candidates.filter(candidate => candidate.physical.rise > 1 && candidate.attachment!=="middle");
  const question = buildDecisionRequest(context).questions.best_candidate;
  const instructions = question.instructions as { shared_option_facts: Record<string, string> };
  assert.equal(instructions.shared_option_facts.vertical_change, "higher");
  assert.equal(instructions.shared_option_facts.attachment, "end of existing walking surface");
  assert.equal((question.criteria as Record<string, unknown>).none, "No formation fits intended direction and height.");
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
  for (const confidence of [.05, .9])
    assert.throws(() => composeDecision(context, judgments(context, options[0].label, { none: .01 }, confidence)), /probabilities/);
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

test("a suitable curve chosen by Jev survives a near-tied straight alternative", () => {
  const context=shoreContext(),menu=decisionOptions(context);
  const curve=menu.find(o=>o.description.path_shape.startsWith("bends")&&["aligned","close"].includes(o.description.view_alignment))!;
  const straight=menu.find(o=>o.description.path_shape==="straight"&&["aligned","close"].includes(o.description.view_alignment))!;
  const zeros=Object.fromEntries(menu.map(o=>[o.label,0]));
  const probabilities={...zeros,[curve.label]:.51,[straight.label]:.48,none:.01};
  for(let i=0;i<40;i++) {
    const next={...context,sessionId:`00000000-0000-4000-8000-${i.toString(16).padStart(12,"0")}`};
    const result=composeDecision(next,judgments(next,curve.label,probabilities,.22));
    assert.ok(curve.candidates.some(c=>c.id===result.candidateId));
  }
});

test("walking intent retains walking variety instead of rerolling a Jev walking choice into a ride",()=>{
  const context=shoreContext();
  context.observations=context.observations.map(o=>({...o,velocity:[0,0,-4]}));
  const menu=decisionOptions(context),walk=menu.find(o=>o.description.player_use==="walk"&&o.description.path_shape==="straight"&&o.description.view_alignment==="aligned")!;
  const curve=menu.find(o=>o.description.player_use==="walk"&&o.description.path_shape.startsWith("bends")&&["aligned","close"].includes(o.description.view_alignment))!;
  const ride=menu.find(o=>o.description.player_use==="ride a moving deck"&&o.description.movement_alignment!=="opposed")!;
  const probabilities={...Object.fromEntries(menu.map(o=>[o.label,0])),[walk.label]:.37,[curve.label]:.32,[ride.label]:.30,none:.01};
  const shapes=new Set();
  for(let i=0;i<40;i++) {
    const next={...context,sessionId:`00000000-0000-4000-8000-${i.toString(16).padStart(12,"0")}`};
    const decision=composeDecision(next,judgments(next,walk.label,probabilities,.27));
    const chosen=menu.find(o=>o.candidates.some(c=>c.id===decision.candidateId))!;
    assert.equal(chosen.description.player_use,"walk");
    shapes.add(chosen.description.path_shape);
    // A confident ride selected by Jev is still honored during movement.
    assert.ok(ride.candidates.some(c=>c.id===composeDecision(next,judgments(next,ride.label,undefined,.9)).candidateId));
  }
  assert.equal(shapes.size,2);
});

test("a positive height judgment and credible matching Jev Choice can depart continuous support",()=>{
  for(const height of ["higher","lower"]) {
    const context=edgeContext(),gazeY=height==="higher"?.3:-.35;
    context.observations=context.observations.map(o=>({...o,gaze:[0,gazeY,-Math.sqrt(1-gazeY*gazeY)]}));
    context.semantic.player_now.view_height=height==="higher"?"looking upward":"looking downward";
    context.semantic.player_now.facing_into="living matter";
    const menu=decisionOptions(context),selected=menu.find(o=>o.description.vertical_change===height)!,level=menu.find(o=>o.description.vertical_change==="at similar height")!;
    assert.ok(buildDecisionRequest(context).questions.height_intent);
    const answers=judgments(context,selected.label,undefined,.36);
    for(const answer of Object.values(answers)) if(answer.type==="noul")Object.assign(answer,{noul:.18});
    Object.assign(answers.height_intent,{noul:.52});
    assert.ok(selected.candidates.some(c=>c.id===composeDecision(context,answers).candidateId));
    for(const probability of [.49,.5]) {
      Object.assign(answers.height_intent,{noul:probability});
      assert.equal(composeDecision(context,answers).hold,true);
    }
    Object.assign(answers.height_intent,{noul:.52});
    Object.assign(answers.best_candidate,{confidence:.29});
    assert.equal(composeDecision(context,answers).hold,true);
    Object.assign(answers.best_candidate,{confidence:.36,choice:level.label});
    assert.equal(composeDecision(context,answers).hold,true);
    Object.assign(answers.best_candidate,{choice:"none"});
    assert.equal(composeDecision(context,answers).hold,true);
  }
});

test("an oblique Jev choice is allowed rather than being vetoed for an exact forward alignment", () => {
  const context=shoreContext();
  context.observations.forEach(o=>{o.gaze=[0,0,-1];});
  const menu=decisionOptions(context),forward=menu.find(o=>o.description.view_alignment==="aligned")!;
  const away=menu.find(o=>o.description.view_alignment==="oblique")!;
  const zeros=Object.fromEntries(menu.map(o=>[o.label,0]));
  const probabilities={...zeros,[away.label]:.6,[forward.label]:.26,none:.14};
  const result=composeDecision(context,judgments(context,away.label,probabilities,.25));
  assert.ok(away.candidates.some(c=>c.id===result.candidateId));
});

test("clear waiting intent and a held gap view tolerate slight no-match uncertainty", () => {
  const context=shoreContext(),menu=decisionOptions(context);
  const forward=menu.find(o=>o.description.view_alignment==="aligned")!;
  const zeros=Object.fromEntries(menu.map(o=>[o.label,0]));
  const probabilities={...zeros,[forward.label]:.69,none:.31};
  assert.equal(buildDecisionRequest(context).state.player_now.view_attention,"view held in the same direction");
  assert.ok(composeDecision(context,judgments(context,forward.label,probabilities,.25)).candidateId);
  const scanning=structuredClone(context);
  scanning.observations[0].gaze=[1,0,0];
  assert.equal(composeDecision(scanning,judgments(scanning,forward.label,probabilities,.25)).hold,true);
});

test("rounded probability totals are accepted at both boundaries while malformed totals are rejected", () => {
  const context=shoreContext();
  context.candidates=context.candidates.filter(c=>c.kind==="platform"||c.id==="reach:weave:1");
  const menu=decisionOptions(context);
  for (const sum of [.99,1.01]) {
    const probabilities={[menu[0].label]:.5,[menu[1].label]:sum-.52,none:.02};
    assert.ok(composeDecision(context,judgments(context,menu[0].label,probabilities,.1)).candidateId);
  }
  assert.throws(()=>composeDecision(context,judgments(context,menu[0].label,
    {[menu[0].label]:.5,[menu[1].label]:.47,none:.2},.1)),/probabilities/);
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

test("the server spells out view relative to the walkway and gives current intent priority", () => {
  for (const axis of ["left to right across view", "ahead-left to behind-right", "ahead-right to behind-left"]) {
    const context = edgeContext();
    context.semantic.player_now.walkway_axis = axis;
    context.semantic.player_now.position_on_support = "near an edge";
    context.semantic.player_now.motion = "standing";
    const request = buildDecisionRequest(context);
    assert.equal(request.state.player_now.view_to_walkway, axis === "left to right across view" ?
      "across the walkway toward its side" : "diagonally across the walkway");
    assert.equal(request.state.player_now.view_attention, "view held in the same direction");
    assert.match(JSON.stringify(request.questions.best_candidate.instructions), /toward that view over following the old walkway/);
    assert.match(JSON.stringify(request.questions.best_candidate.instructions), /Current direction and height override history/);
    assert.equal(!!request.questions.branch_intent, axis === "left to right across view");
    assertSemanticPrompt(request);
    for (const option of decisionOptions(context))
      assert.ok(option.candidates.some(candidate => candidate.id === composeDecision(context, judgments(context, option.label)).candidateId));
  }
  assert.doesNotMatch(JSON.stringify(buildDecisionRequest(shoreContext()).questions.best_candidate.instructions), /old walkway/);
});

test("held lateral intent can request a side branch from the centre while glances cannot", () => {
  const context = edgeContext();
  context.semantic.player_now.walkway_axis = "left to right across view";
  context.semantic.player_now.position_on_support = "near an edge";
  context.semantic.player_now.motion = "standing";
  assert.ok(buildDecisionRequest(context).questions.branch_intent);
  const glance = structuredClone(context);
  glance.observations[0].gaze = [-1, 0, 0];
  assert.equal(buildDecisionRequest(glance).questions.branch_intent, undefined);
  const moving = structuredClone(context);
  moving.semantic.player_now.motion = "walking right";
  assert.equal(buildDecisionRequest(moving).questions.branch_intent, undefined);
});

test("candidate prompts keep direction, shape and height without decorative or validated slope details", () => {
  const request = buildDecisionRequest(edgeContext());
  assert.doesNotMatch(JSON.stringify(request.questions), /surface_tilt|arched support|broad base/);
  for (const option of Object.values(request.questions.best_candidate.criteria!)) {
    if (typeof option !== "object" || option === null) continue;
    assert.ok("vertical_change" in option || "shared_option_facts" in (request.questions.best_candidate.instructions as object));
  }
  assertSemanticPrompt(request);
});

test("a separate height judgment cannot replace a strong Jev choice with a weak different-height option",()=>{
  const context=edgeContext(),menu=decisionOptions(context);
  const level=menu.find(o=>o.description.vertical_change==="at similar height")!;
  const higher=menu.find(o=>o.description.vertical_change==="higher")!;
  const answers={action_needed:{type:"noul",noul:.9},branch_intent:{type:"noul",noul:.9},height_intent:{type:"noul",noul:.9},best_candidate:{type:"choice",choice:level.label,confidence:.8,
    probabilities:Object.fromEntries([...menu.map(o=>[o.label,o===level?.83:o===higher?.04:0]),["none",.13]])}} as Parameters<typeof composeDecision>[1];
  assert.ok(level.candidates.some(c=>c.id===composeDecision(context,answers).candidateId));
});
