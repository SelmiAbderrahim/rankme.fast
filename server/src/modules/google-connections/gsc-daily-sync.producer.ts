/**
 * Durable daily GSC snapshot producer (community request 04).
 *
 * The existing `gsc-sync` jobs are the live-call boundary. This producer only
 * scans owned Mongo records and fans out validated, deterministic daily jobs;
 * it never resolves an OAuth token or invokes a provider itself.
 */
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { Logger } from 'pino';
import { z } from 'zod';
import { GOOGLE_SITE_AUTO_MATCH_JOB_NAME, GSC_SYNC_JOB_NAME, parseConsumedPayload, type GscSyncJob, } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { GoogleConnection } from './google-connection.model.js';
import { SCOPE_GSC } from './google-connections.schema.js';
import { toIsoDate } from './google-connections.service.js';
export const GSC_DAILY_SYNC_SWEEP_JOB = 'gsc-daily-sync-sweep';
export const GSC_DAILY_SYNC_SCHEDULER_KEY = 'gsc-daily-sync-scheduler';
export const GSC_DAILY_SYNC_CRON = '17 4 * * *';
const gscDailySyncSweepJobSchema = z
    .object({ source: z.literal('daily-scheduler') })
    .strict();
export interface GscConnectedAccount {
    accountId: string;
}
export interface GscActiveSite {
    siteId: string;
    domain: string;
}
export interface GscDailySyncRepository {
    scanConnectedAccounts(): AsyncIterable<GscConnectedAccount>;
    findActiveSites(accountId: string): Promise<GscActiveSite[]>;
}
export interface GscDailySyncProducerResult {
    day: string;
    connectionsScanned: number;
    sitesScanned: number;
    enqueued: number;
}
export interface GscDailySyncProducerDeps {
    repository: GscDailySyncRepository;
    enqueue(payload: GscSyncJob, day: string): Promise<unknown>;
    now(): Date;
    logger: Pick<Logger, 'info'>;
}
type QueueProcessor<T> = (job: Job) => Promise<T>;
/**
 * Mongo implementation of the producer's account boundary.
 *
 * Connection scanning requires every eligibility marker up front: a live
 * connection and the GSC scope. Site lookup is constrained by the same
 * account and returns only active Sites with their own selected property.
 */
export function createMongoGscDailySyncRepository(): GscDailySyncRepository {
    return {
        async *scanConnectedAccounts() {
            const cursor = GoogleConnection.aggregate<GscConnectedAccount>([
                {
                    $match: {
                        status: 'connected',
                        scopes: SCOPE_GSC,
                    },
                },
                {
                    $project: {
                        _id: 0,
                        accountId: { $toString: '$accountId' },
                    },
                },
            ]).cursor({ batchSize: 100 });
            for await (const connection of cursor) {
                yield connection;
            }
        },
        async findActiveSites(accountId) {
            const sites = await Site.find({
                accountId,
                paused: { $ne: true },
                deletionStartedAt: null,
                gscPropertyUrl: { $type: 'string', $ne: '' },
            })
                .select({ _id: 1, domain: 1 })
                .lean();
            return sites.map((site) => ({
                siteId: String(site._id),
                domain: site.domain,
            }));
        },
    };
}
/**
 * Add/remove the single durable scheduler. BullMQ v5 upserts by key, so
 * repeated worker boots and horizontally scaled workers converge on one UTC
 * schedule. Disabling removes future ticks only; consumers remain subscribed.
 */
export async function configureGscDailySyncScheduler(queue: Queue, enabled: boolean): Promise<void> {
    if (enabled) {
        await queue.upsertJobScheduler(GSC_DAILY_SYNC_SCHEDULER_KEY, { pattern: GSC_DAILY_SYNC_CRON, tz: 'UTC' }, {
            name: GSC_DAILY_SYNC_SWEEP_JOB,
            data: { source: 'daily-scheduler' },
        });
        return;
    }
    await queue.removeJobScheduler(GSC_DAILY_SYNC_SCHEDULER_KEY);
}
/**
 * Create the sweep processor. Queue failures deliberately propagate: BullMQ
 * retries the sweep, while deterministic per-site/day job IDs make replay
 * safe for the sites already fanned out before the failure.
 */
export function createGscDailySyncProducer(deps: GscDailySyncProducerDeps) {
    return async (job: Job): Promise<GscDailySyncProducerResult> => {
        parseConsumedPayload(gscDailySyncSweepJobSchema, job.data);
        const day = toIsoDate(deps.now());
        let connectionsScanned = 0;
        let sitesScanned = 0;
        let enqueued = 0;
        for await (const connection of deps.repository.scanConnectedAccounts()) {
            connectionsScanned += 1;
            const sites = await deps.repository.findActiveSites(connection.accountId);
            sitesScanned += sites.length;
            for (const site of sites) {
                await deps.enqueue({
                    accountId: connection.accountId,
                    siteId: site.siteId,
                    domain: site.domain,
                }, day);
                enqueued += 1;
            }
        }
        const result = { day, connectionsScanned, sitesScanned, enqueued };
        deps.logger.info(result, 'daily gsc sync producer completed');
        return result;
    };
}
/** Route the trusted Google job names that intentionally share `gsc-sync`. */
export function createGscSyncQueueDispatcher<TSync, TProducer, TAutoMatch>(syncProcessor: QueueProcessor<TSync>, dailyProducer: QueueProcessor<TProducer>, autoMatchProcessor?: QueueProcessor<TAutoMatch>): QueueProcessor<TSync | TProducer | TAutoMatch> {
    return async (job) => {
        if (job.name === GSC_SYNC_JOB_NAME)
            return syncProcessor(job);
        if (job.name === GSC_DAILY_SYNC_SWEEP_JOB)
            return dailyProducer(job);
        if (job.name === GOOGLE_SITE_AUTO_MATCH_JOB_NAME) {
            if (autoMatchProcessor)
                return autoMatchProcessor(job);
        }
        throw new UnrecoverableError(`unknown gsc-sync job name: ${job.name}`);
    };
}
