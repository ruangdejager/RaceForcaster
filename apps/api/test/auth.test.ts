import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { Store } from '../src/db/index.js';
import type { MetClient } from '../src/met/client.js';
import { createAdminApi } from '../src/routes/admin.js';
import { createApi } from '../src/routes/api.js';
import { createAuthApi } from '../src/routes/auth.js';
import { MAX_SAVED_ROUTES, createMyRoutesApi } from '../src/routes/myRoutes.js';

/**
 * Full-stack integration tests against the real Hono app and a real (in-memory)
 * SQLite store — no mocking of the auth/route-ownership logic itself, since
 * that logic is exactly what's under test. Weather fetching is never
 * exercised here (no test hits /plans or /shares), so the met.no client is a
 * harmless stub.
 */

const config: Config = {
  port: 0,
  dataDir: ':memory:',
  dbPath: ':memory:',
  metUserAgent: 'test',
  metMaxRps: 5,
  publicBaseUrl: 'http://localhost:8787',
  webRoot: null,
};

function buildApp(store: Store): Hono {
  const app = new Hono();
  const met = {} as MetClient;
  app.route('/api', createApi({ config, store, met }));
  app.route('/api/auth', createAuthApi({ store, cookieSecure: false }));
  app.route('/api/my/routes', createMyRoutesApi({ store }));
  app.route('/api/admin', createAdminApi({ store }));
  return app;
}

