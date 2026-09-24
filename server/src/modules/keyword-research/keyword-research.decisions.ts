/**
 * Cluster decision routing.
 *
 * Contract:
 *   - Cross-account 404 on run, cluster, and site.
 *   - `accepted` delegates ONE Content Intelligence recommendation via the
 *     content-intelligence public API (`createRecommendationForKeywordCluster`).
 *     No new action-source type, no direct action-event write, no second
 *     store. `dismissed` records the event only.
 *   - Idempotency + conflict:
 *       * Same `(accountId, runId, clusterId, idempotencyKey)` + same kind
 *         → no-op returning the original row (deduped by DB unique index).
 *       * Same key + different kind → 409.
 *       * Different key on a cluster that already carries a non-matching
 *         kind → 409.
 *   - No metering. Zero vendor spend. Zero AI. Zero unit consumed.
 */
import { Types } from 'mongoose';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywordClusterDecisionEvents, type KeywordClusterDecisionEventRow, type KeywordClusterDecisionKind, } from '../../db/schema/index.js';
import { createRecommendationForKeywordCluster } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { findClusterRunForAccount, type ClusterRunSummary, } from './keyword-research.clustering.js';
export interface ApplyDecisionInput {
    accountId: string;
    runId: string;
    clusterId: string;
    kind: KeywordClusterDecisionKind;
    idempotencyKey: string;
    note?: string;
    /** Required when `kind === 'accepted'`; forbidden when `kind === 'dismissed'`. */
    siteId?: string;
}
export interface ApplyDecisionResult {
    row: KeywordClusterDecisionEventRow;
    isNew: boolean;
    cluster: ClusterRunSummary['clusters'][number];
}
/**
 * Cross-account access check runs BEFORE any recommendation side-effect
 *. Returns the located cluster or throws 404.
 */
