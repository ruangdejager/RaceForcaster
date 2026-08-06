import { readFileSync } from 'node:fs';
import { buildRoute } from '@raceforecaster/core';
import { nanoid } from 'nanoid';
import type { Store } from '../db/index.js';

const DEFAULT_ROUTE_SETTING = 'default_route_id';

/**
 * Make sure the site has *some* default route to land on, on first boot.
 *
 * A no-op once `default_route_id` is set — this only ever runs the one time
 * a fresh database has never had a default configured. An admin changing it
 * afterwards (via the admin panel) is the normal path from then on; this is
 * only the bootstrap.
 *
 * Failure here is deliberately non-fatal: a missing or malformed seed file
 * means the app boots with no default route (the landing page falls back to
 * "upload one" for anyone who can), not a crashed server. Losing the whole
 * site over a bundling mistake in one GPX file would be a much worse outcome
 * than a slightly less polished landing page.
 */
export function seedDefaultRoute(store: Store, gpxPath: string): void {
  if (store.getSetting(DEFAULT_ROUTE_SETTING)) return;

  let xml: string;
  try {
    xml = readFileSync(gpxPath, 'utf8');
  } catch (err) {
    console.warn(`No default route seeded: could not read ${gpxPath} (${(err as Error).message}).`);
    return;
  }

  try {
    const id = nanoid(12);
    const { route } = buildRoute(xml, { id });
    store.saveRoute(id, route.name, JSON.stringify(route));
    store.setSetting(DEFAULT_ROUTE_SETTING, id);

    // If the founding admin account already exists at seed time, hand them
    // the route immediately rather than waiting for the next boot's
    // bootstrapFoundingAdmin pass to notice and claim it retroactively.
    const founder = store.getUserByUsername('ruandj');
    if (founder) store.claimRoute(id, founder.id);

    console.log(`Seeded default route "${route.name}" (${id}).`);
  } catch (err) {
    console.warn(`No default route seeded: ${(err as Error).message}`);
  }
}
