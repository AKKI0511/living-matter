export type Quality = "auto" | "low" | "high";
export type RenderQuality = Exclude<Quality, "auto">;

/** Presentation only. Neither preset enters physics or decision state. */
export const QUALITY = {
  low: { pixels: 1_350_000, minDpr: 1, maxDpr: 1, shadowSize: 0, waterDetail: 0.55 },
  high: { pixels: 2_600_000, minDpr: 1.25, maxDpr: 1.5, shadowSize: 2048, waterDetail: 1 },
} as const;

export function renderDpr(quality: RenderQuality, width: number, height: number, deviceDpr: number) {
  const preset = QUALITY[quality];
  // High also improves edge clarity on ordinary DPR-1 laptop displays.
  return Math.max(0.5, Math.min(Math.max(deviceDpr, preset.minDpr), preset.maxDpr, Math.sqrt(preset.pixels / Math.max(1, width * height))));
}

export function frameSummary(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 };
}
