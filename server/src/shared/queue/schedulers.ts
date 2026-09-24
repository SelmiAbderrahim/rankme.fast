/**
 * Rank-tracking job schedulers.
 *
 * BullMQ v5 repeatables use the Job Schedulers API (`upsertJobScheduler`) —
 * the legacy `repeat` option is deprecated. Upserts are idempotent, so the
 * api may call these at every boot; the per-site schedule wiring imports
 * these helpers.
 *
 * Cadence → 6-field cron (sec min hour dom mon dow), 06:xx UTC, with the
 * minute derived from a hash of the siteId so thousands of sites don't all
 * fire vendor calls in the same minute.
 */
import type { Job, Queue } from 'bullmq';
import { RANK_JOB_NAME } from './queues.js';
import { parsePayload, rankJobSchema, type RankJob } from './payloads.js';
export type RankCadence = 'daily' | 'weekly';
/** FNV-1a over the siteId, folded into a 0–59 minute offset. */
export function minuteOffset(siteId: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < siteId.length; i += 1) {
        hash ^= siteId.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % 60;
}
export function rankCronPattern(cadence: RankCadence, siteId: string): string {
    const minute = minuteOffset(siteId);
    // Weekly default: Mondays 06:xx UTC. Daily: every day 06:xx UTC.
    return cadence === 'weekly' ? `0 ${minute} 6 * * 1` : `0 ${minute} 6 * * *`;
}
export function rankSchedulerKey(siteId: string): string {
    return `rank-schedule:${siteId}`;
}
export interface RankScheduleInput {
    accountId: string;
    siteId: string;
    cadence: RankCadence;
    keywordIds?: string[];
    /** Snapshot copied into each future scheduler job. */
    altEnginesEnabled: boolean;
}
/**
 * Creates or updates the repeatable rank check for a site. Same key ⇒ same
 * scheduler: calling this twice (or switching cadence) never duplicates.
 */
export async function upsertRankSchedule(queue: Queue, input: RankScheduleInput): Promise<Job | undefined> {
    const data: RankJob = parsePayload(rankJobSchema, {
        accountId: input.accountId,
        siteId: input.siteId,
        keywordIds: input.keywordIds ?? [],
        schedulerKey: rankSchedulerKey(input.siteId),
        altEnginesEnabledAtEnqueue: input.altEnginesEnabled,
    });
    return queue.upsertJobScheduler(rankSchedulerKey(input.siteId), { pattern: rankCronPattern(input.cadence, input.siteId), tz: 'UTC' }, { name: RANK_JOB_NAME, data });
}
/** Removes the site's rank scheduler; true when one existed. */
export async function removeRankSchedule(queue: Queue, siteId: string): Promise<boolean> {
    return queue.removeJobScheduler(rankSchedulerKey(siteId));
}
