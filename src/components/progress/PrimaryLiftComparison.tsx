"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useTransition, type MouseEvent } from "react";
import type { ExerciseChartPoint, ExerciseDetail, ProgressHome, ProgressPrimaryExercise } from "@/features/progress/types";
import { ProgressDate, progressButton, progressInput } from "./ProgressChrome";
import { progressUrl, workoutEvidenceHref, type ProgressMetric } from "./navigation";
import { chartScale, formatMetricValue } from "./chart-insights";
import { chartDatePosition } from "./ExerciseProgressChart";
import { ProgressViewNav } from "./ProgressViewNav";
import { RecordedActivitySummary } from "./RecordedActivitySummary";

type Period = "all" | "4w" | "12w";
type Lift = { primary: ProgressPrimaryExercise; detail: ExerciseDetail | null };
const styles = {
  "p:squat": { color: "text-brand-strong", dash: undefined, shape: "circle" },
  "p:bench": { color: "text-foreground", dash: "6 4", shape: "square" },
  "p:deadlift": { color: "text-success-ink", dash: "2 5", shape: "triangle" },
} as const;
const axisFormat = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const dateText = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
function valueFor(point: ExerciseChartPoint, metric: ProgressMetric) {
  if (metric === "reps") return point.totalReps;
  if (point.unit !== metric.split(":")[1]) return null;
  return metric.startsWith("estimate:") ? point.bestE1rm !== null && point.bestE1rm > 0 ? point.bestE1rm : null : point.topWeight ?? null;
}
function Point({ shape, x, y, ...data }: { shape: "circle" | "square" | "triangle"; x: number; y: number; "data-chart-point"?: string; "data-x"?: number; "data-record"?: string }) {
  return shape === "square" ? <rect {...data} x={x - 3.5} y={y - 3.5} width="7" height="7" fill="currentColor" /> : shape === "triangle" ? <polygon {...data} points={`${x},${y - 4.5} ${x - 4.5},${y + 3.5} ${x + 4.5},${y + 3.5}`} fill="currentColor" /> : <circle {...data} cx={x} cy={y} r="3.5" fill="currentColor" />;
}

