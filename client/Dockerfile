# syntax=docker/dockerfile:1.7

# ---------- build stage ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Vite build-time env — sourced from compose build args, never literal.
ARG VITE_API_BASE_URL
ARG VITE_APP_URL
ARG VITE_SITE_URL
ARG VITE_GA_ID
ARG VITE_GITHUB_URL
ARG VITE_RELEASE_STAGE
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_APP_URL=${VITE_APP_URL} \
    VITE_SITE_URL=${VITE_SITE_URL} \
    VITE_GA_ID=${VITE_GA_ID} \
    VITE_GITHUB_URL=${VITE_GITHUB_URL} \
    VITE_RELEASE_STAGE=${VITE_RELEASE_STAGE}

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html server.js docs-runtime.js ./
COPY public ./public
COPY src ./src

# Produces dist/client (browser bundle + index.html) and dist/server (SSR bundle).
ARG APP_BUILD_SHA=dev
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
RUN npm run build:client && npm run build:server


# ---------- prod-deps stage ----------
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev


# ---------- runtime stage ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY server.js docs-runtime.js ./
COPY --from=build /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# tini runs as PID 1 and reaps orphaned children (e.g. healthcheck `node -e`
# probes killed on timeout). Node as PID 1 never reaps them.
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "server.js"]
