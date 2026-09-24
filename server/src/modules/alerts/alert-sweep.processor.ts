/**
 * `alert-detection-sweep` consumer.
 *
 * A deterministic scheduler tick that turns recently-CONFIRMED rank drops into
 * `alert-dispatch` jobs. It reads `rank_drop_confirmations` and writes nothing
 * to it — the sweep is safe to re-run because idempotency lives on
 * `alert_deliveries.idempotency_key`, not on a claim column.
 */
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import { runAlertDetectionSweep, type AlertDetectionDeps } from './alert-detection.service.js';
export const ALERT_SWEEP_QUEUE = 'alert-detection-sweep';
export const ALERT_SWEEP_JOB = 'alert-detection-sweep';
export const ALERT_SWEEP_SCHEDULER_KEY = 'alert-detection-sweep-scheduler';
/**
 * Operator-tunable cadence (default five minutes, matching the shipped
 * content-monitor reconciliation sweep). Purely a latency knob: the sweep is
 * read-only and re-running it cannot re-deliver.
 */
export const alertSweepIntervalMs = (): number => env.ALERT_SWEEP_INTERVAL_MS;
export function createAlertSweepProcessor(deps: AlertDetectionDeps & {
    logger?: Logger;
    now?: () => Date;
}) {
    return async (): Promise<void> => {
        const outcome = await runAlertDetectionSweep(deps);
        if (outcome.dispatched > 0) {
            deps.logger?.info({ examined: outcome.examined, dispatched: outcome.dispatched }, 'alert detection sweep dispatched confirmed rank drops');
        }
    };
}
