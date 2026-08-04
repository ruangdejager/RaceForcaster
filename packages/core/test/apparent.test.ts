import { describe, expect, it } from 'vitest';
import { apparentTemperature, riderAirspeedMs, vapourPressureHpa } from '../src/weather/apparent.js';

describe('apparentTemperature', () => {
  it('matches a real YR reading of 9.3 °C feeling like 6.4 °C', () => {
    // Taken from an actual plan: 9.3 °C with a 7 km/h wind showed "feels 6.4°".
    // Solving Steadman backwards puts the humidity at ~64%, which is an
    // entirely ordinary early-morning value — so the formula is the right one.
    const at = apparentTemperature(9.3, 64, 7 / 3.6);
    expect(at).toBeCloseTo(6.4, 1);
  });

  it('feels colder as the wind picks up', () => {
    const calm = apparentTemperature(10, 60, 0);
    const breezy = apparentTemperature(10, 60, 10);
    expect(breezy).toBeLessThan(calm);
  });

  it('feels warmer as humidity rises in the heat', () => {
    const dry = apparentTemperature(30, 20, 2);
    const humid = apparentTemperature(30, 90, 2);
    expect(humid).toBeGreaterThan(dry);
  });

  it('computes saturation vapour pressure sanely', () => {
    // At 100% humidity the vapour pressure is the saturation value; ~12.3 hPa
    // at 10 °C is the textbook figure.
    expect(vapourPressureHpa(10, 100)).toBeCloseTo(12.3, 0);
    expect(vapourPressureHpa(10, 0)).toBe(0);
  });
});

describe('riderAirspeedMs', () => {
  it('adds a headwind to the rider speed', () => {
    // 30 km/h into a 10 km/h headwind is 40 km/h of airflow.
    expect(riderAirspeedMs(10 / 3.6, 0, 30 / 3.6) * 3.6).toBeCloseTo(40, 6);
  });

  it('subtracts a tailwind from the rider speed', () => {
    expect(riderAirspeedMs(-10 / 3.6, 0, 30 / 3.6) * 3.6).toBeCloseTo(20, 6);
  });

  it('never lets a crosswind reduce the airflow', () => {
    const straight = riderAirspeedMs(0, 0, 8);
    const crossed = riderAirspeedMs(0, 5, 8);
    expect(crossed).toBeGreaterThan(straight);
  });

  it('leaves a rider riding faster than a tailwind still feeling wind', () => {
    // Tailwind of 5 m/s while riding at 8 m/s: 3 m/s of airflow, not -3.
    expect(riderAirspeedMs(-5, 0, 8)).toBeCloseTo(3, 6);
  });
});
