import { Activity, ChevronRight, Dumbbell, Flame, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DotGrid, MiniBars, Sparkline, SplitBar, splitColorClass } from "@/components/Charts";
import { getUserTrainingStats } from "@/features/programs/training-stats";
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

export default async function StatsPage() {
  let user;

  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const stats = getUserTrainingStats(user.id);

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

          {/* Main lifts */}
          {stats.bigThree.length > 0 ? (
            <section className="card p-4">
              <div className="mb-1 flex items-center gap-2">
                <Dumbbell aria-hidden="true" size={15} className="text-brand-strong" />
                <h2 className="eyebrow text-[11px] text-brand-strong">Main lifts</h2>
              </div>
              <div className="flex flex-col divide-y divide-line">
                {stats.bigThree.map((lift) => (
                  <Link
                    key={lift.name}
                    href={`/history/${encodeURIComponent(lift.name)}`}
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
                        <Sparkline data={lift.trend} />
                      ) : (
                        <p className="text-right text-[10px] font-medium uppercase tracking-wide text-faint">
                          1 session
                        </p>
                      )}
                    </div>
                    <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-faint" />
                  </Link>
                ))}
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
    </div>
  );
}
