/** A readable axis range; actual performance values remain unrounded. */
export function chartScale(values: number[]) {
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const padding = Math.max(max - min, max * 0.1, 1) * 0.1;
  const roughStep = (max - min + padding * 2) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = ([1, 2, 2.5, 5, 10].find(value => value >= roughStep / magnitude) ?? 10) * magnitude;
  const low = Math.max(0, Math.floor((min - padding) / step) * step);
  const high = Math.max(low + step, Math.ceil((max + padding) / step) * step);
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => Number((low + index * step).toPrecision(12)));
  return { low, high, ticks };
}

/** Actual loads keep entered precision; estimates remain deliberately approximate. */
export function formatMetricValue(value: number, metric: string) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: metric.startsWith("estimate:") ? 1 : 20 }).format(value);
}

/** Subtract the operands' represented decimals before converting back to a number. */
export function metricDifference(latest: number, previous: number) {
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return latest - previous;
  const decimal = (value: number) => {
    const [mantissa, exponent = "0"] = String(value).split("e");
    const [integer, fraction = ""] = mantissa.split(".");
    return { coefficient: BigInt(integer + fraction), exponent: Number(exponent) - fraction.length };
  };
  const left = decimal(latest), right = decimal(previous);
  const exponent = Math.min(left.exponent, right.exponent);
  // Integer arithmetic avoids cancellation noise, including exponent notation;
  // one final decimal conversion preserves the number's available precision.
  const difference = left.coefficient * BigInt(10) ** BigInt(left.exponent - exponent)
    - right.coefficient * BigInt(10) ** BigInt(right.exponent - exponent);
  return Number(`${difference}e${exponent}`);
}
