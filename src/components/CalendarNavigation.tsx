"use client";
import { useEffect } from "react";
import { rememberCalendarScroll } from "@/features/calendar/navigation";

export function CalendarNavigation({ returnTo }: { returnTo: string }) {
  useEffect(() => {
    const key = `magni.calendar.scroll:${returnTo}`;
    let frame: number | undefined;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null && window.location.pathname + window.location.search === returnTo) {
        const top = Number(saved);
        if (Number.isFinite(top) && top >= 0) frame = requestAnimationFrame(() => {
          window.scrollTo({ top, left: 0, behavior: "instant" });
          try { sessionStorage.removeItem(key); } catch { /* Position memory is optional. */ }
        });
      }
    } catch { /* Position memory is optional when device storage is unavailable. */ }
    const remember = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || new URL(link.href).searchParams.get("returnTo") !== returnTo) return;
      rememberCalendarScroll(returnTo);
    };
    document.addEventListener("click", remember, true);
    return () => { document.removeEventListener("click", remember, true); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [returnTo]);
  return null;
}
