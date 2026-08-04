import { describe, expect, it } from 'vitest';
import {
  formatTime,
  formatWeekday,
  localDateKey,
  offsetMsAt,
  offsetString,
  parseLocalDateTime,
  timezoneFor,
  toLocalDateTimeInput,
  zonedWallClockToUtc,
} from '../src/time/timezone.js';

describe('timezoneFor', () => {
  it('resolves well-known coordinates', () => {
    expect(timezoneFor(-33.9249, 18.4241)).toBe('Africa/Johannesburg');
    expect(timezoneFor(51.5074, -0.1278)).toBe('Europe/London');
    expect(timezoneFor(59.9139, 10.7522)).toBe('Europe/Oslo');
  });

  it('falls back to UTC rather than throwing on nonsense input', () => {
    expect(timezoneFor(999, 999)).toBe('UTC');
  });
});

describe('offsetMsAt', () => {
  it('reads a fixed offset zone', () => {
    const t = Date.parse('2026-08-08T06:00:00Z');
    expect(offsetMsAt('Africa/Johannesburg', t)).toBe(2 * 3_600_000);
    expect(offsetString('Africa/Johannesburg', t)).toBe('+02:00');
  });

  it('follows a zone across its own DST change', () => {
    const winter = Date.parse('2026-01-15T12:00:00Z');
    const summer = Date.parse('2026-07-15T12:00:00Z');
    expect(offsetMsAt('Europe/London', winter)).toBe(0);
    expect(offsetMsAt('Europe/London', summer)).toBe(3_600_000);
  });

  it('handles a negative offset', () => {
    const t = Date.parse('2026-01-15T12:00:00Z');
    expect(offsetMsAt('America/New_York', t)).toBe(-5 * 3_600_000);
    expect(offsetString('America/New_York', t)).toBe('-05:00');
  });
});

describe('zonedWallClockToUtc', () => {
  it('interprets a local start time in the race timezone', () => {
    // 08:00 in Johannesburg is 06:00 UTC.
    const t = zonedWallClockToUtc('Africa/Johannesburg', 2026, 8, 8, 8, 0);
    expect(new Date(t).toISOString()).toBe('2026-08-08T06:00:00.000Z');
  });

  it('gets a start time on the far side of a spring-forward transition right', () => {
    // US clocks jump 02:00 -> 03:00 on 8 March 2026. A 07:00 start that day is
    // EDT (-04:00), so 11:00 UTC — not the 12:00 an EST assumption would give.
    const t = zonedWallClockToUtc('America/New_York', 2026, 3, 8, 7, 0);
    expect(new Date(t).toISOString()).toBe('2026-03-08T11:00:00.000Z');
  });

  it('gets a start time the day before that transition right', () => {
    const t = zonedWallClockToUtc('America/New_York', 2026, 3, 7, 7, 0);
    expect(new Date(t).toISOString()).toBe('2026-03-07T12:00:00.000Z');
  });

  it('resolves an ambiguous autumn hour to its first occurrence', () => {
    // 01:30 happens twice on 1 November 2026; the earlier one is EDT (-04:00).
    const t = zonedWallClockToUtc('America/New_York', 2026, 11, 1, 1, 30);
    expect(new Date(t).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('parseLocalDateTime', () => {
  it('reads the value an <input type="datetime-local"> produces', () => {
    const t = parseLocalDateTime('2026-08-08T08:00', 'Africa/Johannesburg');
    expect(t).not.toBeNull();
    expect(new Date(t ?? 0).toISOString()).toBe('2026-08-08T06:00:00.000Z');
  });

  it('accepts an optional seconds component', () => {
    expect(parseLocalDateTime('2026-08-08T08:00:30', 'Africa/Johannesburg')).not.toBeNull();
  });

  it('rejects anything else', () => {
    expect(parseLocalDateTime('not a date', 'UTC')).toBeNull();
    expect(parseLocalDateTime('2026-08-08', 'UTC')).toBeNull();
  });

  it('round-trips through the input format', () => {
    const tz = 'Europe/Oslo';
    const original = '2026-06-20T04:30';
    const t = parseLocalDateTime(original, tz) ?? 0;
    expect(toLocalDateTimeInput(tz, t)).toBe(original);
  });
});

describe('formatting', () => {
  const t = Date.parse('2026-08-08T06:00:00Z');

  it('renders local wall-clock time', () => {
    expect(formatTime('Africa/Johannesburg', t)).toBe('08:00');
    expect(formatTime('UTC', t)).toBe('06:00');
  });

  it('renders the local weekday', () => {
    expect(formatWeekday('Africa/Johannesburg', t)).toBe('Sat');
  });

  it('rolls the local date over at the right moment', () => {
    // 22:30 UTC is already the next day in Johannesburg.
    const late = Date.parse('2026-08-08T22:30:00Z');
    expect(localDateKey('UTC', late)).toBe('2026-08-08');
    expect(localDateKey('Africa/Johannesburg', late)).toBe('2026-08-09');
  });
});
