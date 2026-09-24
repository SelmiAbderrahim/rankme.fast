/**
 * DataForSEO alternative-engine rank adapter.
 *
 * Three operations of the EXISTING rank capability — no new `PROVIDER_*`
 * selector, no new vendor:
 *
 *   bing     → POST /serp/bing/organic/live/advanced        (depth ≤ 10)
 *   youtube  → POST /serp/youtube/organic/live/advanced     (block depth ≤ 20)
 *   amazon   → POST /merchant/amazon/products/task_post     (priority 1, depth ≤ 100)
 *              GET  /merchant/amazon/products/task_get/advanced/{id}
 *
 * Cost envelope (retrieved 2026-08-01): Bing bills per SERP of ≤10 results ($0.002 live), YouTube per
 * SERP of ≤20 blocks ($0.002 live), Merchant Amazon per SERP of ≤100 results
 * ($0.0015 standard, `task_get` reads free). The dearest bounded task is
 * $0.002; `alt_engine_checks` budgets 2_600 µUSD (that + the 30 % request-floor
 * buffer). The depth clamps below are what keeps every check inside ONE billed
 * SERP — raising them silently breaks the unit economics. Amazon's $0.005 Live
 * mode and `priority: 2` are OUT of the envelope and are never issued.
 *
 * Match semantics. Bing returns off-platform web URLs, so it
 * matches the tracked site domain with the SAME host comparison Google uses.
 * YouTube and Amazon do not: every result URL lives on the engine's own host,
 * so a host comparison would match everything or nothing. Those two match an
 * exact `engineTarget` token instead — a channel handle or an ASIN. A row the
 * vendor reports without that token can never match, so an unmatched check is
 * `position: null` ("checked, not found in the bounded depth"), never a guess.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError, VendorUnavailableError } from '../errors.js';
import type { AltEngineRankInput, AltEngineRankResult, AltEngineRankRow, AltRankEngine, } from '../types.js';
import { buildObservationMeta } from '../../observations/observations.js';
import { extractItemHost, normalizeSerpDomain } from './serp.js';
// ---------------------------------------------------------------------------
// Bounded request shapes — one billed SERP per check, per engine
// ---------------------------------------------------------------------------
/** Bing bills per SERP containing up to 10 results. */
export const BING_DEPTH = 10;
/** YouTube bills per SERP containing up to 20 blocks. */
export const YOUTUBE_BLOCK_DEPTH = 20;
/** Merchant Amazon bills per SERP containing up to 100 results. */
export const AMAZON_DEPTH = 100;
/** Amazon normal-priority queue. `2` (high) incurs extra fees — never used. */
export const AMAZON_PRIORITY = 1;
/** Hard ceiling on rows carried back to the caller / cache. */
export const MAX_ALT_ENGINE_ROWS = 100;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 30;
export interface DataForSeoAltEngineProviderConfig extends DataForSeoConfig {
    /** Poll interval for the Amazon task_get loop. Default 2s. */
    pollIntervalMs?: number;
    /** Max Amazon task_get polls before `VendorUnavailableError`. Default 30. */
    maxPollAttempts?: number;
    /** Injection seam for tests. Defaults to setTimeout. */
    wait?: (ms: number) => Promise<void>;
    logger?: Logger;
}
// ---------------------------------------------------------------------------
// Vendor response schemas — permissive + passthrough so vendor drift degrades
// to "fewer rows", never a parse failure that kills a paid check.
// ---------------------------------------------------------------------------
const bingItemSchema = z
    .object({
    type: z.string(),
    rank_group: z.number().int().nullable().optional(),
    rank_absolute: z.number().int().nullable().optional(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
})
    .passthrough();
const youtubeItemSchema = z
    .object({
    type: z.string(),
    rank_group: z.number().int().nullable().optional(),
    rank_absolute: z.number().int().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    channel_id: z.string().nullable().optional(),
    channel_name: z.string().nullable().optional(),
    channel_url: z.string().nullable().optional(),
})
    .passthrough();
const amazonItemSchema = z
    .object({
    type: z.string(),
    rank_group: z.number().int().nullable().optional(),
    rank_absolute: z.number().int().nullable().optional(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    asin: z.string().nullable().optional(),
    data_asin: z.string().nullable().optional(),
})
    .passthrough();
function resultSchemaFor<T extends z.ZodTypeAny>(itemSchema: T) {
    return z
        .array(z
        .object({
        keyword: z.string().optional(),
        se_domain: z.string().optional(),
        location_code: z.number().optional(),
        language_code: z.string().optional(),
        datetime: z.string().optional(),
        items_count: z.number().nullable().optional(),
        items: z.array(itemSchema).nullable().optional(),
    })
        .passthrough())
        .min(1);
}
const bingResultSchema = resultSchemaFor(bingItemSchema);
const youtubeResultSchema = resultSchemaFor(youtubeItemSchema);
const amazonResultSchema = resultSchemaFor(amazonItemSchema);
const amazonTaskPostResultSchema = z.array(z.object({}).passthrough()).nullable().optional();
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit coverage
// ---------------------------------------------------------------------------
/**
 * Canonical YouTube channel token. Prefers the `@handle` segment of
 * `channel_url` (stable, vendor-supplied); falls back to `channel_name`
 * flattened to the same alphabet. `null` = the block exposed no channel, so
 * it can never match a tracked handle.
 */
export function normalizeChannelHandle(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string')
        return null;
    let candidate = raw.trim();
    if (candidate.length === 0)
        return null;
    if (/^https?:\/\//i.test(candidate)) {
        let path: string;
        try {
            path = new URL(candidate).pathname;
        }
        catch {
            // Reachable: `https://` passes the scheme test but has no host, so the
            // WHATWG parser rejects it. A channel we cannot parse can never match.
            return null;
        }
        const segments = path.split('/').filter((s) => s.length > 0);
        const handleSegment = segments.find((s) => s.startsWith('@'));
        // `/channel/UC…` and `/c/Name` forms carry no `@handle`; the id segment is
        // the stable token in that case.
        candidate = handleSegment ?? segments[segments.length - 1] ?? '';
    }
    const flattened = candidate
        .replace(/^@/, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
    return flattened.length === 0 ? null : flattened;
}
/** Canonical ASIN, or `null` when the row exposes none. */
export function normalizeAsin(asin: string | null | undefined, url: string | null | undefined): string | null {
    const direct = typeof asin === 'string' ? asin.trim().toUpperCase() : '';
    if (/^[A-Z0-9]{10}$/.test(direct))
        return direct;
    if (typeof url === 'string') {
        const match = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url);
        if (match?.[1])
            return match[1].toUpperCase();
    }
    return null;
}
/**
 * Pick the position for an engine that matches on `engineTarget`. Exact
 * equality only — the smallest `rankGroup` among rows whose token matches.
 */
export function matchTokenInRows(rows: AltEngineRankRow[], target: string | null): {
    position: number | null;
    foundUrl: string | null;
} {
    if (target === null || target.length === 0)
        return { position: null, foundUrl: null };
    let hit: AltEngineRankRow | null = null;
    for (const row of rows) {
        if (row.matchToken !== target)
            continue;
        if (hit === null || row.rankGroup < hit.rankGroup)
            hit = row;
    }
    return hit === null
        ? { position: null, foundUrl: null }
        : { position: hit.rankGroup, foundUrl: hit.url };
}
/** Host-equality match, shared with the Google path's semantics. */
export function matchHostInRows(rows: AltEngineRankRow[], domain: string): {
    position: number | null;
    foundUrl: string | null;
} {
    const target = normalizeSerpDomain(domain);
    let hit: AltEngineRankRow | null = null;
    for (const row of rows) {
        if (row.domain !== target)
            continue;
        if (hit === null || row.rankGroup < hit.rankGroup)
            hit = row;
    }
    return hit === null
        ? { position: null, foundUrl: null }
        : { position: hit.rankGroup, foundUrl: hit.url };
}
/**
 * Host of a URL we already know is non-empty. `extractItemHost` returns
 * `string | null` because it also accepts absent URLs; every call site here
 * has already dropped those, so this narrows the type without inventing an
 * unreachable fallback host.
 */
function hostOf(url: string): string {
    try {
        return normalizeSerpDomain(new URL(url).hostname);
    }
    catch {
        return normalizeSerpDomain(url);
    }
}
interface RankedItem {
    rank_group?: number | null;
    rank_absolute?: number | null;
}
/** Shared rank extraction: both ordinals must resolve to numbers or the row is dropped. */
function ranksOf(item: RankedItem): {
    rankGroup: number;
    rankAbsolute: number;
} | null {
    const rankGroup = item.rank_group;
    if (typeof rankGroup !== 'number')
        return null;
    const rankAbsolute = item.rank_absolute ?? rankGroup;
    return { rankGroup, rankAbsolute };
}
/** Bing organic rows — same shape and semantics as the Google organic path. */
export function extractBingRows(result: z.infer<typeof bingResultSchema>): AltEngineRankRow[] {
    const rows: AltEngineRankRow[] = [];
    for (const bucket of result) {
        for (const item of bucket.items ?? []) {
            if (item.type !== 'organic')
                continue;
            const ranks = ranksOf(item);
            if (ranks === null)
                continue;
            const url = item.url;
            const domain = item.domain ?? extractItemHost(url);
            if (!url || !domain)
                continue;
            if (rows.length >= MAX_ALT_ENGINE_ROWS)
                break;
            rows.push({
                domain: normalizeSerpDomain(domain),
                url,
                matchToken: null,
                ...ranks,
            });
        }
    }
    return rows;
}
/**
 * YouTube organic rows. ONLY `youtube_video` blocks are emitted — `video_paid`
 * is an ad, and `channel` / `playlist` blocks are not a video ranking, so
 * reporting any of them as an organic position would be a false claim.
 */
export function extractYouTubeRows(result: z.infer<typeof youtubeResultSchema>): AltEngineRankRow[] {
    const rows: AltEngineRankRow[] = [];
    for (const bucket of result) {
        for (const item of bucket.items ?? []) {
            if (item.type !== 'youtube_video')
                continue;
            const ranks = ranksOf(item);
            if (ranks === null)
                continue;
            const url = item.url;
            if (!url)
                continue;
            if (rows.length >= MAX_ALT_ENGINE_ROWS)
                break;
            rows.push({
                domain: hostOf(url),
                url,
                matchToken: normalizeChannelHandle(item.channel_url) ??
                    normalizeChannelHandle(item.channel_name),
                ...ranks,
            });
        }
    }
    return rows;
}
/**
 * Amazon product rows. ONLY `amazon_serp` (organic product) blocks are
 * emitted; `amazon_paid` and merchandising carousels are dropped so a
 * sponsored placement is never reported as an organic rank.
 */
export function extractAmazonRows(result: z.infer<typeof amazonResultSchema>): AltEngineRankRow[] {
    const rows: AltEngineRankRow[] = [];
    for (const bucket of result) {
        for (const item of bucket.items ?? []) {
            if (item.type !== 'amazon_serp')
                continue;
            const ranks = ranksOf(item);
            if (ranks === null)
                continue;
            const url = item.url;
            if (!url)
                continue;
            if (rows.length >= MAX_ALT_ENGINE_ROWS)
                break;
            rows.push({
                domain: normalizeSerpDomain(item.domain ?? hostOf(url)),
                url,
                matchToken: normalizeAsin(item.asin ?? item.data_asin, url),
                ...ranks,
            });
        }
    }
    return rows;
}
// ---------------------------------------------------------------------------
// Input validation — belt-and-braces, so no caller can widen the cost envelope
// ---------------------------------------------------------------------------
const zBingInput = z.object({
    keyword: z.string().min(1).max(700),
    location_code: z.number().int().positive(),
    language_code: z.string().min(2).max(10),
    device: z.enum(['desktop', 'mobile']),
    depth: z.literal(BING_DEPTH),
});
const zYouTubeInput = z.object({
    keyword: z.string().min(1).max(700),
    location_code: z.number().int().positive(),
    language_code: z.string().min(2).max(10),
    block_depth: z.literal(YOUTUBE_BLOCK_DEPTH),
});
const zAmazonInput = z.object({
    keyword: z.string().min(1).max(700),
    location_code: z.number().int().positive(),
    language_code: z.string().min(2).max(10),
    depth: z.literal(AMAZON_DEPTH),
    priority: z.literal(AMAZON_PRIORITY),
});
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
const OPERATION: Record<AltRankEngine, string> = {
    bing: 'alt-engine-bing-organic',
    youtube: 'alt-engine-youtube-organic',
    amazon: 'alt-engine-amazon-products',
};
export function createDataForSeoAltEngineProvider(cfg: DataForSeoAltEngineProviderConfig): {
    checkAltEngineRank(input: AltEngineRankInput): Promise<AltEngineRankResult>;
} {
    const pollIntervalMs = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxPollAttempts = cfg.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    const wait = cfg.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    async function fetchBingRows(input: AltEngineRankInput): Promise<AltEngineRankRow[]> {
        const operation = OPERATION.bing;
        const body = zBingInput.parse({
            keyword: input.keyword,
            location_code: input.locationCode,
            language_code: input.languageCode,
            device: input.device,
            depth: BING_DEPTH,
        });
        const outcomes = await dataForSeoRequest(cfg, '/serp/bing/organic/live/advanced', [body], bingResultSchema, { operation });
        const outcome = outcomes[0];
        if (!outcome) {
            throw new VendorMalformedError('bing organic live returned no tasks', {
                provider: 'dataforseo',
                operation,
            });
        }
        if (outcome.status !== 'ok') {
            throw new VendorUnavailableError('bing organic live did not return a result', {
                provider: 'dataforseo',
                operation,
            });
        }
        return extractBingRows(outcome.result);
    }
    async function fetchYouTubeRows(input: AltEngineRankInput): Promise<AltEngineRankRow[]> {
        const operation = OPERATION.youtube;
        const body = zYouTubeInput.parse({
            keyword: input.keyword,
            location_code: input.locationCode,
            language_code: input.languageCode,
            block_depth: YOUTUBE_BLOCK_DEPTH,
        });
        const outcomes = await dataForSeoRequest(cfg, '/serp/youtube/organic/live/advanced', [body], youtubeResultSchema, { operation });
        const outcome = outcomes[0];
        if (!outcome) {
            throw new VendorMalformedError('youtube organic live returned no tasks', {
                provider: 'dataforseo',
                operation,
            });
        }
        if (outcome.status !== 'ok') {
            throw new VendorUnavailableError('youtube organic live did not return a result', {
                provider: 'dataforseo',
                operation,
            });
        }
        return extractYouTubeRows(outcome.result);
    }
    async function fetchAmazonRows(input: AltEngineRankInput): Promise<AltEngineRankRow[]> {
        const operation = OPERATION.amazon;
        const body = zAmazonInput.parse({
            keyword: input.keyword,
            location_code: input.locationCode,
            language_code: input.languageCode,
            depth: AMAZON_DEPTH,
            priority: AMAZON_PRIORITY,
        });
        const posted = await dataForSeoRequest(cfg, '/merchant/amazon/products/task_post', [body], amazonTaskPostResultSchema, { operation: `${operation}-post` });
        const postOutcome = posted[0];
        if (!postOutcome) {
            throw new VendorMalformedError('amazon products task_post returned no tasks', {
                provider: 'dataforseo',
                operation,
            });
        }
        if (postOutcome.status === 'in_queue') {
            throw new VendorUnavailableError('amazon products task_post reported in_queue', {
                provider: 'dataforseo',
                operation,
            });
        }
        if (!postOutcome.taskId) {
            throw new VendorMalformedError('amazon products task_post missing task id', {
                provider: 'dataforseo',
                operation,
            });
        }
        const taskId = postOutcome.taskId;
        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
            const outcomes = await dataForSeoRequest(cfg, `/merchant/amazon/products/task_get/advanced/${encodeURIComponent(taskId)}`, [], amazonResultSchema, { operation: `${operation}-get`, method: 'GET' });
            const outcome = outcomes[0];
            if (!outcome) {
                throw new VendorMalformedError('amazon products task_get returned no tasks', {
                    provider: 'dataforseo',
                    operation,
                });
            }
            if (outcome.status === 'in_queue') {
                if (attempt === maxPollAttempts - 1)
                    break;
                await wait(pollIntervalMs);
                continue;
            }
            if (outcome.status !== 'ok') {
                throw new VendorMalformedError('amazon products task_get returned unexpected task-level status', { provider: 'dataforseo', operation });
            }
            return extractAmazonRows(outcome.result);
        }
        throw new VendorUnavailableError(`amazon products task_get remained in queue after ${maxPollAttempts} polls`, { provider: 'dataforseo', operation });
    }
    async function checkAltEngineRank(input: AltEngineRankInput): Promise<AltEngineRankResult> {
        const rows = input.engine === 'bing'
            ? await fetchBingRows(input)
            : input.engine === 'youtube'
                ? await fetchYouTubeRows(input)
                : await fetchAmazonRows(input);
        const checkedAt = new Date();
        const matched = input.engine === 'bing'
            ? matchHostInRows(rows, input.domain)
            : matchTokenInRows(rows, input.engineTarget);
        return {
            engine: input.engine,
            position: matched.position,
            foundUrl: matched.foundUrl,
            rows,
            checkedAt,
            observationMeta: buildAltEngineObservationMeta(input.engine, checkedAt, rows.length),
        };
    }
    return { checkAltEngineRank };
}
/**
 * Provenance for one alt-engine check. Amazon always carries the
 * provider-index note so no surface can present the ordinal as a live shelf
 * position; the honesty test in `alt-engines.test.ts` pins that.
 */
export function buildAltEngineObservationMeta(engine: AltRankEngine, observedAt: Date, sampleCount: number) {
    return buildObservationMeta({
        sourceKind: 'provider_observation',
        sourceLabel: 'dataforseo',
        observedAt,
        // `sampleCount` must be ≥1 even for an empty result page: the CHECK itself
        // is the observation, and a zero would read as "nothing was looked at".
        sampleCount: Math.max(1, sampleCount),
        ...(engine === 'amazon'
            ? { coverageNoteKey: 'observations.coverage.providerIndexRanking' as const }
            : {}),
    });
}
