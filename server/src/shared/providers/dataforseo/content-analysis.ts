/**
 * DataForSEO Content Analysis adapter.
 *
 * Wraps two DataForSEO v3 endpoints:
 *
 *   searchMentions      → POST /v3/content_analysis/search/live
 *      Docs: https://docs.dataforseo.com/v3/content_analysis/search/live/
 *      Returns citation rows for a brand/topic keyword across the vendor
 *      index of publisher URLs. Pinned cost:
 *      `$0.006` task + `$0.0001 × returned_rows`.
 *
 *   getMentionSummary   → POST /v3/content_analysis/summary/live
 *      Docs: https://docs.dataforseo.com/v3/content_analysis/summary/live/
 *      Returns aggregate counts and sentiment distribution for the same
 *      brand/topic keyword. Pinned cost:
 *      `$0.02` task + `$0.0001 × aggregate_rows`.
 *
 * Provider seam only — no feature module consumes it yet (the Brand
 * Radar pipeline will). The adapter normalizes every mention
 * row to a bounded shape (SEC-BOUND) and drops author profile ids,
 * emails, favicons, logos, and any other vendor field that is not on the
 * kept-fields list (SEC-INJECT / privacy).
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorMalformedError } from '../errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import type { ContentAnalysisMentionQuery, ContentAnalysisMentionRow, ContentAnalysisMentionSummary, ContentAnalysisProvider, ProviderMarket, } from '../types.js';
export interface DataForSeoContentAnalysisProviderConfig extends DataForSeoConfig {
    logger?: Logger;
}
const CTX_SEARCH = { provider: 'dataforseo', operation: 'content-analysis-search' };
const CTX_SUMMARY = { provider: 'dataforseo', operation: 'content-analysis-summary' };
const MAX_LIMIT = 1000;
const MAX_TOP_DOMAINS = 50;
export const SNIPPET_MAX_CHARS = 300;
export const TITLE_MAX_CHARS = 200;
/** Zod input schemas — SEC-INJECT / SEC-BOUND enforcement at the boundary. */
export const contentAnalysisQuerySchema = z
    .object({
    query: z
        .string()
        .transform((s) => s.trim())
        .pipe(z
        .string()
        .min(1)
        .max(200)
        // Reject control characters and newlines outright.
        // eslint-disable-next-line no-control-regex
        .regex(/^[^\u0000-\u001F\u007F]+$/, {
        message: 'query must not contain control characters',
    })),
    language: z
        .string()
        .regex(/^[a-zA-Z_]{2,15}$/)
        .optional(),
    countryCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    publishedFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT),
})
    .strict();
const contentLocationResultSchema = z.array(z
    .object({
    location_name: z.string(),
    country_iso_code: z.string(),
})
    .passthrough());
export function normalizeContentAnalysisMarkets(rows: z.infer<typeof contentLocationResultSchema>): ProviderMarket[] {
    const countryCodes = new Set<string>();
    for (const row of rows) {
        const countryCode = row.country_iso_code.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(countryCode))
            countryCodes.add(countryCode);
    }
    return [...countryCodes].map((countryCode) => ({
        countryCode,
        locationCode: null,
        languageCodes: [],
    }));
}
// ---------------------------------------------------------------------------
// Vendor response schemas — validated at the boundary.
// ---------------------------------------------------------------------------
const sentimentBucketSchema = z
    .object({
    positive: z.number().nullable().optional(),
    neutral: z.number().nullable().optional(),
    negative: z.number().nullable().optional(),
})
    .passthrough();
const searchItemSchema = z
    .object({
    url: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    snippet: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    language_code: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    published_date: z.string().nullable().optional(),
    sentiment_connotations: sentimentBucketSchema.nullable().optional(),
    // Anything else in the vendor row is deliberately dropped at
    // normalization — do NOT surface author names, ids, emails, or urls.
})
    .passthrough();
