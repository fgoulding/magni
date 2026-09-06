"use client";

import { CalendarDays, Dumbbell, LineChart, Settings, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type PointerEvent } from "react";

const tabs = [
  { href: "/today", label: "Today", Icon: Trophy },
  { href: "/programs", label: "Programs", Icon: Dumbbell },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/history", label: "Stats", Icon: LineChart },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const press = useRef<{ target: HTMLAnchorElement; id: number; x: number; y: number; cancelled: boolean; released: boolean } | null>(null);

  function trackPress(event: PointerEvent<HTMLAnchorElement>, released = false) {
    const current = press.current;
    if (!current || current.id !== event.pointerId || current.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    current.cancelled ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > 12
      || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    current.released ||= released;
  }

  return (
    <nav aria-label="Main navigation" className="app-nav fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href === "/programs" && pathname.startsWith("/programs")) ||
            (tab.href === "/history" && pathname.startsWith("/history"));
          const Icon = tab.Icon;

          return (
            <Link prefetch={false}
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              onPointerDown={event => {
                if (!event.isPrimary) { if (press.current) press.current.cancelled = true; return; }
                press.current = null;
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                // A completion recap can clamp page scroll during this press.
                // Keep its release on the fixed tab; navigation still uses Link.
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  press.current = { target: event.currentTarget, id: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false, released: false };
                } catch { /* Older clients retain ordinary anchor behavior. */ }
              }}
              onPointerMove={event => trackPress(event)}
              onPointerUp={event => trackPress(event, true)}
              onPointerCancel={event => { if (press.current?.target === event.currentTarget && press.current.id === event.pointerId) press.current.cancelled = true; }}
              onLostPointerCapture={event => { if (press.current?.target === event.currentTarget && press.current.id === event.pointerId && !press.current.released) press.current.cancelled = true; }}
              onDragStart={event => { if (press.current?.target === event.currentTarget) press.current.cancelled = true; }}
              onClick={event => {
                const current = press.current;
                press.current = null;
                if (event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                if (current?.target === event.currentTarget && (current.cancelled || !current.released)) event.preventDefault();
              }}
              className={`touch-target relative flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors duration-200 ${
                active ? "text-brand-strong" : "text-faint"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-opacity duration-200 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <Icon aria-hidden="true" size={20} strokeWidth={active ? 2.5 : 2} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
