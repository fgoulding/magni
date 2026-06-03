"use client";

import { CalendarDays, Dumbbell, LineChart, Settings, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/today", label: "Today", Icon: Trophy },
  { href: "/programs", label: "Programs", Icon: Dumbbell },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/history", label: "Stats", Icon: LineChart },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/90 backdrop-blur-lg">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href === "/programs" && pathname.startsWith("/programs")) ||
            (tab.href === "/history" && pathname.startsWith("/history"));
          const Icon = tab.Icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`touch-target relative flex flex-col items-center justify-center gap-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors duration-200 ${
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
