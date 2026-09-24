/**
 * ga4-sync queue consumer.
 *
 * Runs an independent GA4 snapshot sync for one site — enqueued on connect /
 * GA4-property-change so the analytics card fills in without waiting. Mirrors
 * `gsc-sync.processor.ts`: parse the payload as a trust boundary (malformed →
 * UnrecoverableError → dead-letter, no retries), then delegate to the shared
 * `runGa4Sync`. GA4 is free Google quota, so there is no capacity gate here —
 * the API layer enforces the Pro tier before anything reaches this queue.
 */
import type { Job } from 'bullmq';
import { ga4SyncJobSchema, parseConsumedPayload } from '../../shared/queue/index.js';
import { runGa4Sync, type Ga4SyncDeps, type Ga4SyncResult, } from './google-analytics.service.js';
export function createGa4SyncProcessor(deps: Ga4SyncDeps) {
    return async (job: Job): Promise<Ga4SyncResult> => {
        const data = parseConsumedPayload(ga4SyncJobSchema, job.data);
        return runGa4Sync(data.accountId, data.siteId, deps);
    };
}
