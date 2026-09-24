/**
 * Audience Research — BullMQ processor.
 *
 * Thin envelope over `runAudienceResearchPipeline`:
 *   1. Payload validation via `parseConsumedPayload` — a malformed job is
 *      an `UnrecoverableError` (dead-letter, no retry burn).
 *   2. Terminal short-circuit — a replayed job whose run is already terminal
 *      is a no-op (idempotent replay).
 *   3. Missing / cross-account run — drop with a warning log; no throw so
 *      BullMQ does not retry.
 *   4. Otherwise call the pipeline. Its output is not consumed here — the
 *      terminal state and reason code are persisted by `finalizeTerminal`
 *      inside the pipeline.
 */
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import type { Logger } from 'pino';
import { Types } from 'mongoose';
import { audienceResearchJobSchema, type AudienceResearchJob, } from '../../shared/queue/index.js';
import { isSupportedLocale } from '../../shared/i18n/locales.js';
import { AudienceResearchRun } from './audience-research.model.js';
import { isTerminal, type AudienceResearchState } from './audience-research.state.js';
import { runAudienceResearchPipeline, type AudienceResearchPipelineDeps, } from './audience-research.pipeline.js';
export interface AudienceResearchProcessorDeps extends AudienceResearchPipelineDeps {
    logger: Logger;
}
export function createAudienceResearchProcessor(deps: AudienceResearchProcessorDeps): Processor<AudienceResearchJob, void> {
    const nowFn = deps.now ?? (() => new Date());
    const failInvalidLocaleJob = async (data: unknown): Promise<never> => {
        const candidate = data as Partial<Record<'accountId' | 'runId', unknown>> | null;
        if (candidate &&
            typeof candidate.accountId === 'string' &&
            typeof candidate.runId === 'string' &&
            Types.ObjectId.isValid(candidate.accountId) &&
            Types.ObjectId.isValid(candidate.runId)) {
            const completedAt = nowFn();
            await AudienceResearchRun.updateOne({
                _id: candidate.runId,
                accountId: candidate.accountId,
                state: { $nin: ['completed', 'partial', 'failed'] },
            }, {
                $set: {
                    state: 'failed',
                    terminal: {
                        state: 'failed',
                        reasonCode: 'processing_failure',
                        completedAt,
                    },
                    completedAt,
                },
            });
        }
        throw new UnrecoverableError('audience-research job has no valid frozen output locale');
    };
    return async (job: Job<AudienceResearchJob>) => {
        const parsed = audienceResearchJobSchema.safeParse(job.data);
        if (!parsed.success)
            return failInvalidLocaleJob(job.data);
        const payload = parsed.data;
        const doc = await AudienceResearchRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
        });
        if (!doc) {
            deps.logger.warn({ runId: payload.runId, accountId: payload.accountId }, 'audience-research processor: run not found; dropping job');
            return;
        }
        if (isTerminal(doc.state as AudienceResearchState)) {
            deps.logger.info({
                runId: payload.runId,
                state: doc.state,
            }, 'audience-research processor: terminal run on replay; no-op');
            return;
        }
        if (!isSupportedLocale(doc.input?.outputLocale) ||
            doc.input.outputLocale !== payload.outputLocale) {
            return failInvalidLocaleJob(payload);
        }
        await runAudienceResearchPipeline({
            runId: payload.runId,
            accountId: payload.accountId,
            siteId: payload.siteId,
            outputLocale: payload.outputLocale,
        }, deps);
    };
}
