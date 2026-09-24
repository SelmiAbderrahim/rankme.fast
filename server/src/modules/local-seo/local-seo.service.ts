/**
 * Local SEO service.
 *
 * `refreshLocalListings` fetches business listings + reviews + Q&A in
 * parallel and persists all three as ONE snapshot — the all-or-nothing
 * consistency invariant: if ANY of the three vendor calls fails, NONE of the
 * results are persisted for this run (no partial snapshot).
 *
 * `checkLocalPackRank` makes exactly one local-pack vendor call per manual
 * check and archives it with the actual spend.
 */
import { Types } from 'mongoose';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywords } from '../../db/schema/index.js';
import type { BusinessListingRow, LocalListingsProvider, LocalPackResult, QaSummary, RankProvider, ReviewsSummary, } from '../../shared/providers/index.js';
import { ProviderError, captureVendorCost } from '../../shared/providers/index.js';
import { createVendorArchiver, createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import type { Cooldown } from '../../shared/cooldown/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { insertLocalPackRankSnapshot, persistLocalSeoSnapshot, readLatestListingSnapshot, readLatestLocalPackSnapshots, readLatestReviewsSnapshot, } from './local-seo.repository.js';
export interface LocalSeoServiceDeps {
    db: Db;
    provider: LocalListingsProvider;
    rankProvider: RankProvider;
    cooldown?: Cooldown;
    now?: () => Date;
}
export interface RefreshLocalListingsResult {
    fetchedAt: string;
    listings: Array<{
        source: string;
        name: string;
        address: string | null;
        phone: string | null;
        consistent: boolean;
    }>;
    reviews: {
        averageRating: number | null;
        reviewCount: number;
    };
    qa: {
        unansweredCount: number;
    };
}
export interface LocalPackRankResult {
    keywordId: string;
    position: number | null;
    totalPackSize: number;
    checkedAt: string;
}
export interface LocalSeoSnapshotPayload {
    listings: Array<{
        source: string;
        name: string;
        address: string | null;
        phone: string | null;
        consistent: boolean;
    }>;
    fetchedAt: string | null;
    reviews: {
        averageRating: number | null;
        reviewCount: number;
        unansweredQuestionCount: number;
    } | null;
    reviewsFetchedAt: string | null;
    localPack: Array<{
        keywordId: string;
        phrase: string;
        position: number | null;
        totalPackSize: number;
        checkedAt: string;
    }>;
}
function isValidObjectId(id: string): boolean {
    return Types.ObjectId.isValid(id);
}
export async function loadOwnedSite(input: {
    siteId: string;
    accountId: string;
}): Promise<{
    id: string;
    domain: string;
    paused: boolean;
}> {
    if (!isValidObjectId(input.siteId))
        throw HttpError.notFound({ code: 'LOCAL_SEO_ERRORS_SITE_NOT_FOUND', messageKey: 'localSeo.errors.siteNotFound' });
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'LOCAL_SEO_ERRORS_SITE_NOT_FOUND', messageKey: 'localSeo.errors.siteNotFound' });
    return {
        id: (site._id as Types.ObjectId).toString(),
        domain: site.domain,
        paused: site.paused,
    };
}
function wrapProviderError(err: unknown): never {
    if (err instanceof ProviderError) {
        throw new HttpError(503, { code: 'LOCAL_SEO_ERRORS_UNAVAILABLE', messageKey: 'localSeo.errors.unavailable' }, undefined, { cause: err });
    }
    throw err;
}
async function loadOwnedKeyword(db: Db, input: {
    accountId: string;
    siteId: string;
    keywordId: string;
}): Promise<{
    id: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
}> {
    const rows = await db
        .select()
        .from(keywords)
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId)))
        .limit(1);
    const row = rows[0];
    if (!row)
        throw HttpError.notFound({ code: 'LOCAL_SEO_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'localSeo.errors.keywordNotFound' });
    return {
        id: row.id,
        phrase: row.phrase,
        locationCode: row.locationCode,
        languageCode: row.languageCode,
    };
}
/**
 * Combined NAP/reviews/Q&A refresh — manual trigger only (no queue/worker/
 * cron). All three vendor calls run in parallel; on ANY failure, nothing is
 * persisted for this run (all-or-nothing).
 */
export async function refreshLocalListings(input: {
    accountId: string;
    siteId: string;
}, deps: LocalSeoServiceDeps): Promise<RefreshLocalListingsResult> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input);
    assertSiteNotPaused(site);
    // Per-site cooldown BEFORE any vendor call — a rapid double-click must not
    // double-spend.
    deps.cooldown?.assert(`local-seo:${site.id}`);
    const now = nowFn();
    // Engage the cooldown once the fetch is committed to — a vendor FAILURE
    // also counts as an attempt, so a tight retry loop stays rate-limited.
    deps.cooldown?.touch(`local-seo:${site.id}`);
    let listings: BusinessListingRow[];
    let reviews: ReviewsSummary;
    let qa: QaSummary;
    let refreshCostMicros: bigint | null;
    try {
        // All-or-nothing: Promise.all rejects the whole batch on the first
        // failure, so a partial result set is never persisted. One capture spans
        // all three calls — the archive row carries the combined actual spend.
        const captured = await captureVendorCost(() => Promise.all([
            deps.provider.getBusinessListings(site.domain),
            deps.provider.getReviews(site.domain),
            deps.provider.getQuestionsAndAnswers(site.domain),
        ]));
        [listings, reviews, qa] = captured.value;
        refreshCostMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    // Save-everything: one archive row for the combined three-call refresh
    // (per-account — local-listing data is never served cross-user).
    await createVendorArchiver(createVendorCacheRepo(deps.db))({
        capability: 'local-listings',
        operation: 'refresh',
        params: { domain: site.domain },
        payload: { listings, reviews, qa },
        accountId: input.accountId,
        costMicros: refreshCostMicros,
        fetchedAt: now,
    });
    await persistLocalSeoSnapshot(deps.db, {
        accountId: input.accountId,
        siteId: site.id,
        now,
        listings,
        reviews,
        qa,
    });
    return {
        fetchedAt: now.toISOString(),
        listings: listings.map((l) => ({
            source: l.source,
            name: l.name,
            address: l.address,
            phone: l.phone,
            consistent: l.consistent,
        })),
        reviews: { averageRating: reviews.averageRating, reviewCount: reviews.reviewCount },
        qa: { unansweredCount: qa.unansweredCount },
    };
}
/**
 * Local-pack (map pack) rank check for one tracked keyword. The manual check
 * makes exactly one vendor call (the maps/live request).
 */
