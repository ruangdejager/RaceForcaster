import {
  buildPlan,
  chooseSampleLocations,
  datesSpanned,
  offsetString,
  parseMetForecast,
  pointAtDistance,
  zonedWallClockToUtc,
  type MetForecastResponse,
  type PlanSettings,
  type RacePlan,
  type Route,
  type SunTimes,
  type WeatherSample,
} from '@raceforecaster/core';
import type { MetClient } from '../met/client.js';

export interface PlanBundle {
  plan: RacePlan;
  /**
   * The raw forecast series the plan was built from, returned so the browser
   * can rerun the same core code locally. That's what makes dragging the speed
   * control feel instant: no request, no round trip, identical arithmetic.
   */
  weather: WeatherSample[];
  sun: SunTimes[];
}

/** Fetch a forecast for every sampled point on the route, in parallel. */
export async function gatherWeather(
  route: Route,
  settings: PlanSettings,
  met: MetClient,
): Promise<WeatherSample[]> {
  const locations = chooseSampleLocations(route, settings.checkpoints);

  const results = await Promise.all(
    locations.map(async (loc) => {
      const body = await met.forecast(loc.lat, loc.lon, loc.altitude);
      const series = parseMetForecast(JSON.parse(body) as MetForecastResponse, {
        lat: loc.lat,
        lon: loc.lon,
        altitude: loc.altitude,
      });
      return {
        dist: loc.dist,
        lat: loc.lat,
        lon: loc.lon,
        altitude: loc.altitude,
        series,
      } satisfies WeatherSample;
    }),
  );

  return results.sort((a, b) => a.dist - b.dist);
}

/**
 * Sunrise and sunset for every date the race touches.
 *
 * Queried once per date at the middle of the route rather than per position.
 * Sunset moves by about four minutes per degree of longitude, so on a 230 km
 * course the midpoint keeps the error to a few minutes at either end — far
 * inside the precision anyone plans lights to, and it costs one request a day
 * instead of one per checkpoint.
 */
export async function gatherSun(
  route: Route,
  startTime: number,
  endTime: number,
  met: MetClient,
): Promise<SunTimes[]> {
  const mid = pointAtDistance(route.points, route.totalDistance / 2);
  const dates = datesSpanned(route.timezone, startTime, endTime);

  return Promise.all(
    dates.map(async (date) => {
      const [y, m, d] = date.split('-').map(Number);
      // Ask for the offset in force at local noon that day, which is
      // unambiguous even on a date with a DST transition.
      const noon = zonedWallClockToUtc(route.timezone, y ?? 1970, m ?? 1, d ?? 1, 12);
      const offset = offsetString(route.timezone, noon);
      const { sunrise, sunset } = await met.sun(mid.lat, mid.lon, date, offset);
      return { date, sunrise, sunset } satisfies SunTimes;
    }),
  );
}

/** Fetch everything a plan needs, then compute it. */
export async function computePlan(
  route: Route,
  settings: PlanSettings,
  met: MetClient,
): Promise<PlanBundle> {
  // Moving time is distance over the target average by construction, so the
  // finish can be estimated exactly before any weather is fetched — which is
  // what tells us which dates to ask the sun API about.
  const movingSeconds = (route.totalDistance / 1000 / settings.targetSpeedKmh) * 3600;
  const stopSeconds = settings.checkpoints.reduce((sum, cp) => sum + cp.stopMinutes * 60, 0);
  const estimatedFinish = settings.startTime + (movingSeconds + stopSeconds) * 1000;

  const [weather, sun] = await Promise.all([
    gatherWeather(route, settings, met),
    gatherSun(route, settings.startTime, estimatedFinish, met),
  ]);

  const plan = buildPlan({ route, settings, weatherSamples: weather, sunTimes: sun });
  return { plan, weather, sun };
}
