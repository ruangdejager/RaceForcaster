import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '../src/constants.js';
import { prepareTrack } from '../src/geo/prepare.js';
import {
  computePacing,
  distanceAtElapsed,
  movingSecondsAtDistance,
  stoppedSecondsBefore,
} from '../src/pacing/model.js';
import { airDensity, powerForSpeed, speedForPower } from '../src/pacing/physics.js';
import type { Checkpoint } from '../src/types.js';
import { eastwardTrack } from './helpers.js';

const flat = prepareTrack(eastwardTrack({ lengthM: 50_000, stepM: 50 }));

/** A 100 km course with five 200 m hills. */
const hilly = prepareTrack(
  eastwardTrack({
    lengthM: 100_000,
    stepM: 50,
    elevation: (d) => 200 + 100 * Math.sin((2 * Math.PI * d) / 20_000),
  }),
);

describe('physics', () => {
  it('thins the air with altitude', () => {
    // The ISA reference values: 1.225 at sea level, 1.007 at 2000 m.
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
    expect(airDensity(2000)).toBeCloseTo(1.007, 2);
    expect(airDensity(1500)).toBeLessThan(airDensity(500));
  });

  it('inverts cleanly between speed and power', () => {
    for (const grade of [-0.08, -0.02, 0, 0.03, 0.1]) {
      const v = speedForPower(220, grade, DEFAULT_RIDER, 200);
      expect(powerForSpeed(v, grade, DEFAULT_RIDER, 200)).toBeCloseTo(220, 3);
    }
  });

  it('puts a plausible speed on a plausible power', () => {
    // 220 W on the flat should land a typical rider around 30 km/h.
    const kmh = speedForPower(220, 0, DEFAULT_RIDER, 0) * 3.6;
    expect(kmh).toBeGreaterThan(25);
    expect(kmh).toBeLessThan(36);
  });

  it('slows down uphill and speeds up downhill at the same power', () => {
    const up = speedForPower(220, 0.06, DEFAULT_RIDER, 200);
    const level = speedForPower(220, 0, DEFAULT_RIDER, 200);
    const down = speedForPower(220, -0.06, DEFAULT_RIDER, 200);
    expect(up).toBeLessThan(level);
    expect(level).toBeLessThan(down);
  });

  it('still converges on a very steep descent, where the cubic has three roots', () => {
    const v = speedForPower(200, -0.15, DEFAULT_RIDER, 500);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(10);
  });
});

describe('computePacing', () => {
  it('hits the requested average on a flat course', () => {
    const pacing = computePacing(flat.points, 30, DEFAULT_RIDER);
    const achieved = flat.totalDistance / pacing.totalMovingSeconds / (1000 / 3600);
    expect(achieved).toBeCloseTo(30, 2);
  });

  it('hits the requested average on a hilly course too', () => {
    // The whole promise of gradient-adjusted pacing: the terrain changes where
    // the time goes, never how much of it there is in total.
    for (const target of [18, 21, 25, 32]) {
      const pacing = computePacing(hilly.points, target, DEFAULT_RIDER);
      const achieved = hilly.totalDistance / pacing.totalMovingSeconds / (1000 / 3600);
      expect(Math.abs(achieved - target)).toBeLessThan(0.05);
    }
  });

  it('rides the climbs slower than the descents', () => {
    const pacing = computePacing(hilly.points, 21, DEFAULT_RIDER);

    let steepestUp = 0;
    let steepestDown = 0;
    let upSpeed = 0;
    let downSpeed = 0;

    hilly.points.forEach((p, i) => {
      if (p.grade > steepestUp) {
        steepestUp = p.grade;
        upSpeed = pacing.speedMs[i] ?? 0;
      }
      if (p.grade < steepestDown) {
        steepestDown = p.grade;
        downSpeed = pacing.speedMs[i] ?? 0;
      }
    });

    expect(steepestUp).toBeGreaterThan(0.01);
    expect(upSpeed).toBeGreaterThan(0);
    expect(downSpeed).toBeGreaterThan(upSpeed * 1.5);
  });

  it('produces monotonically increasing cumulative time', () => {
    const pacing = computePacing(hilly.points, 21, DEFAULT_RIDER);
    for (let i = 1; i < pacing.movingSeconds.length; i++) {
      expect(pacing.movingSeconds[i] ?? 0).toBeGreaterThan(pacing.movingSeconds[i - 1] ?? 0);
    }
  });

  it('returns an empty result rather than throwing on a degenerate route', () => {
    expect(computePacing([], 20, DEFAULT_RIDER).totalMovingSeconds).toBe(0);
    expect(computePacing(flat.points, 0, DEFAULT_RIDER).totalMovingSeconds).toBe(0);
  });
});

describe('checkpoint stops', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'a',
      name: 'A',
      dist: 20_000,
      lat: 0,
      lon: 0,
      ele: 200,
      kind: 'checkpoint',
      facilities: [],
      stopMinutes: 10,
    },
    {
      id: 'b',
      name: 'B',
      dist: 60_000,
      lat: 0,
      lon: 0,
      ele: 200,
      kind: 'checkpoint',
      facilities: [],
      stopMinutes: 5,
    },
  ];

  it('counts only stops strictly before a point', () => {
    // Arriving at A, its own ten minutes have not happened yet.
    expect(stoppedSecondsBefore(checkpoints, 20_000)).toBe(0);
    expect(stoppedSecondsBefore(checkpoints, 20_001)).toBe(600);
    expect(stoppedSecondsBefore(checkpoints, 60_000)).toBe(600);
    expect(stoppedSecondsBefore(checkpoints, 100_000)).toBe(900);
  });

  it('inverts elapsed time back to the right distance', () => {
    const pacing = computePacing(hilly.points, 21, DEFAULT_RIDER);

    for (const dist of [0, 15_000, 45_000, 99_000]) {
      const moving = movingSecondsAtDistance(hilly.points, pacing.movingSeconds, dist);
      const elapsed = moving + stoppedSecondsBefore(checkpoints, dist);
      const back = distanceAtElapsed(hilly.points, pacing.movingSeconds, checkpoints, elapsed);
      expect(Math.abs(back - dist)).toBeLessThan(120);
    }
  });

  it('holds the rider at the checkpoint for the length of the stop', () => {
    const pacing = computePacing(hilly.points, 21, DEFAULT_RIDER);
    const arriveA = movingSecondsAtDistance(hilly.points, pacing.movingSeconds, 20_000);

    // Five minutes into a ten-minute stop, the rider has not moved on.
    const mid = distanceAtElapsed(hilly.points, pacing.movingSeconds, checkpoints, arriveA + 300);
    expect(mid).toBeCloseTo(20_000, -1);

    // A minute after leaving, they have.
    const after = distanceAtElapsed(hilly.points, pacing.movingSeconds, checkpoints, arriveA + 660);
    expect(after).toBeGreaterThan(20_100);
  });
});
