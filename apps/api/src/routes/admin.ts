import { Hono } from 'hono';
import { currentUserId } from '../auth/session.js';
import type { Store, UserRole } from '../db/index.js';

export interface AdminDeps {
  store: Store;
}

const VALID_ROLES: readonly UserRole[] = ['user', 'full', 'admin'];

type Env = { Variables: { userId: string } };

export function createAdminApi(deps: AdminDeps): Hono<Env> {
  const api = new Hono<Env>();

  // Every route here needs an actual admin, not just a logged-in user —
  // checked once, centrally, the same way myRoutes.ts gates on "logged in".
  api.use('*', async (c, next) => {
    const userId = currentUserId(c, deps.store);
    const user = userId ? deps.store.getUserById(userId) : null;
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Admin only.' }, 403);
    }
    c.set('userId', userId as string);
    await next();
  });

  api.get('/users', (c) => {
    return c.json({ users: deps.store.listUsers() });
  });

  api.patch('/users/:id/role', async (c) => {
    const targetId = c.req.param('id');
    const target = deps.store.getUserById(targetId);
    if (!target) return c.json({ error: 'No user with that id.' }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const role = body['role'];
    if (typeof role !== 'string' || !VALID_ROLES.includes(role as UserRole)) {
      return c.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}.` }, 400);
    }

    // The site has to always have at least one admin standing, or nobody
    // could ever grant the role back — including the person making this
    // exact request, if they're demoting themselves as the last one.
    if (target.role === 'admin' && role !== 'admin' && deps.store.countAdmins() <= 1) {
      return c.json({ error: "Can't remove the last admin." }, 409);
    }

    deps.store.setUserRole(targetId, role as UserRole);
    return c.json({ ok: true });
  });

  api.put('/default-route', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const routeId = typeof body['routeId'] === 'string' ? body['routeId'] : '';
    if (!routeId) return c.json({ error: 'routeId is required.' }, 400);
    if (!deps.store.getRouteVisibility(routeId)) {
      return c.json({ error: 'No route with that id.' }, 404);
    }

    deps.store.setSetting('default_route_id', routeId);
    return c.json({ ok: true });
  });

  return api;
}
