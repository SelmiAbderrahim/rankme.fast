/**
 * BullMQ queue snapshot.
 *
 * Reads waiting/active/failed counts for the work queues (audits, ranks,
 * audience-research, weekly-pulse) plus the DLQ
 * size + oldest-job timestamp. Injected into the worker health payload so
 * `GET /health` reports the same shape the api serves from the admin overview
 * — one authoritative queue-stats module, two consumers.
 */
import type { Queue } from 'bullmq';
import type { QueueSnapshot, QueueDepthSnapshot, DeadLetterSnapshot } from './health.js';
export interface CollectQueueSnapshotDeps {
    audits: Queue | null;
    ranks: Queue | null;
    /** Optional — older callers (admin DLQ-only overview) omit these; the
     * snapshot reports zeros for an omitted queue. */
    audienceResearch?: Queue | null;
    weeklyPulse?: Queue | null;
    competitorLandscapes?: Queue | null;
    backlinkDeep?: Queue | null;
    trafficSnapshots?: Queue | null;
    reviewSync?: Queue | null;
    brandRadar?: Queue | null;
    deadLetter: Queue | null;
}
async function readDepth(q: Queue | null): Promise<QueueDepthSnapshot> {
    if (!q)
        return { waiting: 0, active: 0, failed: 0, oldestPendingAt: null };
    const counts = await q.getJobCounts('waiting', 'active', 'failed');
    const pending = await q.getJobs(['waiting', 'delayed'], 0, 0, true);
    const oldestTimestamp = pending
        .map((job) => job.timestamp)
        .filter((timestamp): timestamp is number => typeof timestamp === 'number' && Number.isFinite(timestamp))
        .sort((left, right) => left - right)[0];
    return {
        waiting: Number(counts.waiting ?? 0),
        active: Number(counts.active ?? 0),
        failed: Number(counts.failed ?? 0),
        oldestPendingAt: oldestTimestamp === undefined ? null : new Date(oldestTimestamp).toISOString(),
    };
}
async function readDeadLetter(q: Queue | null): Promise<DeadLetterSnapshot> {
    if (!q)
        return { size: 0, oldest: null };
    const counts = await q.getJobCounts('waiting', 'completed', 'delayed');
    const size = Number(counts.waiting ?? 0) +
        Number(counts.completed ?? 0) +
        Number(counts.delayed ?? 0);
    if (size === 0) {
        return { size: 0, oldest: null };
    }
    // asc=true — oldest first. Take the head of each candidate state and pick
    // the earliest timestamp across them.
    const [waiting, delayed, completed] = await Promise.all([
        q.getJobs(['waiting'], 0, 0, true),
        q.getJobs(['delayed'], 0, 0, true),
        q.getJobs(['completed'], 0, 0, true),
    ]);
    const timestamps = [...waiting, ...delayed, ...completed]
        .map((job) => job.timestamp)
        .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
    if (timestamps.length === 0) {
        return { size, oldest: null };
    }
    const min = Math.min(...timestamps);
    return { size, oldest: new Date(min).toISOString() };
}
export async function collectQueueSnapshot(deps: CollectQueueSnapshotDeps): Promise<QueueSnapshot> {
    const [audits, ranks, audienceResearch, weeklyPulse, competitorLandscapes, backlinkDeep, trafficSnapshots, reviewSync, brandRadar, dlq,] = await Promise.all([
        readDepth(deps.audits),
        readDepth(deps.ranks),
        readDepth(deps.audienceResearch ?? null),
        readDepth(deps.weeklyPulse ?? null),
        readDepth(deps.competitorLandscapes ?? null),
        readDepth(deps.backlinkDeep ?? null),
        readDepth(deps.trafficSnapshots ?? null),
        readDepth(deps.reviewSync ?? null),
        readDepth(deps.brandRadar ?? null),
        readDeadLetter(deps.deadLetter),
    ]);
    const hasMarketQueues = deps.backlinkDeep !== undefined ||
        deps.trafficSnapshots !== undefined ||
        deps.reviewSync !== undefined ||
        deps.brandRadar !== undefined;
    return {
        audits,
        ranks,
        audienceResearch,
        weeklyPulse,
        ...(deps.competitorLandscapes !== undefined
            ? { competitorLandscapes }
            : {}),
        ...(hasMarketQueues
            ? {
                market: {
                    'backlink-deep': backlinkDeep,
                    'traffic-snapshots': trafficSnapshots,
                    'review-sync': reviewSync,
                    'brand-radar': brandRadar,
                },
            }
            : {}),
        dlq,
    };
}
