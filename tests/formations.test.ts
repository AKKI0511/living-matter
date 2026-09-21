import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sites,
  structureBoxes,
  formationPose,
  platformOffset,
  MATTER_COUNT,
} from "../src/game/world";
test("every solid formation reaches both shores with traversable step heights", () => {
  for (const site of sites)
    for (const kind of site.candidates) {
      if (kind === "platform") continue;
      const boxes = structureBoxes(site, kind);
      const near = boxes[0],
        far = boxes.at(-1)!;
      assert.ok(near.position[2] + near.size[2] / 2 >= site.start[2]);
      assert.ok(far.position[2] - far.size[2] / 2 <= site.end[2]);
      assert.ok(
        Math.abs(far.position[1] + far.size[1] / 2 - site.end[1]) < 0.07,
      );
      for (let i = 1; i < boxes.length; i++)
        assert.ok(boxes[i].position[1] - boxes[i - 1].position[1] <= 0.32);
    }
});
test("each finite matter unit lands inside its matching collision surface", () => {
  for (const site of sites)
    for (const kind of site.candidates) {
      const boxes = structureBoxes(site, kind);
      for (let i = 0; i < MATTER_COUNT; i++) {
        const p = formationPose(site, kind, i);
        assert.ok(p.position.every(Number.isFinite));
        assert.ok(p.scale.every((n) => n > 0));
        assert.ok(
          boxes.some((b) =>
            p.position.every(
              (n, axis) =>
                Math.abs(n - b.position[axis]) <= b.size[axis] / 2 + 0.001,
            ),
          ),
          `${site.id}/${kind}/${i}`,
        );
      }
    }
});
test("moving platforms dwell at both shores and return without discontinuities", () => {
  for (const site of sites) {
    assert.ok(platformOffset(site, 0).every((n) => n === 0));
    assert.ok(platformOffset(site, 2.9).every((n) => n === 0));
    const far = platformOffset(site, 10);
    assert.equal(site.start[1] + far[1], site.end[1]);
    assert.ok(
      Math.abs(site.start[2] - 2.55 + far[2] - (site.end[2] + 2.55)) < 1e-8,
    );
    assert.ok(platformOffset(site, 18).every((n) => n === 0));
    for (let t = 0; t < 18; t += 1 / 60)
      assert.ok(
        Math.abs(
          platformOffset(site, t + 1 / 60)[2] - platformOffset(site, t)[2],
        ) < 0.18,
      );
  }
});

test("platform docks stay wholly outside both shore volumes", () => {
  for (const site of sites) {
    const b = structureBoxes(site, "platform")[0];
    assert.ok(b.position[2] + b.size[2] / 2 < site.start[2] - 0.1);
    const far = platformOffset(site, 10);
    assert.ok(b.position[2] + far[2] - b.size[2] / 2 > site.end[2] + 0.1);
  }
});
