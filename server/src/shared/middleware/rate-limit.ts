import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { resolveLocalizedError, toSupportedLocale } from '../i18n/errors.js';
import { recordRateLimitHit } from './rate-limit-metrics.js';
import type { RateLimitRoute } from '../../db/schema/rate-limit-hits.js';
export function classifyRateLimitRoute(req: Request): RateLimitRoute {
    // `originalUrl` first: the /api/v1 limiter is mounted via `app.use('/api/v1', …)`,
    // where Express strips the mount point off `req.path`.
    const path = typeof req.originalUrl === 'string' && req.originalUrl.length > 0
        ? req.originalUrl
        : typeof req.path === 'string'
            ? req.path
            : '';
    if (path.startsWith('/api/v1'))
        return 'api';
    if (path.startsWith('/api/firecrawl/webhook'))
        return 'firecrawl_webhook';
    if (path.startsWith('/api/mcp'))
        return 'mcp';
    if (path.startsWith('/api/superadmin'))
        return 'superadmin_ops';
    if (path.startsWith('/api/report-exports/')) {
        return path.endsWith('/download')
            ? 'report_exports_download'
            : 'report_exports_manage';
    }
    if (path === '/api/report-exports' || path.startsWith('/api/report-exports?')) {
        return req.method === 'POST'
            ? 'report_exports_create'
            : 'report_exports_manage';
    }
    if (path.includes('/content-intelligence/inventory'))
        return 'inventory_start';
    if (path.includes('/content-intelligence/recommendations'))
        return 'content_recommendation_state';
    if (path.includes('/content-analyses/') && path.includes('/recommendations/') && req.method !== 'GET') {
        return 'content_recommendation_state';
    }
    if (path.includes('/content-intelligence'))
        return 'content_intelligence_create';
    // GET routes on the analysis surface — polled routinely by the UI. Only
    // GET traffic hits the poll bucket; state-changing routes stay on the
    // heavier create bucket via `createBatchRateLimiter('content_intelligence_create')`.
    if (path.includes('/content-analyses') && req.method === 'GET')
        return 'content_intelligence_poll';
    if (path.includes('/content-analyses'))
        return 'content_intelligence_create';
    if (path.includes('/competitor-content'))
        return 'competitor_manage';
    if (path.startsWith('/api/competitors/traffic-snapshots')) {
        return 'competitor_manage';
    }
    if (req.method !== 'GET' &&
        (path.startsWith('/api/backlinks/deep/') || path === '/api/backlinks/gap')) {
        return 'link_intel';
    }
    if (req.method !== 'GET' &&
        path.startsWith('/api/keyword-research/trends/explore')) {
        return 'auth';
    }
    if (req.method !== 'GET' && path.startsWith('/api/local-seo/reviews')) {
        return 'review_sync';
    }
    return 'auth';
}
/**
 * Both accepted 429 wire families are preserved exactly.
 *
 * - Coded family — `{ error: { code, message } }` — gains `messageKey`.
 * - Legacy family — `{ error: '<string>' }` — keeps the string and gains a
 *   sibling `errorInfo` object, so a caller parsing either shape keeps working
 *   until a versioned API can retire the string form.
 *
 * Standard `RateLimit-*` / `Retry-After` headers are written by
 * `express-rate-limit` before this handler runs and are untouched here.
 */
