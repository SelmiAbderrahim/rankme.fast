/** BullMQ processor for one stored-inventory internal-link suggestion run. */
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import type { Logger } from 'pino';
import { type AiProfileRunner, type InternalLinkingAiOutput, } from '../../shared/ai-profiles/index.js';
import { AiGenerationError, type AiGenerationProviderKey, } from '../../shared/providers/ai-generation.js';
import { internalLinkJobSchema, parseConsumedPayload, type InternalLinkJob, } from '../../shared/queue/index.js';
import { loadCompletedInventorySnapshot, loadGscQueryPageEvidence, } from '../content-intelligence/index.js';
import { applyInternalLinkingAiOutput, InternalLinkAiOutputContractError, validateInternalLinkingAiOutput, } from './internal-links.ai-contract.js';
import { generateInternalLinkCandidates } from './internal-links.candidates.js';
import { InternalLinkRun } from './internal-links.model.js';
export interface InternalLinksProcessorDeps {
    db: ApplicationDb;
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    now?: () => Date;
}
export function isInternalLinkAiOutputRejection(error: unknown): boolean {
    if (error instanceof InternalLinkAiOutputContractError)
        return true;
    return (error instanceof AiGenerationError &&
        ['malformed_output', 'invalid_input', 'safety', 'budget_refusal'].includes(error.category));
}
export function createInternalLinksProcessor(deps: InternalLinksProcessorDeps): Processor<InternalLinkJob, void> {
    const now = deps.now ?? (() => new Date());
    return async (job: Job<InternalLinkJob>) => {
        const payload = parseConsumedPayload(internalLinkJobSchema, job.data);
        const claimed = await InternalLinkRun.findOneAndUpdate({
            _id: payload.runId,
            accountId: payload.accountId,
            $or: [
                { status: 'queued' },
                { status: 'processing', startedAt: null },
            ],
        }, { $set: { status: 'processing', startedAt: now() } }, { new: true });
        if (!claimed) {
            const existing = await InternalLinkRun.findOne({
                _id: payload.runId,
                accountId: payload.accountId,
            });
            if (!existing) {
                deps.logger.warn({ runId: payload.runId, accountId: payload.accountId }, 'internal-links processor: run not found; dropping job');
                return;
            }
            if (existing.status === 'completed' || existing.status === 'failed') {
                deps.logger.info({ runId: payload.runId, status: existing.status }, 'internal-links processor: terminal run on replay; no-op');
                return;
            }
            deps.logger.warn({ runId: payload.runId, status: existing.status }, 'internal-links processor: run is already claimed; retrying later');
            throw new Error('internal-links run is already processing');
        }
        const existing = claimed;
        try {
            const snapshot = await loadCompletedInventorySnapshot({
                accountId: payload.accountId,
                siteId: payload.siteId,
                runId: String(existing.inventoryRunId),
            });
            if (!snapshot)
                throw new Error('pinned_inventory_missing');
            const gsc = existing.gscSnapshotDate
                ? await loadGscQueryPageEvidence(deps.db, {
                    accountId: payload.accountId,
                    siteId: payload.siteId,
                    snapshotDate: existing.gscSnapshotDate,
                })
                : { snapshotDate: null, gscByUrl: new Map() };
            const gscQueriesByUrl = new Map([...gsc.gscByUrl].map(([url, rows]) => [
                url,
                rows.map((row: {
                    query: string;
                }) => row.query),
            ]));
            const deterministic = generateInternalLinkCandidates({
                pages: snapshot.pages,
                gscQueriesByUrl,
                inventoryDate: existing.inventoryDate.toISOString(),
            });
            existing.set('suggestions', deterministic);
            existing.markModified('suggestions');
            await existing.save();
            try {
                const generated = await deps.ai.run<InternalLinkingAiOutput>({
                    profile: 'internal_linking',
                    locale: existing.locale,
                    correlationId: `internal-links-${payload.runId}`,
                    usage: {
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        jobId: payload.runId,
                    },
                    configuredProviderOrder: deps.aiProviderOrder,
                    input: {
                        candidates: deterministic.map((candidate) => ({
                            id: candidate.id,
                            sourceUrl: candidate.sourceUrl,
                            targetUrl: candidate.targetUrl,
                            targetFlag: candidate.targetFlag,
                            targetInboundCount: candidate.targetInboundCount,
                            confidence: candidate.confidence,
                            sharedQueries: candidate.sharedQueries,
                            headingMatches: candidate.headingMatches,
                            targetLabel: candidate.anchorText,
                        })),
                    },
                });
                const accepted = validateInternalLinkingAiOutput(generated.object, deterministic, snapshot.pages);
                existing.set('suggestions', applyInternalLinkingAiOutput(accepted, deterministic));
                existing.markModified('suggestions');
                existing.aiStatus = 'applied';
                existing.aiCostMicros = Number(generated.provenance.actualOrEstimatedCostMicros);
            }
            catch (error) {
                existing.aiStatus = isInternalLinkAiOutputRejection(error)
                    ? 'output_rejected'
                    : 'provider_failed';
                // The deterministic set already persisted and remains authoritative.
                existing.set('suggestions', deterministic);
                existing.markModified('suggestions');
            }
            existing.status = 'completed';
            existing.completedAt = now();
            await existing.save();
            deps.logger.info({
                runId: payload.runId,
                status: existing.status,
                aiStatus: existing.aiStatus,
                suggestionCount: deterministic.length,
            }, 'internal-links processor: run finished');
        }
        catch {
            await InternalLinkRun.updateOne({
                _id: payload.runId,
                accountId: payload.accountId,
                status: { $nin: ['completed', 'failed'] },
            }, {
                $set: {
                    status: 'failed',
                    completedAt: now(),
                    error: {
                        category: 'processing_failed',
                        messageKey: 'internalLinks.errors.processingFailed',
                    },
                },
            });
            deps.logger.error({ runId: payload.runId, accountId: payload.accountId }, 'internal-links processor: terminal processing failure');
            throw new UnrecoverableError('internal-links terminal processing failure');
        }
    };
}
/** Settle a claimed run after BullMQ exhausts every delivery attempt. */
export async function onInternalLinksJobExhausted(job: Job): Promise<void> {
    const parsed = internalLinkJobSchema.safeParse(job.data);
    if (!parsed.success)
        return;
    await InternalLinkRun.updateOne({
        _id: parsed.data.runId,
        accountId: parsed.data.accountId,
        status: { $nin: ['completed', 'failed'] },
    }, {
        $set: {
            status: 'failed',
            completedAt: new Date(),
            error: {
                category: 'processing_failed',
                messageKey: 'internalLinks.errors.processingFailed',
            },
        },
    });
}
