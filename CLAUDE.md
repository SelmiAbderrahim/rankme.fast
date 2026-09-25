# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# RankMeFast — Claude Code Guide

## 1. Project Overview

**RankMeFast** is a self-hosted, open-source (AGPL-3.0) SEO platform. Operators supply their own vendor keys; the app buys raw SEO signal from vendor APIs (DataForSEO including Lighthouse lab scans, Google Search Console/Analytics and optional PSI/CrUX, optionally Anthropic Claude for AI summaries) behind a provider interface, cache aggressively, and ship a plain-language report. The product is self-hostable — one `docker compose up` boots the whole stack. There is no "install on customer host" agent, no Docker socket access, no VPS orchestration; every external signal comes through a typed provider adapter.

Users authenticate against the app (Better Auth, email+password or Google OAuth), add a site, run an audit (crawl → rule engine → fix-now list + optional Claude summary), track rank and Lighthouse lab results over time (plus CrUX when the Google field-data provider is configured), connect Google Search Console for URL Inspection, research keywords, and inspect backlinks/competitors.

## 2. Stack

**Client** (`client/`)
- React 18 + ReactDOM 18 (SPA dashboard; SSR public docs — see §9). The self-hosted edition ships no marketing/landing site: `/` and each locale root redirect to `/login`.
- Redux Toolkit 2, react-redux 9 — feature slices under `features/<name>/store/`
- React Router 6 (`createBrowserRouter` for SPA; `createStaticHandler` + `renderToString` for SSR)
- Native `fetch` via `shared/api/client.ts` — no axios; always `credentials: 'include'`
- Vite 6, TypeScript 5 (strict)
- **Tailwind CSS v4** (CSS-first, `@tailwindcss/vite`; tokens in `client/src/styles/tailwind.css` — no `tailwind.config.js`)
- **shadcn/ui** (Radix, `new-york` style) primitives under `client/src/shared/ui/` — imported via `@shared/ui/*`
- **Better Auth** React client (`better-auth/react`, `useAuthSession()` — no Redux mirror of auth state)
- **i18n** via `i18next` + `react-i18next`, 7 locales (`en, ar, fr, de, es, ru, zh`) with `navigator.language` auto-detect and RTL for `ar`
- react-helmet-async for SSR meta / OG / hreflang / JSON-LD
- Vitest + React Testing Library + jsdom
- zod for form/API validation
- lucide-react icons (no emoji as icons)

**Server** (`server/`)
- Express 4 + TypeScript 5
- **Mongoose 8** — the default document store (users mirror, sites, audit runs, snapshots)
- **Drizzle ORM + PostgreSQL 17** — scoped exception for relational, ordered time-series data (rank history, keywords, backlinks, competitors, subscriptions, usage counters). Migrations under `server/drizzle/`, generated via `drizzle-kit generate` and auto-applied on boot.
- **Better Auth 1.6** with the Drizzle/PostgreSQL adapter — owns sessions, scrypt hashing, CSRF (Origin / trusted-origins), email verification, password reset, Google OAuth. Mounted at `/api/auth/*` BEFORE `express.json()`.
- **BullMQ 5 + Redis 7** — `audits` and `ranks` queues consumed by a dedicated `worker` deployable (`server/src/worker.ts` → `dist/worker.cjs`). Dead-letter queue on terminal failure.
- **Vendor provider registry** — `server/src/shared/providers/` — every vendor call goes through a typed capability interface (`audit`, `rank`, `keyword`, `backlink`, `competitor`, `pagespeed`, `gsc`, `summary`, `contentSource`, `contentMonitor`, `appData`). `PROVIDER_<capability>=fake` boots deterministic test/demo fixtures; production refuses any fake backend unless `ALLOW_FAKE_PROVIDERS=true` is explicitly set. Feature modules import the interface, never a vendor SDK (ESLint-restricted).
- **Resend** transactional email
- **Socket.IO 4** (present; not currently used by product routes)
- **pino / pino-http** structured logging
- zod for env validation (`src/config/env.ts`)
- AES-256-GCM envelope for at-rest secrets (`shared/crypto/`, `MASTER_ENCRYPTION_KEY`)
- Vitest + supertest for integration tests; `mongodb-memory-server` + PGlite (WASM Postgres) for in-process datastores
- Playwright + `@axe-core/playwright` E2E + accessibility smoke against the composed stack

**Ops**
- Docker Compose (`mongo`, `postgres`, `redis`, `api`, `worker`, `web`) — internal `rankme` network; every secret comes from the ignored root `.env`
- CI: `.github/workflows/ci.yml` in `node:20-bookworm` containers; gates typecheck → lint → skip-policy → vitest + 100% v8 coverage → `npm audit --audit-level=high` (zero high/critical, no allow-list) → `docker compose build` → Playwright smoke + axe

## 3. Repo Layout