/** Three owned primary histories share a scale, never identity or converted load values. */
export function PrimaryLiftComparison({ lifts, activity, period, selectedKey, initialMetric, currentHref: initialHref }: { lifts: Lift[]; activity?: ProgressHome["activity"]; period: Period; selectedKey: string; initialMetric?: ProgressMetric; currentHref: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [metricState, setMetricState] = useState({ href: initialHref, metric: initialMetric });
  if (metricState.href !== initialHref) setMetricState({ href: initialHref, metric: initialMetric });
  const available = [...new Set(lifts.flatMap(({ detail }) => [
    ...detail?.chart.points.flatMap(point => [point.bestE1rm !== null && point.bestE1rm > 0 ? `estimate:${point.unit}` : null, point.topWeight !== null && point.topWeight !== undefined ? `load:${point.unit}` : null].filter((metric): metric is ProgressMetric => metric !== null)) ?? [],
    ...detail?.metricSummaries?.map(summary => summary.metric) ?? [],
  ]))];
  const requestedMetric = metricState.href === initialHref ? metricState.metric : initialMetric;
  const metric: ProgressMetric = requestedMetric ?? available.find(item => item.startsWith("estimate:")) ?? "reps";
  const options = [...new Set([...available.filter(item => item.startsWith("estimate:")), ...available.filter(item => item.startsWith("load:")), "reps" as const, metric])];
  const unit = metric === "reps" ? "reps" : metric.split(":")[1];
  const format = (value: number) => formatMetricValue(value, metric);
  const currentHref = progressUrl("/history", { exercise: selectedKey, period, metric, view: "big-three" });
  function navigate(nextPeriod: Period, nextMetric: ProgressMetric) { startTransition(() => router.push(progressUrl("/history", { exercise: selectedKey, period: nextPeriod, metric: nextMetric, view: "big-three" }), { scroll: false })); }
  const series = lifts.map(lift => {
    const points = [...lift.detail?.chart.points ?? []].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
    const values = points.map(point => valueFor(point, metric));
    const actual = points.flatMap((point, index) => values[index] === null ? [] : [{ ...point, value: values[index]!, record: `${lift.primary.key}/${point.sessionId}` }]);
    const summary = lift.detail?.metricSummaries?.find(item => item.metric === metric);
    return { ...lift, points, values, actual, latest: summary?.latest ?? actual.at(-1), style: styles[lift.primary.key] };
  });
  const records = series.flatMap((lift, liftIndex) => lift.actual.map(point => ({ ...point, liftIndex, name: lift.primary.name }))).sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId || a.liftIndex - b.liftIndex);
  const dates = [...new Set(series.flatMap(lift => lift.points.map(point => point.date)))].sort();
  const { low, high, ticks } = chartScale(records.map(point => point.value));
  const x = (date: string) => 46 + (chartDatePosition(date, dates[0], dates.at(-1)!) - 15) * 258 / 260;
  const y = (value: number) => 132 - (value - low) * 114 / (high - low);
  const middleDate = dates.slice(1, -1).filter(date => x(date) - x(dates[0]) >= 80 && x(dates.at(-1)!) - x(date) >= 80).sort((a, b) => Math.abs(x(a) - 175) - Math.abs(x(b) - 175))[0];
  const dateLabels = dates.length < 3 ? dates : [dates[0], ...(middleDate ? [middleDate] : []), dates.at(-1)!];
  const [inspection, setInspection] = useState<{ context: string; record: string } | null>(null);
  if (inspection && inspection.context !== currentHref) setInspection(null);
  const inspected = inspection?.context === currentHref ? records.find(point => point.record === inspection.record) : undefined;
  const inspectedIndex = inspected ? records.indexOf(inspected) : -1;
  function select(index: number) { if (records[index]) setInspection({ context: currentHref, record: records[index].record }); }
  function inspectPlot(event: MouseEvent<HTMLButtonElement>) {
    const record = (event.target as Element).closest("[data-record]")?.getAttribute("data-record");
    if (record) { setInspection({ context: currentHref, record }); return; }
    const bounds = event.currentTarget.querySelector("svg")!.getBoundingClientRect();
    const scale = Math.min(bounds.width / 320, bounds.height / 166);
    if (!scale || event.detail === 0) { select(records.length - 1); return; }
    const px = (event.clientX - bounds.left - (bounds.width - 320 * scale) / 2) / scale;
    const py = (event.clientY - bounds.top - (bounds.height - 166 * scale) / 2) / scale;
    const nearest = records.reduce((result, point, index) => {
      const distance = Math.hypot(x(point.date) - px, y(point.value) - py);
      return distance <= result.distance ? { index, distance } : result;
    }, { index: 0, distance: Infinity });
    select(nearest.index);
  }
  const hasTruncated = lifts.some(lift => lift.detail?.chart.truncated);
  return <div className="safe-x flex min-w-0 flex-col gap-3 py-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="display text-4xl">Progress</h1><Link href="/workouts" className={`${progressButton} shrink-0`}>History</Link></header>
    <ProgressViewNav currentHref={currentHref} view="big-three" />
    <section aria-label="Big three chart" className="card min-w-0 p-3 sm:p-4">
      <h2 className="display mb-3 text-2xl">Squat, Bench &amp; Deadlift</h2>
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-[2_1_10rem]"><span className="sr-only">Chart metric</span><select className={progressInput} value={metric} onChange={event => { const next = event.target.value as ProgressMetric; setMetricState({ href: initialHref, metric: next }); navigate(period, next); }}>{options.map(value => <option key={value} value={value}>{value === "reps" ? "Recorded reps" : `${value.startsWith("estimate:") ? "Est. max" : "Heaviest set"} (${value.split(":")[1]})`}</option>)}</select></label><label className="min-w-0 flex-[1_1_6rem]"><span className="sr-only">Period</span><select className={progressInput} value={period} onChange={event => navigate(event.target.value as Period, metric)}><option value="4w">4 weeks</option><option value="12w">12 weeks</option><option value="all">All time</option></select></label></div>
      {pending && <p role="status" className="mt-2 text-sm text-muted">Updating chart…</p>}
      {records.length > 0 ? <button type="button" aria-label="Inspect Big three chart" onClick={inspectPlot} className="touch-target mt-2 block h-[176px] w-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><svg viewBox="0 0 320 166" className="h-full w-full" aria-hidden="true" focusable="false">
        {ticks.map(value => <g key={value}><line x1="46" x2="304" y1={y(value)} y2={y(value)} stroke="currentColor" className="text-line" /><text x="38" y={y(value) + 4} textAnchor="end" fill="currentColor" className="text-muted" fontSize="11">{axisFormat(value)}</text></g>)}
        {series.map(lift => {
          const segments: string[][] = [[]];
          lift.values.forEach((value, index) => { if (value === null) { if (segments.at(-1)!.length) segments.push([]); } else segments.at(-1)!.push(`${x(lift.points[index].date)},${y(value)}`); });
          return <g key={lift.primary.key} className={lift.style.color}>{segments.filter(segment => segment.length > 1).map((segment, index) => <polyline key={index} points={segment.join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={lift.style.dash} strokeLinejoin="round" />)}{lift.actual.map(point => <Point key={point.sessionId} shape={lift.style.shape} x={x(point.date)} y={y(point.value)} data-chart-point="true" data-x={x(point.date)} data-record={point.record} />)}</g>;
        })}
        {dateLabels.map((date, index) => <text key={date} x={x(date)} y="158" textAnchor={dateLabels.length === 1 ? "middle" : index === 0 ? "start" : index === dateLabels.length - 1 ? "end" : "middle"} fill="currentColor" className="text-muted" fontSize="11">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</text>)}
      </svg></button> : <p className="py-6 text-sm text-muted">{series.some(lift => lift.latest) ? "This unit’s results are outside the plotted workouts. Latest values below include earlier history." : "No comparable results in this range."}</p>}
      {inspected && <section aria-label="Selected comparison workout" className="mb-2 rounded-xl bg-surface-muted px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><span className="font-semibold">{inspected.name} · {format(inspected.value)} {unit}</span><span className="block text-xs text-muted"><ProgressDate date={inspected.date} /> · {inspected.recordedSets} {inspected.recordedSets === 1 ? "set" : "sets"}</span></p><div className="flex gap-1"><button type="button" aria-label="Previous comparison workout" className={`${progressButton} px-2 disabled:opacity-40`} disabled={inspectedIndex <= 0} onClick={() => select(inspectedIndex - 1)}><ChevronLeft aria-hidden="true" size={18} /></button><button type="button" aria-label="Next comparison workout" className={`${progressButton} px-2 disabled:opacity-40`} disabled={inspectedIndex >= records.length - 1} onClick={() => select(inspectedIndex + 1)}><ChevronRight aria-hidden="true" size={18} /></button></div></div><Link href={workoutEvidenceHref(inspected.sessionId, currentHref)} className="touch-target inline-flex items-center text-sm font-semibold text-brand-strong underline underline-offset-4">View workout</Link></section>}
      <ul aria-label="Primary lift results" className="divide-y divide-line">{series.map(lift => <li key={lift.primary.key}><Link aria-label={`View ${lift.primary.name} progress`} href={progressUrl("/history", { exercise: lift.primary.exercise ? `e:${lift.primary.exercise.id}` : lift.primary.key, period, metric })} className="touch-target flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><span className="flex min-w-0 flex-[1_1_7rem] items-center gap-2"><svg viewBox="0 0 32 14" aria-hidden="true" className={`h-4 w-8 shrink-0 ${lift.style.color}`}><line x1="0" x2="32" y1="7" y2="7" stroke="currentColor" strokeWidth="2" strokeDasharray={lift.style.dash} /><Point shape={lift.style.shape} x={16} y={7} /></svg><span className="display text-xl">{lift.primary.name}</span></span><span className="min-w-0 flex-[1_1_9rem] text-sm">{lift.latest ? <><span className="font-semibold">{format(lift.latest.value)} {unit}</span><span className="mt-0.5 block text-xs text-muted">Latest · <ProgressDate date={lift.latest.date} /></span></> : <span className="text-muted">{!lift.primary.exercise ? lift.primary.hasHistory ? "Choose a variation" : "No recorded history" : metric === "reps" ? "No workouts in this range" : `No ${unit} results in this range`}</span>}</span><ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" /></Link></li>)}</ul>
      <p className="mt-2 text-xs leading-5 text-muted">{metric.startsWith("estimate:") ? "Estimated from recorded sets. Not tested maximums." : metric.startsWith("load:") ? `Heaviest completed sets, in original ${unit}.` : "Actual reps per workout; set counts and prescriptions may differ."} Each lift keeps its own workout dates.</p>
      {hasTruncated && <p className="mt-2 text-xs leading-5 text-muted">Each line shows up to 120 recent workouts. Latest values cover the full selected range.</p>}
      {dates.length > 0 && <details className="mt-2 border-t border-line"><summary className="touch-target cursor-pointer py-3 text-sm font-semibold">Dated chart values</summary><p className="mb-2 text-xs leading-5 text-muted">Original recorded units stay separate. Missing results have no chart value. Same-day workouts remain separate.</p><table aria-label="Big three dated values" className="w-full table-fixed text-left text-sm"><thead><tr className="border-b border-line"><th scope="col" className="w-[60%] py-2">Lift / workout</th><th scope="col" className="py-2 text-right">{metric.startsWith("estimate:") ? "Estimate" : metric === "reps" ? "Reps" : "Load"} ({unit})</th></tr></thead><tbody>{series.flatMap(lift => lift.points.map((point, index) => <tr key={`${lift.primary.key}/${point.sessionId}`} className="border-b border-line last:border-0"><th scope="row" className="py-2 pr-2 font-normal"><Link aria-label={`${lift.primary.name} · ${dateText(point.date)} · Workout ${point.sessionId}`} href={workoutEvidenceHref(point.sessionId, currentHref)} className="touch-target flex flex-col justify-center text-brand-strong underline underline-offset-4"><span>{lift.primary.name}</span><ProgressDate date={point.date} /></Link></th><td className="break-words py-2 text-right">{lift.values[index] !== null ? `${format(lift.values[index]!)} ${unit}` : point.unit !== unit && metric !== "reps" ? `Recorded in ${point.unit}` : "Not available"}</td></tr>))}</tbody></table></details>}
    </section>
    {activity && <RecordedActivitySummary activity={activity} />}
  </div>;
}
