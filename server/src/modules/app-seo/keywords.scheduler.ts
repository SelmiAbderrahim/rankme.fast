import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { appKeywords } from '../../db/schema/index.js';
import { APP_SEO_TRACKING_JOB_NAME, enqueueAppSeoTrackingJob, } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { appKeywordIsoWeek } from './weekly-checks.js';
export const APP_SEO_WEEKLY_SWEEP_JOB = 'app-seo-weekly-sweep';
export const APP_SEO_WEEKLY_SCHEDULER_KEY = 'app-seo-weekly-sweep';
export const APP_SEO_WEEKLY_CRON = '0 15 6 * * 1';
export interface AppKeywordSweepDeps {
    db: ApplicationDb;
    queue: Pick<Queue, 'add'>;
    logger: Pick<Logger, 'error'>;
    enabled: () => boolean;
    now?: () => Date;
}
function schedulerNow(now?: () => Date): Date {
    return now ? now() : new Date();
}
async function activeSiteIds(siteIds: string[]): Promise<Set<string>> {
    const sites = await Site.find({
        _id: { $in: [...new Set(siteIds)] },
        paused: false,
        deletionStartedAt: null,
    }, { _id: 1 }).lean();
    return new Set(sites.map((site) => String(site._id)));
}
export function createAppKeywordWeeklySweep(deps: AppKeywordSweepDeps) {
    return async (): Promise<{
        enqueued: number;
        skipped: number;
    }> => {
        if (!deps.enabled())
            return { enqueued: 0, skipped: 0 };
        const keywords = await deps.db
            .select()
            .from(appKeywords)
            .where(eq(appKeywords.active, true));
        const activeSites = await activeSiteIds(keywords.map((keyword) => keyword.siteId));
        const stamp = appKeywordIsoWeek(schedulerNow(deps.now));
        let enqueued = 0;
        let skipped = 0;
        for (const keyword of keywords) {
            if (!activeSites.has(keyword.siteId)) {
                skipped += 1;
                continue;
            }
            try {
                // The deterministic per-week job id makes a repeated sweep a no-op.
                await enqueueAppSeoTrackingJob(deps.queue, {
                    accountId: keyword.accountId,
                    siteId: keyword.siteId,
                    profileId: keyword.profileId,
                    keywordId: keyword.id,
                    reservationStamp: stamp,
                    manual: false,
                });
                enqueued += 1;
            }
            catch (error) {
                deps.logger.error({ err: error, keywordId: keyword.id, siteId: keyword.siteId }, 'app seo weekly keyword enqueue failed');
                skipped += 1;
            }
        }
        return { enqueued, skipped };
    };
}
export function createAppSeoTrackingDispatcher<TJob extends Pick<Job, 'name' | 'data'>>(input: {
    processKeyword: (job: TJob) => Promise<unknown>;
    weeklySweep: () => Promise<unknown>;
}) {
    return (job: TJob): Promise<unknown> => {
        if (job.name === APP_SEO_WEEKLY_SWEEP_JOB)
            return input.weeklySweep();
        if (job.name === APP_SEO_TRACKING_JOB_NAME)
            return input.processKeyword(job);
        throw new Error(`unknown app seo tracking job: ${job.name}`);
    };
}
export async function upsertAppSeoTrackingSchedulers(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
    await queue.upsertJobScheduler(APP_SEO_WEEKLY_SCHEDULER_KEY, { pattern: APP_SEO_WEEKLY_CRON, tz: 'UTC' }, { name: APP_SEO_WEEKLY_SWEEP_JOB, data: {} });
}
export const appKeywordSchedulerTestables = Object.freeze({
    schedulerNow,
    activeSiteIds,
});
