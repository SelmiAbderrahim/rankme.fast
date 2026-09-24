# syntax=docker/dockerfile:1.7

# ---------- build stage ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src

ARG APP_BUILD_SHA=dev
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
RUN npm run build


# ---------- prod-deps stage ----------
# Clean production node_modules — npm prune leaves dev artifacts
# (vitest, drizzle-kit, @electric-sql/pglite, vite, esbuild) behind.
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev


# ---------- runtime stage ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tini; \
    rm -rf /var/lib/apt/lists/*

# Non-root user created BEFORE the COPYs so --chown lands in the same layer
# (a trailing `chown -R` would duplicate ~387 MB into a new layer).
RUN groupadd --system --gid 10001 app \
 && useradd  --system --uid 10001 --gid app --home /app --shell /usr/sbin/nologin app

COPY --chown=app:app --from=prod-deps /app/node_modules ./node_modules
COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app --from=build /app/package.json ./package.json
# Drizzle SQL migrations — applied at boot by src/db/migrate.ts (cwd /app,
# so the runner's relative "drizzle" folder resolves here).
COPY --chown=app:app drizzle ./drizzle
USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT || 8080) +'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# tini runs as PID 1 and reaps orphaned children (e.g. healthcheck `node -e`
# probes killed on timeout). Node as PID 1 never reaps them, so zombies pile
# up until the host process table is exhausted. `-s` keeps reaping even when
# Compose `init: true` already provides an outer init.
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "dist/server.cjs"]
