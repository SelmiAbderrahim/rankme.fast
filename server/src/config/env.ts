import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../shared/i18n/locales.js';
import { decodeMasterKey } from '../shared/crypto/keys.js';
import { PAGESPEED_ADDITIONAL_SAMPLE_MAX } from "../shared/safety/pagespeed-defaults.js";
import { AI_PROVIDER_KEYS, type AiProviderKey, } from '../shared/providers/ai-generation.js';
import { assertPublicUrlSafe, type PublicUrlResolver, } from '../shared/security/url-safety.js';
// Secrets come from the root .env only — no Docker-secret `${KEY}_FILE`
// indirection. An earlier `_FILE` resolver let an empty mounted secret file
// silently override a valid .env value, so the whole mechanism was removed. See
// .claude/rules/environment-variables.md.
const localeSchema = z.enum(SUPPORTED_LOCALES);
/**
 * Deterministic providers are a test/demo substrate, never an implicit
 * production backend. A production process may use them only through the
 * explicit ALLOW_FAKE_PROVIDERS break-glass switch (CI/E2E sets it on while
 * also blanking every live credential).
 */
const FAKE_RUNTIME_KEYS = [
    'PROVIDER_AUDIT',
    'PROVIDER_RANK',
    'PROVIDER_KEYWORD',
    'PROVIDER_BACKLINK',
    'PROVIDER_COMPETITOR',
    'PROVIDER_LOCAL_LISTINGS',
    'PROVIDER_PAGESPEED',
    'PROVIDER_GSC',
    'PROVIDER_GA4',
    'PROVIDER_SUMMARY',
    'PROVIDER_AI_VISIBILITY',
    'PROVIDER_CONTENT_ANALYSIS',
    'PROVIDER_REVIEWS',
    'PROVIDER_TRENDS',
    'PROVIDER_APP_DATA',
    'PROVIDER_CONTENT_SOURCE',
    'PROVIDER_AI',
    'EMAIL_TRANSPORT',
] as const;
const optionalNonEmptyString = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
const booleanString = z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true');
const aiProviderOrderSchema = z
    .string()
    .default(AI_PROVIDER_KEYS.join(','))
    .transform((raw, context): AiProviderKey[] => {
    const values = raw.split(',').map((value) => value.trim());
    if (values.length === 0 || values.some((value) => value === '')) {
        context.addIssue({ code: 'custom', message: 'AI_PROVIDER_ORDER must not be empty' });
        return z.NEVER;
    }
    const allowed = new Set<string>(AI_PROVIDER_KEYS);
    const seen = new Set<string>();
    for (const value of values) {
        if (!allowed.has(value)) {
            context.addIssue({
                code: 'custom',
                message: `AI_PROVIDER_ORDER contains unknown provider: ${value}`,
            });
        }
        else if (seen.has(value)) {
            context.addIssue({
                code: 'custom',
                message: `AI_PROVIDER_ORDER contains duplicate provider: ${value}`,
            });
        }
        seen.add(value);
    }
    return values.filter((value): value is AiProviderKey => allowed.has(value));
});
const aiCostRateSchema = z.coerce
    .number()
    .int()
    .nonnegative()
    .max(1000000000)
    .optional();
const FIRECRAWL_MAX_FALLBACK_API_KEYS = 5;
const FIRECRAWL_MAX_WEBHOOK_SECRETS = (FIRECRAWL_MAX_FALLBACK_API_KEYS + 1) * 2;
function boundedUniqueSecretList(name: string, maximum: number) {
    return z.preprocess((value) => (value === undefined ? '' : value), z.string().transform((raw, context): string[] => {
        if (raw.trim() === '')
            return [];
        const entries = raw.split(',').map((secret) => secret.trim());
        if (entries.some((secret) => secret === '')) {
            context.addIssue({
                code: 'custom',
                message: `${name} must not contain empty secrets`,
            });
        }
        const secrets = entries.filter((secret) => secret !== '');
        if (secrets.length > maximum) {
            context.addIssue({
                code: 'custom',
                message: `${name} supports at most ${maximum} secrets`,
            });
        }
        if (new Set(secrets).size !== secrets.length) {
            context.addIssue({
                code: 'custom',
                message: `${name} must contain unique secrets`,
            });
        }
        return secrets;
    }));
}
const firecrawlWebhookCredentialSchema = z.string().refine((credential) => {
    if (credential === 'primary')
        return true;
    const match = /^fallback:(\d+)$/.exec(credential);
    return match !== null && Number(match[1]) < FIRECRAWL_MAX_FALLBACK_API_KEYS;
}, {
    message: `credential must be primary or fallback:0..${FIRECRAWL_MAX_FALLBACK_API_KEYS - 1}`,
});
const firecrawlWebhookSecretBindingSchema = z
    .object({
    credential: firecrawlWebhookCredentialSchema,
    // At most current + previous for a bounded zero-downtime rotation window.
    secrets: z
        .array(z.string().trim().min(1))
        .min(1)
        .max(2)
        .refine((secrets) => new Set(secrets).size === secrets.length, {
        message: 'binding secrets must be unique',
    }),
})
    .strict();
