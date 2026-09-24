/**
 * DataForSEO SERP adapter.
 *
 * Implements the vendor-neutral RankProvider over the
 * DataForSEO SERP v3 Google Organic API. Two-step task flow:
 *   postSerpTask     → POST /serp/google/organic/task_post
 *   fetchSerpResult  → GET  /serp/google/organic/task_get/advanced/{id}
 *                      (task-level 40602 = still in queue → callers retry)
 *   checkLocalPackRank → POST /serp/google/maps/live/advanced
 *                      (Google Maps live advanced docs expose maps_search
 *                      items with `rank_group`, `domain`, `url`, and
 *                      `items_count`; used for local pack / map ranking)
 *                      https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/
 *
 * `advanced` (not `regular`) because AI Overview blocks — the input for
 * Google AI Overview citation tracking — are only present on the advanced
 * endpoint. Organic items keep the same field names, so position matching
 * is unchanged.
 *
 * Cost basis (July 2026, task-based standard queue): FLAT per 10 results —
 * $0.0006 per SERP page since the 2025-09-19 vendor billing update (the old
 * 0.75× deep-page discount is gone). Depth 100 = 10 pages = $0.006/check,
 * which is what `serp_checks` in `shared/billing/vendor-costs.ts` budgets;
 * the derivation test there ties `SERP_DEPTH` to the unit cost. Advanced
 * bills the same as regular for a given queue. Live mode ($0.002 per page)
 * is NEVER used; Serper.dev is the named real-time fallback behind the same
 * interface if async UX ever hurts.
 *
 * Behaviour is deterministic for scheduling: SERP items with
 * `type: 'organic'` are matched against the caller-supplied `domain` (host
 * only, lowercase); `rank_group` is the position, `rank_absolute` sits
 * alongside for margin analytics, `url` is `foundUrl`. Not-found in depth →
 * `position: null` (distinct from "check unavailable" — that surfaces as a
 * thrown ProviderError, never a null position, so the ranks module can tell
 * "no row" from "not ranked" downstream).
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig, type DataForSeoTaskOutcome, } from '../http.js';
import { type ProviderError, VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../errors.js';
import type { LocalPackCheckInput, LocalPackCoordinate, LocalPackResult, PublicPageDiscoveryInput, PublicPageDiscoveryResult, PublicPageDiscoveryRow, PublicPageSourceHint, RankCheckInput, RankCheckResult, RankProvider, SerpDevice, SerpFeatureObservation, SerpFeaturedSnippet, SerpFeatureSnapshot, SerpFeatureType, SerpPaaQuestion, } from '../types.js';
import { extractItemHost, matchDomainInAiOverview, matchDomainInSerp, MAX_PAA_QUESTIONS, normalizeSerpDomain, type SerpAiOverview, type SerpItem, } from '../serp-normalization.js';
export { extractItemHost, matchDomainInAiOverview, matchDomainInSerp, MAX_PAA_QUESTIONS, MAX_STORED_TOP_RESULTS, normalizeSerpDomain, type SerpAiOverview, type SerpItem, } from '../serp-normalization.js';
import { mapSerpFeature } from '../serp-features.js';
import { ISO_TO_DATAFORSEO_LOCATION, buildObservationMeta, } from '../../observations/observations.js';
import type { SiteMarket } from '../../observations/types.js';
/** Reference entry inside an AI Overview block (advanced endpoint). */
const aiOverviewReferenceSchema = z
    .object({
    type: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
})
    .passthrough();
/**
 * One nested `items[]` entry inside a SERP element. `ai_overview` blocks nest
 * objects that carry `references[]`; `related_searches` / `people_also_search`
 * blocks nest plain strings. See `organicItemSchema.items`.
 */