/** A minimal but valid two-point GPX, enough for buildRoute to accept it. */
function gpx(): string {
  return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
    <trkpt lat="-33.90" lon="23.40"><ele>500</ele></trkpt>
    <trkpt lat="-33.91" lon="23.50"><ele>520</ele></trkpt>
  </trkseg></trk></gpx>`;
}

/** Pull the cookie header out of a Set-Cookie response so the next request can send it back. */
function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie');
  if (!raw) throw new Error('Expected a Set-Cookie header.');
  return raw.split(';')[0] ?? '';
}

async function signup(app: Hono, username: string, password = 'a-fine-password'): Promise<string> {
  const res = await app.request('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(201);
  return sessionCookie(res);
}

/** A signed-up account promoted to the 'full' role, i.e. one that can add routes. */
async function signupPrivileged(
  app: Hono,
  store: Store,
  username: string,
  password = 'a-fine-password',
): Promise<string> {
  const cookie = await signup(app, username, password);
  const user = store.getUserByUsername(username);
  if (!user) throw new Error(`Expected a user row for ${username}.`);
  store.setUserRole(user.id, 'full');
  return cookie;
}

/** Uploads as whichever account the cookie belongs to — must be 'full' or 'admin'. */
async function uploadRoute(app: Hono, cookie: string): Promise<string> {
  const res = await app.request('/api/routes', {
    method: 'POST',
    headers: { 'content-type': 'application/gpx+xml', cookie },
    body: gpx(),
  });
  const body = (await res.json()) as { route: { id: string } };
  return body.route.id;
}

let store: Store;
let app: Hono;

beforeEach(() => {
  store = new Store(':memory:');
  app = buildApp(store);
});

describe('signup and login', () => {
  it('rejects a short password', async () => {
    const res = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rider1', password: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate username', async () => {
    await signup(app, 'rider1');
    const res = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rider1', password: 'another-password' }),
    });
    expect(res.status).toBe(409);
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    await signup(app, 'rider1', 'correct-password');

    const bad = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rider1', password: 'wrong-password' }),
    });
    expect(bad.status).toBe(401);

    const good = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rider1', password: 'correct-password' }),
    });
    expect(good.status).toBe(200);
  });

  it('reports who you are via /me, and null when logged out', async () => {
    const cookie = await signup(app, 'rider1');

    const loggedIn = await app.request('/api/auth/me', { headers: { cookie } });
    expect(((await loggedIn.json()) as { user: { username: string } | null }).user?.username).toBe(
      'rider1',
    );

    const loggedOut = await app.request('/api/auth/me');
    expect(((await loggedOut.json()) as { user: unknown }).user).toBeNull();
  });

  it('logout clears the session', async () => {
    const cookie = await signup(app, 'rider1');
    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });

    const res = await app.request('/api/my/routes', { headers: { cookie } });
    expect(res.status).toBe(401);
  });
});

describe('saved routes', () => {
  it('requires login to save', async () => {
    const uploader = await signupPrivileged(app, store, 'uploader');
    const routeId = await uploadRoute(app, uploader);
    const res = await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routeId }),
    });
    expect(res.status).toBe(401);
  });

  it('saves a route and lists it back', async () => {
    const cookie = await signupPrivileged(app, store, 'rider1');
    const routeId = await uploadRoute(app, cookie);

    const save = await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ routeId }),
    });
    expect(save.status).toBe(201);

    const list = await app.request('/api/my/routes', { headers: { cookie } });
    const body = (await list.json()) as { routes: Array<{ id: string; isPublic: boolean }> };
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0]?.id).toBe(routeId);
    expect(body.routes[0]?.isPublic).toBe(true);
  });

  it(`stops at ${MAX_SAVED_ROUTES} saved routes`, async () => {
    const cookie = await signupPrivileged(app, store, 'rider1');

    for (let i = 0; i < MAX_SAVED_ROUTES; i++) {
      const routeId = await uploadRoute(app, cookie);
      const res = await app.request('/api/my/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ routeId }),
      });
      expect(res.status).toBe(201);
    }

    const oneMore = await uploadRoute(app, cookie);
    const blocked = await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ routeId: oneMore }),
    });
    expect(blocked.status).toBe(409);

    const list = await app.request('/api/my/routes', { headers: { cookie } });
    expect(((await list.json()) as { routes: unknown[] }).routes).toHaveLength(MAX_SAVED_ROUTES);
  });

  it('freeing a saved route opens a new slot', async () => {
    const cookie = await signupPrivileged(app, store, 'rider1');
    const ids: string[] = [];
    for (let i = 0; i < MAX_SAVED_ROUTES; i++) {
      const routeId = await uploadRoute(app, cookie);
      await app.request('/api/my/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ routeId }),
      });
      ids.push(routeId);
    }

    const first = ids[0];
    await app.request(`/api/my/routes/${first}`, { method: 'DELETE', headers: { cookie } });

    const nextRoute = await uploadRoute(app, cookie);
    const res = await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ routeId: nextRoute }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects saving someone else's already-claimed route", async () => {
    const cookieA = await signupPrivileged(app, store, 'rider-a');
    const cookieB = await signupPrivileged(app, store, 'rider-b');
    const routeId = await uploadRoute(app, cookieA);

    await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ routeId }),
    });

    const res = await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ routeId }),
    });
    expect(res.status).toBe(403);
  });
});

describe('route visibility', () => {
  it('a freshly uploaded route is publicly readable by anyone', async () => {
    const uploader = await signupPrivileged(app, store, 'uploader');
    const routeId = await uploadRoute(app, uploader);
    const res = await app.request(`/api/routes/${routeId}`);
    expect(res.status).toBe(200);
  });

  it('marking a saved route private blocks anonymous access', async () => {
    const cookie = await signupPrivileged(app, store, 'rider1');
    const routeId = await uploadRoute(app, cookie);

    await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ routeId, isPublic: false }),
    });

    const anon = await app.request(`/api/routes/${routeId}`);
    expect(anon.status).toBe(404);

    const owner = await app.request(`/api/routes/${routeId}`, { headers: { cookie } });
    expect(owner.status).toBe(200);
  });

  it("a private route isn't readable by a different logged-in account either", async () => {
    const cookieOwner = await signupPrivileged(app, store, 'owner');
    const cookieOther = await signup(app, 'someone-else');
    const routeId = await uploadRoute(app, cookieOwner);

    await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieOwner },
      body: JSON.stringify({ routeId, isPublic: false }),
    });

    const res = await app.request(`/api/routes/${routeId}`, { headers: { cookie: cookieOther } });
    expect(res.status).toBe(404);
  });

  it('toggling back to public restores anonymous access', async () => {
    const cookie = await signupPrivileged(app, store, 'rider1');
    const routeId = await uploadRoute(app, cookie);

    await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ routeId, isPublic: false }),
    });
    await app.request(`/api/my/routes/${routeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ isPublic: true }),
    });

    const anon = await app.request(`/api/routes/${routeId}`);
    expect(anon.status).toBe(200);
  });
});

