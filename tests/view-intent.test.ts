import { test } from "node:test";
import assert from "node:assert/strict";
import { deliberateHeightView } from "../src/game/view-intent";
import { describePhysical } from "../src/game/semantic";
import { buildDecisionRequest } from "../src/server/decision-request";
import { shoreContext } from "./helpers/jev-context";

test("held height intent accepts moderate up and deeper down, but ignores slight or transient looks", () => {
  const context = shoreContext();
  const scene = { time: 1, activeSite: null, phase: "idle" as const, weave: null };
  for (const [gazeY, intent] of [[.1, undefined], [.24, "higher"], [-.15, undefined], [-.24, undefined], [-.31, "lower"]] as const) {
    const observations = context.observations.map(o => ({ ...o, gaze: [0, gazeY, -Math.sqrt(1 - gazeY ** 2)] as [number, number, number] }));
    const event = describePhysical(observations.at(-1)!, scene);
    assert.equal(deliberateHeightView(observations), intent);
    assert.equal(event.view_height, intent === "higher" ? "looking upward" : intent === "lower" ? "looking downward" : "looking roughly level");
    assert.equal(!!buildDecisionRequest({ ...context, observations, semantic: { ...context.semantic, player_now: event } }).questions.height_intent, !!intent);
    assert.equal(deliberateHeightView([...context.observations.slice(0, -1), observations.at(-1)!]), undefined);
  }
});
