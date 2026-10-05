import { test } from "node:test";
import assert from "node:assert/strict";
import { stickMovement, STICK_RADIUS } from "../src/game/touch-input";

test("stick has analog walking, a circular clamp, a dead zone and automatic sprint", () => {
  assert.equal(stickMovement(1, -1).forward, 0);
  const walking = stickMovement(0, -STICK_RADIUS / 2);
  assert.ok(walking.forward > 0 && walking.forward < 1);
  assert.equal(walking.sprint, false);
  const running = stickMovement(80, -80);
  assert.equal(running.sprint, true);
  assert.ok(Math.abs(Math.hypot(running.right, running.forward) - 1) < 1e-10);
  assert.ok(Math.abs(Math.hypot(running.x, running.y) - STICK_RADIUS) < 1e-10);
  assert.equal(stickMovement(0, -STICK_RADIUS * .8, true).sprint, true);
  assert.equal(stickMovement(0, -STICK_RADIUS * .8, false).sprint, false);
  assert.equal(stickMovement(0, -STICK_RADIUS * .6, true).sprint, false);
});
