import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * Storage.
 *
 * `node:sqlite` ships with Node itself, so there is no native module to
 * compile — which keeps `npm install` working the same on a Windows laptop as
 * in a slim Docker image, and keeps the runtime image free of a toolchain.
 *
 * It is loaded through `createRequire` rather than a static import because
 * esbuild's built-in list predates `node:sqlite`: it strips the `node:` prefix
 * on the way out, and a bare `sqlite` specifier doesn't resolve, so the bundled
 * server builds cleanly and then dies on startup. Resolving it at runtime keeps
 * the specifier intact. The type import above is erased at compile time, so it
 * costs nothing and we keep full type checking.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS routes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,
  route_id    TEXT NOT NULL,
  settings    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS shares_route ON shares(route_id);

-- Raw met.no bodies, kept verbatim so a conditional revalidation can send the
-- original Last-Modified back untouched.
CREATE TABLE IF NOT EXISTS weather_cache (
  key           TEXT PRIMARY KEY,
  body          TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_modified TEXT,
  fetched_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sun_cache (
  key         TEXT PRIMARY KEY,
  sunrise     INTEGER,
  sunset      INTEGER,
  expires_at  INTEGER NOT NULL
);
`;

export interface CachedResponse {
  body: string;
  expiresAt: number;
  lastModified: string | null;
  fetchedAt: number;
}

export interface CachedSun {
  sunrise: number | null;
  sunset: number | null;
  expiresAt: number;
}

export class Store {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // WAL lets reads continue during a write, which matters once several
    // people are sliding the speed control at the same time.
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- Routes ------------------------------------------------------------

  saveRoute(id: string, name: string, json: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO routes (id, name, data, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, json, Date.now());
  }

  getRoute(id: string): string | null {
    const row = this.db.prepare('SELECT data FROM routes WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    return row?.data ?? null;
  }

  // --- Shares ------------------------------------------------------------

  saveShare(id: string, routeId: string, settingsJson: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO shares (id, route_id, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
      )
      .run(id, routeId, settingsJson, now, now);
  }

  getShare(id: string): { routeId: string; settings: string } | null {
    const row = this.db.prepare('SELECT route_id, settings FROM shares WHERE id = ?').get(id) as
      | { route_id: string; settings: string }
      | undefined;
    return row ? { routeId: row.route_id, settings: row.settings } : null;
  }

  // --- Weather cache -----------------------------------------------------

  getWeather(key: string): CachedResponse | null {
    const row = this.db
      .prepare('SELECT body, expires_at, last_modified, fetched_at FROM weather_cache WHERE key = ?')
      .get(key) as
      | { body: string; expires_at: number; last_modified: string | null; fetched_at: number }
      | undefined;
    if (!row) return null;
    return {
      body: row.body,
      expiresAt: row.expires_at,
      lastModified: row.last_modified,
      fetchedAt: row.fetched_at,
    };
  }

  putWeather(key: string, entry: CachedResponse): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO weather_cache (key, body, expires_at, last_modified, fetched_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, entry.body, entry.expiresAt, entry.lastModified, entry.fetchedAt);
  }

  /** Push an unchanged entry's expiry forward after a 304. */
  touchWeather(key: string, expiresAt: number): void {
    this.db
      .prepare('UPDATE weather_cache SET expires_at = ?, fetched_at = ? WHERE key = ?')
      .run(expiresAt, Date.now(), key);
  }

  // --- Sun cache ---------------------------------------------------------

  getSun(key: string): CachedSun | null {
    const row = this.db
      .prepare('SELECT sunrise, sunset, expires_at FROM sun_cache WHERE key = ?')
      .get(key) as { sunrise: number | null; sunset: number | null; expires_at: number } | undefined;
    if (!row) return null;
    return { sunrise: row.sunrise, sunset: row.sunset, expiresAt: row.expires_at };
  }

  putSun(key: string, entry: CachedSun): void {
    this.db
      .prepare('INSERT OR REPLACE INTO sun_cache (key, sunrise, sunset, expires_at) VALUES (?, ?, ?, ?)')
      .run(key, entry.sunrise, entry.sunset, entry.expiresAt);
  }

  /** Drop expired cache rows. Sun times never change, so only weather ages out. */
  prune(): number {
    const cutoff = Date.now() - 7 * 86_400_000;
    const result = this.db.prepare('DELETE FROM weather_cache WHERE fetched_at < ?').run(cutoff);
    return Number(result.changes ?? 0);
  }
}
