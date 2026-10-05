import { availableCandidates } from "../../src/game/affordances";
import type { Observation } from "../../src/game/decisions";
import { describePhysical } from "../../src/game/semantic";
import { createWeave, weaveCandidates } from "../../src/game/weave";
import { sites } from "../../src/game/world";
import { decisionSchema } from "../../src/server/decision-request";

export function shoreContext() {
  const now: Observation = { time: 1, position: [0,.825,-23], velocity: [0,0,0], gaze: [0,0,-1], grounded: true, activeStructure: null };
  const scene = { time: 1, activeSite: null, phase: "idle" as const, weave: null };
  const event = describePhysical(now, scene);
  return decisionSchema.parse({
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generation: 0,
    observations: [{ ...now, time: .2, velocity: [0,0,-4] }, { ...now, time: .4 }, { ...now, time: .7 }, now],
    semantic: { player_now: event, recent_behavior_oldest_to_newest: [
      { ...event, motion: "walking forward" }, { ...event, motion: "jumped and landed back on the same support" }, event,
    ], matter_now: { state: "idle", player_supported_by_matter: false } },
    candidates: availableCandidates(now.position),
  });
}

export function edgeContext() {
  const weave = createWeave([[0,1,-25],[0,1,-31],[0,1,-37]], 0);
  const now: Observation = { time: 5, position: [1.9,1.885,-29], velocity: [0,0,0], gaze: [.4,.3,-.9], grounded: true, activeStructure: "reach" };
  const scene = { time: 5, activeSite: 0, phase: "active" as const, kind: "weave", weave };
  const event = describePhysical(now, scene);
  return decisionSchema.parse({
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generation: 0,
    observations: [{ ...now, time: 4.2 }, { ...now, time: 4.5 }, { ...now, time: 4.8 }, now],
    semantic: { player_now: event, recent_behavior_oldest_to_newest: [
      { ...event, motion: "walking right", view_height: "looking roughly level" }, event,
    ], matter_now: { state: "active", player_supported_by_matter: true } },
    candidates: weaveCandidates(weave, sites[0], now.position, 5)!.candidates,
  });
}
