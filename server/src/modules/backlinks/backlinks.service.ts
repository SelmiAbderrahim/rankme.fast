/**
 * Backlinks service.
 *
 * Responsibilities:
 *   1. Ownership check — every read goes through {accountId, siteId}; a
 *      site owned by another account 404s. No cross-account leaks.
 *   2. Cross-user vendor caching — summary + first-page list data is
 *      domain-keyed in the generic vendor layer (`shared/vendor-cache`),
 *      so when account A already paid the vendor for a domain, account B's
 *      request is served from our DB. Every fresh fetch also lands an
 *      append-only `vendor_responses` archive row. Per-account
 *      `backlink_snapshots` rows keep the summary history + delta feature.
 *      Summary GETs are CACHE-ONLY: they read the per-site snapshot and the
 *      cross-user layer but never trigger a vendor fetch — the
 *      manual refresh is the single summary-spend path, so opening the
 *      panel can never cost vendor money.
 *   3. Paged listing — a plain first-page GET is a stored-data read (rows we
 *      already hold, even past their TTL) and never reaches the vendor; only
 *      an explicit `fresh` pull rides the cross-user read-through cache, and
 *      cursor pages always reach the vendor and land an archive row.
 *
 * Provider failures NEVER persist. They surface as a localized
 * `unavailable` HttpError so the audit / rank / report flows are unaffected.
 */
