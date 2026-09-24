/**
 * Weekly ASO observation helpers shared by keyword and chart tracking.
 *
 * Every scheduled or manual check for one tracked resource in one ISO week
 * shares a deterministic BullMQ job id, so the queue itself is the
 * idempotency boundary; the Postgres snapshot for the week's Monday is the
 * durable evidence that the check already ran.
 */
export function appKeywordIsoWeek(now: Date): string {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const year = date.getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const week = Math.ceil(((date.getTime() - start) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}
export function appKeywordWeekStart(stamp: string): Date {
    const [yearText, weekText] = stamp.slice(0, 8).split('-W');
    const year = Number(yearText);
    const week = Number(weekText);
    const fourth = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(fourth);
    monday.setUTCDate(fourth.getUTCDate() - ((fourth.getUTCDay() || 7) - 1) + (week - 1) * 7);
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
}
export interface WeeklyCheckJob {
    getState(): Promise<string>;
    retry(state?: 'failed' | 'completed'): Promise<void>;
    remove(): Promise<void>;
    finishedOn?: number;
}
export interface WeeklyCheckQueue {
    getJob(id: string): Promise<WeeklyCheckJob | undefined>;
}
export type WeeklyCheckJobStatus = {
    status: 'queued';
} | {
    status: 'failed';
    failedAt: Date | null;
};
/**
 * Queue a manual weekly check without being blocked by BullMQ's retained,
 * deterministic job id: waiting/active/delayed jobs already represent the
 * check, a failed job retries in place, and a completed job that left no
 * snapshot is replaced.
 */
export async function ensureWeeklyCheckJob(queue: WeeklyCheckQueue, jobId: string, enqueue: () => Promise<unknown>): Promise<void> {
    const existing = await queue.getJob(jobId);
    if (!existing) {
        await enqueue();
        return;
    }
    const state = await existing.getState();
    if (state === 'failed') {
        await existing.retry('failed');
        return;
    }
    if (state === 'completed') {
        await existing.remove();
        await enqueue();
    }
}
/** Pending or failed state of this week's job; `null` when none is retained or it completed. */
export async function readWeeklyCheckJobStatus(queue: WeeklyCheckQueue, jobId: string): Promise<WeeklyCheckJobStatus | null> {
    const job = await queue.getJob(jobId);
    if (!job)
        return null;
    const state = await job.getState();
    if (state === 'completed' || state === 'unknown')
        return null;
    if (state === 'failed') {
        return { status: 'failed', failedAt: job.finishedOn ? new Date(job.finishedOn) : null };
    }
    return { status: 'queued' };
}