function sendRateLimitResponse(req: Request, res: Response, route: RateLimitRoute, messageKey = 'security.error.rateLimited', errorCode?: string): void {
    const locale = toSupportedLocale(req.language);
    const payload = resolveLocalizedError({
        status: 429,
        locale,
        messageKey,
        code: errorCode,
    });
    // Fire-and-forget metrics insert. Any failure is swallowed inside
    // recordRateLimitHit — the 429 must always land.
    const accountId = (req.user as {
        id?: string;
    } | undefined)?.id ?? null;
    void recordRateLimitHit({ route, ip: req.ip ?? null, accountId });
    res.setHeader('Content-Language', locale);
    res.status(429).json(errorCode
        ? {
            error: {
                code: payload.code,
                message: payload.message,
                messageKey: payload.messageKey,
            },
        }
        : {
            error: payload.message,
            errorInfo: {
                code: payload.code,
                messageKey: payload.messageKey,
                message: payload.message,
            },
        });
}
export function rateLimitHandler(req: Request, res: Response): void {
    sendRateLimitResponse(req, res, classifyRateLimitRoute(req));
}
const commonOptions: Partial<Options> = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
};
export interface RateLimitOverrides {
    windowMs?: number;
    max?: number;
}
export const BATCH_RATE_LIMIT_BUCKETS = {
    pages_read: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'pages.errors.rateLimited',
        errorCode: 'PAGES_RATE_LIMITED',
    },
    pages_refresh: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'pages.errors.rateLimited',
        errorCode: 'PAGES_RATE_LIMITED',
    },
    content_intelligence_create: { keying: 'account', window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS', max: 'RATE_LIMIT_CONTENT_CREATE_MAX' },
    content_intelligence_poll: { keying: 'account', window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS', max: 'RATE_LIMIT_CONTENT_POLL_MAX' },
    content_recommendation_state: { keying: 'account', window: 'RATE_LIMIT_RECOMMENDATION_WINDOW_MS', max: 'RATE_LIMIT_RECOMMENDATION_MAX' },
    inventory_start: { keying: 'account', window: 'RATE_LIMIT_INVENTORY_WINDOW_MS', max: 'RATE_LIMIT_INVENTORY_MAX' },
    competitor_manage: { keying: 'account', window: 'RATE_LIMIT_COMPETITOR_WINDOW_MS', max: 'RATE_LIMIT_COMPETITOR_MAX' },
    link_intel: { keying: 'account', window: 'RATE_LIMIT_LINK_INTEL_WINDOW_MS', max: 'RATE_LIMIT_LINK_INTEL_MAX' },
    link_intel_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_LINK_INTEL_POLL_MAX',
        metricsRoute: 'link_intel',
    },
    toxicity_create: {
        keying: 'account',
        window: 'RATE_LIMIT_LINK_INTEL_WINDOW_MS',
        max: 'RATE_LIMIT_LINK_INTEL_MAX',
        metricsRoute: 'link_intel',
        messageKey: 'backlinks.toxicity.errors.rateLimited',
    },
    'traffic-snapshots': {
        keying: 'account',
        window: 'RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS',
        max: 'RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX',
        metricsRoute: 'competitor_manage',
        messageKey: 'trafficInsights.errors.rateLimited',
    },
    review_sync: {
        keying: 'account',
        window: 'RATE_LIMIT_REVIEW_SYNC_WINDOW_MS',
        max: 'RATE_LIMIT_REVIEW_SYNC_MAX',
        messageKey: 'reviewIntelligence.errors.rateLimited',
    },
    keyword_trends: {
        keying: 'account',
        window: 'RATE_LIMIT_COMPETITOR_WINDOW_MS',
        max: 'RATE_LIMIT_COMPETITOR_MAX',
        metricsRoute: 'auth',
    },
    // Brand Radar: the paid create path and the read/poll path get
    // separate per-account buckets so a polling client cannot lock itself out
    // of its own stored scans.
    brand_radar_create: {
        keying: 'account',
        window: 'RATE_LIMIT_BRAND_RADAR_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_BRAND_RADAR_CREATE_MAX',
        messageKey: 'brandRadar.errors.rateLimited',
    },
    brand_radar_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_BRAND_RADAR_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_BRAND_RADAR_POLL_MAX',
        messageKey: 'brandRadar.errors.rateLimited',
    },
    app_seo_create: {
        keying: 'account',
        window: 'RATE_LIMIT_APP_SEO_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_APP_SEO_CREATE_MAX',
        metricsRoute: 'auth',
        messageKey: 'appSeo.errors.rateLimited',
    },
    app_seo_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_APP_SEO_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_APP_SEO_POLL_MAX',
        metricsRoute: 'auth',
        messageKey: 'appSeo.errors.rateLimited',
    },
    // Cannibalization reports. Report generation
    // is synchronous first-party compute, so it reuses the intelligence-workflow
    // create window rather than introducing a new operator env knob.
    cannibalization: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'cannibalization.errors.rateLimited',
    },
    cannibalization_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'cannibalization.errors.rateLimited',
    },
    // One paid stored-inventory/AI run per mutation. Reuse the
    // intelligence workflow's operator-tuned windows; no new env knob.
    internal_links: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'internalLinks.errors.rateLimited',
    },
    internal_links_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'internalLinks.errors.rateLimited',
    },
    // Community request 02 — one metered clustering run per mutation. Reuses the
    // intelligence workflow's operator-tuned windows; no new env knob.
    keyword_clusters: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'keywordClusters.errors.rateLimited',
    },
    keyword_clusters_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'keywordClusters.errors.rateLimited',
    },
    content_brief_create: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'contentBriefs.errors.rateLimited',
    },
    content_brief_rescore: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'contentBriefs.errors.rateLimited',
    },
    content_brief_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'contentBriefs.errors.rateLimited',
    },
    // Geogrid local rank tracking. A scan is one
    // metered unit that fans out ≤49 bounded vendor calls, so creation reuses
    // the tight intelligence-workflow create window and stored-scan reads reuse
    // the poll window — no new operator env knob.
    geogrid_create: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'geogrid.errors.rateLimited',
    },
    geogrid_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'geogrid.errors.rateLimited',
    },
    // Schema markup generator. Generation is
    // synchronous first-party compute plus one bounded AI pass, so both buckets
    // reuse the intelligence-workflow windows (60_000 / 10 create, 60_000 / 60
    // poll) rather than introducing new operator env knobs.
    schema_generator_create: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'schemaGenerator.errors.rateLimited',
    },
    schema_generator_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'schemaGenerator.errors.rateLimited',
    },
    // Alert rules + delivery log. Rule mutation
    // is first-party compute plus at most one DNS resolve, and the log read is a
    // plain stored scan, so both buckets reuse the intelligence-workflow windows
    // (60_000 / 10 manage, 60_000 / 60 poll) rather than adding operator knobs.
    alerts_manage: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'alerts.errors.rateLimited',
    },
    alerts_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'alerts.errors.rateLimited',
    },
    client_reports_manage: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        metricsRoute: 'content_intelligence_create',
        messageKey: 'clientReports.errors.rateLimited',
    },
    client_reports_poll: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        metricsRoute: 'content_intelligence_poll',
        messageKey: 'clientReports.errors.rateLimited',
    },
    client_reports_portal: {
        keying: 'ip',
        window: 'RATE_LIMIT_REPORT_EXPORT_PUBLIC_WINDOW_MS',
        max: 'RATE_LIMIT_REPORT_EXPORT_PUBLIC_IP_MAX',
        metricsRoute: 'auth',
        messageKey: 'clientReports.errors.rateLimited',
    },
    report_exports_create: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_CREATE_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_CREATE_MAX',
        messageKey: 'reportExports.errors.rateLimited',
    },
    report_exports_manage: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        messageKey: 'reportExports.errors.rateLimited',
    },
    report_exports_download: {
        keying: 'account',
        window: 'RATE_LIMIT_CONTENT_POLL_WINDOW_MS',
        max: 'RATE_LIMIT_CONTENT_POLL_MAX',
        messageKey: 'reportExports.errors.rateLimited',
    },
    firecrawl_webhook: { keying: 'ip', window: 'RATE_LIMIT_FIRECRAWL_WEBHOOK_WINDOW_MS', max: 'RATE_LIMIT_FIRECRAWL_WEBHOOK_MAX' },
    mcp: { keying: 'token', window: 'RATE_LIMIT_MCP_WINDOW_MS', max: 'RATE_LIMIT_MCP_MAX' },
    // AI Assistant chat — one per-account bucket over
    // every /api/chat route. Deliberately tight: each message POST opens an SSE
    // stream and reserves an `ai_chat_messages` unit.
    chat: { keying: 'account', window: 'RATE_LIMIT_CHAT_WINDOW_MS', max: 'RATE_LIMIT_CHAT_MAX' },
    superadmin_ops: { keying: 'account', window: 'RATE_LIMIT_SUPERADMIN_WINDOW_MS', max: 'RATE_LIMIT_SUPERADMIN_MAX' },
} as const;
export type BatchRateLimitBucket = keyof typeof BATCH_RATE_LIMIT_BUCKETS;
function accountRateLimitKey(req: Request): string {
    return (req.workspaceAccountId ??
        (req.user as {
            id?: string;
        } | undefined)?.id ??
        req.ip ??
        'unknown');
}
/** Named intelligence-batch limiter. Route owners attach this in addition to capacity checks. */
export function createBatchRateLimiter(bucket: BatchRateLimitBucket, overrides: RateLimitOverrides = {}): RequestHandler {
    const config = BATCH_RATE_LIMIT_BUCKETS[bucket];
    const keyGenerator = config.keying === 'token' ? apiRateLimitKey : config.keying === 'account' ? accountRateLimitKey : undefined;
    const metricsRoute: RateLimitRoute = 'metricsRoute' in config ? config.metricsRoute : (bucket as RateLimitRoute);
    const messageKey = 'messageKey' in config ? config.messageKey : 'security.error.rateLimited';
    const errorCode = 'errorCode' in config ? config.errorCode : undefined;
    return rateLimit({
        ...commonOptions,
        handler: (req, res) => sendRateLimitResponse(req, res, metricsRoute, messageKey, errorCode),
        windowMs: overrides.windowMs ?? env[config.window],
        max: overrides.max ?? env[config.max],
        ...(keyGenerator ? { keyGenerator } : {}),
    });
}
/**
 * Auth-route limiter. Each call returns a fresh instance with its own in-memory
 * store — required for test isolation (`createApp()` per test) and idempotent
 * hot-reload restarts. The security-headers integration test at
 * `shared/middleware/security.test.ts` covers the 429 path with a dedicated
 * bucket override.
 */
