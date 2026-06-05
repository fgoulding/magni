"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * Collapsible training-day section for the program editor. Collapsed shows a
 * one-line summary (name · Day N · N lifts) so the whole program is scannable;
 * expanding reveals the exercise list + add form. Day actions (reorder/delete)
 * stay in the header, outside the toggle, so they don't fight the collapse.
 */
export function DaySection({
  name,
  dayNumber,
  liftCount,
  headerActions,
  defaultOpen = false,
  children,
}: {
  name: string;
  dayNumber: number;
  liftCount: number;
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="touch-target -ml-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left transition-colors active:bg-surface-muted"
        >
          <ChevronDown
            aria-hidden="true"
            size={18}
            className={`shrink-0 text-faint transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium leading-tight">{name}</span>
            <span className="block text-xs text-faint">
              Day {dayNumber} · {liftCount} lift{liftCount === 1 ? "" : "s"}
            </span>
          </span>
        </button>
        {headerActions ? <div className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
      </div>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}
