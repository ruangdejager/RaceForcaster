import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coarseAfter, MetParseError, parseMetForecast } from '../src/weather/met.js';
import { describeSymbol } from '../src/weather/symbol.js';
import type { MetForecastResponse } from '../src/weather/met.js';

// A real response recorded from api.met.no, so the parser is tested against
// what the service actually sends rather than what we assume it sends.
const fixturePath = fileURLToPath(new URL('./fixtures/met-complete.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as MetForecastResponse;

describe('parseMetForecast', () => {
  const series = parseMetForecast(fixture, { lat: -33.9249, lon: 18.4241, altitude: 25 });

  it('reads every usable entry', () => {
    expect(series.points.length).toBeGreaterThan(80);
  });

  it('keeps the series sorted in time', () => {
    for (let i = 1; i < series.points.length; i++) {
      expect(series.points[i]?.t ?? 0).toBeGreaterThan(series.points[i - 1]?.t ?? 0);
    }
  });

  it('extracts physically sane values', () => {
    for (const p of series.points) {
      expect(p.airTemp).toBeGreaterThan(-60);
      expect(p.airTemp).toBeLessThan(60);
      expect(p.windSpeed).toBeGreaterThanOrEqual(0);
      expect(p.windFromDeg).toBeGreaterThanOrEqual(0);
      expect(p.windFromDeg).toBeLessThanOrEqual(360);
      expect(p.relHumidity).toBeGreaterThanOrEqual(0);
      expect(p.relHumidity).toBeLessThanOrEqual(100);
      expect(p.precipMmPerHour).toBeGreaterThanOrEqual(0);
    }
  });

  it('finds hourly detail up front and coarse blocks later', () => {
    // met.no publishes hour-by-hour for roughly 65 hours, then 6-hour blocks.
    const fine = series.points.filter((p) => p.resolution === '1h');
    const coarse = series.points.filter((p) => p.resolution === '6h');
    expect(fine.length).toBeGreaterThan(50);
    expect(coarse.length).toBeGreaterThan(10);

    // And the split is a clean boundary, not interleaved.
    const firstCoarse = series.points.findIndex((p) => p.resolution === '6h');
    expect(series.points.slice(firstCoarse).every((p) => p.resolution === '6h')).toBe(true);
  });

  it('divides a six-hour rainfall total down to an hourly rate', () => {
    const coarse = series.points.filter((p) => p.resolution === '6h');
    // Whatever the values are, none should look like an undivided 6h total.
    for (const p of coarse) expect(p.precipMmPerHour).toBeLessThan(50);
  });

  it('reports where the forecast turns coarse', () => {
    const boundary = coarseAfter(series);
    expect(boundary).not.toBeNull();
    const hoursOut = ((boundary ?? 0) - (series.points[0]?.t ?? 0)) / 3_600_000;
    expect(hoursOut).toBeGreaterThan(48);
    expect(hoursOut).toBeLessThan(80);
  });

  it('carries a symbol code on the hourly entries', () => {
    const withSymbol = series.points.filter((p) => p.symbolCode !== null);
    expect(withSymbol.length).toBeGreaterThan(series.points.length - 3);
  });

  it('rejects a response with no timeseries', () => {
    expect(() => parseMetForecast({}, { lat: 0, lon: 0, altitude: 0 })).toThrow(MetParseError);
    expect(() =>
      parseMetForecast({ properties: { timeseries: [] } }, { lat: 0, lon: 0, altitude: 0 }),
    ).toThrow(MetParseError);
  });

  it('skips entries missing the values it needs rather than emitting NaN', () => {
    const partial: MetForecastResponse = {
      properties: {
        timeseries: [
          { time: '2026-08-08T06:00:00Z', data: { instant: { details: {} } } },
          {
            time: '2026-08-08T07:00:00Z',
            data: {
              instant: {
                details: { air_temperature: 12, wind_speed: 3, wind_from_direction: 180 },
              },
            },
          },
        ],
      },
    };
    const parsed = parseMetForecast(partial, { lat: 0, lon: 0, altitude: 0 });
    expect(parsed.points).toHaveLength(1);
    expect(parsed.points[0]?.airTemp).toBe(12);
  });
});

describe('describeSymbol', () => {
  it('reads the day and night variants of a code', () => {
    expect(describeSymbol('clearsky_day')).toMatchObject({ label: 'Sunny', variant: 'day' });
    expect(describeSymbol('clearsky_night')).toMatchObject({ label: 'Clear', variant: 'night' });
    expect(describeSymbol('partlycloudy_day')).toMatchObject({
      label: 'Partly cloudy',
      category: 'partly',
    });
  });

  it('handles codes with no day/night variant', () => {
    expect(describeSymbol('cloudy')).toMatchObject({ label: 'Cloudy', variant: null });
  });

  it('flags anything that wets the road', () => {
    expect(describeSymbol('lightrain').isWet).toBe(true);
    expect(describeSymbol('heavyrainshowers_day').isWet).toBe(true);
    expect(describeSymbol('snow').isWet).toBe(true);
    expect(describeSymbol('cloudy').isWet).toBe(false);
    expect(describeSymbol('fog').isWet).toBe(false);
  });

  it('reads compound thunder codes', () => {
    const s = describeSymbol('heavyrainshowersandthunder_day');
    expect(s.category).toBe('thunder');
    expect(s.label).toContain('thunder');
  });

  it('degrades gracefully on an unknown or missing code', () => {
    expect(describeSymbol(null).label).toBe('Unknown');
    expect(describeSymbol('somethingnew_day').label.length).toBeGreaterThan(0);
  });

  it('recognises every symbol the recorded fixture contains', () => {
    const series = parseMetForecast(fixture, { lat: 0, lon: 0, altitude: 0 });
    for (const p of series.points) {
      if (!p.symbolCode) continue;
      const info = describeSymbol(p.symbolCode);
      // A code we have no label for falls through to a generated one; catch
      // that by making sure it isn't just echoing the raw code back.
      expect(info.label).not.toBe(p.symbolCode);
    }
  });
});
