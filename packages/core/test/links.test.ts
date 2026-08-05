import { describe, expect, it } from 'vitest';
import { yrForecastUrl } from '../src/weather/links.js';

describe('yrForecastUrl', () => {
  it('builds the verified coordinate path', () => {
    expect(yrForecastUrl(-33.9249, 18.4241)).toBe(
      'https://www.yr.no/en/forecast/hourly-table/-33.9249,18.4241',
    );
  });
});