const searchResultSchema = z
    .array(z
    .object({
    items: z.array(searchItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const summaryResultSchema = z
    .array(z
    .object({
    total_count: z.number().nullable().optional(),
    rank: z.number().nullable().optional(),
    se_types: z.array(z.string()).nullable().optional(),
    sentiment_connotations: sentimentBucketSchema.nullable().optional(),
    top_domains: z
        .array(z
        .object({
        domain: z.string().nullable().optional(),
        count: z.number().nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .nullable();
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit testing.
// ---------------------------------------------------------------------------
/** Clamp a bounded string. `null` when input is not a non-empty string. */
export function clampBoundedText(value: unknown, max: number): string | null {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0)
        return null;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
/** Derive an eTLD+1-style bare host from an absolute HTTP(S) URL. */
export function extractDomain(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        return parsed.hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
/** Map vendor sentiment buckets → polarity enum + confidence. */
export function derivePolarity(buckets: z.infer<typeof sentimentBucketSchema> | null | undefined): {
    polarity: 'positive' | 'neutral' | 'negative' | null;
    confidence: number | null;
} {
    if (!buckets)
        return { polarity: null, confidence: null };
    const pos = typeof buckets.positive === 'number' ? buckets.positive : null;
    const neu = typeof buckets.neutral === 'number' ? buckets.neutral : null;
    const neg = typeof buckets.negative === 'number' ? buckets.negative : null;
    if (pos === null && neu === null && neg === null) {
        return { polarity: null, confidence: null };
    }
    const entries: Array<{
        polarity: 'positive' | 'neutral' | 'negative';
        value: number;
    }> = [];
    if (pos !== null)
        entries.push({ polarity: 'positive', value: pos });
    if (neu !== null)
        entries.push({ polarity: 'neutral', value: neu });
    if (neg !== null)
        entries.push({ polarity: 'negative', value: neg });
    entries.sort((a, b) => b.value - a.value);
    const top = entries[0]!;
    return { polarity: top.polarity, confidence: top.value };
}
function normalizeIsoDate(value: string | null | undefined): string | null {
    if (typeof value !== 'string' || value.length === 0)
        return null;
    const trimmed = value.trim();
    const iso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
    return iso.test(trimmed) ? trimmed : null;
}
/**
 * Normalize a raw vendor row to the interface shape or `null` when the row
 * lacks a valid absolute URL. Dropped fields: author name/id/url, favicon,
 * logo, source-id, and anything else outside the kept-fields list.
 */
export function normalizeMentionRow(raw: z.infer<typeof searchItemSchema>): ContentAnalysisMentionRow | null {
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (url.length === 0)
        return null;
    const domainFromUrl = extractDomain(url);
    if (domainFromUrl === null)
        return null;
    const domain = typeof raw.domain === 'string' && raw.domain.trim().length > 0
        ? raw.domain.trim().toLowerCase()
        : domainFromUrl;
    const title = clampBoundedText(raw.title, TITLE_MAX_CHARS) ?? '';
    const snippet = clampBoundedText(raw.text ?? raw.snippet, SNIPPET_MAX_CHARS) ?? '';
    const language = typeof raw.language_code === 'string' && raw.language_code.length > 0
        ? raw.language_code.toLowerCase()
        : typeof raw.language === 'string' && raw.language.length > 0
            ? raw.language.toLowerCase()
            : null;
    const observedAt = normalizeIsoDate(raw.date ?? raw.published_date);
    return {
        url,
        domain,
        title,
        snippet,
        sentiment: derivePolarity(raw.sentiment_connotations ?? null),
        language,
        observedAt,
    };
}
export function normalizeMentionRows(result: z.infer<typeof searchResultSchema>): ContentAnalysisMentionRow[] {
    const items = result?.[0]?.items ?? [];
    const rows: ContentAnalysisMentionRow[] = [];
    for (const raw of items) {
        const row = normalizeMentionRow(raw);
        if (row !== null)
            rows.push(row);
    }
    return rows;
}
export function normalizeMentionSummary(result: z.infer<typeof summaryResultSchema>): ContentAnalysisMentionSummary {
    const first = result?.[0];
    const total = typeof first?.total_count === 'number' ? first.total_count : 0;
    const buckets = first?.sentiment_connotations ?? null;
    const rawDomains = Array.isArray(first?.top_domains) ? first!.top_domains! : [];
    const topDomains: Array<{
        domain: string;
        mentions: number;
    }> = [];
    for (const entry of rawDomains) {
        if (typeof entry.domain !== 'string' || entry.domain.trim().length === 0)
            continue;
        if (typeof entry.count !== 'number')
            continue;
        topDomains.push({ domain: entry.domain.trim().toLowerCase(), mentions: entry.count });
        if (topDomains.length >= MAX_TOP_DOMAINS)
            break;
    }
    return {
        totalMentions: total,
        distribution: {
            positive: typeof buckets?.positive === 'number' ? buckets.positive : 0,
            neutral: typeof buckets?.neutral === 'number' ? buckets.neutral : 0,
            negative: typeof buckets?.negative === 'number' ? buckets.negative : 0,
        },
        topDomains,
    };
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoContentAnalysisProvider(cfg: DataForSeoContentAnalysisProviderConfig): ContentAnalysisProvider {
    async function listMarkets(): Promise<ProviderMarket[]> {
        const outcomes = await dataForSeoRequest(cfg, '/content_analysis/locations', [], contentLocationResultSchema, { operation: 'content-analysis-market-catalog', method: 'GET' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('content_analysis/locations returned no ok tasks', { provider: 'dataforseo', operation: 'content-analysis-market-catalog' });
        }
        return normalizeContentAnalysisMarkets(outcome.result);
    }
    async function searchMentions(input: ContentAnalysisMentionQuery): Promise<ContentAnalysisMentionRow[]> {
        const parsed = contentAnalysisQuerySchema.parse(input);
        const body: Record<string, unknown> = {
            keyword: parsed.query,
            limit: Math.min(parsed.limit, MAX_LIMIT),
        };
        if (parsed.language)
            body.language_code = parsed.language.toLowerCase();
        if (parsed.publishedFrom)
            body.published_date_from = parsed.publishedFrom;
        if (parsed.countryCode)
            body.filters = ['country', '=', parsed.countryCode];
        const outcomes = await dataForSeoRequest(cfg, '/content_analysis/search/live', [body], searchResultSchema, { operation: CTX_SEARCH.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('content_analysis/search/live returned no ok tasks', CTX_SEARCH);
        }
        return normalizeMentionRows(outcome.result);
    }
    async function getMentionSummary(input: ContentAnalysisMentionQuery): Promise<ContentAnalysisMentionSummary> {
        const parsed = contentAnalysisQuerySchema.parse(input);
        const body: Record<string, unknown> = {
            keyword: parsed.query,
        };
        if (parsed.language)
            body.language_code = parsed.language.toLowerCase();
        if (parsed.publishedFrom)
            body.published_date_from = parsed.publishedFrom;
        if (parsed.countryCode)
            body.filters = ['country', '=', parsed.countryCode];
        const outcomes = await dataForSeoRequest(cfg, '/content_analysis/summary/live', [body], summaryResultSchema, { operation: CTX_SUMMARY.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('content_analysis/summary/live returned no ok tasks', CTX_SUMMARY);
        }
        return normalizeMentionSummary(outcome.result);
    }
    return { listMarkets, searchMentions, getMentionSummary };
}
