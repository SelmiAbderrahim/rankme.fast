/**
 * DataForSEO Google Trends adapter.
 *
 * Wraps one DataForSEO v3 endpoint:
 *
 *   explore → POST /keywords_data/google_trends/explore/live
 *      Docs: https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/live/
 *      Returns monthly interest-over-time series (0..100) for up to 5
 *      keywords plus related queries. Pinned unit cost: `$0.01` per task,
 *      worst-case ≤ 2 tasks per call → 20_000 micros. This adapter always
 *      issues ONE task per call.
 *
 * Provider seam only — no feature module consumes it yet (the Keyword
 * Trends feature will). Vendor-neutral output: monthly-only series,
 * ascending by (year, month), clamped 0..100 values, ≤60 points per series,
 * ≤50 related-query rows. Adapter refuses future `endDate` (SEC-INJECT) and
 * clamps every string/number bound at the boundary (SEC-BOUND). Related-
 * query text is treated as UNTRUSTED (SEC-OUT) downstream.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorMalformedError } from '../errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import type { TrendsExploreInput, TrendsExploreResult, TrendsMonthlyPoint, TrendsProvider, TrendsRelatedQuery, TrendsSeries, } from '../types.js';
export interface DataForSeoTrendsProviderConfig extends DataForSeoConfig {
    logger?: Logger;
    /**
     * Injectable clock — the adapter stamps `observedAt` on every result.
     * Tests supply a frozen `now`; production leaves it default (`Date.now`).
     */
    now?: () => Date;
}
const CTX_EXPLORE = { provider: 'dataforseo', operation: 'trends-explore' };
export const MAX_KEYWORDS = 5;
export const MAX_KEYWORD_CHARS = 200;
export const MAX_MONTHLY_POINTS_PER_SERIES = 60;
export const MAX_RELATED_QUERIES = 50;
export const MAX_RELATED_QUERY_CHARS = 100;
export const DEFAULT_TRENDS_TIME_RANGE = 'past_5_years';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_LANG = /^[a-zA-Z]{2}$/;
/**
 * True when `value` contains an ASCII control character (U+0000..U+001F,
 * U+007F) — used to block newline/tab/injection payloads at the boundary
 * without needing a literal-control-char regex in source.
 */
export function containsControlChar(value: string): boolean {
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code <= 31 || code === 127)
            return true;
    }
    return false;
}
/**
 * Input schema — SEC-INJECT / SEC-BOUND enforcement at the boundary.
 * Trims, deduplicates (case-insensitive), and rejects control chars, empty
 * strings, and future `endDate`.
 */
export const trendsExploreInputSchema = z
    .object({
    keywords: z
        .array(z.string())
        .transform((arr) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of arr) {
            const trimmed = raw.trim();
            if (trimmed.length === 0)
                continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(trimmed);
        }
        return out;
    })
        .pipe(z
        .array(z
        .string()
        .min(1)
        .max(MAX_KEYWORD_CHARS)
        .refine((s) => !containsControlChar(s), {
        message: 'keyword must not contain control characters',
    }))
        .min(1)
        .max(MAX_KEYWORDS)),
    locationCode: z.number().int().positive().optional(),
    languageCode: z.string().regex(ISO_LANG).optional(),
    startDate: z.string().regex(ISO_DATE).optional(),
    endDate: z.string().regex(ISO_DATE).optional(),
})
    .strict();