export function createAuthRateLimiter(overrides: RateLimitOverrides = {}): RequestHandler {
    return rateLimit({
        ...commonOptions,
        windowMs: overrides.windowMs ?? env.RATE_LIMIT_AUTH_WINDOW_MS,
        max: overrides.max ?? env.RATE_LIMIT_AUTH_MAX,
        // Only throttle credential mutations. Every brute-force target under
        // /api/auth/* is a POST (sign-in, sign-up, sign-in/social, forget-password,
        // reset-password); read-only GETs — chiefly `get-session`, which fires on
        // every page load / SSR hydration / guard remount — must not share the
        // credential bucket or a normal browsing session exhausts it and 429s login.
        skip: (req) => req.method === 'GET',
    });
}
/**
 * Bounded set of bearer-token sha256 digests that have successfully passed
 * `createApiKeyAuth` at least once in this process. Only members of this set
 * get their own per-token rate-limit bucket; every other bearer value keys
 * the limiter by IP. Prevents a flood of random bearers from allocating
 * unbounded MemoryStore buckets in `express-rate-limit`.
 *
 * The cap makes the set itself bounded (attacker-controlled data cannot grow
 * it beyond `AUTHENTICATED_TOKEN_CACHE_MAX`); eviction is FIFO on the Set
 * insertion order.
 */
