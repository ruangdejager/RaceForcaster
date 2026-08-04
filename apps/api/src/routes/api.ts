import { buildRoute, RouteParseError, type Route } from '@raceforecaster/core';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
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

/** Errors we recognise get a useful message and status; anything else is a 500. */
function toHttpError(err: unknown): { status: 400 | 404 | 413 | 429 | 502 | 500; message: string } {
  if (err instanceof ValidationError) return { status: 400, message: err.message };
  if (err instanceof RouteParseError) return { status: 400, message: err.message };
  if (err instanceof MetError) {
    return { status: err.status === 429 ? 429 : 502, message: err.message };
  }
  if (err instanceof Error) return { status: 500, message: err.message };
  return { status: 500, message: 'Something went wrong.' };
}

function loadRoute(store: Store, id: string): Route {
  const json = store.getRoute(id);
  if (!json) throw new ValidationError(`No route with id "${id}". It may have been pruned.`);
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
      return c.json({ route: loadRoute(deps.store, c.req.param('id')) });
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
      const route = loadRoute(deps.store, routeId);
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
      const route = loadRoute(deps.store, routeId);
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

      const route = loadRoute(deps.store, share.routeId);
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
