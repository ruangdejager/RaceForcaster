import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { loadConfig } from './config.js';
import { Store } from './db/index.js';
import { MetClient } from './met/client.js';
import { createApi } from './routes/api.js';

const config = loadConfig();
const store = new Store(config.dbPath);
const met = new MetClient({
  userAgent: config.metUserAgent,
  maxRps: config.metMaxRps,
  store,
});

const app = new Hono();

app.use('*', logger());
// Plan responses carry the full forecast series for every sampled point, which
// is a few hundred kilobytes of very repetitive JSON. Compression takes it to
// a fraction of that, which matters on a phone signal at a race start.
app.use('*', compress());

app.route('/api', createApi({ config, store, met }));

// --- Static hosting -------------------------------------------------------
// In development Vite serves the front end and proxies /api here, so this only
// engages for a production build.
const webRoot = config.webRoot ?? resolve(process.cwd(), 'apps/web/dist');
const indexHtmlPath = join(webRoot, 'index.html');
const hasWebBuild = existsSync(indexHtmlPath);

if (hasWebBuild) {
  // Serve anything that exists in the build — hashed assets, the favicon, and
  // the bundled sample route. Listing directories individually is how the
  // sample ends up silently answered by the HTML fallback below, which only
  // shows up in production because Vite serves `public/` itself in dev.
  // serveStatic calls next() when there's no such file, so the SPA fallback
  // still gets its turn.
  app.use('*', serveStatic({ root: webRoot }));

  // Single-page app fallback: /s/<share-id> is a client route, not a file.
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return c.html(await readFile(indexHtmlPath, 'utf8'));
  });
} else {
  app.get('/', (c) =>
    c.text(
      'RaceForecaster API is running.\n\n' +
        'No web build found — run `npm run dev` and open http://localhost:5173,\n' +
        'or `npm run build` to produce one this server can host.\n',
    ),
  );
}

// Clear out forecasts nobody has asked for in a week. Hourly is plenty; the
// cache is small and this is only housekeeping.
const pruneTimer = setInterval(() => {
  try {
    store.prune();
  } catch (err) {
    console.error('Cache prune failed:', err);
  }
}, 3_600_000);
pruneTimer.unref();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`RaceForecaster API listening on http://localhost:${info.port}`);
  console.log(`  data:      ${config.dataDir}`);
  console.log(`  web build: ${hasWebBuild ? webRoot : '(none — use the Vite dev server)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
