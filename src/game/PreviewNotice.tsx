"use client";
import { useEffect, useState } from "react";
import { useGame } from "./store";

export default function PreviewNotice() {
  const unavailable = useGame(s => s.providerUnavailable);
  const playing = useGame(s => s.phase === "playing");
  const [hidden, setHidden] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const hide = (e: KeyboardEvent) => {
      if (e.code === "KeyH" && playing && unavailable) setDismissed(true);
    };
    addEventListener("keydown", hide);
    return () => removeEventListener("keydown", hide);
  }, [playing, unavailable]);
  useEffect(() => {
    if (!unavailable) { setHidden(false); return; }
    if (!playing || hidden || dismissed) return;
    const timer = setTimeout(() => setHidden(true), 8000);
    return () => clearTimeout(timer);
  }, [unavailable, playing, hidden, dismissed]);
  if (!playing || !unavailable || hidden || dismissed) return null;
  return <aside className="preview-notice" aria-label="Preview mode">
    <span role="status">Live unavailable · Playing in preview</span>
    <button aria-label="Dismiss preview notice" aria-keyshortcuts="H" onPointerDown={e => { if (e.pointerType !== "mouse") { e.preventDefault(); setDismissed(true); e.currentTarget.blur(); } }} onClick={e => { setDismissed(true); e.currentTarget.blur(); }}><span className="desktop">Hide · H</span><span className="touch-copy">×</span></button>
  </aside>;
}
