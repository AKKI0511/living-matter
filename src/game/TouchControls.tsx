"use client";
import { useEffect, useRef, type PointerEvent } from "react";
import { input } from "./input";
import { stickMovement } from "./touch-input";

export default function TouchControls() {
  const stick = useRef<HTMLDivElement>(null), thumb = useRef<HTMLSpanElement>(null);
  const move = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const jump = useRef<number | null>(null);
  const cancelJump = (e: PointerEvent<HTMLButtonElement>) => {
    if (jump.current !== e.pointerId) return;
    jump.current = null;
    input.jump = input.jumpQueued = false;
  };
  const clearMove = () => {
    move.current = null;
    input.forward = input.right = 0; input.sprint = false;
    if (thumb.current) thumb.current.style.transform = "translate(0px, 0px)";
    stick.current?.removeAttribute("data-sprinting");
  };
  const release = () => { clearMove(); look.current = null; jump.current = null; input.jump = input.jumpQueued = false; };
  useEffect(() => {
    addEventListener("resize", release);
    screen.orientation?.addEventListener("change", release);
    return () => { release(); removeEventListener("resize", release); screen.orientation?.removeEventListener("change", release); };
  }, []);
  const updateMove = (e: PointerEvent<HTMLDivElement>) => {
    if (move.current?.id !== e.pointerId) return;
    const value = stickMovement(e.clientX - move.current.x, e.clientY - move.current.y, input.sprint);
    input.right = value.right; input.forward = value.forward; input.sprint = value.sprint;
    if (thumb.current) thumb.current.style.transform = `translate(${value.x}px, ${value.y}px)`;
    if (stick.current) stick.current.dataset.sprinting = String(value.sprint);
  };
  return <div className="touch-controls">
    <div ref={stick} className="touch-move" aria-label="Movement joystick" onPointerDown={e => {
      if (move.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const bounds = e.currentTarget.getBoundingClientRect();
      move.current = { id: e.pointerId, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      updateMove(e);
    }} onPointerMove={updateMove} onPointerUp={e => { if (move.current?.id === e.pointerId) clearMove(); }} onPointerCancel={e => { if (move.current?.id === e.pointerId) clearMove(); }} onLostPointerCapture={e => { if (move.current?.id === e.pointerId) clearMove(); }}><span ref={thumb} /></div>
    <div className="touch-look" aria-label="Look around" onPointerDown={e => {
      if (look.current) return;
      e.currentTarget.setPointerCapture(e.pointerId); look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }} onPointerMove={e => {
      if (look.current?.id !== e.pointerId) return;
      input.yaw -= (e.clientX - look.current.x) * 0.004;
      input.pitch = Math.max(-1.3, Math.min(1.3, input.pitch - (e.clientY - look.current.y) * 0.004));
      look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }} onPointerUp={e => { if (look.current?.id === e.pointerId) look.current = null; }} onPointerCancel={e => { if (look.current?.id === e.pointerId) look.current = null; }} onLostPointerCapture={e => { if (look.current?.id === e.pointerId) look.current = null; }} />
    <button className="touch-jump" aria-label="Jump" onPointerDown={e => {
      if (jump.current !== null) return;
      e.currentTarget.setPointerCapture(e.pointerId); jump.current = e.pointerId; input.jump = input.jumpQueued = true;
    }} onPointerUp={e => { if (jump.current === e.pointerId) { jump.current = null; input.jump = false; } }} onPointerCancel={cancelJump} onLostPointerCapture={cancelJump}>↑</button>
  </div>;
}
