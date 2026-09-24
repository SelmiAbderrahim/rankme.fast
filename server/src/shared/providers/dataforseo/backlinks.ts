/**
 * DataForSEO Backlinks adapter.
 *
 * Implements the vendor-neutral BacklinkProvider over two live
 * DataForSEO v3 endpoints (Backlinks is a SEPARATE DataForSEO subscription
 * from Keywords/SERP/Labs; the shared login/password still authenticates):
 *
 *   getSummary       → POST /backlinks/summary/live
 *                       ($0.02/request). We request `rank_scale: "one_hundred"`
 *                       so the domain-rank field is on the familiar 0–100
 *                       "domain rating" scale — the label the UI shows.
 *                       ("Domain Authority" is a Moz trademark; the Moz Links
 *                       API is the named fallback if branded DA is ever
 *                       required — comment-only, not wired.)
 *
 *   listBacklinks    → POST /backlinks/backlinks/live
 *                       (`mode: "one_per_domain"` for hygiene — one link per
 *                       referring domain — with billed-per-row semantics;
 *                       cursor is mapped onto the vendor's `search_after_token`.
 *                       `limit` maxes at 1000; the caller is expected to pass
 *                       the metering budget in via `opts.limit`.)
 *
 * Row metering lives in the /backlinks module — the provider surfaces raw
 * rows and the vendor's next-page token; the module increments the
 * `backlink_rows` usage counter by `rows.length` on every successful page.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError } from '../errors.js';
import type { BacklinkAnchorRow, BacklinkBulkRankRow, BacklinkCompetitorRow, BacklinkHistoryPoint, BacklinkListPage, BacklinkProvider, BacklinkReferringDomainRow, BacklinkRow, BacklinkSpamScoreRow, BacklinkSummary, } from '../types.js';
// ---------------------------------------------------------------------------
// Vendor payload schemas — validated at the boundary; feature code only reads
// the zod-parsed shape.
// ---------------------------------------------------------------------------
const summaryItemSchema = z
    .object({
    rank: z.number().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    broken_backlinks: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
})
    .passthrough();
const summaryResultSchema = z.array(summaryItemSchema).nullable();
const backlinksListItemSchema = z
    .object({
    domain_from: z.string().nullable().optional(),
    url_from: z.string(),
    url_to: z.string(),
    anchor: z.string().nullable().optional(),
    dofollow: z.boolean().nullable().optional(),
    rank: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    last_seen: z.string().nullable().optional(),
    is_broken: z.boolean().nullable().optional(),
    backlink_spam_score: z.number().int().min(0).max(100).nullable().optional(),
    url_to_spam_score: z.number().int().min(0).max(100).nullable().optional(),
})
    .passthrough();
const backlinksListResultSchema = z
    .array(z
    .object({
    items: z.array(backlinksListItemSchema).nullable().optional(),
    search_after_token: z.string().nullable().optional(),
})
    .passthrough())
    .min(1);
// ---------------------------------------------------------------------------
// Deep-op payload schemas
// ---------------------------------------------------------------------------
const referringDomainItemSchema = z
    .object({
    domain: z.string().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    rank: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    last_visited: z.string().nullable().optional(),
})
    .passthrough();
const referringDomainsResultSchema = z
    .array(z
    .object({
    items: z.array(referringDomainItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const anchorItemSchema = z
    .object({
    anchor: z.string().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
})
    .passthrough();
const anchorsResultSchema = z
    .array(z
    .object({
    items: z.array(anchorItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const historyItemSchema = z
    .object({
    year: z.number().nullable().optional(),
    month: z.number().nullable().optional(),
    date: z.string().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
})
    .passthrough();
const historyResultSchema = z
    .array(z
    .object({
    items: z.array(historyItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const bulkRankItemSchema = z
    .object({
    target: z.string().nullable().optional(),
    rank: z.number().nullable().optional(),
})
    .passthrough();
const bulkRanksResultSchema = z
    .array(z
    .object({
    items: z.array(bulkRankItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const bulkSpamScoreItemSchema = z
    .object({
    target: z.string().nullable().optional(),
    spam_score: z.number().int().min(0).max(100).nullable().optional(),
})
    .passthrough();
const bulkSpamScoresResultSchema = z
    .array(z
    .object({
    items: z.array(bulkSpamScoreItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const backlinkCompetitorItemSchema = z
    .object({
    target: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    intersections: z.number().nullable().optional(),
    backlinks_intersections: z.number().nullable().optional(),
    rank: z.number().nullable().optional(),
})
    .passthrough();
const backlinkCompetitorsResultSchema = z
    .array(z
    .object({
    items: z.array(backlinkCompetitorItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface DataForSeoBacklinkProviderConfig extends DataForSeoConfig {
    logger?: Logger;
}
/** Max rows the vendor accepts on a single backlinks/list call. */
export const BACKLINKS_MAX_LIMIT = 1000;
/** Vendor default when the caller omits `limit` — the API bills per row. */
export const BACKLINKS_DEFAULT_LIMIT = 100;
/** Row limit ceiling for the deep-op endpoints. */
export const BACKLINKS_DEEP_ROW_MAX_LIMIT = 500;
/** History point ceiling: newest 24 months. */
export const BACKLINKS_HISTORY_MAX_POINTS = 24;
/** Bulk-rank domain input ceiling. */
export const BACKLINKS_BULK_RANK_MAX_DOMAINS = 100;
/** Vendor capability maximum; the toxicity feature applies its own 100 cap. */
export const BACKLINKS_BULK_SPAM_SCORE_MAX_TARGETS = 1000;
/** Anchor text is untrusted third-party text (SEC-OUT); clamped at boundary. */
export const BACKLINKS_ANCHOR_MAX_CHARS = 200;
const CTX_SUMMARY = { provider: 'dataforseo', operation: 'backlinks-summary' };
const CTX_LIST = { provider: 'dataforseo', operation: 'backlinks-list' };
const CTX_REFERRING = { provider: 'dataforseo', operation: 'backlinks-referring-domains' };
const CTX_ANCHORS = { provider: 'dataforseo', operation: 'backlinks-anchors' };
const CTX_HISTORY = { provider: 'dataforseo', operation: 'backlinks-history' };
const CTX_BULK_RANKS = { provider: 'dataforseo', operation: 'backlinks-bulk-ranks' };
const CTX_BULK_SPAM_SCORES = {
    provider: 'dataforseo',
    operation: 'backlinks-bulk-spam-score',
};
const CTX_COMPETITORS = {
    provider: 'dataforseo',
    operation: 'backlinks-competitors',
};
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit coverage.
// ---------------------------------------------------------------------------
/** Strip protocol + trailing slash so the vendor sees a bare host. */
export function normalizeBacklinkTarget(target: string): string {
    const trimmed = target.trim();
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    return withoutScheme.replace(/\/+$/, '').toLowerCase();
}
/** Clamp caller `limit` to [1, BACKLINKS_MAX_LIMIT] with a sensible default. */
export function clampBacklinkLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        return BACKLINKS_DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(Math.floor(limit), BACKLINKS_MAX_LIMIT));
}
/**
 * Vendor timestamps are "YYYY-MM-DD HH:MM:SS +00:00"; JS Date.parse accepts
 * that. Returns null for missing / unparseable input — callers persist that
 * as SQL NULL, never as `new Date(NaN)`.
 */
