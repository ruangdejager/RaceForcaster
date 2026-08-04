import { kmhToMs } from '../weather/wind.js';
import type { Checkpoint, RiderParams, RoutePoint } from '../types.js';
import { speedForPower } from './physics.js';

export interface PacingResult {
  /** Riding speed at each route point, m/s. Parallel to `points`. */
  speedMs: number[];
  /** Cumulative moving time at each route point, seconds. */
  movingSeconds: number[];
  /** Total moving time, seconds. */
  totalMovingSeconds: number;
  /** The steady power the model settled on, watts. Informational. */
  powerW: number;
  /** How many points ran into the min/max speed clamps. */
  clampedPoints: number;
}

/** Time across one segment, integrating slowness rather than averaging speed. */
function segmentSeconds(lengthM: number, speedA: number, speedB: number): number {
  // Time is the integral of 1/v, so the trapezoid must be taken on 1/v. Using
  // the mean speed instead would understate the time over a changing gradient.
  const slowness = (1 / speedA + 1 / speedB) / 2;
  return lengthM * slowness;
}

function speedsAtPower(
  points: readonly RoutePoint[],
  powerW: number,
  rider: RiderParams,
): number[] {
  const minMs = kmhToMs(rider.minSpeedKmh);
  const maxMs = kmhToMs(rider.maxSpeedKmh);

  return points.map((p) => {
    const v = speedForPower(powerW, p.grade, rider, p.ele);
    return Math.min(maxMs, Math.max(minMs, v));
  });
}

/**
 * Every nth point, for the power search.
 *
 * The search only needs to land near the right power — the exact correction
 * afterwards does the rest — so running it over a few hundred representative
 * points instead of every one keeps dragging the speed control responsive on a
 * 2300-point route.
 */
function subsample(points: readonly RoutePoint[], target: number): RoutePoint[] {
  if (points.length <= target) return [...points];
  const stride = Math.ceil(points.length / target);
  const out: RoutePoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i];
    if (p) out.push(p);
  }
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

function totalSecondsFor(points: readonly RoutePoint[], speeds: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const vPrev = speeds[i - 1];
    const vCur = speeds[i];
    if (!prev || !cur || vPrev === undefined || vCur === undefined) continue;
    total += segmentSeconds(cur.dist - prev.dist, vPrev, vCur);
  }
  return total;
}

/**
 * Distribute a target average speed over the terrain.
 *
 * The rider sets one number — the average they intend to hold — but riding it
 * as a constant speed would put them at the wrong place at the wrong time all
 * day on a hilly course, and the whole point of the app is knowing where you
 * will be when the weather turns.
 *
 * So instead: find the steady power whose resulting speeds happen to average
 * out to the requested figure, then ride *that*. Climbs come out slow and
 * descents fast, in the proportions physics dictates, while the overall
 * average is still exactly what was asked for.
 *
 * `targetSpeedKmh` is a moving average. Checkpoint stops are added afterwards.
 */
export function computePacing(
  points: readonly RoutePoint[],
  targetSpeedKmh: number,
  rider: RiderParams,
): PacingResult {
  const empty: PacingResult = {
    speedMs: [],
    movingSeconds: [],
    totalMovingSeconds: 0,
    powerW: 0,
    clampedPoints: 0,
  };
  if (points.length < 2 || targetSpeedKmh <= 0) return empty;

  const last = points[points.length - 1];
  if (!last || last.dist <= 0) return empty;

  const targetSeconds = last.dist / kmhToMs(targetSpeedKmh);

  // Total time falls monotonically as power rises, so plain bisection on power
  // converges without needing a good initial guess.
  const probe = subsample(points, 400);
  const probeTargetSeconds = (probe[probe.length - 1]?.dist ?? 0) / kmhToMs(targetSpeedKmh);

  let loW = 1;
  let hiW = 2000;
  for (let i = 0; i < 28; i++) {
    const midW = (loW + hiW) / 2;
    if (totalSecondsFor(probe, speedsAtPower(probe, midW, rider)) > probeTargetSeconds) loW = midW;
    else hiW = midW;
  }

  const powerW = (loW + hiW) / 2;
  const minMs = kmhToMs(rider.minSpeedKmh);
  const maxMs = kmhToMs(rider.maxSpeedKmh);

  let clampedPoints = 0;
  let speeds = points.map((p) => {
    const v = speedForPower(powerW, p.grade, rider, p.ele);
    if (v < minMs || v > maxMs) clampedPoints += 1;
    return Math.min(maxMs, Math.max(minMs, v));
  });

  // Correct to the requested average exactly.
  //
  // Two things make this necessary: the power search ran on a subsample, and
  // on a course of nothing but steep descents every segment can sit against
  // the speed ceiling where no amount of power would slow the rider down. A
  // single uniform factor fixes both while preserving the shape physics gave
  // the speeds — climbs stay proportionally slow, descents proportionally
  // fast — so the number on the slider is always the number delivered.
  const achieved = totalSecondsFor(points, speeds);
  if (achieved > 0 && Math.abs(achieved - targetSeconds) / targetSeconds > 1e-9) {
    const scale = achieved / targetSeconds;
    speeds = speeds.map((v) => v * scale);
  }

  const movingSeconds = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const vPrev = speeds[i - 1];
    const vCur = speeds[i];
    const tPrev = movingSeconds[i - 1] ?? 0;
    if (!prev || !cur || vPrev === undefined || vCur === undefined) {
      movingSeconds[i] = tPrev;
      continue;
    }
    movingSeconds[i] = tPrev + segmentSeconds(cur.dist - prev.dist, vPrev, vCur);
  }

  return {
    speedMs: speeds,
    movingSeconds,
    totalMovingSeconds: movingSeconds[movingSeconds.length - 1] ?? 0,
    powerW,
    clampedPoints,
  };
}

