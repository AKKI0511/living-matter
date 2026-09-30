"use client";
import { useEffect, useState } from "react";

export default function Theme() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    try { const value = localStorage.getItem("living-matter:theme") === "light"; setLight(value); document.documentElement.dataset.theme = value ? "light" : "dark"; } catch {}
    try { const link=document.getElementById("play-link"); if(link && sessionStorage.getItem("living-matter:return-focus")) { link.focus(); sessionStorage.removeItem("living-matter:return-focus"); } } catch {}
  }, []);
  return <button className="theme-toggle" aria-label={light ? "Switch to dark mode" : "Switch to light mode"} onClick={() => {
    const next = !light; setLight(next); document.documentElement.dataset.theme = next ? "light" : "dark";
    try { localStorage.setItem("living-matter:theme", next ? "light" : "dark"); } catch {}
  }}>{light ? "Dark" : "Light"}</button>;
}
