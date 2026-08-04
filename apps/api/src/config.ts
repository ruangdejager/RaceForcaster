import { resolve } from 'node:path';

/**
 * met.no returns 403 to anything that doesn't identify itself, and their terms
 * ask for an application name plus a way to reach the operator. There is no
 * sensible default for that — it has to name whoever is running this instance.
 */
function requireUserAgent(): string {
  const ua = process.env['MET_USER_AGENT']?.trim();
  if (!ua) {
    throw new Error(
      'MET_USER_AGENT is not set.\n\n' +
        "MET Norway's terms of service require every request to identify the\n" +
        'application and a contact address. Copy .env.example to .env and set\n' +
        'it to something like:\n\n' +
        '  MET_USER_AGENT="RaceForecaster/0.1 github.com/you/RaceForecaster you@example.com"\n\n' +
        'See https://api.met.no/doc/TermsOfService',
    );
  }
  return ua;
}

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  metUserAgent: string;
  metMaxRps: number;
  publicBaseUrl: string;
  /** Directory of built web assets to serve, or null in dev (Vite serves them). */
  webRoot: string | null;
}

export function loadConfig(): Config {
  const dataDir = resolve(process.env['DATA_DIR'] ?? './data');
  const port = num(process.env['PORT'], 8787);

  return {
    port,
    dataDir,
    dbPath: resolve(dataDir, 'raceforecaster.db'),
    metUserAgent: requireUserAgent(),
    metMaxRps: num(process.env['MET_MAX_RPS'], 5),
    publicBaseUrl: (process.env['PUBLIC_BASE_URL'] ?? `http://localhost:${port}`).replace(/\/$/, ''),
    webRoot: process.env['WEB_ROOT'] ?? null,
  };
}

/** Largest route file we'll accept, bytes. A 100k-point GPX is ~15 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
