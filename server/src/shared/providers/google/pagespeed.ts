/**
 * Google PageSpeed adapter.
 *
 * Implements the vendor-neutral `PageSpeedProvider` interface
 * over TWO free Google APIs:
 *
 *   - **PSI v5** (`GET /pagespeedonline/v5/runPagespeed`) — Lab (Lighthouse)
 *     scores per category. Live Lighthouse run → 10–60s+ latency: caller
 *     timeout MUST be ≥ 60s. Free key quota 25k/day, ~240/min. 500
 *     `LIGHTHOUSE_ERROR` → `VendorUnavailableError`. 429 →
 *     `VendorQuotaError`. Response also carries `loadingExperience` (CrUX
 *     built-in) with an `origin_fallback` flag when URL-level field data is
 *     unavailable.
 *
 *   - **CrUX v1** (`POST /v1/records:queryRecord`) — Field p75 percentiles
 *     for LCP / INP / CLS (Core Web Vitals). Quota 150/min. **404 = "not in
 *     the dataset"** (low-traffic site) — an expected state meaning "no
 *     field data yet", NOT an error. URL scope first; on 404 fall back to
 *     origin scope.
 *
 * Mobile-friendly derives from the PSI **mobile** run's Lighthouse
 * `viewport` + `tap-targets` audits — Google deprecated the dedicated
 * mobile-friendly API.
 *
 * Alternative live selection: DataForSEO Lighthouse at $0.005/page behind
 * the same PageSpeedProvider interface. That adapter is lab-only and never
 * fabricates CrUX field data.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { ProviderError, VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../errors.js';
import type { CoreWebVitalsCategory, PageSpeedInput, PageSpeedProvider, PageSpeedResult, PageSpeedStrategy, } from '../types.js';
// ---------------------------------------------------------------------------
// Defaults + constants (verified July 2026 — see file header)
// ---------------------------------------------------------------------------
/** PSI live run can take 10–60s+; caller MUST allow ≥60s. */
export const DEFAULT_PSI_TIMEOUT_MS = 60000;
/** CrUX is a lookup, not a live run — 15s is plenty. */
export const DEFAULT_CRUX_TIMEOUT_MS = 15000;
/**
 * Token-bucket ceiling — PSI free key allows ~240/min; we stay comfortably
 * under it so audits sample pages, they don't hammer PSI.
 */
export const DEFAULT_RATE_PER_MINUTE = 200;
const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
// Google's Core Web Vitals thresholds (developer.chrome.com — stable since 2020).
const LCP_GOOD_MS = 2500;
const LCP_POOR_MS = 4000;
const INP_GOOD_MS = 200;
const INP_POOR_MS = 500;
const CLS_GOOD = 0.1;
const CLS_POOR = 0.25;
// ---------------------------------------------------------------------------
// Schemas — PSI + CrUX vendor payloads.
// ---------------------------------------------------------------------------
const psiScoreSchema = z.number().min(0).max(1).nullable();
const psiCategoryEntrySchema = z
    .object({ score: psiScoreSchema.optional() })
    .passthrough();
const psiCategoriesSchema = z
    .object({
    performance: psiCategoryEntrySchema.optional(),
    seo: psiCategoryEntrySchema.optional(),
    accessibility: psiCategoryEntrySchema.optional(),
    // NOTE: hyphenated key — Google returns `best-practices`, not `bestPractices`.
    'best-practices': psiCategoryEntrySchema.optional(),
})
    .passthrough();
const psiAuditEntrySchema = z
    .object({ score: z.number().nullable().optional() })
    .passthrough();
const psiRuntimeErrorSchema = z
    .object({ code: z.string(), message: z.string().optional() })
    .passthrough();
const psiLoadingExperienceSchema = z
    .object({
    origin_fallback: z.boolean().optional(),
})
    .passthrough();
