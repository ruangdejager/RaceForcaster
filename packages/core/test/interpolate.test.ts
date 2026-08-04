import { describe, expect, it } from 'vitest';
import { TEMP_LAPSE_RATE_C_PER_M } from '../src/constants.js';
import { resolveSeriesAt, weatherAt } from '../src/weather/interpolate.js';
import { sampleAt, syntheticSeries } from './helpers.js';

const T0 = Date.parse('2026-08-08T06:00:00Z');
const HOUR = 3_600_000;

const baseOptions = {
  altitude: 100,
  travelBearing: 90,
  riderSpeedMs: 6,
  apparentMode: 'ambient' as const,
};

describe('resolveSeriesAt', () => {
  const series = syntheticSeries({
    startTime: T0,
    hours: 6,
    airTemp: (h) => 10 + h,
    precipMmPerHour: (h) => (h === 2 ? 4 : 0),
  });

  it('interpolates temperature linearly between hours', () => {
    const mid = resolveSeriesAt(series, T0 + 1.5 * HOUR);
    expect(mid?.airTemp).toBeCloseTo(11.5, 6);
  });

  it('holds precipitation across the hour it describes rather than blending it', () => {
    // precipitation_amount is a total for the hour that follows its timestamp.
    // Smearing it into the neighbouring hours would move the rain to a part of
    // the route where met.no never said it would fall.
    expect(resolveSeriesAt(series, T0 + 1.9 * HOUR)?.precipMmPerHour).toBe(0);
    expect(resolveSeriesAt(series, T0 + 2.0 * HOUR)?.precipMmPerHour).toBe(4);
    expect(resolveSeriesAt(series, T0 + 2.9 * HOUR)?.precipMmPerHour).toBe(4);
    expect(resolveSeriesAt(series, T0 + 3.0 * HOUR)?.precipMmPerHour).toBe(0);
  });

  it('clamps rather than extrapolating outside the series', () => {
    expect(resolveSeriesAt(series, T0 - 10 * HOUR)?.airTemp).toBeCloseTo(10, 6);
    expect(resolveSeriesAt(series, T0 + 100 * HOUR)?.airTemp).toBeCloseTo(15, 6);
  });

  it('returns null for an empty series', () => {
    expect(resolveSeriesAt({ ...series, points: [] }, T0)).toBeNull();
  });
});

describe('weatherAt', () => {
  it('blends temperature between two locations', () => {
    const samples = [
      sampleAt(0, syntheticSeries({ startTime: T0, hours: 12, airTemp: () => 10, altitude: 100 })),
      sampleAt(
        20_000,
        syntheticSeries({ startTime: T0, hours: 12, airTemp: () => 20, altitude: 100 }),
      ),
    ];

    const w = weatherAt(samples, 10_000, T0 + HOUR, baseOptions);
    expect(w?.airTemp).toBeCloseTo(15, 6);
  });

  it('corrects temperature for the rider being above the forecast altitude', () => {
    // Both forecasts are for sea level; the rider is on a 1000 m summit, so it
    // should read ~6.5 °C colder than the raw forecast.
    const samples = [
      sampleAt(0, syntheticSeries({ startTime: T0, hours: 12, airTemp: () => 20, altitude: 0 })),
    ];

    const w = weatherAt(samples, 0, T0 + HOUR, { ...baseOptions, altitude: 1000 });
    expect(w?.airTemp).toBeCloseTo(20 - 1000 * TEMP_LAPSE_RATE_C_PER_M, 6);
    expect(w?.airTemp).toBeCloseTo(13.5, 1);
  });

  it('blends wind through vector space, not through degrees', () => {
    const samples = [
      sampleAt(
        0,
        syntheticSeries({ startTime: T0, hours: 12, windFromDeg: () => 350, windSpeed: () => 10 }),
      ),
      sampleAt(
        20_000,
        syntheticSeries({ startTime: T0, hours: 12, windFromDeg: () => 10, windSpeed: () => 10 }),
      ),
    ];

    const w = weatherAt(samples, 10_000, T0 + HOUR, baseOptions);
    // Halfway between 350° and 10° is north, not the 180° a naive average gives.
    const deg = w?.windFromDeg ?? 0;
    expect(Math.min(deg, 360 - deg)).toBeLessThan(0.001);
  });

  it('marks a forecast as coarse once met.no stops giving hourly detail', () => {
    const samples = [
      sampleAt(0, syntheticSeries({ startTime: T0, hours: 100, coarseAfterHours: 65 })),
    ];

    expect(weatherAt(samples, 0, T0 + 10 * HOUR, baseOptions)?.resolution).toBe('1h');
    expect(weatherAt(samples, 0, T0 + 80 * HOUR, baseOptions)?.resolution).toBe('6h');
  });

  it('treats a pair as coarse if either side of it is coarse', () => {
    const samples = [
      sampleAt(0, syntheticSeries({ startTime: T0, hours: 100, coarseAfterHours: 65 })),
      sampleAt(20_000, syntheticSeries({ startTime: T0, hours: 100 })),
    ];
    expect(weatherAt(samples, 10_000, T0 + 80 * HOUR, baseOptions)?.resolution).toBe('6h');
  });

  it('resolves wind against the direction of travel', () => {
    const samples = [
      sampleAt(
        0,
        syntheticSeries({ startTime: T0, hours: 12, windFromDeg: () => 90, windSpeed: () => 10 }),
      ),
    ];

    // Riding east into a wind from the east.
    const head = weatherAt(samples, 0, T0 + HOUR, { ...baseOptions, travelBearing: 90 });
    expect(head?.windRelation).toBe('head');
    expect(head?.headwindMs).toBeCloseTo(10, 6);

    // Same wind, now riding west.
    const tail = weatherAt(samples, 0, T0 + HOUR, { ...baseOptions, travelBearing: 270 });
    expect(tail?.windRelation).toBe('tail');
    expect(tail?.headwindMs).toBeCloseTo(-10, 6);
  });

  it('feels colder in riding mode than in ambient mode when heading into wind', () => {
    const samples = [
      sampleAt(
        0,
        syntheticSeries({
          startTime: T0,
          hours: 12,
          airTemp: () => 12,
          windFromDeg: () => 90,
          windSpeed: () => 5,
        }),
      ),
    ];

    const ambient = weatherAt(samples, 0, T0 + HOUR, baseOptions);
    const riding = weatherAt(samples, 0, T0 + HOUR, { ...baseOptions, apparentMode: 'riding' });

    expect(ambient?.airTemp).toBeCloseTo(riding?.airTemp ?? 0, 6);
    expect(riding?.apparentTemp ?? 0).toBeLessThan(ambient?.apparentTemp ?? 0);
  });

  it('returns null when there are no samples', () => {
    expect(weatherAt([], 0, T0, baseOptions)).toBeNull();
  });
});
