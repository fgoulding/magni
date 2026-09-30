import { Check, Circle, Minus, Play } from "lucide-react";

/** Visible status shapes shared by the agenda, month and legend. Links supply the accessible label. */
export function CalendarStatus({ status }: { status: string }) {
  if (status === "completed") return <Check aria-hidden="true" size={16} className="shrink-0 text-success-ink" />;
  if (status === "skipped") return <Minus aria-hidden="true" size={14} className="shrink-0 text-muted" />;
  if (status === "in_progress") return <Play aria-hidden="true" size={14} className="shrink-0 text-brand-strong" />;
  return <Circle aria-hidden="true" size={8} className="shrink-0 text-muted" />;
}
