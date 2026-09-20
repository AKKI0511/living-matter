import { create } from "zustand";

export type Phase =
  "loading" | "ready" | "playing" | "paused" | "complete" | "error";
type GameState = {
  phase: Phase;
  run: number;
  muted: boolean;
  quality: "high" | "low";
  reducedMotion: boolean;
  setPhase: (phase: Phase) => void;
  restart: () => void;
  toggleMute: () => void;
  setQuality: (quality: "high" | "low") => void;
};
export const useGame = create<GameState>((set) => ({
  phase: "loading",
  run: 0,
  muted: false,
  quality: "high",
  reducedMotion: false,
  setPhase: (phase) => set({ phase }),
  restart: () => set((s) => ({ run: s.run + 1, phase: "playing" })),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setQuality: (quality) => set({ quality }),
}));
