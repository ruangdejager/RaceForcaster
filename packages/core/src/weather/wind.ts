import type { WindRelation } from '../types.js';
import { normalize180, normalize360, toDeg, toRad } from '../geo/distance.js';

export interface RelativeWind {
  /** Wind angle relative to travel, -180..180. 0 is dead-on headwind. */
  windRelativeDeg: number;
  relation: WindRelation;
  /** Component along the direction of travel, m/s. Positive opposes you. */
  headwindMs: number;
  /** Component across the direction of travel, m/s. Positive is from the right. */
  crosswindMs: number;
}

/**
 * Resolve a meteorological wind against a direction of travel.
 *
 * `windFromDeg` is the direction the wind blows *from*, which is the
 * convention met.no uses and the opposite of what a naive reading assumes.
 * A wind from 270° with a rider heading 270° is therefore a headwind, not a
 * tailwind — this is the single easiest thing to get backwards in the whole
 * application, so it has a test for each quadrant.
 */
export function relativeWind(
  windFromDeg: number,
  travelBearingDeg: number,
  windSpeedMs: number,
): RelativeWind {
  const rel = normalize180(windFromDeg - travelBearingDeg);
  const relRad = toRad(rel);

  return {
    windRelativeDeg: rel,
    relation: classifyWind(rel),
    headwindMs: windSpeedMs * Math.cos(relRad),
    crosswindMs: windSpeedMs * Math.sin(relRad),
  };
}

/** Bucket a relative wind angle into the four labels riders actually use. */
export function classifyWind(windRelativeDeg: number): WindRelation {
  const rel = normalize180(windRelativeDeg);
  const abs = Math.abs(rel);
  if (abs <= 45) return 'head';
  if (abs >= 135) return 'tail';
  return rel > 0 ? 'right' : 'left';
}

export const WIND_RELATION_LABELS: Record<WindRelation, string> = {
  head: 'headwind',
  tail: 'tailwind',
  left: 'from left',
  right: 'from right',
};

// --- Vector helpers ------------------------------------------------------

export interface WindVector {
  /** East-west component of the "from" direction. */
  u: number;
  /** North-south component of the "from" direction. */
  v: number;
}

/**
 * Wind as a vector.
 *
 * Every average or interpolation of wind direction must go through here.
 * Averaging degrees directly is wrong in a way that looks fine until it
 * isn't: the mean of 350° and 10° is 180°, the exact opposite of north.
 */
export function toVector(windFromDeg: number, windSpeedMs: number): WindVector {
  const rad = toRad(windFromDeg);
  return { u: windSpeedMs * Math.sin(rad), v: windSpeedMs * Math.cos(rad) };
}

export function fromVector(vec: WindVector): { windFromDeg: number; windSpeedMs: number } {
  const windSpeedMs = Math.hypot(vec.u, vec.v);
  // A dead calm has no direction; report north rather than a NaN from atan2.
  if (windSpeedMs < 1e-9) return { windFromDeg: 0, windSpeedMs: 0 };
  return { windFromDeg: normalize360(toDeg(Math.atan2(vec.u, vec.v))), windSpeedMs };
}

/** Linear blend of two winds, done in vector space. */
export function lerpWind(
  a: { windFromDeg: number; windSpeed: number },
  b: { windFromDeg: number; windSpeed: number },
  f: number,
): { windFromDeg: number; windSpeed: number } {
  const va = toVector(a.windFromDeg, a.windSpeed);
  const vb = toVector(b.windFromDeg, b.windSpeed);
  const blended = fromVector({
    u: va.u + (vb.u - va.u) * f,
    v: va.v + (vb.v - va.v) * f,
  });
  return { windFromDeg: blended.windFromDeg, windSpeed: blended.windSpeedMs };
}

export const msToKmh = (ms: number): number => ms * 3.6;
export const kmhToMs = (kmh: number): number => kmh / 3.6;