async function loadRunClusterOrNotFound(accountId: string, runId: string, clusterId: string): Promise<{
    run: ClusterRunSummary;
    cluster: ClusterRunSummary['clusters'][number];
}> {
    const run = await findClusterRunForAccount(accountId, runId);
    if (!run)
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_ERRORS_RUN_NOT_FOUND', messageKey: 'keywordResearch.errors.runNotFound' });
    const cluster = run.clusters.find((c) => c.clusterId === clusterId);
    if (!cluster)
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_ERRORS_CLUSTER_NOT_FOUND', messageKey: 'keywordResearch.errors.clusterNotFound' });
    return { run, cluster };
}
export async function assertSiteOwnedOrNotFound(accountId: string, siteId: string): Promise<void> {
    if (!Types.ObjectId.isValid(siteId) || !Types.ObjectId.isValid(accountId)) {
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_ERRORS_SITE_NOT_FOUND', messageKey: 'keywordResearch.errors.siteNotFound' });
    }
    const site = await Site.exists({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_ERRORS_SITE_NOT_FOUND', messageKey: 'keywordResearch.errors.siteNotFound' });
}
export async function applyClusterDecision(db: Db, input: ApplyDecisionInput): Promise<ApplyDecisionResult> {
    const { run, cluster } = await loadRunClusterOrNotFound(input.accountId, input.runId, input.clusterId);
    // 1. Idempotency probe by (account, run, cluster, key). Repeat with same
    //    kind = 200 no-op; different kind = 409.
    const existingByKey = await db
        .select()
        .from(keywordClusterDecisionEvents)
        .where(and(eq(keywordClusterDecisionEvents.accountId, input.accountId), eq(keywordClusterDecisionEvents.runId, input.runId), eq(keywordClusterDecisionEvents.clusterId, input.clusterId), eq(keywordClusterDecisionEvents.idempotencyKey, input.idempotencyKey)))
        .limit(1);
    if (existingByKey.length > 0) {
        const row = existingByKey[0]!;
        if (row.kind === input.kind) {
            return { row, isNew: false, cluster };
        }
        throw HttpError.conflict({ code: 'KEYWORD_RESEARCH_ERRORS_DECISION_CONFLICT', messageKey: 'keywordResearch.errors.decisionConflict' });
    }
    // 2. Cluster-level conflict: any prior decision for THIS cluster with a
    //    different kind blocks new ones regardless of idempotency key.
    const anyForCluster = await db
        .select({ kind: keywordClusterDecisionEvents.kind })
        .from(keywordClusterDecisionEvents)
        .where(and(eq(keywordClusterDecisionEvents.accountId, input.accountId), eq(keywordClusterDecisionEvents.runId, input.runId), eq(keywordClusterDecisionEvents.clusterId, input.clusterId)));
    if (anyForCluster.some((r) => r.kind !== input.kind)) {
        throw HttpError.conflict({ code: 'KEYWORD_RESEARCH_ERRORS_DECISION_CONFLICT', messageKey: 'keywordResearch.errors.decisionConflict' });
    }
    // 3. Access + delegation for accepted decisions. Cross-account site
    //    ownership is 404. No recommendation is created on the
    //    dismissed path.
    let recommendationId: string | null = null;
    if (input.kind === 'accepted') {
        if (!input.siteId) {
            // Zod already guards this at the router; this branch is a
            // service-level backstop when the service is called directly.
            throw HttpError.badRequest({ code: 'KEYWORD_RESEARCH_ERRORS_SITE_REQUIRED', messageKey: 'keywordResearch.errors.siteRequired' });
        }
        await assertSiteOwnedOrNotFound(input.accountId, input.siteId);
        const { recommendationId: rid } = createRecommendationForKeywordCluster({
            accountId: input.accountId,
            siteId: input.siteId,
            runId: input.runId,
            clusterId: input.clusterId,
            memberKeywords: cluster.memberKeywords,
            suggestedRoute: cluster.suggestedRoute,
            aiProfile: run.aiProfile,
        });
        recommendationId = rid;
    }
    // 4. Append the event. ON CONFLICT DO NOTHING closes the race between the
    //    probe above and a concurrent writer with the same idempotency key —
    //    the "returning 0 rows" branch reloads and returns the existing row.
    const inserted = await db
        .insert(keywordClusterDecisionEvents)
        .values({
        accountId: input.accountId,
        runId: input.runId,
        clusterId: input.clusterId,
        kind: input.kind,
        // Non-null on the accepted path is guaranteed by the badRequest guard
        // above; dismissed always stores null so the accepted-requires-site
        // DB check stays satisfied belt-and-braces.
        siteId: input.kind === 'accepted' ? input.siteId! : null,
        recommendationId,
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? null,
    })
        .onConflictDoNothing({
        target: [
            keywordClusterDecisionEvents.accountId,
            keywordClusterDecisionEvents.runId,
            keywordClusterDecisionEvents.clusterId,
            keywordClusterDecisionEvents.idempotencyKey,
        ],
    })
        .returning();
    if (inserted.length === 0) {
        const replay = await db
            .select()
            .from(keywordClusterDecisionEvents)
            .where(and(eq(keywordClusterDecisionEvents.accountId, input.accountId), eq(keywordClusterDecisionEvents.runId, input.runId), eq(keywordClusterDecisionEvents.clusterId, input.clusterId), eq(keywordClusterDecisionEvents.idempotencyKey, input.idempotencyKey)))
            .limit(1);
        if (replay.length > 0 && replay[0]!.kind === input.kind) {
            return { row: replay[0]!, isNew: false, cluster };
        }
        throw HttpError.conflict({ code: 'KEYWORD_RESEARCH_ERRORS_DECISION_CONFLICT', messageKey: 'keywordResearch.errors.decisionConflict' });
    }
    return { row: inserted[0]!, isNew: true, cluster };
}
export function serializeDecision(row: KeywordClusterDecisionEventRow): {
    id: string;
    runId: string;
    clusterId: string;
    kind: KeywordClusterDecisionKind;
    siteId: string | null;
    recommendationId: string | null;
    createdAt: string;
} {
    return {
        id: row.id,
        runId: row.runId,
        clusterId: row.clusterId,
        kind: row.kind,
        siteId: row.siteId,
        recommendationId: row.recommendationId,
        createdAt: row.createdAt.toISOString(),
    };
}
