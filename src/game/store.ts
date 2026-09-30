import { create } from "zustand";
import type { Quality, RenderQuality } from "./quality";

export type Phase =
  "loading" | "ready" | "playing" | "paused" | "complete" | "error";
type GameState = {
  phase: Phase;
  run: number;
  muted: boolean;
  quality: Quality;
  renderQuality: RenderQuality;
  slow: boolean;
  providerUnavailable: boolean;
  reducedMotion: boolean;
  night: boolean;
  toggleNight: () => void;
  setPhase: (phase: Phase) => void;
  restart: () => void;
  toggleMute: () => void;
  setQuality: (quality: Quality) => void;
};
export const useGame = create<GameState>((set) => ({
  phase: "loading",
  run: 0,
  muted: false,
  quality: process.env.NEXT_PUBLIC_RENDER_QUALITY === "low" ? "low" : "auto",
  renderQuality: "low",
  slow: false,
  providerUnavailable: false,
  reducedMotion: false,
  night: false,
  toggleNight: () => set((s) => { save("night", !s.night); return { night: !s.night }; }),
  setPhase: (phase) => set({ phase }),
  restart: () => set((s) => ({ run: s.run + 1, phase: "playing" })),
  toggleMute: () => set((s) => { save("muted", !s.muted); return { muted: !s.muted }; }),
  setQuality: (quality) => { save("quality", quality); set({ quality, renderQuality: quality === "auto" ? "low" : quality, slow: false }); },
}));

function save(key: string, value: unknown) {
  try { localStorage.setItem(`living-matter:${key}`, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }
}

export function restorePreferences() {
  try {
    const read = (key: string) => JSON.parse(localStorage.getItem(`living-matter:${key}`) ?? "null");
    const quality = read("quality");
    if (["auto", "low", "high"].includes(quality)) useGame.getState().setQuality(quality);
    for (const key of ["night", "muted"] as const) {
      const value = read(key);
      if (typeof value === "boolean") useGame.setState({ [key]: value });
    }
  } catch { /* Defaults remain usable. */ }
}
