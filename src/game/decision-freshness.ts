import type { Candidate, Observation } from "./decisions";

export type DecisionMotionEvidence = { before?: Observation; after?: Observation };

/** Walking, slowing and stopping do not invalidate a decision about the same direction. */
export function decisionMotionCurrent(before: Observation | undefined, after: Observation | undefined, candidate?: Candidate) {
  if (!before || !after || !before.grounded || !after.grounded) return false;
  const dot = (a: number[], b: number[]) =>
    (a[0] * b[0] + a[2] * b[2]) / (Math.hypot(a[0], a[2]) * Math.hypot(b[0], b[2]) || 1);
  const moving = Math.hypot(after.velocity[0], after.velocity[2]) > 0.35;
  const wasMoving = Math.hypot(before.velocity[0], before.velocity[2]) > 0.35;
  // While travelling, movement expresses direction. Looking around alone
  // must not cancel a reply about unchanged travel.
  let changed = moving && wasMoving ? dot(before.velocity, after.velocity) < 0.5 : dot(before.gaze, after.gaze) < 0.7;
  if (moving) {
    const direction = wasMoving ? before.velocity : before.gaze;
    changed ||= dot(direction, after.velocity) < 0.5;
  }
  if (!changed) return true;
  // Starting to strafe or turning toward the selected exit can confirm the
  // answer. Reject a changed intent only when it heads away from that route;
  // the caller separately revalidates support, geometry, bounds and clearance.
  const target = candidate?.route?.[1] ?? candidate?.physical?.to;
  if (!target) return false;
  return dot(moving ? after.velocity : after.gaze,
    [target[0]-after.position[0],0,target[2]-after.position[2]]) >= -0.25;
}

/** The same ID approached from the other shore is a different physical action. */
export function samePhysicalCandidate(before: Candidate, after: Candidate) {
  return before.id === after.id && (before.crossSlope ?? 0) === (after.crossSlope ?? 0) && !!before.physical && !!after.physical &&
    before.physical.from.every((v, i) => v === after.physical!.from[i]) &&
    before.physical.to.every((v, i) => v === after.physical!.to[i]);
}
