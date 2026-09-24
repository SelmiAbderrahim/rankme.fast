import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { pagePerformanceKeywords, pagePerformanceSnapshots, type PagePerformanceCacheStatus, type PagePerformanceKeyword, type PagePerformanceSnapshot, type PagePerformanceSource, } from '../../db/schema/page-performance.js';
export const PAGE_PERFORMANCE_MAX_SNAPSHOTS = 180;
export const PAGE_PERFORMANCE_RETENTION_DAYS = 400;
export const PAGE_PERFORMANCE_DETAIL_LIMIT = 100;
export const PAGE_PERFORMANCE_RANGE_LIMIT = 180;
export interface PagePerformanceContext {
    accountId: string;
    siteId: string;
    source: PagePerformanceSource;
    locationCode: number;
    languageCode: string;
}
export interface NormalizedPagePerformanceKeyword {
    pageHash: string;
    canonicalUrl: string;
    displayUrl: string;
    keyword: string;
    position: number;
    searchVolume: number | null;
    difficulty: number | null;
    estimatedTraffic: number | null;
}
export interface PagePerformanceCoverageWrite {
    sourceRowsFetched: number;
    acceptedCount: number;
    droppedCount: number;
    malformedUrlCount: number;
    offsiteUrlCount: number;
    duplicateUrlCount: number;
    invalidMetricCount: number;
    sourceTruncated: boolean;
}
export interface WriteSuccessfulPagePerformanceSnapshotInput extends PagePerformanceContext, PagePerformanceCoverageWrite {
    observedAt: Date;
    cacheFetchedAt: Date;
    cacheStatus: PagePerformanceCacheStatus;
    payloadFingerprint: string;
    keywords: NormalizedPagePerformanceKeyword[];
}
export interface WrittenPagePerformanceSnapshot {
    snapshot: PagePerformanceSnapshot;
    keywords: PagePerformanceKeyword[];
    inserted: boolean;
}
export interface PagePerformanceRangeInput extends PagePerformanceContext {
    from: Date;
    to: Date;
    limit?: number;
}
export interface PagePerformancePreviousInput extends PagePerformanceContext {
    beforeObservedAt: Date;
    beforeSnapshotId: string;
}
export interface PagePerformanceKeywordReadInput {
    accountId: string;
    siteId: string;
    snapshotId: string;
    pageHash?: string;
    limit?: number;
}
export interface PagesRepository {
    writeSuccessfulSnapshot(input: WriteSuccessfulPagePerformanceSnapshotInput): Promise<WrittenPagePerformanceSnapshot>;
    readLatest(input: PagePerformanceContext): Promise<PagePerformanceSnapshot | null>;
    readPrevious(input: PagePerformancePreviousInput): Promise<PagePerformanceSnapshot | null>;
    readRange(input: PagePerformanceRangeInput): Promise<PagePerformanceSnapshot[]>;
    readKeywords(input: PagePerformanceKeywordReadInput): Promise<PagePerformanceKeyword[]>;
}
function assertTenantScope(accountId: string, siteId: string): void {
    if (accountId.length === 0 || siteId.length === 0) {
        throw new Error('Pages repository requires accountId and siteId');
    }
}
function contextPredicate(input: PagePerformanceContext) {
    assertTenantScope(input.accountId, input.siteId);
    return and(eq(pagePerformanceSnapshots.accountId, input.accountId), eq(pagePerformanceSnapshots.siteId, input.siteId), eq(pagePerformanceSnapshots.source, input.source), eq(pagePerformanceSnapshots.locationCode, input.locationCode), eq(pagePerformanceSnapshots.languageCode, input.languageCode))!;
}
function validateWrite(input: WriteSuccessfulPagePerformanceSnapshotInput): void {
    assertTenantScope(input.accountId, input.siteId);
    const droppedBreakdown = input.malformedUrlCount +
        input.offsiteUrlCount +
        input.duplicateUrlCount +
        input.invalidMetricCount;
    if (input.acceptedCount !== input.keywords.length ||
        input.acceptedCount + input.droppedCount !== input.sourceRowsFetched ||
        droppedBreakdown !== input.droppedCount) {
        throw new Error('Pages snapshot coverage does not match normalized keyword rows');
    }
}
export function createPagesRepository(db: Db, options: {
    now?: () => Date;
} = {}): PagesRepository {
    const now = options.now ?? (() => new Date());
    const readLatest = async (input: PagePerformanceContext): Promise<PagePerformanceSnapshot | null> => {
        const rows = await db
            .select()
            .from(pagePerformanceSnapshots)
            .where(contextPredicate(input))
            .orderBy(desc(pagePerformanceSnapshots.observedAt), desc(pagePerformanceSnapshots.id))
            .limit(1);
        return rows[0] ?? null;
    };
    const writeSuccessfulSnapshot = async (input: WriteSuccessfulPagePerformanceSnapshotInput): Promise<WrittenPagePerformanceSnapshot> => {
        validateWrite(input);
        return db.transaction(async (tx) => {
            const values = {
                accountId: input.accountId,
                siteId: input.siteId,
                source: input.source,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                observedAt: input.observedAt,
                cacheFetchedAt: input.cacheFetchedAt,
                cacheStatus: input.cacheStatus,
                successfulEmpty: input.acceptedCount === 0,
                payloadFingerprint: input.payloadFingerprint,
                sourceRowsFetched: input.sourceRowsFetched,
                acceptedCount: input.acceptedCount,
                droppedCount: input.droppedCount,
                malformedUrlCount: input.malformedUrlCount,
                offsiteUrlCount: input.offsiteUrlCount,
                duplicateUrlCount: input.duplicateUrlCount,
                invalidMetricCount: input.invalidMetricCount,
                sourceTruncated: input.sourceTruncated,
                updatedAt: now(),
            };
            const insertedRows = await tx
                .insert(pagePerformanceSnapshots)
                .values(values)
                .onConflictDoNothing({
                target: [
                    pagePerformanceSnapshots.accountId,
                    pagePerformanceSnapshots.siteId,
                    pagePerformanceSnapshots.source,
                    pagePerformanceSnapshots.locationCode,
                    pagePerformanceSnapshots.languageCode,
                    pagePerformanceSnapshots.observedAt,
                    pagePerformanceSnapshots.payloadFingerprint,
                ],
            })
                .returning();
            const inserted = insertedRows[0];
            const snapshot = inserted ??
                (await tx
                    .select()
                    .from(pagePerformanceSnapshots)
                    .where(and(contextPredicate(input), eq(pagePerformanceSnapshots.observedAt, input.observedAt), eq(pagePerformanceSnapshots.payloadFingerprint, input.payloadFingerprint)))
                    .limit(1))[0];
            if (!snapshot)
                throw new Error('Pages snapshot conflict could not be resolved');
            let keywordRows: PagePerformanceKeyword[];
            if (inserted && input.keywords.length > 0) {
                keywordRows = await tx
                    .insert(pagePerformanceKeywords)
                    .values(input.keywords.map((keyword) => ({
                    snapshotId: snapshot.id,
                    accountId: input.accountId,
                    siteId: input.siteId,
                    ...keyword,
                })))
                    .returning();
            }
            else {
                keywordRows = await tx
                    .select()
                    .from(pagePerformanceKeywords)
                    .where(and(eq(pagePerformanceKeywords.accountId, input.accountId), eq(pagePerformanceKeywords.siteId, input.siteId), eq(pagePerformanceKeywords.snapshotId, snapshot.id)))
                    .orderBy(asc(pagePerformanceKeywords.keyword), asc(pagePerformanceKeywords.id));
            }
            const contextRows = await tx
                .select({ id: pagePerformanceSnapshots.id, observedAt: pagePerformanceSnapshots.observedAt })
                .from(pagePerformanceSnapshots)
                .where(contextPredicate(input))
                .orderBy(desc(pagePerformanceSnapshots.observedAt), desc(pagePerformanceSnapshots.id));
            const newestId = contextRows[0]?.id;
            const cutoff = new Date(now().getTime() - PAGE_PERFORMANCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
            const deleteIds = contextRows
                .filter((row, index) => index >= PAGE_PERFORMANCE_MAX_SNAPSHOTS ||
                (row.id !== newestId && row.observedAt < cutoff))
                .map((row) => row.id);
            if (deleteIds.length > 0) {
                await tx
                    .delete(pagePerformanceSnapshots)
                    .where(and(eq(pagePerformanceSnapshots.accountId, input.accountId), eq(pagePerformanceSnapshots.siteId, input.siteId), inArray(pagePerformanceSnapshots.id, deleteIds)));
            }
            return { snapshot, keywords: keywordRows, inserted: Boolean(inserted) };
        });
    };
    const readPrevious = async (input: PagePerformancePreviousInput): Promise<PagePerformanceSnapshot | null> => {
        const rows = await db
            .select()
            .from(pagePerformanceSnapshots)
            .where(and(contextPredicate(input), or(lt(pagePerformanceSnapshots.observedAt, input.beforeObservedAt), and(eq(pagePerformanceSnapshots.observedAt, input.beforeObservedAt), lt(pagePerformanceSnapshots.id, input.beforeSnapshotId)))))
            .orderBy(desc(pagePerformanceSnapshots.observedAt), desc(pagePerformanceSnapshots.id))
            .limit(1);
        return rows[0] ?? null;
    };
    const readRange = async (input: PagePerformanceRangeInput): Promise<PagePerformanceSnapshot[]> => {
        const limit = Math.max(1, Math.min(input.limit ?? PAGE_PERFORMANCE_RANGE_LIMIT, PAGE_PERFORMANCE_RANGE_LIMIT));
        return db
            .select()
            .from(pagePerformanceSnapshots)
            .where(and(contextPredicate(input), gte(pagePerformanceSnapshots.observedAt, input.from), lte(pagePerformanceSnapshots.observedAt, input.to)))
            .orderBy(asc(pagePerformanceSnapshots.observedAt), asc(pagePerformanceSnapshots.id))
            .limit(limit);
    };
    const readKeywords = async (input: PagePerformanceKeywordReadInput): Promise<PagePerformanceKeyword[]> => {
        assertTenantScope(input.accountId, input.siteId);
        const limit = Math.max(1, Math.min(input.limit ?? PAGE_PERFORMANCE_DETAIL_LIMIT, PAGE_PERFORMANCE_DETAIL_LIMIT));
        const predicates = [
            eq(pagePerformanceKeywords.accountId, input.accountId),
            eq(pagePerformanceKeywords.siteId, input.siteId),
            eq(pagePerformanceKeywords.snapshotId, input.snapshotId),
        ];
        if (input.pageHash !== undefined) {
            predicates.push(eq(pagePerformanceKeywords.pageHash, input.pageHash));
        }
        return db
            .select()
            .from(pagePerformanceKeywords)
            .where(and(...predicates))
            .orderBy(sql `${pagePerformanceKeywords.estimatedTraffic} desc nulls last`, sql `${pagePerformanceKeywords.searchVolume} desc nulls last`, asc(pagePerformanceKeywords.keyword), asc(pagePerformanceKeywords.id))
            .limit(limit);
    };
    return { writeSuccessfulSnapshot, readLatest, readPrevious, readRange, readKeywords };
}
