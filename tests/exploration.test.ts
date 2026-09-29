import { test } from "node:test";
import assert from "node:assert/strict";
import { availableCandidates } from "../src/game/affordances";
import { createWeave, weaveCandidates, applySteeringCandidate, bankProgress, weavePose } from "../src/game/weave";
import { islands, sites, WORLD_LIMITS, withinMatterBounds, clearMatterSection, type Vec3 } from "../src/game/world";
import { createRuntime, currentObservation, semanticSnapshot } from "../src/game/runtime";
import { input } from "../src/game/input";

test("current gaze reflects a turn before the next history sample", () => {
  const previous = { yaw: input.yaw, pitch: input.pitch };
  try {
    const runtime = createRuntime();
    runtime.history.push({ time: 1, position: [0, 0.825, -23], velocity: [0, 0, 0], grounded: true, gaze: [0, 0, -1], activeStructure: null });
    Object.assign(input, { yaw: Math.PI / 2, pitch: 0.4 });
    const current = currentObservation(runtime)!;
    assert.ok(current.gaze[0] < -0.9);
    assert.ok(current.gaze[1] > 0.38);
    assert.ok(Math.abs(current.gaze[2]) < 0.001);
    assert.deepEqual(runtime.history[0].gaze, [0, 0, -1]);
  } finally { Object.assign(input, previous); }
});

test("every island offers outward departures on all four edges, independent of crossing order", () => {
  const geometry = [...sites].reverse().map((s, i) => ({ ...s, id: `geometry-${i}` }));
  for (const island of islands) for (const axis of [0, 2]) for (const sign of [-1, 1]) {
    const p: Vec3 = [...island.position];
    p[1] += island.size[1] / 2 + 0.825;
    p[axis] += sign * (island.size[axis] / 2 - 1);
    const boundary = axis === 0 ? (sign < 0 ? WORLD_LIMITS.minX + 3 : WORLD_LIMITS.maxX - 3) : (sign < 0 ? WORLD_LIMITS.minZ + 3 : WORLD_LIMITS.maxZ - 3);
    if (Math.abs(boundary - p[axis]) < 13) continue;
    const tangent = axis === 0 ? 2 : 0;
    const candidates = [-0.25, 0, 0.25].flatMap(offset => {
      const approach: Vec3 = [...p];
      approach[tangent] += island.size[tangent] * offset;
      return availableCandidates(approach, geometry);
    });
    const outward = candidates.filter(c => c.id.includes(":explore:") &&
      (c.physical!.to[axis] - c.physical!.from[axis]) * sign > 5);
    assert.ok(outward.length, JSON.stringify(p));
    assert.ok(outward.some(c => c.physical!.distance < 2));
    assert.ok(availableCandidates(p, geometry).length <= 16);
    assert.ok(outward.every(c => c.route!.length === 3 && c.route!.every(point => withinMatterBounds(sites[0], point))));
  }
});

test("exploration can continue well outside its owning crossing, but cannot enter solids or leave the world", () => {
  const weave = createWeave([[-30, 3, -30], [-30, 3, -36], [-30, 3, -42]], 0);
  const options = weaveCandidates(weave, sites[0], [-30, 3.885, -39], 5)!;
  assert.ok(options.candidates.some(c => c.physical!.to[2] < -45));
  assert.equal(clearMatterSection([42, 2, -30], [48, 2, -30]), false);
  assert.equal(clearMatterSection([-10, 0, -9], [-5, 0, -9]), false);
  assert.equal(clearMatterSection([0, 0, -40], [-14, 0, -52]), true);
  assert.equal(clearMatterSection([12, 0, -93], [18, 0, -93]), false);
});

test("matter can meet a shore but cannot keep building a raised wall across its island", () => {
  assert.equal(clearMatterSection([14, 6, -85], [16.95, 7.2, -90.3]), true);
  assert.equal(clearMatterSection([16.95, 7.2, -90.3], [16.27, 7.2, -96.28]), false);
});

test("side branches match the occupied incline across their width and preserve occupied support", () => {
  for (const rise of [-1.2, 1.2]) for (const side of [-1, 1]) {
    const weave = createWeave([[0, 3, -30], [0, 3 + rise, -36], [0, 3 + rise * 2, -42]], 0);
    const occupied = weave.banks[0];
    const p: Vec3 = [0, 3 + rise / 2 + 0.885, -33];
    const options = weaveCandidates(weave, sites[0], p, 5)!;
    const branch = options.candidates.find(c => c.attachment === "middle" && Math.sign(c.physical!.to[0]) === side)!;
    assert.ok(branch);
    assert.ok(Math.abs(branch.crossSlope!) > 0.19);
    applySteeringCandidate(weave, options.bank, branch, 5);
    assert.equal(weave.banks[0], occupied);
    const built = weave.banks[1];
    for (const along of [-2, 0, 2]) {
      const joint: Vec3 = [branch.physical!.from[0], 3 + rise / 2 - rise / 6 * along + 0.885, -33 + along];
      assert.ok(bankProgress(occupied, joint).supported);
      assert.ok(bankProgress(built, joint).supported);
      assert.equal(weaveCandidates(weave, sites[0], joint, 8), null);
    }
    const row = Array.from({ length: 8 }, (_, i) => weavePose(built, i).position[1]);
    assert.ok(Math.abs(row[7] - row[0]) > 0.8);
  }
});