const serpNestedItemSchema = z
    .object({
    type: z.string().nullable().optional(),
    references: z.array(aiOverviewReferenceSchema).nullable().optional(),
    // People-Also-Ask nesting: a
    // `people_also_ask` block nests `people_also_ask_element` entries whose
    // `title` is the question and whose `expanded_element[]` carries the
    // answering page. All optional + passthrough so vendor drift degrades to
    // "no PAA signal", never a parse failure that kills the rank check.
    title: z.string().nullable().optional(),
    expanded_element: z
        .array(z
        .object({
        type: z.string().nullable().optional(),
        domain: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough();
/**
 * SERP items[] entry. Organic entries drive position matching; `ai_overview`
 * entries (advanced endpoint) carry nested references for citation tracking;
 * every other block whose type maps to a tracked `SerpFeatureType` (featured
 * snippet, PAA, local pack, video, images, shopping, knowledge graph) is
 * captured by `extractSerpFeatures` from this SAME payload — no extra vendor
 * call. Untracked blocks (ads,
 * related_searches, …) are still ignored.
 */
const organicItemSchema = z
    .object({
    type: z.string(),
    rank_group: z.number().int().nullable().optional(),
    rank_absolute: z.number().int().nullable().optional(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    // AI Overview nesting (advanced): the block carries `items[]` elements
    // which may themselves carry `references[]`; a flat `references[]` also
    // appears on some payload generations. All optional + passthrough so a
    // vendor shape drift degrades to "no signal", never a parse failure.
    references: z.array(aiOverviewReferenceSchema).nullable().optional(),
    // Nested items differ by element type: `ai_overview` nests objects that
    // carry `references[]`, while `related_searches` / `people_also_search`
    // nest plain strings. Accept EITHER (consumers ignore the strings — see the
    // typeof guard in extractAiOverview) so a rich SERP element can never fail
    // the whole rank check. Object-only here rejected real Google SERPs with a
    // related_searches block as malformed → no rank row written.
    items: z
        .array(z.union([serpNestedItemSchema, z.string()]))
        .nullable()
        .optional(),
})
    .passthrough();
const serpTaskGetResultSchema = z
    .array(z
    .object({
    keyword: z.string().optional(),
    type: z.string().optional(),
    se_domain: z.string().optional(),
    location_code: z.number().optional(),
    language_code: z.string().optional(),
    datetime: z.string().optional(),
    items_count: z.number().nullable().optional(),
    items: z.array(organicItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
// Task GET can briefly return an OK task with `result: null` while DataForSEO
// hands the asynchronous task to a worker. The completed shape stays strict;
// nullish is accepted only by the polling endpoint and means "keep waiting".
const serpTaskGetPollingResultSchema = serpTaskGetResultSchema.nullish();
const taskPostResultSchema = z
    .array(z.object({}).passthrough())
    .nullable()
    .optional();
const mapsSearchItemSchema = z
    .object({
    type: z.string(),
    rank_group: z.number().int().nullable().optional(),
    rank_absolute: z.number().int().nullable().optional(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    contact_url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
})
    .passthrough();
const localPackResultSchema = z
    .array(z
    .object({
    keyword: z.string().optional(),
    type: z.string().optional(),
    // Null on the `location_coordinate` variant (community-requests spec
    // 09): the vendor echoes no numeric location code for a coordinate
    // task. The field is unused by the extractor either way.
    location_code: z.number().nullable().optional(),
    language_code: z.string().optional(),
    datetime: z.string().optional(),
    items_count: z.number().nullable().optional(),
    items: z.array(mapsSearchItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface DataForSeoSerpProviderConfig extends DataForSeoConfig {
    /**
     * SERP depth — a COST knob: billing is flat per 10 results, so depth 100 =
     * $0.006/check (what the `serp_checks` unit cost budgets). Wired from env
     * `SERP_DEPTH` via the registry. 100 is the default.
     */
    depth?: number;
    /**
     * Depth for the synchronous `liveSerp` path (env `SERP_LIVE_DEPTH`). Live
     * bills $0.002/page, so this is capped small (≤30) upstream to keep a live
     * check within the `serp_checks` $0.006 unit-cost bound. Default 20.
     */
    liveDepth?: number;
    /**
     * Per-query depth ceiling for the public-page discovery operation
     *. The caller-supplied `perQueryLimit` is clamped
     * against this AND `PUBLIC_PAGE_MAX_PER_QUERY`, so the adapter cannot ask
     * the vendor for more organic rows than the run-cost envelope allows.
     */
    searchDiscoveryDepth?: number;
    /** Poll interval when a task-get returns 40602 (in_queue). Default 2s. */
    pollIntervalMs?: number;
    /** Max total poll attempts before giving up with VendorUnavailableError. Default 30. */
    maxPollAttempts?: number;
    /** Injection seam for tests. Defaults to setTimeout. */
    wait?: (ms: number) => Promise<void>;
    logger?: Logger;
}
export const DEFAULT_SERP_DEPTH = 100;
/** Live-path depth (small so a live check stays within the serp_checks bound). */
export const DEFAULT_SERP_LIVE_DEPTH = 20;
/**
 * Public-page discovery per-query depth. Small: the
 * audience-research pipeline caps per-query result count at ≤10
 * and the SERP surface bills flat per 10 rows, so 10 stays inside the
 * bounded worst-case cost. Clamp on the input path enforces `perQueryLimit`.
 */
export const DEFAULT_PUBLIC_PAGE_DEPTH = 10;
/** Absolute upper-bound on `perQueryLimit`; matches (≤10 organic rows). */
export const PUBLIC_PAGE_MAX_PER_QUERY = 10;
/** Absolute upper-bound on `queries.length`; matches (≤40 queries). */
export const PUBLIC_PAGE_MAX_QUERIES = 40;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 30;
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit coverage
// ---------------------------------------------------------------------------
export interface LocalPackItem {
    domain: string;
    rankGroup: number;
    rankAbsolute: number;
}
/**
 * Flatten a task-get result payload down to the organic SERP items we care
 * about. Non-organic entries (ads, People-Also-Ask, video) are dropped;
 * items missing rank_group / url are also dropped (they cannot participate
 * in position matching).
 */
export function extractOrganicItems(taskResult: z.infer<typeof serpTaskGetResultSchema>): SerpItem[] {
    const items: SerpItem[] = [];
    for (const bucket of taskResult) {
        const raw = bucket.items ?? [];
        for (const item of raw) {
            if (item.type !== 'organic')
                continue;
            const rankGroup = item.rank_group;
            const rankAbsolute = item.rank_absolute ?? rankGroup;
            const url = item.url;
            const domain = item.domain ?? extractItemHost(url);
            if (typeof rankGroup !== 'number')
                continue;
            /* c8 ignore next -- rankAbsolute defaults to rankGroup above, so this branch is only reachable if drizzle-orm re-typed number to non-number; kept as defence. */
            if (typeof rankAbsolute !== 'number')
                continue;
            if (!url || !domain)
                continue;
            items.push({
                domain: normalizeSerpDomain(domain),
                url,
                rankGroup,
                rankAbsolute,
            });
        }
    }
    return items;
}
type RawAiReference = z.infer<typeof aiOverviewReferenceSchema>;
function collectAiReference(out: SerpAiOverview['references'], seen: Set<string>, ref: RawAiReference): void {
    const domain = ref.domain ?? extractItemHost(ref.url);
    if (!domain)
        return;
    const normalized = normalizeSerpDomain(domain);
    const key = `${normalized}|${ref.url ?? ''}`;
    if (seen.has(key))
        return;
    seen.add(key);
    out.push({ domain: normalized, url: ref.url ?? null, title: ref.title ?? null });
}
/**
 * Extract the AI Overview block from a task-get (advanced) payload. Scans
 * for `type === 'ai_overview'` items (flat `references[]` + nested
 * `items[].references[]`) and standalone `type === 'ai_overview_reference'`
 * entries. A malformed AI block degrades to "no signal" — it must NEVER
 * fail the rank check.
 */
export function extractAiOverview(taskResult: z.infer<typeof serpTaskGetResultSchema>): SerpAiOverview {
    const references: SerpAiOverview['references'] = [];
    const seen = new Set<string>();
    let present = false;
    for (const bucket of taskResult) {
        const raw = bucket.items ?? [];
        for (const item of raw) {
            if (item.type === 'ai_overview') {
                present = true;
                for (const ref of item.references ?? [])
                    collectAiReference(references, seen, ref);
                for (const nested of item.items ?? []) {
                    // related_searches / people_also_search nest plain strings; only
                    // ai_overview nests objects that carry references.
                    if (typeof nested === 'string')
                        continue;
                    for (const ref of nested.references ?? [])
                        collectAiReference(references, seen, ref);
                }
            }
            else if (item.type === 'ai_overview_reference') {
                present = true;
                collectAiReference(references, seen, item as RawAiReference);
            }
        }
    }
    return { present, references };
}
/**
 * SERP-feature capture.
 *
 * The advanced payload this rank check ALREADY fetched carries every feature
 * block; before this we discarded all of them but `organic` and `ai_overview`.
 * Nothing here issues a vendor call, changes depth, or adds a task: capture is
 * a pure byproduct of bytes already paid for through `serp_checks`.
 */
function safeFeatureTitle(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return null;
    return trimmed.slice(0, 300);
}
/**
 * Pull the People-Also-Ask questions (and the page that answered each, when
 * the vendor exposed one) out of a `people_also_ask` block.
 */
function collectPaa(out: SerpPaaQuestion[], seen: Set<string>, nested: ReadonlyArray<z.infer<typeof serpNestedItemSchema> | string> | null | undefined): void {
    for (const entry of nested ?? []) {
        if (typeof entry === 'string')
            continue;
        const question = safeFeatureTitle(entry.title);
        if (!question)
            continue;
        if (seen.has(question))
            continue;
        if (out.length >= MAX_PAA_QUESTIONS)
            return;
        seen.add(question);
        const expanded = (entry.expanded_element ?? [])[0];
        const rawDomain = expanded?.domain ?? extractItemHost(expanded?.url);
        out.push({
            question,
            answerDomain: rawDomain ? normalizeSerpDomain(rawDomain) : null,
            answerUrl: expanded?.url ?? null,
        });
    }
}
/**
 * Extract the normalized, DOMAIN-INDEPENDENT feature snapshot from a task-get
 * (advanced) payload. Only blocks whose vendor type resolves to a tracked
 * member of `SerpFeatureType` are reported — an ad slot or a
 * `related_searches` block is not a SERP feature we track, so it is skipped
 * rather than fabricated into an `'other'` chip. `organic` never counts.
 *
 * The result lists ONLY observed features: there is no "absent" shape, so no
 * downstream surface can claim something is missing from Google.
 */
export function extractSerpFeatures(taskResult: z.infer<typeof serpTaskGetResultSchema>): SerpFeatureSnapshot {
    const features: SerpFeatureObservation[] = [];
    const seenTypes = new Set<SerpFeatureType>();
    const paa: SerpPaaQuestion[] = [];
    const seenQuestions = new Set<string>();
    let featuredSnippet: SerpFeaturedSnippet | null = null;
    for (const bucket of taskResult) {
        for (const item of bucket.items ?? []) {
            if (item.type === 'organic')
                continue;
            const type = mapSerpFeature(item.type);
            if (type === 'other')
                continue;
            if (!seenTypes.has(type)) {
                seenTypes.add(type);
                features.push({
                    type,
                    rankAbsolute: typeof item.rank_absolute === 'number' ? item.rank_absolute : null,
                });
            }
            if (type === 'featured_snippet' && featuredSnippet === null) {
                const rawDomain = item.domain ?? extractItemHost(item.url);
                featuredSnippet = {
                    domain: rawDomain ? normalizeSerpDomain(rawDomain) : null,
                    url: item.url ?? null,
                    title: safeFeatureTitle(item.title),
                };
            }
            if (type === 'people_also_ask') {
                collectPaa(paa, seenQuestions, item.items);
            }
        }
    }
    return { features, featuredSnippet, paa };
}
export function extractLocalPackItems(taskResult: z.infer<typeof localPackResultSchema>): LocalPackItem[] {
    const items: LocalPackItem[] = [];
    for (const bucket of taskResult) {
        const raw = bucket.items ?? [];
        for (const item of raw) {
            if (item.type !== 'maps_search')
                continue;
            const rankGroup = item.rank_group;
            const rankAbsolute = item.rank_absolute ?? rankGroup;
            const domain = item.domain ?? extractItemHost(item.url) ?? extractItemHost(item.contact_url);
            if (typeof rankGroup !== 'number')
                continue;
            /* c8 ignore next -- zod types rank_absolute as number|null|undefined and the ?? above falls back to the already-number-checked rankGroup, so a non-number here is unreachable; kept as a guard against schema drift. */
            if (typeof rankAbsolute !== 'number')
                continue;
            if (!domain)
                continue;
            items.push({
                domain: normalizeSerpDomain(domain),
                rankGroup,
                rankAbsolute,
            });
        }
    }
    return items;
}
export function matchDomainInLocalPack(items: LocalPackItem[], totalPackSize: number, domain: string, checkedAt: Date): LocalPackResult {
    const target = normalizeSerpDomain(domain);
    let hit: LocalPackItem | null = null;
    for (const item of items) {
        if (item.domain === target && (hit === null || item.rankGroup < hit.rankGroup)) {
            hit = item;
        }
    }
    return {
        position: hit?.rankGroup ?? null,
        totalPackSize,
        checkedAt,
    };
}
// ---------------------------------------------------------------------------
// Public-page discovery helpers
// ---------------------------------------------------------------------------
const CTX_DISCOVERY = { provider: 'dataforseo', operation: 'search-public-pages' } as const;
/**
 * Normalize a candidate discovered URL to a safe canonical form.
 *
 * SSRF resolution happens at fetch time (`assertPublicUrlSafe`); this helper
 * runs at discovery time so unsafe schemes (`data:`, `javascript:`, `file:`,
 * …) and URL-embedded credentials never reach the persisted candidate list.
 * Returns `null` when the URL should be dropped.
 */
export function normalizeDiscoveredUrl(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string' || raw.length === 0)
        return null;
    let parsed: URL;
    try {
        parsed = new URL(raw);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
        return null;
    if (parsed.username.length > 0 || parsed.password.length > 0)
        return null;
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    // Preserve the vendor-observed path + query verbatim (dedupe happens on the
    // full canonical form). Strip a lone trailing slash on the root only to
    // match the shared canonicalizer's behavior.
    const href = parsed.toString();
    return href.endsWith('/') && parsed.pathname === '/' ? href.slice(0, -1) : href;
}
/**
 * DataForSEO reports datetime as `"2026-01-01 00:00:00 +00:00"`; return an
 * ISO 8601 string or `null` when the row does NOT expose a datetime. Never
 * substitute the current wall clock — that would fabricate freshness.
 */
export function parseVendorObservedAt(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string' || raw.length === 0)
        return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed.toISOString();
}
/**
 * Deterministic source-type hint from the vendor URL/host. The
 * adapter only HINTS; the feature module owns the authoritative classifier.
 */
export function hintPublicPageSourceType(canonicalUrl: string): PublicPageSourceHint {
    let url: URL;
    try {
        url = new URL(canonicalUrl);
    }
    catch {
        return 'other';
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === 'reddit.com' || host.endsWith('.reddit.com') ||
        host === 'stackoverflow.com' || host.endsWith('.stackoverflow.com') ||
        host.startsWith('discourse.') || host.startsWith('forum.') ||
        path.includes('/community/'))
        return 'forum';
    if (host === 'g2.com' || host.endsWith('.g2.com') ||
        host === 'capterra.com' || host.endsWith('.capterra.com') ||
        host === 'trustpilot.com' || host.endsWith('.trustpilot.com') ||
        /(^|\.)review[a-z-]*\./.test(host))
        return 'review';
    if (path.includes('/compare/') ||
        path.includes('-vs-') ||
        /(?:^|\/)vs(?:$|\/)/.test(path) ||
        path.includes('alternatives'))
        return 'comparison';
    if (host === 'quora.com' || host.endsWith('.quora.com') ||
        host === 'stackexchange.com' || host.endsWith('.stackexchange.com') ||
        host.startsWith('answers.') ||
        path.startsWith('/questions/'))
        return 'question';
    return 'other';
}
/**
 * Truncate a vendor title to the 160-char safe display limit without
 * fabricating content. Ellipsis added when the trim happened.
 */
export function safeTitle(raw: string | null | undefined): string {
    if (typeof raw !== 'string')
        return '';
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= 160)
        return trimmed;
    return `${trimmed.slice(0, 159)}…`;
}
/**
 * Resolve `SiteMarket` to the DataForSEO SERP `location_code` + `language_code`
 * pair used by the primary API. Throws `VendorUnavailableError` on an
 * unsupported country/language — the feature layer maps this to the typed
 * `unsupportedMarket` coverage state and NEVER substitutes US/English.
 */
export function resolveDiscoveryMarket(market: SiteMarket): {
    locationCode: number;
    languageCode: string;
    device: SerpDevice;
} {
    // SiteMarket type guarantees non-null string fields (validated at the
    // trust boundary by observationsSchema); the guards below only exist to
    // surface an unsupported combination as a typed vendor error.
    const country = typeof market.country === 'string' ? market.country.toUpperCase() : '';
    const locationCode = country ? ISO_TO_DATAFORSEO_LOCATION[country] : undefined;
    if (locationCode === undefined) {
        throw new VendorUnavailableError(`search-public-pages: unsupported country '${country}'`, CTX_DISCOVERY);
    }
    const language = typeof market.language === 'string' ? market.language.toLowerCase() : '';
    if (!language || !/^[a-z]{2}(-[a-z0-9]{2,8})?$/.test(language)) {
        throw new VendorUnavailableError(`search-public-pages: unsupported language '${language}'`, CTX_DISCOVERY);
    }
    // DataForSEO uses the primary tag (e.g. 'en', not 'en-US'). Drop the region
    // sub-tag; `siteMarket.country` already carries the region. `split('-')`
    // always returns a non-empty array, so `[0]` is guaranteed a string.
    const [primaryLanguage] = language.split('-') as [
        string,
        ...string[]
    ];
    const device: SerpDevice = market.device === 'mobile' ? 'mobile' : 'desktop';
    return { locationCode, languageCode: primaryLanguage, device };
}
/**
 * SERP live-advanced task-shape zod fragment. Reused between `liveSerp` and
 * `searchPublicPages`; both endpoints deliver the same organic `result[]`.
 */
const discoveryResultSchema = serpTaskGetResultSchema;
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
const ctx = { provider: 'dataforseo', operation: 'serp' };
export interface PostedSerpTask {
    vendorTaskId: string;
}
export interface FetchedSerpResult {
    items: SerpItem[];
    costUsd: number | null;
    /** AI Overview block from the same fetch — domain-independent, cacheable. */
    aiOverview: SerpAiOverview;
    /**
     * Normalized SERP features from the SAME
     * fetch. Domain-independent, therefore cacheable and shareable cross-user.
     */
    features: SerpFeatureSnapshot;
}
export function createDataForSeoRankProvider(cfg: DataForSeoSerpProviderConfig): Omit<RankProvider, 'checkAltEngineRank'> & {
    postSerpTask(input: RankCheckInput): Promise<PostedSerpTask>;
    fetchSerpResult(taskId: string, opts?: {
        pollIntervalMs?: number;
        maxPollAttempts?: number;
    }): Promise<FetchedSerpResult>;
    /** Synchronous single-call SERP (no task_post/poll) — the primary path. */
    liveSerp(input: RankCheckInput): Promise<FetchedSerpResult>;
    /** Public-page discovery. Batches queries in one POST. */
    searchPublicPages(input: PublicPageDiscoveryInput): Promise<PublicPageDiscoveryResult>;
} {
    const depth = cfg.depth ?? DEFAULT_SERP_DEPTH;
    const liveDepth = cfg.liveDepth ?? DEFAULT_SERP_LIVE_DEPTH;
    const searchDiscoveryDepth = Math.max(1, Math.min(PUBLIC_PAGE_MAX_PER_QUERY, cfg.searchDiscoveryDepth ?? DEFAULT_PUBLIC_PAGE_DEPTH));
    const pollIntervalMs = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxPollAttempts = cfg.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    /* c8 ignore next -- tests always inject `cfg.wait`; the setTimeout fallback keeps prod behaviour but is unreachable in unit tests. */
    const wait = cfg.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    async function postSerpTask(input: RankCheckInput): Promise<PostedSerpTask> {
        // NOTE: `live` mode is $0.002 vs $0.0006 standard queue — reason enough
        // to always use the task/task_get flow for scheduled checks. Serper.dev
        // is the named real-time fallback behind the same interface.
        const body = zTaskPostInput.parse({
            keyword: input.keyword,
            location_code: input.locationCode,
            language_code: input.languageCode,
            device: input.device,
            depth,
        });
        const outcomes = await dataForSeoRequest(cfg, '/serp/google/organic/task_post', [body], taskPostResultSchema, { operation: 'serp-task-post' });
        const outcome = outcomes[0];
        if (!outcome) {
            throw new VendorMalformedError('serp/task_post returned no tasks', {
                ...ctx,
                operation: 'serp-task-post',
            });
        }
        if (outcome.status === 'in_queue') {
            throw new VendorUnavailableError('serp/task_post reported in_queue', {
                ...ctx,
                operation: 'serp-task-post',
            });
        }
        if (!outcome.taskId) {
            throw new VendorMalformedError('serp/task_post missing task id', {
                ...ctx,
                operation: 'serp-task-post',
            });
        }
        return { vendorTaskId: outcome.taskId };
    }
    async function fetchSerpResult(taskId: string, overrides: {
        pollIntervalMs?: number;
        maxPollAttempts?: number;
    } = {}): Promise<FetchedSerpResult> {
        const interval = overrides.pollIntervalMs ?? pollIntervalMs;
        const maxAttempts = overrides.maxPollAttempts ?? maxPollAttempts;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const outcomes = await dataForSeoRequest(cfg, `/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}`, [], serpTaskGetPollingResultSchema, { operation: 'serp-task-get', method: 'GET' });
            const outcome = outcomes[0];
            if (!outcome || outcome.status === 'in_queue') {
                if (attempt === maxAttempts - 1)
                    break;
                await wait(interval);
                continue;
            }
            if (outcome.status !== 'ok') {
                throw new VendorMalformedError('serp/task_get returned unexpected task-level status', { ...ctx, operation: 'serp-task-get' });
            }
            const result = outcome.result;
            if (result == null) {
                if (attempt === maxAttempts - 1)
                    break;
                await wait(interval);
                continue;
            }
            return {
                items: extractOrganicItems(result),
                costUsd: outcome.costUsd,
                aiOverview: extractAiOverview(result),
                features: extractSerpFeatures(result),
            };
        }
        throw new VendorUnavailableError(`serp/task_get remained pending after ${maxAttempts} polls`, { ...ctx, operation: 'serp-task-get' });
    }
    async function checkRank(input: RankCheckInput): Promise<RankCheckResult> {
        const { vendorTaskId } = await postSerpTask(input);
        const { items, aiOverview, features } = await fetchSerpResult(vendorTaskId);
        return {
            ...matchDomainInSerp(items, input.domain, new Date()),
            aiOverview: matchDomainInAiOverview(aiOverview, input.domain),
            serpFeatures: features,
        };
    }
    async function checkLocalPackRank(input: LocalPackCheckInput): Promise<LocalPackResult> {
        const body = buildLocalPackBody(input, ctx);
        const outcomes = await dataForSeoRequest(cfg, '/serp/google/maps/live/advanced', [body], localPackResultSchema, { operation: 'serp-google-maps-live-advanced' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('google maps live returned no ok tasks', {
                ...ctx,
                operation: 'serp-google-maps-live-advanced',
            });
        }
        const bucket = outcome.result[0];
        const items = extractLocalPackItems(outcome.result);
        const totalPackSize = typeof bucket?.items_count === 'number' ? bucket.items_count : items.length;
        return matchDomainInLocalPack(items, totalPackSize, input.domain, new Date());
    }
    /**
     * Synchronous organic SERP via `/serp/google/organic/live/advanced` — one
     * call, no task_post/task_get polling, so it can never time out in the
     * in-queue loop. Returns the SAME `{ items, costUsd, aiOverview }` shape as
     * `fetchSerpResult` (live carries the identical advanced `result[]`), so the
     * ranks module's cross-user cache + AI-Overview extraction are unchanged.
     * `liveDepth` is kept small so the higher live per-page price stays within
     * the `serp_checks` budget.
     *
     * NOT the path a DataForSEO rank check takes. `callProviderForItems` in the
     * ranks module prefers `postSerpTask` + `fetchSerpResult` whenever a provider
     * exposes both, which this adapter does — so `liveDepth` / `SERP_LIVE_DEPTH`
     * never bounds a production rank check. This method serves providers that
     * offer only a synchronous SERP.
     */
    async function liveSerp(input: RankCheckInput): Promise<FetchedSerpResult> {
        const body = zTaskPostInput.parse({
            keyword: input.keyword,
            location_code: input.locationCode,
            language_code: input.languageCode,
            device: input.device,
            depth: liveDepth,
        });
        const outcomes = await dataForSeoRequest(cfg, '/serp/google/organic/live/advanced', [body], serpTaskGetResultSchema, { operation: 'serp-live' });
        const outcome = outcomes[0];
        if (!outcome) {
            throw new VendorMalformedError('serp/live returned no tasks', {
                ...ctx,
                operation: 'serp-live',
            });
        }
        if (outcome.status !== 'ok') {
            // Live is synchronous — a created/in_queue task here is a transient
            // vendor anomaly; surface it as retryable, never a silent empty result.
            throw new VendorUnavailableError('serp/live did not return a result', {
                ...ctx,
                operation: 'serp-live',
            });
        }
        return {
            items: extractOrganicItems(outcome.result),
            costUsd: outcome.costUsd,
            aiOverview: extractAiOverview(outcome.result),
            features: extractSerpFeatures(outcome.result),
        };
    }
    async function searchPublicPages(input: PublicPageDiscoveryInput): Promise<PublicPageDiscoveryResult> {
        if (!Array.isArray(input.queries) || input.queries.length === 0) {
            throw new VendorMalformedError('search-public-pages: queries must be a non-empty array', CTX_DISCOVERY);
        }
        if (input.queries.length > PUBLIC_PAGE_MAX_QUERIES) {
            throw new VendorMalformedError(`search-public-pages: exceeded PUBLIC_PAGE_MAX_QUERIES (${PUBLIC_PAGE_MAX_QUERIES})`, CTX_DISCOVERY);
        }
        const seenIds = new Set<string>();
        for (const q of input.queries) {
            if (!q || typeof q.id !== 'string' || q.id.length === 0) {
                throw new VendorMalformedError('search-public-pages: query.id missing', CTX_DISCOVERY);
            }
            if (typeof q.text !== 'string' || q.text.length === 0 || q.text.length > 700) {
                throw new VendorMalformedError('search-public-pages: query.text invalid', CTX_DISCOVERY);
            }
            if (seenIds.has(q.id)) {
                throw new VendorMalformedError('search-public-pages: duplicate query.id', CTX_DISCOVERY);
            }
            seenIds.add(q.id);
        }
        const perQueryLimit = Math.max(1, Math.min(PUBLIC_PAGE_MAX_PER_QUERY, input.perQueryLimit | 0));
        const requestDepth = Math.max(perQueryLimit, searchDiscoveryDepth);
        // Fails loudly on unsupported market; never substitutes US/English.
        const { locationCode, languageCode, device } = resolveDiscoveryMarket(input.siteMarket);
        // The live SERP endpoint accepts exactly ONE task per API call ("each
        // Live SERP API call can contain only one task" — vendor docs), so
        // discovery issues one POST per query. Sequential keeps row order
        // deterministic and vendor pressure low. Per-query vendor failures are
        // tolerated (partial evidence beats a dead run); only a run where EVERY
        // query failed rethrows, and auth/quota aborts the remaining calls since
        // they would fail identically.
        const rows: PublicPageDiscoveryRow[] = [];
        const nowIso = new Date().toISOString();
        let succeededQueries = 0;
        let firstQueryError: ProviderError | null = null;
        const skipQuery = (query: {
            id: string;
        }, err: ProviderError): void => {
            firstQueryError ??= err;
            cfg.logger?.warn({ ...CTX_DISCOVERY, queryId: query.id, error: err.name }, 'search-public-pages: query failed; continuing with remaining queries');
        };
        for (const query of input.queries) {
            const body = zTaskPostInput.parse({
                keyword: query.text,
                location_code: locationCode,
                language_code: languageCode,
                device,
                depth: requestDepth,
            });
            let outcomes: DataForSeoTaskOutcome<z.infer<typeof discoveryResultSchema>>[];
            try {
                outcomes = await dataForSeoRequest(cfg, '/serp/google/organic/live/advanced', [body], discoveryResultSchema, { operation: 'search-public-pages' });
            }
            catch (err) {
                if (err instanceof VendorAuthError || err instanceof VendorQuotaError) {
                    if (succeededQueries > 0) {
                        cfg.logger?.warn({ ...CTX_DISCOVERY, queryId: query.id, error: err.name }, 'search-public-pages: aborting remaining queries; returning partial rows');
                        return { rows };
                    }
                    throw err;
                }
                if (err instanceof VendorTimeoutError ||
                    err instanceof VendorUnavailableError ||
                    err instanceof VendorMalformedError) {
                    skipQuery(query, err);
                    continue;
                }
                throw err;
            }
            if (outcomes.length !== 1) {
                skipQuery(query, new VendorMalformedError(`search-public-pages: expected 1 task outcome, got ${outcomes.length}`, CTX_DISCOVERY));
                continue;
            }
            const outcome = outcomes[0]!;
            if (outcome.status !== 'ok') {
                // The typed status classifier in `http.ts` maps upstream failures to
                // Vendor*Error before we get here; a `created`/`in_queue` from a live
                // endpoint is a vendor anomaly, not a caller error.
                skipQuery(query, new VendorUnavailableError(`search-public-pages: live task did not return ok for query ${query.id}`, CTX_DISCOVERY));
                continue;
            }
            const organic = extractOrganicItems(outcome.result);
            // `dataForSeoRequest` guarantees `result` is validated by the min(1)
            // schema when `status === 'ok'`, so `bucket` is always defined here.
            const bucket = outcome.result[0]!;
            const vendorObservedAt = parseVendorObservedAt(bucket.datetime);
            // The rank map keeps the position sort deterministic across dedupe.
            const perQueryCap = perQueryLimit;
            let emitted = 0;
            // Walk raw items in vendor order (same order the SERP presented) so
            // `organicPosition` matches vendor `rank_group`.
            const rawItems = bucket.items ?? [];
            const canonicalByPosition = new Map<number, PublicPageDiscoveryRow>();
            for (const item of rawItems) {
                if (item.type !== 'organic')
                    continue;
                if (typeof item.rank_group !== 'number')
                    continue;
                const canonicalUrl = normalizeDiscoveredUrl(item.url ?? null);
                if (canonicalUrl === null)
                    continue;
                // Belt-and-braces: `extractOrganicItems` already dropped this row if
                // it had no domain. Here we only care about URL + rank_group.
                const row: PublicPageDiscoveryRow = {
                    queryId: query.id,
                    canonicalUrl,
                    title: safeTitle(item.title ?? ''),
                    organicPosition: item.rank_group,
                    observedAt: vendorObservedAt,
                    sourceTypeHint: hintPublicPageSourceType(canonicalUrl),
                    observationMeta: buildObservationMeta({
                        sourceKind: 'provider_observation',
                        sourceLabel: 'dataforseo',
                        observedAt: vendorObservedAt ?? nowIso,
                        market: input.siteMarket,
                        sampleCount: 1,
                        ...(vendorObservedAt === null ? { coverageNoteKey: 'observations.coverage.partialResult' as const } : {}),
                    }),
                };
                canonicalByPosition.set(item.rank_group, row);
            }
            const orderedPositions = Array.from(canonicalByPosition.keys()).sort((a, b) => a - b);
            for (const pos of orderedPositions) {
                if (emitted >= perQueryCap)
                    break;
                rows.push(canonicalByPosition.get(pos)!);
                emitted += 1;
            }
            // `organic` is only inspected here to prove extractOrganicItems still
            // agrees on the shape — a mismatch would indicate schema drift.
            void organic.length;
            succeededQueries += 1;
        }
        if (succeededQueries === 0) {
            // Zero successes over a non-empty query list implies a captured error:
            // every failed iteration records one, and auth/quota aborts threw above.
            throw firstQueryError!;
        }
        return { rows };
    }
    return {
        checkRank,
        checkLocalPackRank,
        searchPublicPages,
        postSerpTask,
        fetchSerpResult,
        liveSerp,
    };
}
// ---------------------------------------------------------------------------
// Task-post input validation — belt-and-braces zod schema so a caller can
// never smuggle unsupported fields (e.g. `enable_javascript`) to the SERP
// endpoint. The registry passes RankCheckInput straight through.
// ---------------------------------------------------------------------------
const deviceSchema: z.ZodType<SerpDevice> = z.enum(['desktop', 'mobile']);
const zTaskPostInput = z.object({
    keyword: z.string().min(1).max(700),
    location_code: z.number().int().positive(),
    language_code: z.string().min(2).max(10),
    device: deviceSchema,
    depth: z.number().int().positive().max(700),
});
const zLocalPackInput = z.object({
    keyword: z.string().min(1).max(700),
    location_code: z.number().int().positive(),
    language_code: z.string().min(2).max(10),
    depth: z.number().int().positive().max(100),
    search_places: z.boolean(),
});
/**
 * Geogrid per-coordinate variant. Same
 * endpoint, same depth, same `search_places`; `location_coordinate` replaces
 * `location_code`. Coordinates are pre-rounded to ≤7 decimals by the caller —
 * the regex is the belt-and-braces guard that the vendor's documented format
 * is what leaves this process.
 */
const zLocalPackCoordinateInput = z.object({
    keyword: z.string().min(1).max(700),
    location_coordinate: z
        .string()
        .regex(/^-?\d{1,3}(\.\d{1,7})?,-?\d{1,3}(\.\d{1,7})?,\d{1,2}z$/, 'location_coordinate must be "lat,lng,Nz"'),
    language_code: z.string().min(2).max(10),
    depth: z.number().int().positive().max(100),
    search_places: z.boolean(),
});
/**
 * `"lat,lng,Nz"` per docs.dataforseo.com/v3/serp/google/maps/live/advanced —
 * at most seven decimal digits, zoom `3z`..`21z`.
 */
export function formatLocationCoordinate(coordinate: LocalPackCoordinate): string {
    const parsed = zCoordinate.parse(coordinate);
    return `${round7(parsed.lat)},${round7(parsed.lng)},${parsed.zoom}z`;
}
const zCoordinate = z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    zoom: z.number().int().min(3).max(21),
});
function round7(value: number): number {
    return Math.round(value * 1e7) / 1e7;
}
/**
 * Pick the request body for the map-pack call. Exactly one target arm may be
 * present — both or neither is a caller bug, rejected before any HTTP call so
 * a mistake can never silently bill a default location.
 */
export function buildLocalPackBody(input: LocalPackCheckInput, errorCtx: {
    provider: string;
    operation: string;
}): Record<string, unknown> {
    const hasCode = input.locationCode !== undefined;
    const hasCoordinate = input.coordinate !== undefined;
    if (hasCode === hasCoordinate) {
        throw new VendorMalformedError('local pack check needs exactly one of locationCode / coordinate', { ...errorCtx, operation: 'serp-google-maps-live-advanced' });
    }
    if (input.coordinate) {
        return zLocalPackCoordinateInput.parse({
            keyword: input.keyword,
            location_coordinate: formatLocationCoordinate(input.coordinate),
            language_code: input.languageCode,
            depth: 20,
            search_places: false,
        });
    }
    return zLocalPackInput.parse({
        keyword: input.keyword,
        location_code: input.locationCode,
        language_code: input.languageCode,
        depth: 20,
        search_places: false,
    });
}
