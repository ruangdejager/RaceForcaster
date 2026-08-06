import { Hono } from 'hono';
import { currentUserId } from '../auth/session.js';
import { canManageRoutes, type SavedRouteRow, type Store } from '../db/index.js';

export interface MyRoutesDeps {
  store: Store;
}

/** Matches what the rider was told when they asked for this feature. */
export const MAX_SAVED_ROUTES = 5;

function serialize(row: SavedRouteRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
  };
}

type Env = { Variables: { userId: string } };

export function createMyRoutesApi(deps: MyRoutesDeps): Hono<Env> {
  const api = new Hono<Env>();

  // Every handler here needs a logged-in user; centralising the check means
  // each route body can assume `userId` is real rather than re-deriving it.
  api.use('*', async (c, next) => {
    const userId = currentUserId(c, deps.store);
    if (!userId) return c.json({ error: 'Log in to do that.' }, 401);
    c.set('userId', userId);
    await next();
  });

  api.get('/', (c) => {
    const userId = c.get('userId');
    const routes = deps.store.listRoutesOwnedBy(userId).map(serialize);
    return c.json({ routes, limit: MAX_SAVED_ROUTES });
  });

  api.post('/', async (c) => {
    const userId = c.get('userId');

    // Claiming a route into an account is the same category of action as
    // uploading one in the first place — it consumes one of the 5 slots and
    // grants ongoing control (visibility, rename, release) — so it's gated
    // the same way, not left as a back door around the upload check.
    const role = deps.store.getUserById(userId)?.role;
    if (!role || !canManageRoutes(role)) {
      return c.json({ error: 'Log in with an account that can add routes to do that.' }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const routeId = typeof body['routeId'] === 'string' ? body['routeId'] : '';
    if (!routeId) return c.json({ error: 'routeId is required.' }, 400);

    const visibility = deps.store.getRouteVisibility(routeId);
    if (!visibility) return c.json({ error: 'No route with that id.' }, 404);
    if (visibility.ownerId === userId) {
      return c.json({ error: 'Already saved.' }, 409);
    }
    if (visibility.ownerId) {
      // Not this rider's to claim — belongs to someone else's account.
      return c.json({ error: 'That route already belongs to another account.' }, 403);
    }

    const owned = deps.store.countRoutesOwnedBy(userId);
    if (owned >= MAX_SAVED_ROUTES) {
      return c.json(
        { error: `You have ${MAX_SAVED_ROUTES} saved routes already. Remove one before saving another.` },
        409,
      );
    }

    deps.store.claimRoute(routeId, userId);

    if (typeof body['name'] === 'string' && body['name'].trim()) {
      deps.store.renameRoute(routeId, body['name'].trim().slice(0, 120));
    }
    if (typeof body['isPublic'] === 'boolean') {
      deps.store.setRouteVisibility(routeId, body['isPublic']);
    }

    return c.json({ ok: true }, 201);
  });

  api.patch('/:id', async (c) => {
    const userId = c.get('userId');
    const routeId = c.req.param('id');

    const visibility = deps.store.getRouteVisibility(routeId);
    if (!visibility || visibility.ownerId !== userId) {
      return c.json({ error: 'No saved route with that id.' }, 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body['isPublic'] === 'boolean') {
      deps.store.setRouteVisibility(routeId, body['isPublic']);
    }
    if (typeof body['name'] === 'string' && body['name'].trim()) {
      deps.store.renameRoute(routeId, body['name'].trim().slice(0, 120));
    }

    return c.json({ ok: true });
  });

  api.delete('/:id', (c) => {
    const userId = c.get('userId');
    const routeId = c.req.param('id');
    const released = deps.store.releaseRoute(routeId, userId);
    if (!released) return c.json({ error: 'No saved route with that id.' }, 404);
    return c.json({ ok: true });
  });

  return api;
}