// ---------------------------------------------------------------------------
// Vendor response schemas — validated at the boundary.
// ---------------------------------------------------------------------------
const trendsMonthlyDataItemSchema = z
    .object({
    type: z.string().nullable().optional(),
    keywords: z.array(z.string()).nullable().optional(),
    /**
     * Vendor `data` for `google_trends_graph` items. The vendor's time
     * buckets are normalized to calendar months below; each bucket carries
     * one value per input keyword.
     */
    data: z
        .array(z
        .object({
        date_from: z.string().nullable().optional(),
        date_to: z.string().nullable().optional(),
        timestamp: z.number().nullable().optional(),
        values: z.array(z.number().nullable()).nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
    /** Related-query rows for `google_trends_queries_list` items. */
    top: z
        .array(z
        .object({
        query: z.string().nullable().optional(),
        value: z.number().nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
    rising: z
        .array(z
        .object({
        query: z.string().nullable().optional(),
        value: z.number().nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough();
const trendsResultSchema = z
    .array(z
    .object({
    location_code: z.number().nullable().optional(),
    language_code: z.string().nullable().optional(),
    check_url: z.string().nullable().optional(),
    datetime: z.string().nullable().optional(),
    items: z.array(trendsMonthlyDataItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit testing.
// ---------------------------------------------------------------------------
/** Clamp a numeric value into 0..100. Non-finite/negative → 0; > 100 → 100. */
export function clampInterestValue(raw: unknown): number {
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    if (n <= 0)
        return 0;
    if (n >= 100)
        return 100;
    return Math.round(n);
}
/** Bounded, trimmed related-query text or `null` when unusable. */
export function clampRelatedQueryText(value: unknown): string | null {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0)
        return null;
    return trimmed.length > MAX_RELATED_QUERY_CHARS
        ? trimmed.slice(0, MAX_RELATED_QUERY_CHARS)
        : trimmed;
}
/**
 * Refuse future dates at the boundary. `now` is the reference instant.
 * Non-ISO / undefined dates return true (nothing to compare).
 */
export function isNotFutureDate(iso: string | undefined, now: Date): boolean {
    if (typeof iso !== 'string' || !ISO_DATE.test(iso))
        return true;
    return new Date(`${iso}T00:00:00Z`).getTime() <= now.getTime();
}
/**
 * Compute `(year, month)` from a vendor bucket. Prefers `date_from` (YYYY-MM-DD),
 * falls back to `timestamp` (unix-seconds). Returns `null` when neither
 * yields a real month.
 */
export function extractYearMonth(raw: z.infer<typeof trendsMonthlyDataItemSchema>['data'] extends Array<infer U> | null | undefined ? U : never): {
    year: number;
    month: number;
} | null {
    if (typeof raw.date_from === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(raw.date_from)) {
        const year = Number(raw.date_from.slice(0, 4));
        const month = Number(raw.date_from.slice(5, 7));
        if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
            return { year, month };
        }
    }
    if (typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)) {
        const d = new Date(raw.timestamp * 1000);
        if (!Number.isNaN(d.getTime())) {
            return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
        }
    }
    return null;
}
/**
 * Build the vendor-neutral `TrendsSeries[]` for the requested `keywords`
 * from the parsed graph item. Vendor buckets are deterministically averaged
 * by UTC calendar month so a five-year weekly response cannot crowd older
 * months out of the 60-point contract. Missing series values are skipped;
 * output is ascending-sorted and capped at MAX_MONTHLY_POINTS_PER_SERIES.
 */
export function normalizeGraphSeries(graphItem: z.infer<typeof trendsMonthlyDataItemSchema> | undefined, requestedKeywords: readonly string[]): TrendsSeries[] {
    if (!graphItem)
        return requestedKeywords.map((keyword) => ({ keyword, points: [] }));
    const buckets = Array.isArray(graphItem.data) ? graphItem.data : [];
    const perSeries = requestedKeywords.map(() => new Map<string, {
        year: number;
        month: number;
        valueTotal: number;
        valueCount: number;
    }>());
    for (const bucket of buckets) {
        const ym = extractYearMonth(bucket);
        if (ym === null)
            continue;
        const values = Array.isArray(bucket.values) ? bucket.values : [];
        for (let i = 0; i < requestedKeywords.length; i += 1) {
            const raw = values[i];
            if (raw === null || raw === undefined)
                continue;
            const key = `${ym.year}-${ym.month}`;
            const existing = perSeries[i]!.get(key);
            const value = clampInterestValue(raw);
            if (existing) {
                existing.valueTotal += value;
                existing.valueCount += 1;
            }
            else {
                perSeries[i]!.set(key, {
                    year: ym.year,
                    month: ym.month,
                    valueTotal: value,
                    valueCount: 1,
                });
            }
        }
    }
    return requestedKeywords.map((keyword, idx) => {
        const points: TrendsMonthlyPoint[] = [...perSeries[idx]!.values()]
            .map(({ year, month, valueTotal, valueCount }) => ({
            year,
            month,
            value: clampInterestValue(valueTotal / valueCount),
        }))
            .sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month))
            .slice(-MAX_MONTHLY_POINTS_PER_SERIES);
        return { keyword, points };
    });
}
/** Extract related queries from the top/rising list items. Deduplicated by
 * (query, kind); capped at MAX_RELATED_QUERIES with insertion order kept. */
export function normalizeRelatedQueries(items: ReadonlyArray<z.infer<typeof trendsMonthlyDataItemSchema>>): TrendsRelatedQuery[] {
    const out: TrendsRelatedQuery[] = [];
    const seen = new Set<string>();
    const push = (kind: 'top' | 'rising', row: {
        query?: string | null;
        value?: number | null;
    }) => {
        const query = clampRelatedQueryText(row.query);
        if (query === null)
            return;
        const value = clampInterestValue(row.value);
        const key = `${kind}::${query.toLowerCase()}`;
        if (seen.has(key))
            return;
        seen.add(key);
        out.push({ query, value, kind });
    };
    for (const item of items) {
        for (const row of item.top ?? [])
            push('top', row);
        if (out.length >= MAX_RELATED_QUERIES)
            break;
        for (const row of item.rising ?? [])
            push('rising', row);
        if (out.length >= MAX_RELATED_QUERIES)
            break;
    }
    return out.slice(0, MAX_RELATED_QUERIES);
}
/**
 * Assemble the vendor-neutral result from the parsed vendor result payload.
 * Missing/absent fields are reported as null/empty — never dropped and never
 * thrown as malformed (the adapter treats those states as "empty").
 */
export function normalizeExploreResult(result: z.infer<typeof trendsResultSchema>, input: {
    keywords: readonly string[];
    startDate: string | null;
    endDate: string | null;
}, observedAt: string): TrendsExploreResult {
    const first = result?.[0];
    const items = Array.isArray(first?.items) ? first!.items! : [];
    const graphItem = items.find((it) => it.type === 'google_trends_graph');
    const series = normalizeGraphSeries(graphItem, input.keywords);
    const relatedQueries = normalizeRelatedQueries(items);
    return {
        series,
        relatedQueries,
        window: { startDate: input.startDate, endDate: input.endDate },
        observedAt,
        locationCode: typeof first?.location_code === 'number' && Number.isFinite(first.location_code)
            ? first!.location_code!
            : null,
        languageCode: typeof first?.language_code === 'string' && first.language_code.length > 0
            ? first!.language_code!.toLowerCase()
            : null,
    };
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoTrendsProvider(cfg: DataForSeoTrendsProviderConfig): TrendsProvider {
    const clock = cfg.now ?? (() => new Date());
    async function explore(input: TrendsExploreInput): Promise<TrendsExploreResult> {
        const parsed = trendsExploreInputSchema.parse(input);
        const nowInstant = clock();
        if (!isNotFutureDate(parsed.endDate, nowInstant)) {
            throw new VendorMalformedError('endDate must not be in the future', CTX_EXPLORE);
        }
        if (!isNotFutureDate(parsed.startDate, nowInstant)) {
            throw new VendorMalformedError('startDate must not be in the future', CTX_EXPLORE);
        }
        const body: Record<string, unknown> = {
            keywords: parsed.keywords,
            type: 'web',
            // Five years supplies enough monthly history for the deterministic
            // YoY and seasonality readouts while remaining inside the 60-point
            // vendor-neutral contract.
            time_range: DEFAULT_TRENDS_TIME_RANGE,
            item_types: ['google_trends_graph', 'google_trends_queries_list'],
        };
        if (parsed.locationCode !== undefined)
            body.location_code = parsed.locationCode;
        if (parsed.languageCode !== undefined)
            body.language_code = parsed.languageCode.toLowerCase();
        if (parsed.startDate !== undefined) {
            body.date_from = parsed.startDate;
            // When explicit dates are passed the vendor ignores time_range.
            delete body.time_range;
        }
        if (parsed.endDate !== undefined) {
            body.date_to = parsed.endDate;
            delete body.time_range;
        }
        const outcomes = await dataForSeoRequest(cfg, '/keywords_data/google_trends/explore/live', [body], trendsResultSchema, { operation: CTX_EXPLORE.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('google_trends/explore/live returned no ok tasks', CTX_EXPLORE);
        }
        return normalizeExploreResult(outcome.result, {
            keywords: parsed.keywords,
            startDate: parsed.startDate ?? null,
            endDate: parsed.endDate ?? null,
        }, nowInstant.toISOString());
    }
    return { explore };
}
