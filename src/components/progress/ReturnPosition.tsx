"use client";
import { useEffect } from "react";

/** Store the finder position before navigation so explicit Back links restore it too. */
export function ReturnPosition({ href }: { href: string }) {
  useEffect(() => {
    const key = `magni.progress.position:${href}`;
    let frame = 0;
    try { const saved = sessionStorage.getItem(key); if (saved !== null) frame = requestAnimationFrame(() => window.scrollTo({ top: Number(saved) || 0, behavior: "instant" })); } catch { /* Native browser restoration remains available. */ }
    const remember = () => { try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* Navigation still works without storage. */ } };
    document.addEventListener("click", remember, true);
    window.addEventListener("pagehide", remember);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("click", remember, true); window.removeEventListener("pagehide", remember); };
  }, [href]);
  return null;
}