```
rankme.fast/
├── client/
│   ├── server.js                 # Node SSR entrypoint — renders public docs, redirects / → /login
│   └── src/
│       ├── app/                  # store.ts, routes.tsx, providers
│       ├── entry-client.tsx      # SPA hydrate (dashboard)
│       ├── entry-server.tsx      # SSR renderToString (docs, portals, shares)
│       ├── features/             # auth, sites, ranks, report, keyword-research,
│       │                         # backlinks, competitors, google, billing,
│       │                         # docs, dashboard, admin, superadmin
│       │   └── <name>/
│       │       ├── components/
│       │       ├── store/        # slice.ts, thunks.ts, selectors.ts (RTK)
│       │       ├── api.ts        # feature-scoped fetch calls via apiClient
│       │       ├── types.ts
│       │       ├── routes.tsx    # route array; spread into app/routes.tsx
│       │       └── index.ts      # named re-exports only (public API)
│       ├── shared/
│       │   ├── api/client.ts     # ApiError, apiClient<T>, credentials: 'include'
│       │   ├── hooks/redux.ts    # useAppSelector / useAppDispatch
│       │   ├── i18n/             # locales/{en,ar,fr,de,es,ru,zh}/*.json + resources.ts
│       │   ├── lib/utils.ts      # cn() (shadcn helper)
│       │   ├── seo/              # JSON-LD schema builders, hreflang helpers
│       │   ├── theme/            # ThemeProvider (.dark class, no-flash head script)
│       │   └── ui/               # shadcn primitives (vendored; excluded from coverage)
│       └── styles/tailwind.css   # design tokens (§5 → design-system rule)
├── server/
│   ├── drizzle/                  # generated SQL migrations + drizzle-kit journal
│   └── src/
│       ├── app.ts                # createApp() — middleware, route mounts
│       ├── server.ts             # entrypoint — runMigrations, connect Mongo, listen
│       ├── worker.ts             # second deployable — BullMQ consumers + /healthz
│       ├── config/               # env.ts (zod), db.ts, logger.ts
│       ├── db/                   # Drizzle client, migrations, schema/*, counters
│       ├── modules/
│       │   ├── actions/          # unified Next Actions — cross-source finding registry + append-only decision events
│       │   ├── admin/            # admin panel — user list, MRR, webhook replay, providers (Admin-role, 404 for non-admins)
│       │   ├── alerts/           # alert rules + channels (email / Slack / signed webhook) — AAD-bound channel secrets, exactly-once dispatch
│       │   ├── ai-visibility/    # tracked-prompt AI Overview + LLM-mention checks, share-of-voice rollup
│       │   ├── api-keys/         # public-API key management (agency-gated; sha256-hashed keys, show-once)
│       │   ├── app-seo/          # site-scoped mobile app profiles + App Store Optimization workspace surfaces
│       │   ├── audience-research/ # audience research pipeline — public-page discovery + AI clustering
│       │   ├── audit/            # append-only audit log (owner-scoped read)
│       │   ├── audits/           # audit pipeline — vendor crawl + rule engine
│       │   ├── auth/             # Better Auth instance + verified-email gate
│       │   ├── backlinks/        # backlinks provider surface
│       │   ├── brand-radar/      # Brand Radar mention scans — scan CRUD
│       │   ├── cannibalization/ # GSC keyword cannibalization reports — stored `query,page` snapshots only, zero vendor spend
│       │   ├── chat/             # AI Assistant streaming chat — SSE at /api/chat, CHAT_ENABLED kill switch, `ai_chat_messages` metering, MCP tool reuse
│       │   ├── client-reports/   # White-label client reports — deterministic PDF composition, schedules, delivery logs, and revocable read-only portals
│       │   ├── communication/    # Resend mailer + localized templates
│       │   ├── competitors/      # competitors provider surface
│       │   ├── content-briefs/   # SERP-grounded content briefs + editor
│       │   ├── content-intelligence/ # AI content recommendations from mixed evidence sources
│       │   ├── competitor-content/ # Competitor content comparison — bounded scrapes + deterministic deltas
│       │   ├── content-monitoring/ # Public-page change monitoring — Firecrawl webhooks + weekly checks + change detection
│       │   ├── geogrid/          # local-pack geogrid rank scans
│       │   ├── ga4-snapshots/    # GA4 daily metrics snapshot repository (Postgres)
│       │   ├── google-connections/ # GSC OAuth link/unlink + inspection
│       │   ├── gsc-snapshots/    # GSC daily Search-Analytics + sitemap snapshot repository (Postgres)
│       │   ├── health/           # /api/health, /api/metrics
│       │   ├── internal-links/   # internal linking suggestions — stored inventory + GSC evidence, one bounded AI anchor pass
│       │   ├── keyword-clusters/ # SERP-overlap keyword clustering — deterministic readiness, bounded AI labels, and persisted cluster runs
│       │   ├── keyword-research/ # keyword provider + cache
│       │   ├── legal/            # data-rights (export / delete + grace period)
│       │   ├── local-seo/        # NAP/reviews/Q&A snapshots + local-pack rank tracking
│       │   ├── market-catalog/   # authenticated provider-market catalogs used by client pickers
│       │   ├── mcp/              # RankMeFast MCP endpoint — MCP_ENABLED kill switch, api-key auth, `mcp` rate bucket, tool list generated from zod
│       │   ├── mcp-permissions/  # account-level MCP permission defaults — per-tool toggles, allowed-sites, allow-spend (intersected with per-key scopes)
│       │   ├── public-api/       # read-only /api/v1 (bearer API-key auth, rate-limited)
│       │   ├── ranks/            # SERP tracking, ranks history, cache policy, Bing/YouTube/Amazon engines
│       │   ├── report-exports/   # canonical report export adapters, immutable snapshots, and bounded downloads
│       │   ├── schema-generator/ # schema.org markup generator — versioned seven-type registry, evidence assembly, deterministic conformance
│       │   ├── seo/              # /robots.txt, /sitemap*.xml
│       │   ├── sites/            # Site model + URL validation
│       │   ├── superadmin/       # platform control plane — all-tenant lists + CSV export + role/refund/replay (SuperAdmin-role, 404 for everyone else)
│       │   ├── superadmin-intelligence/ # intelligence observability plane — safe DTOs for overview/providers/costs/quality/queues/monitors + kill switches, requeue/reconcile/cache-invalidate under step-up re-auth
│       │   ├── team/             # seats + invites (owner-scoped list, 402-gated invite, single-use tokens)
│       │   ├── users/            # domain profile (Mongo mirror of Better Auth users)
│       │   └── weekly-pulse/     # weekly AI-visibility pulse — scheduler, collection, citation changes, digest delivery
│       └── shared/
│           ├── crypto/           # AES-256-GCM envelope
│           ├── docs/             # /docs static handler
│           ├── i18n/             # 7-locale typed dictionaries + resolveLanguage
│           ├── middleware/       # error-handler, require-auth, request-id, rate limits, CSRF
│           ├── providers/        # provider registry + capability interfaces + fixtures
│           ├── queue/            # BullMQ connection + queue names
│           ├── testing/          # mongo.ts (memory-server), postgres.ts (PGlite)
│           ├── types/            # express.d.ts augmentations
│           ├── utils/            # http-error.ts, async-handler.ts
│           └── validation/       # shared zod schemas
├── docs/                         # user docs — every slug in all 7 locales (served by web via ./docs:/docs:ro)
├── ops/                          # operator-only material (ci-gates runbook + rollout runbooks; never served, English-only)
├── scripts/                      # one-off ops scripts
├── .claude/                      # Claude Code rules, skills, agents
├── docker-compose.yml
├── .env                          # single source of truth (root only)
└── .env.example
```

## 4. How to Run

