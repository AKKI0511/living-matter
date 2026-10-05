import {test} from "node:test";
import assert from "node:assert/strict";
import {availableCandidates} from "../src/game/affordances";
import {assemblyDetour, assemblySupportsPlayer} from "../src/game/assembly";
import {deliberateHeightView} from "../src/game/view-intent";
import {buildDecisionRequest, composeDecision, decisionOptions} from "../src/server/decision-request";
import {JevDecisions} from "../src/game/decision-backend";
import {shoreContext,edgeContext} from "./helpers/jev-context";
import {createWeave, weaveCandidates, applySteeringCandidate, bankProgress, weaveServesRoute} from "../src/game/weave";
import {sites} from "../src/game/world";
import {describePhysical} from "../src/game/semantic";

test("an existing level route serves the same route but cannot veto a climb, descent or turn",()=>{
  const route: [number,number,number][]=[[0,0,-25],[0,0,-31],[0,0,-37]],weave=createWeave(route,0);
  const candidate={id:"route",siteId:"reach",kind:"weave" as const,route,
    physical:{from:route[0],to:route[2],distance:1,span:12,rise:0,medium:"air" as const}};
  assert.equal(weaveServesRoute(weave,candidate),true);
  assert.equal(weaveServesRoute(weave,{...candidate,route:[route[2],route[1],route[0]]}),true);
  for(const rise of [-1.5,1.5])
    assert.equal(weaveServesRoute(weave,{...candidate,route:[route[0],[0,rise,-31],[0,rise*2,-37]]}),false);
  assert.equal(weaveServesRoute(weave,{...candidate,route:[route[0],route[1],[4,0,-36]]}),false);
  assert.equal(weaveServesRoute(weave,{...candidate,route:[route[0],route[1],[0,0,-40]]}),false);
  assert.equal(weaveServesRoute(weave,{...candidate,crossSlope:.1}),false);
});

test("clear Jev choices survive while ambiguous choices retain probability-backed variety",()=>{
  const original=shoreContext(),menu=decisionOptions(original);
  const straight=menu.find(o=>o.description.path_shape==="straight"&&o.description.player_use==="walk"&&o.description.view_alignment==="aligned"&&o.description.vertical_change==="higher")!;
  const curve=menu.find(o=>o.description.path_shape.startsWith("bends")&&o.description.view_alignment==="aligned"&&o.description.vertical_change==="higher")!;
  const shapes=new Set();
  for(let i=0;i<40;i++){
    const context={...original,sessionId:`00000000-0000-4000-8000-${i.toString(16).padStart(12,"0")}`};
    const answers={action_needed:{type:"noul",noul:.9},best_candidate:{type:"choice",choice:straight.label,confidence:.5,probabilities:Object.fromEntries([...menu.map(o=>[o.label,o===straight?.57:o===curve?.42:0]),["none",.01]])}} as Parameters<typeof composeDecision>[1];
    const decision=composeDecision(context,answers);
    shapes.add(menu.find(o=>o.candidates.some(c=>c.id===decision.candidateId))!.description.path_shape);
    assert.ok(straight.candidates.some(c=>c.id===decision.candidateId));
    const ambiguous={...answers,best_candidate:{...answers.best_candidate,confidence:.2}};
    const varied=composeDecision(context,ambiguous);
    shapes.add(menu.find(o=>o.candidates.some(c=>c.id===varied.candidateId))!.description.path_shape);
    assert.deepEqual(composeDecision(context,answers),decision);
    const dominant={...answers,best_candidate:{type:"choice" as const,choice:straight.label,confidence:.98,probabilities:Object.fromEntries([...menu.map(o=>[o.label,o===straight?.98:o===curve?.01:0]),["none",.01]])}};
    assert.ok(straight.candidates.some(c=>c.id===composeDecision(context,dominant).candidateId));
    shapes.add(straight.description.path_shape);
  }
  assert.equal(shapes.size,2);
});

test("a side-shore departure offers descending and rising paths instead of only level paths",()=>{
  const candidates=availableCandidates([3.903,6.832,-101.365]);
  assert.ok(candidates.some(c=>c.physical!.rise<0));
  assert.ok(candidates.some(c=>c.physical!.rise>0));
  assert.ok(candidates.some(c=>c.physical!.rise===0));
  assert.ok(candidates.length<=16);
});

test("a route at landing height cannot descend below the nearby landing cliff",()=>{
  const weave=createWeave([[3,6,-170],[3,6,-176],[3,6,-182]],0);
  const options=weaveCandidates(weave,sites[3],[3,6.885,-174],5)!;
  assert.ok(options.candidates.some(c=>c.attachment==="far end"&&c.physical!.rise>=0));
  assert.ok(!options.candidates.some(c=>c.attachment==="far end"&&c.physical!.to[2]<-180&&c.physical!.rise<0));
});

test("moderate held height intent works while slight and transient glances do not",()=>{
  const context=shoreContext();
  const moderate=context.observations.map(o=>({...o,gaze:[0,.25,-.97] as [number,number,number]}));
  assert.equal(deliberateHeightView(moderate),"higher");
  assert.equal(deliberateHeightView(moderate.map(o=>({...o,gaze:[0,.1,-.99] as [number,number,number]}))),undefined);
  assert.equal(deliberateHeightView([...context.observations.slice(0,-1),moderate.at(-1)!]),undefined);
  context.semantic.player_now.view_height="looking upward";
  context.observations=moderate;
  assert.ok(buildDecisionRequest(context).questions.height_intent);
});

