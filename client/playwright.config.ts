/**
 * Playwright smoke + axe accessibility gate.
 *
 * The suite drives the composed Docker stack (api + worker + web + mongo +
 * redis + postgres) with `PROVIDER_*=fake` — deterministic canned vendor
 * results, zero vendor traffic, zero API spend. In CI the stack
 * is booted by `.github/workflows/ci.yml`; locally, run
 * `docker compose up -d --build` first.
 *
 * The core UX path (`e2e/smoke.spec.ts`) is one serial spec on its own
 * project so shared state stays deterministic. The `ar` RTL locale smoke
 * (`e2e/ar-locale.spec.ts`) and the axe accessibility scans
 * (`e2e/a11y.spec.ts`) run in parallel because each is isolated to its own
 * account.
 */
import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// The canonical root command loads this file through ../playwright.config.ts,
// while package-local commands start in client/. Avoid import.meta so both
// ESM and the root CommonJS compatibility loader resolve the same directory.
const CONFIG_DIR =
  basename(process.cwd()) === 'client' ? process.cwd() : resolve(process.cwd(), 'client');

const GATE_PROVIDER_SELECTORS = [
  'PROVIDER_AUDIT',
  'PROVIDER_RANK',
  'PROVIDER_KEYWORD',
  'PROVIDER_BACKLINK',
  'PROVIDER_COMPETITOR',
  'PROVIDER_PAGESPEED',
  'PROVIDER_GSC',
  'PROVIDER_GA4',
  'PROVIDER_SUMMARY',
  'PROVIDER_LOCAL_LISTINGS',
  'PROVIDER_AI_VISIBILITY',
  'PROVIDER_CONTENT_SOURCE',
  'PROVIDER_CONTENT_ANALYSIS',
  'PROVIDER_REVIEWS',
  'PROVIDER_TRENDS',
  'PROVIDER_AI',
  'PROVIDER_APP_DATA',
] as const;

const OUTBOUND_SECRET_ENV_VARS = [
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'GOOGLE_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'GLM_API_KEY',
  'KIMI_API_KEY',
  'FIRECRAWL_API_KEY',
  'FIRECRAWL_FALLBACK_API_KEYS',
  'FIRECRAWL_WEBHOOK_SECRET',
  'FIRECRAWL_WEBHOOK_SECRETS',
  'FIRECRAWL_WEBHOOK_SECRET_BINDINGS',
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_WEBHOOK_SECRETS',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'SENDGRID_API_KEY',
  'MAILCHIMP_API_KEY',
  'ALERT_WEBHOOK_URL',
] as const;

function parseLoopbackUrl(value: string | undefined, name: string): URL {
  if (value === undefined || value === '') {
    throw new Error(`Playwright requires explicit ${name}`);
  }
  try {
    const url = new URL(value);
    const safe =
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.username === '' &&
      url.password === '';
    if (!safe) throw new Error('not an unauthenticated HTTP loopback URL');
    return url;
  } catch {
    throw new Error(`Playwright requires ${name} to be an unauthenticated HTTP loopback URL`);
  }
}

