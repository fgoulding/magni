"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState, type MouseEvent, type ReactNode } from "react";
import type { ExerciseChartPoint, ExerciseMetricEvidence, ExerciseMetricSummary } from "@/features/progress/types";
import { ProgressDate, progressButton, progressInput } from "./ProgressChrome";
import { workoutEvidenceHref, type ProgressMetric } from "./navigation";
import { chartScale, formatMetricValue, metricDifference } from "./chart-insights";

export function chartDatePosition(date: string, first: string, last: string): number {
  const parse = (value: string) => Date.parse(`${value}T12:00:00Z`);
  const range = parse(last) - parse(first);
  return range === 0 ? 145 : 15 + (parse(date) - parse(first)) * 260 / range;
}
const formatAxis = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

/** One dated chart. Summaries cover the full range; inspection follows the bounded plotted history. */
export function RecordedRepsChart({ points, metricSummaries, truncated, currentHref, overview = false, periodControl, metric: controlledMetric, onMetricChange }: {
  points: ExerciseChartPoint[]; metricSummaries?: ExerciseMetricSummary[]; truncated: boolean; currentHref: string; overview?: boolean;
  periodControl?: ReactNode; metric?: ProgressMetric; onMetricChange?: (metric: ProgressMetric) => void;
}) {
  const chartId = useId();
  const units = [...new Set([...points.filter(point => point.bestE1rm !== null && point.bestE1rm > 0).map(point => point.unit), ...metricSummaries?.filter(summary => summary.metric.startsWith("estimate:")).map(summary => summary.metric.split(":")[1]) ?? []])];
  const loadUnits = [...new Set([...points.filter(point => point.topWeight !== null && point.topWeight !== undefined).map(point => point.unit), ...metricSummaries?.filter(summary => summary.metric.startsWith("load:")).map(summary => summary.metric.split(":")[1]) ?? []])];
  const options = [...units.map(unit => `estimate:${unit}`), ...loadUnits.map(unit => `load:${unit}`), "reps"];
  const defaultMetric = units.length ? `estimate:${units[0]}` : "reps";
  const [localMetric, setMetric] = useState({ href: currentHref, provided: controlledMetric, value: controlledMetric ?? defaultMetric });
  if (localMetric.href !== currentHref || localMetric.provided !== controlledMetric) setMetric({ href: currentHref, provided: controlledMetric, value: controlledMetric ?? defaultMetric });
  const metric = onMetricChange ? controlledMetric ?? defaultMetric : localMetric.href === currentHref && localMetric.provided === controlledMetric ? localMetric.value : controlledMetric ?? defaultMetric;
  const selectedMetric = options.includes(metric) ? metric : defaultMetric;
  const estimate = selectedMetric.startsWith("estimate:"), load = selectedMetric.startsWith("load:");
  const unit = selectedMetric.split(":")[1] ?? "reps";
  const format = (value: number) => formatMetricValue(value, selectedMetric);
  const title = estimate ? "Estimated max" : load ? "Heaviest set" : "Recorded reps";
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
  const values = sorted.map(point => estimate ? point.unit === unit && point.bestE1rm !== null && point.bestE1rm > 0 ? point.bestE1rm : null : load ? point.unit === unit ? point.topWeight ?? null : null : point.totalReps);
  const actual = values.flatMap((value, index) => value === null ? [] : [{ ...sorted[index], value, index }]);
  const summary = metricSummaries?.find(item => item.metric === selectedMetric);
  const latest = summary?.latest ?? actual.at(-1);
  const previous = summary ? summary.previous : actual.at(-2);
  const best = summary?.best ?? actual.reduce<typeof actual[number] | undefined>((result, entry) => !result || entry.value >= result.value ? entry : result, undefined);
  const comparableCount = summary?.count ?? actual.length;
  const context = `${currentHref}|${selectedMetric}`;
  const [selection, setSelection] = useState<{ context: string; sessionId: number | null }>({ context, sessionId: null });
  if (selection.context !== context) setSelection({ context, sessionId: null });
  const selectedIndex = selection.context === context && selection.sessionId !== null ? actual.findIndex(item => item.sessionId === selection.sessionId) : actual.length - 1;
  const index = selectedIndex < 0 ? actual.length - 1 : selectedIndex;
  const inspected: ExerciseMetricEvidence | undefined = actual[index] ?? latest ?? undefined;
  function select(index: number) { if (actual[index]) setSelection({ context, sessionId: actual[index].sessionId }); }
  const { low, high, ticks } = chartScale(actual.map(item => item.value));
  const x = (index: number) => 46 + (chartDatePosition(sorted[index].date, sorted[0].date, sorted.at(-1)!.date) - 15) * 258 / 260;
  const y = (value: number) => 132 - (value - low) * 114 / (high - low);
  const segments: string[][] = [[]];
  values.forEach((value, index) => { if (value === null) { if (segments.at(-1)!.length) segments.push([]); } else segments.at(-1)!.push(`${x(index)},${y(value)}`); });
  const distinctDates = sorted.flatMap((point, index) => index === 0 || point.date !== sorted[index - 1].date ? [index] : []);
  const firstDateIndex = distinctDates[0], lastDateIndex = distinctDates.at(-1);
  const dateIndices = distinctDates.length <= 2 ? distinctDates : (() => {
    const left = x(firstDateIndex), right = x(lastDateIndex!), center = (left + right) / 2;
    const interior = distinctDates.slice(1, -1).filter(index => x(index) - left >= 80 && right - x(index) >= 80)
      .sort((a, b) => Math.abs(x(a) - center) - Math.abs(x(b) - center))[0];
    return interior === undefined ? [firstDateIndex, lastDateIndex!] : [firstDateIndex, interior, lastDateIndex!];
  })();
  function inspectPlot(event: MouseEvent<HTMLButtonElement>) {
    const target = event.target as Element;
    const sessionId = target.closest("[data-session-id]")?.getAttribute("data-session-id");
    if (sessionId) { select(actual.findIndex(item => String(item.sessionId) === sessionId)); return; }
    const svg = event.currentTarget.querySelector("svg")!;
    const bounds = svg.getBoundingClientRect();
    const scale = Math.min(bounds.width / 320, bounds.height / 166);
    if (!scale || event.detail === 0) { select(actual.length - 1); return; }
    const px = (event.clientX - bounds.left - (bounds.width - 320 * scale) / 2) / scale;
    const py = (event.clientY - bounds.top - (bounds.height - 166 * scale) / 2) / scale;
    // A whole-plot target permits taps between points. The buttons below also
    // reach every same-day workout, including exactly overlapping points.
    const nearest = actual.reduce((result, item, index) => {
      const distance = Math.hypot(x(item.index) - px, y(item.value) - py);
      return distance <= result.distance ? { index, distance } : result;
    }, { index: 0, distance: Infinity });
    select(nearest.index);
  }
  const description = estimate ? `Epley estimate from positive loaded sets, in original ${unit}. An estimate is not a tested maximum. Missing loads, zero loads and zero-rep attempts have no estimate.` : load ? `Heaviest successfully completed set, in original ${unit}. Zero-rep attempts and missing loads have no value.` : "Actual reps across logged sets in each workout. Set counts and prescriptions can vary.";
  return <section className="card min-w-0 p-3 sm:p-4" aria-label={overview ? "Exercise chart" : undefined} aria-labelledby={overview ? undefined : chartId}>
    <h2 id={chartId} className={overview ? "sr-only" : "display mb-3 text-2xl"}>{title}</h2>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-[2_1_10rem]"><span className={overview ? "sr-only" : "text-sm text-muted"}>Chart metric</span><select className={`${progressInput} ${overview ? "" : "mt-1"}`} value={selectedMetric} onChange={event => { const next = event.target.value as ProgressMetric; setMetric({ href: currentHref, provided: controlledMetric, value: next }); onMetricChange?.(next); }}>
        {units.map(value => <option key={`estimate:${value}`} value={`estimate:${value}`}>{overview && units.length === 1 ? "Estimated max" : `Est. max (${value})`}</option>)}
        {loadUnits.map(value => <option key={`load:${value}`} value={`load:${value}`}>{overview && loadUnits.length === 1 ? "Heaviest set" : `Heaviest set (${value})`}</option>)}<option value="reps">Recorded reps</option>
      </select></label>{periodControl}
    </div>
    {latest && best ? <section aria-label="Performance summary" className="mt-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] items-start gap-x-3 gap-y-2">
        <div><p className="text-xs text-muted">Latest · <ProgressDate date={latest.date} /></p><p className="display text-4xl leading-tight">{format(latest.value)} <span className="font-sans text-base font-normal text-muted">{unit}</span></p></div>
        <div><p className="text-xs text-muted">{truncated && !summary ? "Best shown" : "Best in range"}</p><Link href={workoutEvidenceHref(best.sessionId, currentHref)} aria-label={`View best workout: ${format(best.value)} ${unit}, ${best.date}`} className="touch-target inline-flex flex-wrap items-baseline gap-x-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><span className="display text-2xl">{format(best.value)} <span className="font-sans text-sm font-normal text-muted">{unit}</span></span><span className="text-xs text-muted"><ProgressDate date={best.date} /></span></Link></div>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">{previous ? <><span className="font-semibold text-foreground">{latest.value - previous.value > 0 ? "+" : ""}{format(metricDifference(latest.value, previous.value))} {unit}</span> vs previous · <ProgressDate date={previous.date} /> ({format(previous.value)} {unit})</> : truncated && !summary ? "No earlier comparable workout shown" : comparableCount === 1 ? "One comparable result in this range" : "No earlier comparable workout in this range"}</p>
    </section> : null}
    {actual.length > 0 ? <button type="button" aria-label="Inspect chart workout" aria-describedby={`${chartId}-instructions`} onClick={inspectPlot} className="touch-target mt-1 block h-[176px] w-full rounded-lg text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <svg viewBox="0 0 320 166" className="h-full w-full" aria-hidden="true" focusable="false">
        {ticks.map(value => <g key={value}><line x1="46" x2="304" y1={y(value)} y2={y(value)} stroke="currentColor" className="text-line" /><text x="38" y={y(value) + 4} textAnchor="end" fill="currentColor" className="text-muted" fontSize="11">{formatAxis(value)}</text></g>)}
        {segments.filter(segment => segment.length > 1).map((segment, index) => <polyline key={index} points={segment.join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />)}
        {actual.map(point => <circle key={point.sessionId} data-session-id={point.sessionId} cx={x(point.index)} cy={y(point.value)} r={point.sessionId === inspected?.sessionId ? "5" : "3.5"} fill="currentColor" stroke="var(--surface)" strokeWidth={point.sessionId === inspected?.sessionId ? "2" : "0"} />)}
        {dateIndices.map((index, position) => <text key={sorted[index].date} x={x(index)} y="158" textAnchor={dateIndices.length === 1 ? "middle" : position === 0 ? "start" : position === dateIndices.length - 1 ? "end" : "middle"} fill="currentColor" className="text-muted" fontSize="11">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${sorted[index].date}T12:00:00Z`))}</text>)}
      </svg>
    </button> : <p className="py-5 text-sm leading-6 text-muted">{latest ? "This metric’s results are outside the plotted workouts. They are included in the summary above; open the source workout below." : "No recorded sets in this period. Choose a wider date range to see earlier workouts."}</p>}
    <p id={`${chartId}-instructions`} className="sr-only">Select a point on the chart or use Previous workout and Next workout to inspect each recorded result.</p>
    {inspected && <section aria-label="Selected workout" className="mt-1 rounded-xl bg-surface-muted px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-sm font-semibold"><ProgressDate date={inspected.date} /></p>
        <div className="flex items-center gap-1"><button type="button" aria-label="Previous workout" disabled={index <= 0 || !actual.length} onClick={() => select(index - 1)} className={`${progressButton} px-2 disabled:opacity-40`}><ChevronLeft aria-hidden="true" size={18} /></button><span className="min-w-0 px-1 text-xs text-muted" aria-label={actual.length ? `Workout ${index + 1} of ${actual.length} plotted results` : "Outside plotted history"}>{actual.length ? `${index + 1} / ${actual.length}` : "—"}</span><button type="button" aria-label="Next workout" disabled={index >= actual.length - 1 || !actual.length} onClick={() => select(index + 1)} className={`${progressButton} px-2 disabled:opacity-40`}><ChevronRight aria-hidden="true" size={18} /></button></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" aria-live="polite"><p className="min-w-0 text-sm"><span className="font-semibold">{format(inspected.value)} {unit}</span><span className="text-muted"> · {inspected.recordedSets} {inspected.recordedSets === 1 ? "set" : "sets"}{selectedMetric !== "reps" ? ` · ${inspected.totalReps} reps` : ""}</span></p><Link href={workoutEvidenceHref(inspected.sessionId, currentHref)} className="touch-target inline-flex items-center text-sm font-semibold text-brand-strong underline underline-offset-4">View workout</Link></div>
    </section>}
    <p className="mt-2 text-xs leading-5 text-muted">{estimate ? "Estimated from recorded sets. Not a tested max." : load ? "Heaviest completed set in each workout." : "Actual reps across recorded sets; set counts may vary."}</p>
    {truncated && <p className="mt-2 text-xs leading-5 text-muted">Chart shows the most recent {points.length} workouts.{summary ? " Latest and best cover the full selected range." : " Narrow the dates to inspect an earlier period."}</p>}
    {!!points.length && <details className="mt-2 border-t border-line"><summary className="touch-target cursor-pointer py-3 text-sm font-semibold">Dated chart values</summary><p className="mb-3 text-sm leading-6 text-muted">{description} Horizontal spacing follows dates; same-day workouts share a date position.</p><table className="w-full table-fixed text-left text-sm" aria-label={`${title} by workout`}><thead><tr className="border-b border-line"><th scope="col" className="w-[55%] py-2">Date / workout</th><th scope="col" className="py-2 text-right">{estimate ? `Estimate (${unit})` : load ? `Load (${unit})` : "Sets / reps"}</th></tr></thead><tbody>{sorted.map((point, index) => <tr key={point.sessionId} className="border-b border-line last:border-0"><th scope="row" className="py-2 font-normal"><ProgressDate date={point.date} /><Link href={workoutEvidenceHref(point.sessionId, currentHref)} className="touch-target flex items-center text-brand-strong underline underline-offset-4">Workout {point.sessionId}</Link></th><td className="break-words py-2 text-right">{estimate || load ? values[index] === null ? point.unit !== unit ? `Recorded in ${point.unit}` : "Not available" : `${format(values[index]!)} ${unit}` : <><span>{point.recordedSets} sets · </span><span>{point.totalReps}</span> reps</>}</td></tr>)}</tbody></table></details>}
  </section>;
}
