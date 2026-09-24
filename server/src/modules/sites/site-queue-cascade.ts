import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Queues } from '../../shared/queue/index.js';
import { alertRules, scheduledReports } from '../../db/schema/index.js';
import { removeRankSchedule, } from '../../shared/queue/schedulers.js';
import { removePulseScheduler } from '../weekly-pulse/scheduler.js';
import { removeClientReportScheduler } from '../client-reports/scheduler.js';
import type { MongoSiteResourceInventory } from './site-mongo-cascade.js';
import { Site } from './sites.model.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
const REMOVABLE_JOB_STATES = [
    'wait',
    'waiting-children',
    'delayed',
    'prioritized',
    'paused',
    'completed',
    'failed',
] as const;
/** Fixed Redis page size: site deletion must not materialize an entire queue. */
export const SITE_QUEUE_CASCADE_PAGE_SIZE = 100;
export class SiteQueueBusyError extends Error {
    constructor() {
        super('site queue work is active');
        this.name = 'SiteQueueBusyError';
    }
}
export interface SiteQueueResourceIds {
    all: ReadonlySet<string>;
    scheduleIds: readonly string[];
    ruleIds: readonly string[];
}
function buildSiteQueueResourceIds(siteId: string, scheduleRows: readonly {
    id: string;
}[], ruleRows: readonly {
    id: string;
}[], mongo: MongoSiteResourceInventory): SiteQueueResourceIds {
    const scheduleIds = scheduleRows.map((row) => row.id);
    const ruleIds = ruleRows.map((row) => row.id);
    const all = new Set<string>([siteId, ...scheduleIds, ...ruleIds]);
    for (const ids of mongo.idsByModel.values()) {
        for (const id of ids)
            all.add(id);
    }
    return { all, scheduleIds, ruleIds };
}
export const siteQueueCascadeTestables = {
    buildSiteQueueResourceIds,
};
export async function collectSiteQueueResourceIds(db: ApplicationDb, siteId: string, mongo: MongoSiteResourceInventory): Promise<SiteQueueResourceIds> {
    const [scheduleRows, ruleRows] = await Promise.all([
        db
            .select({ id: scheduledReports.id })
            .from(scheduledReports)
            .where(eq(scheduledReports.siteId, siteId)),
        db.select({ id: alertRules.id }).from(alertRules).where(eq(alertRules.siteId, siteId)),
    ]);
    return buildSiteQueueResourceIds(siteId, scheduleRows, ruleRows, mongo);
}
/**
 * Merge the frozen queue manifest into the claimed Site and read back the
 * durable union. `$addToSet` makes concurrent retries monotonic and replay-safe.
 */
export async function persistSiteQueueResourceIds(accountId: string, siteId: string, resources: SiteQueueResourceIds): Promise<SiteQueueResourceIds> {
    const site = await Site.findOneAndUpdate({ _id: siteId, accountId, deletionStartedAt: { $ne: null } }, {
        $addToSet: {
            'deletionQueueResources.all': { $each: [...resources.all].sort() },
            'deletionQueueResources.scheduleIds': {
                $each: [...new Set(resources.scheduleIds)].sort(),
            },
            'deletionQueueResources.ruleIds': {
                $each: [...new Set(resources.ruleIds)].sort(),
            },
        },
    }, { new: true });
    if (!site)
        throw new Error('deleting site disappeared while freezing queue resources');
    const stored = site.deletionQueueResources;
    return {
        all: new Set(stored.all),
        scheduleIds: [...stored.scheduleIds],
        ruleIds: [...stored.ruleIds],
    };
}
function valueContainsResource(value: unknown, ids: ReadonlySet<string>): boolean {
    if (typeof value === 'string')
        return ids.has(value);
    if (Array.isArray(value))
        return value.some((item) => valueContainsResource(item, ids));
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some((item) => valueContainsResource(item, ids));
    }
    return false;
}
export function jobMatchesSiteResources(job: Pick<Job, 'data'>, ids: ReadonlySet<string>): boolean {
    return valueContainsResource(job.data, ids);
}
function productQueues(queues: Queues): Queue[] {
    return [
        queues.audits,
        queues.ranks,
        queues.gscSync,
        queues.ga4Sync,
        queues.contentAnalysis,
        queues.contentInventory,
        queues.internalLinks,
        queues.keywordClusters,
        queues.competitorContent,
        queues.competitorLandscapes,
        queues.contentMonitor,
        queues.audienceResearch,
        queues.weeklyPulse,
        queues.clientReports,
        queues.backlinkDeep,
        queues.trafficSnapshots,
        queues.reviewSync,
        queues.brandRadar,
        queues.contentBrief,
        queues.geogrid,
        queues.alertDispatch,
        queues.deadLetter,
    ];
}
async function queueHasActiveSiteJob(queue: Queue, ids: ReadonlySet<string>): Promise<boolean> {
    for (let start = 0;; start += SITE_QUEUE_CASCADE_PAGE_SIZE) {
        const jobs = await queue.getJobs(['active'], start, start + SITE_QUEUE_CASCADE_PAGE_SIZE - 1, true);
        if (jobs.some((job) => jobMatchesSiteResources(job, ids)))
            return true;
        if (jobs.length < SITE_QUEUE_CASCADE_PAGE_SIZE)
            return false;
    }
}
async function removeQueuedSiteJobs(queue: Queue, ids: ReadonlySet<string>): Promise<void> {
    // BullMQ applies `start/end` independently to EACH requested state before
    // concatenating the results. Paginating several states together therefore
    // skips state-local offsets. Walk every state independently. Removing a
    // match shifts later indexes left, so advance only by retained jobs.
    for (const state of REMOVABLE_JOB_STATES) {
        let start = 0;
        while (true) {
            const jobs = await queue.getJobs([state], start, start + SITE_QUEUE_CASCADE_PAGE_SIZE - 1, true);
            if (jobs.length === 0)
                break;
            let retained = 0;
            for (const job of jobs) {
                if (jobMatchesSiteResources(job, ids)) {
                    await job.remove();
                }
                else {
                    retained += 1;
                }
            }
            start += retained;
            if (jobs.length < SITE_QUEUE_CASCADE_PAGE_SIZE)
                break;
        }
    }
}
/** Removes schedulers and all non-active jobs rooted in the deleting site. */
export async function purgeSiteQueueData(queues: Queues | null, siteId: string, resources: SiteQueueResourceIds): Promise<void> {
    if (!queues)
        return;
    // Never tear data down under an active job. A correctly wrapped consumer
    // owns a Site work lease, so this normally makes the deletion claim return
    // busy before reaching Redis; this check also covers a rolling deploy with
    // an older active worker.
    for (const queue of productQueues(queues)) {
        if (await queueHasActiveSiteJob(queue, resources.all)) {
            throw new SiteQueueBusyError();
        }
    }
    await removeRankSchedule(queues.ranks, siteId);
    await removePulseScheduler(queues.weeklyPulse, siteId);
    for (const scheduleId of resources.scheduleIds) {
        await removeClientReportScheduler(queues.clientReports, scheduleId);
    }
    for (const queue of productQueues(queues)) {
        await removeQueuedSiteJobs(queue, resources.all);
    }
}
