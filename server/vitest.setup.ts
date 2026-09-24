process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/mern-starter-test';
// Never dialed by tests — Postgres tests run against in-process PGlite
// (shared/testing/postgres.ts); postgres-js only connects on first query.
process.env.DATABASE_URL = 'postgres://rankme:rankme@127.0.0.1:5432/rankme-test';
process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef';
process.env.CLIENT_URL = 'http://localhost:3000';
delete process.env.APP_URL;
process.env.SERVER_URL = 'http://localhost:8080';
// Google OAuth stays unset in tests — the provider is conditionally
// registered, and the social sign-in path is exercised client-side.
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
process.env.MASTER_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.LOG_LEVEL = 'fatal';
// Raise the auth-limiter cap in the test env so integration suites
// (auth, team) don't collide with the module-level in-memory bucket. The
// security-middleware integration test exercises the 429 path via a scoped
// mini-app with an explicit small `max`.
// Force-override any inherited value: the host shell exports the production
// default (30) from the root .env, which starves the test suite the moment
// several suites share the same createApp() limiter bucket.
process.env.RATE_LIMIT_AUTH_MAX = '1000000';
// The host shell also exports PROVIDER_*=dataforseo + DATAFORSEO_LOGIN/PASSWORD
// from the root .env. Provider-registry tests assume clean CI env (all-fake).
// Wipe every leak so tests get deterministic env parity with CI.
delete process.env.PROVIDER_AUDIT;
delete process.env.PROVIDER_RANK;
delete process.env.PROVIDER_KEYWORD;
delete process.env.PROVIDER_BACKLINK;
delete process.env.PROVIDER_COMPETITOR;
delete process.env.PROVIDER_LOCAL_LISTINGS;
delete process.env.PROVIDER_PAGESPEED;
delete process.env.PROVIDER_GSC;
delete process.env.PROVIDER_GA4;
delete process.env.PROVIDER_SUMMARY;
delete process.env.PROVIDER_AI_VISIBILITY;
// Firecrawl live selection needs FIRECRAWL_ZDR_ENABLED=true; a host .env that
// enables live firecrawl leaks it here. Reset to CI parity so tests observe
// the same "all-fake" boot the vitest suite assumes.
delete process.env.PROVIDER_CONTENT_SOURCE;
delete process.env.FIRECRAWL_API_KEY;
delete process.env.FIRECRAWL_FALLBACK_API_KEYS;
delete process.env.FIRECRAWL_BASE_URL;
delete process.env.FIRECRAWL_ZDR_ENABLED;
delete process.env.DATAFORSEO_LOGIN;
delete process.env.DATAFORSEO_PASSWORD;
delete process.env.DATAFORSEO_BASE_URL;
delete process.env.GOOGLE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
// No test may inherit a live email credential. Tests that exercise the
// transport install a deterministic fake or mock fetch explicitly.
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM;
delete process.env.CONTACT_FORM_RECIPIENT;
delete process.env.ALERT_WEBHOOK_URL;
delete process.env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS;
// REDIS_URL leaks from the compose profile as `redis://redis:6379`, which the
// default health probe tries to ping — with no reachable redis in the test
// harness the probe reports the app degraded. Reset to CI parity.
delete process.env.REDIS_URL;
// Shells that source the root .env export optional vars as EMPTY strings
// (e.g. ALERT_WEBHOOK_URL=), which zod's enum/url() rejects.
// Treat empty as unset so host test runs match clean CI environments.
const OPTIONAL_MAY_BE_EMPTY = [
  'ALERT_WEBHOOK_URL',
  'CONTACT_FORM_RECIPIENT',
  'FIRECRAWL_WEBHOOK_SECRET_BINDINGS',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'SUPERADMIN_EMAIL',
  'SUPERADMIN_PASSWORD',
] as const;
for (const key of OPTIONAL_MAY_BE_EMPTY) {
  if (process.env[key] === '') {
    delete process.env[key];
  }
}
