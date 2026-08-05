/**
 * Shared plotting primitives.
 *
 * Series colours come from the reference data-visualisation palette's dark
 * steps, validated against this app's card surface (#161d27): amber, blue and
 * teal all clear the lightness band, the chroma floor, CVD adjacency and 3:1
 * contrast — checked with `--pairs all`, the stricter mode for scatter/small
 * multiples, not just the adjacent-pair default. Don't substitute a hue here
 * without re-running that check — "looks different enough" is exactly the
 * judgement colour-vision deficiency defeats. Amber leads because it's the
 * app's one accent doing real work; blue and teal are reserved for secondary
 * series precisely so they never compete with it for attention.
 */

export const SERIES = {
  /** Slot 1 — the primary measured quantity. */
  primary: '#c98500',
  /** Slot 2 — the derived or relative quantity plotted against it. */
  secondary: '#3987e5',
  /** Slot 3 — reserved for a third series. */
  tertiary: '#199e70',
} as const;

export const INK = {
  grid: '#232d38',
  axis: '#2a3542',
  label: '#8d99a8',
  dim: '#6b7889',
  surface: '#161d27',
  night: '#6b5bc0',
  accent: '#c98500',
} as const;

/**
 * The push/resist wind pair: teal for a tailwind (pushing you along), the
 * same cockpit red as every other danger/critical reading for a headwind
 * (pushing back). Deliberately not amber for the "push" pole — amber is
 * already the page's one general-purpose accent, and reusing it here would
 * make "this specifically means tailwind" indistinguishable from "this is
 * just highlighted." This is a "how it feels" scale rather than the
 * validated categorical palette above — it's encoding a single continuous
 * quantity (how hard the wind is against or for you), not distinguishing
 * series identity, so the usual CVD-adjacency requirement doesn't apply the
 * same way. It still isn't color-alone: every chart that uses it pairs the
 * fill with a numeric km/h readout.
 */
export const WIND_PUSH = '#199e70';
export const WIND_RESIST = '#e05a4e';
export const WIND_NEUTRAL = '#414d5a';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Colour for a headwind component, `t` in m/s where positive opposes the
 * rider and negative pushes them along. Zero sits at a muted neutral rather
 * than either pole, so a calm stretch of road doesn't read as "a bit of
 * tailwind" — `scale` is the magnitude (m/s) that should already be fully
 * saturated, typically the strongest headwind on the route.
 */
export function windPushColor(headwindMs: number, scale: number): string {
  const t = Math.max(-1, Math.min(1, headwindMs / Math.max(1, scale)));
  const [nr, ng, nb] = hexToRgb(WIND_NEUTRAL);
  const [pr, pg, pb] = t >= 0 ? hexToRgb(WIND_RESIST) : hexToRgb(WIND_PUSH);
  const f = Math.abs(t);
  return rgbToHex(nr + (pr - nr) * f, ng + (pg - ng) * f, nb + (pb - nb) * f);
}

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