const authenticatedTokenHashes = new Set<string>();
const AUTHENTICATED_TOKEN_CACHE_MAX = 10000;
export function markTokenAuthenticated(tokenHash: string): void {
    if (authenticatedTokenHashes.size >= AUTHENTICATED_TOKEN_CACHE_MAX) {
        const oldest = authenticatedTokenHashes.values().next().value;
        /* c8 ignore next -- Set.values().next().value on a non-empty Set is always defined; the !== undefined guard satisfies TypeScript's noUncheckedIndexedAccess. */
        if (oldest !== undefined)
            authenticatedTokenHashes.delete(oldest);
    }
    authenticatedTokenHashes.add(tokenHash);
}
export function resetAuthenticatedTokens(): void {
    authenticatedTokenHashes.clear();
}
/**
 * Bucket key for the per-token public-API limiter. An unproven token (one
 * that has never yet resolved to a real API key) keys by IP — this is what
 * stops a flood of random `Bearer` values from allocating unbounded buckets.
 * Once `createApiKeyAuth` has verified a token at least once, subsequent
 * requests carrying that same token bucket per-token.
 */
export function apiRateLimitKey(req: Request): string {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const token = match?.[1];
    if (token) {
        const hash = createHash('sha256').update(token).digest('hex');
        if (authenticatedTokenHashes.has(hash))
            return hash;
    }
    return req.ip ?? 'unknown';
}
/**
 * Public-API (/api/v1) per-IP limiter. Runs BEFORE the per-token limiter
 * so a flood of random bearers from one attacker IP is throttled without
 * allocating a bucket per token. Shares the same window/max defaults as
 * the per-token limiter but its own bucket store.
 */
