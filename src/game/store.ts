import { create } from "zustand";

export type Phase =
  "loading" | "ready" | "playing" | "paused" | "complete" | "error";
type GameState = {
  phase: Phase;
  run: number;
  muted: boolean;
  quality: "high" | "low";
  reducedMotion: boolean;
  night: boolean;
  toggleNight: () => void;
  setPhase: (phase: Phase) => void;
  restart: () => void;
  toggleMute: () => void;
  setQuality: (quality: "high" | "low") => void;
};
export const useGame = create<GameState>((set) => ({
  phase: "loading",
  run: 0,
  muted: false,
  quality: process.env.NEXT_PUBLIC_RENDER_QUALITY === "low" ? "low" : "high",
  reducedMotion: false,
  night: false,
  toggleNight: () => set((s) => ({ night: !s.night })),
  setPhase: (phase) => set({ phase }),
  restart: () => set((s) => ({ run: s.run + 1, phase: "playing" })),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setQuality: (quality) => set({ quality }),
}));
