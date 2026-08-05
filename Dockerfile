# syntax=docker/dockerfile:1

# ---- Build ------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Manifests first, so a source-only change reuses the cached dependency layer.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- Runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data

# The API is bundled into a single file with every dependency inlined, and the
# database is Node's built-in `node:sqlite`, so there is nothing to install
# here: no node_modules, no native module, no build toolchain in the image.
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /app/data

# Runs as root rather than dropping to the `node` user: a platform-mounted
# volume (Railway, or any other host that mounts a real disk over /app/data
# at container start) replaces that directory's ownership with whatever the
# platform defaults to — usually root — which a `chown` baked into the image
# at build time can never see or affect, since it only touches the image's
# own throwaway copy of the path. A non-root user then can't create the
# SQLite file there: `mkdirSync` doesn't catch it (the mount point already
# exists), so it fails later and more confusingly, inside `new DatabaseSync`.
# Staying root sidesteps needing a start-time chown via an entrypoint script,
# which is the usual fix but adds a moving part this single-process app
# doesn't otherwise need.

EXPOSE 8787
# No VOLUME instruction here: Railway's builder rejects it outright ("use
# Railway Volumes" instead), and it would be redundant anyway once a volume is
# mounted at /app/data from the platform side — Docker's own local dev/compose
# workflow gets its persistence from docker-compose.yml's own volumes: entry,
# not from a Dockerfile VOLUME declaration.

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings=ExperimentalWarning", "apps/api/dist/index.js"]
