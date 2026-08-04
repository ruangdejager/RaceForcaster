import { TEMP_LAPSE_RATE_C_PER_M } from '../constants.js';
import { compassPoint } from '../geo/distance.js';
import type {
  ApparentTempMode,
  ForecastResolution,
  ForecastSeries,
  WeatherAt,
  WeatherSample,
} from '../types.js';
import { apparentTemperature, riderAirspeedMs } from './apparent.js';
import { fromVector, relativeWind, toVector, type WindVector } from './wind.js';

/** A forecast resolved to one instant, before it's tied to a direction of travel. */
interface ResolvedForecast {
  airTemp: number;
  relHumidity: number;
  wind: WindVector;
  cloudPct: number;
  precipMmPerHour: number;
  symbolCode: string | null;
  resolution: ForecastResolution;
}

/** Index of the last entry at or before `t`, or -1 if `t` precedes them all. */
function floorIndex(points: ReadonlyArray<{ t: number }>, t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = points[mid];
    if (!p) break;
    if (p.t <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Resolve one forecast series to an instant.
 *
 * Instantaneous quantities (temperature, wind, humidity, cloud) interpolate
 * linearly between the entries either side. Interval quantities do not:
 * `precipitation_amount` and `symbol_code` describe *the hour that follows*
 * their timestamp, so they're held constant across that hour. Blending them
 * would smear a sharp shower backwards into the dry hour before it and lose
 * exactly the detail the rider opened the app for.
 */
export function resolveSeriesAt(series: ForecastSeries, time: number): ResolvedForecast | null {
  const pts = series.points;
  if (pts.length === 0) return null;

  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return null;

  const build = (
    scalarSource: { airTemp: number; relHumidity: number; cloudPct: number },
    wind: WindVector,
    intervalSource: {
      precipMmPerHour: number;
      symbolCode: string | null;
      resolution: ForecastResolution;
    },
  ): ResolvedForecast => ({
    airTemp: scalarSource.airTemp,
    relHumidity: scalarSource.relHumidity,
    wind,
    cloudPct: scalarSource.cloudPct,
    precipMmPerHour: intervalSource.precipMmPerHour,
    symbolCode: intervalSource.symbolCode,
    resolution: intervalSource.resolution,
  });

  if (time <= first.t) return build(first, toVector(first.windFromDeg, first.windSpeed), first);
  if (time >= last.t) return build(last, toVector(last.windFromDeg, last.windSpeed), last);

  const i = floorIndex(pts, time);
  const a = pts[Math.max(0, i)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  if (!a || !b) return null;

  const span = b.t - a.t;
  const f = span > 0 ? (time - a.t) / span : 0;

  const va = toVector(a.windFromDeg, a.windSpeed);
  const vb = toVector(b.windFromDeg, b.windSpeed);

  return build(
    {
      airTemp: a.airTemp + (b.airTemp - a.airTemp) * f,
      relHumidity: a.relHumidity + (b.relHumidity - a.relHumidity) * f,
      cloudPct: a.cloudPct + (b.cloudPct - a.cloudPct) * f,
    },
    { u: va.u + (vb.u - va.u) * f, v: va.v + (vb.v - va.v) * f },
    // Interval values come from the entry whose hour we are inside.
    a,
  );
}

export interface WeatherAtOptions {
  /** Rider's actual altitude, metres. Drives the lapse-rate correction. */
  altitude: number;
  /** Direction of travel, degrees true. */
  travelBearing: number;
  /** Rider's speed, m/s. Only used when `apparentMode` is 'riding'. */
  riderSpeedMs: number;
  apparentMode: ApparentTempMode;
}

/** Bracketing sample indices for a distance along the route, with a weight. */
function bracketByDistance(
  samples: readonly WeatherSample[],
  dist: number,
): { a: WeatherSample; b: WeatherSample; f: number } | null {
  if (samples.length === 0) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  if (samples.length === 1 || dist <= first.dist) return { a: first, b: first, f: 0 };
  if (dist >= last.dist) return { a: last, b: last, f: 0 };

  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const m = samples[mid];
    if (!m) break;
    if (m.dist <= dist) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  if (!a || !b) return { a: first, b: first, f: 0 };

  const span = b.dist - a.dist;
  return { a, b, f: span > 0 ? (dist - a.dist) / span : 0 };
}

/**
 * The conditions at one point on the route at one moment: interpolated across
 * the two nearest forecast locations, then across the two nearest forecast
 * hours, then corrected for altitude and resolved against the direction the
 * rider is travelling.
 */
export function weatherAt(
  samples: readonly WeatherSample[],
  dist: number,
  time: number,
  options: WeatherAtOptions,
): WeatherAt | null {
  const bracket = bracketByDistance(samples, dist);
  if (!bracket) return null;

  const ra = resolveSeriesAt(bracket.a.series, time);
  const rb = bracket.a === bracket.b ? ra : resolveSeriesAt(bracket.b.series, time);
  if (!ra || !rb) return null;

  const f = bracket.f;
  const blend = (x: number, y: number): number => x + (y - x) * f;

  const airTempRaw = blend(ra.airTemp, rb.airTemp);
  const relHumidity = blend(ra.relHumidity, rb.relHumidity);
  const cloudPct = blend(ra.cloudPct, rb.cloudPct);
  const precipMmPerHour = blend(ra.precipMmPerHour, rb.precipMmPerHour);
  const sampleAltitude = blend(bracket.a.altitude, bracket.b.altitude);

  const { windFromDeg, windSpeedMs } = fromVector({
    u: blend(ra.wind.u, rb.wind.u),
    v: blend(ra.wind.v, rb.wind.v),
  });

  // A forecast is issued for the altitude it was requested at. Where the rider
  // is higher than that — the top of a climb between two valley sample points —
  // it will genuinely be colder, by roughly 6.5 °C per kilometre of altitude.
  const airTemp = airTempRaw + (sampleAltitude - options.altitude) * TEMP_LAPSE_RATE_C_PER_M;

  const rel = relativeWind(windFromDeg, options.travelBearing, windSpeedMs);

  const effectiveWindMs =
    options.apparentMode === 'riding'
      ? riderAirspeedMs(rel.headwindMs, rel.crosswindMs, options.riderSpeedMs)
      : windSpeedMs;

  // Symbols and resolution can't be averaged, so take them from the nearer of
  // the two sample points rather than inventing an in-between.
  const nearer = f < 0.5 ? ra : rb;
  const resolution: ForecastResolution =
    ra.resolution === '6h' || rb.resolution === '6h' ? '6h' : '1h';

  return {
    airTemp,
    apparentTemp: apparentTemperature(airTemp, relHumidity, effectiveWindMs),
    relHumidity,
    windSpeed: windSpeedMs,
    windFromDeg,
    windFromCompass: compassPoint(windFromDeg),
    windRelativeDeg: rel.windRelativeDeg,
    windRelation: rel.relation,
    headwindMs: rel.headwindMs,
    crosswindMs: rel.crosswindMs,
    cloudPct,
    precipMmPerHour,
    symbolCode: nearer.symbolCode,
    resolution,
  };
}
