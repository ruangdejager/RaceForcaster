import { describe, expect, it } from 'vitest';
import { compassPoint, haversineMetres, initialBearingDeg } from '../src/geo/distance.js';
import { computeAscentDescent, computeGrades, movingAverage } from '../src/geo/elevation.js';
import { pointAtDistance, resampleTrack } from '../src/geo/resample.js';
import { simplify } from '../src/geo/simplify.js';
import { prepareTrack } from '../src/geo/prepare.js';
import { eastwardTrack, mPerDegLon } from './helpers.js';

describe('haversineMetres', () => {
  it('measures a known long-distance pair', () => {
    // Cape Town to Johannesburg, ~1264 km great-circle.
    const d = haversineMetres({ lat: -33.9249, lon: 18.4241 }, { lat: -26.2041, lon: 28.0473 });
    expect(d / 1000).toBeCloseTo(1264, -1);
  });

  it('measures one degree of latitude at about 111 km', () => {
    expect(haversineMetres({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -2);
  });

  it('returns zero for the same point', () => {
    expect(haversineMetres({ lat: -33.9, lon: 18.4 }, { lat: -33.9, lon: 18.4 })).toBe(0);
  });
});

describe('initialBearingDeg', () => {
  it('reads due east as 90 degrees', () => {
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 4);
  });

  it('reads due north as 0 degrees', () => {
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 4);
  });

  it('reads due west as 270 degrees, not -90', () => {
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 4);
  });
});

describe('compassPoint', () => {
  it('names the cardinal and intercardinal directions', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(315)).toBe('NW');
    expect(compassPoint(337.5)).toBe('NNW');
  });

  it('wraps past 360 back to north', () => {
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(361)).toBe('N');
  });
});

describe('resampleTrack', () => {
  it('produces evenly spaced points and preserves the total length', () => {
    const raw = eastwardTrack({ lengthM: 10_000, stepM: 137 });
    const out = resampleTrack(raw, 100);

    expect(out.length).toBeGreaterThan(99);
    expect(out[0]?.dist).toBe(0);
    expect(out[out.length - 1]?.dist ?? 0).toBeCloseTo(10_000, -1);

    for (let i = 1; i < out.length - 1; i++) {
      expect((out[i]?.dist ?? 0) - (out[i - 1]?.dist ?? 0)).toBeCloseTo(100, 6);
    }
  });

  it('always lands exactly on the finish', () => {
    // 10,050 m is not a multiple of the 100 m spacing.
    const raw = eastwardTrack({ lengthM: 10_050, stepM: 50 });
    const out = resampleTrack(raw, 100);
    expect(out[out.length - 1]?.dist ?? 0).toBeCloseTo(10_050, -1);
  });

  it('interpolates elevation along the way', () => {
    const raw = eastwardTrack({ lengthM: 1000, stepM: 500, elevation: (d) => d / 10 });
    const out = resampleTrack(raw, 100);
    const mid = out.find((p) => Math.abs(p.dist - 500) < 1);
    expect(mid?.ele ?? 0).toBeCloseTo(50, 0);
  });

  it('survives a degenerate single-point track', () => {
    const out = resampleTrack([{ lat: 1, lon: 2, ele: 3 }], 100);
    expect(out).toHaveLength(1);
    expect(out[0]?.dist).toBe(0);
  });
});

describe('pointAtDistance', () => {
  const points = resampleTrack(eastwardTrack({ lengthM: 5000, stepM: 100 }), 100);

  it('interpolates between samples', () => {
    const p = pointAtDistance(points, 1250);
    expect(p.dist).toBe(1250);
    const expectedLon = 18.4 + 1250 / mPerDegLon(-33.9);
    expect(p.lon).toBeCloseTo(expectedLon, 5);
  });

  it('clamps rather than extrapolating past the ends', () => {
    expect(pointAtDistance(points, -100).dist).toBe(0);
    expect(pointAtDistance(points, 999_999).dist).toBeCloseTo(5000, -1);
  });
});

