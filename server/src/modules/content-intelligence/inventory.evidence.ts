/**
 * Content inventory — deterministic evidence loader.
 *
 * Reads the account's already-persisted Search Console + rank-tracking +
 * keyword-catalog rows for one site and normalizes them into the
 * `InventoryEvidence` shape that `inventory.analysis.ts` consumes. NO vendor
 * call happens here — the loader only reads Postgres rows the platform already
 * collected. When GSC/rank rows are absent the maps stay empty and the analysis
 * downgrades cannibalization/gap confidence on its own (the loader supplies or
 * omits; it never fabricates evidence).
 *
 * Bounds: the rank scan is LIMIT-capped and deduped to the latest ranking per
 * keyword in JS; the GSC read is restricted to the newest `query,page` snapshot
 * for the standard 28-day window, so the loader is allocation-bounded regardless
 * of history depth.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics, } from '../../db/schema/gsc.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { Site } from '../sites/index.js';
import { emptyEvidence, normalizeUrlKey, type GscQueryEvidence, type InventoryEvidence, type RankEvidence, } from './inventory.analysis.js';
/** The standard aggregation window the GSC sync writes `query,page` rows for. */
export const GSC_QUERY_PAGE_DIMENSION = 'query,page';
export const GSC_QUERY_PAGE_WINDOW_DAYS = 28;
/** Upper bound on ranking rows scanned before JS-side latest-per-keyword dedupe. */
const RANK_SCAN_LIMIT = 5000;
export interface LoadInventoryEvidenceInput {
    accountId?: string;
    siteId: string;
}
export interface LoadGscQueryPageEvidenceInput {
    accountId?: string;
    siteId: string;
    /** Pin a prior read. Omit to select the newest stored 28-day snapshot. */
    snapshotDate?: string;
}
export interface GscQueryPageEvidenceSnapshot {
    snapshotDate: string | null;
    gscByUrl: Map<string, GscQueryEvidence[]>;
}
/**
 * Load the GSC + rank + keyword evidence for a site's inventory analysis.
 * Deterministic and side-effect-free.
 */
export async function loadInventoryEvidence(db: ApplicationDb, input: LoadInventoryEvidenceInput): Promise<InventoryEvidence> {
    const evidence = emptyEvidence();
    const gsc = await loadGscQueryPageEvidence(db, input);
    evidence.gscByUrl = gsc.gscByUrl;
    await loadKeywordAndRankEvidence(db, input.siteId, evidence);
    return evidence;
}
/**
 * Stored `query,page` snapshot → per-page GSC query rows.
 *
 * This is the shared first-party reader used by the inventory analysis and
 * internal-link guidance. Supplying `snapshotDate` makes a later worker replay
 * read the exact evidence pinned at preflight instead of silently moving to a
 * newer Search Console sync.
 */
export async function loadGscQueryPageEvidence(db: ApplicationDb, input: LoadGscQueryPageEvidenceInput): Promise<GscQueryPageEvidenceSnapshot> {
    const site = input.accountId
        ? await Site.findOne({
            _id: input.siteId,
            accountId: input.accountId,
            deletionStartedAt: null,
        })
            .select('gscPropertyUrl gscBindingGenerationId')
            .lean()
        : null;
    const bindingGenerationId = input.accountId
        ? site?.gscPropertyUrl
            ? site.gscBindingGenerationId ?? 'legacy'
            : null
        : 'legacy';
    if (!bindingGenerationId) {
        return { snapshotDate: null, gscByUrl: new Map() };
    }
    let snapshotDate = input.snapshotDate;
    if (snapshotDate === undefined) {
        const latest = await db
            .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
            .from(gscSearchAnalytics)
            .where(and(eq(gscSearchAnalytics.siteId, input.siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, GSC_QUERY_PAGE_DIMENSION), eq(gscSearchAnalytics.windowDays, GSC_QUERY_PAGE_WINDOW_DAYS)))
            .orderBy(desc(gscSearchAnalytics.snapshotDate))
            .limit(1);
        snapshotDate = latest[0]?.snapshotDate;
    }
    if (snapshotDate === undefined) {
        return { snapshotDate: null, gscByUrl: new Map() };
    }
    const rows = await db
        .select({
        dimensionKey: gscSearchAnalytics.dimensionKey,
        clicks: gscSearchAnalytics.clicks,
        impressions: gscSearchAnalytics.impressions,
        position: gscSearchAnalytics.position,
    })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.siteId, input.siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, GSC_QUERY_PAGE_DIMENSION), eq(gscSearchAnalytics.windowDays, GSC_QUERY_PAGE_WINDOW_DAYS), eq(gscSearchAnalytics.snapshotDate, snapshotDate)));
    const gscByUrl = new Map<string, GscQueryEvidence[]>();
    for (const row of rows) {
        const sep = row.dimensionKey.indexOf(GSC_DIMENSION_KEY_SEPARATOR);
        // A `query,page` key always carries both keys joined by the separator; a
        // row missing the separator is malformed and skipped rather than trusted.
        if (sep === -1)
            continue;
        const query = row.dimensionKey.slice(0, sep);
        const page = row.dimensionKey.slice(sep + GSC_DIMENSION_KEY_SEPARATOR.length);
        if (query.length === 0 || page.length === 0)
            continue;
        const key = normalizeUrlKey(page);
        const list = gscByUrl.get(key) ?? [];
        list.push({
            query,
            impressions: row.impressions,
            clicks: row.clicks,
            position: row.position,
        });
        gscByUrl.set(key, list);
    }
    return { snapshotDate, gscByUrl };
}
/** Active tracked keyword phrases + the latest ranking URL per keyword. */
async function loadKeywordAndRankEvidence(db: ApplicationDb, siteId: string, evidence: InventoryEvidence): Promise<void> {
    const activeKeywords = await db
        .select({ phrase: keywords.phrase })
        .from(keywords)
        .where(and(eq(keywords.siteId, siteId), eq(keywords.active, true)));
    for (const row of activeKeywords) {
        evidence.trackedQueries.push(row.phrase);
    }
    const rankRows = await db
        .select({
        keywordId: rankings.keywordId,
        phrase: keywords.phrase,
        foundUrl: rankings.foundUrl,
        position: rankings.position,
    })
        .from(rankings)
        .innerJoin(keywords, eq(rankings.keywordId, keywords.id))
        .where(and(eq(keywords.siteId, siteId), eq(keywords.active, true), isNotNull(rankings.foundUrl), isNotNull(rankings.position)))
        .orderBy(desc(rankings.checkedAt))
        .limit(RANK_SCAN_LIMIT);
    // Keep only the newest ranking row per keyword (rows are checkedAt-DESC).
    const seenKeyword = new Set<string>();
    for (const row of rankRows) {
        if (seenKeyword.has(row.keywordId))
            continue;
        seenKeyword.add(row.keywordId);
        // The isNotNull filters guarantee both fields are present on selected rows.
        const url = row.foundUrl!;
        const position = row.position!;
        const list = evidence.rankByQuery.get(row.phrase) ?? [];
        list.push({ url, position } satisfies RankEvidence);
        evidence.rankByQuery.set(row.phrase, list);
    }
}
