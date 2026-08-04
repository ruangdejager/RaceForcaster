import type { LatLon } from '../types.js';

/** IUGG mean Earth radius, metres. */
const EARTH_RADIUS_M = 6371008.8;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Wrap to [0, 360). */
export function normalize360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Wrap to (-180, 180]. */
export function normalize180(deg: number): number {
  return normalize360(deg + 180) - 180;
}

/**
 * Great-circle distance in metres. Haversine is accurate to a few parts in
 * 10,000 over the short hops between track points, which is far below GPS
 * noise, and it has none of Vincenty's convergence failure modes.
 */
export function haversineMetres(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);

  const h =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bearing from `a` to `b`, degrees clockwise from true north, in [0, 360). */
export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lon - a.lon);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalize360(toDeg(Math.atan2(y, x)));
}

/**
 * Point a fraction `f` of the way from `a` to `b`.
 *
 * Linear rather than great-circle: track points are metres apart, where the
 * two agree to well under a millimetre, and staying linear keeps resampling
 * cheap for the tens of thousands of points a long GPX contains.
 */
export function lerpLatLon(a: LatLon, b: LatLon, f: number): LatLon {
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
  };
}

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** 16-point compass abbreviation, e.g. 337.5° -> "NNW". */
export function compassPoint(deg: number): string {
  const i = Math.round(normalize360(deg) / 22.5) % 16;
  return COMPASS_16[i] ?? 'N';
}

/**
 * Shortest signed angle from `from` to `to`, in (-180, 180].
 * Positive means `to` is clockwise of `from`.
 */
export function angleDelta(from: number, to: number): number {
  return normalize180(to - from);
}