test("downward intent needs a deeper tilt without changing upward recognition",()=>{
  const context=shoreContext();
  const scene={time:1,activeSite:null,phase:"idle" as const,weave:null};
  const look=(gazeY:number)=>context.observations.map(o=>({...o,gaze:[0,gazeY,-Math.sqrt(1-gazeY*gazeY)] as [number,number,number]}));
  for(const gazeY of [-.15,-.24]) {
    const observations=look(gazeY),event=describePhysical(observations.at(-1)!,scene);
    assert.equal(event.view_height,"looking roughly level");
    assert.equal(deliberateHeightView(observations),undefined);
    assert.equal(buildDecisionRequest({...context,observations,semantic:{...context.semantic,player_now:event}}).questions.height_intent,undefined);
  }
  const observations=look(-.31),event=describePhysical(observations.at(-1)!,scene);
  assert.equal(event.view_height,"looking downward");
  assert.equal(deliberateHeightView(observations),"lower");
  assert.ok(buildDecisionRequest({...context,observations,semantic:{...context.semantic,player_now:event}}).questions.height_intent);
  assert.equal(deliberateHeightView(look(.24)),"higher");
  assert.equal(describePhysical(look(.15).at(-1)!,scene).view_height,"looking upward");
});

test("an offered idle continuation survives history expiry and menu changes until deliberate new intent",async t=>{
  let clock=0,calls=0;
  t.mock.method(performance,"now",()=>clock);
  const context=shoreContext(),id=context.candidates[0].id;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({candidateId:id});});
  const source=new JevDecisions(),signal=new AbortController().signal;
  await source.select(context,signal);
  context.current={candidateId:id,phase:"active"};
  context.semantic.recent_behavior_oldest_to_newest=[context.semantic.player_now];
  context.candidates=context.candidates.slice().reverse();
  clock=30_000;
  assert.equal((await source.select(context,signal)).hold,true);
  assert.equal(calls,1);
  context.observations=context.observations.map(o=>({...o,gaze:[1,0,0]}));
  await source.select(context,signal);
  assert.equal(calls,2);
});

test("forming surfaces catch descending landings without blocking an intersected capsule",()=>{
  assert.equal(assemblySupportsPlayer(1,2.5,true),true);
  assert.equal(assemblySupportsPlayer(1,1,true),false);
  assert.equal(assemblySupportsPlayer(1,1,false),true);
  const a=assemblyDetour(0,1,0,[0,1,0],.5,0),b=assemblyDetour(0,1,0,[0,1,0],.5,1);
  assert.ok(Math.hypot(a[0],a[2])>=.89);
  assert.ok(a[2]*b[2]<0);
  assert.deepEqual(assemblyDetour(0,1,0,[0,1,0],1,0),[0,1,0]);
});

test("an ascending occupied ramp offers rising and descending exits on both absolute sides",()=>{
  const weave=createWeave([[0,1,-25],[0,2.5,-31],[0,4,-37]],0),occupied=weave.banks[0];
  const options=weaveCandidates(weave,sites[0],[0,2.635,-28],5)!;
  for(const side of [-90,90]) for(const rise of [-1.5,0,1.5]) {
    const candidate=options.candidates.find(c=>c.attachment==="middle"&&c.turnDegrees===side&&c.physical!.rise===rise);
    assert.ok(candidate,`${side} side with ${rise} rise`);
    const copy=structuredClone(weave);
    applySteeringCandidate(copy,options.bank,candidate,5);
    assert.deepEqual(copy.banks[0],occupied);
    assert.ok(bankProgress(copy.banks[0],[0,2.635,-28]).supported);
  }
  assert.ok(options.candidates.length<=16);
});

test("a separate height judgment cannot replace a strong Jev choice with a weak different-height option",()=>{
  const context=edgeContext(),menu=decisionOptions(context);
  const level=menu.find(o=>o.description.vertical_change==="at similar height")!;
  const higher=menu.find(o=>o.description.vertical_change==="higher")!;
  const answers={action_needed:{type:"noul",noul:.9},branch_intent:{type:"noul",noul:.9},height_intent:{type:"noul",noul:.9},best_candidate:{type:"choice",choice:level.label,confidence:.8,
    probabilities:Object.fromEntries([...menu.map(o=>[o.label,o===level?.83:o===higher?.04:0]),["none",.13]])}} as Parameters<typeof composeDecision>[1];
  assert.ok(level.candidates.some(c=>c.id===composeDecision(context,answers).candidateId));
});

test("an unchanged held scene avoids repeat inference after history expiry, while a new jump gets reconsidered",async t=>{
  let clock=0,calls=0;
  t.mock.method(performance,"now",()=>clock);
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({candidateId:null,hold:true});});
  const context=shoreContext(),source=new JevDecisions(),signal=new AbortController().signal;
  await source.select(context,signal);
  clock=30_000;context.candidates.reverse();context.semantic.recent_behavior_oldest_to_newest=[context.semantic.player_now];
  assert.equal((await source.select(context,signal)).hold,true);assert.equal(calls,1);
  const before=context.observations.at(-1)!;
  context.observations=[...context.observations,{...before,time:2,grounded:false,velocity:[0,3,0]},{...before,time:2.4}];
  await source.select(context,signal);assert.equal(calls,2);
});

test("acknowledging an applied formation restores its commitment after the geometry reset",async t=>{
  let calls=0;
  const context=shoreContext(),id=context.candidates[0].id;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({candidateId:id});});
  const source=new JevDecisions(),signal=new AbortController().signal;
  await source.select(context,signal);source.reset();source.commit(id,context.observations.at(-1)!);
  context.current={candidateId:id,phase:"active"};
  assert.equal((await source.select(context,signal)).hold,true);assert.equal(calls,1);
});
