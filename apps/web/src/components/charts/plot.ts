/**
 * Shared plotting primitives.
 *
 * Series colours come from the reference data-visualisation palette's dark
 * steps, validated against this app's card surface (#1a222b): all three clear
 * the lightness band, the chroma floor, adjacent CVD separation (worst ΔE 9.4),
 * the normal-vision floor (26.5) and 3:1 contrast. Don't substitute a hue here
 * without re-running that check — "looks different enough" is exactly the
 * judgement colour-vision deficiency defeats.
 */

export const SERIES = {
  /** Slot 1 — the primary measured quantity. */
  primary: '#3987e5',
  /** Slot 2 — the derived or relative quantity plotted against it. */
  secondary: '#d95926',
  /** Slot 3 — reserved for a third series. */
  tertiary: '#199e70',
} as const;

export const INK = {
  grid: '#26313d',
  axis: '#3a4653',
  label: '#8d9aa8',
  dim: '#5f6b78',
  surface: '#1a222b',
  night: '#7b6bd6',
  accent: '#34c3f0',
} as const;

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert(pixel: number): number;
}

/** A linear scale, with the inverse needed for hover hit-testing. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;

  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/**
 * Round a domain outwards to pleasant tick boundaries.
 *
 * `padFraction` keeps a line off the top edge of its plot, which reads as
 * clipped even when it isn't.
 */
export function niceDomain(
  values: readonly number[],
  { padFraction = 0.08, includeZero = false, minSpan = 1 } = {},
): [number, number] {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, minSpan];

  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (max - min < minSpan) {
    const mid = (max + min) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }

  const pad = (max - min) * padFraction;
  return [min - pad, max + pad];
}

/** Up to `count` round tick values covering the domain. */
export function ticks([min, max]: [number, number], count = 4): number[] {
  const span = max - min;
  if (span <= 0) return [min];

  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;

  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** An SVG path through points, skipping any that aren't finite. */
export function linePath(points: ReadonlyArray<[number, number]>): string {
  let path = '';
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return path;
}

/** A filled area between a series and a baseline. */
export function areaPath(points: ReadonlyArray<[number, number]>, baselineY: number): string {
  const usable = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (!first || !last) return '';
  return `${linePath(usable)}L${last[0].toFixed(1)} ${baselineY.toFixed(1)}L${first[0].toFixed(1)} ${baselineY.toFixed(1)}Z`;
}

/**
 * A bar rounded only at the end away from the baseline.
 *
 * Rounding all four corners detaches a bar from its axis and makes short bars
 * look like lozenges; the radius also has to shrink for bars smaller than it,
 * or the shape inverts.
 */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const h = Math.max(0, height);
  const r = Math.min(radius, width / 2, h);
  if (h <= 0) return '';
  return (
    `M${x} ${y + h}` +
    `L${x} ${y + r}` +
    `Q${x} ${y} ${x + r} ${y}` +
    `L${x + width - r} ${y}` +
    `Q${x + width} ${y} ${x + width} ${y + r}` +
    `L${x + width} ${y + h}Z`
  );
}

/** Roughly `count` evenly spaced clock times across a span. */
export function timeTicks(start: number, end: number, count = 5): number[] {
  const HOUR = 3_600_000;
  const span = Math.max(1, end - start);
  const stepHours = [1, 2, 3, 4, 6, 8, 12, 24].find((h) => span / (h * HOUR) <= count) ?? 24;
  const step = stepHours * HOUR;

  const out: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) out.push(t);
  return out;
}

/** Index of the entry whose `x` is nearest a value — for crosshair hit-testing. */
export function nearestIndex(xs: readonly number[], target: number): number {
  if (xs.length === 0) return -1;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const delta = Math.abs((xs[i] ?? 0) - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}
