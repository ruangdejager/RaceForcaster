import type { DarkSegment, SunTimes } from '../types.js';
import { localDateKey } from '../time/timezone.js';

/**
 * Sunrise and sunset come from met.no's sunrise/3.0 API, keyed by local date.
 * This module only decides what they mean for a rider: which stretches of road
 * you'll cover in the dark, and how long that adds up to.
 */

export interface DaylightLookup {
  isDark(time: number): boolean;
  /** True when the sun API gave no times at all for a date we needed. */
  readonly hasGaps: boolean;
}

export function createDaylightLookup(sunTimes: readonly SunTimes[], timezone: string): DaylightLookup {
  const byDate = new Map<string, SunTimes>();
  for (const st of sunTimes) byDate.set(st.date, st);

  let hasGaps = false;

  return {
    get hasGaps() {
      return hasGaps;
    },
    isDark(time: number): boolean {
      const day = byDate.get(localDateKey(timezone, time));
      if (!day || day.sunrise === null || day.sunset === null) {
        // Either we never fetched this date, or it's a polar day/night where
        // met.no returns nothing. Both are better reported as daylight than as
        // a confident claim of darkness the rider might pack lights for.
        hasGaps = true;
        return false;
      }
      return time < day.sunrise || time >= day.sunset;
    },
  };
}

export interface DarkSample {
  time: number;
  dist: number;
  isDark: boolean;
}

/**
 * Collapse a sequence of samples into contiguous stretches of darkness.
 *
 * Boundaries land on sample times rather than the exact sunrise instant, so
 * with 15-minute sampling a segment edge is accurate to within 15 minutes.
 * That is well inside the precision anyone plans lights to.
 */
export function toDarkSegments(samples: readonly DarkSample[]): DarkSegment[] {
  const segments: DarkSegment[] = [];
  let open: DarkSegment | null = null;

  for (const s of samples) {
    if (s.isDark) {
      if (open) {
        open.toTime = s.time;
        open.toDist = s.dist;
      } else {
        open = { fromTime: s.time, toTime: s.time, fromDist: s.dist, toDist: s.dist };
      }
    } else if (open) {
      segments.push(open);
      open = null;
    }
  }
  if (open) segments.push(open);

  return segments;
}

/** Total darkness across the segments, hours. */
export function darkHours(segments: readonly DarkSegment[]): number {
  const ms = segments.reduce((sum, s) => sum + (s.toTime - s.fromTime), 0);
  return ms / 3_600_000;
}

/** Local dates a race spans, so the caller knows which sun lookups to fetch. */
export function datesSpanned(timezone: string, startTime: number, endTime: number): string[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  const DAY_MS = 86_400_000;

  // Step in hours so a short race near midnight still picks up both dates, and
  // pad each end by a day to cover a start before sunrise or a late finish.
  for (let t = startTime - DAY_MS; t <= endTime + DAY_MS; t += 6 * 3_600_000) {
    const key = localDateKey(timezone, t);
    if (!seen.has(key)) {
      seen.add(key);
      dates.push(key);
    }
  }
  return dates;
}
