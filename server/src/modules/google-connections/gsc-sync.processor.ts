/**
 * gsc-sync queue consumer.
 *
 * Runs an independent GSC snapshot sync for one site — enqueued on connect,
 * property-change, or by the durable daily producer. Mirrors the audit/rank
 * processor shape: parse the payload as a
 * trust boundary (malformed → UnrecoverableError → dead-letter, no retries),
 * then delegate to the shared `runGscSync`. GSC is free Google quota, so there
 * is no capacity gate here.
 */
import type { Job } from 'bullmq';
import { gscSyncJobSchema, parseConsumedPayload } from '../../shared/queue/index.js';
import { runGscSync, type GscSyncDeps, type GscSyncResult, } from './google-connections.service.js';
export function createGscSyncProcessor(deps: GscSyncDeps) {
    return async (job: Job): Promise<GscSyncResult> => {
        const data = parseConsumedPayload(gscSyncJobSchema, job.data);
        return runGscSync(data.accountId, data.siteId, data.domain, deps);
    };
}
