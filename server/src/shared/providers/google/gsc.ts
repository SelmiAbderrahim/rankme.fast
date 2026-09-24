/**
 * Google Search Console adapter.
 *
 * Implements the vendor-neutral `GscProvider` interface over
 * two Google APIs:
 *
 *   - **Sites list** — `GET https://www.googleapis.com/webmasters/v3/sites`
 *     → `siteEntry[{ siteUrl, permissionLevel }]`.
 *   - **URL Inspection** — `POST
 *     https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`
 *     body `{ inspectionUrl, siteUrl }` → `inspectionResult` with
 *     `indexStatusResult` + `richResultsResult`. `mobileUsabilityResult`
 *     is deprecated and ignored.
 *   - **Search Analytics** — `POST
 *     https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
 *     (URL-encoded siteUrl) body `{ startDate, endDate, dimensions, type,
 *     rowLimit }` → `rows[{ keys, clicks, impressions, ctr, position }]`.
 *     Data is sampled by Google and lags ~3 days — callers query with
 *     `endDate = today - 3`.
 *   - **Sitemaps list** — `GET
 *     https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps`
 *     → `sitemap[{ path, type, lastSubmitted, lastDownloaded, isPending,
 *     isSitemapsIndex, errors, warnings, processed }]`.
 *
 * Plus token lifecycle:
 *
 *   - **Refresh** — `POST https://oauth2.googleapis.com/token` form-encoded
 *     `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`.
 *   - **Revoke** — `POST https://oauth2.googleapis.com/revoke` form-encoded
 *     `token=<token>` (accepts an access OR refresh token).
 *
 * Error taxonomy:
 *   - HTTP 401 or `error=invalid_grant` → `GscReconnectRequiredError`
 *     (module marks connection `needs_reconnect`).
 *   - HTTP 403 → `VendorAuthError` (permission denied — scope not effective,
 *     API disabled, or no accessible resource).
 *   - HTTP 429 → `VendorQuotaError`.
 *   - HTTP 5xx / network drop → `VendorUnavailableError`.
 *   - Timeout → `VendorTimeoutError`.
 *   - Non-JSON / schema mismatch → `VendorMalformedError`.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { GscReconnectRequiredError, VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../errors.js';
import type { GscConnection, GscProperty, GscProvider, GscSearchAnalyticsInput, GscSearchAnalyticsResult, GscSitemapEntry, GscUrlInspection, GscVerdict, } from '../types.js';
// ---------------------------------------------------------------------------
// Defaults + endpoints (verified July 2026).
// ---------------------------------------------------------------------------
export const DEFAULT_GSC_TIMEOUT_MS = 15000;
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// Both take the property URL as a path segment — `{siteUrl}` is replaced with
// the URL-encoded property (e.g. `sc-domain%3Aexample.com`).
export const SEARCH_ANALYTICS_URL_TEMPLATE = 'https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query';
const SITEMAPS_URL_TEMPLATE = 'https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps';
export function expandSiteUrlTemplate(template: string, siteUrl: string): string {
    return template.replace('{siteUrl}', encodeURIComponent(siteUrl));
}
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const verdictSchema = z.enum(['PASS', 'PARTIAL', 'FAIL', 'NEUTRAL']);
const sitesListSchema = z
    .object({
    siteEntry: z
        .array(z
        .object({
        siteUrl: z.string(),
        permissionLevel: z.string(),
    })
        .passthrough())
        .optional(),
})
    .passthrough();
const richItemSchema = z
    .object({
    richResultType: z.string().optional(),
    items: z
        .array(z
        .object({ issues: z.array(z.unknown()).optional() })
        .passthrough())
        .optional(),
})
    .passthrough();
const inspectionSchema = z
    .object({
    inspectionResult: z
        .object({
        indexStatusResult: z
            .object({
            verdict: verdictSchema,
            coverageState: z.string().optional(),
            robotsTxtState: z.string().optional(),
            pageFetchState: z.string().optional(),
            googleCanonical: z.string().optional(),
            lastCrawlTime: z.string().optional(),
        })
            .passthrough(),
        richResultsResult: z
            .object({
            verdict: verdictSchema.optional(),
            detectedItems: z.array(richItemSchema).optional(),
        })
            .passthrough()
            .optional(),
    })
        .passthrough(),
})
    .passthrough();
const searchAnalyticsSchema = z
    .object({
    rows: z
        .array(z
        .object({
        keys: z.array(z.string()).optional(),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number(),
        position: z.number(),
    })
        .passthrough())
        .optional(),
})
    .passthrough();
// NOTE: Google returns the list under the SINGULAR key `sitemap`, not
// `sitemaps` — that is the documented API shape (webmasters/v3), not a typo.
// Do not "fix" it.
const sitemapsSchema = z
    .object({
    sitemap: z
        .array(z
        .object({
        path: z.string(),
        type: z.string().optional(),
        lastSubmitted: z.string().optional(),
        lastDownloaded: z.string().optional(),
        isPending: z.boolean().optional(),
        isSitemapsIndex: z.boolean().optional(),
        errors: z.union([z.number(), z.string()]).optional(),
        warnings: z.union([z.number(), z.string()]).optional(),
        processed: z.union([z.number(), z.string()]).optional(),
    })
        .passthrough())
        .optional(),
})
    .passthrough();
const tokenResponseSchema = z
    .object({
    access_token: z.string(),
    expires_in: z.number().int().positive(),
})
    .passthrough();
const oauthErrorSchema = z
    .object({ error: z.string().optional(), error_description: z.string().optional() })
    .passthrough();
// ---------------------------------------------------------------------------
// Config + provider type
// ---------------------------------------------------------------------------
export interface GoogleGscProviderConfig {
    clientId: string;
    clientSecret: string;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    sitesUrl?: string;
    inspectUrl?: string;
    tokenUrl?: string;
    revokeUrl?: string;
    /** Template containing `{siteUrl}` — replaced with the encoded property. */
    searchAnalyticsUrlTemplate?: string;
    sitemapsUrlTemplate?: string;
}
export interface GoogleGscProvider extends GscProvider {
    refreshAccessToken(refreshToken: string): Promise<{
        accessToken: string;
        expiresIn: number;
    }>;
    revokeToken(token: string): Promise<void>;
}
// ---------------------------------------------------------------------------
// Fetch helper — same error taxonomy as pagespeed.ts. Exported for the GA4
// adapter (`google/ga4.ts`), which shares the SAME OAuth client + error
// taxonomy (401 → reconnect, 429 → quota, 5xx → unavailable, timeout,
// malformed) against the Analytics Data/Admin APIs.
// ---------------------------------------------------------------------------
export interface GoogleFetchOpts {
    operation: string;
    method: 'GET' | 'POST';
    url: string;
    accessToken?: string;
    jsonBody?: unknown;
    formBody?: URLSearchParams;
    timeoutMs: number;
    fetchImpl: typeof fetch;
    logger?: Logger;
}
export async function fetchGoogleGsc(opts: GoogleFetchOpts): Promise<unknown> {
    const ctx = { provider: 'google', operation: opts.operation };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.accessToken !== undefined) {
        headers.authorization = `Bearer ${opts.accessToken}`;
    }
    let body: string | undefined;
    if (opts.formBody !== undefined) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = opts.formBody.toString();
    }
    else if (opts.jsonBody !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.jsonBody);
    }
    let res: Response;
    try {
        res = await opts.fetchImpl(opts.url, {
            method: opts.method,
            headers,
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
        });
    }
    catch (cause) {
        if (controller.signal.aborted) {
            throw new VendorTimeoutError(`no response within ${opts.timeoutMs}ms`, {
                ...ctx,
                cause,
            });
        }
        throw new VendorUnavailableError('network failure before a response', {
            ...ctx,
            cause,
        });
    }
    finally {
        clearTimeout(timer);
    }
    const rawBody = await res.text();
    // Parse body opportunistically — errors need it, malformed body triggers it.
    let payload: unknown = null;
    if (rawBody.length > 0) {
        try {
            payload = JSON.parse(rawBody);
        }
        catch {
            payload = null;
        }
    }
    if (res.status === 401) {
        // Access-token rejection during a Search Console call = the refresh
        // token is (or will be treated as) dead → reconnect required.
        throw new GscReconnectRequiredError('access token rejected (HTTP 401)', ctx);
    }
    if (res.status === 429) {
        throw new VendorQuotaError('vendor rate limit hit (HTTP 429)', ctx);
    }
    if (res.status === 403) {
        // Permission denied — the granted scope does not cover this API (e.g. GA4
        // Admin `accountSummaries` without an effective `analytics.readonly`
        // grant), the vendor API is disabled for the project, or the account has
        // no accessible resource. An auth/permission failure, NOT contract drift.
        throw new VendorAuthError('permission denied (HTTP 403)', ctx);
    }
    if (res.status >= 500) {
        throw new VendorUnavailableError(`vendor unavailable (HTTP ${res.status})`, ctx);
    }
    if (!res.ok) {
        // Google's RFC-7009-style revoke endpoint uses HTTP 400 invalid_token for
        // a token that is expired, malformed, or already revoked. All three are
        // terminal success for an idempotent disconnect/account purge.
        const revokeError = oauthErrorSchema.safeParse(payload);
        if (opts.operation === 'gsc-token-revoke' &&
            res.status === 400 &&
            revokeError.success &&
            revokeError.data.error === 'invalid_token') {
            opts.logger?.info({ provider: 'google', operation: opts.operation, status: res.status }, 'gsc token already invalid');
            return payload;
        }
        // 4xx — check for invalid_grant (dead refresh token, token endpoint only).
        const err = oauthErrorSchema.safeParse(payload);
        if (err.success && err.data.error === 'invalid_grant') {
            throw new GscReconnectRequiredError('refresh token is invalid_grant', ctx);
        }
        throw new VendorMalformedError(`unexpected HTTP ${res.status}`, ctx);
    }
    opts.logger?.info({ provider: 'google', operation: opts.operation, status: res.status }, 'gsc request ok');
    // 2xx with empty body is fine for revoke; callers decide.
    return payload;
}
// ---------------------------------------------------------------------------
// Interpretation helpers
// ---------------------------------------------------------------------------
export function normalizeInspection(payload: unknown, ctx: {
    provider: string;
    operation: string;
}): GscUrlInspection {
    const parsed = inspectionSchema.safeParse(payload);
    if (!parsed.success) {
        throw new VendorMalformedError(`URL inspection payload failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
    }
    const idx = parsed.data.inspectionResult.indexStatusResult;
    const rr = parsed.data.inspectionResult.richResultsResult;
    const items = (rr?.detectedItems ?? []).map((entry) => {
        // The API can report BOTH `items[i].issues[]` on each entry AND a
        // simpler top-level shape. Sum issue counts across `entry.items` when
        // present; a missing/empty `items` array is 0.
        const issues = (entry.items ?? []).reduce((sum, it) => sum + (it.issues?.length ?? 0), 0);
        return { type: entry.richResultType ?? 'unknown', issues };
    });
    const lastCrawl = idx.lastCrawlTime;
    let lastCrawlTime: Date | null = null;
    if (lastCrawl !== undefined) {
        const parsedDate = new Date(lastCrawl);
        if (!Number.isNaN(parsedDate.getTime()))
            lastCrawlTime = parsedDate;
    }
    const verdict: GscVerdict = idx.verdict;
    return {
        indexVerdict: verdict,
        coverageState: idx.coverageState ?? '',
        robotsTxtState: idx.robotsTxtState ?? '',
        pageFetchState: idx.pageFetchState ?? null,
        googleCanonical: idx.googleCanonical ?? null,
        lastCrawlTime,
        richResults: {
            verdict: rr?.verdict ?? 'NEUTRAL',
            items,
        },
    };
}
export function normalizeSearchAnalytics(payload: unknown, ctx: {
    provider: string;
    operation: string;
}, echo: {
    startDate: string;
    endDate: string;
    dimensions: string[];
}): GscSearchAnalyticsResult {
    const parsed = searchAnalyticsSchema.safeParse(payload);
    if (!parsed.success) {
        throw new VendorMalformedError(`search analytics payload failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
    }
    return {
        rows: (parsed.data.rows ?? []).map((row) => ({
            keys: row.keys ?? [],
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })),
        // Google always samples Search Analytics (~50k row cap) — surface it so
        // the UI copy stays honest.
        sampled: true,
        startDate: echo.startDate,
        endDate: echo.endDate,
        dimensions: echo.dimensions,
    };
}
function parseDateOrNull(value: string | undefined): Date | null {
    if (value === undefined)
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
// webmasters/v3 serializes int64 counts as JSON strings ("errors": "2");
// tolerate both and coerce to number.
function toCount(value: number | string | undefined): number {
    if (value === undefined)
        return 0;
    const n = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(n) ? n : 0;
}
export function normalizeSitemaps(payload: unknown, ctx: {
    provider: string;
    operation: string;
}): GscSitemapEntry[] {
    const parsed = sitemapsSchema.safeParse(payload);
    if (!parsed.success) {
        throw new VendorMalformedError(`sitemaps payload failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
    }
    return (parsed.data.sitemap ?? []).map((entry) => ({
        path: entry.path,
        type: entry.type ?? 'sitemap',
        lastSubmitted: parseDateOrNull(entry.lastSubmitted),
        lastDownloaded: parseDateOrNull(entry.lastDownloaded),
        isPending: entry.isPending ?? false,
        isSitemapsIndex: entry.isSitemapsIndex ?? false,
        errors: toCount(entry.errors),
        warnings: toCount(entry.warnings),
        processed: toCount(entry.processed),
    }));
}
// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------
export function createGoogleGscProvider(cfg: GoogleGscProviderConfig): GoogleGscProvider {
    if (!cfg.clientId || !cfg.clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for the GSC provider');
    }
    const fetchImpl = cfg.fetchImpl ?? fetch;
    const timeoutMs = cfg.timeoutMs ?? DEFAULT_GSC_TIMEOUT_MS;
    const sitesUrl = cfg.sitesUrl ?? SITES_URL;
    const inspectUrl = cfg.inspectUrl ?? INSPECT_URL;
    const tokenUrl = cfg.tokenUrl ?? TOKEN_URL;
    const revokeUrl = cfg.revokeUrl ?? REVOKE_URL;
    const searchAnalyticsUrlTemplate = cfg.searchAnalyticsUrlTemplate ?? SEARCH_ANALYTICS_URL_TEMPLATE;
    const sitemapsUrlTemplate = cfg.sitemapsUrlTemplate ?? SITEMAPS_URL_TEMPLATE;
    const loggerOpt = cfg.logger ? { logger: cfg.logger } : {};
    return {
        async listProperties(connection: GscConnection): Promise<GscProperty[]> {
            const payload = await fetchGoogleGsc({
                operation: 'gsc-sites-list',
                method: 'GET',
                url: sitesUrl,
                accessToken: connection.accessToken,
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            const parsed = sitesListSchema.safeParse(payload);
            if (!parsed.success) {
                throw new VendorMalformedError(`sites list payload failed schema validation: ${parsed.error.message}`, { provider: 'google', operation: 'gsc-sites-list', cause: parsed.error });
            }
            return (parsed.data.siteEntry ?? []).map((e) => ({
                siteUrl: e.siteUrl,
                permissionLevel: e.permissionLevel,
            }));
        },
        async inspectUrl(connection: GscConnection, input: {
            inspectionUrl: string;
            siteUrl: string;
        }): Promise<GscUrlInspection> {
            const payload = await fetchGoogleGsc({
                operation: 'gsc-url-inspect',
                method: 'POST',
                url: inspectUrl,
                accessToken: connection.accessToken,
                jsonBody: {
                    inspectionUrl: input.inspectionUrl,
                    siteUrl: input.siteUrl,
                },
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            return normalizeInspection(payload, {
                provider: 'google',
                operation: 'gsc-url-inspect',
            });
        },
        async querySearchAnalytics(connection: GscConnection, input: GscSearchAnalyticsInput): Promise<GscSearchAnalyticsResult> {
            const payload = await fetchGoogleGsc({
                operation: 'gsc-search-analytics',
                method: 'POST',
                url: expandSiteUrlTemplate(searchAnalyticsUrlTemplate, input.siteUrl),
                accessToken: connection.accessToken,
                jsonBody: {
                    startDate: input.startDate,
                    endDate: input.endDate,
                    dimensions: input.dimensions,
                    type: input.type ?? 'web',
                    rowLimit: input.rowLimit ?? 1000,
                },
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            return normalizeSearchAnalytics(payload, { provider: 'google', operation: 'gsc-search-analytics' }, {
                startDate: input.startDate,
                endDate: input.endDate,
                dimensions: input.dimensions,
            });
        },
        async listSitemaps(connection: GscConnection, input: {
            siteUrl: string;
        }): Promise<GscSitemapEntry[]> {
            const payload = await fetchGoogleGsc({
                operation: 'gsc-sitemaps-list',
                method: 'GET',
                url: expandSiteUrlTemplate(sitemapsUrlTemplate, input.siteUrl),
                accessToken: connection.accessToken,
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            return normalizeSitemaps(payload, {
                provider: 'google',
                operation: 'gsc-sitemaps-list',
            });
        },
        async refreshAccessToken(refreshToken: string) {
            const form = new URLSearchParams();
            form.set('client_id', cfg.clientId);
            form.set('client_secret', cfg.clientSecret);
            form.set('refresh_token', refreshToken);
            form.set('grant_type', 'refresh_token');
            const payload = await fetchGoogleGsc({
                operation: 'gsc-token-refresh',
                method: 'POST',
                url: tokenUrl,
                formBody: form,
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            const parsed = tokenResponseSchema.safeParse(payload);
            if (!parsed.success) {
                throw new VendorMalformedError(`token refresh payload failed schema validation: ${parsed.error.message}`, { provider: 'google', operation: 'gsc-token-refresh', cause: parsed.error });
            }
            return {
                accessToken: parsed.data.access_token,
                expiresIn: parsed.data.expires_in,
            };
        },
        async revokeToken(token: string): Promise<void> {
            const form = new URLSearchParams();
            form.set('token', token);
            await fetchGoogleGsc({
                operation: 'gsc-token-revoke',
                method: 'POST',
                url: revokeUrl,
                formBody: form,
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
        },
    };
}
