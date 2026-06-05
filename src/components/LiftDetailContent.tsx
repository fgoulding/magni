import { Trophy } from "lucide-react";
import { Sparkline } from "@/components/Charts";
import type { LiftDetail } from "@/features/programs/training-stats";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1000)
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return formatNumber(value);
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return DATE_FORMATTER.format(new Date(y, m - 1, d));
}

/** The body of a lift's history — shared by the detail page and the Stats modal. */
export function LiftDetailContent({ detail }: { detail: LiftDetail }) {
  if (!detail.hasData) {
    return (
      <section className="card flex min-h-48 flex-col items-center justify-center px-6 text-center">
        <h2 className="display text-2xl">No data yet</h2>
        <p className="mt-2 max-w-xs text-sm leading-6 text-muted">
          Log {detail.name} in a workout to start tracking it here.
        </p>
      </section>
    );
  }

  const tiles = [
    { label: "Max weight", value: formatNumber(detail.maxWeight), unit: "lb" },
    { label: "Best e1RM", value: formatNumber(detail.bestE1rm), unit: "lb" },
    { label: "Sessions", value: formatNumber(detail.sessionCount), unit: "" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-3 gap-2.5">
        {tiles.map((tile) => (
          <div key={tile.label} className="card p-3 text-center">
            <p className="display text-2xl">
              {tile.value}
              {tile.unit ? <span className="ml-0.5 text-sm font-semibold text-faint">{tile.unit}</span> : null}
            </p>
            <p className="eyebrow mt-1 text-[10px] text-faint">{tile.label}</p>
          </div>
        ))}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow text-[11px] text-brand-strong">Estimated 1RM</h2>
          <span className="text-[11px] font-medium text-faint">{detail.sessionCount} sessions</span>
        </div>
        {detail.trend.length > 1 ? (
          <>
            <Sparkline data={detail.trend} className="h-40 text-brand" />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-faint">
              <span>{formatNumber(Math.min(...detail.trend))} lb</span>
              <span className="text-brand-strong">now {formatNumber(detail.trend.at(-1) ?? 0)} lb</span>
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted">
            One session logged so far — the trend appears after your next one.
          </p>
        )}
      </section>

      {detail.prTimeline.length > 0 ? (
        <section className="card p-4">
          <h2 className="eyebrow mb-3 text-[11px] text-brand-strong">Personal records</h2>
          <ol className="flex flex-col divide-y divide-line">
            {detail.prTimeline.map((pr, index) => (
              <li key={pr.date} className="flex items-center gap-3 py-2.5">
                <Trophy
                  aria-hidden="true"
                  size={16}
                  className={index === 0 ? "shrink-0 text-brand" : "shrink-0 text-faint"}
                />
                <span className="font-display text-base tracking-tight">
                  {formatNumber(pr.weight)} × {pr.reps}
                </span>
                <span className="ml-auto text-sm text-muted">
                  e1RM <span className="font-semibold text-brand-strong">{formatNumber(pr.e1rm)}</span>
                </span>
                <span className="w-12 shrink-0 text-right text-xs text-faint">{formatDate(pr.date)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="card p-4">
        <h2 className="eyebrow mb-3 text-[11px] text-brand-strong">Session history</h2>
        <ul className="flex flex-col divide-y divide-line">
          {detail.sessions.slice(0, 16).map((session) => (
            <li key={session.date} className="flex items-center gap-3 py-2.5">
              <span className="w-12 shrink-0 text-xs font-medium text-faint">{formatDate(session.date)}</span>
              <span className="font-display text-base tracking-tight">{formatNumber(session.topWeight)} lb</span>
              <span className="text-xs text-muted">
                {session.sets} set{session.sets === 1 ? "" : "s"}
              </span>
              <span className="ml-auto text-xs text-faint">{formatCompact(session.volume)} lb vol</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
