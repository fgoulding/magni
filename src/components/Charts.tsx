// Lightweight, dependency-free chart primitives.
// Pure presentational + server-safe. Color comes from `currentColor`, so set the
// hue with a text-* token class on the element (e.g. className="text-brand").

export function Sparkline({
  data,
  className = "h-8 text-brand",
}: {
  data: readonly number[];
  /** Set height + color here, e.g. "h-40 text-brand". */
  className?: string;
}) {
  if (data.length === 0) return null;

  const w = 100;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((value, index) => {
    const x = data.length === 1 ? w / 2 : (index / (data.length - 1)) * w;
    const y = h - 3 - ((value - min) / range) * (h - 6);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      aria-hidden="true"
    >
      <path d={area} fill="currentColor" fillOpacity={0.12} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function MiniBars({
  data,
  className = "text-brand",
  highlightLast = true,
}: {
  data: readonly { label?: string; value: number }[];
  className?: string;
  highlightLast?: boolean;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={`flex h-24 items-end gap-1 ${className}`} aria-hidden="true">
      {data.map((d, index) => {
        const isLast = index === data.length - 1;
        const heightPct = d.value > 0 ? Math.max(4, (d.value / max) * 100) : 2;
        return (
          <div
            key={index}
            className={`flex-1 rounded-t-md ${
              d.value > 0
                ? isLast && highlightLast
                  ? "bg-current"
                  : "bg-current/45"
                : "bg-line"
            }`}
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}

const SPLIT_COLORS: Record<string, string> = {
  main: "bg-brand",
  aux: "bg-success",
  accessory: "bg-faint",
};

export function SplitBar({
  data,
}: {
  data: readonly { category: string; pct: number }[];
}) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
      {data.map((slice) => (
        <div
          key={slice.category}
          className={SPLIT_COLORS[slice.category] ?? "bg-faint"}
          style={{ width: `${slice.pct}%` }}
        />
      ))}
    </div>
  );
}

export function splitColorClass(category: string): string {
  return SPLIT_COLORS[category] ?? "bg-faint";
}

/** A row of week dots; filled when the week had >=1 session. */
export function DotGrid({
  weeks,
  className = "text-brand",
}: {
  weeks: readonly { value: number }[];
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`} aria-hidden="true">
      {weeks.map((week, index) => (
        <span
          key={index}
          className={`h-2.5 w-2.5 rounded-full ${week.value > 0 ? "bg-current" : "bg-line"}`}
        />
      ))}
    </div>
  );
}
