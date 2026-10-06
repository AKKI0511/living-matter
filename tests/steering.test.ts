import { test } from "node:test";
import assert from "node:assert/strict";
import { createWeave, weaveRoute, weaveCandidates, applySteeringCandidate, bankProgress, guardWeaveEdge, weavePose, weaveServesRoute } from "../src/game/weave";
import { sites, withinMatterBounds, type Vec3 } from "../src/game/world";
import { PhysicalHistory, describeCandidate } from "../src/game/semantic";
import type { Observation } from "../src/game/decisions";

test("a true westward side branch exists and only the unoccupied half changes", () => {
  const weave = createWeave([[0, 1, -25], [0, 1, -31], [0, 1, -37], [0, 1, -43], [-14, 0, -45]], 0);
  const p: Vec3 = [0, 1.885, -28];
  const occupied = weave.banks[0];
  const options = weaveCandidates(weave, sites[0], p, 5)!;
  const west = options.candidates.find(c => c.attachment === "middle" && c.physical!.to[0] < -5 && c.physical!.to[2] === c.physical!.from[2])!;
  assert.ok(west);
  assert.ok(options.candidates.length <= 16);
  assert.ok(options.candidates.every(c => withinMatterBounds(sites[0], c.physical!.to)));
  const sample: Observation = { time: 5, position: p, velocity: [0, 0, 0], grounded: true, gaze: [-1, 0, 0], activeStructure: "reach" };
  assert.equal(describeCandidate(west, sample, true).heading, "ahead");
  applySteeringCandidate(weave, options.bank, west, 5);
  assert.equal(weave.banks[0], occupied);
  assert.equal(weave.banks[1].to[2], occupied.from[2] - 3);
  assert.ok(bankProgress(occupied, p).supported);
});

test("ordinary turns offer both diagonal ramps and a distinct supported form", () => {
  const weave = createWeave([[0, 1, -25], [0, 1, -31], [0, 1, -37]], 0);
  const occupied = weave.banks[0];
  const options = weaveCandidates(weave, sites[0], [0, 1.885, -29], 5)!;
  assert.ok(options.candidates.length <= 16);
  const diagonal = options.candidates.find(c => c.attachment === "far end" && c.turnDegrees === 35 && c.physical?.rise === 1.5)!;
  assert.ok(diagonal);
  const sample: Observation = { time: 5, position: [0, 1.885, -29], velocity: [0, 0, 0], gaze: [0.4, 0.2, -0.9], grounded: true, activeStructure: "reach" };
  assert.equal(describeCandidate(diagonal, sample, true).path_shape, "gentle right turn");
  assert.equal(describeCandidate(diagonal, sample, true).view_alignment, "aligned");
  assert.equal(describeCandidate(diagonal, sample, true).formation, "turning path with arched support");
  applySteeringCandidate(weave, options.bank, diagonal, 5);
  assert.equal(weave.banks[0], occupied);
  assert.equal(weave.banks[1].shape, "arch");
  assert.ok(bankProgress(weave.banks[1], [diagonal.physical!.from[0], diagonal.physical!.from[1] + 0.885, diagonal.physical!.from[2]]).supported);
  assert.ok(weavePose(weave.banks[1], 192).position[1] < weavePose({ ...weave.banks[1], shape: "deck" }, 192).position[1] - 0.5);
});

test("candidate bounds hold through repeated arbitrary branches", () => {
  const weave = createWeave([[0, 1, -25], [0, 1, -31], [0, 1, -37], [0, 1, -43], [-14, 0, -45]], 0);
  for (let i = 0; i < 50; i++) {
    const occupied = weave.banks[i % 2];
    const p = occupied.from.map((v, a) => v * 0.3 + occupied.to[a] * 0.7 + (a === 1 ? 0.885 : 0)) as Vec3;
    const options = weaveCandidates(weave, sites[0], p, 10 + i * 3);
    if (!options) break;
    assert.ok(options.candidates.every(c => withinMatterBounds(sites[0], c.physical!.to)));
    const c = options.candidates[i % options.candidates.length];
    const supported = weave.banks[1 - options.bank];
    applySteeringCandidate(weave, options.bank, c, 10 + i * 3);
    assert.equal(weave.banks[1 - options.bank], supported);
  }
});

test("continuing uphill does not descend below the approaching higher shore", () => {
  const site = sites[1], weave = createWeave(weaveRoute(site, 1), 0);
  const bank = weave.banks[1];
  const p = bank.from.map((v, a) => v * 0.25 + bank.to[a] * 0.75 + (a === 1 ? 0.885 : 0)) as Vec3;
  const options = weaveCandidates(weave, site, p, 5)!;
  const continuation = options.candidates.find(c => c.attachment === "far end" && c.physical!.rise === 1.5)!;
  assert.equal(continuation.physical!.to[1], 5.7);
  assert.ok(continuation.physical!.to[1] > bank.to[1]);
});

