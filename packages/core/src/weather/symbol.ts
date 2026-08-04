/**
 * met.no weather symbol codes.
 *
 * Codes look like `partlycloudy_day`, `lightrainshowers_night` or
 * `heavysnowandthunder`. The `_day` / `_night` / `_polartwilight` suffix is
 * only present on symbols whose appearance depends on the sun.
 */

export type SkyCategory =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'showers'
  | 'sleet'
  | 'snow'
  | 'thunder';

export interface SymbolInfo {
  /** Base code with any day/night suffix removed. */
  base: string;
  variant: 'day' | 'night' | 'polartwilight' | null;
  label: string;
  category: SkyCategory;
  /** True for anything that puts water on the road. */
  isWet: boolean;
}

const BASE_LABELS: Record<string, string> = {
  clearsky: 'Clear',
  fair: 'Fair',
  partlycloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',

  lightrain: 'Light rain',
  rain: 'Rain',
  heavyrain: 'Heavy rain',
  lightrainshowers: 'Light showers',
  rainshowers: 'Showers',
  heavyrainshowers: 'Heavy showers',

  lightsleet: 'Light sleet',
  sleet: 'Sleet',
  heavysleet: 'Heavy sleet',
  lightsleetshowers: 'Light sleet showers',
  sleetshowers: 'Sleet showers',
  heavysleetshowers: 'Heavy sleet showers',

  lightsnow: 'Light snow',
  snow: 'Snow',
  heavysnow: 'Heavy snow',
  lightsnowshowers: 'Light snow showers',
  snowshowers: 'Snow showers',
  heavysnowshowers: 'Heavy snow showers',
};

function categoryFor(base: string): SkyCategory {
  if (base.includes('thunder')) return 'thunder';
  if (base.includes('snow')) return 'snow';
  if (base.includes('sleet')) return 'sleet';
  if (base.includes('showers')) return 'showers';
  if (base.includes('rain')) return 'rain';
  if (base.includes('fog')) return 'fog';
  if (base === 'cloudy') return 'cloudy';
  if (base === 'partlycloudy' || base === 'fair') return 'partly';
  return 'clear';
}

/** Sentence-case a code we don't have an explicit label for. */
function fallbackLabel(base: string): string {
  const spaced = base
    .replace(/andthunder$/, ' and thunder')
    .replace(/showers/, ' showers')
    .replace(/^(light|heavy)/, '$1 ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describeSymbol(symbolCode: string | null | undefined): SymbolInfo {
  if (!symbolCode) {
    return { base: 'unknown', variant: null, label: 'Unknown', category: 'cloudy', isWet: false };
  }

  const match = /^(.*?)(?:_(day|night|polartwilight))?$/.exec(symbolCode.trim().toLowerCase());
  const base = match?.[1] ?? symbolCode;
  const variant = (match?.[2] as SymbolInfo['variant']) ?? null;

  const thunder = base.endsWith('andthunder');
  const core = thunder ? base.slice(0, -'andthunder'.length) : base;

  let label = BASE_LABELS[core] ?? fallbackLabel(core);
  if (thunder) label += ' and thunder';

  // "Clear" during the day is what everyone calls sunny.
  if (core === 'clearsky' && variant === 'day') label = 'Sunny';
  if (core === 'fair' && variant === 'day') label = 'Fair';

  const category = categoryFor(base);

  return {
    base,
    variant,
    label,
    category,
    isWet: ['rain', 'showers', 'sleet', 'snow', 'thunder'].includes(category),
  };
}
