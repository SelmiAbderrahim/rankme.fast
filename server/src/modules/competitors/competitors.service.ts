/**
 * Competitors service.
 *
 * Ownership check via `Site.findOne({ _id, accountId })` — cross-account
 * lookups 404. Fresh fetches persist a per-day snapshot; a repeat call on
 * the same calendar day updates the existing row instead of appending
 * (enforced at the service layer — see the schema note in
 * `db/schema/competitors.ts` for why the daily-uniqueness constraint is
 * NOT a DB index).
 *
 * Cost control: both `listCompetitors` and `getIntersection` serve a
 * same-UTC-day cached row without a fresh DataForSEO Labs call.
 *
 * Provider failures never persist; they surface as a localized `unavailable`
 * HttpError so the audit / rank / report flows stay green.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { CompetitorEntry, CompetitorProvider, DomainComparisonRow, DomainIntersectionRow, TechStackEntry, } from '../../shared/providers/index.js';
import { ProviderError, SERP_COMPETITORS_MAX_KEYWORDS, normalizeCompetitorDomain, normalizeSerpKeywords, stripWwwPrefix, } from '../../shared/providers/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import type { Db } from '../../db/client.js';
import { competitors, competitorIntersections, type CompetitorSource, } from '../../db/schema/competitors.js';
import { keywords } from '../../db/schema/keywords.js';
import type { Cooldown } from '../../shared/cooldown/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
export interface CompetitorPayload {
    domain: string;
    avgPosition: number | null;
    intersections: number;
    estimatedTraffic: string | null;
    fetchedAt: string;
}
export interface CompetitorsListPayload {
    competitors: CompetitorPayload[];
    fetchedAt: string;
    target: string;
    /**
     * Which vendor signal produced the rows: 'domain' = the target's own
     * ranked-keyword footprint; 'tracked_keywords' = SERP analysis of the
     * site's tracked keywords (fallback for low-visibility domains).
     */
    source: CompetitorSource;
}
export interface IntersectionPayload {
    target: string;
    competitor: string;
    keywords: DomainIntersectionRow[];
    fetchedAt: string;
}
export interface TechStackPayload {
    target: string;
    competitor: string;
    techStack: TechStackEntry[];
    fetchedAt: string;
}
export interface CompetitorsServiceDeps {
    db: Db;
    provider: CompetitorProvider;
    now?: () => Date;
}
export interface RefreshCompetitorsDeps extends CompetitorsServiceDeps {
    cooldown: Cooldown;
}
function isValidObjectId(id: string): boolean {
    return Types.ObjectId.isValid(id);
}
async function loadOwnedSite(accountId: string, siteId: string): Promise<{
    id: string;
    domain: string;
    paused: boolean;
}> {
    if (!isValidObjectId(siteId)) {
        throw HttpError.notFound({ code: 'COMPETITORS_ERRORS_SITE_NOT_FOUND', messageKey: 'competitors.errors.siteNotFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'COMPETITORS_ERRORS_SITE_NOT_FOUND', messageKey: 'competitors.errors.siteNotFound' });
    return {
        id: (site._id as Types.ObjectId).toString(),
        domain: site.domain,
        paused: site.paused,
    };
}
function wrapProviderError(err: unknown): never {
    if (err instanceof ProviderError) {
        throw new HttpError(503, { code: 'COMPETITORS_ERRORS_UNAVAILABLE', messageKey: 'competitors.errors.unavailable' }, undefined, { cause: err });
    }
    throw err;
}
/** Serialize numeric fields (postgres NUMERIC → string in JS) safely. */
function numericToString(n: number | null): string | null {
    return n === null ? null : n.toString();
}
/** Start of the calendar day (UTC) for the given instant. */
function startOfDayUtc(d: Date): Date {
    const copy = new Date(d.getTime());
    copy.setUTCHours(0, 0, 0, 0);
    return copy;
}
function endOfDayUtc(d: Date): Date {
    const copy = new Date(d.getTime());
    copy.setUTCHours(23, 59, 59, 999);
    return copy;
}
/**
 * The shared vendor-cache row expires at UTC midnight — the global analogue
 * of the per-account "one Labs call per key per UTC day" semantic.
 */
function msUntilNextUtcMidnight(now: Date): number {
    return endOfDayUtc(now).getTime() + 1 - now.getTime();
}
// One in-process gate shared across requests — concurrent misses on the same
// (domain, location, language) make exactly one vendor call.
const singleFlight = createSingleFlight();
function vendorLayer(db: Db) {
    const repo = createVendorCacheRepo(db);
    return createReadThrough({ repo, singleFlight });
}
const competitorEntriesSchema = z.array(z.object({
    domain: z.string(),
    avgPosition: z.number().nullable(),
    intersections: z.number(),
    estimatedTraffic: z.number().nullable(),
}));
const intersectionRowsSchema = z.array(z.object({
    keyword: z.string(),
    target1Position: z.number().nullable(),
    target2Position: z.number().nullable(),
    searchVolume: z.number().nullable(),
    class: z.literal('missing').optional(),
    target1Url: z.string().url().nullable().optional(),
    target2Url: z.string().url().nullable().optional(),
    provenance: z
        .object({
        provider: z.string().min(1).max(64),
        operation: z.literal('domain_intersection_live'),
        leg: z.literal('competitor_only'),
        intersections: z.literal(false),
        targetOrder: z.literal('competitor_owned'),
        itemTypes: z.tuple([z.literal('organic')]),
        limit: z.literal(100),
        cache: z.enum(['hit', 'miss']),
        status: z.literal('success'),
        capturedAt: z.string().datetime().nullable(),
        returnedRows: z.number().int().min(0).max(100),
        truncated: z.boolean(),
    })
        .optional(),
}));
function correctedIntersectionRows(rows: readonly DomainComparisonRow[], cache: 'hit' | 'miss'): DomainIntersectionRow[] {
    const returnedRows = Math.min(rows.length, 100);
    return rows.slice(0, 100).map((row) => ({
        keyword: row.keyword,
        target1Position: null,
        target2Position: row.competitorPosition,
        searchVolume: row.searchVolume,
        class: 'missing',
        target1Url: null,
        target2Url: row.competitorUrl,
        provenance: {
            provider: row.observationMeta.sourceLabel ?? 'dataforseo',
            operation: 'domain_intersection_live',
            leg: 'competitor_only',
            intersections: false,
            targetOrder: 'competitor_owned',
            itemTypes: ['organic'],
            limit: 100,
            cache,
            status: 'success',
            capturedAt: row.observationMeta.observedAt,
            returnedRows,
            truncated: rows.length > 100,
        },
    }));
}
function publicIntersectionRows(rows: readonly DomainIntersectionRow[], cache: 'hit' | 'miss'): DomainIntersectionRow[] {
    const returnedRows = Math.min(rows.length, 100);
    return rows.slice(0, 100).map((row) => ({
        ...row,
        target1Position: null,
        class: 'missing',
        target1Url: null,
        target2Url: row.target2Url ?? null,
        provenance: row.provenance
            ? { ...row.provenance, cache }
            : {
                provider: 'dataforseo',
                operation: 'domain_intersection_live',
                leg: 'competitor_only',
                intersections: false,
                targetOrder: 'competitor_owned',
                itemTypes: ['organic'],
                limit: 100,
                cache,
                status: 'success',
                capturedAt: null,
                returnedRows,
                truncated: rows.length > 100,
            },
    }));
}
const techStackEntriesSchema = z.array(z.object({
    category: z.enum(['cms', 'analytics', 'hosting', 'ecommerce', 'other']),
    name: z.string(),
}));
/**
 * Tech stack changes rarely (unlike rank/traffic), so the cross-user vendor
 * cache row lives 24h rather than rolling at UTC midnight like the daily
 * competitor snapshot — a low-volatility signal fetched on demand, never
 * carried in the per-day snapshot table (no `competitors`-schema change, no
 * migration for it).
 */
const TECH_STACK_TTL_MS = 24 * 60 * 60 * 1000;
/** UTC calendar day as `YYYY-MM-DD` for the composite-unique snapshot_day column. */
function snapshotDayOf(date: Date): string {
    return date.toISOString().slice(0, 10);
}
/**
 * Persist the vendor's competitor entries for one (site, UTC day). One
 * batched INSERT with `ON CONFLICT DO NOTHING` on
 * `(siteId, competitorDomain, snapshotDay)` — two concurrent same-day
 * cache misses can no longer produce duplicate rows for the same
 * (site, competitor, day) triple.
 */
async function persistCompetitorEntries(db: Pick<Db, 'insert'>, input: {
    siteId: string;
    accountId: string;
    entries: readonly CompetitorEntry[];
    source: CompetitorSource;
    now: Date;
}): Promise<void> {
    // drizzle throws on `values([])`; skip the round-trip when the vendor
    // returned nothing (rare but possible on a domain with no organic peers).
    if (input.entries.length === 0)
        return;
    const snapshotDay = snapshotDayOf(input.now);
    await db
        .insert(competitors)
        .values(input.entries.map((entry) => ({
        siteId: input.siteId,
        accountId: input.accountId,
        competitorDomain: entry.domain,
        avgPosition: numericToString(entry.avgPosition),
        intersections: entry.intersections,
        estimatedTraffic: numericToString(entry.estimatedTraffic),
        source: input.source,
        fetchedAt: input.now,
        snapshotDay,
    })))
        .onConflictDoNothing({
        target: [
            competitors.siteId,
            competitors.competitorDomain,
            competitors.snapshotDay,
        ],
    });
}
export const DEFAULT_LOCATION_CODE = 2840;
export const DEFAULT_LANGUAGE_CODE = 'en';
export const DEFAULT_COMPETITOR_LIMIT = 20;
/**
 * The site's active tracked-keyword phrases, canonicalized for the
 * serp_competitors request and its cache key (trim/de-dupe/sort/cap —
 * see `normalizeSerpKeywords`). Distinct phrases regardless of the
 * keyword's location/language/device: the fallback's semantics are
 * "based on what you track", while the REQUEST's location/language govern
 * the SERP analysis itself.
 */
async function listActiveKeywordPhrases(db: Db, siteId: string): Promise<string[]> {
    const rows = await db
        .select({ phrase: keywords.phrase })
        .from(keywords)
        .where(and(eq(keywords.siteId, siteId), eq(keywords.active, true)))
        .orderBy(desc(keywords.createdAt))
        .limit(SERP_COMPETITORS_MAX_KEYWORDS);
    return normalizeSerpKeywords(rows.map((row) => row.phrase));
}
/**
 * Keyword-driven fallback for a structurally-empty `competitors_domain`
 * result (target has no ranked-keyword footprint in the Labs index).
 * Returns `null` when the site tracks no active keywords (nothing to
 * analyze).
 *
 * The cross-user cache row (`operation: 'serp-list'`) is keyed by the
 * normalized keyword SET — two accounts tracking the same domain with
 * different keywords never share; identical sets legitimately do. The
 * cached value is unfiltered; the caller's own domain is dropped here,
 * after the cache read, so the row stays shareable.
 */
async function fetchSerpFallback(input: {
    site: {
        id: string;
        domain: string;
    };
    location: number;
    language: string;
    limit: number;
    now: Date;
    nowFn: () => Date;
    forceRefresh: boolean;
}, deps: CompetitorsServiceDeps): Promise<{
    entries: CompetitorEntry[];
    fetchedAt: Date;
} | null> {
    const phrases = await listActiveKeywordPhrases(deps.db, input.site.id);
    if (phrases.length === 0)
        return null;
    const fetched = await vendorLayer(deps.db)({
        capability: 'competitor',
        operation: 'serp-list',
        params: {
            keywords: phrases,
            locationCode: input.location,
            languageCode: input.language,
            limit: input.limit,
        },
        ttlMs: msUntilNextUtcMidnight(input.now),
        payloadSchema: competitorEntriesSchema,
        now: input.now,
        clock: input.nowFn,
        forceRefresh: input.forceRefresh,
        fetch: () => deps.provider.getSerpCompetitors(phrases, input.location, input.language, input.limit),
    });
    const ownDomain = stripWwwPrefix(normalizeCompetitorDomain(input.site.domain));
    return {
        entries: fetched.value.filter((entry) => entry.domain !== ownDomain),
        fetchedAt: fetched.fetchedAt,
    };
}
export async function listCompetitors(input: {
    accountId: string;
    siteId: string;
    locationCode?: number;
    languageCode?: string;
    limit?: number;
}, deps: CompetitorsServiceDeps): Promise<CompetitorsListPayload> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const now = nowFn();
    const location = input.locationCode ?? DEFAULT_LOCATION_CODE;
    const language = input.languageCode ?? DEFAULT_LANGUAGE_CODE;
    const limit = input.limit ?? DEFAULT_COMPETITOR_LIMIT;
    // Cache: today's persisted snapshot for this site (one DataForSEO Labs call
    // per site per UTC day). DB reads are not vendor spend.
    const cachedRows = await deps.db
        .select()
        .from(competitors)
        .where(and(eq(competitors.siteId, site.id), gte(competitors.fetchedAt, startOfDayUtc(now)), lte(competitors.fetchedAt, endOfDayUtc(now))))
        .orderBy(desc(competitors.intersections));
    if (cachedRows.length > 0) {
        return {
            target: site.domain,
            fetchedAt: cachedRows[0]!.fetchedAt.toISOString(),
            source: cachedRows[0]!.source,
            competitors: cachedRows.map((r) => ({
                domain: r.competitorDomain,
                avgPosition: r.avgPosition === null ? null : Number(r.avgPosition),
                intersections: r.intersections,
                estimatedTraffic: r.estimatedTraffic,
                fetchedAt: r.fetchedAt.toISOString(),
            })),
        };
    }
    // Cross-user layer: another account's Labs call for the same
    // (domain, location, language, limit) today serves this one from our DB.
    let entries: CompetitorEntry[];
    let fetchedAt: Date;
    let source: CompetitorSource = 'domain';
    try {
        const fetched = await vendorLayer(deps.db)({
            capability: 'competitor',
            operation: 'list',
            params: { domain: site.domain, locationCode: location, languageCode: language, limit },
            ttlMs: msUntilNextUtcMidnight(now),
            payloadSchema: competitorEntriesSchema,
            now,
            clock: nowFn,
            fetch: () => deps.provider.getCompetitors(site.domain, location, language, limit),
        });
        entries = fetched.value;
        fetchedAt = fetched.fetchedAt;
        if (entries.length === 0) {
            // Structurally-empty primary (target unknown to the Labs index) —
            // fall back to SERP analysis of the site's tracked keywords.
            const fallback = await fetchSerpFallback({ site, location, language, limit, now, nowFn, forceRefresh: false }, deps);
            if (fallback && fallback.entries.length > 0) {
                entries = fallback.entries;
                fetchedAt = fallback.fetchedAt;
                source = 'tracked_keywords';
            }
        }
    }
    catch (err) {
        wrapProviderError(err);
    }
    await persistCompetitorEntries(deps.db, {
        siteId: site.id,
        accountId: input.accountId,
        entries,
        source,
        now: fetchedAt,
    });
    return {
        target: site.domain,
        fetchedAt: fetchedAt.toISOString(),
        source,
        competitors: entries.map((e) => ({
            domain: e.domain,
            avgPosition: e.avgPosition,
            intersections: e.intersections,
            estimatedTraffic: numericToString(e.estimatedTraffic),
            fetchedAt: fetchedAt.toISOString(),
        })),
    };
}
/**
 * Manual refresh: override the one-Labs-call-per-UTC-day
 * snapshot semantics on user demand. Today's rows for the site are deleted
 * BEFORE the forced vendor fetch and replaced by its result; a vendor
 * failure restores the saved rows (compensating re-insert), so the user
 * keeps their last good data. Not a DB transaction on purpose: the vendor
 * layer writes on its own connection mid-flow, and PGlite (the test
 * backend) serializes a transaction exclusively — holding one across the
 * vendor call deadlocks it. A refresh whose primary result is empty fires
 * the tracked-keyword fallback too; the vendor-cache prevents repeat vendor
 * spend within the day.
 */
export async function refreshCompetitors(input: {
    accountId: string;
    siteId: string;
    locationCode?: number;
    languageCode?: string;
    limit?: number;
}, deps: RefreshCompetitorsDeps): Promise<CompetitorsListPayload> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    // Per-site cooldown BEFORE any vendor call — a rapid double-click must not
    // double-spend. `CooldownError` surfaces as a 429 at the controller boundary.
    deps.cooldown.assert(`competitors:${site.id}`);
    const now = nowFn();
    // Engage the cooldown once the fetch is committed to — a vendor FAILURE
    // also counts as an attempt, so a tight retry loop stays rate-limited.
    deps.cooldown.touch(`competitors:${site.id}`);
    const location = input.locationCode ?? DEFAULT_LOCATION_CODE;
    const language = input.languageCode ?? DEFAULT_LANGUAGE_CODE;
    const limit = input.limit ?? DEFAULT_COMPETITOR_LIMIT;
    const todayWindow = and(eq(competitors.siteId, site.id), gte(competitors.fetchedAt, startOfDayUtc(now)), lte(competitors.fetchedAt, endOfDayUtc(now)));
    // Save today's snapshot, then drop it BEFORE the vendor call (the daily
    // snapshot semantics stay intact — one canonical row-set per day).
    const savedRows = await deps.db.select().from(competitors).where(todayWindow);
    await deps.db.delete(competitors).where(todayWindow);
    let entries: CompetitorEntry[];
    let fetchedAt: Date;
    let source: CompetitorSource = 'domain';
    try {
        // Forced fetch: bypasses the cross-user cache reads but still rewrites
        // the cache row + appends the archive row.
        const fetched = await vendorLayer(deps.db)({
            capability: 'competitor',
            operation: 'list',
            params: { domain: site.domain, locationCode: location, languageCode: language, limit },
            ttlMs: msUntilNextUtcMidnight(now),
            payloadSchema: competitorEntriesSchema,
            now,
            clock: nowFn,
            forceRefresh: true,
            fetch: () => deps.provider.getCompetitors(site.domain, location, language, limit),
        });
        entries = fetched.value;
        fetchedAt = fetched.fetchedAt;
        if (entries.length === 0) {
            // Same fallback as `listCompetitors` — forced, so the serp-list cache
            // row is rewritten too. Inside this try so a fallback vendor failure
            // also restores the saved snapshot.
            const fallback = await fetchSerpFallback({ site, location, language, limit, now, nowFn, forceRefresh: true }, deps);
            if (fallback && fallback.entries.length > 0) {
                entries = fallback.entries;
                fetchedAt = fallback.fetchedAt;
                source = 'tracked_keywords';
            }
        }
    }
    catch (err) {
        // Compensating restore — the user keeps their last good data.
        /* c8 ignore next -- FALSE branch (no prior rows to restore) not exercised; test fixtures always pre-seed competitor rows before triggering a vendor failure. */
        if (savedRows.length > 0) {
            await deps.db.insert(competitors).values(savedRows.map((row) => ({
                siteId: row.siteId,
                accountId: row.accountId,
                competitorDomain: row.competitorDomain,
                avgPosition: row.avgPosition,
                intersections: row.intersections,
                estimatedTraffic: row.estimatedTraffic,
                source: row.source,
                fetchedAt: row.fetchedAt,
                snapshotDay: row.snapshotDay,
            })));
        }
        wrapProviderError(err);
    }
    await persistCompetitorEntries(deps.db, {
        siteId: site.id,
        accountId: input.accountId,
        entries,
        source,
        now: fetchedAt,
    });
    return {
        target: site.domain,
        fetchedAt: fetchedAt.toISOString(),
        source,
        competitors: entries.map((e) => ({
            domain: e.domain,
            avgPosition: e.avgPosition,
            intersections: e.intersections,
            estimatedTraffic: numericToString(e.estimatedTraffic),
            fetchedAt: fetchedAt.toISOString(),
        })),
    };
}
export async function getIntersection(input: {
    accountId: string;
    siteId: string;
    competitor: string;
    locationCode?: number;
    languageCode?: string;
}, deps: CompetitorsServiceDeps): Promise<IntersectionPayload> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const now = nowFn();
    const location = input.locationCode ?? DEFAULT_LOCATION_CODE;
    const language = input.languageCode ?? DEFAULT_LANGUAGE_CODE;
    // Cache: today's persisted gap-analysis for this (site, competitor) pair.
    const cached = await deps.db
        .select()
        .from(competitorIntersections)
        .where(and(eq(competitorIntersections.siteId, site.id), eq(competitorIntersections.competitorDomain, input.competitor), gte(competitorIntersections.fetchedAt, startOfDayUtc(now)), lte(competitorIntersections.fetchedAt, endOfDayUtc(now))))
        .orderBy(desc(competitorIntersections.fetchedAt))
        .limit(1);
    const hit = cached.find((row) => (row.keywords as DomainIntersectionRow[]).every((keyword) => keyword.class === 'missing'));
    if (hit) {
        return {
            target: site.domain,
            competitor: input.competitor,
            fetchedAt: hit.fetchedAt.toISOString(),
            keywords: publicIntersectionRows(hit.keywords as DomainIntersectionRow[], 'hit'),
        };
    }
    // Cross-user layer: same (target, competitor, location, language) pair
    // today — any account's fetch serves everyone.
    let fetched: {
        value: DomainIntersectionRow[];
        fetchedAt: Date;
    };
    try {
        fetched = await vendorLayer(deps.db)({
            capability: 'competitor',
            // Preserve the legacy operation label for observability while including
            // an explicit semantic version in the cache identity. That prevents a
            // pre-fix, reversed intersection payload from being served as a hit.
            operation: 'intersection',
            params: {
                target1: site.domain,
                target2: input.competitor,
                semantics: 'competitor-only-v2',
                locationCode: location,
                languageCode: language,
            },
            ttlMs: msUntilNextUtcMidnight(now),
            payloadSchema: intersectionRowsSchema,
            now,
            clock: nowFn,
            fetch: async () => {
                if (!deps.provider.compareDomains) {
                    const legacy = await deps.provider.getDomainIntersection(input.competitor, site.domain, {
                        locationCode: location,
                        languageCode: language,
                        limit: 100,
                    });
                    return legacy.map((row) => ({
                        keyword: row.keyword,
                        target1Position: null,
                        target2Position: row.target1Position,
                        searchVolume: row.searchVolume,
                    }));
                }
                const comparison = await deps.provider.compareDomains({
                    ownedDomain: site.domain,
                    ownedOrigin: `https://${site.domain}`,
                    competitorDomain: input.competitor,
                    competitorOrigin: `https://${input.competitor}`,
                    locationCode: location,
                    languageCode: language,
                });
                return correctedIntersectionRows(comparison.competitorOnly, 'miss');
            },
        });
    }
    catch (err) {
        wrapProviderError(err);
    }
    const rows = publicIntersectionRows(fetched.value, 'miss');
    await deps.db.insert(competitorIntersections).values({
        siteId: site.id,
        accountId: input.accountId,
        competitorDomain: input.competitor,
        keywords: rows,
        fetchedAt: fetched.fetchedAt,
    });
    return {
        target: site.domain,
        competitor: input.competitor,
        fetchedAt: fetched.fetchedAt.toISOString(),
        keywords: rows,
    };
}
/**
 * Detect a competitor's technology stack (CMS/analytics/hosting/e-commerce).
 * Scoped to an ALREADY-owned site's competitor list — the ownership check is
 * on the SITE (404-not-403, same discipline as the list/gap endpoints), NOT a
 * separate resource. Reuses the cross-user `vendor_cache` read-through layer
 * (`operation: 'tech-stack'`), so
 * a second lookup for the same competitor within the 24h TTL is served from
 * our DB with no vendor call. NOT persisted to a `competitors`-schema time
 * series — tech stack is low-volatility and fetched on demand.
 */
export async function getCompetitorTechStack(input: {
    accountId: string;
    siteId: string;
    competitorDomain: string;
}, deps: CompetitorsServiceDeps): Promise<TechStackPayload> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const now = nowFn();
    let fetched: {
        value: TechStackEntry[];
        fetchedAt: Date;
    };
    try {
        fetched = await vendorLayer(deps.db)({
            capability: 'competitor',
            operation: 'tech-stack',
            params: { domain: input.competitorDomain },
            ttlMs: TECH_STACK_TTL_MS,
            payloadSchema: techStackEntriesSchema,
            now,
            clock: nowFn,
            fetch: () => deps.provider.getTechnologies(input.competitorDomain),
        });
    }
    catch (err) {
        wrapProviderError(err);
    }
    return {
        target: site.domain,
        competitor: input.competitorDomain,
        fetchedAt: fetched.fetchedAt.toISOString(),
        techStack: fetched.value,
    };
}
// -- helpers exported for tests --
export { startOfDayUtc, endOfDayUtc, numericToString };