test("request state uses current grounded physics when the last history sample was airborne", () => {
  const runtime = createRuntime();
  runtime.history.push({ time: 1, position: [0, 2, -23], velocity: [0, -4, 0], grounded: false, gaze: [0, 0, -1], activeStructure: null });
  Object.assign(runtime, { time: 1.1, player: [0, 0.825, -23], velocity: [0, 0, 0], grounded: true });
  assert.equal(currentObservation(runtime)!.grounded, true);
  assert.equal(semanticSnapshot(runtime)!.player_now.support, "permanent ground");
  assert.equal(semanticSnapshot(runtime)!.player_now.motion, "standing");
  assert.equal(runtime.history[0].grounded, false);
});

test("an uphill section offers a level landing without penetrating the island", () => {
  const weave = createWeave([[0, 4.2, -77], [5.21, 5.7, -79.98], [10.42, 7.2, -82.95]], 0);
  const options = weaveCandidates(weave, sites[1], [3.9, 6.21, -79.2], 5)!;
  assert.ok(options.candidates.some(c => c.attachment === "far end" && c.physical!.landing && c.physical!.to[1] === 6 && c.crossSlope === 0));
});

test("a low exploration route can climb beside a high cliff using shorter clear ramps", () => {
  const weave = createWeave([[-14,0,-81],[-7.27,1.5,-82.923],[-0.539,3,-84.846]],0);
  const options = weaveCandidates(weave, sites[1], [-2.22,3.51,-84.365],5)!;
  const climb = options.candidates.find(c => c.attachment === "far end" && c.physical!.rise > 0 && c.physical!.to[0] > c.physical!.from[0] && c.physical!.span <= 3);
  assert.ok(climb);
  assert.ok(climb.physical!.rise / climb.physical!.span <= 0.26);
  assert.ok(clearMatterSection(climb.physical!.from, climb.physical!.to));
});

test("end landing offers leave their attachment instead of folding through occupied support", () => {
  const weave = createWeave([[-7,1.5,-87],[-1,3,-87],[-1,3,-93]],0);
  weave.banks[1] = { ...weave.banks[1], from: [-14,0,-87], to: [-7,1.5,-87] };
  const options = weaveCandidates(weave, sites[1], [-1.675,3.729,-87],5)!;
  assert.ok(options);
  for (const candidate of options.candidates) {
    if (candidate.attachment === "middle") continue;
    const { from, to } = candidate.physical!;
    assert.ok((to[0] - from[0]) * (candidate.attachment === "near end" ? -1 : 1) >= -0.01);
  }
  assert.ok(options.candidates.some(c => c.attachment === "far end" && c.physical!.rise > 0 &&
    c.physical!.rise / c.physical!.span <= 0.26));
  assert.ok(options.candidates.some(c => c.attachment === "near end" && c.physical!.to[0] < -7));
});

test("a low section still offers help at its tip and rim without recycling occupied support", () => {
  // Reconstruct the two halves after decision 42 of the September 28 audit.
  const weave = createWeave([[30.8, 3.75, -127.8], [30.8, 2.25, -133.8], [30.8, 0.75, -139.8]], 0);
  const occupied = weave.banks[1];
  for (const p of [
    [30.8, 1.71, -139.5], // 95% along: formerly beyond the 94% eligibility limit
    [33.1, 2.46, -136.8], // near the side rim: formerly outside the inset strip
  ] as Vec3[]) {
    assert.ok(bankProgress(occupied, p).supported);
    const options = weaveCandidates(weave, sites[2], p, 5);
    assert.ok(options?.candidates.length, JSON.stringify(p));
    assert.equal(options.bank, 0);
    assert.equal(weave.banks[1], occupied);
  }
  // Both halves really do support a capsule at their shared join; neither may recycle.
  assert.equal(weaveCandidates(weave, sites[2], [30.8, 3.135, -133.8], 5), null);
});

test("the latest right-hand descent can turn toward the island from its outer rim", () => {
  // Decision 49 built this descending section. The old support is no longer
  // under a player who has moved along it; the new one must be able to branch.
  const weave = createWeave([[22.6, 6, -129], [22.6, 6, -135], [22.6, 6, -141]], 0);
  weave.banks[0] = { ...weave.banks[0], segment: 5, from: [22.6, 6, -141], to: [22.6, 4.5, -147] };
  const p: Vec3 = [24, 5.885, -145];
  assert.ok(bankProgress(weave.banks[0], p).supported);
  assert.equal(bankProgress(weave.banks[1], p).supported, false);
  const options = weaveCandidates(weave, sites[2], p, 5);
  assert.ok(options?.candidates.length);
  assert.equal(options.bank, 1);
  assert.ok(options.candidates.some(c => c.physical!.to[0] < c.physical!.from[0] - 2));
});
