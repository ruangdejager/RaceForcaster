import type { LatLon, TrackPoint } from '../types.js';
import { haversineMetres, lerpLatLon } from './distance.js';

export interface RawPoint extends LatLon {
  /** Metres above sea level. */
  ele: number;
}

/**
 * Redraw the track with a point exactly every `spacingM` metres.
 *
 * Everything downstream — pacing, weather lookup, chart rendering — wants to
 * ask "what is happening at kilometre 137?". Uniform spacing turns that from a
 * search into an array index, and it stops a densely-recorded descent from
 * dominating an averaged value over a sparsely-recorded climb.
 */
export function resampleTrack(points: readonly RawPoint[], spacingM: number): TrackPoint[] {
  if (points.length === 0) return [];

  const first = points[0];
  if (!first) return [];
  if (points.length === 1) {
    return [{ lat: first.lat, lon: first.lon, ele: first.ele, dist: 0 }];
  }

  // Cumulative distance along the original track.
  const cum: number[] = new Array(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const prevCum = cum[i - 1];
    if (!prev || !cur || prevCum === undefined) continue;
    cum[i] = prevCum + haversineMetres(prev, cur);
  }

  const total = cum[cum.length - 1] ?? 0;
  if (total === 0) {
    return [{ lat: first.lat, lon: first.lon, ele: first.ele, dist: 0 }];
  }

  const out: TrackPoint[] = [];
  let seg = 0; // Segment cursor advances monotonically, so this stays O(n).

  const emitAt = (target: number): void => {
    while (seg < points.length - 2 && (cum[seg + 1] ?? 0) < target) seg++;

    const a = points[seg];
    const b = points[seg + 1];
    const da = cum[seg];
    const db = cum[seg + 1];
    if (!a || !b || da === undefined || db === undefined) return;

    const span = db - da;
    const f = span > 0 ? Math.max(0, Math.min(1, (target - da) / span)) : 0;
    const { lat, lon } = lerpLatLon(a, b, f);
    out.push({ lat, lon, ele: a.ele + (b.ele - a.ele) * f, dist: target });
  };

  for (let d = 0; d < total; d += spacingM) emitAt(d);

  // Always land exactly on the finish, even if it isn't a multiple of spacing.
  const last = points[points.length - 1];
  if (last) out.push({ lat: last.lat, lon: last.lon, ele: last.ele, dist: total });

  return out;
}

/** Index of the resampled point at or just before `dist`. */
export function indexAtDistance(points: readonly TrackPoint[], dist: number, spacingM: number): number {
  if (points.length === 0) return 0;
  const i = Math.floor(dist / spacingM);
  return Math.max(0, Math.min(points.length - 1, i));
}

/**
 * Interpolated position at an arbitrary distance along the route.
 * Distances outside the route clamp to its ends rather than extrapolating.
 */
export function pointAtDistance<T extends TrackPoint>(points: readonly T[], dist: number): TrackPoint {
  if (points.length === 0) return { lat: 0, lon: 0, ele: 0, dist: 0 };

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return { lat: 0, lon: 0, ele: 0, dist: 0 };
  if (dist <= firstPoint.dist) return { ...firstPoint };
  if (dist >= lastPoint.dist) return { ...lastPoint };

  // Binary search: callers hit this with arbitrary distances, not a sweep.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const m = points[mid];
    if (!m) break;
    if (m.dist <= dist) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  if (!a || !b) return { ...firstPoint };

  const span = b.dist - a.dist;
  const f = span > 0 ? (dist - a.dist) / span : 0;
  const { lat, lon } = lerpLatLon(a, b, f);
  return { lat, lon, ele: a.ele + (b.ele - a.ele) * f, dist };
}
