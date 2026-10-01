import type { ReactNode } from "react";

function Drawing({ name, children }: { name: string; children: ReactNode }) {
  return <svg viewBox="0 0 120 112" role="img" aria-label={name} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function Person({ x = 60, y = 18, running = false }: { x?: number; y?: number; running?: boolean }) {
  return <g transform={`translate(${x} ${y})`}><circle cy="-8" r="5" /><path d={running ? "M0 0l-5 13 11 7 8 13M-5 13l-13 14-10-3M-1 4l13 7 8-5M-3 6l-13-2-4 8" : "M0 0v17m-12-9 12-6 12 6M0 17l-11 15m11-15 11 15"} /></g>;
}
function Key({ x, y, text, width = 22 }: { x: number; y: number; text: string; width?: number }) {
  return <g><rect x={x} y={y} width={width} height="22" rx="4" /><text x={x + width / 2} y={y + 15} fill="currentColor" stroke="none" textAnchor="middle" fontSize="12" fontFamily="Atkinson Hyperlegible Mono, monospace">{text}</text></g>;
}

/** Control-to-action pictures remain visible; prose is only an accessible name. */
export default function ControlGuide({ compact = false }: { compact?: boolean }) {
  return <section className={`control-guide${compact ? " compact" : ""}`} aria-label="How to play">
    <h2>How to play</h2>
    <div className="keyboard-guide">
      <Drawing name="Move with W A S D or arrow keys"><Person x={60} y={13} /><path d="M30 24H12l5-5m-5 5 5 5M90 24h18l-5-5m5 5-5 5" /><Key x={49} y={57} text="W" /><Key x={23} y={83} text="A" /><Key x={49} y={83} text="S" /><Key x={75} y={83} text="D" /></Drawing>
      <Drawing name="Look around with the mouse or drag"><path d="M18 25h22m-22 0 6-6m-6 6 6 6m78-6H80m22 0-6-6m6 6-6 6" /><circle cx="60" cy="23" r="12" /><path d="M55 23h10m-5-5v10" /><rect x="43" y="56" width="34" height="49" rx="17" /><path d="M60 56v20m-17 0h34" /><rect x="58" y="62" width="4" height="9" rx="2" /></Drawing>
      <Drawing name="Jump with Space"><path d="M18 46h21m42 0h21M36 41q24-48 48 0m0 0-1-10m1 10-10-2" /><Person x={60} y={20} /><Key x={24} y={83} text="Space" width={72} /></Drawing>
      <Drawing name="Run while holding Shift"><Person x={60} y={20} running /><path d="M22 17h14m-20 9h15m-8 9h10M84 21h22m0 0-6-6m6 6-6 6" /><Key x={26} y={83} text="Shift" width={68} /></Drawing>
      <Drawing name="Pause with Escape"><path strokeWidth="5" d="M49 12v28m22-28v28" /><Key x={33} y={83} text="Esc" width={54} /></Drawing>
    </div>
    <div className="finger-guide">
      <Drawing name="Left thumb moves; right thumb looks; tap the up-arrow button to jump"><rect x="10" y="18" width="100" height="76" rx="12" /><circle cx="34" cy="69" r="17" /><path d="M34 57v24m-12-12h24m-12-12-4 4m4-4 4 4M75 37h22m-22 0 5-5m-5 5 5 5m17-5-5-5m5 5-5 5" /><circle cx="89" cy="72" r="12" /><path d="M89 78V65m0 0-5 5m5-5 5 5" /><path d="M22 92l4-16q3-8 9-4l5 4m58 17-5-11q-3-7-8-3l-3 3" /></Drawing>
    </div>
  </section>;
}
