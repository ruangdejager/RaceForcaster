import type { ForecastPoint, ForecastSeries, WeatherSample } from '../src/types.js';

/**
 * Metres per degree of longitude at a given latitude, derived from the same
 * mean Earth radius the haversine uses. Anything else and a track built to be
 * "exactly 10 km" measures as something slightly different, and every distance
 * assertion picks up a spurious tolerance.
 */
export const mPerDegLon = (lat: number): number =>
  6371008.8 * (Math.PI / 180) * Math.cos((lat * Math.PI) / 180);

export interface SyntheticTrackOptions {
  startLat?: number;
  startLon?: number;
  /** Total length, metres. */
  lengthM: number;
  /** Distance between generated points, metres. */
  stepM?: number;
  /** Elevation as a function of distance along the route, metres. */
  elevation?: (dist: number) => number;
}

export interface SyntheticPoint {
  lat: number;
  lon: number;
  ele: number;
}

/** A track running due east, so the direction of travel is a known 90°. */
export function eastwardTrack(options: SyntheticTrackOptions): SyntheticPoint[] {
  const {
    startLat = -33.9,
    startLon = 18.4,
    lengthM,
    stepM = 50,
    elevation = () => 100,
  } = options;

  const perDeg = mPerDegLon(startLat);
  const points: SyntheticPoint[] = [];
  const at = (d: number): SyntheticPoint => ({
    lat: startLat,
    lon: startLon + d / perDeg,
    ele: elevation(d),
  });

  for (let d = 0; d < lengthM; d += stepM) points.push(at(d));
  // Always finish on the requested length, whether or not it divides evenly by
  // the step, so a track asked for as 10 km really is 10 km.
  points.push(at(lengthM));
  return points;
}

export interface GpxWaypoint {
  name: string;
  lat: number;
  lon: number;
  ele?: number;
  desc?: string;
}

/** Serialise points and waypoints into a minimal but valid GPX document. */
export function makeGpx(
  points: readonly SyntheticPoint[],
  waypoints: readonly GpxWaypoint[] = [],
  name = 'Test Route',
): string {
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat}" lon="${w.lon}">` +
        `<name>${w.name}</name>` +
        (w.ele !== undefined ? `<ele>${w.ele}</ele>` : '') +
        (w.desc ? `<desc>${w.desc}</desc>` : '') +
        `</wpt>`,
    )
    .join('\n');

  const trkpts = points
    .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export interface SyntheticForecastOptions {
  /** Epoch ms of the first hourly entry. */
  startTime: number;
  hours: number;
  lat?: number;
  lon?: number;
  altitude?: number;
  airTemp?: (hour: number) => number;
  windSpeed?: (hour: number) => number;
  windFromDeg?: (hour: number) => number;
  relHumidity?: (hour: number) => number;
  precipMmPerHour?: (hour: number) => number;
  /** Hours from the start after which entries are marked 6-hourly. */
  coarseAfterHours?: number;
}

/** A forecast series with fully controlled values, for deterministic tests. */
export function syntheticSeries(options: SyntheticForecastOptions): ForecastSeries {
  const {
    startTime,
    hours,
    lat = -33.9,
    lon = 18.4,
    altitude = 100,
    airTemp = () => 15,
    windSpeed = () => 5,
    windFromDeg = () => 270,
    relHumidity = () => 60,
    precipMmPerHour = () => 0,
    coarseAfterHours = Number.POSITIVE_INFINITY,
  } = options;

  const points: ForecastPoint[] = [];
  for (let h = 0; h < hours; h++) {
    points.push({
      t: startTime + h * 3_600_000,
      airTemp: airTemp(h),
      relHumidity: relHumidity(h),
      dewPoint: null,
      windSpeed: windSpeed(h),
      windFromDeg: windFromDeg(h),
      cloudPct: 50,
      fogPct: 0,
      uvIndex: null,
      pressure: 1013,
      precipMmPerHour: precipMmPerHour(h),
      symbolCode: 'cloudy',
      resolution: h >= coarseAfterHours ? '6h' : '1h',
    });
  }

  return { lat, lon, altitude, points, fetchedAt: startTime };
}

/** Wrap a series as a weather sample pinned to a distance along the route. */
export function sampleAt(dist: number, series: ForecastSeries): WeatherSample {
  return { dist, lat: series.lat, lon: series.lon, altitude: series.altitude, series };
}
