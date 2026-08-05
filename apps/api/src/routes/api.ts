import { buildRoute, RouteParseError, type Route } from '@raceforecaster/core';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { currentUserId } from '../auth/session.js';
import { MAX_UPLOAD_BYTES, type Config } from '../config.js';
import type { Store } from '../db/index.js';
import { MetError, type MetClient } from '../met/client.js';
import { computePlan } from '../services/planner.js';
import { parsePlanSettings, ValidationError } from './validate.js';

export interface ApiDeps {
  config: Config;
  store: Store;
  met: MetClient;
}

/**
 * A route that's missing and one that's private and not yours get the exact
 * same message and status. Distinguishing them would confirm to a stranger
 * that a given id refers to a real, private route — the whole point of
 * "private" is that its existence isn't confirmable by guessing the link.
 */
class RouteAccessError extends Error {}

/** Errors we recognise get a useful message and status; anything else is a 500. */
function toHttpError(err: unknown): { status: 400 | 404 | 413 | 429 | 502 | 500; message: string } {
  if (err instanceof ValidationError) return { status: 400, message: err.message };
  if (err instanceof RouteAccessError) return { status: 404, message: err.message };
  if (err instanceof RouteParseError) return { status: 400, message: err.message };
  if (err instanceof MetError) {
    return { status: err.status === 429 ? 429 : 502, message: err.message };
  }
  if (err instanceof Error) return { status: 500, message: err.message };
  return { status: 500, message: 'Something went wrong.' };
}

/** Loads a route, enforcing that a private one is only readable by its owner. */
function loadRoute(c: Context, store: Store, id: string): Route {
  const json = store.getRoute(id);
  const visibility = store.getRouteVisibility(id);
  if (!json || !visibility) {
    throw new RouteAccessError(`No route with id "${id}".`);
  }
  if (!visibility.isPublic) {
    const userId = currentUserId(c, store);
    if (!userId || userId !== visibility.ownerId) {
      throw new RouteAccessError(`No route with id "${id}".`);
    }
  }
  return JSON.parse(json) as Route;
}

export function createApi(deps: ApiDeps): Hono {
  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

  // --- Route upload --------------------------------------------------------

  api.post('/routes', async (c) => {
    try {
      const contentType = c.req.header('content-type') ?? '';
      let xml: string;
      let filename: string | undefined;

      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.parseBody();
        const file = form['file'];
        if (!(file instanceof File)) {
          return c.json({ error: 'Attach the route as a form field named "file".' }, 400);
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return c.json({ error: 'That file is too large.' }, 413);
        }
        xml = await file.text();
        filename = file.name;
      } else {
        xml = await c.req.text();
        if (xml.length > MAX_UPLOAD_BYTES) {
          return c.json({ error: 'That file is too large.' }, 413);
        }
      }

      const id = nanoid(12);
      const { route, warnings } = buildRoute(xml, { id });

      // Prefer the name inside the file. Only when it has none does the
      // filename stand in, with its extension stripped.
      if (!route.name || route.name === 'Route') {
        route.name = filename?.replace(/\.(gpx|tcx|xml)$/i, '') || 'Route';
      }

      deps.store.saveRoute(id, route.name, JSON.stringify(route));
      return c.json({ route, warnings });
    } catch (err) {
      const { status, message } = toHttpError(err);
      return c.json({ error: message }, status);
    }
  });

  api.get('/routes/:id', (c) => {
    try {
      return c.json({ route: loadRoute(c, deps.store, c.req.param('id')) });
    } catch (err) {
      const { status, message } = toHttpError(err);
      return c.json({ error: message }, status);
    }
  });

  // --- Plan computation ----------------------------------------------------

  api.post('/plans', async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const routeId = String(body['routeId'] ?? '');
      const route = loadRoute(c, deps.store, routeId);
      const settings = parsePlanSettings(body, route);

      const bundle = await computePlan(route, settings, deps.met);
      return c.json(bundle);
    } catch (err) {
      const { status, message } = toHttpError(err);
      return c.json({ error: message }, status);
    }
  });

  // --- Share links ---------------------------------------------------------

  api.post('/shares', async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const routeId = String(body['routeId'] ?? '');
      const route = loadRoute(c, deps.store, routeId);
      // Validate before saving, so a share link can never resolve to a plan
      // that won't compute.
      const settings = parsePlanSettings(body, route);

      const id = nanoid(10);
      deps.store.saveShare(id, routeId, JSON.stringify(settings));

      return c.json({ id, url: `${deps.config.publicBaseUrl}/s/${id}` });
    } catch (err) {
      const { status, message } = toHttpError(err);
      return c.json({ error: message }, status);
    }
  });

  api.get('/shares/:id', async (c) => {
    try {
      const share = deps.store.getShare(c.req.param('id'));
      if (!share) return c.json({ error: 'That share link no longer exists.' }, 404);

      const route = loadRoute(c, deps.store, share.routeId);
      const settings = parsePlanSettings(JSON.parse(share.settings), route);
      const bundle = await computePlan(route, settings, deps.met);

      // Everything needed to render the page in one request, since this is
      // what someone clicking a link from a group chat lands on.
      return c.json({ route, settings, ...bundle });
    } catch (err) {
      const { status, message } = toHttpError(err);
      return c.json({ error: message }, status);
    }
  });

  return api;
}