function assertIsolatedComposeGate(input: { baseUrl: string; apiBaseUrl: string }): void {
  const project = process.env.COMPOSE_PROJECT_NAME;
  const safeProject =
    project === 'rankme-e2e' ||
    (project !== undefined && /^rankme-community-cold-[a-z0-9][a-z0-9-]*$/u.test(project));
  if (!safeProject) {
    throw new Error(
      'Playwright refuses Compose access outside rankme-e2e or a rankme-community-cold-* project',
    );
  }
  const ambientOverrides = [
    'COMPOSE_FILE',
    'COMPOSE_ENV_FILES',
    'COMPOSE_PATH_SEPARATOR',
    'COMPOSE_PROFILES',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'DOCKER_DEFAULT_PLATFORM',
    'DOCKER_HOST',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ].filter((name) => (process.env[name] ?? '') !== '');
  if (ambientOverrides.length > 0) {
    throw new Error(
      `Playwright refuses ambient Compose/Docker overrides: ${ambientOverrides.join(', ')}`,
    );
  }
  const clientUrl = parseLoopbackUrl(process.env.CLIENT_URL, 'CLIENT_URL');
  const appUrl = parseLoopbackUrl(process.env.APP_URL, 'APP_URL');
  if (appUrl.origin !== clientUrl.origin) {
    throw new Error('APP_URL must use the declared CLIENT_URL origin');
  }
  const serverUrl = parseLoopbackUrl(process.env.SERVER_URL, 'SERVER_URL');
  const baseUrl = parseLoopbackUrl(input.baseUrl, 'PLAYWRIGHT_BASE_URL');
  const apiBaseUrl = parseLoopbackUrl(input.apiBaseUrl, 'PLAYWRIGHT_API_BASE_URL');
  const viteSiteUrl = parseLoopbackUrl(process.env.VITE_SITE_URL, 'VITE_SITE_URL');
  if (baseUrl.origin !== clientUrl.origin) {
    throw new Error('PLAYWRIGHT_BASE_URL must use the declared CLIENT_URL origin');
  }
  if (apiBaseUrl.origin !== serverUrl.origin) {
    throw new Error('PLAYWRIGHT_API_BASE_URL must use the declared SERVER_URL origin');
  }
  if (viteSiteUrl.origin !== clientUrl.origin) {
    throw new Error('VITE_SITE_URL must use the declared CLIENT_URL origin');
  }
  const viteApiRaw = process.env.VITE_API_BASE_URL;
  if (viteApiRaw === undefined || viteApiRaw === '') {
    throw new Error('Playwright requires explicit VITE_API_BASE_URL');
  }
  const viteApiUrl = parseLoopbackUrl(
    new URL(viteApiRaw, viteSiteUrl).toString(),
    'VITE_API_BASE_URL',
  );
  if (
    ![clientUrl.origin, serverUrl.origin].includes(viteApiUrl.origin) ||
    !(viteApiUrl.pathname === '/api' || viteApiUrl.pathname.startsWith('/api/'))
  ) {
    throw new Error('VITE_API_BASE_URL must resolve to /api on a declared loopback origin');
  }
  if ((process.env.VITE_GA_ID ?? '') !== '') {
    throw new Error('Playwright requires blank VITE_GA_ID');
  }
  if (process.env.EMAIL_TRANSPORT !== 'resend') {
    throw new Error('Playwright requires EMAIL_TRANSPORT=resend');
  }
  if (process.env.E2E_EMAIL_CAPTURE !== 'false') {
    throw new Error('Playwright requires E2E_EMAIL_CAPTURE=false at gate startup');
  }
  const nonFakeProviders = GATE_PROVIDER_SELECTORS.filter((name) => process.env[name] !== 'fake');
  if (nonFakeProviders.length > 0) {
    throw new Error(`Playwright requires fake providers: ${nonFakeProviders.join(', ')}`);
  }
  const populatedSecrets = OUTBOUND_SECRET_ENV_VARS.filter(
    (name) => (process.env[name] ?? '') !== '',
  );
  if (populatedSecrets.length > 0) {
    throw new Error(
      `Playwright requires blank outbound credentials: ${populatedSecrets.join(', ')}`,
    );
  }
}

const readRootEnvValue = (name: string): string | undefined => {
  const envPath = resolve(CONFIG_DIR, '..', '.env');
  if (!existsSync(envPath)) return undefined;

  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
  if (!line) return undefined;

  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, '$2');
};

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://127.0.0.1:${process.env.WEB_PORT ?? readRootEnvValue('WEB_PORT') ?? '3000'}`;

// API-only journeys
// bypass the web proxy deliberately. Make their host port resolve from the
// same root environment as Compose instead of assuming the default 8080.
const API_BASE_URL =
  process.env.PLAYWRIGHT_API_BASE_URL ??
  `http://127.0.0.1:${process.env.API_PORT ?? readRootEnvValue('API_PORT') ?? '8080'}`;
process.env.PLAYWRIGHT_API_BASE_URL = API_BASE_URL;

assertIsolatedComposeGate({ baseUrl: BASE_URL, apiBaseUrl: API_BASE_URL });

