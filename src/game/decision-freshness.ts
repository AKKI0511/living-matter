import type { Candidate, Observation } from "./decisions";

/** Walking, slowing and stopping do not invalidate a decision about the same direction. */
export function decisionMotionCurrent(before: Observation | undefined, after: Observation | undefined) {
  if (!before || !after || !before.grounded || !after.grounded) return false;
  const dot = (a: number[], b: number[]) =>
    (a[0] * b[0] + a[2] * b[2]) / (Math.hypot(a[0], a[2]) * Math.hypot(b[0], b[2]) || 1);
  if (dot(before.gaze, after.gaze) < 0.7) return false;
  if (Math.hypot(after.velocity[0], after.velocity[2]) > 0.35) {
    const direction = Math.hypot(before.velocity[0], before.velocity[2]) > 0.35 ? before.velocity : before.gaze;
    if (dot(direction, after.velocity) < 0.5) return false;
  }
  return true;
}

/** The same ID approached from the other shore is a different physical action. */
export function samePhysicalCandidate(before: Candidate, after: Candidate) {
  return before.id === after.id && (before.crossSlope ?? 0) === (after.crossSlope ?? 0) && !!before.physical && !!after.physical &&
    before.physical.from.every((v, i) => v === after.physical!.from[i]) &&
    before.physical.to.every((v, i) => v === after.physical!.to[i]);
}
