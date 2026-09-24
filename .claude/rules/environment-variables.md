# Environment Variables — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**ONLY use root `.env`. NEVER create `.env`, `.env.local`, or any `.env.*` file in a subdirectory.**

## Architecture

```
rankme.fast/
├── .env                 # ONLY environment file — single source of truth for
│                        #   EVERY var, secrets included (git-ignored)
├── .env.example         # Template — committed to git
├── client/              # NO .env files allowed here
└── server/              # NO .env files allowed here
```

- The **server** loads variables at startup via `dotenv` and validates them with zod in `server/src/config/env.ts`.
- The **client** does NOT read `.env` at runtime — Vite bakes `import.meta.env.VITE_*` into the bundle at build time. Vite reads the root `.env`.
- **Docker Compose** loads the same root `.env` at compose-time AND passes every var — secrets included — into the `api` / `worker` / `web` containers by plain `${VAR}` interpolation. There is NO Docker-secret `_FILE` mechanism and no `./secrets/*` mount (see **Secrets: root `.env` only** below).

## Why this rule exists

1. **Single source of truth** — no duplicate values, no drift between dev and prod.
2. **Security** — one file to `.gitignore`; one file to audit.
3. **Compose parity** — the same file that boots the stack is the file the tests read.

## Secrets: root `.env` only — no `_FILE` / Docker-secret indirection

### MANDATORY REQUIREMENT — ZERO TOLERANCE

