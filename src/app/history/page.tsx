import { Activity, ChevronRight, Dumbbell, Flame, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DotGrid, MiniBars, Sparkline, SplitBar, splitColorClass } from "@/components/Charts";
import { LiftDetailContent } from "@/components/LiftDetailContent";
import { getUserLiftDetail, getUserTrainingStats } from "@/features/programs/training-stats";
import { requireUser } from "@/lib/auth";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return formatNumber(value);
}

const CATEGORY_LABELS: Record<string, string> = {
  main: "Main",
  aux: "Aux",
  accessory: "Accessory",
};

type StatsPageProps = { searchParams: Promise<{ lift?: string }> };

export default async function StatsPage({ searchParams }: StatsPageProps) {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const stats = getUserTrainingStats(user.id);
  const { lift } = await searchParams;
  const liftDetail = lift ? getUserLiftDetail(user.id, decodeURIComponent(lift)) : null;

  const tiles = [
    { label: "Workouts", value: formatNumber(stats.totals.sessions) },
    { label: "Volume lb", value: formatCompact(stats.totals.volume) },
    { label: "This week", value: formatNumber(stats.frequency.thisWeek) },
  ];

  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <header>
        <p className="eyebrow text-[11px] text-brand-strong">Performance</p>
        <h1 className="display text-4xl">Statistics</h1>
      </header>

      {!stats.hasData ? (
        <section className="card flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <TrendingUp aria-hidden="true" className="text-brand/40" size={34} />
          <h2 className="display mt-3 text-2xl">No stats yet</h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-muted">
            Finish a workout and your lifts, volume, and streaks show up here.
          </p>
        </section>
      ) : (
        <>
          {/* Totals */}
          <section className="grid grid-cols-3 gap-2.5">
            {tiles.map((tile) => (
              <div key={tile.label} className="card p-3 text-center">
                <p className="display text-2xl">{tile.value}</p>
                <p className="eyebrow mt-1 text-[10px] text-faint">{tile.label}</p>
              </div>
            ))}
          </section>

          {/* Strength snapshot — current estimated maxes */}
          {stats.bigThree.length > 0 ? (
            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <TrendingUp aria-hidden="true" size={15} className="text-brand-strong" />
                <h2 className="eyebrow text-[11px] text-brand-strong">Estimated maxes</h2>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {stats.bigThree.map((lift) => (
                  <div key={lift.name} className="rounded-xl bg-surface-muted px-2 py-3 text-center">
                    <p className="display text-2xl leading-none">{formatNumber(lift.bestE1rm)}</p>
                    <p className="eyebrow mt-1.5 truncate text-[10px] text-faint">{lift.name}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Main lifts — tap to open history, with progress at a glance */}
          {stats.bigThree.length > 0 ? (
            <section className="card p-4">
              <div className="mb-1 flex items-center gap-2">
                <Dumbbell aria-hidden="true" size={15} className="text-brand-strong" />
                <h2 className="eyebrow text-[11px] text-brand-strong">Main lifts</h2>
              </div>
              <div className="flex flex-col divide-y divide-line">
                {stats.bigThree.map((lift) => {
                  const delta = lift.trend.length > 1 ? Math.round(lift.trend.at(-1)! - lift.trend[0]) : null;
                  return (
                    <Link
                      key={lift.name}
                      href={`/history?lift=${encodeURIComponent(lift.name)}`}
                      className="-mx-1 flex items-center gap-3 rounded-lg px-1 py-3 transition-colors active:bg-surface-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="display truncate text-xl">{lift.name}</h3>
                        <p className="mt-0.5 text-xs text-muted">
                          <span className="font-display text-sm tracking-tight text-foreground">{formatNumber(lift.maxWeight)} lb</span>{" "}
                          top set · e1RM{" "}
                          <span className="font-semibold text-brand-strong">{formatNumber(lift.bestE1rm)}</span>
                        </p>
                      </div>
                      <div className="w-20 shrink-0">
                        {lift.trend.length > 1 ? (
                          <>
                            <Sparkline data={lift.trend} />
                            {delta !== null ? (
                              <p
                                className={`mt-0.5 text-right text-[11px] font-semibold ${
                                  delta > 0 ? "text-success-ink" : delta < 0 ? "text-danger-ink" : "text-faint"
                                }`}
                              >
                                {delta > 0 ? "+" : ""}
                                {formatNumber(delta)} lb
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-right text-[10px] font-medium uppercase tracking-wide text-faint">1 session</p>
                        )}
                      </div>
                      <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-faint" />
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Weekly volume */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity aria-hidden="true" size={15} className="text-brand-strong" />
                <h2 className="eyebrow text-[11px] text-brand-strong">Weekly volume</h2>
              </div>
              <span className="text-[11px] font-medium text-faint">last 10 weeks</span>
            </div>
            <MiniBars data={stats.weeklyVolume.map((w) => ({ value: w.value }))} />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-faint">
              <span>{formatCompact(stats.weeklyVolume[0]?.value ?? 0)} lb</span>
              <span className="text-brand-strong">
                this week {formatCompact(stats.weeklyVolume.at(-1)?.value ?? 0)} lb
              </span>
            </div>
          </section>

          {/* Consistency */}
          <section className="card p-4">
            <h2 className="eyebrow mb-3 text-[11px] text-brand-strong">Consistency</h2>
            <div className="flex items-stretch gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-muted px-3 py-2.5">
                <Flame aria-hidden="true" size={18} className="shrink-0 text-brand" />
                <div>
                  <p className="font-display text-xl leading-none">{stats.frequency.streakWeeks}</p>
                  <p className="eyebrow mt-1 text-[9px] text-faint">wk streak</p>
                </div>
              </div>
              <div className="flex flex-1 items-center rounded-xl bg-surface-muted px-3 py-2.5">
                <div>
                  <p className="font-display text-xl leading-none">{stats.frequency.avgPerWeek}</p>
                  <p className="eyebrow mt-1 text-[9px] text-faint">per week</p>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <DotGrid weeks={stats.frequency.weeks} />
              <span className="text-[11px] font-medium text-faint">last 8 weeks</span>
            </div>
          </section>

          {/* Volume by category */}
          {stats.categorySplit.length > 0 ? (
            <section className="card p-4">
              <h2 className="eyebrow mb-3 text-[11px] text-brand-strong">Volume by lift type</h2>
              <SplitBar data={stats.categorySplit} />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {stats.categorySplit.map((slice) => (
                  <span key={slice.category} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <span className={`h-2.5 w-2.5 rounded-full ${splitColorClass(slice.category)}`} aria-hidden="true" />
                    {CATEGORY_LABELS[slice.category] ?? slice.category}
                    <span className="font-display tracking-tight text-foreground">{slice.pct}%</span>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {/* Lift-history modal (URL-param, same pattern as the calendar) */}
      {liftDetail ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:items-center sm:py-3">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lift-modal-title"
            className="max-h-full w-full max-w-xl overflow-y-auto rounded-xl bg-surface shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="eyebrow text-[11px] text-brand-strong">Lift history</p>
                <h2 id="lift-modal-title" className="display mt-1 truncate text-2xl">{liftDetail.name}</h2>
              </div>
              <Link
                href="/history"
                aria-label="Close lift history"
                className="touch-target inline-flex shrink-0 items-center justify-center rounded-xl border border-line px-3 text-sm font-medium text-muted transition-colors active:bg-surface-muted"
              >
                Close
              </Link>
            </div>
            <div className="p-4">
              <LiftDetailContent detail={liftDetail} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
