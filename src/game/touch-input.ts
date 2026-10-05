export const STICK_RADIUS = 36;

/** A circular stick with a dead zone and separate enter/exit sprint thresholds. */
export function stickMovement(dx: number, dy: number, sprinting = false) {
  const distance = Math.hypot(dx, dy);
  const amount = Math.min(1, distance / STICK_RADIUS);
  const strength = Math.max(0, (amount - 0.1) / 0.9);
  const scale = distance ? Math.min(distance, STICK_RADIUS) / distance : 0;
  return {
    x: dx * scale,
    y: dy * scale,
    right: distance ? dx / distance * strength : 0,
    forward: distance ? -dy / distance * strength : 0,
    sprint: amount >= (sprinting ? 0.72 : 0.9),
  };
}
