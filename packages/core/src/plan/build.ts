import { RAIN_THRESHOLD_MM_PER_H, SAMPLE_INTERVAL_MIN } from '../constants.js';
import {
  computePacing,
  distanceAtElapsed,
  movingSecondsAtDistance,
  stoppedSecondsBefore,
} from '../pacing/model.js';
import { createDaylightLookup, darkHours, toDarkSegments } from '../sun/daylight.js';
import type {
  Checkpoint,
  PlanCheckpoint,
  PlanSample,
  PlanSettings,
  PlanSummary,
  RacePlan,
  Route,
  RoutePoint,
  SunTimes,
  WeatherSample,
  WindRelation,
} from '../types.js';
import { weatherAt } from '../weather/interpolate.js';
import { msToKmh } from '../weather/wind.js';

export interface BuildPlanInput {
  route: Route;
  settings: PlanSettings;
  /** One entry per sampled location, ascending by distance. */
  weatherSamples: readonly WeatherSample[];
  sunTimes: readonly SunTimes[];
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Nearest route point to a distance.
 *
 * Bearing is deliberately taken from a single point rather than interpolated:
 * angles don't blend linearly (halfway between 350° and 10° is 0°, not 180°),
 * and at 100 m spacing there is nothing to gain by trying.
 */
function nearestRoutePoint(points: readonly RoutePoint[], dist: number, spacingM: number): RoutePoint | null {
  if (points.length === 0) return null;
  const idx = Math.max(0, Math.min(points.length - 1, Math.round(dist / spacingM)));
  return points[idx] ?? points[points.length - 1] ?? null;
}

interface SampleContext {
  route: Route;
  settings: PlanSettings;
  weatherSamples: readonly WeatherSample[];
  speedMs: readonly number[];
  movingSeconds: readonly number[];
  checkpoints: readonly Checkpoint[];
  spacingM: number;
  isDark: (time: number) => boolean;
}

/** Build one row of the plan for a given instant. */
function sampleAt(ctx: SampleContext, time: number): PlanSample | null {
  const elapsed = (time - ctx.settings.startTime) / 1000;
  const dist = distanceAtElapsed(ctx.route.points, ctx.movingSeconds, ctx.checkpoints, elapsed);
  const point = nearestRoutePoint(ctx.route.points, dist, ctx.spacingM);
  if (!point) return null;

  const idx = Math.max(0, Math.min(ctx.speedMs.length - 1, Math.round(dist / ctx.spacingM)));
  const speedMs = ctx.speedMs[idx] ?? 0;

  const weather = weatherAt(ctx.weatherSamples, dist, time, {
    altitude: point.ele,
    travelBearing: point.bearing,
    riderSpeedMs: speedMs,
    apparentMode: ctx.settings.apparentTempMode,
  });
  if (!weather) return null;

  return {
    time,
    dist,
    lat: point.lat,
    lon: point.lon,
    ele: point.ele,
    bearing: point.bearing,
    grade: point.grade,
    speedKmh: msToKmh(speedMs),
    weather,
    isDark: ctx.isDark(time),
  };
}

/** The dominant wind relation over a stretch of the route. */
function dominantRelation(samples: readonly PlanSample[]): WindRelation | null {
  if (samples.length === 0) return null;
  const tally: Record<WindRelation, number> = { head: 0, tail: 0, left: 0, right: 0 };
  for (const s of samples) tally[s.weather.windRelation] += 1;

  let best: WindRelation = 'head';
  let bestCount = -1;
  for (const key of Object.keys(tally) as WindRelation[]) {
    if (tally[key] > bestCount) {
      bestCount = tally[key];
      best = key;
    }
  }
  return best;
}

export function buildPlan(input: BuildPlanInput): RacePlan {
  const { route, settings, weatherSamples, sunTimes } = input;

  if (route.points.length < 2) throw new PlanError('The route has too few points to plan.');
  if (weatherSamples.length === 0) throw new PlanError('No forecast data available for this route.');
  if (settings.targetSpeedKmh <= 0) throw new PlanError('Average speed must be greater than zero.');

  const spacingM =
    route.points.length > 1 ? (route.points[1]?.dist ?? 100) - (route.points[0]?.dist ?? 0) : 100;

  const checkpoints = [...settings.checkpoints].sort((a, b) => a.dist - b.dist);
  const pacing = computePacing(route.points, settings.targetSpeedKmh, settings.rider);

  const stoppedSeconds = checkpoints.reduce((sum, cp) => sum + cp.stopMinutes * 60, 0);
  const totalSeconds = pacing.totalMovingSeconds + stoppedSeconds;
  const finishTime = settings.startTime + totalSeconds * 1000;

  const daylight = createDaylightLookup(sunTimes, route.timezone);

  const ctx: SampleContext = {
    route,
    settings,
    weatherSamples,
    speedMs: pacing.speedMs,
    movingSeconds: pacing.movingSeconds,
    checkpoints,
    spacingM,
    isDark: (t) => daylight.isDark(t),
  };

  // --- Fine-grained series for the charts ---------------------------------
  const samples: PlanSample[] = [];
  const step = SAMPLE_INTERVAL_MIN * MINUTE_MS;
  for (let t = settings.startTime; t < finishTime; t += step) {
    const s = sampleAt(ctx, t);
    if (s) samples.push(s);
  }
  const finishSample = sampleAt(ctx, finishTime);
  if (finishSample) samples.push(finishSample);

  // --- Timeline rows: the start, then every clock hour it passes ----------
  const hours: PlanSample[] = [];
  const startSample = samples[0] ?? sampleAt(ctx, settings.startTime);
  if (startSample) hours.push(startSample);

  const firstHour = Math.ceil(settings.startTime / HOUR_MS) * HOUR_MS;
  for (let t = firstHour; t <= finishTime; t += HOUR_MS) {
    // Skip a clock hour that coincides with the start, so the timeline doesn't
    // open with the same moment twice.
    if (t === settings.startTime) continue;
    const s = sampleAt(ctx, t);
    if (s) hours.push(s);
  }

  // --- Checkpoints ---------------------------------------------------------
  const planCheckpoints: PlanCheckpoint[] = [];
  for (const cp of checkpoints) {
    const moving = movingSecondsAtDistance(route.points, pacing.movingSeconds, cp.dist);
    const elapsedSeconds = moving + stoppedSecondsBefore(checkpoints, cp.dist);
    const arriveTime = settings.startTime + elapsedSeconds * 1000;
    const leaveTime = arriveTime + cp.stopMinutes * MINUTE_MS;

    const point = nearestRoutePoint(route.points, cp.dist, spacingM);
    const idx = Math.max(0, Math.min(pacing.speedMs.length - 1, Math.round(cp.dist / spacingM)));
    const speedMs = pacing.speedMs[idx] ?? 0;

    const weather = weatherAt(weatherSamples, cp.dist, arriveTime, {
      altitude: cp.ele,
      travelBearing: point?.bearing ?? 0,
      riderSpeedMs: speedMs,
      apparentMode: settings.apparentTempMode,
    });
    if (!weather) continue;

    // Wind over the leg that follows, which is what the rider is about to ride
    // into and the thing worth knowing while standing at the checkpoint.
    const nextCp = checkpoints.find((c) => c.dist > cp.dist);
    const legEnd = nextCp?.dist ?? route.totalDistance;
    const legSamples = samples.filter((s) => s.dist >= cp.dist && s.dist <= legEnd);

    planCheckpoints.push({
      checkpoint: cp,
      arriveTime,
      leaveTime,
      elapsedSeconds,
      weather,
      isDark: daylight.isDark(arriveTime),
      nextLegWind: dominantRelation(legSamples),
    });
  }

  // --- Summary -------------------------------------------------------------
  const darkSegments = toDarkSegments(
    samples.map((s) => ({ time: s.time, dist: s.dist, isDark: s.isDark })),
  );

  const sampleHours = SAMPLE_INTERVAL_MIN / 60;
  let minTemp = Number.POSITIVE_INFINITY;
  let maxTemp = Number.NEGATIVE_INFINITY;
  let minApparentTemp = Number.POSITIVE_INFINITY;
  let maxApparentTemp = Number.NEGATIVE_INFINITY;
  let rainSamples = 0;
  let totalRainMm = 0;
  let headSamples = 0;
  let tailSamples = 0;
  let coarseAfter: number | null = null;

  for (const s of samples) {
    const w = s.weather;
    if (w.airTemp < minTemp) minTemp = w.airTemp;
    if (w.airTemp > maxTemp) maxTemp = w.airTemp;
    if (w.apparentTemp < minApparentTemp) minApparentTemp = w.apparentTemp;
    if (w.apparentTemp > maxApparentTemp) maxApparentTemp = w.apparentTemp;
    if (w.precipMmPerHour >= RAIN_THRESHOLD_MM_PER_H) {
      rainSamples += 1;
      totalRainMm += w.precipMmPerHour * sampleHours;
    }
    if (w.windRelation === 'head') headSamples += 1;
    if (w.windRelation === 'tail') tailSamples += 1;
    if (w.resolution === '6h' && coarseAfter === null) coarseAfter = s.time;
  }

  if (!Number.isFinite(minTemp)) {
    minTemp = 0;
    maxTemp = 0;
    minApparentTemp = 0;
    maxApparentTemp = 0;
  }

  const summary: PlanSummary = {
    finishTime,
    movingSeconds: pacing.totalMovingSeconds,
    stoppedSeconds,
    totalSeconds,
    minTemp,
    maxTemp,
    minApparentTemp,
    maxApparentTemp,
    rainHours: rainSamples * sampleHours,
    totalRainMm,
    darkHours: darkHours(darkSegments),
    totalStopMinutes: stoppedSeconds / 60,
    hasCoarseForecast: coarseAfter !== null,
    coarseAfter,
    headwindHours: headSamples * sampleHours,
    tailwindHours: tailSamples * sampleHours,
  };

  return {
    routeId: route.id,
    routeName: route.name,
    generatedAt: Date.now(),
    timezone: route.timezone,
    startTime: settings.startTime,
    totalDistance: route.totalDistance,
    totalAscent: route.totalAscent,
    settings,
    samples,
    hours,
    checkpoints: planCheckpoints,
    darkSegments,
    summary,
  };
}
