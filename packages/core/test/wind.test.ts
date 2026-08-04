import { describe, expect, it } from 'vitest';
import {
  classifyWind,
  fromVector,
  lerpWind,
  relativeWind,
  toVector,
} from '../src/weather/wind.js';
import { normalize180, normalize360 } from '../src/geo/distance.js';

describe('relativeWind', () => {
  // met.no reports the direction wind blows FROM. Riding towards 90° into a
  // wind coming from 90° is therefore a headwind — the case most likely to be
  // implemented backwards, so all four quadrants are pinned down here.
  it('calls wind from straight ahead a headwind', () => {
    const r = relativeWind(90, 90, 10);
    expect(r.relation).toBe('head');
    expect(r.windRelativeDeg).toBeCloseTo(0);
    expect(r.headwindMs).toBeCloseTo(10);
    expect(r.crosswindMs).toBeCloseTo(0);
  });

  it('calls wind from directly behind a tailwind, with a negative component', () => {
    const r = relativeWind(270, 90, 10);
    expect(r.relation).toBe('tail');
    expect(r.headwindMs).toBeCloseTo(-10);
  });

  it('puts wind from 90° clockwise of travel on the right', () => {
    const r = relativeWind(180, 90, 8);
    expect(r.relation).toBe('right');
    expect(r.crosswindMs).toBeCloseTo(8);
    expect(r.headwindMs).toBeCloseTo(0);
  });

  it('puts wind from 90° anticlockwise of travel on the left', () => {
    const r = relativeWind(0, 90, 8);
    expect(r.relation).toBe('left');
    expect(r.crosswindMs).toBeCloseTo(-8);
  });

  it('reproduces the "11 km/h NW, tailwind" case from a real plan', () => {
    // Wind from the north-west (315°) while heading south-east (135°).
    const r = relativeWind(315, 135, 11 / 3.6);
    expect(r.relation).toBe('tail');
    expect(r.headwindMs).toBeLessThan(0);
  });

  it('classifies the boundaries consistently', () => {
    expect(classifyWind(45)).toBe('head');
    expect(classifyWind(46)).toBe('right');
    expect(classifyWind(134)).toBe('right');
    expect(classifyWind(135)).toBe('tail');
    expect(classifyWind(180)).toBe('tail');
    expect(classifyWind(-180)).toBe('tail');
    expect(classifyWind(-46)).toBe('left');
    expect(classifyWind(-45)).toBe('head');
  });

  it('handles a wind crossing north without wrapping wrongly', () => {
    // Heading due north with wind from 350° is very nearly a headwind.
    const r = relativeWind(350, 0, 10);
    expect(r.relation).toBe('head');
    expect(r.windRelativeDeg).toBeCloseTo(-10);
  });
});

describe('wind vectors', () => {
  it('round-trips direction and speed', () => {
    for (const deg of [0, 45, 90, 179, 180, 270, 359]) {
      const v = toVector(deg, 7.5);
      const back = fromVector(v);
      expect(back.windSpeedMs).toBeCloseTo(7.5, 6);
      expect(normalize360(back.windFromDeg)).toBeCloseTo(normalize360(deg), 6);
    }
  });

  it('gives north, not south, when averaging across the 0/360 wrap', () => {
    // The whole reason wind is interpolated as a vector. Averaging the degrees
    // directly would give (350 + 10) / 2 = 180, pointing the opposite way.
    const blended = lerpWind(
      { windFromDeg: 350, windSpeed: 10 },
      { windFromDeg: 10, windSpeed: 10 },
      0.5,
    );
    expect(Math.abs(normalize180(blended.windFromDeg))).toBeLessThan(1e-6);
    // Vector averaging also shortens slightly when the two disagree in
    // direction, which is the physically right answer: 10·cos(10°) = 9.848.
    expect(blended.windSpeed).toBeCloseTo(9.8481, 3);
  });

  it('cancels two opposing winds to a calm', () => {
    const blended = lerpWind(
      { windFromDeg: 0, windSpeed: 10 },
      { windFromDeg: 180, windSpeed: 10 },
      0.5,
    );
    expect(blended.windSpeed).toBeCloseTo(0, 6);
  });

  it('reports a calm as zero speed rather than NaN', () => {
    const back = fromVector({ u: 0, v: 0 });
    expect(back.windSpeedMs).toBe(0);
    expect(Number.isFinite(back.windFromDeg)).toBe(true);
  });
});
