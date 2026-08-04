import {
  ASCENT_THRESHOLD_M,
  BEARING_HALF_SPAN_M,
  ELEVATION_SMOOTH_HALF_M,
  GRADE_HALF_SPAN_M,
  RESAMPLE_SPACING_M,
  SIMPLIFY_TOLERANCE_M,
} from '../constants.js';
import type { Bounds, RoutePoint, TrackPoint } from '../types.js';
import { initialBearingDeg } from './distance.js';
import { computeAscentDescent, computeGrades, movingAverage } from './elevation.js';
import { resampleTrack, type RawPoint } from './resample.js';
import { simplify } from './simplify.js';

export interface PreparedTrack {
  points: RoutePoint[];
  totalDistance: number;
  totalAscent: number;
  totalDescent: number;
  bounds: Bounds;
}

/** Convert a metre-denominated half-span into a whole number of samples. */
const spanToHalfWindow = (metres: number): number =>
  Math.max(1, Math.round(metres / RESAMPLE_SPACING_M));

/**
 * Direction of travel at every point, taken as the chord between the samples
 * `halfWindow` either side.
 *
 * Using a chord rather than averaging neighbouring bearings sidesteps the
 * circular-mean problem entirely: there is no wraparound to get wrong because
 * the answer is computed once, from two positions.
 */
function computeBearings(points: readonly TrackPoint[], halfWindow: number): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    const a = points[lo];
    const b = points[hi];
    if (!a || !b) continue;

    // A perfect out-and-back can put the two ends on the same spot; fall back
    // to the previous point's bearing rather than emitting a meaningless 0.
    if (a.lat === b.lat && a.lon === b.lon) {
      out[i] = out[Math.max(0, i - 1)] ?? 0;
      continue;
    }
    out[i] = initialBearingDeg(a, b);
  }
  return out;
}

function computeBounds(points: readonly TrackPoint[]): Bounds {
  const bounds: Bounds = {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLon: Number.POSITIVE_INFINITY,
    maxLon: Number.NEGATIVE_INFINITY,
  };
  for (const p of points) {
    if (p.lat < bounds.minLat) bounds.minLat = p.lat;
    if (p.lat > bounds.maxLat) bounds.maxLat = p.lat;
    if (p.lon < bounds.minLon) bounds.minLon = p.lon;
    if (p.lon > bounds.maxLon) bounds.maxLon = p.lon;
  }
  if (!Number.isFinite(bounds.minLat)) {
    return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
  }
  return bounds;
}

/**
 * Raw GPX points to an evenly spaced track annotated with the direction and
 * gradient the pacing and wind models need.
 */
export function prepareTrack(raw: readonly RawPoint[]): PreparedTrack {
  const cleaned = simplify(raw, SIMPLIFY_TOLERANCE_M);
  const resampled = resampleTrack(cleaned, RESAMPLE_SPACING_M);

  if (resampled.length === 0) {
    return {
      points: [],
      totalDistance: 0,
      totalAscent: 0,
      totalDescent: 0,
      bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    };
  }

  const rawEle = resampled.map((p) => p.ele);
  const smoothEle = movingAverage(rawEle, spanToHalfWindow(ELEVATION_SMOOTH_HALF_M));
  const grades = computeGrades(smoothEle, RESAMPLE_SPACING_M, spanToHalfWindow(GRADE_HALF_SPAN_M));
  const bearings = computeBearings(resampled, spanToHalfWindow(BEARING_HALF_SPAN_M));
  const { ascent, descent } = computeAscentDescent(smoothEle, ASCENT_THRESHOLD_M);

  const points: RoutePoint[] = resampled.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    // Keep the smoothed elevation: it is what the gradients, and therefore the
    // arrival times, were derived from. A profile that disagrees with the
    // pacing would just be confusing.
    ele: smoothEle[i] ?? p.ele,
    dist: p.dist,
    bearing: bearings[i] ?? 0,
    grade: grades[i] ?? 0,
  }));

  const last = points[points.length - 1];

  return {
    points,
    totalDistance: last?.dist ?? 0,
    totalAscent: ascent,
    totalDescent: descent,
    bounds: computeBounds(points),
  };
}
