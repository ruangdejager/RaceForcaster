import { roundCoord } from '@raceforecaster/core';
import type { Store } from '../db/index.js';

/**
 * The met.no client, and the one place their terms of service are honoured.
 *
 *   - Every request carries an identifying User-Agent. Without one they return
 *     403, and a fake one gets the client blocked.
 *   - Responses are cached until their `Expires` header, then revalidated with
 *     `If-Modified-Since` so an unchanged forecast costs them a 304 and us no
 *     bandwidth.
 *   - Concurrent callers asking for the same coordinate share one request
 *     rather than starting a stampede.
 *   - Outbound requests are paced well under their 20/s ceiling.
 *
 * https://api.met.no/doc/TermsOfService
 */

const FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const SUNRISE_URL = 'https://api.met.no/weatherapi/sunrise/3.0/sun';

/** Fallback cache lifetime when met.no sends no usable `Expires`. */
const DEFAULT_TTL_MS = 30 * 60_000;

/** Sun times for a past or present date never change; cache them for a year. */
const SUN_TTL_MS = 365 * 86_400_000;

/** Pace outbound requests to at most `rps` per second. */
function createThrottle(rps: number): () => Promise<void> {
  const intervalMs = 1000 / Math.max(0.1, rps);
  let nextSlot = 0;

  return async function acquire(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + intervalMs;
    const wait = slot - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
}

export class MetError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MetError';
  }
}

export interface MetClientOptions {
  userAgent: string;
  maxRps: number;
  store: Store;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface SunResult {
  sunrise: number | null;
  sunset: number | null;
}

export class MetClient {
  private readonly throttle: () => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  /** Requests currently in flight, keyed the same way as the cache. */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly options: MetClientOptions) {
    this.throttle = createThrottle(options.maxRps);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'User-Agent': this.options.userAgent,
      Accept: 'application/json',
      ...extra,
    };
  }

  /**
   * Raw forecast JSON for a coordinate.
   *
   * Coordinates are rounded to four decimals before anything else happens, so
   * two riders whose routes pass within a few metres of each other share a
   * cache entry instead of each costing a request.
   */
  async forecast(lat: number, lon: number, altitude: number): Promise<string> {
    const rlat = roundCoord(lat);
    const rlon = roundCoord(lon);
    const alt = Math.round(altitude);
    const key = `fc:${rlat},${rlon},${alt}`;

    const cached = this.options.store.getWeather(key);
    if (cached && cached.expiresAt > Date.now()) return cached.body;

    // Collapse concurrent misses for the same key onto one request.
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const url = `${FORECAST_URL}?lat=${rlat}&lon=${rlon}&altitude=${alt}`;
    const promise = this.fetchForecast(key, url, cached?.lastModified ?? null, cached?.body ?? null)
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchForecast(
    key: string,
    url: string,
    lastModified: string | null,
    staleBody: string | null,
  ): Promise<string> {
    await this.throttle();

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: this.headers(lastModified ? { 'If-Modified-Since': lastModified } : {}),
      });
    } catch (err) {
      // A network blip shouldn't destroy a plan we could still answer from a
      // slightly stale forecast.
      if (staleBody) return staleBody;
      throw new MetError(
        `Could not reach the weather service: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.status === 304 && staleBody) {
      this.options.store.touchWeather(key, expiresFrom(response));
      return staleBody;
    }

    if (response.status === 403) {
      throw new MetError(
        'The weather service rejected our identification. Check that MET_USER_AGENT names your application and a contact address.',
        403,
      );
    }

    if (response.status === 429) {
      if (staleBody) return staleBody;
      throw new MetError('The weather service is rate limiting us. Try again shortly.', 429);
    }

    if (!response.ok) {
      if (staleBody) return staleBody;
      throw new MetError(`Weather service returned ${response.status}.`, response.status);
    }

    const body = await response.text();
    this.options.store.putWeather(key, {
      body,
      expiresAt: expiresFrom(response),
      lastModified: response.headers.get('last-modified'),
      fetchedAt: Date.now(),
    });
    return body;
  }

  /**
   * Sunrise and sunset for a date at a coordinate.
   *
   * Nulls are a real answer, not a failure: inside the polar circles the sun
   * may not rise or set at all on a given date.
   */
  async sun(lat: number, lon: number, date: string, utcOffset: string): Promise<SunResult> {
    const rlat = roundCoord(lat);
    const rlon = roundCoord(lon);
    const key = `sun:${rlat},${rlon},${date}`;

    const cached = this.options.store.getSun(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { sunrise: cached.sunrise, sunset: cached.sunset };
    }

    await this.throttle();
    const url = `${SUNRISE_URL}?lat=${rlat}&lon=${rlon}&date=${date}&offset=${encodeURIComponent(utcOffset)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers() });
    } catch {
      return { sunrise: null, sunset: null };
    }

    if (!response.ok) return { sunrise: null, sunset: null };

    const json = (await response.json()) as {
      properties?: { sunrise?: { time?: string }; sunset?: { time?: string } };
    };

    const parse = (value: string | undefined): number | null => {
      if (!value) return null;
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : null;
    };

    const result: SunResult = {
      sunrise: parse(json.properties?.sunrise?.time),
      sunset: parse(json.properties?.sunset?.time),
    };

    this.options.store.putSun(key, { ...result, expiresAt: Date.now() + SUN_TTL_MS });
    return result;
  }
}

/** Honour met.no's own `Expires`, with a floor so we can't spin on a past date. */
function expiresFrom(response: Response): number {
  const header = response.headers.get('expires');
  const parsed = header ? Date.parse(header) : Number.NaN;
  const now = Date.now();
  if (Number.isFinite(parsed) && parsed > now) return parsed;
  return now + DEFAULT_TTL_MS;
}
