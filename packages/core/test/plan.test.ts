import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '../src/constants.js';
import { buildPlan, PlanError } from '../src/plan/build.js';
import { buildRoute } from '../src/route/build.js';
import { datesSpanned } from '../src/sun/daylight.js';
import { parseLocalDateTime } from '../src/time/timezone.js';
import type { PlanSettings, SunTimes, WeatherSample } from '../src/types.js';
import { eastwardTrack, makeGpx, mPerDegLon, sampleAt, syntheticSeries } from './helpers.js';

const START_LAT = -33.9;
const START_LON = 18.4;
const distToLon = (m: number): number => START_LON + m / mPerDegLon(START_LAT);

/** A 230 km course with three checkpoints and a substantial climb, heading east. */
const { route } = buildRoute(
  makeGpx(
    eastwardTrack({
      lengthM: 230_000,
      stepM: 200,
      elevation: (d) => 500 + 400 * Math.sin((Math.PI * d) / 230_000),
    }),
    [
      { name: 'CP1 Syphonia', lat: START_LAT, lon: distToLon(54_000), desc: 'Food & drink, medic, toilet' },
      { name: 'CP2 Rietfontein', lat: START_LAT, lon: distToLon(100_000), desc: 'provisions, mechanic' },
      { name: 'CP3 Hadley', lat: START_LAT, lon: distToLon(133_000), desc: 'provisions, toilet' },
    ],
    'Test 230',
  ),
  { id: 'route-1' },
);

const startTime = parseLocalDateTime('2026-08-08T08:00', route.timezone) ?? 0;

function makeWeather(overrides: Parameters<typeof syntheticSeries>[0] extends never ? never : Partial<Parameters<typeof syntheticSeries>[0]> = {}): WeatherSample[] {
  // One series every 20 km, all sharing the same synthetic pattern unless a
  // test overrides it.
  const samples: WeatherSample[] = [];
  for (let d = 0; d <= route.totalDistance; d += 20_000) {
    samples.push(
      sampleAt(
        d,
        syntheticSeries({
          startTime: startTime - 6 * 3_600_000,
          hours: 48,
          airTemp: (h) => 10 + 8 * Math.sin((Math.PI * (h - 6)) / 24),
          windSpeed: () => 4,
          windFromDeg: () => 270, // From the west; riding east, so a tailwind.
          ...overrides,
        }),
      ),
    );
  }
  return samples;
}

const sunTimes: SunTimes[] = datesSpanned(route.timezone, startTime, startTime + 20 * 3_600_000).map(
  (date) => ({
    date,
    sunrise: Date.parse(`${date}T05:30:00Z`), // 07:30 local
    sunset: Date.parse(`${date}T16:15:00Z`), // 18:15 local
  }),
);

function settings(overrides: Partial<PlanSettings> = {}): PlanSettings {
  return {
    startTime,
    targetSpeedKmh: 21,
    rider: DEFAULT_RIDER,
    checkpoints: route.checkpoints,
    apparentTempMode: 'ambient',
    ...overrides,
  };
}