/**
 * Stopped time accumulated before a given point on the route, seconds.
 *
 * Strictly before: arriving at a checkpoint doesn't yet include its own stop,
 * which is what makes an arrive/leave pair come out right.
 */
export function stoppedSecondsBefore(checkpoints: readonly Checkpoint[], dist: number): number {
  let total = 0;
  for (const cp of checkpoints) {
    if (cp.dist < dist) total += cp.stopMinutes * 60;
  }
  return total;
}

/** Interpolate cumulative moving time at an arbitrary distance along the route. */
export function movingSecondsAtDistance(
  points: readonly RoutePoint[],
  movingSeconds: readonly number[],
  dist: number,
): number {
  if (points.length === 0) return 0;
  const first = points[0];
  const lastPoint = points[points.length - 1];
  if (!first || !lastPoint) return 0;
  if (dist <= first.dist) return movingSeconds[0] ?? 0;
  if (dist >= lastPoint.dist) return movingSeconds[movingSeconds.length - 1] ?? 0;

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
  const ta = movingSeconds[lo];
  const tb = movingSeconds[hi];
  if (!a || !b || ta === undefined || tb === undefined) return 0;

  const span = b.dist - a.dist;
  const f = span > 0 ? (dist - a.dist) / span : 0;
  return ta + (tb - ta) * f;
}

/**
 * Distance reached at a given elapsed race time, inverting the pacing.
 *
 * Elapsed time includes checkpoint stops, so during a stop this returns the
 * checkpoint's own distance — the rider is there, not moving.
 */
export function distanceAtElapsed(
  points: readonly RoutePoint[],
  movingSeconds: readonly number[],
  checkpoints: readonly Checkpoint[],
  elapsedSeconds: number,
): number {
  if (points.length === 0) return 0;
  const lastPoint = points[points.length - 1];
  if (!lastPoint) return 0;

  // Peel off the stops that have already happened by this point in the race.
  let moving = elapsedSeconds;
  const ordered = [...checkpoints].sort((a, b) => a.dist - b.dist);
  for (const cp of ordered) {
    const cpMoving = movingSecondsAtDistance(points, movingSeconds, cp.dist);
    const stopSeconds = cp.stopMinutes * 60;
    const arriveElapsed = cpMoving + stoppedSecondsBefore(checkpoints, cp.dist);
    if (elapsedSeconds <= arriveElapsed) break;
    if (elapsedSeconds < arriveElapsed + stopSeconds) return cp.dist; // Still there.
    moving -= stopSeconds;
  }

  moving = Math.max(0, moving);
  const totalMoving = movingSeconds[movingSeconds.length - 1] ?? 0;
  if (moving >= totalMoving) return lastPoint.dist;

  let lo = 0;
  let hi = movingSeconds.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const m = movingSeconds[mid];
    if (m === undefined) break;
    if (m <= moving) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  const ta = movingSeconds[lo];
  const tb = movingSeconds[hi];
  if (!a || !b || ta === undefined || tb === undefined) return 0;

  const span = tb - ta;
  const f = span > 0 ? (moving - ta) / span : 0;
  return a.dist + (b.dist - a.dist) * f;
}
