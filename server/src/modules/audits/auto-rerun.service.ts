/**
 * Auto audit re-run on rank drop.
 *
 * Called from the rank-drop handler (modules/ranks) through this module's
 * public API. Every guard SKIPS silently (logged outcome, never a throw) —
 * a background trigger must not fail the rank job.
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { enqueueAuditJob } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { AuditRun } from './audit-run.model.js';
import { AUDIT_PAGE_CAP_MAX } from './audits.schema.js';
export const AUTO_RERUN_TRIGGER = 'rank-drop' as const;
/** At most one auto re-run per site per day — a manual or auto run inside
 * the window (that didn't fail) already gives the user a fresh report. */
export const AUTO_RERUN_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export type AutoRerunOutcome = {
    enqueued: true;
    runId: string;
} | {
    enqueued: false;
    reason: 'queue-unavailable' | 'site-not-found' | 'site-paused' | 'run-in-flight' | 'recent-run';
};
export interface AutoRerunDeps {
    auditsQueue: Queue | null;
    logger: Logger;
    now?: () => Date;
}
export async function requestAutoAuditRerun(input: {
    accountId: string;
    siteId: string;
}, deps: AutoRerunDeps): Promise<AutoRerunOutcome> {
    const now = deps.now ?? (() => new Date());
    const skip = (reason: Exclude<AutoRerunOutcome, {
        enqueued: true;
    }>['reason']): AutoRerunOutcome => {
        deps.logger.info({ ...input, reason }, 'auto audit re-run skipped');
        return { enqueued: false, reason };
    };
    if (!deps.auditsQueue)
        return skip('queue-unavailable');
    // Account-scoped ownership read — a cross-account trigger can never
    // start a run on another account's site.
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        return skip('site-not-found');
    if (site.paused === true)
        return skip('site-paused');
    const inFlight = await AuditRun.exists({
        siteId: site._id,
        status: { $in: ['queued', 'running'] },
    });
    if (inFlight)
        return skip('run-in-flight');
    const windowStart = new Date(now().getTime() - AUTO_RERUN_MIN_INTERVAL_MS);
    const recent = await AuditRun.exists({
        siteId: site._id,
        createdAt: { $gte: windowStart },
        status: { $nin: ['failed', 'unavailable'] },
    });
    if (recent)
        return skip('recent-run');
    const pageCap = AUDIT_PAGE_CAP_MAX;
    const run = await AuditRun.create({
        accountId: input.accountId,
        siteId: site._id,
        status: 'queued',
        pageCap,
        trigger: AUTO_RERUN_TRIGGER,
    });
    await enqueueAuditJob(deps.auditsQueue, {
        accountId: input.accountId,
        siteId: site.id as string,
        runId: run.id as string,
        pageCap,
    });
    deps.logger.info({ ...input, runId: run.id as string }, 'auto audit re-run enqueued after rank drop');
    return { enqueued: true, runId: run.id as string };
}
