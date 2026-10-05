import type { Observation } from "./decisions";

export const VIEW_HEIGHT_THRESHOLD = 0.12;
// Looking at the walking surface should not be interpreted as asking to descend.
export const VIEW_DOWN_HEIGHT_THRESHOLD = 0.28;
export function heldView(observations: readonly Observation[]) {
  const latest = observations.at(-1);
  if (!latest) return false;
  const recent = observations.filter(o => latest.time >= o.time && latest.time - o.time <= 0.9);
  return recent.length >= 2 && latest.time - recent[0].time >= 0.6 && recent.every(o =>
    Math.abs(o.gaze[1] - latest.gaze[1]) < 0.12 &&
    (o.gaze[0] * latest.gaze[0] + o.gaze[2] * latest.gaze[2]) /
    ((Math.hypot(o.gaze[0], o.gaze[2]) || 1) * (Math.hypot(latest.gaze[0], latest.gaze[2]) || 1)) > 0.93);
}
/** A moderate sustained tilt, rather than a passing glance. */
export function deliberateHeightView(observations: readonly Observation[]) {
  const gaze = observations.at(-1)?.gaze[1] ?? 0;
  return heldView(observations) ? gaze >= 0.22 ? "higher" : gaze <= -VIEW_DOWN_HEIGHT_THRESHOLD ? "lower" : undefined : undefined;
}