export function parseVendorDate(value: string | null | undefined): Date | null {
    if (typeof value !== 'string' || value.length === 0)
        return null;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        return null;
    return new Date(parsed);
}
/** Clamp row `limit` to [1, BACKLINKS_DEEP_ROW_MAX_LIMIT] with sensible default. */
export function clampBacklinkDeepRowLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        return BACKLINKS_DEEP_ROW_MAX_LIMIT;
    }
    return Math.max(1, Math.min(Math.floor(limit), BACKLINKS_DEEP_ROW_MAX_LIMIT));
}
/** Clamp history point `limit` to [1, BACKLINKS_HISTORY_MAX_POINTS]. */
export function clampBacklinkHistoryLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        return BACKLINKS_HISTORY_MAX_POINTS;
    }
    return Math.max(1, Math.min(Math.floor(limit), BACKLINKS_HISTORY_MAX_POINTS));
}
/**
 * Normalize a target/domain string for output rows: lowercased, scheme + `www.`
 * + trailing slash stripped, whitespace trimmed. Empty strings become `''`
 * so the caller can drop them.
 */
export function normalizeBacklinkOutputDomain(raw: string): string {
    const trimmed = raw.trim();
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    const withoutWww = withoutScheme.replace(/^www\./i, '');
    return withoutWww.replace(/\/+$/, '').toLowerCase();
}
/**
 * Normalize an input list of domains for `getBulkRanks`: lowercase, strip
 * scheme + `www.`, dedupe (case-insensitive), drop empties. Clamped to
 * BACKLINKS_BULK_RANK_MAX_DOMAINS. Returns [] when nothing survives.
 */
