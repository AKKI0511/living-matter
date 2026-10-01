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
