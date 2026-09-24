/**
 * `alert-dispatch` queue consumer.
 *
 * The processor is a thin shell over `dispatchAlert`: parse the payload (the
 * queue is a trust boundary), run the fan-out, and re-throw when at least one
 * leg failed so BullMQ retries with the shipped exponential backoff. At
 * `ALERT_MAX_ATTEMPTS` the service has already written the terminal
 * `suppressed`/`retries_exhausted` rows, so the throw routes the job into the
 * shipped dead-letter queue instead of looping forever.
 */
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { alertDispatchJobSchema, parseConsumedPayload } from '../../shared/queue/payloads.js';
import { dispatchAlert, type DispatchAlertDeps } from './alert-dispatch.service.js';
export class AlertDispatchIncompleteError extends Error {
    constructor(ruleId: string, failed: number) {
        super(`alert dispatch incomplete for rule ${ruleId}: ${failed} leg(s) failed`);
        this.name = 'AlertDispatchIncompleteError';
    }
}
export interface AlertDispatchProcessorDeps extends DispatchAlertDeps {
    logger?: Logger;
}
export function createAlertDispatchProcessor(deps: AlertDispatchProcessorDeps) {
    return async (job: Job): Promise<void> => {
        const payload = parseConsumedPayload(alertDispatchJobSchema, job.data);
        const outcome = await dispatchAlert({
            accountId: payload.accountId,
            ruleId: payload.ruleId,
            transitionId: payload.transitionId,
            evidence: payload.evidence,
            // BullMQ counts attempts from 0 while the delivery row is 1-based.
            attempt: (job.attemptsMade ?? 0) + 1,
        }, deps);
        deps.logger?.info({
            ruleId: payload.ruleId,
            sent: outcome.sent,
            failed: outcome.failed,
            exhausted: outcome.exhausted,
            suppressed: outcome.suppressed,
            skipped: outcome.skipped,
        }, 'alert dispatch settled');
        if (outcome.shouldThrow) {
            throw new AlertDispatchIncompleteError(payload.ruleId, outcome.failed + outcome.exhausted);
        }
    };
}
