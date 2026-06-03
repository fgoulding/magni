"use client";

import { useEffect } from "react";

/** Measure the real safe-area insets (env() forces a layout, so this returns the
 *  settled values even when iOS reports env() lazily on first paint). */
function readInsets(): { top: number; bottom: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";
  document.body.appendChild(probe);
  const styles = getComputedStyle(probe);
  const top = Number.parseFloat(styles.paddingTop) || 0;
  const bottom = Number.parseFloat(styles.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

/**
 * iOS (especially installed PWAs) computes `dvh`/`vh` and `env(safe-area-inset-*)`
 * lazily on first paint, so the page loads at the wrong height and content
 * "shifts" on later navigations as the values re-evaluate. This freezes the real
 * window height and safe-area insets into CSS variables once (and on rotation),
 * so the layout is stable from first paint onward. CSS fallbacks cover SSR.
 */
export function AppHeight() {
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      root.style.setProperty("--app-height", `${window.innerHeight}px`);
      const { top, bottom } = readInsets();
      root.style.setProperty("--safe-top", `${top}px`);
      root.style.setProperty("--safe-bottom", `${bottom}px`);
    };
    // rAF lets the browser settle env()/dvh before we read them.
    const frame = requestAnimationFrame(apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return null;
}