import { Types } from 'mongoose';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { BacklinkListPage, BacklinkProvider, BacklinkRow, } from '../../shared/providers/index.js';
import { assessLinkSuspicion, type LinkSuspicion } from './link-suspicion.js';
import { ProviderError, captureVendorCost } from '../../shared/providers/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import type { Db } from '../../db/client.js';
import { DEFAULT_BACKLINK_SUMMARY_TTL_HOURS, backlinkSnapshots, } from '../../db/schema/backlinks.js';
import type { Cooldown } from '../../shared/cooldown/index.js';
import { computeVendorCacheKey, createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
export interface BacklinkSummaryPayload {
    domainRating: number | null;
    backlinks: number;
    referringDomains: number;
    brokenBacklinks: number;
    firstSeen: string | null;
    fetchedAt: string;
    cached: boolean;
    delta: {
        domainRating: number | null;
        backlinks: number | null;
        referringDomains: number | null;
        brokenBacklinks: number | null;
    } | null;
}
/** A listed backlink with its review flag: `null` when nothing is worth a look. */
export type BacklinkListRow = BacklinkRow & {
    suspicion: LinkSuspicion | null;
};
/**
 * What the list covers. The provider lists ONE link per referring domain, so
 * `rows.length` is bounded by the referring domain count and is usually
 * smaller than the summary's total `backlinks`.
 */
export const BACKLINK_LIST_SCOPE = 'one_per_referring_domain' as const;
export interface BacklinkListPayload {
    rows: BacklinkListRow[];
    nextCursor: string | null;
    cached: boolean;
    /**
     * When the provider returned these rows (ISO 8601); null when nothing is
     * stored yet. A page served from storage keeps its original fetch time.
     */
    fetchedAt: string | null;
}
export interface BacklinksServiceDeps {
    db: Db;
    provider: BacklinkProvider;
    ttlHours?: number;
    now?: () => Date;
}
export interface RefreshBacklinksDeps extends BacklinksServiceDeps {
    cooldown: Cooldown;
}
// One in-process gate shared across requests — concurrent misses on the same
// domain make exactly one vendor call.
const singleFlight = createSingleFlight();
function vendorLayer(db: Db) {
    const repo = createVendorCacheRepo(db);
    return { repo, readThrough: createReadThrough({ repo, singleFlight }) };
}
const summaryPayloadSchema = z.object({
    domainRank: z.number().nullable(),
    backlinks: z.number(),
    referringDomains: z.number(),
    brokenBacklinks: z.number(),
    firstSeen: z.string().nullable(),
});
const cachedBacklinkRowSchema = z.object({
    domainFrom: z.string().optional(),
    urlFrom: z.string(),
    urlTo: z.string(),
    anchor: z.string().nullable(),
    dofollow: z.boolean(),
    isBroken: z.boolean(),
    firstSeen: z.string().nullable(),
    lastSeen: z.string().nullable(),
    backlinkSpamScore: z.number().int().min(0).max(100).nullable().optional(),
    urlToSpamScore: z.number().int().min(0).max(100).nullable().optional(),
});
const listPayloadSchema = z.object({
    rows: z.array(cachedBacklinkRowSchema),
    nextCursor: z.string().nullable(),
});
type CachedBacklinkRows = z.infer<typeof cachedBacklinkRowSchema>[];
/** Loose site-id shape used to distinguish "invalid id" (404) from real errors. */
function isValidObjectId(id: string): boolean {
    return Types.ObjectId.isValid(id);
}
async function loadOwnedSite(accountId: string, siteId: string): Promise<{
    id: string;
    domain: string;
    paused: boolean;
}> {
    if (!isValidObjectId(siteId)) {
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    return {
        id: (site._id as Types.ObjectId).toString(),
        domain: site.domain,
        paused: site.paused,
    };
}
function wrapProviderError(err: unknown): never {
    if (err instanceof ProviderError) {
        throw new HttpError(503, { code: 'BACKLINKS_ERRORS_UNAVAILABLE', messageKey: 'backlinks.errors.unavailable' }, undefined, { cause: err });
    }
    throw err;
}
function ttlMillis(hours: number): number {
    return hours * 60 * 60 * 1000;
}
export async function getBacklinkSummary(input: {
    accountId: string;
    siteId: string;
}, deps: BacklinksServiceDeps): Promise<BacklinkSummaryPayload | null> {
    const nowFn = deps.now ?? (() => new Date());
    const ttlHours = deps.ttlHours ?? DEFAULT_BACKLINK_SUMMARY_TTL_HOURS;
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const now = nowFn();
    const previous = await deps.db
        .select()
        .from(backlinkSnapshots)
        .where(eq(backlinkSnapshots.siteId, site.id))
        .orderBy(desc(backlinkSnapshots.fetchedAt))
        .limit(1);
    const prev = previous[0];
    // Per-site cache hit: this site already has a snapshot < TTL old.
    if (prev && now.getTime() - prev.fetchedAt.getTime() < ttlMillis(ttlHours)) {
        return {
            domainRating: prev.domainRating,
            backlinks: prev.backlinks,
            referringDomains: prev.referringDomains,
            brokenBacklinks: prev.brokenBacklinks,
            firstSeen: null,
            fetchedAt: prev.fetchedAt.toISOString(),
            cached: true,
            delta: null,
        };
    }
    // Cross-user read-only probe: another account's fresh fetch for this
    // domain serves us from our DB — free. A GET must NEVER reach the vendor
    // (the manual refresh is the only summary-spend path), so this is
    // a plain cache read, not the read-through.
    const { repo } = vendorLayer(deps.db);
    const cacheHit = await repo.read({
        capability: 'backlink',
        operation: 'summary',
        cacheKey: computeVendorCacheKey({
            capability: 'backlink',
            operation: 'summary',
            params: { domain: site.domain },
        }),
    }, now);
    if (cacheHit) {
        const parsed = summaryPayloadSchema.safeParse(cacheHit.payload);
        if (parsed.success) {
            return persistSnapshotAndShape(site, prev, { accountId: input.accountId }, deps, {
                value: parsed.data,
                cached: true,
                fetchedAt: cacheHit.fetchedAt,
            });
        }
    }
    // Stale per-site snapshot: serve it as-is — `fetchedAt` carries the age,
    // and the refresh button is the path to fresh data.
    if (prev) {
        return {
            domainRating: prev.domainRating,
            backlinks: prev.backlinks,
            referringDomains: prev.referringDomains,
            brokenBacklinks: prev.brokenBacklinks,
            firstSeen: null,
            fetchedAt: prev.fetchedAt.toISOString(),
            cached: true,
            delta: null,
        };
    }
    // Never fetched by anyone: explicit empty state, zero vendor spend.
    return null;
}
type BacklinkSnapshotRow = typeof backlinkSnapshots.$inferSelect;
/**
 * Vendor tail of the MANUAL REFRESH path: force-fetch through the vendor
 * layer (archive + cache rows land), then persist a per-account snapshot and
 * shape the payload. Summary GETs never reach this — they are cache-only
 * (see `getBacklinkSummary`).
 */
async function fetchSummaryAndSnapshot(site: {
    id: string;
    domain: string;
}, prev: BacklinkSnapshotRow | undefined, ctx: {
    accountId: string;
    now: Date;
    ttlHours: number;
    forceRefresh: boolean;
}, deps: BacklinksServiceDeps): Promise<BacklinkSummaryPayload> {
    const { readThrough } = vendorLayer(deps.db);
    let fetched: {
        value: z.infer<typeof summaryPayloadSchema>;
        cached: boolean;
        fetchedAt: Date;
    };
    try {
        fetched = await readThrough({
            capability: 'backlink',
            operation: 'summary',
            params: { domain: site.domain },
            ttlMs: ttlMillis(ctx.ttlHours),
            payloadSchema: summaryPayloadSchema,
            now: ctx.now,
            clock: () => ctx.now,
            forceRefresh: ctx.forceRefresh,
            fetch: async () => {
                const summary = await deps.provider.getSummary(site.domain);
                return {
                    domainRank: summary.domainRank,
                    backlinks: summary.backlinks,
                    referringDomains: summary.referringDomains,
                    brokenBacklinks: summary.brokenBacklinks,
                    firstSeen: summary.firstSeen ? summary.firstSeen.toISOString() : null,
                };
            },
        });
    }
    catch (err) {
        wrapProviderError(err);
    }
    return persistSnapshotAndShape(site, prev, ctx, deps, fetched);
}
/**
 * Persist a per-account snapshot from summary data (fresh vendor fetch or a
 * cross-user cache hit) and shape the payload with the delta against `prev`.
 */
async function persistSnapshotAndShape(site: {
    id: string;
    domain: string;
}, prev: BacklinkSnapshotRow | undefined, ctx: {
    accountId: string;
}, deps: BacklinksServiceDeps, fetched: {
    value: z.infer<typeof summaryPayloadSchema>;
    cached: boolean;
    fetchedAt: Date;
}): Promise<BacklinkSummaryPayload> {
    const summary = fetched.value;
    // Snapshot dated by the DATA's fetch time so this site's per-site TTL
    // window stays in sync with the shared cache row's freshness.
    await deps.db.insert(backlinkSnapshots).values({
        siteId: site.id,
        accountId: ctx.accountId,
        domainRating: summary.domainRank,
        backlinks: summary.backlinks,
        referringDomains: summary.referringDomains,
        brokenBacklinks: summary.brokenBacklinks,
        fetchedAt: fetched.fetchedAt,
    });
    const delta = prev
        ? {
            domainRating: summary.domainRank !== null && prev.domainRating !== null
                ? summary.domainRank - prev.domainRating
                : null,
            backlinks: summary.backlinks - prev.backlinks,
            referringDomains: summary.referringDomains - prev.referringDomains,
            brokenBacklinks: summary.brokenBacklinks - prev.brokenBacklinks,
        }
        : null;
    return {
        domainRating: summary.domainRank,
        backlinks: summary.backlinks,
        referringDomains: summary.referringDomains,
        brokenBacklinks: summary.brokenBacklinks,
        firstSeen: summary.firstSeen,
        fetchedAt: fetched.fetchedAt.toISOString(),
        cached: fetched.cached,
        delta,
    };
}
/**
 * Manual refresh: bypass the per-site snapshot TTL AND the
 * cross-user vendor cache, always spend one real vendor request, and
 * invalidate the cached list first page so the panel's next list fetch pulls
 * fresh rows.
 */
export async function refreshBacklinkSummary(input: {
    accountId: string;
    siteId: string;
}, deps: RefreshBacklinksDeps): Promise<BacklinkSummaryPayload> {
    const nowFn = deps.now ?? (() => new Date());
    const ttlHours = deps.ttlHours ?? DEFAULT_BACKLINK_SUMMARY_TTL_HOURS;
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    // Per-site cooldown BEFORE the vendor call — a rapid double-click must not
    // double-spend. `CooldownError` surfaces as a 429 at the controller boundary.
    deps.cooldown.assert(`backlinks:${site.id}`);
    const now = nowFn();
    // Engage the cooldown once the fetch is committed to — a vendor FAILURE
    // also counts as an attempt, so a tight retry loop stays rate-limited.
    deps.cooldown.touch(`backlinks:${site.id}`);
    const previous = await deps.db
        .select()
        .from(backlinkSnapshots)
        .where(eq(backlinkSnapshots.siteId, site.id))
        .orderBy(desc(backlinkSnapshots.fetchedAt))
        .limit(1);
    const payload = await fetchSummaryAndSnapshot(site, previous[0], { accountId: input.accountId, now, ttlHours, forceRefresh: true }, deps);
    // The list first page is cached per (domain, limit); the user expects the
    // whole panel to be fresh after a refresh, so drop every limit variant.
    const { repo } = vendorLayer(deps.db);
    await repo.invalidateByParams({ capability: 'backlink', operation: 'list-first-page' }, { domain: site.domain });
    return payload;
}
/** Attach the explainable review flag to each row of one page. */
function withSuspicion(rows: BacklinkRow[]): BacklinkListRow[] {
    const assessed = assessLinkSuspicion(rows);
    return rows.map((row, index) => ({ ...row, suspicion: assessed[index] ?? null }));
}
/** Serialize a BacklinkRow's Date fields as ISO for the jsonb cache. */
function rowsToCachePayload(rows: BacklinkRow[]): CachedBacklinkRows {
    return rows.map((row) => ({
        ...(row.domainFrom ? { domainFrom: row.domainFrom } : {}),
        urlFrom: row.urlFrom,
        urlTo: row.urlTo,
        anchor: row.anchor,
        dofollow: row.dofollow,
        isBroken: row.isBroken,
        firstSeen: row.firstSeen ? row.firstSeen.toISOString() : null,
        lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
        backlinkSpamScore: row.backlinkSpamScore ?? null,
        urlToSpamScore: row.urlToSpamScore ?? null,
    }));
}
/** Reverse — cached ISO strings back to Date so the response shape is stable. */
function cachedToRows(cached: CachedBacklinkRows): BacklinkRow[] {
    return cached.map((row) => ({
        ...(row.domainFrom ? { domainFrom: row.domainFrom } : {}),
        urlFrom: row.urlFrom,
        urlTo: row.urlTo,
        anchor: row.anchor,
        dofollow: row.dofollow,
        isBroken: row.isBroken,
        firstSeen: row.firstSeen ? new Date(row.firstSeen) : null,
        lastSeen: row.lastSeen ? new Date(row.lastSeen) : null,
        backlinkSpamScore: row.backlinkSpamScore ?? null,
        urlToSpamScore: row.urlToSpamScore ?? null,
    }));
}
/**
 * Zero-spend read of the stored first page. Browsing the Backlinks tab shows
 * rows we already hold (this account's earlier pull or another account's
 * cross-user cache row, even past its TTL) and never reaches the vendor.
 * `rows: []` means nothing is stored yet; a refresh or `fresh` pull fills it.
 */
async function readStoredFirstPage(site: {
    domain: string;
}, input: {
    limit: number;
}, deps: BacklinksServiceDeps, now: Date): Promise<BacklinkListPayload> {
    const { repo } = vendorLayer(deps.db);
    const hit = await repo.read({
        capability: 'backlink',
        operation: 'list-first-page',
        cacheKey: computeVendorCacheKey({
            capability: 'backlink',
            operation: 'list-first-page',
            params: { domain: site.domain, limit: input.limit },
        }),
    }, now, { includeExpired: true });
    const parsed = hit ? listPayloadSchema.safeParse(hit.payload) : null;
    if (!parsed?.success) {
        return { rows: [], nextCursor: null, cached: false, fetchedAt: null };
    }
    return {
        rows: withSuspicion(cachedToRows(parsed.data.rows)),
        nextCursor: parsed.data.nextCursor,
        cached: true,
        fetchedAt: hit!.fetchedAt.toISOString(),
    };
}
export async function listBacklinksPaged(input: {
    accountId: string;
    siteId: string;
    cursor?: string;
    limit: number;
    fresh?: boolean;
}, deps: BacklinksServiceDeps): Promise<BacklinkListPayload> {
    const nowFn = deps.now ?? (() => new Date());
    const ttlHours = deps.ttlHours ?? DEFAULT_BACKLINK_SUMMARY_TTL_HOURS;
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const now = nowFn();
    // A plain first-page GET shows stored data only. Spending needs an
    // explicit `fresh` pull (sent after a refresh) or a "Load more" cursor.
    if (!input.cursor && !input.fresh) {
        return readStoredFirstPage(site, input, deps, now);
    }
    const { repo, readThrough } = vendorLayer(deps.db);
    // Fresh first page: domain-keyed cross-user cache.
    if (!input.cursor) {
        let page: {
            value: z.infer<typeof listPayloadSchema>;
            cached: boolean;
        };
        try {
            page = await readThrough({
                capability: 'backlink',
                operation: 'list-first-page',
                params: { domain: site.domain, limit: input.limit },
                ttlMs: ttlMillis(ttlHours),
                payloadSchema: listPayloadSchema,
                now,
                clock: () => now,
                fetch: async () => {
                    const fresh = await deps.provider.listBacklinks(site.domain, { limit: input.limit });
                    return { rows: rowsToCachePayload(fresh.rows), nextCursor: fresh.nextCursor ?? null };
                },
            });
        }
        catch (err) {
            wrapProviderError(err);
        }
        return {
            rows: withSuspicion(cachedToRows(page.value.rows)),
            nextCursor: page.value.nextCursor,
            cached: page.cached,
            fetchedAt: now.toISOString(),
        };
    }
    // Cursor pages are unbounded fan-out — archived (save-everything), but
    // only the first page is served from the read-through cache.
    let page: BacklinkListPage;
    let pageCostMicros: bigint | null;
    try {
        const captured = await captureVendorCost(() => deps.provider.listBacklinks(site.domain, {
            limit: input.limit,
            cursor: input.cursor,
        }));
        page = captured.value;
        pageCostMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    const rows = page.rows;
    const nextCursor = page.nextCursor ?? null;
    const params = { domain: site.domain, limit: input.limit, cursor: input.cursor };
    await repo.appendResponse({
        capability: 'backlink',
        operation: 'list-page',
        cacheKey: computeVendorCacheKey({ capability: 'backlink', operation: 'list-page', params }),
        params,
        payload: { rows: rowsToCachePayload(rows), nextCursor },
        costMicros: pageCostMicros,
        fetchedAt: now,
    });
    return {
        rows: withSuspicion(rows),
        nextCursor,
        cached: false,
        fetchedAt: now.toISOString(),
    };
}
/**
 * Strictly read-only summary for AI/MCP read tools: the newest per-site
 * snapshot (any age), else the cross-user cache row (even past its TTL).
 * Unlike `getBacklinkSummary` it never inserts a snapshot, never computes a
 * delta and never reaches the vendor.
 */
export async function readStoredBacklinkSummary(input: {
    accountId: string;
    siteId: string;
}, deps: Pick<BacklinksServiceDeps, 'db'>): Promise<BacklinkSummaryPayload | null> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const previous = await deps.db
        .select()
        .from(backlinkSnapshots)
        .where(eq(backlinkSnapshots.siteId, site.id))
        .orderBy(desc(backlinkSnapshots.fetchedAt))
        .limit(1);
    const prev = previous[0];
    if (prev) {
        return {
            domainRating: prev.domainRating,
            backlinks: prev.backlinks,
            referringDomains: prev.referringDomains,
            brokenBacklinks: prev.brokenBacklinks,
            firstSeen: null,
            fetchedAt: prev.fetchedAt.toISOString(),
            cached: true,
            delta: null,
        };
    }
    const { repo } = vendorLayer(deps.db);
    const hit = await repo.read({
        capability: 'backlink',
        operation: 'summary',
        cacheKey: computeVendorCacheKey({
            capability: 'backlink',
            operation: 'summary',
            params: { domain: site.domain },
        }),
    }, new Date(), { includeExpired: true });
    const parsed = hit ? summaryPayloadSchema.safeParse(hit.payload) : null;
    if (!hit || !parsed?.success)
        return null;
    return {
        domainRating: parsed.data.domainRank,
        backlinks: parsed.data.backlinks,
        referringDomains: parsed.data.referringDomains,
        brokenBacklinks: parsed.data.brokenBacklinks,
        firstSeen: parsed.data.firstSeen,
        fetchedAt: hit.fetchedAt.toISOString(),
        cached: true,
        delta: null,
    };
}
/**
 * Strictly read-only stored first page for AI/MCP read tools: ownership check
 * plus the zero-spend `readStoredFirstPage`. There is no `fresh` and no cursor
 * path here, so this can never reach a provider.
 */
export async function readStoredBacklinkList(input: {
    accountId: string;
    siteId: string;
    limit?: number;
}, deps: BacklinksServiceDeps | Pick<BacklinksServiceDeps, 'db'>): Promise<BacklinkListPayload> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    return readStoredFirstPage(site, { limit: input.limit ?? 100 }, deps as BacklinksServiceDeps, new Date());
}