export function createApiIpRateLimiter(overrides: RateLimitOverrides = {}): RequestHandler {
    return rateLimit({
        ...commonOptions,
        windowMs: overrides.windowMs ?? env.RATE_LIMIT_API_WINDOW_MS,
        max: overrides.max ?? env.RATE_LIMIT_API_MAX,
    });
}
/**
 * Public-API (/api/v1) per-token limiter. Keyed per bearer token
 * (`apiRateLimitKey`) but ONLY for tokens that have already authenticated —
 * unauthenticated tokens fall through to the IP bucket. Runs BEFORE the
 * bearer auth middleware so a flood of bad keys cannot burn hash lookups
 * against Postgres.
 */
export function createApiRateLimiter(overrides: RateLimitOverrides = {}): RequestHandler {
    return rateLimit({
        ...commonOptions,
        windowMs: overrides.windowMs ?? env.RATE_LIMIT_API_WINDOW_MS,
        max: overrides.max ?? env.RATE_LIMIT_API_MAX,
        keyGenerator: apiRateLimitKey,
    });
}
/** First public-share abuse boundary: every request consumes an IP slot before lookup. */
export function createReportShareIpRateLimiter(overrides: RateLimitOverrides = {}): RequestHandler {
    return rateLimit({
        ...commonOptions,
        handler: (req, res) => sendRateLimitResponse(req, res, 'report_exports_manage', 'reportExports.errors.rateLimited'),
        windowMs: overrides.windowMs ?? env.RATE_LIMIT_REPORT_EXPORT_PUBLIC_WINDOW_MS,
        max: overrides.max ?? env.RATE_LIMIT_REPORT_EXPORT_PUBLIC_IP_MAX,
    });
}
/** Second boundary, installed only after a share digest has been proven live. */
export function createReportShareTokenRateLimiter(overrides: RateLimitOverrides = {}): RequestHandler {
    return rateLimit({
        ...commonOptions,
        handler: (req, res) => sendRateLimitResponse(req, res, 'report_exports_manage', 'reportExports.errors.rateLimited'),
        windowMs: overrides.windowMs ?? env.RATE_LIMIT_REPORT_EXPORT_PUBLIC_WINDOW_MS,
        max: overrides.max ?? env.RATE_LIMIT_REPORT_EXPORT_PUBLIC_TOKEN_MAX,
        keyGenerator: (req) => req.reportShareTokenHash ?? req.ip ?? 'unknown',
    });
}
/**
 * Public contact-form endpoint limiter. Per-IP; a spam relay looping the
 * form gets 429 well before any Resend spend.
 */
export function createContactRateLimiter(overrides: RateLimitOverrides = {}): RequestHandler {
    return rateLimit({
        ...commonOptions,
        windowMs: overrides.windowMs ?? env.RATE_LIMIT_CONTACT_WINDOW_MS,
        max: overrides.max ?? env.RATE_LIMIT_CONTACT_MAX,
    });
}
