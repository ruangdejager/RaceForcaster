import { toRad } from './distance.js';

/**
 * Metres per degree of latitude, matching the mean Earth radius the haversine
 * uses so the two never disagree about how long a route is.
 */
const M_PER_DEG_LAT = 6371008.8 * (Math.PI / 180);

export interface SimplifyPoint {
  lat: number;
  lon: number;
  /** Metres above sea level. Treated as a third spatial axis. */
  ele: number;
}

interface Projected {
  x: number;
  y: number;
  z: number;
}

/**
 * Project to local metres around a reference latitude. Over the span of a
 * single route the distortion is negligible, and it lets the simplifier work
 * in plain Euclidean geometry.
 */
function project(points: readonly SimplifyPoint[], refLat: number): Projected[] {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(toRad(refLat));
  return points.map((p) => ({
    x: p.lon * mPerDegLon,
    y: p.lat * M_PER_DEG_LAT,
    z: p.ele,
  }));
}

/** Perpendicular distance from `p` to the segment `a`-`b`, metres, in 3D. */
function perpendicularDistance(p: Projected, a: Projected, b: Projected): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dy * dy + dz * dz;

  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);

  // Clamped projection parameter, so degenerate near-endpoint cases behave.
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lenSq),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
}

/**
 * Ramer-Douglas-Peucker in three dimensions, iterative so a 100k-point GPX
 * can't blow the stack.
 *
 * Run at a small tolerance (1-2 m) this strips GPS jitter without touching the
 * shape of the route. That matters for more than file size: jitter inflates
 * measured distance, which would quietly make every arrival time wrong.
 *
 * Elevation is the third axis rather than an afterthought, and it has to be.
 * Simplifying on latitude and longitude alone collapses a dead-straight road
 * to its two endpoints — which on a long, straight climb throws away the
 * entire ascent and leaves the pacing model thinking the route is flat.
 */
export function simplifyIndices(points: readonly SimplifyPoint[], toleranceM: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);

  const first = points[0];
  if (!first) return [];
  const projected = project(points, first.lat);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [startIdx, endIdx] = range;
    if (endIdx <= startIdx + 1) continue;

    const a = projected[startIdx];
    const b = projected[endIdx];
    if (!a || !b) continue;

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
      const p = projected[i];
      if (!p) continue;
      const d = perpendicularDistance(p, a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > toleranceM && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx], [maxIdx, endIdx]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < keep.length; i++) if (keep[i] === 1) out.push(i);
  return out;
}

export function simplify<T extends SimplifyPoint>(points: readonly T[], toleranceM: number): T[] {
  const idx = simplifyIndices(points, toleranceM);
  const out: T[] = [];
  for (const i of idx) {
    const p = points[i];
    if (p) out.push(p);
  }
  return out;
}
