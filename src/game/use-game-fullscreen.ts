"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useGame } from "./store";

export function useGameFullscreen(element: RefObject<HTMLElement | null>) {
  const attempted = useRef(false);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled && !!element.current?.requestFullscreen);
    const changed = () => {
      const fullscreen = document.fullscreenElement === element.current;
      setActive(fullscreen);
      if (!fullscreen && useGame.getState().phase === "playing") useGame.getState().setPhase("paused");
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [element]);
  const enter = () => {
    if (document.fullscreenElement || !document.fullscreenEnabled || !element.current?.requestFullscreen) return;
    void element.current.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  };
  const autoEnter = () => {
    if (attempted.current || !matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) > 600) return;
    attempted.current = true; enter();
  };
  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };
  return { active, supported, autoEnter, enter, exit };
}
