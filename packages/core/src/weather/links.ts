/**
 * Deep link to a coordinate's own forecast page on YR, so a rider can
 * cross-check a sample point against the source directly rather than trusting
 * our interpolation blind.
 *
 * Verified live rather than guessed: this coordinate path resolves with no
 * redirect.
 */
export function yrForecastUrl(lat: number, lon: number): string {
  return `https://www.yr.no/en/forecast/hourly-table/${lat.toFixed(4)},${lon.toFixed(4)}`;
}
