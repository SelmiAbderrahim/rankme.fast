import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { contentRecommendationEvents, contentRecommendationOutcomes, GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics, keywords, rankings, type ContentRecommendationEventRow, type ContentRecommendationOutcomeRow, } from '../../db/schema/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { ContentAnalysis } from './content-analysis.model.js';
import { keywordEvidenceSchema, ownedPageFactsSchema, recommendationSchema, serpEvidenceSchema, } from './content-analysis.schemas.js';
export const CONTENT_OUTCOME_AGGREGATION_VERSION = '2026-07-15.1';
export const CONTENT_OUTCOME_WINDOW_DAYS = 28;
export const CONTENT_OUTCOME_REFRESH_QUEUE = 'content-recommendation-outcomes';
export const CONTENT_OUTCOME_REFRESH_JOB = 'refresh';
export const CONTENT_OUTCOME_REFRESH_SCHEDULER_KEY = 'content-recommendation-outcomes-daily';
export const CONTENT_OUTCOME_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
function utcDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
}
function phaseFor(observedAt: Date, anchor: Date): 'baseline' | 'following' {
    if (observedAt < anchor)
        return 'baseline';
    return 'following';
}
function matchesGscScope(row: {
    dimensionSet: string;
    dimensionKey: string;
}, page: string, query: string): number {
    const keys = row.dimensionKey.split(GSC_DIMENSION_KEY_SEPARATOR);
    const dimensions = row.dimensionSet.split(',');
    const values = new Map(dimensions.map((dimension, index) => [dimension, keys[index]]));
    if (values.get('page') === page && values.get('query') === query)
        return 3;
    if (values.get('page') === page && !values.has('query'))
        return 2;
    if (values.get('query') === query && !values.has('page'))
        return 1;
    return 0;
}
function rankScope(analysis: InstanceType<typeof ContentAnalysis>): {
    locationCode: number;
    languageCode: string;
    device: 'desktop' | 'mobile';
} {
    const evidence = analysis.evidence;
    if (evidence && typeof evidence === 'object') {
        const record = evidence as Record<string, unknown>;
        const keyword = keywordEvidenceSchema.safeParse(record.keyword);
        const serp = serpEvidenceSchema.safeParse(record.serp);
        if (keyword.success && serp.success) {
            return {
                locationCode: keyword.data.locationCode,
                languageCode: keyword.data.languageCode,
                device: serp.data.device,
            };
        }
    }
    return {
        locationCode: 2840,
        languageCode: analysis.locale === 'zh' ? 'zh-CN' : analysis.locale,
        device: 'desktop',
    };
}
async function findLaterEditAt(event: ContentRecommendationEventRow, appliedHash: string | null, ownedUrl: string): Promise<Date | null> {
    if (!event.appliedAt || !appliedHash)
        return null;
    const rows = await ContentAnalysis.find({
        accountId: event.accountId,
        siteId: event.siteId,
        ownedUrl,
        completedAt: { $gt: event.appliedAt },
        status: { $in: ['completed', 'partial'] },
    }).sort({ completedAt: 1 });
    for (const row of rows) {
        const facts = ownedPageFactsSchema.safeParse(row.owned);
        if (facts.success && facts.data.contentHash !== appliedHash) {
            return row.completedAt as Date;
        }
    }
    return null;
}
export async function refreshRecommendationOutcome(db: ApplicationDb, event: ContentRecommendationEventRow): Promise<number> {
    if (!event.appliedAt || event.eventKind !== 'applied')
        return 0;
    const analysis = await ContentAnalysis.findOne({
        _id: event.analysisId,
        accountId: event.accountId,
        siteId: event.siteId,
    });
    if (!analysis)
        return 0;
    const site = await Site.findOne({
        _id: event.siteId,
        accountId: event.accountId,
        deletionStartedAt: null,
    })
        .select('gscPropertyUrl gscBindingGenerationId')
        .lean();
    const bindingGenerationId = site?.gscPropertyUrl
        ? site.gscBindingGenerationId ?? 'legacy'
        : null;
    const anchor = utcDay(event.appliedAt);
    const baselineStart = new Date(anchor.getTime() - CONTENT_OUTCOME_WINDOW_DAYS * DAY_MS);
    const followingEnd = new Date(anchor.getTime() + CONTENT_OUTCOME_WINDOW_DAYS * DAY_MS);
    const laterEditAt = await findLaterEditAt(event, event.contentHash, analysis.ownedUrl);
    const gscRows = await db
        .select()
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.accountId, event.accountId), eq(gscSearchAnalytics.siteId, event.siteId), ...(bindingGenerationId
        ? [eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId)]
        : [eq(gscSearchAnalytics.bindingGenerationId, '__unbound__')]), eq(gscSearchAnalytics.windowDays, CONTENT_OUTCOME_WINDOW_DAYS), gte(gscSearchAnalytics.snapshotDate, dateOnly(baselineStart)), lt(gscSearchAnalytics.snapshotDate, dateOnly(followingEnd))))
        .orderBy(gscSearchAnalytics.snapshotDate);
    const bestGscByDate = new Map<string, (typeof gscRows)[number]>();
    for (const row of gscRows) {
        const score = matchesGscScope(row, analysis.ownedUrl, analysis.keyword);
        if (score === 0)
            continue;
        const current = bestGscByDate.get(row.snapshotDate);
        if (!current || score > matchesGscScope(current, analysis.ownedUrl, analysis.keyword)) {
            bestGscByDate.set(row.snapshotDate, row);
        }
    }
    const targetRank = rankScope(analysis);
    const rankRows = await db
        .select({
        checkedAt: rankings.checkedAt,
        position: rankings.position,
    })
        .from(rankings)
        .innerJoin(keywords, eq(rankings.keywordId, keywords.id))
        .where(and(eq(keywords.accountId, event.accountId), eq(keywords.siteId, event.siteId), eq(keywords.phrase, analysis.keyword), eq(keywords.locationCode, targetRank.locationCode), eq(keywords.languageCode, targetRank.languageCode), eq(keywords.device, targetRank.device), gte(rankings.checkedAt, baselineStart), lt(rankings.checkedAt, followingEnd)))
        .orderBy(rankings.checkedAt);
    const values: Array<typeof contentRecommendationOutcomes.$inferInsert> = [];
    for (const row of bestGscByDate.values()) {
        const observedDate = new Date(`${row.snapshotDate}T00:00:00.000Z`);
        const phase = phaseFor(observedDate, anchor);
        values.push({
            accountId: event.accountId,
            siteId: event.siteId,
            analysisId: event.analysisId,
            recommendationId: event.recommendationId,
            appliedEventId: event.id,
            aggregationVersion: CONTENT_OUTCOME_AGGREGATION_VERSION,
            source: 'gsc',
            phase,
            observedDate,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            averagePosition: row.position,
            laterEdit: laterEditAt && observedDate >= laterEditAt ? 1 : 0,
        });
    }
    const latestRankByDay = new Map<string, (typeof rankRows)[number]>();
    for (const row of rankRows)
        latestRankByDay.set(dateOnly(row.checkedAt), row);
    for (const row of latestRankByDay.values()) {
        const observedDate = utcDay(row.checkedAt);
        const phase = phaseFor(observedDate, anchor);
        values.push({
            accountId: event.accountId,
            siteId: event.siteId,
            analysisId: event.analysisId,
            recommendationId: event.recommendationId,
            appliedEventId: event.id,
            aggregationVersion: CONTENT_OUTCOME_AGGREGATION_VERSION,
            source: 'rank',
            phase,
            observedDate,
            rankPosition: row.position,
            laterEdit: laterEditAt && observedDate >= laterEditAt ? 1 : 0,
        });
    }
    await db.transaction(async (tx) => {
        await tx
            .delete(contentRecommendationOutcomes)
            .where(and(eq(contentRecommendationOutcomes.appliedEventId, event.id), eq(contentRecommendationOutcomes.aggregationVersion, CONTENT_OUTCOME_AGGREGATION_VERSION)));
        if (values.length > 0)
            await tx.insert(contentRecommendationOutcomes).values(values);
    });
    return values.length;
}
export async function refreshAllRecommendationOutcomes(db: ApplicationDb): Promise<{
    events: number;
    observations: number;
}> {
    const events = await db
        .select()
        .from(contentRecommendationEvents)
        .where(eq(contentRecommendationEvents.eventKind, 'applied'))
        .orderBy(asc(contentRecommendationEvents.recordedAt));
    let observations = 0;
    for (const event of events)
        observations += await refreshRecommendationOutcome(db, event);
    return { events: events.length, observations };
}
function average(values: Array<number | null>): number | null {
    const present = values.filter((value): value is number => value !== null);
    if (present.length === 0)
        return null;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
}
function delta(baseline: number | null, following: number | null) {
    if (baseline === null || following === null)
        return { absolute: null, relative: null };
    const absolute = following - baseline;
    return {
        absolute,
        relative: baseline === 0 ? null : absolute / Math.abs(baseline),
    };
}
function metric(rows: ContentRecommendationOutcomeRow[], key: 'clicks' | 'impressions' | 'ctr' | 'averagePosition' | 'rankPosition') {
    const baseline = average(rows.filter((row) => row.phase === 'baseline').map((row) => row[key]));
    const following = average(rows.filter((row) => row.phase === 'following').map((row) => row[key]));
    return { baseline, following, delta: delta(baseline, following) };
}
function coverage(rows: ContentRecommendationOutcomeRow[], source: 'gsc' | 'rank') {
    const scoped = rows.filter((row) => row.source === source);
    const baselineDays = new Set(scoped.filter((row) => row.phase === 'baseline').map((row) => dateOnly(row.observedDate))).size;
    const followingDays = new Set(scoped.filter((row) => row.phase === 'following').map((row) => dateOnly(row.observedDate))).size;
    const ratio = Math.min(baselineDays, followingDays) / CONTENT_OUTCOME_WINDOW_DAYS;
    return {
        baselineDays,
        followingDays,
        expectedDays: CONTENT_OUTCOME_WINDOW_DAYS,
        completeness: scoped.length === 0 ? 'unavailable' as const : ratio >= 1 ? 'complete' as const : 'partial' as const,
        confidence: ratio >= 0.75 ? 'high' as const : ratio >= 0.4 ? 'medium' as const : 'low' as const,
    };
}
async function readRecommendationOutcome(db: ApplicationDb, input: {
    accountId: string;
    analysisId: string;
    recommendationId: string;
}, now: Date, refresh: boolean) {
    const analysis = await ContentAnalysis.findOne({
        _id: input.analysisId,
        accountId: input.accountId,
    });
    if (!analysis)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    const site = await Site.exists({
        _id: analysis.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    const recommendationExists = analysis.recommendations.some((value) => {
        const parsed = recommendationSchema.safeParse(value);
        return parsed.success && parsed.data.id === input.recommendationId;
    });
    if (!recommendationExists) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.recommendations.errors.notFound' });
    }
    const events = await db
        .select()
        .from(contentRecommendationEvents)
        .where(and(eq(contentRecommendationEvents.accountId, input.accountId), eq(contentRecommendationEvents.analysisId, input.analysisId), eq(contentRecommendationEvents.recommendationId, input.recommendationId), eq(contentRecommendationEvents.eventKind, 'applied')))
        .orderBy(desc(contentRecommendationEvents.recordedAt))
        .limit(1);
    const applied = events[0];
    if (!applied || !applied.appliedAt)
        return { available: false as const };
    if (refresh)
        await refreshRecommendationOutcome(db, applied);
    const rows = await db
        .select()
        .from(contentRecommendationOutcomes)
        .where(and(eq(contentRecommendationOutcomes.appliedEventId, applied.id), eq(contentRecommendationOutcomes.aggregationVersion, CONTENT_OUTCOME_AGGREGATION_VERSION)))
        .orderBy(asc(contentRecommendationOutcomes.observedDate));
    const anchor = utcDay(applied.appliedAt);
    const end = new Date(anchor.getTime() + CONTENT_OUTCOME_WINDOW_DAYS * DAY_MS);
    const hasGscData = rows.some((row) => row.source === 'gsc');
    const hasRankData = rows.some((row) => row.source === 'rank');
    return {
        available: true as const,
        dataAvailable: hasGscData || hasRankData,
        aggregationVersion: CONTENT_OUTCOME_AGGREGATION_VERSION,
        appliedAt: applied.appliedAt.toISOString(),
        contentHash: applied.contentHash,
        hashStatus: !applied.contentHash || !applied.analysisContentHash
            ? 'unavailable' as const
            : applied.contentHash === applied.analysisContentHash
                ? 'same' as const
                : 'changed' as const,
        window: {
            baselineStart: new Date(anchor.getTime() - CONTENT_OUTCOME_WINDOW_DAYS * DAY_MS).toISOString(),
            baselineEnd: anchor.toISOString(),
            followingStart: anchor.toISOString(),
            followingEnd: end.toISOString(),
            complete: now >= end,
        },
        coverage: {
            gsc: coverage(rows, 'gsc'),
            rank: coverage(rows, 'rank'),
        },
        metrics: {
            clicks: metric(rows, 'clicks'),
            impressions: metric(rows, 'impressions'),
            ctr: metric(rows, 'ctr'),
            averagePosition: metric(rows, 'averagePosition'),
            rankPosition: metric(rows, 'rankPosition'),
        },
        laterEdit: rows.some((row) => row.laterEdit === 1),
        series: rows.map((row) => ({
            source: row.source,
            phase: row.phase,
            observedAt: row.observedDate.toISOString(),
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            averagePosition: row.averagePosition,
            rankPosition: row.rankPosition,
            laterEdit: row.laterEdit === 1,
        })),
    };
}
export async function getRecommendationOutcome(db: ApplicationDb, input: {
    accountId: string;
    analysisId: string;
    recommendationId: string;
}, now: Date = new Date()) {
    return readRecommendationOutcome(db, input, now, true);
}
/** Stored-data-only projection for exports; never refreshes or writes outcome rows. */
export async function getStoredRecommendationOutcome(db: ApplicationDb, input: {
    accountId: string;
    analysisId: string;
    recommendationId: string;
}, now: Date = new Date()) {
    return readRecommendationOutcome(db, input, now, false);
}
export function createContentOutcomeRefreshProcessor(db: ApplicationDb) {
    return async () => refreshAllRecommendationOutcomes(db);
}