**Docker-first.** The stack is designed to run under `docker compose up`. Host `npm` is fine for typecheck / lint / vitest iteration, but the CI gate and Playwright smoke run against the composed stack.

```bash
# Copy env template and fill in secrets DIRECTLY in the root .env
# (MASTER_ENCRYPTION_KEY, BETTER_AUTH_SECRET, vendor credentials). There is no ./secrets/
# Docker-secret mechanism — an empty secret file used to silently override a
# real .env value, so .env is now the single source (see §5 environment rule).
cp .env.example .env
openssl rand -hex 32   # paste into MASTER_ENCRYPTION_KEY= in .env

# Boot every service (mongo, postgres, redis, api, worker, web)
docker compose up -d --build
docker compose ps                    # every container should be healthy

# Follow logs
docker compose logs -f api worker web

# Tear down (keep volumes)
docker compose down

# Host iteration (optional — CI parity is Docker)
npm --prefix server install
npm --prefix client install
npm --prefix server run dev          # tsx watch src/server.ts
npm --prefix client run dev          # vite (SPA dev server)

# Typecheck
npm --prefix server run typecheck
npm --prefix client run typecheck

# Lint (ESLint restricts vendor SDK imports outside shared/providers)
npm --prefix server run lint
npm --prefix client run lint

# Full test suite with coverage (100% v8 on lines/branches/functions/statements)
npm --prefix server exec -- vitest run --coverage
npm --prefix client exec -- vitest run --coverage

# Single test file
npm --prefix server exec -- vitest run src/modules/audits/audits.test.ts
npm --prefix client exec -- vitest run src/features/report/report.test.tsx

# Drizzle — generate a migration after editing server/src/db/schema/*
npm --prefix server run db:generate
# Migrations auto-apply on boot (server.ts → runMigrations() before listen).

# Production build
npm --prefix server run build        # tsup → dist/server.cjs + dist/worker.cjs
npm --prefix client run build        # tsc --noEmit && vite build
```

**Root `.env` is the single source of truth.** Never create `.env` files in subdirectories.

