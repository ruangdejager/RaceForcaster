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

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Single-row-per-key store for site-wide config an admin can change, e.g.
-- which route loads at "/". Not worth a dedicated table per setting for the
-- one or two of these that exist.
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

export type UserRole = 'user' | 'full' | 'admin';

/** 'full' and 'admin' can both upload routes and touch a route's start time; only 'admin' manages other users. */
export function canManageRoutes(role: UserRole): boolean {
  return role === 'full' || role === 'admin';
}

/**
 * Add columns an earlier version of the schema didn't have.
 *
 * `routes` predates accounts, and `CREATE TABLE IF NOT EXISTS` is a no-op
 * against a database that already has the table — so a dev database created
 * before this feature existed would otherwise be stuck without `owner_id` /
 * `is_public` forever. This runs once at startup and is a no-op itself once
 * the columns exist.
 */
function migrateRoutesTable(db: DatabaseSyncType): void {
  const columns = db.prepare('PRAGMA table_info(routes)').all() as Array<{ name: string }>;
  const have = new Set(columns.map((c) => c.name));

  if (!have.has('owner_id')) {
    db.exec('ALTER TABLE routes ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!have.has('is_public')) {
    // Existing routes predate any notion of privacy and were reachable by
    // anyone with the link, same as a public route today — default keeps
    // that behaviour rather than silently locking people out of old links.
    db.exec('ALTER TABLE routes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1');
  }
  db.exec('CREATE INDEX IF NOT EXISTS routes_owner ON routes(owner_id)');
}

/** Same forward-migration pattern as `migrateRoutesTable`, for the `role` column added when roles shipped. */
function migrateUsersTable(db: DatabaseSyncType): void {
  const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const have = new Set(columns.map((c) => c.name));

  if (!have.has('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
}

/**
 * Make sure the site's one hard-coded admin is actually an admin, every boot.
 *
 * There's no invite flow or first-run wizard for the very first admin — it
 * has to come from somewhere — so this is that somewhere: idempotent (a
 * no-op once it's already true), and it only ever grants, never revokes, so
 * demoting this account later (from the admin panel, once there's a second
 * admin to do the demoting) sticks instead of being silently undone on the
 * next restart.
 */
const FOUNDING_ADMIN_USERNAME = 'ruandj';

function bootstrapFoundingAdmin(db: DatabaseSyncType): void {
  const user = db
    .prepare('SELECT id, role FROM users WHERE username = ? COLLATE NOCASE')
    .get(FOUNDING_ADMIN_USERNAME) as { id: string; role: string } | undefined;
  if (!user || user.role === 'admin') return;

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    // A default route seeded before this account existed (e.g. the very
    // first boot of a fresh database) is unowned — hand it to the founding
    // admin now so it shows up in their My Routes instead of floating free.
    db.prepare('UPDATE routes SET owner_id = ? WHERE owner_id IS NULL AND id = (SELECT value FROM app_settings WHERE key = ?)')
      .run(user.id, 'default_route_id');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

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

export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: number;
}

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: number;
}

export interface SavedRouteRow {
  id: string;
  name: string;
  ownerId: string | null;
  isPublic: boolean;
  createdAt: number;
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
    migrateRoutesTable(this.db);
    migrateUsersTable(this.db);
    bootstrapFoundingAdmin(this.db);
  }

  close(): void {
    this.db.close();
  }

  // --- Routes ------------------------------------------------------------

  /** Upload always creates an unowned, public route — saving to an account is a separate step. */
  saveRoute(id: string, name: string, json: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO routes (id, name, data, created_at, owner_id, is_public) VALUES (?, ?, ?, ?, NULL, 1)',
      )
      .run(id, name, json, Date.now());
  }

  getRoute(id: string): string | null {
    const row = this.db.prepare('SELECT data FROM routes WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    return row?.data ?? null;
  }

  getRouteVisibility(id: string): { ownerId: string | null; isPublic: boolean } | null {
    const row = this.db.prepare('SELECT owner_id, is_public FROM routes WHERE id = ?').get(id) as
      | { owner_id: string | null; is_public: number }
      | undefined;
    return row ? { ownerId: row.owner_id, isPublic: row.is_public === 1 } : null;
  }

  countRoutesOwnedBy(userId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM routes WHERE owner_id = ?').get(userId) as {
      n: number;
    };
    return row.n;
  }

  /** Attach an already-uploaded route to an account. Caller enforces the 5-route cap. */
  claimRoute(routeId: string, userId: string): void {
    this.db.prepare('UPDATE routes SET owner_id = ? WHERE id = ?').run(userId, routeId);
  }

  setRouteVisibility(routeId: string, isPublic: boolean): void {
    this.db.prepare('UPDATE routes SET is_public = ? WHERE id = ?').run(isPublic ? 1 : 0, routeId);
  }

  renameRoute(routeId: string, name: string): void {
    this.db.prepare('UPDATE routes SET name = ? WHERE id = ?').run(name, routeId);
  }

  /** Release a route back to unowned rather than deleting it — existing share
   *  links (and anyone who already has the URL) keep working either way, so
   *  there's no data-loss reason to hard-delete, only an account-management one. */
  releaseRoute(routeId: string, userId: string): boolean {
    const result = this.db
      .prepare('UPDATE routes SET owner_id = NULL WHERE id = ? AND owner_id = ?')
      .run(routeId, userId);
    return Number(result.changes ?? 0) > 0;
  }

  listRoutesOwnedBy(userId: string): SavedRouteRow[] {
    const rows = this.db
      .prepare('SELECT id, name, owner_id, is_public, created_at FROM routes WHERE owner_id = ? ORDER BY created_at DESC')
      .all(userId) as Array<{ id: string; name: string; owner_id: string | null; is_public: number; created_at: number }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerId: r.owner_id,
      isPublic: r.is_public === 1,
      createdAt: r.created_at,
    }));
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

  // --- Users ---------------------------------------------------------------

  /** New accounts always start at 'user' — nobody signs themselves up as full/admin. */
  createUser(id: string, username: string, passwordHash: string): void {
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'user', ?)")
      .run(id, username, passwordHash, Date.now());
  }

  private static toUserRow(row: {
    id: string;
    username: string;
    password_hash: string;
    role: string;
    created_at: number;
  }): UserRow {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role as UserRole,
      createdAt: row.created_at,
    };
  }

  getUserByUsername(username: string): UserRow | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as
      | { id: string; username: string; password_hash: string; role: string; created_at: number }
      | undefined;
    return row ? Store.toUserRow(row) : null;
  }

  getUserById(id: string): UserRow | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?')
      .get(id) as
      | { id: string; username: string; password_hash: string; role: string; created_at: number }
      | undefined;
    return row ? Store.toUserRow(row) : null;
  }

  /** For the admin panel: every account and its current role, oldest first. */
  listUsers(): Array<{ id: string; username: string; role: UserRole; createdAt: number }> {
    const rows = this.db
      .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC')
      .all() as Array<{ id: string; username: string; role: string; created_at: number }>;
    return rows.map((r) => ({ id: r.id, username: r.username, role: r.role as UserRole, createdAt: r.created_at }));
  }

  setUserRole(userId: string, role: UserRole): void {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  }

  countAdmins(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as {
      n: number;
    };
    return row.n;
  }

  // --- App settings ----------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // --- Sessions --------------------------------------------------------------

  createSession(id: string, userId: string, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, userId, Date.now(), expiresAt);
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.prepare('SELECT id, user_id, expires_at FROM sessions WHERE id = ?').get(id) as
      | { id: string; user_id: string; expires_at: number }
      | undefined;
    if (!row) return null;
    return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Drop expired cache rows and sessions. */
  prune(): number {
    const cutoff = Date.now() - 7 * 86_400_000;
    const result = this.db.prepare('DELETE FROM weather_cache WHERE fetched_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    return Number(result.changes ?? 0);
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
}