describe('simplify', () => {
  it('drops collinear points but keeps the endpoints', () => {
    const straight = eastwardTrack({ lengthM: 5000, stepM: 100 });
    const out = simplify(straight, 1.5);
    expect(out.length).toBeLessThan(straight.length / 10);
    expect(out[0]).toEqual(straight[0]);
    expect(out[out.length - 1]).toEqual(straight[straight.length - 1]);
  });

  it('keeps a genuine corner', () => {
    const corner = [
      { lat: 0, lon: 0, ele: 0 },
      { lat: 0, lon: 0.01, ele: 0 },
      { lat: 0.01, lon: 0.01, ele: 0 },
    ];
    expect(simplify(corner, 1.5)).toHaveLength(3);
  });

  it('keeps the hill on a dead-straight road', () => {
    // Regression: simplifying on latitude and longitude alone reduces a
    // straight road to its two endpoints, silently deleting every metre of
    // climbing and leaving the pacing model to treat a mountain pass as flat.
    const climb = eastwardTrack({
      lengthM: 20_000,
      stepM: 50,
      elevation: (d) => 100 + 300 * Math.sin((Math.PI * d) / 20_000),
    });
    const out = simplify(climb, 1.5);
    // In 2D this collapses to 2 points and a peak of 100 m; in 3D the summit
    // and enough of the profile to reconstruct it survive.
    expect(out.length).toBeGreaterThan(10);
    expect(Math.max(...out.map((p) => p.ele))).toBeGreaterThan(390);
  });
});

describe('elevation', () => {
  it('smooths without shifting the mean much', () => {
    const noisy = [10, 12, 8, 11, 9, 10, 12, 8];
    const smoothed = movingAverage(noisy, 2);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(smoothed)).toBeCloseTo(mean(noisy), 0);
    // Variance should drop markedly.
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    expect(spread(smoothed)).toBeLessThan(spread(noisy));
  });

  it('reads gradient sign and magnitude correctly', () => {
    // 100 m of climb over 1000 m of road is 10%.
    const eles = Array.from({ length: 11 }, (_, i) => i * 10);
    const grades = computeGrades(eles, 100, 1);
    expect(grades[5] ?? 0).toBeCloseTo(0.1, 6);

    const descending = eles.map((e) => -e);
    expect(computeGrades(descending, 100, 1)[5] ?? 0).toBeCloseTo(-0.1, 6);
  });

  it('totals ascent and descent over a single hill', () => {
    const up = Array.from({ length: 51 }, (_, i) => i * 2); // 0 -> 100
    const down = Array.from({ length: 50 }, (_, i) => 100 - (i + 1) * 2); // 98 -> 0
    const { ascent, descent } = computeAscentDescent([...up, ...down], 1);
    expect(ascent).toBeCloseTo(100, 0);
    expect(descent).toBeCloseTo(100, 0);
  });

  it('ignores noise on flat ground', () => {
    const flat = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i) * 0.3);
    const { ascent } = computeAscentDescent(flat, 1);
    expect(ascent).toBeLessThan(5);
  });
});

describe('prepareTrack', () => {
  it('annotates an eastward route with a 90° bearing throughout', () => {
    const track = prepareTrack(eastwardTrack({ lengthM: 20_000, stepM: 50 }));
    expect(track.points.length).toBeGreaterThan(190);

    const middle = track.points.slice(5, -5);
    for (const p of middle) {
      expect(p.bearing).toBeCloseTo(90, 1);
    }
  });

  it('reports the total distance and climbing of a hilly route', () => {
    // One 200 m hill over 20 km.
    const track = prepareTrack(
      eastwardTrack({
        lengthM: 20_000,
        stepM: 50,
        elevation: (d) => 100 + 200 * Math.sin((Math.PI * d) / 20_000),
      }),
    );
    expect(track.totalDistance).toBeCloseTo(20_000, -2);
    expect(track.totalAscent).toBeGreaterThan(180);
    expect(track.totalAscent).toBeLessThan(220);
  });
});