**Every secret (`MASTER_ENCRYPTION_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `RESEND_API_KEY`, and any future credential) lives ONLY in the root `.env`. Do NOT reintroduce a Docker-secret `${KEY}_FILE` reader, a `./secrets/*` mount, or a top-level compose `secrets:` block.**

**Why (post-mortem).** A `_FILE`-first resolver in `config/env.ts` read `${KEY}_FILE` → file contents and let it OVERRIDE the plain `${KEY}`. The mounted `./secrets/polar_access_token` was a 0-byte file, so the resolver overwrote the real `.env` token with `""` → `PolarProvider.isConfigured()` returned false → `POST /api/billing/checkout` 500ed with `billing.error.notConfigured`. An empty secret file silently beat a valid `.env` value. The mechanism was deleted; `.env` is authoritative.

### Correct

```yaml
# docker-compose.yml — plain interpolation; the secret sits in .env
POLAR_ACCESS_TOKEN: ${POLAR_ACCESS_TOKEN:-}
MASTER_ENCRYPTION_KEY: ${MASTER_ENCRYPTION_KEY}   # required → fail loud if unset
```

```typescript
// config/env.ts — parse process.env directly; zod validates
const parsed = envSchema.safeParse(process.env);
```

### FORBIDDEN

```yaml
# WRONG — Docker-secret _FILE indirection: an empty mounted file silently
# overrides the real .env value (the checkout-500 footgun)
POLAR_ACCESS_TOKEN_FILE: /run/secrets/polar_access_token
secrets:
  - polar_access_token
```

```typescript
// WRONG — a resolver that lets `${KEY}_FILE` win over `${KEY}`
out[key] = readFileSync(source[`${key}_FILE`], 'utf8').trim();
```

## Required variables

The authoritative env schema is `server/src/config/env.ts`. The user-facing docs in `CLAUDE.md` §4 keep a table synced with `.env.example` (enforced by the docs-consistency test). Highlights:

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NODE_ENV` | server | `production` / `development` / `test` |
| `ALLOW_FAKE_PROVIDERS` | server | production-only explicit test/demo seam; defaults false and otherwise rejects fake provider/email backends |
| `PORT` | server | api HTTP port (default 8080) |
| `WEB_PORT` | compose | host port for the SSR `web` container |
| `MONGODB_URI` | server | Mongo (compose: `mongodb://mongo:27017/rankme`) |
| `REDIS_URL` | server | Redis (compose: `redis://redis:6379`) — BullMQ |
| `POSTGRES_USER` / `_PASSWORD` / `_DB` | compose | provisioning |
| `DATABASE_URL` | server | Drizzle/Postgres connection — must match POSTGRES_* |
| `BETTER_AUTH_SECRET` | server | session signing (≥32 chars) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | server | OAuth (optional) |
| `CLIENT_URL` / `SERVER_URL` | server + client build | public origins; source of truth for URL derivation |
| `VITE_API_BASE_URL` / `VITE_SOCKET_URL` / `VITE_SITE_URL` | client build | bundled into the client |
| `VITE_GITHUB_URL` | client build | public repo URL; blank hides every open-source marketing element |
| `VITE_RELEASE_STAGE` | client build | `beta` (default; blank/invalid → `beta`) shows the public-beta banner + badge; `ga` removes them |
| `GITHUB_REPOSITORY_URL` | server | optional https repository link in `/llms.txt`; blank omits it |
| `API_INTERNAL_URL` | web (SSR) | api origin for the `web` → `api` reverse proxy |
| `MASTER_ENCRYPTION_KEY` | server | AES-256-GCM key from root `.env` |
| `PAYMENT_PROVIDER` | server | `none` / `polar` |
| `POLAR_ACCESS_TOKEN` / `_WEBHOOK_SECRET` / `_SERVER` / `_*_PRODUCT_ID` | server | Polar credentials + product IDs from root `.env` |
| `RESEND_API_KEY` / `RESEND_FROM` | server | transactional email |
| `ALERT_WEBHOOK_URL` | server | JSON POST target for failure alerts |
| `RATE_LIMIT_AUTH_WINDOW_MS` / `_MAX` | server | auth-route limiter |
| `RATE_LIMIT_WEBHOOK_WINDOW_MS` / `_MAX` | server | webhook limiter (pre-HMAC) |
| `CSRF_COOKIE_NAME` / `CSRF_HEADER_NAME` | server | double-submit CSRF |
| `ACCOUNT_DELETION_GRACE_HOURS` | server | data-rights purge grace |
| `DATAFORSEO_LOGIN` / `_PASSWORD` / `_BASE_URL` | server | DataForSEO Basic auth |
| `PROVIDER_AUDIT` / `_RANK` / `_KEYWORD` / `_BACKLINK` / `_COMPETITOR` / `_PAGESPEED` / `_GSC` / `_SUMMARY` | server | per-capability adapter selection |
| `AI_SUMMARY_ENABLED` / `ANTHROPIC_API_KEY` / `AI_SUMMARY_MODEL` | server | Claude summary |
| `GOOGLE_API_KEY` / `PAGESPEED_SAMPLE_SIZE` | server | PSI + CrUX |
| `GSC_INSPECT_SAMPLE` | server | GSC URL Inspection ceiling |
| `KEYWORD_CACHE_TTL_DAYS` | server | keyword provider cache TTL |
| `AUDIT_POLL_INTERVAL_MS` / `AUDIT_RUN_TIMEOUT_MS` | server | audit pipeline polling / deadline |
| `FIRECRAWL_API_KEY` / `FIRECRAWL_FALLBACK_API_KEYS` | server | primary credential + ordered comma-separated same-vendor fallbacks; fallback values are secrets too |
| `WORKER_CONCURRENCY` / `WORKER_PORT` | server (worker) | jobs-per-worker + internal `/healthz` |
| `DEFAULT_LOCALE` | server | fallback locale; one of the 7; default `en` |
| `LOG_LEVEL` | server | pino level |

## Agent responsibilities

1. **Never create** `.env` / `.env.local` / `.env.production` files under `client/` or `server/`.
2. **Only edit** the root `.env` for new variables.
3. **Document** new variables in root `.env.example` with comments.
4. **Add the new variable to `server/src/config/env.ts`** with the correct zod type + required/optional.
5. **Add the new variable to the table in `CLAUDE.md` §4** — the docs-consistency test fails otherwise.
6. **Verify** `.gitignore` includes `.env` (every secret lives here).
7. **Never** reintroduce a `${KEY}_FILE` secret reader, a `./secrets/*` mount, or a compose `secrets:` block — see **Secrets: root `.env` only**.
8. **Never** enable `ALLOW_FAKE_PROVIDERS` in a real deployment. It exists only for isolated CI/E2E/demo stacks whose live credentials are explicitly blanked.

List-valued secrets must be parsed and validated centrally, passed as typed
arrays after `env.ts`, and remain blank in `.env.example`. Reject blank members,
duplicates, and unbounded lists. Every plural secret name and runtime array field
must be added to logger redaction, fixture sanitization, test-env cleanup, and
Compose parity in the same change.

## Validation Checklist

- [ ] No `client/.env` / `server/.env` / `.env.local` files exist
- [ ] Root `.env` has every variable named in `server/src/config/env.ts`
- [ ] `.env.example` is up to date with every variable (minus secrets)
- [ ] CLAUDE.md §4 env table matches `.env.example` (docs-consistency test passes)
- [ ] `.gitignore` covers `.env`
- [ ] Every secret lives in the root `.env`; NO `${KEY}_FILE` reader, `./secrets/*` mount, or compose `secrets:` block
- [ ] `config/env.ts` parses `process.env` directly (no file-secret resolver)

Build identity: `APP_BUILD_SHA` is a build argument (7–12 hex digits, default `dev`) shared by web/api/worker. `VITE_APP_VERSION` is generated from the client package version plus this suffix; it is not a configurable env value. The server build embeds the same SHA and combines it with the server package version for `/api/health`. Rebuild all three images together.
