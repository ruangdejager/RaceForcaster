import { formatTime, formatWeekday, WIND_RELATION_LABELS, type WindRelation } from '@raceforecaster/core';

/** Distance in kilometres, without a trailing ".0" on whole numbers. */
export function km(metres: number, decimals = 0): string {
  const value = metres / 1000;
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

export function temp(celsius: number, decimals = 1): string {
  return `${celsius.toFixed(decimals)}°`;
}

export function kmh(metresPerSecond: number): number {
  return Math.round(metresPerSecond * 3.6);
}

/** "11h 18m", or "45m" when it's under an hour. */
export function duration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "20m" for a stop, or "1h 05m" for a long one. */
export function stopLabel(minutes: number): string {
  if (minutes === 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Hours as a short phrase: "2 hrs", "45 min", "none". */
export function hours(value: number): string {
  if (value <= 0) return 'none';
  if (value < 1) return `${Math.round(value * 60)} min`;
  const rounded = Math.round(value * 2) / 2;
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} hrs`;
}

export function clock(timezone: string, epochMs: number): string {
  return formatTime(timezone, epochMs);
}

/** "Sat 19:17" — the weekday matters once a race runs past midnight. */
export function dayClock(timezone: string, epochMs: number): string {
  return `${formatWeekday(timezone, epochMs)} ${formatTime(timezone, epochMs)}`;
}

export function windLabel(relation: WindRelation): string {
  return WIND_RELATION_LABELS[relation];
}

/** Rain intensity in the words a rider would use. */
export function rainDescription(mmPerHour: number): string | null {
  if (mmPerHour < 0.05) return null;
  if (mmPerHour < 0.5) return 'light rain';
  if (mmPerHour < 2) return 'rain';
  if (mmPerHour < 6) return 'heavy rain';
  return 'downpour';
}

/** Comma-separated facility list, with the first letter capitalised. */
export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
