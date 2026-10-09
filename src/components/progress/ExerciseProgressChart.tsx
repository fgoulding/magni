"use client";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { ExerciseChartPoint } from "@/features/progress/types";
import { ProgressDate, progressInput } from "./ProgressChrome";
import { workoutEvidenceHref, type ProgressMetric } from "./navigation";

export function chartDatePosition(date: string, first: string, last: string): number {
  const parse = (value: string) => Date.parse(`${value}T12:00:00Z`);
  const range = parse(last) - parse(first);
  return range === 0 ? 145 : 15 + (parse(date) - parse(first)) * 260 / range;
}
const format = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

/** One dated chart, with separate original-unit series and no invented values for missing results. */
export function RecordedRepsChart({ points, truncated, currentHref, overview = false, periodControl, metric: controlledMetric, onMetricChange }: { points: ExerciseChartPoint[]; truncated: boolean; currentHref: string; overview?: boolean; periodControl?: ReactNode; metric?: ProgressMetric; onMetricChange?: (metric: ProgressMetric) => void }) {
  const chartId = useId();
  const units = [...new Set(points.filter(point => point.bestE1rm !== null && point.bestE1rm > 0).map(point => point.unit))];
  const loadUnits = [...new Set(points.filter(point => point.topWeight !== null && point.topWeight !== undefined).map(point => point.unit))];
  const options = [...units.map(unit => `estimate:${unit}`), ...loadUnits.map(unit => `load:${unit}`), "reps"];
  const defaultMetric = units.length ? `estimate:${units[0]}` : "reps";
  const [localMetric, setMetric] = useState(defaultMetric);
  const metric = onMetricChange ? controlledMetric ?? defaultMetric : localMetric;
  const selectedMetric = options.includes(metric) ? metric : units.length ? `estimate:${units[0]}` : "reps";
  const estimate = selectedMetric.startsWith("estimate:"), load = selectedMetric.startsWith("load:");
  const unit = selectedMetric.split(":")[1] ?? "reps";
  const title = estimate ? "Estimated max" : load ? "Heaviest set" : "Recorded reps";
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
  const values = sorted.map(point => estimate ? point.unit === unit && point.bestE1rm !== null && point.bestE1rm > 0 ? point.bestE1rm : null : load ? point.unit === unit ? point.topWeight ?? null : null : point.totalReps);
  const actual = values.flatMap((value, index) => value === null ? [] : [{ value, date: sorted[index].date }]);
  const first = actual[0], latest = actual.at(-1);
  const min = Math.min(...actual.map(item => item.value)), max = Math.max(...actual.map(item => item.value));
  const span = actual.length ? Math.max(max - min, max * 0.1, 1) : 1;
  const low = actual.length ? Math.max(0, min - span * 0.15) : 0, high = actual.length ? max + span * 0.15 : 1;
  const x = (index: number) => 46 + (chartDatePosition(sorted[index].date, sorted[0].date, sorted.at(-1)!.date) - 15) * 258 / 260;
  const y = (value: number) => 132 - (value - low) * 114 / (high - low || 1);
  const segments: string[][] = [[]];
  values.forEach((value, index) => { if (value === null) { if (segments.at(-1)!.length) segments.push([]); } else segments.at(-1)!.push(`${x(index)},${y(value)}`); });
  const distinctDates = sorted.flatMap((point, index) => index === 0 || point.date !== sorted[index - 1].date ? [index] : []);
  const firstDateIndex = distinctDates[0], lastDateIndex = distinctDates.at(-1);
  const dateIndices = distinctDates.length <= 2 ? distinctDates : (() => {
    const left = x(firstDateIndex), right = x(lastDateIndex!), center = (left + right) / 2;
    // Labels use fixed SVG font units. Leave enough room for an endpoint label,
    // half an interior label and a gap; point positions still follow actual dates.
    const interior = distinctDates.slice(1, -1)
      .filter(index => x(index) - left >= 80 && right - x(index) >= 80)
      .sort((a, b) => Math.abs(x(a) - center) - Math.abs(x(b) - center))[0];
    return interior === undefined ? [firstDateIndex, lastDateIndex!] : [firstDateIndex, interior, lastDateIndex!];
  })();
  const description = estimate ? `Epley estimate from positive loaded sets, in original ${unit}. An estimate is not a tested maximum. Missing loads, zero loads and zero-rep attempts have no estimate.` : load ? `Heaviest successfully completed set, in original ${unit}. Zero-rep attempts and missing loads have no value.` : "Actual reps across logged sets in each workout. Set counts and prescriptions can vary.";
  return <section className="card min-w-0 p-3 sm:p-4" aria-label={overview ? "Exercise chart" : undefined} aria-labelledby={overview ? undefined : chartId}>
    <h2 id={chartId} className={overview ? "sr-only" : "display mb-3 text-2xl"}>{title}</h2>
    <div className="flex items-end gap-3"><label className="min-w-0 flex-1"><span className={overview ? "sr-only" : "text-sm text-muted"}>Chart metric</span><select className={`${progressInput} ${overview ? "" : "mt-1"}`} value={selectedMetric} onChange={event => { const next = event.target.value as ProgressMetric; setMetric(next); onMetricChange?.(next); }}>{units.map(value => <option key={`estimate:${value}`} value={`estimate:${value}`}>{overview ? units.length === 1 ? "Estimated max" : `Est. max (${value})` : `Estimated max (${value})`}</option>)}{loadUnits.map(value => <option key={`load:${value}`} value={`load:${value}`}>{overview && loadUnits.length === 1 ? "Heaviest set" : `Heaviest set (${value})`}</option>)}<option value="reps">Recorded reps</option></select></label>{periodControl}</div>
    {latest ? <><div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1" aria-live="polite"><p className="display text-4xl">{format(latest.value)} <span className="font-sans text-base font-normal text-muted">{unit}</span></p><p className="text-sm text-muted">{actual.length > 1 && first ? <>{latest.value - first.value > 0 ? "+" : ""}{format(latest.value - first.value)} {unit} since <ProgressDate date={first.date} short /></> : "One recorded workout"}</p></div>
      <svg viewBox="0 0 320 166" className="mt-1 h-44 w-full text-brand-strong" aria-hidden="true" focusable="false">
        {[0, 1, 2, 3].map(index => { const value = low + (high - low) * index / 3; return <g key={index}><line x1="46" x2="304" y1={y(value)} y2={y(value)} stroke="currentColor" className="text-line" /><text x="38" y={y(value) + 4} textAnchor="end" fill="currentColor" className="text-muted" fontSize="11">{format(value)}</text></g>; })}
        {segments.filter(segment => segment.length > 1).map((segment, index) => <polyline key={index} points={segment.join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />)}{values.map((value, index) => value === null ? null : <circle key={sorted[index].sessionId} cx={x(index)} cy={y(value)} r="3.5" fill="currentColor" />)}
        {dateIndices.map((index, position) => <text key={sorted[index].date} x={x(index)} y="158" textAnchor={dateIndices.length === 1 ? "middle" : position === 0 ? "start" : position === dateIndices.length - 1 ? "end" : "middle"} fill="currentColor" className="text-muted" fontSize="11">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${sorted[index].date}T12:00:00Z`))}</text>)}
      </svg></> : <p className="py-6 text-sm text-muted">No recorded sets in this period. Choose a wider date range to see earlier workouts.</p>}
    <p className="mt-1 text-xs leading-5 text-muted">{estimate ? "Estimated from recorded sets. Not a tested max." : load ? "Heaviest completed set in each workout." : "Actual reps across recorded sets; set counts may vary."}</p>
    {truncated && <p className="mt-2 text-sm text-muted">Showing the most recent {points.length} workouts. Narrow the dates to inspect an earlier period.</p>}
    {!!points.length && <details className="mt-2 border-t border-line"><summary className="touch-target cursor-pointer py-3 text-sm font-semibold">Dated chart values</summary><p className="mb-3 text-sm leading-6 text-muted">{description} Horizontal spacing follows dates; same-day workouts share a date position.</p><table className="w-full table-fixed text-left text-sm" aria-label={`${title} by workout`}><thead><tr className="border-b border-line"><th scope="col" className="w-[55%] py-2">Date / workout</th><th scope="col" className="py-2 text-right">{estimate ? `Estimate (${unit})` : load ? `Load (${unit})` : "Sets / reps"}</th></tr></thead><tbody>{sorted.map((point, index) => <tr key={point.sessionId} className="border-b border-line last:border-0"><th scope="row" className="py-2 font-normal"><ProgressDate date={point.date} /><Link href={workoutEvidenceHref(point.sessionId, currentHref)} className="touch-target flex items-center text-brand-strong underline underline-offset-4">Workout {point.sessionId}</Link></th><td className="break-words py-2 text-right">{estimate || load ? values[index] === null ? point.unit !== unit ? `Recorded in ${point.unit}` : "Not available" : `${format(values[index]!)} ${unit}` : <><span>{point.recordedSets} sets · </span><span>{point.totalReps}</span> reps</>}</td></tr>)}</tbody></table></details>}
  </section>;
}