export async function checkLocalPackRank(input: {
    accountId: string;
    siteId: string;
    keywordId: string;
}, deps: LocalSeoServiceDeps): Promise<LocalPackRankResult> {
    const site = await loadOwnedSite(input);
    assertSiteNotPaused(site);
    const keyword = await loadOwnedKeyword(deps.db, input);
    let result: LocalPackResult;
    let packCostMicros: bigint | null;
    try {
        const captured = await captureVendorCost(() => deps.rankProvider.checkLocalPackRank({
            keyword: keyword.phrase,
            domain: site.domain,
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
        }));
        result = captured.value;
        packCostMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    // Save-everything: local-pack checks bypass the serp read-through cache,
    // so archive here with the actual spend (accountId set — manual per-user
    // checks are not shared cross-user).
    await createVendorArchiver(createVendorCacheRepo(deps.db))({
        capability: 'rank',
        operation: 'local-pack',
        params: {
            keyword: keyword.phrase,
            domain: site.domain,
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
        },
        payload: result,
        accountId: input.accountId,
        costMicros: packCostMicros,
        fetchedAt: (deps.now ?? (() => new Date()))(),
    });
    const capturedAt = result.checkedAt;
    await insertLocalPackRankSnapshot(deps.db, {
        accountId: input.accountId,
        siteId: site.id,
        keywordId: keyword.id,
        position: result.position,
        totalPackSize: result.totalPackSize,
        capturedAt,
    });
    return {
        keywordId: keyword.id,
        position: result.position,
        totalPackSize: result.totalPackSize,
        checkedAt: capturedAt.toISOString(),
    };
}
export async function readLatestSnapshot(input: {
    accountId: string;
    siteId: string;
}, deps: {
    db: Db;
}): Promise<LocalSeoSnapshotPayload> {
    const site = await loadOwnedSite(input);
    const [listingRows, reviewsRow, localPackRows] = await Promise.all([
        readLatestListingSnapshot(deps.db, { siteId: site.id }),
        readLatestReviewsSnapshot(deps.db, { siteId: site.id }),
        readLatestLocalPackSnapshots(deps.db, { siteId: site.id }),
    ]);
    const keywordIds = localPackRows.map((row) => row.keywordId);
    const keywordRows = keywordIds.length > 0
        ? await deps.db.select().from(keywords).where(and(eq(keywords.siteId, site.id)))
        : [];
    const phraseById = new Map(keywordRows.map((k) => [k.id, k.phrase]));
    return {
        listings: listingRows.map((row) => ({
            source: row.source,
            name: row.name,
            address: row.address,
            phone: row.phone,
            consistent: row.consistent,
        })),
        fetchedAt: listingRows[0]?.fetchedAt.toISOString() ?? null,
        reviews: reviewsRow
            ? {
                averageRating: reviewsRow.averageRating,
                reviewCount: reviewsRow.reviewCount,
                unansweredQuestionCount: reviewsRow.unansweredQuestionCount,
            }
            : null,
        reviewsFetchedAt: reviewsRow?.fetchedAt.toISOString() ?? null,
        localPack: localPackRows.map((row) => ({
            keywordId: row.keywordId,
            phrase: phraseById.get(row.keywordId) ?? '',
            position: row.position,
            totalPackSize: row.totalPackSize,
            checkedAt: row.capturedAt.toISOString(),
        })),
    };
}
/**
 * Evaluation input for the local-seo audit rules (`rules/local-seo/*`).
 * `status: 'not-configured'` = no local-pack keyword tracked AND no listing
 * snapshot exists yet (never refreshed). `status: 'unavailable'` is reserved
 * for a future provider-outage signal — never emitted here since a failed
 * refresh never persists (all-or-nothing), so the absence of a row is
 * indistinguishable from "never tried"; both degrade the same way.
 */
export async function buildLocalSeoEvaluationInput(db: Db, input: {
    siteId: string;
    accountId: string;
    now?: Date;
}) {
    const [listingRows, reviewsRow, localPackRows] = await Promise.all([
        readLatestListingSnapshot(db, { siteId: input.siteId }),
        readLatestReviewsSnapshot(db, { siteId: input.siteId }),
        readLatestLocalPackSnapshots(db, { siteId: input.siteId }),
    ]);
    if (listingRows.length === 0 && !reviewsRow && localPackRows.length === 0) {
        return {
            status: 'not-configured',
            listings: [],
            reviews: null,
            qa: null,
            localPack: null,
        };
    }
    const keywordIds = localPackRows.map((row) => row.keywordId);
    const keywordRows = keywordIds.length > 0
        ? await db.select().from(keywords).where(eq(keywords.siteId, input.siteId))
        : [];
    const phraseById = new Map(keywordRows.map((k) => [k.id, k.phrase]));
    const firstLocalPack = localPackRows[0];
    return {
        status: 'ok',
        listings: listingRows.map((row) => ({ source: row.source, consistent: row.consistent })),
        reviews: reviewsRow
            ? { averageRating: reviewsRow.averageRating, reviewCount: reviewsRow.reviewCount }
            : null,
        qa: reviewsRow ? { unansweredCount: reviewsRow.unansweredQuestionCount } : null,
        localPack: firstLocalPack
            ? {
                keyword: phraseById.get(firstLocalPack.keywordId) ?? '',
                position: firstLocalPack.position,
                totalPackSize: firstLocalPack.totalPackSize,
            }
            : null,
    };
}
