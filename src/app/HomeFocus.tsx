"use client";
import { useEffect } from "react";

export default function HomeFocus() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("living-matter:return-focus")) {
        document.getElementById("play-link")?.focus();
        sessionStorage.removeItem("living-matter:return-focus");
      }
    } catch {}
  }, []);
  return null;
}