| Variable | Required | Purpose |
|----------|----------|---------|
| `APP_BUILD_SHA` | no | Build-only short Git SHA (7–12 hex digits), default `dev`; web/api/worker use package version + SHA (for example `2.0.0+dev`). Rebuild all three together. |
| `VITE_APP_VERSION` | generated | Vite derives this from `client/package.json` and `APP_BUILD_SHA`; never set manually. Server health uses `server/package.json` and the same baked SHA. |
| `NODE_ENV` | yes | `production` / `development` / `test` |
| `PORT` | yes | api HTTP port (default `8080`) |
| `WEB_PORT` | yes | host port for the SSR `web` container (default `3000`) |
| `LOG_LEVEL` | no | pino level; default `info` |
| `MONGODB_URI` | yes | Mongo connection (compose: `mongodb://mongo:27017/rankme`) |
| `REDIS_URL` | yes | Redis connection (compose: `redis://redis:6379`) — BullMQ queues |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | compose provisioning |
| `DATABASE_URL` | yes | Drizzle/Postgres connection — must match POSTGRES_* |
| `PG_POOL_MAX` | no | postgres-js pool size per process (api + worker); default 10 |
| `BETTER_AUTH_SECRET` | yes | session signing (≥32 chars; `openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google OAuth (login + GSC linking); provider registered only when BOTH set |
| `CLIENT_URL` | yes | public marketing origin (canonical URLs and public links) |
| `APP_URL` | no | authenticated app origin; defaults to `CLIENT_URL` for single-origin deployments |
| `SERVER_URL` | yes | public api origin (OAuth redirect base) |
| `GITHUB_REPOSITORY_URL` | no | public repository URL listed in `/llms.txt` (https only). Defaults to the upstream repository in `.env.example`; blank omits it. Keep in sync with `VITE_GITHUB_URL` |
| `DEFAULT_LOCALE` | no | server-side fallback when Accept-Language / cookie are missing; one of the 7; default `en` |
| `VITE_API_BASE_URL` | yes | client build-time api base (default `/api` so browser calls stay same-origin through the web→api proxy) |
| `VITE_SOCKET_URL` | no | optional client socket origin; absolute values are added to the web CSP `connect-src` |
| `VITE_SITE_URL` | yes | public origin used for canonical / OG / hreflang / sitemap URLs |
| `VITE_GA_ID` | no | Google Analytics 4 measurement ID (e.g. `G-XXXXXXXXXX`) baked into `index.html` at build; blank disables. GA loader/beacon hosts are allow-listed in the web SSR CSP |
| `VITE_GITHUB_URL` | no | public GitHub repository URL, baked into the client bundle at build. Defaults to the upstream repository in `.env.example`. Drives the header GitHub chip, AGPL license badge, `git clone` line, and the beta banner's GitHub issue link; blank removes every open-source element and routes bug reports to the support mailbox |
| `VITE_RELEASE_STAGE` | no | release stage baked into the client bundle at build: `beta` (default) renders the shared public-beta banner and header badge on marketing and app surfaces; `ga` removes both. The api reads the same value (compose `api` env) to add or drop the `Status: public beta` line in `/llms.txt`. Blank or any other value resolves to `beta` |
| `API_INTERNAL_URL` | yes | web SSR → api reverse-proxy origin (compose: `http://api:8080`) |
| `MASTER_ENCRYPTION_KEY` | yes | AES-256-GCM key for secrets at rest (≥32 bytes decoded; hex/base64/utf8 accepted); set the value directly in the root `.env` |
| `RESEND_API_KEY` / `RESEND_FROM` | no | transactional email; set the value directly in the root `.env`; missing key → `sendEmail` logs and returns `{ delivered: false }` |
| `CONTACT_FORM_RECIPIENT` | no | inbox that receives `/api/contact` submissions; falls back to `RESEND_FROM`; if both unset, `deliverContactForm` throws |
| `ALERT_WEBHOOK_URL` | no | JSON POST target for failure alerts (in addition to Resend) |
| `RATE_LIMIT_AUTH_WINDOW_MS` / `RATE_LIMIT_AUTH_MAX` | no | `/api/auth/*` credential-mutation limiter (read-only `get-session` GETs exempt); defaults 900_000 / 30 |
| `RATE_LIMIT_METRICS_WINDOW_MS` | no | admin-overview aggregation window for `rate_limit_hits` (429 pressure card); default 3_600_000 (1h) |
| `RATE_LIMIT_API_WINDOW_MS` / `RATE_LIMIT_API_MAX` | no | public `/api/v1` limiter, keyed per bearer token (sha256; IP fallback); defaults 60_000 / 120 |
| `RATE_LIMIT_REPORT_EXPORT_PUBLIC_WINDOW_MS` / `_IP_MAX` / `_TOKEN_MAX` | no | immutable public report-share limiters; 60-second window, 60 requests/IP before lookup and 120 requests/proven token digest |
| `RATE_LIMIT_ENTERPRISE_LEAD_WINDOW_MS` / `RATE_LIMIT_ENTERPRISE_LEAD_MAX` | no | public `/api/enterprise-leads` contact-sales limiter, strict per-IP; defaults 3_600_000 / 5 |
| `RATE_LIMIT_CONTACT_WINDOW_MS` / `RATE_LIMIT_CONTACT_MAX` | no | `/api/communication/contact` limiter, per-IP; defaults 900_000 / 5 |
| `RATE_LIMIT_CONTENT_CREATE_*` / `RATE_LIMIT_RECOMMENDATION_*` / `RATE_LIMIT_INVENTORY_*` / `RATE_LIMIT_COMPETITOR_*` | no | Intelligence workflow named per-account buckets; defaults 10 / 60 / 5 / 30 per minute |
| `RATE_LIMIT_LINK_INTEL_WINDOW_MS` / `RATE_LIMIT_LINK_INTEL_MAX` / `RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS` / `RATE_LIMIT_LINK_INTEL_POLL_MAX` | no | Link Intelligence named per-account buckets — preview preflights plus four deep pulls and link-gap starts share the mutation bucket (60_000 / 30); stored run/gap reads use the independent poll bucket (60_000 / 60). Both report under the existing `link_intel` metrics route. |
| `RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS` / `RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX` | no | Traffic Insights snapshot POST bucket, keyed per account; defaults 60_000 / 10 |
| `RATE_LIMIT_REVIEW_SYNC_WINDOW_MS` / `RATE_LIMIT_REVIEW_SYNC_MAX` | no | Review Intelligence mutation bucket, shared per account across review-source CRUD and sync submits; defaults 60_000 / 20 |
| `RATE_LIMIT_BRAND_RADAR_CREATE_WINDOW_MS` / `RATE_LIMIT_BRAND_RADAR_CREATE_MAX` / `RATE_LIMIT_BRAND_RADAR_POLL_WINDOW_MS` / `RATE_LIMIT_BRAND_RADAR_POLL_MAX` | no | Brand Radar named per-account buckets — paid scan creation (`POST /api/brand-radar/preview`, `POST /api/brand-radar/scans`) defaults 60_000 / 10; stored-scan reads (GET list + detail) defaults 60_000 / 60 |
| `RATE_LIMIT_CONTENT_POLL_WINDOW_MS` / `RATE_LIMIT_CONTENT_POLL_MAX` | no | Content Intelligence read/poll bucket (GET list + GET detail); defaults 60_000 / 60 |
| `CONTENT_ANALYSIS_COST_CEILING_MICROS` / `CONTENT_ANALYSIS_AI_BUDGET_MICROS` / `CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS` | no | Content Intelligence per-analysis cost ceiling (default 250_000 micros USD), AI sub-budget (default 140_000), snapshot TTL (default 7 days) |
| `CONTENT_INVENTORY_MAX_PAGES` | no | Content inventory hard operator ceiling on a run's requested owned-page crawl limit; per-run `pageLimit` is zod-clamped to `1..CONTENT_INVENTORY_MAX_PAGES`. Default 100 |
| `RATE_LIMIT_FIRECRAWL_WEBHOOK_*` / `RATE_LIMIT_MCP_*` / `RATE_LIMIT_SUPERADMIN_*` | no | Firecrawl per-IP, MCP per-token/IP, and superadmin per-account named buckets; defaults 120 / 120 / 60 per minute |
| `RATE_LIMIT_CHAT_WINDOW_MS` / `RATE_LIMIT_CHAT_MAX` | no | AI Assistant `chat` named per-account bucket over every `/api/chat` route; each message POST opens an SSE stream and reserves an `ai_chat_messages` unit, so the bucket is tight. Defaults 60_000 / 20 |
| `MCP_ENABLED` / `CONTENT_INTELLIGENCE_ENABLED` / `CONTENT_INVENTORY_ENABLED` / `COMPETITOR_CONTENT_INTELLIGENCE_ENABLED` / `COMPETITOR_INTELLIGENCE_ENABLED` / `CONTENT_MONITORING_ENABLED` | no | Content Intelligence + MCP rollout / emergency-rollback flags. Default true. Disabling any flag returns the localized product-unavailable response on new-run entry points; existing result reads stay available and already-queued/running jobs finish to a consistent terminal state. Superadmin surfaces the resolved values read-only. |
| `CHAT_ENABLED` | no | AI Assistant kill switch. Default true. Disabling returns the localized unavailable response on new-message sends; conversation reads stay available. |
| `AI_CHAT_MAX_OUTPUT_TOKENS` / `AI_CHAT_TOTAL_TIMEOUT_MS` / `AI_CHAT_MAX_STEPS` | no | AI Assistant streaming chat knobs — per-message output-token ceiling (mirrored by the `ai_chat_messages` vendor-cost envelope), whole-stream wall clock, and the multi-step tool-loop bound. Defaults 2048 / 120_000 / 5 |
| `PROXY_STREAM_TIMEOUT_MS` | no | web-container-only: upstream fetch timeout for the AI Assistant SSE stream proxy route (chat message POSTs) in `client/server.js`; never read by the api's `env.ts`. Default 300000 (5 min) |
| `BRAND_RADAR_ENABLED` / `REVIEW_INTELLIGENCE_ENABLED` / `LINK_INTELLIGENCE_ENABLED` / `TRAFFIC_INSIGHTS_ENABLED` / `KEYWORD_TRENDS_ENABLED` | no | Rollout flags. All default false — each is a declared seam a later prompt reads before serving its feature entry points. Disabling any flag returns the localized product-unavailable response on new-run entry points; stored-result reads stay available and already-queued/running jobs finish to a consistent terminal state. Superadmin surfaces the resolved values read-only. |
| `SERP_FEATURE_TRACKING_ENABLED` / `KEYWORD_CLUSTERING_ENABLED` / `ALT_ENGINE_TRACKING_ENABLED` / `CANNIBALIZATION_ENABLED` / `TOXIC_LINKS_ENABLED` / `ALERTS_ENABLED` / `INTERNAL_LINKING_ENABLED` / `CONTENT_BRIEFS_ENABLED` / `GEOGRID_ENABLED` / `SCHEMA_GENERATOR_ENABLED` / `CLIENT_REPORTS_ENABLED` / `PUBLIC_EXPORTS_ENABLED` | no | Rollout flags. All default false — each is a declared seam a later prompt reads before serving its feature entry points. Disabling any flag returns the localized product-unavailable response on new-run entry points; stored-result reads stay available and already-queued/running jobs finish to a consistent terminal state. Superadmin surfaces the resolved values read-only. |
| `CONTENT_BRIEF_COST_CEILING_MICROS` / `INTERNAL_LINKING_COST_CEILING_MICROS` / `TOXICITY_COST_CEILING_MICROS` / `SCHEMA_GEN_COST_CEILING_MICROS` | no | Per-run direct-cost ceilings in micros USD. Positive integers; defaults 120000 / 12000 / 30000 / 6000. |
| `APP_SEO_ENABLED` / `APP_KEYWORD_TRACKING_ENABLED` / `APP_LISTING_AUDITS_ENABLED` / `APP_CHART_TRACKING_ENABLED` / `APP_RESEARCH_ENABLED` / `APP_REVIEWS_ENABLED` | no | Rollout flags. All default false — each is a declared seam a later prompt reads before serving its feature entry points. `APP_SEO_ENABLED` is the master switch over app profiles and every `/api/sites/:siteId/apps/*` entry point (the zero-spend cross-store comparison view rides it too); the other five gate their own surface underneath it. Disabling any flag returns the localized product-unavailable response on new-run entry points; stored-result reads stay available and already-queued/running jobs finish to a consistent terminal state. Superadmin surfaces the resolved values read-only. |
| `APP_REVIEW_AI_COST_CEILING_MICROS` | no | Per-run AI ceiling in micros USD — `maxCostMicros` for the `app_review_clusters` profile. Positive integer; default 40000. Mirrored by the `app_review_runs` vendor unit-cost row (12 Apple review blocks 18000 + this 40000 = 58000) so the enforced pre-dispatch halt and the margin math cite one number. |
| `RATE_LIMIT_APP_SEO_CREATE_WINDOW_MS` / `RATE_LIMIT_APP_SEO_CREATE_MAX` / `RATE_LIMIT_APP_SEO_POLL_WINDOW_MS` / `RATE_LIMIT_APP_SEO_POLL_MAX` | no | Named per-account buckets — every paid ASO submit shares the create bucket (defaults 60_000 / 10) so one account cannot fan spend across the six panels; zero-cost stored reads use the independent poll bucket (defaults 60_000 / 60). |
| `CSRF_COOKIE_NAME` / `CSRF_HEADER_NAME` | no | double-submit CSRF; both default `x-csrf-token` |
| `ACCOUNT_DELETION_GRACE_HOURS` | no | data-rights purge grace; default 720 (30 days) |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` / `DATAFORSEO_BASE_URL` | when live vendor | DataForSEO credentials + base URL (prod default / sandbox drop-in) |
| `ALLOW_FAKE_PROVIDERS` | no | explicit production test/demo escape hatch. Defaults false; when `NODE_ENV=production`, every `PROVIDER_*=fake` selector and `EMAIL_TRANSPORT=fake` fails startup unless this is true. CI/E2E sets true while blanking every live credential; real deployments keep false. |
| `E2E_EMAIL_CAPTURE` | no | isolated Playwright-only fake-mail capture. Requires `EMAIL_TRANSPORT=fake` and `ALLOW_FAKE_PROVIDERS=true`; writes only to a bounded mode-0600 file inside the API container and defaults false. |
| `PROVIDER_AUDIT` / `PROVIDER_RANK` / `PROVIDER_KEYWORD` / `PROVIDER_BACKLINK` / `PROVIDER_COMPETITOR` / `PROVIDER_LOCAL_LISTINGS` / `PROVIDER_PAGESPEED` / `PROVIDER_GSC` / `PROVIDER_GA4` / `PROVIDER_SUMMARY` / `PROVIDER_AI_VISIBILITY` / `PROVIDER_CONTENT_SOURCE` / `PROVIDER_CONTENT_ANALYSIS` / `PROVIDER_REVIEWS` / `PROVIDER_TRENDS` / `PROVIDER_APP_DATA` | no | per-capability selection; default `fake` (unknown/unshipped values fail startup loudly). PageSpeed accepts `dataforseo` (Lighthouse lab data only), `google` (PSI + CrUX), or `fake`. `PROVIDER_CONTENT_ANALYSIS` and `PROVIDER_REVIEWS` are provider seams; `PROVIDER_TRENDS` is the Google Trends seam. `PROVIDER_APP_DATA` selects the mobile-store seam; `google_play` or `app_store` remains an operation input. Adapter selection `dataforseo` requires `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` and fails startup otherwise. |
| `FIRECRAWL_API_KEY` / `FIRECRAWL_FALLBACK_API_KEYS` / `FIRECRAWL_BASE_URL` | when `PROVIDER_CONTENT_SOURCE=firecrawl` | Firecrawl v2 Cloud primary credential, optional ordered comma-separated fallback accounts (maximum 5), and operator-configured HTTPS Cloud origin. Only 401/402/429 advance; accepted crawls/monitors remain pinned; self-hosted endpoints unsupported |
| `FIRECRAWL_TIMEOUT_MS` / `FIRECRAWL_MAX_PAGE_CHARS` / `FIRECRAWL_MAX_CRAWL_PAGES` / `FIRECRAWL_COST_MICROS_PER_CREDIT` | no | content-source timeout, response/page ceilings, and configured estimated micros per reported credit. |
| `FIRECRAWL_ZDR_ENABLED` | when `PROVIDER_CONTENT_SOURCE=firecrawl` | Operator attestation that every configured Firecrawl Cloud account has Zero Data Retention enabled; strict `"true" \| "false"`; env validation refuses live selection unless `true` even though every request also sends `zeroDataRetention: true` |
| `FIRECRAWL_WEBHOOK_SECRET_BINDINGS` | when `CONTENT_MONITORING_ENABLED` && `firecrawl` content source | JSON bindings from `primary` / `fallback:N` credential slots to one or two current/previous HMAC secrets. Every configured API key needs exactly one binding and a secret may belong to only one credential. `FIRECRAWL_WEBHOOK_SECRET(S)` are parsed/redacted legacy migration inputs but no longer authorize deliveries; remove them from the external secret store after rollout. |
| `CONTENT_MONITOR_RECON_INTERVAL_MS` | no | Content-monitor reconciliation sweep interval (weekly `content_monitor_checks` reservation + provider-drift + stuck-receipt re-enqueue); default 300000 (5 min) |
| `ALERT_SWEEP_INTERVAL_MS` | no | Alert detection sweep interval. Read-only scan of settled `rank_drop_confirmations` that enqueues `alert-dispatch` jobs; never writes that table and cannot re-deliver, so this is purely a latency knob. Default 300000 (5 min) |
| `PROVIDER_AI` / `AI_PROVIDER_ORDER` / `AI_TOTAL_TIMEOUT_MS` / `AI_MAX_ATTEMPTS` / `AI_TELEMETRY_ENABLED` | no | structured AI runtime; default keyless `fake`; live order defaults `glm,deepseek,kimi,openai,google,anthropic`; SDK telemetry defaults off and never records inputs/outputs |
| `AI_ACCOUNT_SPEND_WINDOW_MS` / `AI_ACCOUNT_SPEND_LIMIT_MICROS` / `AI_USAGE_RETENTION_DAYS` | no | rolling per-account spend circuit (default 1h / 1,000,000 micros) and daily safe-event retention (90 days) |
| `<GLM|DEEPSEEK|KIMI|OPENAI|GOOGLE|ANTHROPIC>_ENABLED`, provider key/model/input/output rate fields | when enabled in live order | server-only AI credentials plus operator-configured model and micro-dollar-per-million-token rates; GLM additionally requires SEC-URL-validated `GLM_BASE_URL` |
| `AI_SUMMARY_ENABLED` / `ANTHROPIC_API_KEY` / `AI_SUMMARY_MODEL` | no | Versioned Fix-now summary profile; `fake`, legacy single-Anthropic AI SDK, or ordered `ai-sdk` mode (see migration note) |
| `GOOGLE_API_KEY` / `PAGESPEED_SAMPLE_SIZE` | key when `PROVIDER_PAGESPEED=google`; sample always | Google PSI + CrUX or DataForSEO Lighthouse; root + `0..3` additional authenticated-audit samples (default 3). DataForSEO is lab-only and never invents CrUX field data. |
| `PAGESPEED_CACHE_TTL_HOURS` | no | cross-user PageSpeed cache TTL (vendor-neutral layer); default 24 |
| `GSC_INSPECT_SAMPLE` | no | Google Search Console URL Inspection sample ceiling; `0` disables |
| `GA4_LAG_DAYS` | no | GA4 export lag — analytics report windows end at `today - GA4_LAG_DAYS`; default 1. GA4 reads (`PROVIDER_GA4=google`) reuse the Better Auth Google OAuth client via an incremental `analytics.readonly` grant; free Google quota |
| `SERP_CACHE_TTL_HOURS` / `SERP_DEPTH` | no | rank-check SERP cache TTL and requested depth; defaults 24 / 100 |
| `SERP_LIVE_DEPTH` | no | depth for the synchronous live SERP path (DataForSEO `/serp/google/organic/live/advanced`). Rank checks do NOT use it — `callProviderForItems` prefers the async `task_post`/`task_get` pair, which this adapter exposes — so it bounds only providers lacking that pair; capped ≤30 so live's per-page price stays within the `serp_checks` budget; default 20 |
| `SERP_TASK_POLL_INTERVAL_MS` / `SERP_TASK_MAX_POLL_ATTEMPTS` | no | wait budget for DataForSEO's async SERP task queue — the path rank checks actually take. An `in_queue` task is re-polled at the interval up to the attempt ceiling; exhausting it fails that one keyword as temporarily unavailable (the `serp_checks` unit is still spent). Interval × attempts is the real budget; defaults 3_000 / 60 = 180s |
| `KEYWORD_CACHE_TTL_DAYS` | no | keyword provider cache TTL; default 30 |
| `AUDIT_POLL_INTERVAL_MS` / `AUDIT_RUN_TIMEOUT_MS` | no | audit-pipeline vendor polling / wall-clock cap |
| `WORKER_CONCURRENCY` / `WORKER_PORT` | no | worker jobs-per-queue-worker (default 5) + internal `/healthz` (default 8081). With DataForSEO PageSpeed, the audit worker is capped at 10 jobs so its three calls/job stay within 30 simultaneous calls; replicas sharing credentials must keep aggregate audit concurrency at 10. |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | no | bootstrap platform-owner seed (email + ≥12-char password). On every api boot an idempotent async seeder creates the SuperAdmin account if absent, skips if present — it NEVER overwrites an existing account, so rotate the password after first login. Passed to the `api` service only; unset disables seeding. Password redacted from all logs. |

Client-only env vars carry the `VITE_` prefix and MUST be reachable from a browser (Vite bakes them into the bundle at build time).

## 5. Conventions

These are the load-bearing rules. Each links to the full rule file in `.claude/rules/`.

- **Feature-module isolation.** Client features live under `client/src/features/<name>/`; server modules under `server/src/modules/<name>/`. Cross-feature imports must go through `shared/` or each module's `index.ts` public API.
  → `.claude/rules/mern-feature-modules.md`

- **Named exports only.** No `export default` on components, actions, reducers, models, or utilities.
  → `.claude/rules/mern-no-default-exports.md`

- **Typed Mongoose schemas.** Every schema uses `InferSchemaType` and exports the type alongside the model.
  → `.claude/rules/mern-mongoose-typed-schemas.md`

- **Environment variables from root `.env` only.** Server config flows through `src/config/env.ts` (zod-validated). Client config uses `import.meta.env.VITE_*`.
  → `.claude/rules/environment-variables.md`

- **No hardcoded URLs.** All URLs derive from `CLIENT_URL` / `SERVER_URL` / `VITE_*` env vars.
  → `.claude/rules/site-url-env-pattern.md`

- **Tab state in URL query params.** Every tabbed interface persists active tab as `?tab=`.
  → `.claude/rules/url-tab-state.md`

- **One design system: shadcn/ui + balanced-AA+ Aria editorial tokens.** Warm-paper surfaces, ink `--primary`, signal-red `--highlight` accent (reference palette: arianetworks.com), passive `--border` versus ≥3:1 interactive `--input`, contrast-safe five-color charts (`--chart-1..5`), shadcn primitives via `@shared/ui/*`, semantic tokens only. Public docs routes render inside `PublicLayout` (`shared/components/`) with the `.mk-theme` wrapper (bright white surfaces, blue `--primary`, Inter 700 display type; `design-system.md` §1b). The self-hosted edition has no marketing/landing pages — `design-system.md` §3 homepage anatomy does not apply here.
  → `.claude/rules/design-system.md` (visual authority) + `.claude/rules/ui-ux-patterns.md` (accessibility, forms, loading/error states)

- **Destructive git commands require explicit confirmation.** `git stash`, `git reset --hard`, `git clean -f`, `git commit --amend`, `git push --force`, etc. — never without per-turn user approval.
  → `.claude/rules/git-destructive-commands.md`

- **Spec-driven development for non-trivial features.** Start with a specification before implementation. Bug fixes and one-liners skip the workflow.
  → `.claude/rules/spec-driven-development.md`

- **Vendor providers behind the registry.** No vendor SDK / HTTP client may be imported outside `server/src/shared/providers/`. Every provider ships success / timeout / malformed / quota contract tests with recorded, redacted fixtures. Explicit same-vendor credential pools must be bounded, status-specific, and resource-pinned; they never silently switch vendors or to `fake`.
  → `.claude/rules/provider-interfaces.md`

- **Postgres is the scoped exception; Mongo is the default.** Relational, ordered time-series data (rank history, keywords, backlinks, competitors, subscriptions, usage counters) lives in Postgres via Drizzle. Everything else stays in Mongo. Money in `bigint` cents. Migration workflow: edit schema → `npm run db:generate` → commit SQL → migrations auto-apply on boot.
  → `.claude/rules/drizzle-postgres-scope.md`

- **Better Auth owns identity.** Handler mounted at `/api/auth/*` BEFORE `express.json()`. Never hand-roll auth, CSRF, or password hashing. Session access via `auth.api.getSession(fromNodeHeaders(req.headers))`. Every product route protected by `[requireAuth, requireVerified]`. Cross-account tests required (404 not 403).
  → `.claude/rules/better-auth-integration.md`

- **Seven locales, always.** Every user-facing string ships in `en, ar, fr, de, es, ru, zh`. Client uses `i18next`; server uses hand-written typed dictionaries under `shared/i18n/`. Parity tests fail the build on missing keys. RTL for Arabic. Rule copy is plain-language.
  → `.claude/rules/i18n-seven-locales.md`

- **Interaction hygiene.** Pointer cursor on every clickable (disabled → `not-allowed`), set on the base primitive; one shared in-button loading affordance (`Button` `loading` prop + `Spinner`); every interactive element ships all states with ~100ms feedback and keyboard parity.
  → `.claude/rules/interaction-hygiene.md`

- **One shared layout system.** Exactly one `Header`, one `Footer`, one shell system in `shared/`; marketing and app are variants composed from the shared blocks — never inlined, forked, or a second visual language. Every label localized; mobile menu is the shared `Sheet`.
  → `.claude/rules/shared-layout-system.md`

## 5a. Key Architecture Patterns

### Client: RTK slice + thunk

Each feature has `store/thunks.ts` (async logic, calls `api.ts`), `store/slice.ts` (`extraReducers` for pending/fulfilled/rejected), `store/selectors.ts`. Thunks use `rejectWithValue` to pass typed error strings.

### Client: API calls

All HTTP calls go through `shared/api/client.ts` → `apiClient<T>(path, options)`. It reads `VITE_API_BASE_URL`, always sends `credentials: 'include'` (Better Auth cookie), and throws `ApiError` on non-2xx (a 401 also raises a localized session-expired toast). Feature `api.ts` files are thin wrappers.

### Client: Path aliases

| Alias | Resolves to |
|-------|-------------|
| `@/*` | `src/*` |
| `@app/*` | `src/app/*` |
| `@features/*` | `src/features/*` |
| `@shared/*` | `src/shared/*` |

Always use aliases — never relative `../../` across feature boundaries.

### Client: SSR docs / SPA dashboard split

Public docs routes (plus token-scoped portal/share pages) are server-rendered by `client/server.js` (Node) using `client/src/entry-server.tsx` (React Router `createStaticHandler` + `renderToString` + `react-helmet-async`) — full HTML with `<title>`, meta, OG, hreflang, JSON-LD. `/` and `/<locale>` 302 to `/login` (sign-in bounces a live session to `/dashboard`). Authenticated dashboard stays a CSR SPA hydrated by `entry-client.tsx`. The `web` container reverse-proxies `/api/*`, `/robots.txt`, and `/sitemap*.xml` to the api service via `API_INTERNAL_URL`; the default browser API base is same-origin `/api`, and absolute `VITE_API_BASE_URL` / `VITE_SOCKET_URL` origins are derived into the web CSP `connect-src`.

### Server: Controller → Service → Model

Controllers parse/validate requests (zod schemas in `*.schema.ts`), call services, return HTTP responses. Services hold business logic. Controllers are thin; no DB calls in controllers.

### Server: Error handling

`HttpError` (`shared/utils/http-error.ts`) provides `.badRequest` / `.unauthorized` / `.forbidden` / `.notFound` / `.conflict` / `.internal`. All route handlers are wrapped with `asyncHandler` so thrown `HttpError` instances are caught by the global error handler.

### Server: Auth middleware

`shared/middleware/require-auth.ts` resolves the Better Auth session (`auth.api.getSession`) from cookies and populates `req.user`. Product routes are mounted behind `[requireAuth, requireVerified]` in `app.ts`; the Better Auth handler owns `/api/auth/*` and is mounted BEFORE `express.json()`.

### Server: Provider registry

`shared/providers/registry.ts` selects the concrete adapter per capability from `PROVIDER_<CAP>` env. Modules import the interface (e.g. `RankProvider`), never a vendor SDK. Contract test suites live under `shared/providers/<vendor>/__tests__/` with recorded fixtures (redacted with `scripts/redact-fixture.ts`).

### Server: Two deployables, one image

`api` (Express HTTP) and `worker` (BullMQ consumers + `/healthz`) build from the same image, differ only in `command`. Queues: `audits`, `ranks`, `dead-letter`. `WORKER_CONCURRENCY` sets jobs-per-worker; the internal `/healthz` port (`WORKER_PORT`, default 8081) is never published.

## 6. Working with Claude in This Repo

```
.claude/
└── rules/        # Governance rules (source of truth; this file summarizes)
```

**Rule files** (`.claude/rules/`) are the source of truth. This CLAUDE.md summarizes them for quick reference. When in doubt, read the rule file.



## 7. Adding a Feature

Follow these steps to add a new feature (e.g., "reports").

### Client

1. Create `client/src/features/reports/`
2. Add files:
   - `components/` — React components
   - `store/slice.ts` (RTK `createSlice` with `extraReducers`)
   - `store/thunks.ts` (`createAsyncThunk` → `api.ts`)
   - `store/selectors.ts` (memoized)
   - `api.ts` — fetch calls via `apiClient<T>` from `@shared/api/client`
   - `types.ts`
   - `routes.tsx` — route array to spread into `app/routes.tsx`
   - `index.ts` — named re-exports (public API)
3. Wire in:
   - Register the reducer in `client/src/app/store.ts`
   - Spread the routes in `client/src/app/routes.tsx`
   - Add every user-facing string to all 7 locale files (`client/src/shared/i18n/locales/*/reports.json`) and register in `resources.ts`

### Server

1. Create `server/src/modules/reports/`
2. Add files:
   - `reports.model.ts` — Mongoose schema with `InferSchemaType` (or Drizzle table under `src/db/schema/` if relational time-series)
   - `reports.schema.ts` — zod request-body schemas
   - `reports.service.ts` — business logic
   - `reports.controller.ts` — parse + delegate + JSON; `asyncHandler`
   - `reports.routes.ts` — `express.Router()`; apply `requireAuth` / `requireVerified`
   - `reports.test.ts` — supertest integration tests using `startMemoryMongo` (+ Drizzle PGlite harness when relational)
   - `index.ts` — named re-exports
3. Wire in:
   - Mount in `server/src/app.ts`: `app.use('/api/reports', [requireAuth, requireVerified], reportsRouter)`
   - Add localized user-facing strings to every locale under `server/src/shared/i18n/locales/*.ts`
   - If the feature calls a vendor, add a `PROVIDER_*` capability and contract tests with recorded fixtures

### What NOT to Do

- **Never import from another feature's internals.** Public API only.
- **Never duplicate shared logic.** Put it in `shared/`.
- **Never create a module for a single function.** Put it in `shared/utils/`.
- **Never use default exports.**
- **Never hardcode URLs or config values.**
- **Never import a vendor SDK outside `shared/providers/`.**
- **Never ship a user-facing string in fewer than 7 locales.**

## 8. Testing

**Both client and server use Vitest.** Coverage gate is **100%** v8 on lines / branches / functions / statements on owned code (see `server/vitest.config.ts` and `client/vitest.config.ts` for excludes — generated schemas, vendored primitives, integration seams).

- Server integration tests use `supertest` against `createApp()`, `mongodb-memory-server` for Mongo, and PGlite (`shared/testing/postgres.ts`) for the real generated Drizzle migrations against WASM Postgres.
- Client unit + integration tests use Vitest + React Testing Library + jsdom.
- Provider contract tests live under `server/src/shared/providers/<vendor>/__tests__/` and consume recorded, redacted fixtures.
- E2E: Playwright + `@axe-core/playwright` smokes against the composed stack with fake vendor providers.

```bash
# Everything with coverage
npm --prefix server exec -- vitest run --coverage
npm --prefix client exec -- vitest run --coverage

# Single file
npm --prefix server exec -- vitest run src/modules/audits/audits.test.ts
npm --prefix client exec -- vitest run src/features/report/report.test.tsx

# Watch
npm --prefix server exec -- vitest
npm --prefix client exec -- vitest
```

## 9. Things This Repo Does NOT Do

This list prevents agent assumptions from drifting into unrelated territory.

- **No SSR framework (Next.js / RSC).** SSR is Vite native. `client/server.js` renders the public docs; the dashboard stays a CSR SPA hydrated by `entry-client.tsx`.
- **No monorepo tooling.** No Turborepo / Nx / Lerna. `client/` and `server/` are independent npm packages.
- **No GraphQL / tRPC.** REST via Express route handlers returning JSON.
- **No Passport / bcrypt / hand-rolled JWTs.** Better Auth owns sessions, hashing, CSRF, OAuth state.
- **No PostgreSQL-first stance.** Mongo remains the default document store; Postgres is a scoped exception for the relational time-series data listed in the drizzle-postgres-scope rule.
- **No Docker socket / host mount / VPS orchestration.** rankme.fast never touches the host Docker socket. `docker-socket-proxy` is gone. Redis is actively used by BullMQ (`audits`, `ranks`, dead-letter) — not "reserved for later".
- **No CSS-in-JS.** Tailwind v4 utilities + shadcn primitives + CSS custom properties. Legacy `.scss` is being retired as components migrate.
- **No custom design system.** shadcn/ui primitives on the shipped balanced-AA+ rankme.fast tokens (Aria editorial palette: warm-paper surfaces, ink `--primary`, signal-red `--highlight`, passive/interactive border roles, warm neutrals, the contrast-safe five `--chart-*` series). Docs routes swap to the bright blue `.mk-theme` token set (Inter bold display, no serif). Everywhere else composes the shared primitives and semantic tokens — no feature-local restyling.
- **No vendor SDK imports outside `shared/providers/`.** ESLint restricts this; PRs that violate it fail CI.
- **No `.env` files in subdirectories.** Root `.env` only.
- **No user-facing string in fewer than 7 locales.** Parity tests fail the build on missing keys.
