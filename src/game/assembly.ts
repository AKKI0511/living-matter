import { smooth } from "./world";

/** Every piece finishes at the support deadline rather than waiting at a cap. */
export function assemblyProgress(elapsed: number, duration: number, index: number, supportReady: boolean) {
  const delay = (index % 32) / 32 * Math.min(0.35, duration * 0.15);
  const time = supportReady ? elapsed : Math.min(elapsed, duration - 1 / 60);
  return smooth((time - delay) / (duration - delay));
}

export function angleBlend(from: number, to: number, progress: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * progress;
}

/** The selected surface catches a landing; assembly cannot lift a player from below. */
export function assemblySupportsPlayer(top: number, playerY: number, forming: boolean) {
  return !forming || playerY - 0.825 >= top - 0.1;
}

/** Visual pieces pass around the capsule; physics belongs to the destination surface. */
export function assemblyDetour(x: number, y: number, z: number, player: readonly number[], progress: number, index: number) {
  const dx = x - player[0], dz = z - player[2], distance = Math.hypot(dx, dz);
  if (progress >= 0.98 || Math.abs(y - player[1]) > 1.1 || distance >= 0.9) return [x,y,z];
  const angle = distance > 0.01 ? Math.atan2(dz,dx) : index % 2 ? Math.PI / 2 : -Math.PI / 2;
  return [player[0] + Math.cos(angle) * 0.9, y, player[2] + Math.sin(angle) * 0.9];
}
