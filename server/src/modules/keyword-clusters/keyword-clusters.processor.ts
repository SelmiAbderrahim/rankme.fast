/**
 * BullMQ processor for one SERP-overlap clustering run.
 *
 * ZERO-FETCH: the only inputs are the run's pinned keyword set and the durable
 * `serp_observations` rows already captured by rank checks. No provider is
 * constructed here — labelling is best-effort and can never block or move a
 * keyword.
 */
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import type { Logger } from 'pino';
import type { AiProfileRunner, ClusterLabelsAiOutput, } from '../../shared/ai-profiles/index.js';
import type { Db } from '../../db/client.js';
import { AiGenerationError, type AiGenerationProviderKey, } from '../../shared/providers/ai-generation.js';
import { keywordClusterJobSchema, parseConsumedPayload, type KeywordClusterJob, } from '../../shared/queue/index.js';
import { applyClusterLabelsAiOutput, KeywordClusterAiOutputContractError, validateClusterLabelsAiOutput, } from './keyword-clusters.ai-contract.js';
import { SerpClusterRun } from './keyword-clusters.model.js';
import { clusterKeywordsBySerpOverlap } from './keyword-clusters.overlap.js';
import { readKeywordClusterReadiness } from './keyword-clusters.readiness.js';
import { KEYWORD_CLUSTER_MAX_AI_CLUSTERS, KEYWORD_CLUSTER_MAX_AI_MEMBERS, type KeywordCluster, } from './keyword-clusters.schemas.js';
export interface KeywordClustersProcessorDeps {
    db: Db;
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    now?: () => Date;
}
export function isKeywordClusterAiRejection(error: unknown): boolean {
    if (error instanceof KeywordClusterAiOutputContractError)
        return true;
    return (error instanceof AiGenerationError &&
        ['malformed_output', 'invalid_input', 'safety', 'budget_refusal'].includes(error.category));
}
/** Only multi-member clusters are worth naming, and only the first N of them. */
export function selectClustersForLabelling(clusters: readonly KeywordCluster[]): KeywordCluster[] {
    return clusters
        .filter((cluster) => cluster.size > 1)
        .slice(0, KEYWORD_CLUSTER_MAX_AI_CLUSTERS);
}
export function createKeywordClustersProcessor(deps: KeywordClustersProcessorDeps): Processor<KeywordClusterJob, void> {
    const now = deps.now ?? (() => new Date());
    return async (job: Job<KeywordClusterJob>) => {
        const payload = parseConsumedPayload(keywordClusterJobSchema, job.data);
        let existing = await SerpClusterRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
        });
        if (!existing) {
            deps.logger.warn({ runId: payload.runId, accountId: payload.accountId }, 'keyword-clusters processor: run not found; dropping job');
            return;
        }
        if (existing.status === 'completed' || existing.status === 'failed') {
            deps.logger.info({ runId: payload.runId, status: existing.status }, 'keyword-clusters processor: terminal run on replay; no-op');
            return;
        }
        try {
            if (existing.status === 'queued') {
                const claimed = await SerpClusterRun.findOneAndUpdate({
                    _id: payload.runId,
                    accountId: payload.accountId,
                    status: 'queued',
                }, { $set: { status: 'processing', startedAt: now() } }, { new: true });
                // A duplicate delivery lost the atomic claim. The winner owns the
                // deterministic/AI work; this delivery must perform no spend.
                if (!claimed)
                    return;
                existing = claimed;
            }
            // New runs carry the exact accepted evidence. The fallback is only for
            // legacy documents written before immutable inputs were introduced.
            const ready = existing.inputs.length > 0
                ? existing.inputs.map((input) => ({
                    keywordId: input.keywordId,
                    phrase: input.phrase,
                    observedAt: input.observedAt.toISOString(),
                    topUrls: [...input.topUrls],
                }))
                : (await readKeywordClusterReadiness(deps.db, {
                    siteId: payload.siteId,
                    keywordIds: existing.keywordIds,
                    now: now(),
                })).ready;
            const deterministic = clusterKeywordsBySerpOverlap({
                keywords: ready,
                minSharedUrls: existing.minSharedUrls,
                topUrlWindow: existing.topUrlWindow,
            });
            existing.set('clusters', deterministic);
            existing.markModified('clusters');
            await existing.save();
            const labelable = selectClustersForLabelling(deterministic);
            if (labelable.length === 0) {
                existing.aiStatus = 'skipped';
            }
            else {
                try {
                    const generated = await deps.ai.run<ClusterLabelsAiOutput>({
                        profile: 'cluster_labels',
                        locale: existing.locale,
                        correlationId: `keyword-clusters-${payload.runId}`,
                        usage: {
                            accountId: payload.accountId,
                            siteId: payload.siteId,
                            jobId: payload.runId,
                        },
                        configuredProviderOrder: deps.aiProviderOrder,
                        input: {
                            clusters: labelable.map((cluster) => ({
                                id: cluster.id,
                                keywords: cluster.members
                                    .slice(0, KEYWORD_CLUSTER_MAX_AI_MEMBERS)
                                    .map((member) => member.phrase),
                                sharedUrls: cluster.sharedUrls,
                            })),
                        },
                    });
                    const accepted = validateClusterLabelsAiOutput(generated.object, labelable);
                    existing.set('clusters', applyClusterLabelsAiOutput(accepted, deterministic));
                    existing.markModified('clusters');
                    existing.aiStatus = 'applied';
                    existing.aiCostMicros = Number(generated.provenance.actualOrEstimatedCostMicros);
                }
                catch (error) {
                    existing.aiStatus = isKeywordClusterAiRejection(error)
                        ? 'output_rejected'
                        : 'provider_failed';
                    // The deterministic grouping already persisted and stays
                    // authoritative. Labelling never blocks the run.
                    existing.set('clusters', deterministic);
                    existing.markModified('clusters');
                }
            }
            existing.status = 'completed';
            existing.completedAt = now();
            await existing.save();
            deps.logger.info({
                runId: payload.runId,
                status: existing.status,
                aiStatus: existing.aiStatus,
                clusterCount: deterministic.length,
            }, 'keyword-clusters processor: run finished');
        }
        catch {
            await SerpClusterRun.updateOne({
                _id: payload.runId,
                accountId: payload.accountId,
                status: { $nin: ['completed', 'failed'] },
            }, {
                $set: {
                    status: 'failed',
                    completedAt: now(),
                    error: {
                        category: 'processing_failed',
                        messageKey: 'keywordClusters.errors.processingFailed',
                    },
                },
            });
            deps.logger.error({ runId: payload.runId, accountId: payload.accountId }, 'keyword-clusters processor: terminal processing failure');
            throw new UnrecoverableError('keyword-clusters terminal processing failure');
        }
    };
}
