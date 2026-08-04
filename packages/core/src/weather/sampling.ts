import { MAX_WEATHER_SAMPLES, WEATHER_SAMPLE_SPACING_M } from '../constants.js';
import { pointAtDistance } from '../geo/resample.js';
import type { Checkpoint, Route } from '../types.js';

export interface SampleLocation {
  /** Distance along the route, metres. */
  dist: number;
  lat: number;
  lon: number;
  /** Metres above sea level, rounded — met.no takes an integer. */
  altitude: number;
}

/**
 * Decide where along the route to ask for a forecast.
 *
 * Two competing pressures: met.no asks that we not hammer them, and weather
 * genuinely differs across 230 km. The compromise is a point roughly every
 * 15 km, which leaves the rider never more than 7.5 km from real data, plus a
 * point at every checkpoint because those are the places the rider will study
 * most closely.
 */
export function chooseSampleLocations(
  route: Route,
  checkpoints: readonly Checkpoint[] = route.checkpoints,
): SampleLocation[] {
  const total = route.totalDistance;
  if (total <= 0 || route.points.length === 0) return [];

  const checkpointDists = new Set(
    checkpoints.filter((c) => c.dist > 0 && c.dist < total).map((c) => c.dist),
  );

  const build = (minGapM: number): number[] => {
    const candidates = [0, total, ...checkpointDists];
    for (let d = WEATHER_SAMPLE_SPACING_M; d < total; d += WEATHER_SAMPLE_SPACING_M) {
      candidates.push(d);
    }
    candidates.sort((a, b) => a - b);

    const accepted: number[] = [];
    for (const d of candidates) {
      const prev = accepted[accepted.length - 1];
      if (prev === undefined) {
        accepted.push(d);
        continue;
      }
      if (d - prev >= minGapM) {
        accepted.push(d);
        continue;
      }
      // Too close to the one before. Keep whichever is a checkpoint, since
      // those are the points the rider will actually study.
      if (checkpointDists.has(d) && !checkpointDists.has(prev) && accepted.length > 1) {
        accepted[accepted.length - 1] = d;
      }
    }

    // The finish must always be sampled, even if it merged into a neighbour.
    if (accepted[accepted.length - 1] !== total) {
      if (accepted.length > 1) accepted[accepted.length - 1] = total;
      else accepted.push(total);
    }

    // Absorbing a grid point into a nearby checkpoint, or pulling the last one
    // out to the finish, can leave a gap wider than the spacing we promised.
    // Put a point back in the middle of any that opened up, so the guarantee
    // that no rider position is far from real data actually holds.
    const maxGapM = minGapM * 3;
    const filled: number[] = [];
    for (const d of accepted) {
      const prev = filled[filled.length - 1];
      if (prev !== undefined && d - prev > maxGapM) {
        const inserts = Math.ceil((d - prev) / maxGapM) - 1;
        for (let k = 1; k <= inserts; k++) filled.push(prev + ((d - prev) * k) / (inserts + 1));
      }
      filled.push(d);
    }
    return filled;
  };

  // Widen the merge gap until we're under the request ceiling. Long routes
  // simply get coarser spatial resolution rather than a flood of requests.
  let minGap = WEATHER_SAMPLE_SPACING_M / 3;
  let dists = build(minGap);
  while (dists.length > MAX_WEATHER_SAMPLES && minGap < total) {
    minGap *= 1.5;
    dists = build(minGap);
  }

  return dists.map((dist) => {
    const p = pointAtDistance(route.points, dist);
    return { dist, lat: p.lat, lon: p.lon, altitude: Math.round(p.ele) };
  });
}

/**
 * met.no asks for coordinates truncated to four decimals — about 11 m, well
 * inside the model's ~1 km resolution. Doing it here rather than at the HTTP
 * layer means our cache keys collapse the same way theirs do.
 */
export function roundCoord(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
