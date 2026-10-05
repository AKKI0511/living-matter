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

export type AssemblyContact = { above: boolean; landed: boolean };

/** Admit forming support after an airborne approach and actual downward contact. */
export function assemblySupportsPlayer(top: number, motion: {
  player: readonly number[]; velocity: readonly number[]; grounded: boolean;
}, contact?: AssemblyContact) {
  if (!contact) return true;
  const feet = motion.player[1] - 0.825, velocityY = motion.velocity[1];
  if (!motion.grounded && feet > top + 0.2) contact.above = true;
  if (contact.above && !motion.grounded && velocityY < 0 &&
    feet >= top - 0.1 && feet <= top + 0.12 - velocityY / 60) contact.landed = true;
  return contact.landed && feet >= top - 0.1;
}

/** Visual pieces pass around the capsule; physics belongs to the destination surface. */
export function assemblyDetour(x: number, y: number, z: number, player: readonly number[], progress: number, index: number) {
  const dx = x - player[0], dz = z - player[2], distance = Math.hypot(dx, dz);
  if (progress >= 0.98 || Math.abs(y - player[1]) > 1.1 || distance >= 0.9) return [x,y,z];
  const angle = distance > 0.01 ? Math.atan2(dz,dx) : index % 2 ? Math.PI / 2 : -Math.PI / 2;
  return [player[0] + Math.cos(angle) * 0.9, y, player[2] + Math.sin(angle) * 0.9];
}
