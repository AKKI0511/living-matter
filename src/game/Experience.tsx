"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useGame, restorePreferences } from "./store";
import { clearInput, input } from "./input";
import { sound } from "./audio";
import ControlGuide from "@/app/ControlGuide";
import type { Quality } from "./quality";
import TouchControls from "./TouchControls";
import PreviewNotice from "./PreviewNotice";
import { useGameFullscreen } from "./use-game-fullscreen";

const Scene = dynamic(() => import("./Scene"), { ssr: false });
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { useGame.getState().setPhase("error"); }
  render() { return this.state.failed ? null : this.props.children; }
}
function capturePointer() {
  if (matchMedia("(pointer: fine)").matches) document.querySelector("canvas")?.requestPointerLock()?.catch(() => {});
}
function pause() { useGame.getState().setPhase("paused"); document.exitPointerLock?.(); }

export default function Experience() {
  const { phase, muted, quality, night, run, slow } = useGame();
  const root = useRef<HTMLElement>(null);
  const fullscreen = useGameFullscreen(root);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    restorePreferences(); clearInput(); input.yaw = 0; input.pitch = -0.03;
    useGame.setState({ phase: "loading", providerUnavailable: false, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, run: useGame.getState().run + 1 });
    setMounted(true);
    const keys = new Set<string>();
    const update = () => {
      input.forward = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown"));
      input.right = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      input.jump = keys.has("Space"); input.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("button, select, input, a, summary") && e.code !== "Escape") return;
      if (e.code === "KeyT" && !e.repeat) useGame.getState().toggleNight();
      if (e.code === "Escape" && useGame.getState().phase === "playing") { pause(); return; }
      if (useGame.getState().phase !== "playing") return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (e.code === "Space" && !e.repeat) input.jumpQueued = true;
      keys.add(e.code); update();
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.code); if (useGame.getState().phase === "playing") update(); };
    const mouse = (e: MouseEvent) => {
      if (useGame.getState().phase !== "playing" || (!document.pointerLockElement && !input.dragging)) return;
      input.yaw -= e.movementX * 0.0018; input.pitch = Math.max(-1.35, Math.min(1.35, input.pitch - e.movementY * 0.0018));
    };
    let hadLock = false;
    const changed = () => {
      const now = !!document.pointerLockElement;
      if (hadLock && !now && useGame.getState().phase === "playing") pause();
      hadLock = now;
    };
    const blur = () => { keys.clear(); clearInput(); if (useGame.getState().phase === "playing") pause(); };
    const visibility = () => { if (document.hidden) blur(); };
    const releaseDrag = () => { input.dragging = false; };
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("mousemove", mouse); addEventListener("blur", blur); addEventListener("pointerup", releaseDrag);
    document.addEventListener("pointerlockchange", changed); document.addEventListener("visibilitychange", visibility);
    const unsubscribe = useGame.subscribe(state => {
      if (state.phase !== "playing") { keys.clear(); clearInput(); }
      sound.pause(state.phase !== "playing");
    });
    return () => {
      useGame.getState().setPhase("loading"); clearInput(); document.exitPointerLock?.(); sound.stop();
      removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("mousemove", mouse); removeEventListener("blur", blur); removeEventListener("pointerup", releaseDrag);
      document.removeEventListener("pointerlockchange", changed); document.removeEventListener("visibilitychange", visibility); unsubscribe();
      try { sessionStorage.setItem("living-matter:return-focus", "1"); } catch {}
      requestAnimationFrame(() => document.getElementById("play-link")?.focus());
    };
  }, []);
  useEffect(() => { sound.mute(muted); }, [muted]);
  useEffect(() => {
    // Clear the previous action without selecting anything in the new menu.
    // A held jump/Enter cannot activate Resume or Play again; Tab still works.
    if (phase !== "playing" && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }, [phase, run]);
  const blurAction = () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); };
  const begin = () => { fullscreen.autoEnter(); void sound.start().catch(() => {}); useGame.getState().setPhase("playing"); blurAction(); capturePointer(); };
  const restart = () => { fullscreen.autoEnter(); clearInput(); input.yaw = 0; input.pitch = -0.03; sound.reset(); useGame.getState().restart(); blurAction(); capturePointer(); };
  const exit = () => { useGame.getState().setPhase("loading"); clearInput(); document.exitPointerLock?.(); fullscreen.exit(); sound.stop(); };
  return <main ref={root} id="main" className={`experience phase-${phase}`}>
    <div className="world" onPointerDown={e => { if (e.pointerType === "mouse" && phase === "playing") input.dragging = true; }} onPointerCancel={() => { input.dragging = false; }}>
      {mounted && <SceneBoundary><Scene /></SceneBoundary>}
    </div>
    {phase !== "playing" && <section className="overlay" aria-label={phase === "complete" ? "Journey complete" : "Living Matter"}>
      <div className="menu">
        <p className="menu-name">Living Matter</p>
        <h1 aria-live="polite">{phase === "loading" ? "Loading…" : phase === "paused" ? "Paused" : phase === "complete" ? "Journey complete" : phase === "error" ? "The world couldn’t open." : "Ready to explore"}</h1>
        {phase === "loading" ? <p role="status">Loading…</p> : phase === "error" ? <><p>Try a browser with WebGL 2 enabled.</p><button className="primary" onClick={() => location.reload()}>Try again</button></> : <>
          <button className="primary" onClick={phase === "complete" ? restart : begin}>{phase === "complete" ? "Play again" : phase === "paused" ? "Resume" : "Play"}</button>
          {phase === "paused" && <button onClick={restart}>Restart</button>}
          <div className="settings">
            <button aria-pressed={!muted} onClick={() => useGame.getState().toggleMute()}>Sound {muted ? "off" : "on"}</button>
            <label>Graphics <select aria-label="Graphics" value={quality} onChange={e => useGame.getState().setQuality(e.target.value as Quality)}><option value="auto">Auto</option><option value="low">Low</option><option value="high">High</option></select></label>
            <button aria-label={night ? "Switch to day" : "Switch to night"} aria-pressed={night} onClick={() => useGame.getState().toggleNight()}>{night ? "☾ Night" : "☀ Day"}</button>
          </div>
          {slow && quality === "high" && <p className="performance-note">High is running slowly. <button onClick={() => useGame.getState().setQuality("auto")}>Use Auto</button></p>}
          <ControlGuide compact />
          <p className="backend-note">{process.env.NEXT_PUBLIC_DECISION_BACKEND === "jev" ? "Live Jev intelligence" : "Preview"}</p>
          {fullscreen.supported && <button className="fullscreen-menu" onClick={() => fullscreen.active ? fullscreen.exit() : fullscreen.enter()}>{fullscreen.active ? "Exit fullscreen" : "Fullscreen"}</button>}
        </>}
        <Link href="/" onClick={exit}>Back to home</Link>
      </div>
    </section>}
    {phase === "playing" && <>
      <button className="pause" aria-label="Pause" onPointerDown={e => { if (e.pointerType !== "mouse") { e.preventDefault(); pause(); } }} onClick={pause}>Pause</button>
      {fullscreen.active && <button className="fullscreen-exit" onPointerDown={e => { if (e.pointerType !== "mouse") { e.preventDefault(); fullscreen.exit(); } }} onClick={fullscreen.exit}>Exit fullscreen</button>}
      <TouchControls />
    </>}
    <PreviewNotice />
    <noscript><p className="noscript">Playing needs JavaScript and WebGL 2. <a href="/">Back to home</a></p></noscript>
  </main>;
}