test("edge guards check physical adjacency rather than matching segment numbers", () => {
  const weave = createWeave([[0, 1, -25], [0, 1, -31], [0, 1, -37], [0, 1, -43], [-14, 0, -45]], 0);
  weave.banks[1] = { ...weave.banks[1], from: [-20, 1, -31], to: [-20, 1, -37] };
  const guarded = guardWeaveEdge(weave, [0, 1.885, -30.5], [0, -0.01, -0.1], 5);
  assert.ok(Math.abs(guarded[2]) < 1e-10);
  weave.banks[1] = { ...weave.banks[1], from: [0, 1, -31], to: [-6, 1, -31] };
  assert.deepEqual(guardWeaveEdge(weave, [0, 1.885, -30.5], [0, -0.01, -0.1], 5), [0, -0.01, -0.1]);
  weave.banks[1].since = 4.5;
  assert.deepEqual(guardWeaveEdge(weave, [0, 1.885, -30.5], [-0.1, -0.01, -0.1], 5), [0, -0.01, 0]);
});

test("a slow ninety-degree turn while standing is recorded as a new direction", () => {
  const history = new PhysicalHistory();
  const weave = createWeave([[0, 1, -25], [0, 1, -31], [0, 1, -37], [0, 1, -43], [-14, 0, -45]], 0);
  const scene = { time: 5, activeSite: 0, phase: "active" as const, kind: "weave", weave };
  for (let angle = 0; angle <= Math.PI / 2 + 0.01; angle += Math.PI / 12) {
    history.record({ time: angle + 5, position: [0, 1.885, -28], velocity: [0, 0, 0], grounded: true, gaze: [-Math.sin(angle), 0, -Math.cos(angle)], activeStructure: "reach" }, scene);
  }
  assert.ok(history.snapshot({ support: "living matter", motion: "standing" }).some(e => e.motion === "turned toward unsupported space and stopped"));
});

test("a section meeting the shore permits the last step before permanent ground", () => {
  const weave = createWeave([[0, 0, -25], [0, 0, -31], [0, 0, -37], [0, 0, -43], [-14, 0, -45]], 0);
  weave.banks[0] = { ...weave.banks[0], from: [-8, 0, -41], to: [-14, 0, -45.2] };
  const p = weave.banks[0].from.map((v, a) => v * 0.08 + weave.banks[0].to[a] * 0.92 + (a === 1 ? 0.885 : 0)) as Vec3;
  const movement: Vec3 = [-0.1, -0.01, -0.1];
  assert.deepEqual(guardWeaveEdge(weave, p, movement, 5), movement);
});

test("the player can step across a shore seam smaller than their capsule radius", () => {
  for (const gap of [0.17, 0.4, 0.7]) {
    const weave = createWeave([[0, 0, -25], [0, 0, -31], [0, 0, -37], [0, 0, -43], [-14, 0, -45]], 0);
    weave.banks[0] = { ...weave.banks[0], from: [-8, 0, -41], to: [-14, 0, -45 + gap] };
    const p = weave.banks[0].from.map((v, a) => v * 0.08 + weave.banks[0].to[a] * 0.92 + (a === 1 ? 0.885 : 0)) as Vec3;
    const movement: Vec3 = [-0.1, -0.01, -0.1];
    const guarded = guardWeaveEdge(weave, p, movement, 5);
    if (gap < 0.47) assert.deepEqual(guarded, movement);
    else assert.notDeepEqual(guarded, movement);
  }
});

test("an elevated deck releases walking onto the ground below without releasing an open-water edge", () => {
  const weave = createWeave([[-14, 0.825, -41], [-14, 0.825, -47], [-14, 0.825, -53]], 0);
  weave.banks[1].since = 5;
  const movement: Vec3 = [0, -0.01, -0.1];
  assert.deepEqual(guardWeaveEdge(weave, [-14, 1.71, -46.6], movement, 5), movement);
  const overWater = createWeave([[0, 0.825, -25], [0, 0.825, -31], [0, 0.825, -37]], 0);
  overWater.banks[1].since = 5;
  assert.notDeepEqual(guardWeaveEdge(overWater, [0, 1.71, -30.6], movement, 5), movement);
  const high = createWeave([[-14, 3, -41], [-14, 3, -47], [-14, 3, -53]], 0);
  high.banks[1].since = 5;
  assert.notDeepEqual(guardWeaveEdge(high, [-14, 3.885, -46.6], movement, 5), movement);
});

test("the bounded steering menu retains a return landing at the shore's height", () => {
  const weave = createWeave([[-1.8, 0.45, -27.5], [-3.5, 1.2, -30], [-7, 1.2, -35]], 0);
  weave.banks[1] = { ...weave.banks[1], from: [-4.1, 0.825, -27.7], to: [-9, 0.825, -24.3], crossSlope: 0.25 };
  const p: Vec3 = [-2.6, 1.3, -26.7];
  const options = weaveCandidates(weave, sites[0], p, 5, [2.6, 0, 3.7])!;
  assert.ok(options.candidates.length <= 16);
  const landing = options.candidates.find(c => c.attachment === "near end" && c.physical!.landing && c.physical!.to[2] > -25);
  assert.ok(landing);
  assert.equal(landing.physical!.to[1], 0);
  const occupied = weave.banks[0];
  applySteeringCandidate(weave, options.bank, landing, 5);
  assert.equal(weave.banks[0], occupied);
});

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

test("a route at landing height cannot descend below the nearby landing cliff",()=>{
  const weave=createWeave([[3,6,-170],[3,6,-176],[3,6,-182]],0);
  const options=weaveCandidates(weave,sites[3],[3,6.885,-174],5)!;
  assert.ok(options.candidates.some(c=>c.attachment==="far end"&&c.physical!.rise>=0));
  assert.ok(!options.candidates.some(c=>c.attachment==="far end"&&c.physical!.to[2]<-180&&c.physical!.rise<0));
});
