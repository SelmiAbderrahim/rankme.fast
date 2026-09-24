import type { Job, Queue } from 'bullmq';
import type { Queues } from '../../shared/queue/index.js';
const REMOVABLE_JOB_STATES = [
    'wait',
    'waiting-children',
    'delayed',
    'prioritized',
    'paused',
    'completed',
    'failed',
] as const;
export const ACCOUNT_QUEUE_CASCADE_PAGE_SIZE = 100;
export class AccountQueueBusyError extends Error {
    constructor() {
        super('account queue work is active');
        this.name = 'AccountQueueBusyError';
    }
}
export class AccountQueueUnavailableError extends Error {
    constructor() {
        super('account queue inventory is unavailable');
        this.name = 'AccountQueueUnavailableError';
    }
}
/** Every account-bearing product queue. accountPurge is handled separately. */
function accountWorkQueues(queues: Queues): Queue[] {
    return [...new Set([
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
        ])];
}
function valueMatchesAccount(value: unknown, accountId: string, userIdAllowed = false): boolean {
    if (Array.isArray(value)) {
        return value.some((item) => valueMatchesAccount(item, accountId, false));
    }
    if (!value || typeof value !== 'object')
        return false;
    const record = value as Record<string, unknown>;
    if (record.accountId === accountId)
        return true;
    if (userIdAllowed && record.userId === accountId)
        return true;
    return Object.entries(record).some(([key, nested]) => valueMatchesAccount(nested, accountId, key === 'original'));
}
/** Matches only ownership fields, never an arbitrary user-supplied string. */
export function jobMatchesAccount(job: Pick<Job, 'data'>, accountId: string): boolean {
    return valueMatchesAccount(job.data, accountId, true);
}
async function queueHasActiveAccountJob(queue: Queue, accountId: string): Promise<boolean> {
    for (let start = 0;; start += ACCOUNT_QUEUE_CASCADE_PAGE_SIZE) {
        const jobs = await queue.getJobs(['active'], start, start + ACCOUNT_QUEUE_CASCADE_PAGE_SIZE - 1, true);
        if (jobs.some((job) => jobMatchesAccount(job, accountId)))
            return true;
        if (jobs.length < ACCOUNT_QUEUE_CASCADE_PAGE_SIZE)
            return false;
    }
}
async function removeQueuedAccountJobs(queue: Queue, accountId: string): Promise<void> {
    // BullMQ applies pagination to each requested state independently. Walk one
    // state at a time, and advance by retained rows because removals shift the
    // remaining indexes left.
    for (const state of REMOVABLE_JOB_STATES) {
        let start = 0;
        while (true) {
            const jobs = await queue.getJobs([state], start, start + ACCOUNT_QUEUE_CASCADE_PAGE_SIZE - 1, true);
            if (jobs.length === 0)
                break;
            let retained = 0;
            for (const job of jobs) {
                if (jobMatchesAccount(job, accountId)) {
                    await job.remove();
                }
                else {
                    retained += 1;
                }
            }
            start += retained;
            if (jobs.length < ACCOUNT_QUEUE_CASCADE_PAGE_SIZE)
                break;
        }
    }
}
async function removeAccountSchedulers(queue: Queue, accountId: string): Promise<void> {
    let start = 0;
    while (true) {
        const schedulers = await queue.getJobSchedulers(start, start + ACCOUNT_QUEUE_CASCADE_PAGE_SIZE - 1, true);
        if (schedulers.length === 0)
            return;
        let retained = 0;
        for (const scheduler of schedulers) {
            if (valueMatchesAccount(scheduler.template?.data, accountId, true)) {
                await queue.removeJobScheduler(scheduler.key);
            }
            else {
                retained += 1;
            }
        }
        start += retained;
        if (schedulers.length < ACCOUNT_QUEUE_CASCADE_PAGE_SIZE)
            return;
    }
}
/**
 * Fail closed without Redis, refuse to purge under active account work, then
 * remove every scheduler/non-active job. The currently executing purge job is
 * intentionally excluded from the active scan and from state removal.
 */
export async function purgeAccountQueueData(queues: Queues | null, accountId: string): Promise<void> {
    if (!queues)
        throw new AccountQueueUnavailableError();
    const workQueues = accountWorkQueues(queues);
    for (const queue of workQueues) {
        if (await queueHasActiveAccountJob(queue, accountId)) {
            throw new AccountQueueBusyError();
        }
    }
    for (const queue of workQueues) {
        await removeAccountSchedulers(queue, accountId);
    }
    for (const queue of [...new Set([...workQueues, queues.accountPurge])]) {
        await removeQueuedAccountJobs(queue, accountId);
    }
}
