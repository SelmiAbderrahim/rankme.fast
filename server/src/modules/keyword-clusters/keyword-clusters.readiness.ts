/**
 * Stored-observation readiness preflight.
 *
 * ZERO-FETCH invariant: this module reads `keywords`, `rankings` (through the
 * shared rank-state read) and the durable `serp_observations` store. It
 * constructs no provider, issues no vendor call, and never writes an
 * observation.
 */
import type { Db } from '../../db/client.js';
import { readKeywordRankStates, readLatestForKeywords } from '../ranks/index.js';
import type { ClusterInputKeyword } from './keyword-clusters.overlap.js';
import { KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN, KEYWORD_CLUSTER_MIN_READY_KEYWORDS, KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS, type KeywordClusterBlockReason, } from './keyword-clusters.schemas.js';
export interface ReadReadinessInput {
    siteId: string;
    /** Empty or omitted = every active tracked Google keyword for the site. */
    keywordIds?: readonly string[];
    now: Date;
}
/** Milliseconds an observation may age before it can no longer feed a run. */
export const KEYWORD_CLUSTER_FRESHNESS_MS = KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS * 86400000;
export function isObservationFresh(checkedAt: Date, now: Date, windowMs: number = KEYWORD_CLUSTER_FRESHNESS_MS): boolean {
    const age = now.getTime() - checkedAt.getTime();
    return age >= 0 && age <= windowMs;
}
export interface KeywordClusterIneligibleKeyword {
    keywordId: string;
    phrase: string;
    reasonCode: KeywordClusterBlockReason;
    /** Newest stored check (or SERP snapshot) behind the reason; null when none. */
    observedAt: string | null;
}
/**
 * Why the whole run cannot start: no tracked Google keyword at all, or fewer
 * than {@link KEYWORD_CLUSTER_MIN_READY_KEYWORDS} eligible ones. Ineligible
 * keywords alone never block a run — they are left out and named.
 */
export type KeywordClusterBlockingReason = 'no_tracked_keywords' | 'not_enough_eligible';
export interface KeywordClusterEligibility {
    eligible: ClusterInputKeyword[];
    ineligible: KeywordClusterIneligibleKeyword[];
    canRun: boolean;
    blockingReasonCode: KeywordClusterBlockingReason | null;
}
export interface EvaluateClusterEligibilityInput extends ReadReadinessInput {
    /** Freshness window in days (7 by default). */
    windowDays?: number;
}
/**
 * The one cluster-eligibility predicate. The preview banner, the ineligible
 * list, the start guard and the run record all read this result, so they can
 * never disagree.
 *
 * A keyword is eligible when its newest stored SERP snapshot is inside the
 * window and lists results. Otherwise its reason comes from the shared rank
 * state (`classifyKeywordRankState`): never checked, the last check failed,
 * the last finished check is older than the window, or the last finished check
 * is recent but saved no full results page (`no_serp_snapshot`: the check ran
 * while SERP tracking was off, or was served from an older cache entry that
 * predates snapshots).
 */
export async function evaluateClusterEligibility(db: Db, input: EvaluateClusterEligibilityInput): Promise<KeywordClusterEligibility> {
    const windowMs = (input.windowDays ?? KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS) * 86400000;
    const fresh = (at: Date) => isObservationFresh(at, input.now, windowMs);
    const rows = await readKeywordRankStates(db, {
        siteId: input.siteId,
        engine: 'google',
        ...(input.keywordIds !== undefined ? { keywordIds: input.keywordIds } : {}),
        limit: KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN,
    });
    const observations = await readLatestForKeywords(db, input.siteId, rows.map((row) => row.keywordId));
    const eligible: ClusterInputKeyword[] = [];
    const ineligible: KeywordClusterIneligibleKeyword[] = [];
    for (const row of rows) {
        const observation = observations.get(row.keywordId);
        if (observation && observation.topResults.length > 0 && fresh(observation.checkedAt)) {
            eligible.push({
                keywordId: row.keywordId,
                phrase: row.phrase,
                observedAt: observation.checkedAt.toISOString(),
                topUrls: [...observation.topResults]
                    .sort((a, b) => a.rankAbsolute - b.rankAbsolute)
                    .map((result) => result.url),
            });
            continue;
        }
        // The newest finished check is the later of the stored ranking and the
        // stored snapshot (both are written by the same rank check).
        const { state, checkedAt, failedAt } = row.rankState;
        const finishedAt = [checkedAt === null ? null : new Date(checkedAt), observation?.checkedAt ?? null]
            .filter((at): at is Date => at !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0];
        let reasonCode: KeywordClusterBlockReason;
        let observedAt: string | null = finishedAt?.toISOString() ?? null;
        if (state === 'failed_last_check' && (finishedAt === undefined || new Date(failedAt!) > finishedAt)) {
            reasonCode = 'failed_last_check';
            observedAt = failedAt;
        }
        else if (finishedAt === undefined) {
            reasonCode = 'never_checked';
        }
        else if (!fresh(finishedAt)) {
            reasonCode = 'check_too_old';
        }
        else {
            reasonCode = 'no_serp_snapshot';
        }
        ineligible.push({ keywordId: row.keywordId, phrase: row.phrase, reasonCode, observedAt });
    }
    const blockingReasonCode: KeywordClusterBlockingReason | null = rows.length === 0
        ? 'no_tracked_keywords'
        : eligible.length < KEYWORD_CLUSTER_MIN_READY_KEYWORDS
            ? 'not_enough_eligible'
            : null;
    return { eligible, ineligible, canRun: blockingReasonCode === null, blockingReasonCode };
}
