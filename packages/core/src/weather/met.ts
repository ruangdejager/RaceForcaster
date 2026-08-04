import type { ForecastPoint, ForecastResolution, ForecastSeries } from '../types.js';

/**
 * Shape of a `locationforecast/2.0/complete` response, narrowed to the parts
 * we read. Everything is optional because met.no drops blocks it has no data
 * for — notably, the final entry in the series has no `next_*` at all.
 */
export interface MetForecastResponse {
  properties?: {
    timeseries?: Array<{
      time?: string;
      data?: {
        instant?: { details?: Record<string, number | undefined> };
        next_1_hours?: MetPeriod;
        next_6_hours?: MetPeriod;
        next_12_hours?: MetPeriod;
      };
    }>;
  };
}

interface MetPeriod {
  summary?: { symbol_code?: string };
  details?: Record<string, number | undefined>;
}

export class MetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetParseError';
  }
}

const numOrNull = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Turn a met.no response into our own series type.
 *
 * The important decision made here is the `1h` / `6h` split. met.no publishes
 * hour-by-hour detail for roughly the first 65 hours and only 6-hour blocks
 * beyond that. Rather than hiding it, each point records which it came from,
 * so the UI can be honest about a forecast for next Saturday while showing
 * tomorrow's at full confidence.
 */
export function parseMetForecast(
  json: MetForecastResponse,
  meta: { lat: number; lon: number; altitude: number; fetchedAt?: number },
): ForecastSeries {
  const raw = json.properties?.timeseries;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MetParseError('Forecast response contained no timeseries.');
  }

  const points: ForecastPoint[] = [];

  for (const entry of raw) {
    if (!entry?.time) continue;
    const t = Date.parse(entry.time);
    if (!Number.isFinite(t)) continue;

    const instant = entry.data?.instant?.details;
    if (!instant) continue;

    const airTemp = numOrNull(instant['air_temperature']);
    const windSpeed = numOrNull(instant['wind_speed']);
    const windFromDeg = numOrNull(instant['wind_from_direction']);
    // Without these three there is nothing useful to say about the hour.
    if (airTemp === null || windSpeed === null || windFromDeg === null) continue;

    const oneHour = entry.data?.next_1_hours;
    const sixHour = entry.data?.next_6_hours;

    let resolution: ForecastResolution = '1h';
    let precipMmPerHour = 0;
    let symbolCode: string | null = null;

    if (oneHour) {
      precipMmPerHour = numOrNull(oneHour.details?.['precipitation_amount']) ?? 0;
      symbolCode = oneHour.summary?.symbol_code ?? null;
    } else if (sixHour) {
      resolution = '6h';
      // A 6-hour total spread evenly. It is an estimate of intensity, not a
      // claim about which of those hours the rain actually falls in.
      precipMmPerHour = (numOrNull(sixHour.details?.['precipitation_amount']) ?? 0) / 6;
      symbolCode = sixHour.summary?.symbol_code ?? null;
    } else {
      // Final entry: no forward-looking block exists. Carry the previous
      // point's resolution so the tail of the series isn't mislabelled.
      resolution = points[points.length - 1]?.resolution ?? '6h';
    }

    points.push({
      t,
      airTemp,
      relHumidity: numOrNull(instant['relative_humidity']) ?? 50,
      dewPoint: numOrNull(instant['dew_point_temperature']),
      windSpeed,
      windFromDeg,
      cloudPct: numOrNull(instant['cloud_area_fraction']) ?? 0,
      fogPct: numOrNull(instant['fog_area_fraction']),
      uvIndex: numOrNull(instant['ultraviolet_index_clear_sky']),
      pressure: numOrNull(instant['air_pressure_at_sea_level']),
      precipMmPerHour,
      symbolCode,
      resolution,
    });
  }

  if (points.length === 0) {
    throw new MetParseError('Forecast response had no usable entries.');
  }

  points.sort((a, b) => a.t - b.t);

  return {
    lat: meta.lat,
    lon: meta.lon,
    altitude: meta.altitude,
    points,
    fetchedAt: meta.fetchedAt ?? Date.now(),
  };
}

/** Instant after which the series only has 6-hourly data, or null if never. */
export function coarseAfter(series: ForecastSeries): number | null {
  for (const p of series.points) {
    if (p.resolution === '6h') return p.t;
  }
  return null;
}