const firecrawlWebhookSecretBindingsSchema = z.preprocess((value, context) => {
    if (value === undefined || value === '')
        return [];
    if (typeof value !== 'string')
        return value;
    try {
        return JSON.parse(value) as unknown;
    }
    catch {
        context.addIssue({
            code: 'custom',
            message: 'FIRECRAWL_WEBHOOK_SECRET_BINDINGS must be valid JSON',
        });
        return [];
    }
}, z
    .array(firecrawlWebhookSecretBindingSchema)
    .max(FIRECRAWL_MAX_FALLBACK_API_KEYS + 1)
    .superRefine((bindings, context) => {
    const credentials = new Set<string>();
    const secrets = new Set<string>();
    bindings.forEach((binding, bindingIndex) => {
        if (credentials.has(binding.credential)) {
            context.addIssue({
                code: 'custom',
                path: [bindingIndex, 'credential'],
                message: 'each credential may appear in only one binding',
            });
        }
        credentials.add(binding.credential);
        binding.secrets.forEach((secret, secretIndex) => {
            if (secrets.has(secret)) {
                context.addIssue({
                    code: 'custom',
                    path: [bindingIndex, 'secrets', secretIndex],
                    message: 'a webhook secret may authenticate only one credential',
                });
            }
            secrets.add(secret);
        });
    });
}));
const firecrawlFallbackApiKeysSchema = z.preprocess((value) => (value === undefined ? '' : value), z.string().transform((raw, context): string[] => {
    if (raw.trim() === '')
        return [];
    const keys = raw.split(',').map((key) => key.trim());
    if (keys.some((key) => key === '')) {
        context.addIssue({
            code: 'custom',
            message: 'FIRECRAWL_FALLBACK_API_KEYS must not contain empty keys',
        });
    }
    if (keys.length > FIRECRAWL_MAX_FALLBACK_API_KEYS) {
        context.addIssue({
            code: 'custom',
            message: `FIRECRAWL_FALLBACK_API_KEYS supports at most ${FIRECRAWL_MAX_FALLBACK_API_KEYS} keys`,
        });
    }
    if (new Set(keys).size !== keys.length) {
        context.addIssue({
            code: 'custom',
            message: 'FIRECRAWL_FALLBACK_API_KEYS must contain unique keys',
        });
    }
    return keys;
}));
const masterEncryptionKey = z
    .string()
    .min(1, 'MASTER_ENCRYPTION_KEY is required')
    .refine((raw) => decodeMasterKey(raw) !== null, {
    message: 'MASTER_ENCRYPTION_KEY must decode to at least 32 bytes (hex, base64, or utf8)',
});
function isFirecrawlCloudOrigin(value: string): boolean {
    const url = new URL(value);
    return (url.protocol === 'https:' &&
        url.hostname === 'api.firecrawl.dev' &&
        url.username === '' &&
        url.password === '' &&
        (url.pathname === '' || url.pathname === '/') &&
        url.search === '' &&
        url.hash === '');
}
export const envSchema = z.object({
    APP_BUILD_SHA: z.string().regex(/^(?:dev|[a-f0-9]{7,12})$/iu).default('dev'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Production refuses deterministic fake backends unless the operator opts
    // in explicitly. This keeps CI/demo support without silently shipping mock
    // vendor results or simulated email as live product behavior.
    ALLOW_FAKE_PROVIDERS: booleanString,
    PORT: z.coerce.number().int().positive().default(8080),
    MONGODB_URI: z.string().min(1),
    // Postgres (Drizzle) — REQUIRED. Boot-time migrations run against this URL
    // before the HTTP server listens; startup fails loudly without it.
    DATABASE_URL: z.string().min(1),
    // postgres-js pool size. Default 10 matches typical Postgres out-of-box
    // max_connections headroom for both api + worker deployables. Bump on
    // higher-tier Postgres instances only after checking pg_stat_activity.
    PG_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.string().url().optional(),
    // Job layer — worker deployable knobs. The api ignores both.
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    WORKER_PORT: z.coerce.number().int().positive().default(8081),
    // Better Auth — signs session tokens + OAuth state. Required, ≥32 chars.
    BETTER_AUTH_SECRET: z.string().min(32),
    // Google OAuth (Better Auth social provider) — optional; the provider is
    // only registered when both halves are present.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    CLIENT_URL: z.string().url().default('http://localhost:3000'),
    APP_URL: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().url().optional()),
    SERVER_URL: z.string().url().default('http://localhost:8080'),
    // Public repository link listed in /llms.txt. Blank (default) omits it, so
    // nothing points at a repository before it is public. HTTPS only.
    GITHUB_REPOSITORY_URL: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z
        .string()
        .url()
        .refine((value) => new URL(value).protocol === 'https:', {
        message: 'GITHUB_REPOSITORY_URL must be an https URL',
    })
        .optional()),
    // Release stage shared with the client build: `ga` drops the public-beta
    // status line from /llms.txt; blank or anything else means `beta`.
    VITE_RELEASE_STAGE: z.preprocess((value) => (typeof value === 'string' && value.trim().toLowerCase() === 'ga' ? 'ga' : 'beta'), z.enum(['beta', 'ga'])),
    DEFAULT_LOCALE: localeSchema.default('en'),
    // Encryption — required. See shared/crypto/README.md for the rotation runbook.
    MASTER_ENCRYPTION_KEY: masterEncryptionKey,
    // Email (Resend) — optional. The stack boots without these.
    EMAIL_TRANSPORT: z.enum(['resend', 'fake']).default('resend'),
    // Isolated composed-E2E seam. When explicitly enabled alongside the fake
    // transport, the API writes a bounded, mode-0600 mailbox under /tmp so
    // Playwright can prove credential emails without a public debug endpoint.
    E2E_EMAIL_CAPTURE: booleanString,
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM: z.string().optional(),
    // Recipient of contact-form messages. Required for the /api/contact route to
    // actually deliver; otherwise the send throws so misconfig fails loudly instead
    // of dropping mail. Kept optional in schema so `sendEmail` remains a no-op on
    // an unconfigured stack.
    CONTACT_FORM_RECIPIENT: z.string().email().optional(),
    // Optional failure-alert webhook. When set, `sendFailureAlert` POSTs the
    // alert payload here in addition to the Resend email.
    // docker-compose forwards `${ALERT_WEBHOOK_URL:-}`, which becomes an empty
    // string when the operator leaves it unset; coerce empty → undefined so the
    // optional() branch applies instead of `.url()` rejecting "" and crashing boot.
    ALERT_WEBHOOK_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    // ------------------------------------------------------------------
    // Security: rate-limit knobs + CSRF cookie name + legal
    // grace-period. All optional with production-safe defaults.
    // ------------------------------------------------------------------
    RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(30),
    // Admin-overview aggregation window for `rate_limit_hits`.
    // Defaults to 1h; operators can widen for slow-burn campaigns without a
    // process restart of any downstream service.
    RATE_LIMIT_METRICS_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
    // Public read-only API (/api/v1) limiter — keyed per bearer token (sha256)
    // when present, per IP otherwise. Defaults: 120 requests / minute.
    RATE_LIMIT_API_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(120),
    // Unified report shares: unknown tokens are bounded per IP before lookup;
    // proven tokens then receive their own higher read bucket.
    RATE_LIMIT_REPORT_EXPORT_PUBLIC_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_REPORT_EXPORT_PUBLIC_IP_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_REPORT_EXPORT_PUBLIC_TOKEN_MAX: z.coerce.number().int().positive().default(120),
    // Contact-form limiter — per-IP; the /api/communication/contact POST only.
    // Defaults: 5 requests / 15 minutes.
    // Public contact-sales lead endpoint. Strict
    // per-IP bucket: the route is unauthenticated
    // and writes a row plus an email, so it is a spam target.
    RATE_LIMIT_ENTERPRISE_LEAD_WINDOW_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(60 * 60 * 1000),
    RATE_LIMIT_ENTERPRISE_LEAD_MAX: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_CONTACT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_CONTACT_MAX: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_CONTENT_CREATE_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_CONTENT_CREATE_MAX: z.coerce.number().int().positive().default(10),
    // Content Intelligence read/poll bucket: bounds 404-probing +
    // status hammering on GET list / GET detail. Per-account.
    RATE_LIMIT_CONTENT_POLL_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_CONTENT_POLL_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_RECOMMENDATION_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_RECOMMENDATION_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_INVENTORY_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_INVENTORY_MAX: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_COMPETITOR_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_COMPETITOR_MAX: z.coerce.number().int().positive().default(30),
    // Link Intelligence paid mutations share one per-account bucket across
    // deep pulls and link-gap starts. Defaults: 30 requests / minute.
    RATE_LIMIT_LINK_INTEL_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_LINK_INTEL_MAX: z.coerce.number().int().positive().default(30),
    // Link Intelligence stored-result reads use an independent per-account
    // poll bucket so polling cannot lock an account out of paid mutations.
    RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_LINK_INTEL_POLL_MAX: z.coerce.number().int().positive().default(60),
    // Traffic Insights snapshot POSTs — one per-account bucket, 10/minute.
    RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX: z.coerce.number().int().positive().default(10),
    // Review Intelligence mutation bucket — source CRUD + sync
    // submits share one per-account bucket. Deliberately tighter than the
    // read/poll surfaces: every sync submit spends vendor calls.
    RATE_LIMIT_REVIEW_SYNC_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_REVIEW_SYNC_MAX: z.coerce.number().int().positive().default(20),
    // Brand Radar scan-create bucket — per-account. Every POST
    // /api/brand-radar/scans spends vendor calls, so the
    // create bucket is deliberately tighter than the read/poll one.
    RATE_LIMIT_BRAND_RADAR_CREATE_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_BRAND_RADAR_CREATE_MAX: z.coerce.number().int().positive().default(10),
    // Brand Radar read/poll bucket — bounds status hammering and 404 probing
    // on GET list + GET detail. Per-account.
    RATE_LIMIT_BRAND_RADAR_POLL_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_BRAND_RADAR_POLL_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_FIRECRAWL_WEBHOOK_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_FIRECRAWL_WEBHOOK_MAX: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_MCP_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_MCP_MAX: z.coerce.number().int().positive().default(120),
    // AI Assistant chat bucket — per-account named
    // bucket over every /api/chat route. Deliberately tight: each message POST
    // opens an SSE stream and spends an AI generation.
    RATE_LIMIT_CHAT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_CHAT_MAX: z.coerce.number().int().positive().default(20),
    // MCP kill switch. Default true so a fresh boot lights up the
    // /api/mcp endpoint; flip to false to return the localized unavailable
    // response without disabling API-key management.
    MCP_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    // AI Assistant kill switch. Default true so a
    // fresh boot lights up /api/chat; flip to false to return the localized
    // unavailable response on new-message sends while conversation reads stay
    // available. Same shape and semantics as MCP_ENABLED.
    CHAT_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    // Content Intelligence rollout flags. Default true so a fresh
    // boot serves the shipped surface; flip to false to return the localized
    // product-unavailable response on new-run entry points while preserving
    // existing result reads. Accepted jobs finish to a consistent terminal
    // state. Monitoring stops its public webhook, API queue holder, and recurring
    // producer when disabled; its consumers remain subscribed to drain receipts
    // and reconciliation ticks that were durably accepted before rollback.
    //
    // Superadmin exposes the resolved values read-only.
    CONTENT_INTELLIGENCE_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    CONTENT_INVENTORY_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    COMPETITOR_CONTENT_INTELLIGENCE_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    // Competitor Intelligence landscape starts. Existing history and accepted
    // jobs remain readable/drainable while disabled.
    COMPETITOR_INTELLIGENCE_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    CONTENT_MONITORING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('true')
        .transform((v) => v === 'true'),
    // rankme-semrush-parity kill switches. All default false; each
    // flag is a declared seam that a later prompt reads before serving its
    // feature entry points. Disabled = localized product-unavailable response
    // on new-run entry points; stored-result reads survive; queued/running
    // jobs finish to a consistent terminal state. Superadmin exposes the
    // resolved values read-only via IntelligenceThresholdsDto.envKillSwitches.
    BRAND_RADAR_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    REVIEW_INTELLIGENCE_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    LINK_INTELLIGENCE_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    TRAFFIC_INSIGHTS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    KEYWORD_TRENDS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    // ------------------------------------------------------------------
    // rankme-community-requests kill switches. Twelve operator
    // seams, all default false. Each flag is DECLARED here and read by the
    // prompt that owns its feature — this prompt adds no runtime consumer.
    // Disabled = localized product-unavailable response on new-run entry
    // points; stored-result reads survive; queued/running jobs finish to a
    // consistent terminal state. Superadmin exposes the resolved values
    // read-only via IntelligenceThresholdsDto.communityKillSwitches.
    // ------------------------------------------------------------------
    SERP_FEATURE_TRACKING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    KEYWORD_CLUSTERING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    ALT_ENGINE_TRACKING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    CANNIBALIZATION_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    TOXIC_LINKS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    ALERTS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    INTERNAL_LINKING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    CONTENT_BRIEFS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    GEOGRID_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    SCHEMA_GENERATOR_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    CLIENT_REPORTS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    PUBLIC_EXPORTS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    // ------------------------------------------------------------------
    // rankme-app-seo kill switches. Six operator seams, all
    // default false. Each flag is DECLARED here and read by the prompt that
    // owns its feature — this prompt adds no runtime consumer.
    // `APP_SEO_ENABLED` is the master switch over app profiles and every
    // `/api/sites/:siteId/apps/*` entry point (the zero-spend cross-store
    // comparison view rides it too, since it reads stored snapshots only);
    // the other five gate their own surface underneath it.
    // Disabled = localized product-unavailable response on new-run entry
    // points; stored-result reads survive; queued/running jobs finish to a
    // consistent terminal state. Superadmin exposes the resolved values
    // read-only via IntelligenceThresholdsDto.appSeoKillSwitches.
    // ------------------------------------------------------------------
    APP_SEO_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    APP_KEYWORD_TRACKING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    APP_LISTING_AUDITS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    APP_CHART_TRACKING_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    APP_RESEARCH_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    APP_REVIEWS_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    // App SEO AI ceiling. `maxCostMicros` for the `app_review_clusters`
    // profile — the enforced pre-dispatch halt and the `app_review_runs`
    // unit-cost row cite this one number (12 Apple review blocks 18_000 +
    // this 40_000 ceiling = the 58_000-micro unit). Positive integer.
    APP_REVIEW_AI_COST_CEILING_MICROS: z.coerce.number().int().positive().default(40000),
    // rankme-app-seo named rate buckets, per account.
    // `CREATE` covers every paid ASO submit across the surfaces (keyword
    // re-checks, listing runs, chart checks, research lookups, competitor
    // discovery, review pulls) — one shared bucket so a single account cannot
    // fan out spend across six panels. `POLL` covers stored reads, which cost
    // nothing and are polled by history charts.
    RATE_LIMIT_APP_SEO_CREATE_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_APP_SEO_CREATE_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_APP_SEO_POLL_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_APP_SEO_POLL_MAX: z.coerce.number().int().positive().default(60),
    // ------------------------------------------------------------------
    // rankme-community-requests per-run direct-cost ceilings, micros USD
    //. Each mirrors the metric's `VENDOR_UNIT_COST_MICROS` row so
    // the enforced runtime halt and the margin math cite one number. Positive
    // integers; the owning prompt enforces the rolling halt.
    // ------------------------------------------------------------------
    CONTENT_BRIEF_COST_CEILING_MICROS: z.coerce.number().int().positive().default(120000),
    INTERNAL_LINKING_COST_CEILING_MICROS: z.coerce.number().int().positive().default(12000),
    TOXICITY_COST_CEILING_MICROS: z.coerce.number().int().positive().default(30000),
    SCHEMA_GEN_COST_CEILING_MICROS: z.coerce.number().int().positive().default(6000),
    RATE_LIMIT_SUPERADMIN_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
    RATE_LIMIT_SUPERADMIN_MAX: z.coerce.number().int().positive().default(60),
    CSRF_COOKIE_NAME: z.string().min(1).default('x-csrf-token'),
    CSRF_HEADER_NAME: z.string().min(1).default('x-csrf-token'),
    // Hours between account-deletion request and the irreversible purge.
    // Final warning email fires at 24h before the purge window closes.
    ACCOUNT_DELETION_GRACE_HOURS: z.coerce.number().int().positive().default(30 * 24),
    // Superadmin step-up re-auth freshness. Mutating actions on the
    // superadmin control plane (DLQ requeue, kill-switch flip, monitor
    // reconcile, non-content cache invalidation) refuse a session whose last
    // fresh authentication is older than this. Default: 5 minutes.
    SUPERADMIN_STEPUP_WINDOW_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
    // Superadmin alert dedup window. Alerts with the same key inside this
    // window are collapsed to a single notification. Default: 15 minutes.
    SUPERADMIN_ALERT_DEDUP_WINDOW_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(15 * 60 * 1000),
    // ------------------------------------------------------------------
    // Vendor providers: DataForSEO credentials + per-capability
    // provider selection. Defaults keep local tests deterministic; the production
    // super-refinement below rejects every fake selector unless the explicit
    // ALLOW_FAKE_PROVIDERS break-glass switch is enabled.
    // Sandbox base URL (https://sandbox.dataforseo.com/v3) is a drop-in swap.
    // ------------------------------------------------------------------
    DATAFORSEO_LOGIN: z.string().optional(),
    DATAFORSEO_PASSWORD: z.string().optional(),
    DATAFORSEO_BASE_URL: z.string().url().default('https://api.dataforseo.com/v3'),
    PROVIDER_AUDIT: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_RANK: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_KEYWORD: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_BACKLINK: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_COMPETITOR: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_LOCAL_LISTINGS: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_PAGESPEED: z.enum(['dataforseo', 'google', 'fake']).default('fake'),
    /** Google Cloud API key — PageSpeed Insights + CrUX. Required only when PROVIDER_PAGESPEED=google. */
    GOOGLE_API_KEY: z.string().optional(),
    /**
     * PageSpeed sampling ceiling. The audit processor analyzes the
     * site root URL plus up to this many highest-in-link-count pages —
     * NEVER on every crawled page. The root plus this bounded additional set
     * keeps both Google quota and DataForSEO Lighthouse spend finite.
     */
    PAGESPEED_SAMPLE_SIZE: z.coerce
        .number()
        .int()
        .min(0)
        .max(PAGESPEED_ADDITIONAL_SAMPLE_MAX)
        .default(PAGESPEED_ADDITIONAL_SAMPLE_MAX),
    /**
     * Cross-user PageSpeed cache TTL (generic vendor layer). One analyze() per
     * (url, strategy) per window serves every account auditing that URL.
     */
    PAGESPEED_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(24),
    PROVIDER_GSC: z.enum(['google', 'fake']).default('fake'),
    /**
     * GA4 (Analytics Data API + Admin API account summaries). Shares the
     * Better Auth Google OAuth client with GSC — one token, one connection.
     * Free Google quota; never metered.
     */
    PROVIDER_GA4: z.enum(['google', 'fake']).default('fake'),
    /**
     * GA4 export lag in days — runReport windows end at `today - GA4_LAG_DAYS`
     * (GA4 standard properties finalize within ~24-48h).
     */
    GA4_LAG_DAYS: z.coerce.number().int().min(0).default(1),
    /**
     * AI Visibility — DataForSEO AI Optimization API (LLM Mentions,
     * LLM Responses, AI Keyword Search Volume). Feature module + metering
     * wiring lives; deterministic mode is for development/CI only.
     */
    PROVIDER_AI_VISIBILITY: z.enum(['dataforseo', 'fake']).default('fake'),
    /**
     * Content Analysis — DataForSEO
     * `content_analysis/search/live` + `summary/live`. Provider seam only;
     * no feature module consumes it yet — the Brand Radar pipeline will.
     * Selecting `dataforseo` without
     * DATAFORSEO_LOGIN/PASSWORD fails startup loudly (registry-level).
     */
    PROVIDER_CONTENT_ANALYSIS: z.enum(['dataforseo', 'fake']).default('fake'),
    /**
     * Reviews — DataForSEO Business Data
     * reviews for Google/Trustpilot/Tripadvisor. Provider seam only; Prompt
     * 06 lands the Review Intelligence feature module.
     */
    PROVIDER_REVIEWS: z.enum(['dataforseo', 'fake']).default('fake'),
    /**
     * Google Trends — DataForSEO
     * `keywords_data/google_trends/explore/live`. Provider seam only in this
     * batch; feature module (Keyword Trends) lands later.
     * Selecting `dataforseo` without DATAFORSEO_LOGIN/PASSWORD fails startup
     * loudly (registry-level).
     */
    PROVIDER_TRENDS: z.enum(['dataforseo', 'fake']).default('fake'),
    /**
     * Mobile App Data + Labs research. Store is an
     * operation input, not a second selector. The registry fails startup when
     * `dataforseo` is selected without both DataForSEO credentials.
     */
    PROVIDER_APP_DATA: z.enum(['dataforseo', 'fake']).default('fake'),
    PROVIDER_CONTENT_SOURCE: z.enum(['firecrawl', 'fake']).default('fake'),
    FIRECRAWL_API_KEY: z.preprocess((value) => {
        if (typeof value !== 'string')
            return value;
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }, z.string().min(1).optional()),
    // Ordered, bounded same-vendor failover credentials. Each logical operation
    // starts with FIRECRAWL_API_KEY; resource follow-ups stay pinned to the key
    // that created the remote resource.
    FIRECRAWL_FALLBACK_API_KEYS: firecrawlFallbackApiKeysSchema,
    FIRECRAWL_BASE_URL: z.preprocess((value) => (value === '' ? undefined : value), z
        .string()
        .url()
        .refine(isFirecrawlCloudOrigin, {
        message: 'FIRECRAWL_BASE_URL must be the HTTPS Firecrawl Cloud API origin',
    })
        .optional()),
    FIRECRAWL_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(60000),
    FIRECRAWL_MAX_PAGE_CHARS: z.coerce.number().int().positive().max(1000000).default(100000),
    FIRECRAWL_MAX_CRAWL_PAGES: z.coerce.number().int().positive().max(1000).default(100),
    FIRECRAWL_COST_MICROS_PER_CREDIT: z.coerce.number().int().nonnegative().default(1000),
    /**
     * Operator attestation that Firecrawl Cloud Zero Data Retention is enabled
     * for every account keyed by FIRECRAWL_API_KEY and
     * FIRECRAWL_FALLBACK_API_KEYS (Enterprise ZDR entitlement).
     * The adapter still sends `zeroDataRetention: true` on every request, but
     * without the operator attestation env validation refuses to construct the
     * live provider. Must use the strict `booleanString` parser so the literal
     * string 'false' remains false — never `z.coerce.boolean()`, which would
     * treat 'false' as truthy and defeat the gate.
     */
    FIRECRAWL_ZDR_ENABLED: booleanString,
    // Deprecated unbound Firecrawl webhook secret slots. They remain parsed for
    // a bounded migration window but NEVER authorize a delivery: live monitoring
    // requires the explicit credential bindings below. Never logged.
    FIRECRAWL_WEBHOOK_SECRET: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
    FIRECRAWL_WEBHOOK_SECRETS: boundedUniqueSecretList('FIRECRAWL_WEBHOOK_SECRETS', FIRECRAWL_MAX_WEBHOOK_SECRETS),
    // JSON array: [{"credential":"primary","secrets":["current","previous"]},
    // {"credential":"fallback:0","secrets":["current"]}]. Credential slots
    // bind signatures to the API-key account that owns the remote monitor.
    FIRECRAWL_WEBHOOK_SECRET_BINDINGS: firecrawlWebhookSecretBindingsSchema,
    // Content-monitor reconciliation sweep interval (weekly reservation + drift +
    // stuck-receipt re-enqueue). Default: 5 minutes.
    CONTENT_MONITOR_RECON_INTERVAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(5 * 60 * 1000),
    // Alert detection sweep interval. The sweep is a
    // READ-ONLY scan of settled `rank_drop_confirmations`; it never writes that
    // table and re-running it cannot re-deliver, so the cadence is purely a
    // latency knob. Default: 5 minutes.
    ALERT_SWEEP_INTERVAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(5 * 60 * 1000),
    // Content Intelligence: per-analysis direct-cost ceiling and
    // AI sub-budget in micros USD. Runs abort further vendor spend when the
    // rolling per-analysis cost approaches the ceiling.
    CONTENT_ANALYSIS_COST_CEILING_MICROS: z.coerce
        .number()
        .int()
        .positive()
        .default(250000),
    CONTENT_ANALYSIS_AI_BUDGET_MICROS: z.coerce
        .number()
        .int()
        .positive()
        .default(140000),
    // ContentSnapshot Mongo TTL — sanitized excerpts expire after N days so the
    // storage footprint stays bounded and stale competitor content cannot be
    // reused after the cache freshness window has passed.
    CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS: z.coerce.number().int().positive().default(7),
    // Content inventory + cannibalization — hard operator ceiling on
    // the requested owned-page crawl limit. The zod input schema clamps a run's
    // `pageLimit` to `1..CONTENT_INVENTORY_MAX_PAGES` so a huge value can never
    // crawl beyond policy.
    CONTENT_INVENTORY_MAX_PAGES: z.coerce.number().int().positive().max(1000).default(100),
    // Vendor-neutral structured AI generation. The fake is keyless; live mode
    // requires at least one enabled provider in the validated order below.
    PROVIDER_AI: z.enum(['fake', 'ai-sdk']).default('fake'),
    AI_PROVIDER_ORDER: aiProviderOrderSchema,
    AI_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
    AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(6),
    AI_TELEMETRY_ENABLED: booleanString,
    AI_ACCOUNT_SPEND_WINDOW_MS: z.coerce
        .number()
        .int()
        .min(60000)
        .max(30 * 24 * 60 * 60 * 1000)
        .default(60 * 60 * 1000),
    AI_ACCOUNT_SPEND_LIMIT_MICROS: z.coerce
        .number()
        .int()
        .positive()
        .max(1000000000000)
        .default(1000000),
    AI_USAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    // AI Assistant streaming chat. Per-message output
    // ceiling, whole-stream wall clock, and the ai-sdk multi-step tool loop
    // bound (`stopWhen: stepCountIs(maxSteps)`). The output-token ceiling is
    // mirrored by `VENDOR_UNIT_COST_MICROS.ai_chat_messages` — raising it
    // without revisiting that envelope breaks the margin gate.
    AI_CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(32768).default(2048),
    AI_CHAT_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(120000),
    AI_CHAT_MAX_STEPS: z.coerce.number().int().positive().max(20).default(5),
    GLM_ENABLED: booleanString,
    GLM_API_KEY: optionalNonEmptyString,
    GLM_MODEL: optionalNonEmptyString,
    GLM_BASE_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().max(2048).optional()),
    GLM_INPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    GLM_OUTPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    DEEPSEEK_ENABLED: booleanString,
    DEEPSEEK_API_KEY: optionalNonEmptyString,
    DEEPSEEK_MODEL: optionalNonEmptyString,
    DEEPSEEK_INPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    KIMI_ENABLED: booleanString,
    KIMI_API_KEY: optionalNonEmptyString,
    KIMI_MODEL: optionalNonEmptyString,
    KIMI_INPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    KIMI_OUTPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    OPENAI_ENABLED: booleanString,
    OPENAI_API_KEY: optionalNonEmptyString,
    OPENAI_MODEL: optionalNonEmptyString,
    OPENAI_INPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    OPENAI_OUTPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    GOOGLE_ENABLED: booleanString,
    GOOGLE_GENERATIVE_AI_API_KEY: optionalNonEmptyString,
    GOOGLE_MODEL: optionalNonEmptyString,
    GOOGLE_INPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    GOOGLE_OUTPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    ANTHROPIC_ENABLED: booleanString,
    ANTHROPIC_MODEL: optionalNonEmptyString,
    ANTHROPIC_INPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION: aiCostRateSchema,
    // Optional AI summary — Claude generates a plain-language
    // summary of Fix-now findings. Feature-flagged AND key-gated: audit is
    // never dependent, the checklist byte-identical when the helper is off.
    PROVIDER_SUMMARY: z.enum(['anthropic', 'ai-sdk', 'fake']).default('fake'),
    AI_SUMMARY_ENABLED: z
        .union([z.literal('true'), z.literal('false')])
        .default('false')
        .transform((v) => v === 'true'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_SUMMARY_MODEL: z.string().default('claude-haiku-4-5'),
    /**
     * GSC URL-inspection sampling ceiling. Audit runs inspect the
     * site root plus up to this many pages per run, staying under the 2000/day
     * and 600/min per-property Search Console quotas. 0 disables GSC entirely.
     */
    GSC_INSPECT_SAMPLE: z.coerce.number().int().min(0).default(10),
    // ------------------------------------------------------------------
    // Audit pipeline. Vendor crawls asynchronously; the processor
    // polls until finished OR the overall run deadline lapses. Defaults align
    // with DataForSEO guidance: poll every 30s, cap a run at 30 minutes.
    // ------------------------------------------------------------------
    // Cross-user SERP cache. 24h default: a daily-cadence fetch
    // can serve weekly users; a weekly check accepts cache ≤ TTL hours old.
    SERP_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(24),
    // Cross-user keyword-metrics cache. 30 days: vendor volume data
    // updates monthly — shorter would burn cost for no fresher signal.
    KEYWORD_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // SERP depth. The sold/storage/rank-observation contract is
    // top 100; accepting a larger vendor request would exceed both that public
    // boundary and the unit-cost model.
    SERP_DEPTH: z.coerce.number().int().positive().max(100).default(100),
    // Depth for the synchronous live SERP path used by rank checks.
    // Live bills $0.002/page, so this is capped at 30 (3 pages = $0.006) to stay
    // within the serp_checks unit-cost bound. Default 20 (2 pages = $0.004).
    SERP_LIVE_DEPTH: z.coerce.number().int().positive().max(30).default(20),
    // How long a rank check waits for DataForSEO's ASYNC task queue before it
    // gives up. Rank checks run through `task_post` → `task_get`, and a task
    // that is still `in_queue` is re-polled at this interval up to this many
    // attempts; exhausting them raises a keyword-scoped `VendorUnavailableError`
    // that costs a check without producing a position. Interval x attempts is
    // therefore the real wait budget — 3s x 60 = 180s by default, which leaves
    // headroom over the standard queue instead of racing it. Bounded so a
    // misconfiguration cannot pin a worker slot on one keyword.
    SERP_TASK_POLL_INTERVAL_MS: z.coerce.number().int().positive().max(30000).default(3000),
    SERP_TASK_MAX_POLL_ATTEMPTS: z.coerce.number().int().positive().max(200).default(60),
    AUDIT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    AUDIT_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // ------------------------------------------------------------------
    // SuperAdmin bootstrap (prompt: superadmin). Both optional — a self-host
    // that does not want a seeded platform owner simply leaves them unset and
    // the boot seeder no-ops. The seeder is bootstrap-only: it creates the
    // account when missing and NEVER overwrites/rotates an existing one.
    // SUPERADMIN_PASSWORD is redacted from all logs (see config/logger.ts).
    // ------------------------------------------------------------------
    SUPERADMIN_EMAIL: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().email().optional()),
    SUPERADMIN_PASSWORD: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().min(12).optional()),
}).superRefine((value, context) => {
    if (value.APP_URL) {
        const clientUrl = new URL(value.CLIENT_URL);
        const appUrl = new URL(value.APP_URL);
        const sameOrChildHostname = appUrl.hostname === clientUrl.hostname || appUrl.hostname.endsWith(`.${clientUrl.hostname}`);
        if (appUrl.protocol !== clientUrl.protocol || !sameOrChildHostname) {
            context.addIssue({
                code: 'custom',
                path: ['APP_URL'],
                message: 'APP_URL must use the CLIENT_URL protocol and hostname or one of its subdomains',
            });
        }
        if (appUrl.username !== '' ||
            appUrl.password !== '' ||
            (appUrl.pathname !== '' && appUrl.pathname !== '/') ||
            appUrl.search !== '' ||
            appUrl.hash !== '') {
            context.addIssue({
                code: 'custom',
                path: ['APP_URL'],
                message: 'APP_URL must be an origin without credentials, path, query, or fragment',
            });
        }
    }
    if (value.NODE_ENV === 'production' && !value.ALLOW_FAKE_PROVIDERS) {
        for (const key of FAKE_RUNTIME_KEYS) {
            if (value[key] !== 'fake')
                continue;
            context.addIssue({
                code: 'custom',
                path: [key],
                message: `${key}=fake is forbidden in production unless ALLOW_FAKE_PROVIDERS=true`,
            });
        }
    }
    if (value.E2E_EMAIL_CAPTURE &&
        (value.EMAIL_TRANSPORT !== 'fake' || !value.ALLOW_FAKE_PROVIDERS)) {
        context.addIssue({
            code: 'custom',
            path: ['E2E_EMAIL_CAPTURE'],
            message: 'E2E_EMAIL_CAPTURE requires EMAIL_TRANSPORT=fake and ALLOW_FAKE_PROVIDERS=true',
        });
    }
    if (value.FIRECRAWL_API_KEY !== undefined &&
        value.FIRECRAWL_FALLBACK_API_KEYS.includes(value.FIRECRAWL_API_KEY)) {
        context.addIssue({
            code: 'custom',
            path: ['FIRECRAWL_FALLBACK_API_KEYS'],
            message: 'FIRECRAWL_FALLBACK_API_KEYS must not duplicate FIRECRAWL_API_KEY',
        });
    }
    if (value.FIRECRAWL_WEBHOOK_SECRET !== undefined &&
        value.FIRECRAWL_WEBHOOK_SECRETS.includes(value.FIRECRAWL_WEBHOOK_SECRET)) {
        context.addIssue({
            code: 'custom',
            path: ['FIRECRAWL_WEBHOOK_SECRETS'],
            message: 'FIRECRAWL_WEBHOOK_SECRETS must not duplicate FIRECRAWL_WEBHOOK_SECRET',
        });
    }
    if (value.PROVIDER_CONTENT_SOURCE === 'firecrawl') {
        if (!value.FIRECRAWL_API_KEY) {
            context.addIssue({
                code: 'custom',
                path: ['FIRECRAWL_API_KEY'],
                message: 'FIRECRAWL_API_KEY is required when PROVIDER_CONTENT_SOURCE=firecrawl',
            });
        }
        if (!value.FIRECRAWL_BASE_URL) {
            context.addIssue({
                code: 'custom',
                path: ['FIRECRAWL_BASE_URL'],
                message: 'FIRECRAWL_BASE_URL is required when PROVIDER_CONTENT_SOURCE=firecrawl',
            });
        }
        if (value.FIRECRAWL_ZDR_ENABLED !== true) {
            context.addIssue({
                code: 'custom',
                path: ['FIRECRAWL_ZDR_ENABLED'],
                message: 'FIRECRAWL_ZDR_ENABLED must be "true" when PROVIDER_CONTENT_SOURCE=firecrawl; the operator must confirm every configured Firecrawl Cloud account has Zero Data Retention enabled before live scrapes/crawls may run',
            });
        }
        if (value.CONTENT_MONITORING_ENABLED) {
            const requiredCredentials = [
                'primary',
                ...value.FIRECRAWL_FALLBACK_API_KEYS.map((_, index) => `fallback:${index}`),
            ];
            const configuredCredentials = new Set(value.FIRECRAWL_WEBHOOK_SECRET_BINDINGS.map((binding) => binding.credential));
            if (configuredCredentials.size !== requiredCredentials.length ||
                requiredCredentials.some((credential) => !configuredCredentials.has(credential))) {
                context.addIssue({
                    code: 'custom',
                    path: ['FIRECRAWL_WEBHOOK_SECRET_BINDINGS'],
                    message: 'Live Firecrawl content monitoring requires exactly one explicit webhook-secret binding for primary and every configured fallback credential',
                });
            }
        }
    }
    if (value.CONTENT_ANALYSIS_AI_BUDGET_MICROS > value.CONTENT_ANALYSIS_COST_CEILING_MICROS) {
        context.addIssue({
            code: 'custom',
            path: ['CONTENT_ANALYSIS_AI_BUDGET_MICROS'],
            message: 'CONTENT_ANALYSIS_AI_BUDGET_MICROS must not exceed CONTENT_ANALYSIS_COST_CEILING_MICROS',
        });
    }
    if (value.AI_MAX_ATTEMPTS > value.AI_PROVIDER_ORDER.length) {
        context.addIssue({
            code: 'custom',
            path: ['AI_MAX_ATTEMPTS'],
            message: 'AI_MAX_ATTEMPTS must not exceed AI_PROVIDER_ORDER length',
        });
    }
    if (value.AI_SUMMARY_ENABLED &&
        value.PROVIDER_SUMMARY === 'ai-sdk' &&
        value.PROVIDER_AI !== 'ai-sdk') {
        context.addIssue({
            code: 'custom',
            path: ['PROVIDER_SUMMARY'],
            message: 'PROVIDER_SUMMARY=ai-sdk requires PROVIDER_AI=ai-sdk',
        });
    }
    if (value.AI_SUMMARY_ENABLED &&
        value.PROVIDER_SUMMARY === 'anthropic' &&
        value.ANTHROPIC_API_KEY) {
        for (const [path, configured] of [
            ['ANTHROPIC_INPUT_COST_MICROS_PER_MILLION', value.ANTHROPIC_INPUT_COST_MICROS_PER_MILLION],
            ['ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION', value.ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION],
        ] as const) {
            if (configured === undefined) {
                context.addIssue({
                    code: 'custom',
                    path: [path],
                    message: `${path} is required for the legacy Anthropic summary profile`,
                });
            }
        }
    }
    if (value.PROVIDER_AI !== 'ai-sdk')
        return;
    const specs = {
        glm: {
            enabled: value.GLM_ENABLED,
            key: value.GLM_API_KEY,
            keyPath: 'GLM_API_KEY',
            model: value.GLM_MODEL,
            modelPath: 'GLM_MODEL',
            inputRate: value.GLM_INPUT_COST_MICROS_PER_MILLION,
            inputRatePath: 'GLM_INPUT_COST_MICROS_PER_MILLION',
            outputRate: value.GLM_OUTPUT_COST_MICROS_PER_MILLION,
            outputRatePath: 'GLM_OUTPUT_COST_MICROS_PER_MILLION',
        },
        deepseek: {
            enabled: value.DEEPSEEK_ENABLED,
            key: value.DEEPSEEK_API_KEY,
            keyPath: 'DEEPSEEK_API_KEY',
            model: value.DEEPSEEK_MODEL,
            modelPath: 'DEEPSEEK_MODEL',
            inputRate: value.DEEPSEEK_INPUT_COST_MICROS_PER_MILLION,
            inputRatePath: 'DEEPSEEK_INPUT_COST_MICROS_PER_MILLION',
            outputRate: value.DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION,
            outputRatePath: 'DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION',
        },
        kimi: {
            enabled: value.KIMI_ENABLED,
            key: value.KIMI_API_KEY,
            keyPath: 'KIMI_API_KEY',
            model: value.KIMI_MODEL,
            modelPath: 'KIMI_MODEL',
            inputRate: value.KIMI_INPUT_COST_MICROS_PER_MILLION,
            inputRatePath: 'KIMI_INPUT_COST_MICROS_PER_MILLION',
            outputRate: value.KIMI_OUTPUT_COST_MICROS_PER_MILLION,
            outputRatePath: 'KIMI_OUTPUT_COST_MICROS_PER_MILLION',
        },
        openai: {
            enabled: value.OPENAI_ENABLED,
            key: value.OPENAI_API_KEY,
            keyPath: 'OPENAI_API_KEY',
            model: value.OPENAI_MODEL,
            modelPath: 'OPENAI_MODEL',
            inputRate: value.OPENAI_INPUT_COST_MICROS_PER_MILLION,
            inputRatePath: 'OPENAI_INPUT_COST_MICROS_PER_MILLION',
            outputRate: value.OPENAI_OUTPUT_COST_MICROS_PER_MILLION,
            outputRatePath: 'OPENAI_OUTPUT_COST_MICROS_PER_MILLION',
        },
        google: {
            enabled: value.GOOGLE_ENABLED,
            key: value.GOOGLE_GENERATIVE_AI_API_KEY,
            keyPath: 'GOOGLE_GENERATIVE_AI_API_KEY',
            model: value.GOOGLE_MODEL,
            modelPath: 'GOOGLE_MODEL',
            inputRate: value.GOOGLE_INPUT_COST_MICROS_PER_MILLION,
            inputRatePath: 'GOOGLE_INPUT_COST_MICROS_PER_MILLION',
            outputRate: value.GOOGLE_OUTPUT_COST_MICROS_PER_MILLION,
            outputRatePath: 'GOOGLE_OUTPUT_COST_MICROS_PER_MILLION',
        },
        anthropic: {
            enabled: value.ANTHROPIC_ENABLED,
            key: value.ANTHROPIC_API_KEY,
            keyPath: 'ANTHROPIC_API_KEY',
            model: value.ANTHROPIC_MODEL,
            modelPath: 'ANTHROPIC_MODEL',
            inputRate: value.ANTHROPIC_INPUT_COST_MICROS_PER_MILLION,
            inputRatePath: 'ANTHROPIC_INPUT_COST_MICROS_PER_MILLION',
            outputRate: value.ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION,
            outputRatePath: 'ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION',
        },
    } as const;
    let usable = 0;
    for (const provider of value.AI_PROVIDER_ORDER) {
        const spec = specs[provider];
        if (!spec.enabled)
            continue;
        usable += 1;
        for (const [path, configured] of [
            [spec.keyPath, spec.key],
            [spec.modelPath, spec.model],
            [spec.inputRatePath, spec.inputRate],
            [spec.outputRatePath, spec.outputRate],
        ] as const) {
            if (configured === undefined) {
                context.addIssue({
                    code: 'custom',
                    path: [path],
                    message: `${path} is required when ${provider} is enabled in AI_PROVIDER_ORDER`,
                });
            }
        }
        if (provider === 'glm' && !value.GLM_BASE_URL) {
            context.addIssue({
                code: 'custom',
                path: ['GLM_BASE_URL'],
                message: 'GLM_BASE_URL is required when glm is enabled in AI_PROVIDER_ORDER',
            });
        }
    }
    if (usable === 0) {
        context.addIssue({
            code: 'custom',
            path: ['AI_PROVIDER_ORDER'],
            message: 'PROVIDER_AI=ai-sdk requires at least one enabled ordered provider',
        });
    }
});
const parsed = envSchema.safeParse(process.env);
/* c8 ignore start -- startup misconfig guard: exits the process, not unit-testable */
if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}
/* c8 ignore stop */
export const env = {
    ...parsed.data,
    // Backward-compatible single-origin default for self-hosted deployments.
    APP_URL: parsed.data.APP_URL ?? parsed.data.CLIENT_URL,
};
export type Env = typeof env;
/** SEC-URL startup validation for the sole operator-configurable AI endpoint. */
export async function validateAiProviderBaseUrls(value: Pick<Env, 'NODE_ENV' | 'PROVIDER_AI' | 'AI_PROVIDER_ORDER' | 'GLM_ENABLED' | 'GLM_BASE_URL'>, resolver?: PublicUrlResolver): Promise<void> {
    if (value.PROVIDER_AI !== 'ai-sdk' ||
        !value.GLM_ENABLED ||
        !value.AI_PROVIDER_ORDER.includes('glm') ||
        !value.GLM_BASE_URL) {
        return;
    }
    await assertPublicUrlSafe(value.GLM_BASE_URL, {
        allowHttp: value.NODE_ENV === 'test',
        ...(resolver ? { resolver } : {}),
    });
}
