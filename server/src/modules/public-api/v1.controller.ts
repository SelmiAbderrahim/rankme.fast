/**
 * Public read-only API v1 (workstream C).
 *
 * Every endpoint is a pure read over data the account already owns — no
 * vendor spend, hence no `assertCapacity`. Cross-account access resolves to
 * 404 (never 403); auth + the agency `requireFeature('api')` gate run in the
 * mount chain (app.ts), not here.
 */
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { getLatestSiteReport } from '../audits/index.js';
import { getKeywordHistoryBatch, getRanksDb, hasOwnedKeywordRowsForSite, listKeywords, resolveOwnedKeywordSiteId, type KeywordListItem, } from '../ranks/index.js';
import { decodeV1LegacyCsvCursor, encodeV1LegacyCsvCursor, parseV1HistoryQuery, v1FormatQuerySchema, v1KeywordCsvPagingQuerySchema, v1RankHistoryCsvPagingQuerySchema, v1SiteIdParamsSchema, v1StoredRowsQuerySchema, } from './v1.schema.js';
import { assertPublicExportsEnabled, sendV1Csv, V1_BACKLINK_ROWS_CSV_COLUMNS, V1_KEYWORDS_CSV_COLUMNS, V1_RANK_HISTORY_CSV_COLUMNS, V1_SERP_FEATURES_CSV_COLUMNS, V1_SITES_CSV_COLUMNS, wantsV1Csv, } from './v1.csv.js';
import { listV1BacklinkRows, listV1SerpFeatures } from './v1.exports.service.js';
/** Per-site keyword page ceiling on the read-only surface. */
export const V1_KEYWORD_LIMIT = 100;
function hasLegacyCsvPagingKey(query: unknown): boolean {
    if (query === null || typeof query !== 'object')
        return false;
    return (Object.prototype.hasOwnProperty.call(query, 'limit') ||
        Object.prototype.hasOwnProperty.call(query, 'cursor'));
}
function throwInvalidLegacyCsvCursor(): never {
    throw HttpError.badRequest({ code: 'PUBLIC_API_ERRORS_INVALID_CURSOR', messageKey: 'publicApi.errors.invalidCursor' });
}
function rethrowLegacyCsvCursorError(error: unknown, keywordCursor: string | undefined): never {
    if (keywordCursor !== undefined &&
        error instanceof HttpError &&
        error.status === 400 &&
        error.message === 'ranks.errors.unknownCursor') {
        throwInvalidLegacyCsvCursor();
    }
    throw error;
}
async function runLegacyCsvKeywordRead<T>(read: () => Promise<T>, keywordCursor: string | undefined): Promise<T> {
    try {
        return await read();
    }
    catch (error) {
        rethrowLegacyCsvCursorError(error, keywordCursor);
    }
}
export const v1ControllerTestables = {
    hasLegacyCsvPagingKey,
    rethrowLegacyCsvCursorError,
    runLegacyCsvKeywordRead,
};
export const v1ListSitesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const query = v1FormatQuerySchema.parse(req.query);
    const csv = wantsV1Csv(req, query.format);
    if (csv)
        assertPublicExportsEnabled();
    // Lean projection: the public shape only needs id,
    // domain, url, createdAt. Skipping the full doc + hydration halves the wire
    // + heap cost for accounts with many sites.
    const sites = await Site.find({ accountId, deletionStartedAt: null }, { domain: 1, url: 1, createdAt: 1, paused: 1 })
        .sort({ createdAt: -1 })
        .lean();
    const dto = sites.map((site) => ({
        id: String(site._id),
        domain: site.domain,
        url: site.url,
        paused: site.paused === true,
        createdAt: site.createdAt.toISOString(),
    }));
    if (csv) {
        sendV1Csv(res, 'rankme-sites.csv', dto.map((site) => ({
            id: site.id,
            domain: site.domain,
            url: site.url,
            paused: site.paused,
            created_at: site.createdAt,
        })), V1_SITES_CSV_COLUMNS);
        return;
    }
    res.status(200).json({ sites: dto });
});
export const v1LatestReportHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const { siteId } = v1SiteIdParamsSchema.parse(req.params);
    // `req.language` is always reset by the bearer-only language middleware
    // before the /api/v1 limiter/auth/gate chain. Browser cookies and account
    // preferences cannot influence this report representation.
    const { runId, report } = await getLatestSiteReport({
        accountId,
        siteId,
        locale: req.language,
    });
    res.status(200).json({ runId, report });
});
export const v1RankHistoryHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const { siteId } = v1SiteIdParamsSchema.parse(req.params);
    const query = parseV1HistoryQuery(req.query);
    const csv = wantsV1Csv(req, query.format);
    const paging = csv && hasLegacyCsvPagingKey(req.query)
        ? v1RankHistoryCsvPagingQuerySchema.parse(req.query)
        : null;
    if (paging !== null)
        await requireOwnedExportSite(accountId, siteId);
    // listKeywords asserts site ownership internally (404 sites.errors.notFound).
    const deps = { db: getRanksDb(), ranksQueue: null };
    let keywordCursor: string | undefined;
    if (paging?.cursor !== undefined) {
        const cursor = decodeV1LegacyCsvCursor(paging.cursor);
        if (cursor.siteId !== siteId || cursor.keywordCursor === null) {
            throwInvalidLegacyCsvCursor();
        }
        const cursorSiteId = await resolveOwnedKeywordSiteId(accountId, cursor.keywordCursor, deps.db);
        if (cursorSiteId !== siteId)
            throwInvalidLegacyCsvCursor();
        keywordCursor = cursor.keywordCursor;
    }
    const page = await runLegacyCsvKeywordRead(() => listKeywords({
        accountId,
        siteId,
        limit: paging?.limit ?? V1_KEYWORD_LIMIT,
        ...(keywordCursor !== undefined ? { cursor: keywordCursor } : {}),
        ...(paging !== null && query.engine !== undefined ? { engine: query.engine } : {}),
    }, deps), keywordCursor);
    if (csv)
        assertPublicExportsEnabled();
    // ONE `inArray` history query for every keyword on
    // the page instead of a per-keyword round trip. Response shape is byte-
    // identical: one `{ id, phrase, series }` entry per keyword in list order.
    const selectedKeywords = paging === null && query.engine !== undefined
        ? page.keywords.filter((keyword) => keyword.engine === query.engine)
        : page.keywords;
    const batch = await getKeywordHistoryBatch({
        accountId,
        keywordIds: selectedKeywords.map((k) => k.id),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
    }, deps);
    const seriesById = new Map(batch.map((entry) => [entry.keywordId, entry.series]));
    const keywords = selectedKeywords.map((keyword) => ({
        id: keyword.id,
        phrase: keyword.phrase,
        // `page.keywords` came from listKeywords which already filters by
        // (siteId, accountId); getKeywordHistoryBatch returns one entry per
        // owned id in the same order, so every keyword.id is guaranteed to be
        // in `seriesById`. Non-null assertion documents the invariant.
        // `RankHistoryPoint` gained internal provider-observation metadata for
        // alternate-engine provenance. Public API v1 predates that field, so map
        // its stable wire contract explicitly instead of leaking future service
        // additions through object spreading/identity.
        series: seriesById.get(keyword.id)!.map((point) => ({
            checkedAt: point.checkedAt,
            position: point.position,
            rankAbsolute: point.rankAbsolute,
            source: point.source,
            foundUrl: point.foundUrl,
            aiOverviewPresent: point.aiOverviewPresent,
            aiCited: point.aiCited,
            aiCitedUrl: point.aiCitedUrl,
        })),
    }));
    if (csv) {
        const engineById = new Map(selectedKeywords.map((keyword) => [keyword.id, keyword.engine]));
        sendV1Csv(res, 'rankme-rank-history.csv', keywords.flatMap((keyword) => keyword.series.map((point) => ({
            keyword_id: keyword.id,
            phrase: keyword.phrase,
            engine: engineById.get(keyword.id),
            checked_at: point.checkedAt,
            position: point.position,
            rank_absolute: point.rankAbsolute,
            source: point.source,
            found_url: point.foundUrl,
            ai_overview_present: point.aiOverviewPresent,
            ai_cited: point.aiCited,
            ai_cited_url: point.aiCitedUrl,
        }))), V1_RANK_HISTORY_CSV_COLUMNS, paging !== null && page.nextCursor !== null
            ? encodeV1LegacyCsvCursor(siteId, page.nextCursor)
            : null);
        return;
    }
    res.status(200).json({ keywords });
});
export const v1ListKeywordsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const query = v1FormatQuerySchema.parse(req.query);
    const csv = wantsV1Csv(req, query.format);
    const paging = csv && hasLegacyCsvPagingKey(req.query) ? v1KeywordCsvPagingQuerySchema.parse(req.query) : null;
    if (csv)
        assertPublicExportsEnabled();
    // Lean projection: `_id` is all we need to fan out
    // per-site listKeywords calls; the other fields would just bloat the doc.
    const sites = await Site.find({ accountId, deletionStartedAt: null }, { _id: 1, createdAt: 1 })
        .sort({ createdAt: -1, _id: -1 })
        .lean();
    const deps = { db: getRanksDb(), ranksQueue: null };
    const keywords: KeywordListItem[] = [];
    let nextCursor: string | null = null;
    const siteIds = sites.map((site) => String(site._id));
    if (paging === null) {
        for (const siteId of siteIds) {
            const page = await listKeywords({ accountId, siteId, limit: V1_KEYWORD_LIMIT }, deps);
            keywords.push(...page.keywords);
        }
    }
    else {
        let siteIndex = 0;
        let keywordCursor: string | undefined;
        if (paging.cursor !== undefined) {
            const cursor = decodeV1LegacyCsvCursor(paging.cursor);
            siteIndex = siteIds.indexOf(cursor.siteId);
            if (siteIndex < 0)
                throwInvalidLegacyCsvCursor();
            if (cursor.keywordCursor !== null) {
                const cursorSiteId = await resolveOwnedKeywordSiteId(accountId, cursor.keywordCursor, deps.db);
                if (cursorSiteId !== cursor.siteId)
                    throwInvalidLegacyCsvCursor();
                keywordCursor = cursor.keywordCursor;
            }
        }
        for (; siteIndex < siteIds.length && keywords.length < paging.limit; siteIndex += 1) {
            const currentSiteId = siteIds[siteIndex];
            // The loop bound proves this index exists.
            const ownedSiteId = currentSiteId!;
            const page = await runLegacyCsvKeywordRead(() => listKeywords({
                accountId,
                siteId: ownedSiteId,
                limit: paging.limit - keywords.length,
                ...(keywordCursor !== undefined ? { cursor: keywordCursor } : {}),
            }, deps), keywordCursor);
            keywords.push(...page.keywords);
            keywordCursor = undefined;
            if (page.nextCursor !== null) {
                nextCursor = encodeV1LegacyCsvCursor(ownedSiteId, page.nextCursor);
                break;
            }
            if (keywords.length === paging.limit) {
                for (let nextSiteIndex = siteIndex + 1; nextSiteIndex < siteIds.length; nextSiteIndex += 1) {
                    const nextSiteId = siteIds[nextSiteIndex];
                    const ownedNextSiteId = nextSiteId!;
                    if (await hasOwnedKeywordRowsForSite(accountId, ownedNextSiteId, deps.db)) {
                        nextCursor = encodeV1LegacyCsvCursor(ownedNextSiteId, null);
                        break;
                    }
                }
            }
        }
    }
    if (csv) {
        sendV1Csv(res, 'rankme-keywords.csv', keywords.map((keyword) => ({
            id: keyword.id,
            site_id: keyword.siteId,
            phrase: keyword.phrase,
            location_code: keyword.locationCode,
            language_code: keyword.languageCode,
            device: keyword.device,
            active: keyword.active,
            created_at: keyword.createdAt,
            updated_at: keyword.updatedAt,
            latest_position: keyword.latestPosition,
            previous_position: keyword.previousPosition,
            delta: keyword.delta,
            last_checked_at: keyword.lastCheckedAt,
            ai_overview_present: keyword.aiOverviewPresent,
            ai_cited: keyword.aiCited,
            ai_cited_url: keyword.aiCitedUrl,
            track_local_pack: keyword.trackLocalPack,
            last_failed_check_at: keyword.lastFailedCheckAt,
            last_failed_reason: keyword.lastFailedReason,
            engine: keyword.engine,
            engine_target: keyword.engineTarget,
        })), V1_KEYWORDS_CSV_COLUMNS, nextCursor);
        return;
    }
    res.status(200).json({ keywords });
});
async function requireOwnedExportSite(accountId: string, siteId: string): Promise<void> {
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }, { _id: 1 }).lean();
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
}
export const v1SerpFeaturesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const query = v1StoredRowsQuerySchema.parse(req.query);
    await requireOwnedExportSite(accountId, query.siteId);
    assertPublicExportsEnabled();
    const page = await listV1SerpFeatures(getRanksDb(), {
        accountId,
        siteId: query.siteId,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    if (wantsV1Csv(req, query.format)) {
        sendV1Csv(res, 'rankme-serp-features.csv', page.serpFeatures.map((row) => ({
            id: row.id,
            site_id: row.siteId,
            keyword_id: row.keywordId,
            engine: row.engine,
            checked_at: row.checkedAt,
            source: row.source,
            features_json: JSON.stringify(row.features),
            top_results_json: JSON.stringify(row.topResults),
            created_at: row.createdAt,
            source_kind: row.sourceKind,
        })), V1_SERP_FEATURES_CSV_COLUMNS, page.nextCursor);
        return;
    }
    res.status(200).json(page);
});
export const v1BacklinkRowsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const query = v1StoredRowsQuerySchema.parse(req.query);
    await requireOwnedExportSite(accountId, query.siteId);
    assertPublicExportsEnabled();
    const page = await listV1BacklinkRows(getRanksDb(), {
        accountId,
        siteId: query.siteId,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    if (wantsV1Csv(req, query.format)) {
        sendV1Csv(res, 'rankme-backlink-rows.csv', page.backlinkRows.map((row) => ({
            id: row.id,
            review_id: row.reviewId,
            site_id: row.siteId,
            url: row.url,
            domain: row.domain,
            spam_score: row.spamScore,
            rubric_band: row.rubricBand,
            rubric_version: row.rubricVersion,
            first_seen: row.firstSeen,
            last_seen: row.lastSeen,
            dofollow: row.dofollow,
            is_broken: row.isBroken,
            rationale: row.rationale,
            rationale_status: row.rationaleStatus,
            captured_at: row.capturedAt,
            source_kind: row.sourceKind,
        })), V1_BACKLINK_ROWS_CSV_COLUMNS, page.nextCursor);
        return;
    }
    res.status(200).json(page);
});
