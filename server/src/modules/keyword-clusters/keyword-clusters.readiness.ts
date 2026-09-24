/**
 * Stored-observation readiness preflight.
 *
 * ZERO-FETCH invariant: this module reads `keywords` and the durable
 * `serp_observations` store written. It constructs no provider,
 * issues no vendor call, and never writes an observation.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywords as keywordsTable } from '../../db/schema/keywords.js';
import { readLatestForKeywords } from '../ranks/index.js';
import type { ClusterInputKeyword } from './keyword-clusters.overlap.js';
import { KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN, KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS, type KeywordClusterBlockReason, } from './keyword-clusters.schemas.js';
export interface KeywordClusterBlockedKeyword {
    keywordId: string;
    phrase: string;
    reason: KeywordClusterBlockReason;
    observedAt: string | null;
}
export interface KeywordClusterReadiness {
    ready: ClusterInputKeyword[];
    blocked: KeywordClusterBlockedKeyword[];
}
export interface ReadReadinessInput {
    siteId: string;
    /** Empty or omitted = every active tracked Google keyword for the site. */
    keywordIds?: readonly string[];
    now: Date;
}
/** Milliseconds an observation may age before it can no longer feed a run. */
export const KEYWORD_CLUSTER_FRESHNESS_MS = KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS * 86400000;
export function isObservationFresh(checkedAt: Date, now: Date): boolean {
    const age = now.getTime() - checkedAt.getTime();
    return age >= 0 && age <= KEYWORD_CLUSTER_FRESHNESS_MS;
}
/**
 * Classify every candidate keyword as ready or blocked. A blocked keyword is
 * always reported with its reason — the surface never silently drops one.
 */
export async function readKeywordClusterReadiness(db: Db, input: ReadReadinessInput): Promise<KeywordClusterReadiness> {
    const requested = input.keywordIds ?? [];
    const rows = await db
        .select({
        id: keywordsTable.id,
        phrase: keywordsTable.phrase,
    })
        .from(keywordsTable)
        .where(requested.length > 0
        ? and(eq(keywordsTable.siteId, input.siteId), eq(keywordsTable.active, true), eq(keywordsTable.engine, 'google'), inArray(keywordsTable.id, [...requested]))
        : and(eq(keywordsTable.siteId, input.siteId), eq(keywordsTable.active, true), eq(keywordsTable.engine, 'google')))
        .orderBy(asc(keywordsTable.phrase), asc(keywordsTable.id))
        .limit(KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN);
    const observations = await readLatestForKeywords(db, input.siteId, rows.map((row) => row.id));
    const ready: ClusterInputKeyword[] = [];
    const blocked: KeywordClusterBlockedKeyword[] = [];
    for (const row of rows) {
        const observation = observations.get(row.id);
        if (!observation) {
            blocked.push({
                keywordId: row.id,
                phrase: row.phrase,
                reason: 'missing',
                observedAt: null,
            });
            continue;
        }
        const observedAt = observation.checkedAt.toISOString();
        if (!isObservationFresh(observation.checkedAt, input.now)) {
            blocked.push({
                keywordId: row.id,
                phrase: row.phrase,
                reason: 'stale',
                observedAt,
            });
            continue;
        }
        if (observation.topResults.length === 0) {
            blocked.push({
                keywordId: row.id,
                phrase: row.phrase,
                reason: 'empty',
                observedAt,
            });
            continue;
        }
        ready.push({
            keywordId: row.id,
            phrase: row.phrase,
            observedAt,
            topUrls: [...observation.topResults]
                .sort((a, b) => a.rankAbsolute - b.rankAbsolute)
                .map((result) => result.url),
        });
    }
    return { ready, blocked };
}
