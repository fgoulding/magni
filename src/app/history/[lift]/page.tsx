import { ChevronLeft, Trophy } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkline } from "@/components/Charts";
import { getUserLiftDetail } from "@/features/programs/training-stats";
import { requireUser } from "@/lib/auth";

type PageProps = { params: Promise<{ lift: string }> };

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return formatNumber(value);
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return DATE_FORMATTER.format(new Date(y, m - 1, d));
}

export default async function LiftDetailPage({ params }: PageProps) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const { lift } = await params;
  const name = decodeURIComponent(lift);
  const detail = getUserLiftDetail(user.id, name);

  const tiles = [
    { label: "Max weight", value: `${formatNumber(detail.maxWeight)}`, unit: "lb" },
    { label: "Best e1RM", value: `${formatNumber(detail.bestE1rm)}`, unit: "lb" },
    { label: "Sessions", value: `${formatNumber(detail.sessionCount)}`, unit: "" },
  ];

  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-[11px] text-brand-strong">Main lift</p>
          <h1 className="display truncate text-4xl">{detail.name}</h1>
        </div>
        <Link
          href="/history"
          aria-label="Back to stats"
          className="touch-target inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
        >
          <ChevronLeft aria-hidden="true" size={16} />
          Stats
        </Link>
      </header>

      {!detail.hasData ? (
        <section className="card flex min-h-60 flex-col items-center justify-center px-6 text-center">
          <h2 className="display text-2xl">No data yet</h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-muted">
            Log {detail.name} in a workout to start tracking it here.
          </p>
        </section>
      ) : (
        <>
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

          {/* Estimated 1RM trend */}
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

          {/* PR timeline */}
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

          {/* Session history */}
          <section className="card p-4">
            <h2 className="eyebrow mb-3 text-[11px] text-brand-strong">Session history</h2>
            <ul className="flex flex-col divide-y divide-line">
              {detail.sessions.slice(0, 16).map((session) => (
                <li key={session.date} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-xs font-medium text-faint">{formatDate(session.date)}</span>
                  <span className="font-display text-base tracking-tight">
                    {formatNumber(session.topWeight)} lb
                  </span>
                  <span className="text-xs text-muted">
                    {session.sets} set{session.sets === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto text-xs text-faint">{formatCompact(session.volume)} lb vol</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