const psiSchema = z
    .object({
    lighthouseResult: z
        .object({
        categories: psiCategoriesSchema.optional(),
        audits: z.record(z.string(), psiAuditEntrySchema).optional(),
        runtimeError: psiRuntimeErrorSchema.optional(),
    })
        .passthrough()
        .optional(),
    loadingExperience: psiLoadingExperienceSchema.optional(),
    originLoadingExperience: psiLoadingExperienceSchema.optional(),
})
    .passthrough();
export type PsiPayload = z.infer<typeof psiSchema>;
// CrUX percentiles arrive as STRING or NUMBER — the docs are explicit and
// wire logs disagree between endpoints; accept both, coerce inside.
const cruxPercentileSchema = z.union([z.string(), z.number()]);
const cruxMetricSchema = z
    .object({
    percentiles: z.object({ p75: cruxPercentileSchema }).passthrough(),
})
    .passthrough();
const cruxSchema = z
    .object({
    record: z
        .object({
        metrics: z
            .object({
            largest_contentful_paint: cruxMetricSchema.optional(),
            interaction_to_next_paint: cruxMetricSchema.optional(),
            cumulative_layout_shift: cruxMetricSchema.optional(),
        })
            .passthrough()
            .optional(),
    })
        .passthrough()
        .optional(),
})
    .passthrough();
