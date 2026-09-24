import type { Job, Queue } from 'bullmq';
import type { Logger } from 'pino';
import { APP_SEO_CHART_JOB_NAME, enqueueAppSeoChartJob, } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { AppChartSubscription } from './charts.model.js';
import { appKeywordIsoWeek } from './weekly-checks.js';
export const APP_CHART_WEEKLY_SWEEP_JOB = 'app-chart-weekly-sweep';
export const APP_CHART_WEEKLY_SCHEDULER_KEY = 'app-chart-weekly-sweep';
export const APP_CHART_WEEKLY_CRON = '0 30 6 * * 1';
export interface AppChartSweepDeps {
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
export function createAppChartWeeklySweep(deps: AppChartSweepDeps) {
    return async (): Promise<{
        enqueued: number;
        skipped: number;
    }> => {
        if (!deps.enabled())
            return { enqueued: 0, skipped: 0 };
        const subscriptions = await AppChartSubscription.find({}).lean();
        const activeSites = await activeSiteIds(subscriptions.map((item) => String(item.siteId)));
        const stamp = appKeywordIsoWeek(schedulerNow(deps.now));
        let enqueued = 0;
        let skipped = 0;
        for (const subscription of subscriptions) {
            if (!activeSites.has(String(subscription.siteId))) {
                skipped += 1;
                continue;
            }
            try {
                // The deterministic per-week job id makes a repeated sweep a no-op.
                await enqueueAppSeoChartJob(deps.queue, {
                    accountId: String(subscription.accountId),
                    siteId: String(subscription.siteId),
                    profileId: String(subscription.profileId),
                    subscriptionId: String(subscription._id),
                    reservationStamp: stamp,
                    manual: false,
                });
                enqueued += 1;
            }
            catch (error) {
                deps.logger.error({ err: error, subscriptionId: String(subscription._id), siteId: String(subscription.siteId) }, 'app chart weekly enqueue failed');
                skipped += 1;
            }
        }
        return { enqueued, skipped };
    };
}
export function dispatchAppChartJob<TJob extends Pick<Job, 'name'>>(input: {
    job: TJob;
    processChart: (job: TJob) => Promise<unknown>;
    weeklySweep: () => Promise<unknown>;
}): Promise<unknown> | null {
    if (input.job.name === APP_CHART_WEEKLY_SWEEP_JOB)
        return input.weeklySweep();
    if (input.job.name === APP_SEO_CHART_JOB_NAME)
        return input.processChart(input.job);
    return null;
}
export async function upsertAppChartSchedulers(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
    await queue.upsertJobScheduler(APP_CHART_WEEKLY_SCHEDULER_KEY, { pattern: APP_CHART_WEEKLY_CRON, tz: 'UTC' }, { name: APP_CHART_WEEKLY_SWEEP_JOB, data: {} });
}
export const appChartSchedulerTestables = Object.freeze({
    schedulerNow,
    activeSiteIds,
});
