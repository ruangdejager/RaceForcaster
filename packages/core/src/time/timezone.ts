import tzlookup from 'tz-lookup';

/**
 * Time zone handling without a bundled tzdata copy.
 *
 * The only thing we need a database for is turning a coordinate into a zone
 * name (tz-lookup, 73 kB). Everything after that is `Intl`, which already
 * carries the full, current tzdata in both Node and every browser — so DST
 * rules stay correct without us shipping updates.
 */

/** IANA zone for a coordinate, falling back to UTC if it can't be resolved. */
export function timezoneFor(lat: number, lon: number): string {
  try {
    return tzlookup(lat, lon);
  } catch {
    return 'UTC';
  }
}

// Constructing a DateTimeFormat is expensive relative to using one, and the
// planner formats thousands of timestamps in the same handful of zones.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(timeZone: string, utcMs: number): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // Some ICU versions render midnight as hour 24 under hour12:false.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Zone's UTC offset in milliseconds at a given instant. */
export function offsetMsAt(timeZone: string, utcMs: number): number {
  const w = wallClockAt(timeZone, utcMs);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Round to the second: formatToParts drops sub-second precision, which would
  // otherwise show up as up to 999 ms of spurious offset.
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Interpret a wall-clock time as local to `timeZone` and return epoch ms.
 *
 * Two passes: the first guesses using the offset in force at the naive
 * instant, the second corrects it if that guess landed on the other side of a
 * DST transition. Ambiguous times in a fall-back hour resolve to the first
 * occurrence, which is the conventional choice.
 */
export function zonedWallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = naive - offsetMsAt(timeZone, naive);
  const corrected = naive - offsetMsAt(timeZone, guess);
  return corrected;
}

/**
 * Parse a local datetime string (`YYYY-MM-DDTHH:mm`, as produced by an
 * `<input type="datetime-local">`) as a time in `timeZone`.
 */
export function parseLocalDateTime(value: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return zonedWallClockToUtc(
    timeZone,
    Number(y),
    Number(mo),
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '0'),
  );
}

/** `YYYY-MM-DD` for an instant, as seen in `timeZone`. */
export function localDateKey(timeZone: string, utcMs: number): string {
  const w = wallClockAt(timeZone, utcMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** `+02:00` style offset string, which met.no's sunrise API expects. */
export function offsetString(timeZone: string, utcMs: number): string {
  const totalMinutes = Math.round(offsetMsAt(timeZone, utcMs) / 60000);
  const sign = totalMinutes < 0 ? '-' : '+';
  const abs = Math.abs(totalMinutes);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `HH:mm` in the given zone. */
export function formatTime(timeZone: string, utcMs: number): string {
  const w = wallClockAt(timeZone, utcMs);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Short weekday name in the given zone, e.g. "Sat". */
export function formatWeekday(timeZone: string, utcMs: number): string {
  const w = wallClockAt(timeZone, utcMs);
  // Reconstruct as a UTC date so getUTCDay reflects the zone's calendar day.
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day));
  return WEEKDAY[d.getUTCDay()] ?? '';
}

/** `YYYY-MM-DDTHH:mm` in the given zone, for datetime-local inputs. */
export function toLocalDateTimeInput(timeZone: string, utcMs: number): string {
  const w = wallClockAt(timeZone, utcMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}