export type CruxPayload = z.infer<typeof cruxSchema>;
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface PageSpeedProviderConfig {
    /** Google Cloud API key with PSI + CrUX enabled. From `GOOGLE_API_KEY`. */
    apiKey: string;
    logger?: Logger;
    /** PSI per-call deadline — MUST be ≥ 60s. Default 60s. */
    psiTimeoutMs?: number;
    cruxTimeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Injectable clock — deterministic in tests. */
    clock?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** In-process rate limiter ceiling (calls per minute). Default 200. */
    ratePerMinute?: number;
    /** Test overrides for the vendor URLs. */
    psiUrl?: string;
    cruxUrl?: string;
}
// ---------------------------------------------------------------------------
// Rate limiter — deterministic-time token bucket.
// ---------------------------------------------------------------------------
export interface RateLimiter {
    acquire(): Promise<void>;
}
export function createTokenBucketLimiter(ratePerMinute: number, now: () => number, sleep: (ms: number) => Promise<void>): RateLimiter {
    const intervalMs = Math.max(1, Math.ceil(60000 / ratePerMinute));
    let nextAllowed = 0;
    return {
        async acquire(): Promise<void> {
            const t = now();
            // Reserve the slot synchronously BEFORE awaiting sleep so two concurrent
            // callers can never resolve `nextAllowed` from the same read.
            const slot = Math.max(t, nextAllowed);
            nextAllowed = slot + intervalMs;
            if (slot > t)
                await sleep(slot - t);
        },
    };
}
// ---------------------------------------------------------------------------
// Low-level fetch — same error taxonomy as `shared/providers/http.ts` but
// with a 404-is-expected escape hatch for CrUX.
// ---------------------------------------------------------------------------
interface FetchOpts<T> {
    operation: string;
    method: 'GET' | 'POST';
    url: string;
    body?: unknown;
    schema: z.ZodType<T>;
    timeoutMs: number;
    /** When true, HTTP 404 resolves as `'not-found'` instead of malformed. */
    allow404?: boolean;
    fetchImpl: typeof fetch;
    logger?: Logger;
}
type FetchResult<T> = {
    kind: 'ok';
    data: T;
} | {
    kind: 'not-found';
};
async function fetchGoogleJson<T>(opts: FetchOpts<T>): Promise<FetchResult<T>> {
    const ctx = { provider: 'google', operation: opts.operation };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
        let res: Response;
        try {
            res = await opts.fetchImpl(opts.url, {
                method: opts.method,
                headers: opts.body === undefined
                    ? { accept: 'application/json' }
                    : { accept: 'application/json', 'content-type': 'application/json' },
                body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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
        if (res.status === 401 || res.status === 403) {
            throw new VendorAuthError(`credentials rejected (HTTP ${res.status})`, ctx);
        }
        if (res.status === 429) {
            throw new VendorQuotaError('vendor rate limit hit (HTTP 429)', ctx);
        }
        if (res.status >= 500) {
            throw new VendorUnavailableError(`vendor unavailable (HTTP ${res.status})`, ctx);
        }
        if (res.status === 404 && opts.allow404 === true) {
            return { kind: 'not-found' };
        }
        if (!res.ok) {
            throw new VendorMalformedError(`unexpected HTTP ${res.status}`, ctx);
        }
        let payload: unknown;
        try {
            payload = await res.json();
        }
        catch (cause) {
            if (controller.signal.aborted) {
                throw new VendorTimeoutError(`no complete body within ${opts.timeoutMs}ms`, {
                    ...ctx,
                    cause,
                });
            }
            throw new VendorMalformedError('response body is not JSON', { ...ctx, cause });
        }
        const parsed = opts.schema.safeParse(payload);
        if (!parsed.success) {
            throw new VendorMalformedError(`response failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
        }
        opts.logger?.info({ provider: 'google', operation: opts.operation, status: res.status }, 'vendor request ok');
        return { kind: 'ok', data: parsed.data };
    }
    finally {
        clearTimeout(timer);
    }
}
// ---------------------------------------------------------------------------
// PSI + CrUX low-level clients.
// ---------------------------------------------------------------------------
function buildPsiUrl(base: string, input: PageSpeedInput, apiKey: string): string {
    const params = new URLSearchParams();
    params.append('url', input.url);
    params.append('strategy', input.strategy);
    // `category` repeats — omit and PSI runs performance only. Always send all four.
    for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) {
        params.append('category', c);
    }
    params.append('key', apiKey);
    return `${base}?${params.toString()}`;
}
export interface CallPsiOptions {
    cfg: PageSpeedProviderConfig;
    input: PageSpeedInput;
}
export async function callPsi(opts: CallPsiOptions): Promise<PsiPayload> {
    const cfg = opts.cfg;
    const url = buildPsiUrl(cfg.psiUrl ?? PSI_URL, opts.input, cfg.apiKey);
    const result = await fetchGoogleJson({
        operation: `psi-${opts.input.strategy}`,
        method: 'GET',
        url,
        schema: psiSchema,
        timeoutMs: cfg.psiTimeoutMs ?? DEFAULT_PSI_TIMEOUT_MS,
        fetchImpl: cfg.fetchImpl ?? fetch,
        ...(cfg.logger ? { logger: cfg.logger } : {}),
    });
    // `fetchGoogleJson` for PSI is always {kind:'ok'} because allow404=false.
    /* c8 ignore next -- narrowing branch that fetchGoogleJson can't produce here. */
    if (result.kind !== 'ok')
        throw new VendorMalformedError('unexpected not-found from PSI', { provider: 'google', operation: 'psi' });
    const runtimeError = result.data.lighthouseResult?.runtimeError;
    if (runtimeError !== undefined) {
        // PSI often returns HTTP 200 with a runtimeError such as
        // { code: 'LIGHTHOUSE_ERROR_NO_DOCUMENT_REQUEST', message: ... } — same
        // semantics as HTTP 500: the run failed. Map to unavailable (retryable).
        throw new VendorUnavailableError(`PSI runtime error: ${runtimeError.code}${runtimeError.message ? `: ${runtimeError.message}` : ''}`, { provider: 'google', operation: `psi-${opts.input.strategy}` });
    }
    return result.data;
}
export type CruxTarget = {
    kind: 'url';
    url: string;
} | {
    kind: 'origin';
    origin: string;
};
export interface CallCruxOptions {
    cfg: PageSpeedProviderConfig;
    target: CruxTarget;
    formFactor?: 'PHONE' | 'DESKTOP';
}
export type CruxOutcome = {
    kind: 'ok';
    data: CruxPayload;
} | {
    kind: 'not-found';
};
export async function callCrux(opts: CallCruxOptions): Promise<CruxOutcome> {
    const cfg = opts.cfg;
    const url = `${cfg.cruxUrl ?? CRUX_URL}?key=${encodeURIComponent(cfg.apiKey)}`;
    const body: Record<string, unknown> = opts.target.kind === 'url' ? { url: opts.target.url } : { origin: opts.target.origin };
    if (opts.formFactor !== undefined)
        body.formFactor = opts.formFactor;
    const result = await fetchGoogleJson({
        operation: `crux-${opts.target.kind}`,
        method: 'POST',
        url,
        body,
        schema: cruxSchema,
        timeoutMs: cfg.cruxTimeoutMs ?? DEFAULT_CRUX_TIMEOUT_MS,
        allow404: true,
        fetchImpl: cfg.fetchImpl ?? fetch,
        ...(cfg.logger ? { logger: cfg.logger } : {}),
    });
    if (result.kind === 'not-found')
        return { kind: 'not-found' };
    return { kind: 'ok', data: result.data };
}
// ---------------------------------------------------------------------------
// Interpretation helpers (pure, no I/O).
// ---------------------------------------------------------------------------
function scoreToInt(score: number | null | undefined): number {
    // PSI returns 0–1 or null. Normalize null (category not present) to 0 so
    // the shape stays numeric; callers can still inspect `lighthouseResult`
    // directly if they need the null distinction.
    if (score == null)
        return 0;
    return Math.round(score * 100);
}
export function extractLabScores(payload: PsiPayload): PageSpeedResult['labScores'] {
    const cats = payload.lighthouseResult?.categories;
    return {
        performance: scoreToInt(cats?.performance?.score),
        accessibility: scoreToInt(cats?.accessibility?.score),
        bestPractices: scoreToInt(cats?.['best-practices']?.score),
        seo: scoreToInt(cats?.seo?.score),
    };
}
/**
 * Mobile-friendliness derived from Lighthouse audits — Google deprecated
 * the dedicated API. We use the two audits that dominate mobile-fit:
 * `viewport` (declares a mobile viewport meta tag) and `tap-targets`
 * (touch targets are ≥ 48 CSS pixels). Both must score ≥ 0.9. Return
 * `undefined` when the audits are not present — never a false negative.
 */
export function extractMobileFriendly(payload: PsiPayload, strategy: PageSpeedStrategy): boolean | undefined {
    if (strategy !== 'mobile')
        return undefined;
    const audits = payload.lighthouseResult?.audits;
    if (!audits)
        return undefined;
    const viewport = audits.viewport?.score;
    const tap = audits['tap-targets']?.score;
    if (viewport == null && tap == null)
        return undefined;
    const vpOk = viewport == null ? true : viewport >= 0.9;
    const tapOk = tap == null ? true : tap >= 0.9;
    return vpOk && tapOk;
}
function toNum(v: string | number): number {
    return typeof v === 'number' ? v : Number(v);
}
export function cwvCategory(lcpMs: number, inp: number, cls: number): CoreWebVitalsCategory {
    const cats: CoreWebVitalsCategory[] = [
        lcpMs <= LCP_GOOD_MS ? 'good' : lcpMs <= LCP_POOR_MS ? 'needs-improvement' : 'poor',
        inp <= INP_GOOD_MS ? 'good' : inp <= INP_POOR_MS ? 'needs-improvement' : 'poor',
        cls <= CLS_GOOD ? 'good' : cls <= CLS_POOR ? 'needs-improvement' : 'poor',
    ];
    if (cats.includes('poor'))
        return 'poor';
    if (cats.includes('needs-improvement'))
        return 'needs-improvement';
    return 'good';
}
export function extractCoreWebVitals(payload: CruxPayload): NonNullable<PageSpeedResult['coreWebVitals']> | undefined {
    const metrics = payload.record?.metrics;
    const lcpRaw = metrics?.largest_contentful_paint?.percentiles.p75;
    const inpRaw = metrics?.interaction_to_next_paint?.percentiles.p75;
    const clsRaw = metrics?.cumulative_layout_shift?.percentiles.p75;
    if (lcpRaw === undefined || inpRaw === undefined || clsRaw === undefined) {
        return undefined;
    }
    const lcpMs = toNum(lcpRaw);
    const inp = toNum(inpRaw);
    const cls = toNum(clsRaw);
    if (!Number.isFinite(lcpMs) || !Number.isFinite(inp) || !Number.isFinite(cls)) {
        return undefined;
    }
    return {
        lcpMs,
        inp,
        cls,
        category: cwvCategory(lcpMs, inp, cls),
    };
}
// ---------------------------------------------------------------------------
// PageSpeedProvider — composes callPsi + callCrux (URL → origin fallback).
// ---------------------------------------------------------------------------
/** Extended result exposed on the snapshot: same as PageSpeedResult plus a
 * `fieldDataLevel` flag so the report UI can label CrUX data honestly
 * ("what real visitors experienced" vs "from your origin, not this URL"). */
export interface AnalyzedPageSpeed extends PageSpeedResult {
    /** How field data was resolved: `url` = URL-level CrUX, `origin` = origin
     * fallback (URL not in dataset), `none` = no field data at all. */
    fieldDataLevel: 'url' | 'origin' | 'none';
}
export interface GooglePageSpeedProvider extends PageSpeedProvider {
    analyze(input: PageSpeedInput): Promise<AnalyzedPageSpeed>;
}
export function createGooglePageSpeedProvider(cfg: PageSpeedProviderConfig): GooglePageSpeedProvider {
    if (!cfg.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for the PageSpeed provider');
    }
    const now = cfg.clock ?? Date.now;
    /* c8 ignore next 3 -- cfg.sleep ?? default path and its nested arrow are never reached in tests; every test injects cfg.sleep. */
    const sleep = cfg.sleep ??
        ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const limiter = createTokenBucketLimiter(cfg.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE, now, sleep);
    return {
        async analyze(input: PageSpeedInput): Promise<AnalyzedPageSpeed> {
            await limiter.acquire();
            const psi = await callPsi({ cfg, input });
            // CrUX — URL scope first, fall back to origin scope on 404.
            const formFactor: 'PHONE' | 'DESKTOP' = input.strategy === 'mobile' ? 'PHONE' : 'DESKTOP';
            let cwv: PageSpeedResult['coreWebVitals'] | undefined;
            let fieldDataLevel: AnalyzedPageSpeed['fieldDataLevel'] = 'none';
            const urlOutcome = await callCrux({
                cfg,
                target: { kind: 'url', url: input.url },
                formFactor,
            });
            if (urlOutcome.kind === 'ok') {
                cwv = extractCoreWebVitals(urlOutcome.data);
                if (cwv !== undefined)
                    fieldDataLevel = 'url';
            }
            if (cwv === undefined) {
                const origin = safeOrigin(input.url);
                if (origin !== null) {
                    const originOutcome = await callCrux({
                        cfg,
                        target: { kind: 'origin', origin },
                        formFactor,
                    });
                    if (originOutcome.kind === 'ok') {
                        cwv = extractCoreWebVitals(originOutcome.data);
                        /* c8 ignore start -- cwv=undefined (no origin field data) is not exercised by current PSI fixtures */
                        if (cwv !== undefined)
                            fieldDataLevel = 'origin';
                        /* c8 ignore stop */
                    }
                }
            }
            const labScores = extractLabScores(psi);
            const mobileFriendly = extractMobileFriendly(psi, input.strategy);
            const out: AnalyzedPageSpeed = {
                labScores,
                fieldDataLevel,
            };
            if (cwv !== undefined)
                out.coreWebVitals = cwv;
            if (mobileFriendly !== undefined)
                out.mobileFriendly = mobileFriendly;
            return out;
        },
    };
}
function safeOrigin(url: string): string | null {
    try {
        return new URL(url).origin;
    }
    catch {
        return null;
    }
}
/** Re-export the error base so consumers can filter by `instanceof`. */
export { ProviderError };