export default defineConfig({
  // Absolute paths preserve package-local artifact locations when the
  // repository-root compatibility config is used by the canonical gate.
  testDir: resolve(CONFIG_DIR, 'e2e'),
  outputDir: resolve(CONFIG_DIR, 'test-results'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Several projects create accounts from the same loopback address. Keep the
  // composed-stack gate serial so it exercises (rather than disables) the
  // production auth burst limiter without creating a self-inflicted 429.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: resolve(CONFIG_DIR, 'playwright-report') }],
      ]
    : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Every testMatch is anchored on the basename so that
    // partial-substring collisions (`smoke.spec.ts` used to match
    // `competitors-gap-smoke.spec.ts` and `security-smoke.spec.ts`, causing
    // both orphan specs to silently piggyback on the wrong project) are a
    // build-time failure via `src/e2e-project-mapping.test.ts`. Keep the
    // shape identical for future additions: `(?:^|\/)<file>\.spec\.ts$`.
    {
      name: 'smoke',
      testMatch: /(?:^|\/)smoke\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'locale-ar',
      testMatch: /(?:^|\/)ar-locale\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], locale: 'ar' },
    },
    {
      name: 'row-menu',
      testMatch: /(?:^|\/)sites-row-menu\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'sites-pause',
      testMatch: /(?:^|\/)sites-pause\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Two browser contexts share one workspace.
      // Serial with one worker: the journey mutates a single team roster and
      // both contexts sign up from the same loopback address.
      name: 'team-workspace',
      testMatch: /(?:^|\/)team-workspace\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'a11y',
      testMatch: /(?:^|\/)a11y\.spec\.ts$/,
      // Entrance animations temporarily blend foreground colours into their
      // backgrounds while axe samples computed styles. Reduced motion keeps
      // the audit deterministic and mirrors the product's accessible mode.
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'bug-report',
      testMatch: /(?:^|\/)bug-report\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      // Pages tab final proof. One serial account owns deterministic Mongo
      // inventory plus Postgres GSC/fallback snapshots; all providers remain
      // fake and browser egress is denied by the spec.
      name: 'pages',
      testMatch: /(?:^|\/)pages\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'cwv',
      testMatch: /(?:^|\/)cwv\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ssr-hardening',
      testMatch: /(?:^|\/)ssr-hardening\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Enroll the two orphan specs that predecessor prompts
    // added but never wired to a project. Without an owning project
    // `playwright test --list` silently skips the file and the CI E2E job
    // reports a false green.
    {
      name: 'competitors-gap-smoke',
      testMatch: /(?:^|\/)competitors-gap-smoke\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'security-smoke',
      testMatch: /(?:^|\/)security-smoke\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Journey A evidence-first core spec. Serial (one story
    // per worker) so the ordered site → tab-state → preview → cross-account
    // steps run against a single isolated account without shared-state
    // interference.
    {
      name: 'evidence-roadmap-core',
      testMatch: /(?:^|\/)evidence-roadmap-core\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Journey A keyword-intelligence workspace spec. Serial
    // (one story per worker) because it seeds a pro-tier account, runs
    // keyword_lookups + ai_summaries requests through the shipped
    // `/api/keyword-research/*` surface, and reconciles the same account's
    // meter after each step.
    {
      name: 'keyword-intelligence',
      testMatch: /(?:^|\/)keyword-intelligence\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Link Intelligence six-tab, metering/refund, RTL and axe
    // journey. Serial because it reconciles one isolated account's
    // link_intel_checks counter after every free/paid step.
    {
      name: 'link-intelligence',
      testMatch: /(?:^|\/)link-intelligence\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Traffic Insights metering/cache/refund, Agency compare,
    // Arabic RTL, keyboard-only interaction, and light/dark axe journey.
    {
      name: 'traffic-insights',
      testMatch: /(?:^|\/)traffic-insights\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Live Keyword Trends: Starter standalone + Pro workspace
    // journeys, preview/confirm metering, cross-account cache hit, provider
    // refund, cap + kill-switch disclosure, Arabic RTL, and light/dark axe.
    // Serial because it reconciles one isolated account's `trend_explorations`
    // counter after every free/paid step.
    {
      name: 'keyword-trends',
      testMatch: /(?:^|\/)keyword-trends\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Review Intelligence: source setup, non-reserving preview,
    // metered sync, rerun dedupe, partial-source failure, no-reliable-themes,
    // hostile-content inventory + CSV export, cap disclosure, kill switch,
    // Arabic RTL, and light/dark axe. Serial because it reconciles one
    // isolated account's `review_syncs` counter after every free/paid step.
    {
      name: 'review-intelligence',
      testMatch: /(?:^|\/)review-intelligence\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Brand Radar: Agency scan → detail → CSV → two-scan trend,
    // Pro-without-add-on upsell, preview-cancel-no-spend, the
    // `completed_partial` / `no_reliable_digest` / `completed_empty`
    // terminals, cap disclosure, kill switch with stored reads intact, free
    // stored reads, Arabic RTL, and light/dark axe. Serial because it
    // reconciles four isolated accounts' `brand_mention_scans` counters after
    // every free/paid step.
    {
      name: 'brand-radar',
      testMatch: /(?:^|\/)brand-radar\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Superadmin market health/cost/queue/sensor/commerce panels,
    // Member 404 concealment, guarded requeue, deep links, and light/dark axe.
    {
      name: 'superadmin-market',
      testMatch: /(?:^|\/)superadmin-market\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Aggregate keyboard-only paid/upsell/export/operator flows
    // plus deep-link, reload, browser-history, normalization, and unrelated
    // parameter survival across every batch tab/filter grammar.
    {
      name: 'usability-sweep',
      testMatch: /(?:^|\/)usability-sweep\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Journey B AI-Visibility citation-gap → Content Intelligence
    // lineage spec. Serial (one story per worker) because it seeds an
    // agency-tier account (`aiVisibility` is agency-only in the shipped tier
    // catalog), spends `ai_mentions_checks` + `content_analyses` through the
    // shipped `/api/sites/:siteId/ai-visibility/*` and
    // `/api/content-analyses/:analysisId/*` surfaces, and reconciles the
    // meter after every step.
    {
      name: 'ai-visibility-citations',
      testMatch: /(?:^|\/)ai-visibility-citations\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Audience research workspace journey. Serial (one story
    // per worker) because it seeds a pro-tier account, drives the
    // `?tab=audience-research` surface end-to-end (form → preview → confirm
    // → terminal evidence → filter → accept/dismiss → deep-link → partial
    // state), and reconciles the `audience_research_runs` meter after every
    // step. Includes an inline ar-locale RTL journey.
    {
      name: 'audience-research',
      testMatch: /(?:^|\/)audience-research\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Journey D weekly-pulse consent + non-reserving preview
    // + first-party GSC generative-AI appearance spec. Serial (one story
    // per worker) because it seeds an agency-tier account, upserts
    // `site_pulse_subscriptions`, and reconciles the `ai_mentions_checks`
    // meter across every read/write.
    {
      name: 'weekly-pulse',
      testMatch: /(?:^|\/)weekly-pulse\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Journey D docs 7-locale rollout + public API / MCP /
    // audit-preview compat spec. Serial (one story per worker) because
    // the legacy-preview double-read reconciles the `audits` meter for
    // its isolated account across sequential reads.
    {
      name: 'docs-roadmap',
      testMatch: /(?:^|\/)docs-roadmap\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Next Actions workspace journey. Serial (one story per
    // worker) because it seeds one pro-tier account, runs a real fake-provider
    // audit to terminal state, mutates action workflow state, spends exactly
    // one previewed retest, and reconciles the `audits` meter after every
    // step. Includes Arabic RTL, keyboard-only, axe, mobile-viewport,
    // deterministic partial-source / unsafe-link fixtures, and a
    // cap-exhausted retest, all against the locked UX contract.
    {
      name: 'actions',
      testMatch: /(?:^|\/)actions\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    // Cross-feature accessibility / RTL / semantic-usability
    // sweep spec. Runs axe over every predecessor-shipped workspace
    // (Audience Research, AI Visibility, Content Intelligence, Weekly Pulse
    // settings, Keyword Intelligence, Actions, GSC generative-appearance,
    // usage activity), the public error / docs / auth chrome, and the
    // seven-locale docs sweep, in both light + dark, LTR + Arabic RTL,
    // plus a narrow-viewport pass. `reducedMotion: 'reduce'` matches the
    // `a11y` project's policy so entrance animations do not skew computed
    // colour contrast. Serial (one story per worker) so each isolated
    // account's signup + verify + workspace sweep runs without shared-state
    // interference.
    {
      name: 'evidence-roadmap-a11y',
      testMatch: /(?:^|\/)evidence-roadmap-a11y\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      // Content Intelligence — real starter fake-provider run,
      // catalog-backed no-plan/exhausted gates, terminal partial fixtures,
      // keyboard flow, responsive evidence, Arabic RTL, and axe.
      name: 'content-intelligence',
      testMatch: /(?:^|\/)content-intelligence\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // SERP feature capture journey. Serial
    // (one story per worker) because it signs up an isolated account, drives
    // a real fake-provider rank check to a durable `serp_observations` row,
    // seeds a never-checked keyword for the honest not-observed state, and
    // recreates the api with `SERP_FEATURE_TRACKING_ENABLED=false` to prove
    // the kill switch before restoring it. Includes Arabic RTL, keyboard-only
    // navigation, and axe scans in light and dark. Its `finally` block always
    // recreates the api with the flag back ON, so the project that follows
    // still sees a normal stack.
    {
      name: 'serp-features',
      testMatch: /(?:^|\/)serp-features\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Schema markup generator journey. Serial
    // (one story per worker) because it signs up an isolated account, runs a
    // real fake-provider audit to seed the stored page facts, spends several
    // `schema_generations` units through preview → confirm, reconciles the
    // meter after every free/paid step, exhausts the starter cap, and
    // recreates the api with `SCHEMA_GENERATOR_ENABLED=false` to prove the
    // kill switch before restoring it. Includes Arabic RTL and axe scans in
    // light and dark. Its `finally` block always recreates the api with the
    // flag back ON, so the project that follows still sees a normal stack.
    {
      name: 'schema-generator',
      testMatch: /(?:^|\/)schema-generator\.spec\.ts$/,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        reducedMotion: 'reduce',
        permissions: ['clipboard-write'],
      },
    },
    // Public pages, sitemap, and docs sweep.
    // Reads only the root redirect, sitemap, and docs surfaces: no account, no
    // vendor call, no metered unit. Serial so the theme toggle and the axe
    // scans never race another project's navigation.
    {
      name: 'public-pages',
      testMatch: /(?:^|\/)public-pages\.spec\.ts$/,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        reducedMotion: 'reduce',
      },
    },
    // GSC keyword cannibalization journey.
    // Serial (one story per worker) because it signs up an isolated account,
    // seeds stored `query,page` snapshot rows, drives preview → confirm →
    // stored-report reads, exhausts the starter `cannibalization_reports`
    // cap, and recreates the api with `CANNIBALIZATION_ENABLED=false` to
    // prove the kill switch before restoring it. Includes Arabic RTL and axe
    // scans in light and dark. Its `finally` block always recreates the api
    // with the flag back ON, so the project that follows still sees a normal
    // stack.
    {
      name: 'cannibalization',
      testMatch: /(?:^|\/)cannibalization\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Bing / YouTube / Amazon rank tracking.
    // Serial (one story per worker) because it signs up an isolated account,
    // drives the engine picker's pre-submit spend disclosure, adds Bing,
    // Amazon, and Google keywords in one session, exercises the URL-backed
    // engine filter, seeds the account's own slot and `alt_engine_checks`
    // counters to reach both localized 402s, and recreates the api with
    // `ALT_ENGINE_TRACKING_ENABLED=false` to prove the kill switch before
    // restoring it. Includes Arabic RTL and axe scans in light and dark. Its
    // `finally` block always recreates the api with the flag back ON, so the
    // project that follows still sees a normal stack.
    {
      name: 'alt-engines',
      testMatch: /(?:^|\/)alt-engines\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Toxicity-review metering/refunds,
    // deterministic rubric + bounded rationale, download-only disavow file,
    // cap/flag/free-reopen states, Arabic RTL, and light/dark axe. The spec
    // restores the rollout flag and fake providers in its `finally` block.
    {
      name: 'toxic-links',
      testMatch: /(?:^|\/)toxic-links\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Alert rules and channels. Serial because
    // the journey drives the structural cap and Pro+ channel gate through one
    // account's subscription row, seeds an 04-owned confirmed rank drop plus a
    // pair of 05-owned link snapshots, and then waits on the real
    // `alert-detection-sweep` + `alert-dispatch` workers to settle terminal
    // delivery rows. Covers show-once secret masking, SSRF refusal at save,
    // exactly-once dispatch, Arabic RTL, and light/dark axe.
    {
      name: 'alerts',
      testMatch: /(?:^|\/)alerts\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Geogrid local rank tracking. Serial
    // because the journey signs up an isolated account, drives several
    // metered scans through the real `geogrid-scan` worker, reconciles the
    // `geogrid_scans` meter after every free and paid step, exhausts the
    // agency cap, and recreates the api with `GEOGRID_ENABLED=false` to prove
    // the kill switch before restoring it. Covers the typed-coordinate form
    // (no map vendor), the heat grid with its always-present accessible table
    // fallback, the partial-failure disclosure, Arabic RTL, and axe scans in
    // light and dark. Its `finally` block always recreates the api with the
    // flag back ON.
    {
      name: 'geogrid',
      testMatch: /(?:^|\/)geogrid\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // One serial fake-provider journey for
    // observable SSE paints, shared MCP tool permissions, persistence, the
    // no-plan lock, and light/dark axe scans. Account setup is isolated and all
    // browser egress remains loopback-only.
    {
      name: 'assistant-mcp',
      testMatch: /(?:^|\/)assistant-mcp\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Stored-inventory-only internal-link
    // guidance. Serial because the journey seeds one account's Mongo
    // inventory and Postgres GSC evidence, reconciles its metered runs, and
    // recreates the api with INTERNAL_LINKING_ENABLED=false before restoring
    // it. Includes CSV formula neutralization, Arabic RTL, keyboard-only
    // operation, and axe scans in light and dark.
    {
      name: 'internal-linking',
      testMatch: /(?:^|\/)internal-linking\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Deterministic SERP-overlap clustering
    // over stored observations. Serial because the journey seeds one account's
    // Postgres keywords/observations, exhausts the metered
    // `keyword_cluster_runs` cap, and recreates the api with
    // KEYWORD_CLUSTERING_ENABLED=false before restoring it. Includes the
    // stale/missing keyword block, free stored re-open, Arabic RTL, keyboard
    // operation, and axe scans in light and dark.
    {
      name: 'keyword-clustering',
      testMatch: /(?:^|\/)keyword-clustering\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // One serial fake-provider content-brief
    // journey covering preview/cancel, cited corpus evidence, editor history,
    // ceiling halt, flag, RTL, and axe.
    {
      name: 'content-briefs',
      testMatch: /(?:^|\/)content-briefs\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // White-label PDF + logo, scheduled
    // delivery through the real client-reports worker and deterministic fake
    // mail transport, public SSR portal/revocation, caps, flag-off, Arabic RTL,
    // keyboard operation, and light/dark axe. The spec restores the inherited
    // gate flag and mail transport on both api and worker, then verifies their
    // runtime parity in its finally block.
    {
      name: 'client-reports',
      testMatch: /(?:^|\/)client-reports\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Real Agency API-key creation followed by
    // CSV negotiation, stored SERP/backlink pagination, engine filtering,
    // foreign-account denial, flag-off compatibility, and the English/Arabic
    // Looker Studio docs with RTL + light/dark axe scans. The spec restores
    // PUBLIC_EXPORTS_ENABLED=true in `finally`.
    {
      name: 'public-exports',
      testMatch: /(?:^|\/)public-exports\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // rankme-app-seo wave 02 — format-only Play/Apple/paired registration,
    // Pro structural slots, deletion reuse, stored list reads with the master
    // flag off, Arabic RTL, and axe. The spec restores APP_SEO_ENABLED in its
    // finally block. Keep the global brand-radar flag-off project last.
    {
      name: 'app-profiles',
      testMatch: /(?:^|\/)app-profiles\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Consolidated deferred App SEO journeys. Each owns a fresh account and
    // deterministic fake-provider lifecycle; flag-mutating specs restore the
    // inherited API runtime before the next serial project begins.
    {
      name: 'app-keyword-tracking',
      testMatch: /(?:^|\/)app-keyword-tracking\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'app-listing-report',
      testMatch: /(?:^|\/)app-listing-report\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'app-chart-tracking',
      testMatch: /(?:^|\/)app-chart-tracking\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'app-research',
      testMatch: /(?:^|\/)app-research\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'app-review-intelligence',
      testMatch: /(?:^|\/)app-review-intelligence\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'app-cross-store',
      testMatch: /(?:^|\/)app-cross-store\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Canonical cross-batch release journeys: competitor/export work uses the
    // real fake-backed API, queue, worker, immutable snapshots, and public
    // lifecycle.
    {
      name: 'competitor-intelligence',
      testMatch: /(?:^|\/)competitor-intelligence\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      name: 'report-exports',
      testMatch: /(?:^|\/)report-exports\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Language unification — one authenticated, fake-provider
    // journey proving stale-read rejection, Arabic headers/RTL/errors/report
    // copy, byte-bearing PDF delivery, persistence, axe, and zero switch spend.
    {
      name: 'language-unification',
      testMatch: /(?:^|\/)language-unification\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    // Boots the composed api with BRAND_RADAR_ENABLED=false and
    // proves the kill switch at the transport boundary (503 on new runs,
    // 200 stored reads), then restores the flag. MUST stay the LAST project:
    // it force-recreates the `api` service twice, which is only race-free
    // because the whole suite runs serially and nothing follows it.
    {
      name: 'brand-radar-flag-off',
      testMatch: /(?:^|\/)brand-radar-flag-off\.spec\.ts$/,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
