"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";

const poster = "/images/living-matter-arrival-night.webp";

export default function GameplayPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    let visible = false;
    let failed = false;
    const sync = () => {
      if (motion.matches || connection?.saveData || failed) {
        video.pause();
        video.removeAttribute("src");
        video.removeAttribute("data-playing");
        video.load();
        return;
      }
      if (visible && !document.hidden) {
        if (!video.hasAttribute("src")) video.src = "/videos/living-matter-demo.mp4";
        void video.play().catch(() => { video.removeAttribute("data-playing"); });
      } else video.pause();
    };
    const playing = () => { video.setAttribute("data-playing", "true"); };
    const error = () => { failed = true; sync(); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(video);
    motion.addEventListener("change", sync);
    connection?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    video.addEventListener("playing", playing);
    video.addEventListener("error", error);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", sync);
      connection?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.removeEventListener("playing", playing);
      video.removeEventListener("error", error);
      video.pause();
    };
  }, []);

  return <Link className="gameplay-preview" href="/play" prefetch={false} aria-label="Play Living Matter">
    <Image src={poster} alt="Living matter weaving a rising turn among the flooded observatory’s terraces and ruins at night." width={1920} height={1080} priority unoptimized sizes="(max-width: 760px) 100vw, 1200px" />
    <video ref={videoRef} poster={poster} width={1280} height={720} muted autoPlay loop playsInline preload="none" aria-hidden="true" />
  </Link>;
}