describe('buildPlan', () => {
  it('finishes at the time the target average implies', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });

    // 230 km at 21 km/h is 10 h 57 m of moving time, and with no stops set
    // that is the whole race.
    const expectedSeconds = (route.totalDistance / 1000 / 21) * 3600;
    expect(plan.summary.movingSeconds).toBeCloseTo(expectedSeconds, -1);
    expect(plan.summary.stoppedSeconds).toBe(0);
    expect(plan.summary.finishTime).toBe(startTime + plan.summary.totalSeconds * 1000);
  });

  it('pushes every later time back when a checkpoint stop is added', () => {
    const withoutStops = buildPlan({
      route,
      settings: settings(),
      weatherSamples: makeWeather(),
      sunTimes,
    });

    const stopped = route.checkpoints.map((cp) =>
      cp.name.startsWith('CP1') ? { ...cp, stopMinutes: 15 } : cp,
    );
    const withStop = buildPlan({
      route,
      settings: settings({ checkpoints: stopped }),
      weatherSamples: makeWeather(),
      sunTimes,
    });

    expect(withStop.summary.stoppedSeconds).toBe(900);
    expect(withStop.summary.movingSeconds).toBeCloseTo(withoutStops.summary.movingSeconds, 3);
    expect(withStop.summary.finishTime - withoutStops.summary.finishTime).toBe(900_000);

    // CP1 is reached at the same moment; CP2 and CP3 are fifteen minutes later.
    expect(withStop.checkpoints[0]?.arriveTime).toBe(withoutStops.checkpoints[0]?.arriveTime);
    expect((withStop.checkpoints[1]?.arriveTime ?? 0) - (withoutStops.checkpoints[1]?.arriveTime ?? 0)).toBe(900_000);
  });

  it('separates arrival from departure by the stop length', () => {
    const stopped = route.checkpoints.map((cp) => ({ ...cp, stopMinutes: 10 }));
    const plan = buildPlan({
      route,
      settings: settings({ checkpoints: stopped }),
      weatherSamples: makeWeather(),
      sunTimes,
    });

    for (const cp of plan.checkpoints) {
      expect(cp.leaveTime - cp.arriveTime).toBe(600_000);
    }
  });

  it('lays the timeline out on clock hours, starting from the off', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });

    expect(plan.hours[0]?.time).toBe(startTime);
    expect(plan.hours[0]?.dist).toBeCloseTo(0, 5);

    for (let i = 1; i < plan.hours.length; i++) {
      expect((plan.hours[i]?.time ?? 0) % 3_600_000).toBe(0);
      expect(plan.hours[i]?.time ?? 0).toBeGreaterThan(plan.hours[i - 1]?.time ?? 0);
    }
  });

  it('moves the rider further along the route as the day goes on', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });
    for (let i = 1; i < plan.samples.length; i++) {
      expect(plan.samples[i]?.dist ?? 0).toBeGreaterThanOrEqual(plan.samples[i - 1]?.dist ?? 0);
    }
    expect(plan.samples[plan.samples.length - 1]?.dist ?? 0).toBeCloseTo(route.totalDistance, -2);
  });

  it('calls a westerly a tailwind on an eastbound course', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });
    expect(plan.summary.tailwindHours).toBeGreaterThan(plan.summary.headwindHours);
    for (const h of plan.hours) expect(h.weather.windRelation).toBe('tail');
  });

  it('flips to a headwind when the wind turns', () => {
    const plan = buildPlan({
      route,
      settings: settings(),
      weatherSamples: makeWeather({ windFromDeg: () => 90 }),
      sunTimes,
    });
    expect(plan.summary.headwindHours).toBeGreaterThan(plan.summary.tailwindHours);
  });

  it('counts the hours of rain and where they fall', () => {
    const plan = buildPlan({
      route,
      settings: settings(),
      // Rain between 14:00 and 16:00 local, which is 12:00-14:00 UTC — hours
      // 12 to 14 of a series that starts six hours before an 06:00 UTC start.
      weatherSamples: makeWeather({ precipMmPerHour: (h) => (h >= 12 && h < 14 ? 2 : 0) }),
      sunTimes,
    });

    expect(plan.summary.rainHours).toBeCloseTo(2, 1);
    expect(plan.summary.totalRainMm).toBeGreaterThan(3);

    const wet = plan.samples.filter((s) => s.weather.precipMmPerHour > 0);
    expect(wet.length).toBeGreaterThan(0);
    // And the wet stretch is contiguous, not scattered.
    const firstWet = plan.samples.findIndex((s) => s.weather.precipMmPerHour > 0);
    const lastWet = plan.samples.map((s) => s.weather.precipMmPerHour > 0).lastIndexOf(true);
    expect(lastWet - firstWet + 1).toBe(wet.length);
  });

  it('works out which stretch of road is ridden in the dark', () => {
    // Start at 16:00 local so the race runs well past the 18:15 sunset.
    const lateStart = parseLocalDateTime('2026-08-08T16:00', route.timezone) ?? 0;
    const plan = buildPlan({
      route,
      settings: settings({ startTime: lateStart }),
      weatherSamples: makeWeather(),
      sunTimes: datesSpanned(route.timezone, lateStart, lateStart + 20 * 3_600_000).map((date) => ({
        date,
        sunrise: Date.parse(`${date}T05:30:00Z`),
        sunset: Date.parse(`${date}T16:15:00Z`),
      })),
    });

    expect(plan.summary.darkHours).toBeGreaterThan(6);
    expect(plan.darkSegments.length).toBeGreaterThan(0);

    const firstDark = plan.darkSegments[0];
    expect(firstDark?.fromDist ?? 0).toBeGreaterThan(0);
    expect(firstDark?.toDist ?? 0).toBeGreaterThan(firstDark?.fromDist ?? 0);
  });

  it('reports nothing dark for a race run entirely in daylight', () => {
    // At 32 km/h the 230 km takes 7h11m, finishing around 15:11 local — well
    // inside the 07:30 to 18:15 daylight these sun times describe.
    const plan = buildPlan({
      route,
      settings: settings({ targetSpeedKmh: 32 }),
      weatherSamples: makeWeather(),
      sunTimes,
    });
    expect(plan.summary.darkHours).toBe(0);
    expect(plan.darkSegments).toHaveLength(0);
  });

  it('flags a forecast that is still only 6-hourly', () => {
    const coarse = buildPlan({
      route,
      settings: settings(),
      weatherSamples: makeWeather({ coarseAfterHours: 8 }),
      sunTimes,
    });
    expect(coarse.summary.hasCoarseForecast).toBe(true);
    expect(coarse.summary.coarseAfter).not.toBeNull();

    const fine = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });
    expect(fine.summary.hasCoarseForecast).toBe(false);
    expect(fine.summary.coarseAfter).toBeNull();
  });

  it('gives a checkpoint the weather for the moment the rider gets there', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });
    for (const cp of plan.checkpoints) {
      expect(cp.weather).toBeTruthy();
      expect(Number.isFinite(cp.weather.airTemp)).toBe(true);
      expect(cp.nextLegWind).not.toBeNull();
      expect(cp.arriveTime).toBeGreaterThan(startTime);
      expect(cp.arriveTime).toBeLessThan(plan.summary.finishTime);
    }
  });

  it('reaches the checkpoints in route order', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });
    for (let i = 1; i < plan.checkpoints.length; i++) {
      expect(plan.checkpoints[i]?.arriveTime ?? 0).toBeGreaterThan(
        plan.checkpoints[i - 1]?.arriveTime ?? 0,
      );
    }
  });

  it('finishes earlier at a higher average speed', () => {
    const slow = buildPlan({
      route,
      settings: settings({ targetSpeedKmh: 18 }),
      weatherSamples: makeWeather(),
      sunTimes,
    });
    const fast = buildPlan({
      route,
      settings: settings({ targetSpeedKmh: 28 }),
      weatherSamples: makeWeather(),
      sunTimes,
    });
    expect(fast.summary.finishTime).toBeLessThan(slow.summary.finishTime);
  });

  it('records a temperature range spanning the day', () => {
    const plan = buildPlan({ route, settings: settings(), weatherSamples: makeWeather(), sunTimes });
    expect(plan.summary.maxTemp).toBeGreaterThan(plan.summary.minTemp);
    expect(plan.summary.minApparentTemp).toBeLessThan(plan.summary.minTemp);
  });

  it('refuses to plan without a forecast rather than inventing one', () => {
    expect(() => buildPlan({ route, settings: settings(), weatherSamples: [], sunTimes })).toThrow(
      PlanError,
    );
    expect(() =>
      buildPlan({
        route,
        settings: settings({ targetSpeedKmh: 0 }),
        weatherSamples: makeWeather(),
        sunTimes,
      }),
    ).toThrow(PlanError);
  });
});