export function normalizeBulkRankDomains(domains: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of domains) {
        if (typeof raw !== 'string')
            continue;
        const norm = normalizeBacklinkOutputDomain(raw);
        if (norm.length === 0)
            continue;
        if (seen.has(norm))
            continue;
        seen.add(norm);
        out.push(norm);
        if (out.length >= BACKLINKS_BULK_RANK_MAX_DOMAINS)
            break;
    }
    return out;
}
function normalizeSpamScoreTarget(raw: string): string {
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const parsed = new URL(trimmed);
            parsed.hash = '';
            return parsed.toString();
        }
        catch {
            return '';
        }
    }
    const domain = normalizeBacklinkOutputDomain(trimmed);
    return domain.length <= 253 && domain.includes('.') &&
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)
        ? domain
        : '';
}
/** Normalize, dedupe, and clamp bulk-spam targets to the vendor maximum. */
export function normalizeBulkSpamScoreTargets(targets: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of targets) {
        if (typeof raw !== 'string')
            continue;
        const normalized = normalizeSpamScoreTarget(raw);
        if (normalized.length === 0 || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
        if (out.length >= BACKLINKS_BULK_SPAM_SCORE_MAX_TARGETS)
            break;
    }
    return out;
}
/**
 * Clamp untrusted third-party anchor text to `BACKLINKS_ANCHOR_MAX_CHARS`.
 * Collapses internal whitespace and drops control characters as a boundary
 * hygiene step. Empty strings become `''`.
 */
export function clampAnchorText(raw: unknown): string {
    if (typeof raw !== 'string')
        return '';
    // Drop ASCII control characters (U+0000..U+001F, U+007F) so log/exports
    // never see raw newlines/tabs coming from crawled anchor text.
    let cleaned = '';
    for (let i = 0; i < raw.length; i += 1) {
        const code = raw.charCodeAt(i);
        if (code <= 31 || code === 127)
            continue;
        cleaned += raw[i];
    }
    const collapsed = cleaned.replace(/\s+/g, ' ').trim();
    return collapsed.length > BACKLINKS_ANCHOR_MAX_CHARS
        ? collapsed.slice(0, BACKLINKS_ANCHOR_MAX_CHARS)
        : collapsed;
}
/**
 * Extract (year, month) from a vendor history item. Prefers explicit
 * `year`/`month` numeric fields; falls back to `date` (YYYY-MM or
 * YYYY-MM-DD). Returns null when neither yields a valid month.
 */