describe('role gating on route upload', () => {
  it('rejects an anonymous upload', async () => {
    const res = await app.request('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/gpx+xml' },
      body: gpx(),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a plain logged-in user', async () => {
    const cookie = await signup(app, 'rider1');
    const res = await app.request('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/gpx+xml', cookie },
      body: gpx(),
    });
    expect(res.status).toBe(403);
  });

  it('allows a "full" role account', async () => {
    const cookie = await signupPrivileged(app, store, 'rider1');
    const res = await app.request('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/gpx+xml', cookie },
      body: gpx(),
    });
    expect(res.status).toBe(200);
  });

  it('allows an admin account', async () => {
    const cookie = await signup(app, 'rider1');
    const user = store.getUserByUsername('rider1');
    if (!user) throw new Error('Expected a user row.');
    store.setUserRole(user.id, 'admin');

    const res = await app.request('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/gpx+xml', cookie },
      body: gpx(),
    });
    expect(res.status).toBe(200);
  });

  it('also gates claiming an already-uploaded route into "my routes"', async () => {
    const uploader = await signupPrivileged(app, store, 'uploader');
    const routeId = await uploadRoute(app, uploader);

    const plain = await signup(app, 'rider1');
    const res = await app.request('/api/my/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: plain },
      body: JSON.stringify({ routeId }),
    });
    expect(res.status).toBe(403);
  });
});

describe('admin API', () => {
  async function signupAdmin(username: string): Promise<string> {
    const cookie = await signup(app, username);
    const user = store.getUserByUsername(username);
    if (!user) throw new Error('Expected a user row.');
    store.setUserRole(user.id, 'admin');
    return cookie;
  }

  it('rejects non-admins on every admin route', async () => {
    const plain = await signup(app, 'rider1');
    const full = await signupPrivileged(app, store, 'rider2');

    for (const cookie of [plain, full]) {
      const users = await app.request('/api/admin/users', { headers: { cookie } });
      expect(users.status).toBe(403);
    }

    const anon = await app.request('/api/admin/users');
    expect(anon.status).toBe(403);
  });

  it('lists users for an admin', async () => {
    const admin = await signupAdmin('root');
    await signup(app, 'rider1');

    const res = await app.request('/api/admin/users', { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ username: string; role: string }> };
    expect(body.users.map((u) => u.username).sort()).toEqual(['rider1', 'root']);
  });

  it("lets an admin change another user's role", async () => {
    const admin = await signupAdmin('root');
    const cookie = await signup(app, 'rider1');
    const rider1 = store.getUserByUsername('rider1');
    if (!rider1) throw new Error('Expected a user row.');

    const res = await app.request(`/api/admin/users/${rider1.id}/role`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({ role: 'full' }),
    });
    expect(res.status).toBe(200);

    const upload = await app.request('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/gpx+xml', cookie },
      body: gpx(),
    });
    expect(upload.status).toBe(200);
  });

  it('refuses to demote the last remaining admin', async () => {
    const admin = await signupAdmin('root');
    const self = store.getUserByUsername('root');
    if (!self) throw new Error('Expected a user row.');

    const res = await app.request(`/api/admin/users/${self.id}/role`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid role value', async () => {
    const admin = await signupAdmin('root');
    const rider1 = await signup(app, 'rider1');
    void rider1;
    const target = store.getUserByUsername('rider1');
    if (!target) throw new Error('Expected a user row.');

    const res = await app.request(`/api/admin/users/${target.id}/role`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({ role: 'superadmin' }),
    });
    expect(res.status).toBe(400);
  });

  it('lets an admin set the default route, and it becomes publicly fetchable', async () => {
    const admin = await signupAdmin('root');
    const routeId = await uploadRoute(app, admin);

    const res = await app.request('/api/admin/default-route', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({ routeId }),
    });
    expect(res.status).toBe(200);

    const anon = await app.request('/api/default-route');
    expect(anon.status).toBe(200);
    const body = (await anon.json()) as { route: { id: string } };
    expect(body.route.id).toBe(routeId);
  });

  it('rejects setting a default route that does not exist', async () => {
    const admin = await signupAdmin('root');
    const res = await app.request('/api/admin/default-route', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({ routeId: 'not-a-real-id' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('default route lookup', () => {
  it('404s when no default route has been set', async () => {
    const res = await app.request('/api/default-route');
    expect(res.status).toBe(404);
  });
});