export function extractHistoryYearMonth(raw: z.infer<typeof historyItemSchema>): {
    year: number;
    month: number;
} | null {
    if (typeof raw.year === 'number' && typeof raw.month === 'number') {
        const y = Math.trunc(raw.year);
        const m = Math.trunc(raw.month);
        if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
            return { year: y, month: m };
        }
    }
    if (typeof raw.date === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(raw.date)) {
        const y = Number(raw.date.slice(0, 4));
        const m = Number(raw.date.slice(5, 7));
        if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
            return { year: y, month: m };
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoBacklinkProvider(cfg: DataForSeoBacklinkProviderConfig): Required<BacklinkProvider> {
    async function getSummary(domain: string): Promise<BacklinkSummary> {
        const target = normalizeBacklinkTarget(domain);
        const body = {
            target,
            include_subdomains: true,
            backlinks_status_type: 'live',
            // 0..100 rank scale — the familiar "domain rating" surface.
            rank_scale: 'one_hundred',
        };
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/summary/live', [body], summaryResultSchema, { operation: 'backlinks-summary' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/summary/live returned no ok tasks', CTX_SUMMARY);
        }
        const item = outcome.result?.[0];
        if (!item) {
            // No rows for this target — treated as "unknown domain" in the interface.
            return {
                domainRank: null,
                backlinks: 0,
                referringDomains: 0,
                brokenBacklinks: 0,
                firstSeen: null,
            };
        }
        return {
            domainRank: typeof item.rank === 'number' ? item.rank : null,
            backlinks: typeof item.backlinks === 'number' ? item.backlinks : 0,
            referringDomains: typeof item.referring_domains === 'number' ? item.referring_domains : 0,
            brokenBacklinks: typeof item.broken_backlinks === 'number' ? item.broken_backlinks : 0,
            firstSeen: parseVendorDate(item.first_seen),
        };
    }
    async function listBacklinks(domain: string, opts: {
        limit: number;
        cursor?: string;
    }): Promise<BacklinkListPage> {
        const target = normalizeBacklinkTarget(domain);
        const limit = clampBacklinkLimit(opts.limit);
        const body: Record<string, unknown> = {
            target,
            mode: 'one_per_domain',
            limit,
            include_subdomains: true,
            backlinks_status_type: 'live',
        };
        if (opts.cursor && opts.cursor.length > 0) {
            body.search_after_token = opts.cursor;
        }
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/backlinks/live', [body], backlinksListResultSchema, { operation: 'backlinks-list' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/backlinks/live returned no ok tasks', CTX_LIST);
        }
        const first = outcome.result[0];
        const rawItems = first?.items ?? [];
        const rows: BacklinkRow[] = rawItems.map((item) => ({
            ...(typeof item.domain_from === 'string' && item.domain_from.length > 0
                ? { domainFrom: normalizeBacklinkOutputDomain(item.domain_from) }
                : {}),
            urlFrom: item.url_from,
            urlTo: item.url_to,
            anchor: typeof item.anchor === 'string' ? item.anchor : null,
            dofollow: item.dofollow === true,
            isBroken: item.is_broken === true,
            firstSeen: parseVendorDate(item.first_seen),
            lastSeen: parseVendorDate(item.last_seen),
            backlinkSpamScore: typeof item.backlink_spam_score === 'number'
                ? item.backlink_spam_score
                : null,
            urlToSpamScore: typeof item.url_to_spam_score === 'number' ? item.url_to_spam_score : null,
        }));
        const nextCursor = typeof first?.search_after_token === 'string' && first.search_after_token.length > 0
            ? first.search_after_token
            : undefined;
        return nextCursor === undefined ? { rows } : { rows, nextCursor };
    }
    async function getReferringDomains(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkReferringDomainRow[]> {
        const target = normalizeBacklinkTarget(domain);
        const limit = clampBacklinkDeepRowLimit(opts.limit);
        const body = {
            target,
            limit,
            include_subdomains: true,
            backlinks_status_type: 'live',
            rank_scale: 'one_hundred',
        };
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/referring_domains/live', [body], referringDomainsResultSchema, { operation: CTX_REFERRING.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/referring_domains/live returned no ok tasks', CTX_REFERRING);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const rows: BacklinkReferringDomainRow[] = [];
        for (const item of items) {
            const norm = normalizeBacklinkOutputDomain(typeof item.domain === 'string' ? item.domain : '');
            if (norm.length === 0)
                continue;
            rows.push({
                domain: norm,
                backlinks: typeof item.backlinks === 'number' ? item.backlinks : 0,
                domainRank: typeof item.rank === 'number' ? item.rank : null,
                firstSeen: parseVendorDate(item.first_seen),
                lastSeen: parseVendorDate(item.last_visited),
            });
            if (rows.length >= limit)
                break;
        }
        return rows;
    }
    async function getAnchors(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkAnchorRow[]> {
        const target = normalizeBacklinkTarget(domain);
        const limit = clampBacklinkDeepRowLimit(opts.limit);
        const body = {
            target,
            limit,
            include_subdomains: true,
            backlinks_status_type: 'live',
        };
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/anchors/live', [body], anchorsResultSchema, { operation: CTX_ANCHORS.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/anchors/live returned no ok tasks', CTX_ANCHORS);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const rows: BacklinkAnchorRow[] = [];
        for (const item of items) {
            const anchor = clampAnchorText(item.anchor);
            if (anchor.length === 0)
                continue;
            rows.push({
                anchor,
                backlinks: typeof item.backlinks === 'number' ? item.backlinks : 0,
                referringDomains: typeof item.referring_domains === 'number' ? item.referring_domains : 0,
            });
            if (rows.length >= limit)
                break;
        }
        return rows;
    }
    async function getHistory(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkHistoryPoint[]> {
        const target = normalizeBacklinkTarget(domain);
        const limit = clampBacklinkHistoryLimit(opts.limit);
        const body = {
            target,
            include_subdomains: true,
        };
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/history/live', [body], historyResultSchema, { operation: CTX_HISTORY.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/history/live returned no ok tasks', CTX_HISTORY);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const points: BacklinkHistoryPoint[] = [];
        for (const item of items) {
            const ym = extractHistoryYearMonth(item);
            if (ym === null)
                continue;
            points.push({
                year: ym.year,
                month: ym.month,
                backlinks: typeof item.backlinks === 'number' ? item.backlinks : 0,
                referringDomains: typeof item.referring_domains === 'number' ? item.referring_domains : 0,
            });
        }
        // Ascending by (year, month); newest `limit` points win — trim from head.
        points.sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));
        return points.length > limit ? points.slice(points.length - limit) : points;
    }
    async function getBulkRanks(domains: string[]): Promise<BacklinkBulkRankRow[]> {
        const targets = normalizeBulkRankDomains(domains);
        if (targets.length === 0) {
            throw new VendorMalformedError('backlinks/bulk_ranks/live requires at least one domain after normalization', CTX_BULK_RANKS);
        }
        const body = { targets, rank_scale: 'one_hundred' };
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/bulk_ranks/live', [body], bulkRanksResultSchema, { operation: CTX_BULK_RANKS.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/bulk_ranks/live returned no ok tasks', CTX_BULK_RANKS);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const rows: BacklinkBulkRankRow[] = [];
        for (const item of items) {
            const norm = normalizeBacklinkOutputDomain(typeof item.target === 'string' ? item.target : '');
            if (norm.length === 0)
                continue;
            rows.push({
                domain: norm,
                rank: typeof item.rank === 'number' ? item.rank : null,
            });
        }
        return rows;
    }
    async function getBulkSpamScores(inputs: string[]): Promise<BacklinkSpamScoreRow[]> {
        const targets = normalizeBulkSpamScoreTargets(inputs);
        if (targets.length === 0) {
            throw new VendorMalformedError('backlinks/bulk_spam_score/live requires at least one target after normalization', CTX_BULK_SPAM_SCORES);
        }
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/bulk_spam_score/live', [{ targets }], bulkSpamScoresResultSchema, { operation: CTX_BULK_SPAM_SCORES.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/bulk_spam_score/live returned no ok tasks', CTX_BULK_SPAM_SCORES);
        }
        const rows: BacklinkSpamScoreRow[] = [];
        for (const item of outcome.result?.[0]?.items ?? []) {
            const target = normalizeSpamScoreTarget(typeof item.target === 'string' ? item.target : '');
            if (target.length === 0)
                continue;
            rows.push({
                target,
                spamScore: typeof item.spam_score === 'number' ? item.spam_score : null,
            });
        }
        return rows;
    }
    async function getBacklinkCompetitors(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkCompetitorRow[]> {
        const target = normalizeBacklinkTarget(domain);
        const limit = clampBacklinkDeepRowLimit(opts.limit);
        const body = {
            target,
            limit,
            include_subdomains: true,
            rank_scale: 'one_hundred',
        };
        const outcomes = await dataForSeoRequest(cfg, '/backlinks/competitors/live', [body], backlinkCompetitorsResultSchema, { operation: CTX_COMPETITORS.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('backlinks/competitors/live returned no ok tasks', CTX_COMPETITORS);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const rows: BacklinkCompetitorRow[] = [];
        for (const item of items) {
            const rawDomain = typeof item.target === 'string' && item.target.length > 0
                ? item.target
                : typeof item.domain === 'string'
                    ? item.domain
                    : '';
            const norm = normalizeBacklinkOutputDomain(rawDomain);
            if (norm.length === 0)
                continue;
            const intersections = typeof item.backlinks_intersections === 'number'
                ? item.backlinks_intersections
                : typeof item.intersections === 'number'
                    ? item.intersections
                    : 0;
            rows.push({
                domain: norm,
                intersections,
                rank: typeof item.rank === 'number' ? item.rank : null,
            });
            if (rows.length >= limit)
                break;
        }
        return rows;
    }
    return {
        getSummary,
        listBacklinks,
        getReferringDomains,
        getAnchors,
        getHistory,
        getBulkRanks,
        getBulkSpamScores,
        getBacklinkCompetitors,
    };
}
