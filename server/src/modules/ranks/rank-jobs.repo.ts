import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { keywords, rankCheckJobItems, rankCheckJobs, type RankCheckFailureReason,
  type RankCheckItemReason, type RankCheckItemState, type RankCheckJobItemRow,
  type RankCheckJobRow, type RankCheckJobScope, type RankCheckJobStatus } from '../../db/schema/index.js';

export const RANK_JOB_DEADLINE_MS = 15 * 60_000;
export const RANK_JOB_MAX_DEADLINE_MS = 60 * 60_000;
export const RANK_JOB_POST_CHUNK = 100;
export const RANK_JOB_SETTLE_MARGIN_MS = 2 * 60_000;
const SWEEP_BATCH = 100;
const OPEN_STATES = ['queued', 'running'] as const satisfies readonly RankCheckItemState[];
type TerminalState = Exclude<RankCheckItemState, 'queued' | 'running'>;

export function serpTaskPollWindowMs(): number {
  return env.SERP_TASK_POLL_INTERVAL_MS * env.SERP_TASK_MAX_POLL_ATTEMPTS;
}

export function rankJobDeadlineMs(googleItemCount: number, pollWindowMs = serpTaskPollWindowMs()): number {
  return Math.min(RANK_JOB_MAX_DEADLINE_MS,
    RANK_JOB_DEADLINE_MS + Math.ceil(googleItemCount / RANK_JOB_POST_CHUNK) * pollWindowMs);
}

export interface RankJobTarget { keywordId: string; engine: string; trackLocalPack: boolean }
export interface RankJobItemDto {
  keywordId: string; engine: string; state: RankCheckItemState; reason: RankCheckItemReason | null;
  attempts: number; finishedAt: string | null;
}
export interface RankJobTotals {
  total: number; queued: number; running: number; succeeded: number; failed: number;
  expired: number; cancelled: number;
}
export interface RankJobDto {
  id: string; siteId: string; scope: RankCheckJobScope; status: RankCheckJobStatus;
  retryOfJobId: string | null; createdAt: string; startedAt: string | null;
  finishedAt: string | null; deadlineAt: string; totals: RankJobTotals; items: RankJobItemDto[];
}

const isOpen = (state: RankCheckItemState): boolean => state === 'queued' || state === 'running';

export function rankJobTotals(items: readonly RankCheckJobItemRow[]): RankJobTotals {
  const totals: RankJobTotals = { total: items.length, queued: 0, running: 0, succeeded: 0,
    failed: 0, expired: 0, cancelled: 0 };
  for (const item of items) totals[item.state] += 1;
  return totals;
}

export function deriveRankJobStatus(items: readonly RankCheckJobItemRow[]): RankCheckJobStatus {
  const totals = rankJobTotals(items);
  if (totals.queued + totals.running > 0) {
    return totals.running > 0 || items.some((item) => item.attempts > 0 || item.finishedAt !== null)
      ? 'running' : 'queued';
  }
  const unsuccessful = totals.failed + totals.expired;
  if (totals.succeeded + unsuccessful === 0) return 'cancelled';
  if (unsuccessful === 0) return 'succeeded';
  return totals.succeeded === 0 ? 'failed' : 'partial';
}

export function toRankJobDto(job: RankCheckJobRow, items: readonly RankCheckJobItemRow[]): RankJobDto {
  return { id: job.id, siteId: job.siteId, scope: job.scope, status: job.status,
    retryOfJobId: job.retryOfJobId, createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null,
    deadlineAt: job.deadlineAt.toISOString(), totals: rankJobTotals(items),
    items: items.map((item) => ({ keywordId: item.keywordId, engine: item.engine,
      state: item.state, reason: item.reason, attempts: item.attempts,
      finishedAt: item.finishedAt?.toISOString() ?? null })) };
}

async function loadItems(db: Db, jobId: string): Promise<RankCheckJobItemRow[]> {
  return db.select().from(rankCheckJobItems).where(eq(rankCheckJobItems.jobId, jobId))
    .orderBy(asc(rankCheckJobItems.id));
}

export interface InsertRankJobInput {
  accountId: string; siteId: string; scope: RankCheckJobScope; idempotencyKey: string | null;
  retryOfJobId: string | null; targets: readonly RankJobTarget[]; now: Date;
}

/** Persist the complete requested set before queueing, so every item has a terminal outcome. */
export async function insertRankCheckJob(db: Db, input: InsertRankJobInput): Promise<RankJobDto> {
  return db.transaction(async (tx) => {
    const [job] = await tx.insert(rankCheckJobs).values({ accountId: input.accountId,
      siteId: input.siteId, scope: input.scope, idempotencyKey: input.idempotencyKey,
      retryOfJobId: input.retryOfJobId, status: 'queued', createdAt: input.now,
      deadlineAt: new Date(input.now.getTime() + rankJobDeadlineMs(
        input.targets.filter((target) => target.engine === 'google').length)), updatedAt: input.now }).returning();
    if (!job) throw new Error('rank job insert returned no row');
    const items = input.targets.length === 0 ? [] : await tx.insert(rankCheckJobItems).values(
      input.targets.map((target) => ({ jobId: job.id, keywordId: target.keywordId,
        engine: target.engine, updatedAt: input.now }))).returning();
    return toRankJobDto(job, [...items].sort((a, b) => a.id.localeCompare(b.id)));
  });
}

async function withItems(db: Db, job: RankCheckJobRow | undefined): Promise<RankJobDto | null> {
  return job ? toRankJobDto(job, await loadItems(db, job.id)) : null;
}

export async function findRankJobByIdempotencyKey(db: Db, input: {
  accountId: string; siteId: string; idempotencyKey: string;
}): Promise<RankJobDto | null> {
  const [job] = await db.select().from(rankCheckJobs).where(and(eq(rankCheckJobs.accountId, input.accountId),
    eq(rankCheckJobs.siteId, input.siteId), eq(rankCheckJobs.idempotencyKey, input.idempotencyKey))).limit(1);
  return withItems(db, job);
}

export async function findActiveRankJob(db: Db, input: { accountId: string; siteId: string }): Promise<RankJobDto | null> {
  const [job] = await db.select().from(rankCheckJobs).where(and(eq(rankCheckJobs.accountId, input.accountId),
    eq(rankCheckJobs.siteId, input.siteId), isNull(rankCheckJobs.finishedAt)))
    .orderBy(desc(rankCheckJobs.createdAt), desc(rankCheckJobs.id)).limit(1);
  return withItems(db, job);
}

export async function readRankJob(db: Db, input: { accountId: string; siteId: string; jobId: string }): Promise<RankJobDto | null> {
  const [job] = await db.select().from(rankCheckJobs).where(and(eq(rankCheckJobs.id, input.jobId),
    eq(rankCheckJobs.accountId, input.accountId), eq(rankCheckJobs.siteId, input.siteId))).limit(1);
  return withItems(db, job);
}

export async function loadOpenRankJobItems(db: Db, jobId: string): Promise<Map<string, RankCheckJobItemRow>> {
  const rows = await db.select().from(rankCheckJobItems).where(and(eq(rankCheckJobItems.jobId, jobId),
    inArray(rankCheckJobItems.state, [...OPEN_STATES])));
  return new Map(rows.map((row) => [row.keywordId, row]));
}

export async function startRankJob(db: Db, jobId: string, now: Date): Promise<Date | null> {
  const [job] = await db.update(rankCheckJobs).set({ status: 'running',
    startedAt: sql`coalesce(${rankCheckJobs.startedAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
    .where(and(eq(rankCheckJobs.id, jobId), isNull(rankCheckJobs.finishedAt)))
    .returning({ deadlineAt: rankCheckJobs.deadlineAt });
  return job?.deadlineAt ?? null;
}

export async function touchRankJob(db: Db, jobId: string, now: Date): Promise<void> {
  await db.update(rankCheckJobs).set({ updatedAt: now })
    .where(and(eq(rankCheckJobs.id, jobId), isNull(rankCheckJobs.finishedAt)));
}

export async function recordRankJobItemAttempts(db: Db, input: {
  jobId: string; keywordIds: readonly string[]; attempts: number; now: Date;
}): Promise<void> {
  if (input.keywordIds.length === 0) return;
  await db.update(rankCheckJobItems).set({ attempts: Math.min(10, input.attempts), updatedAt: input.now })
    .where(and(eq(rankCheckJobItems.jobId, input.jobId),
      inArray(rankCheckJobItems.keywordId, [...input.keywordIds]),
      inArray(rankCheckJobItems.state, [...OPEN_STATES])));
}

export async function claimRankJobItem(db: Db, input: { jobId: string; keywordId: string; now: Date }): Promise<boolean> {
  const rows = await db.update(rankCheckJobItems).set({ state: 'running',
    startedAt: sql`coalesce(${rankCheckJobItems.startedAt}, ${input.now.toISOString()}::timestamptz)`,
    updatedAt: input.now }).where(and(eq(rankCheckJobItems.jobId, input.jobId),
      eq(rankCheckJobItems.keywordId, input.keywordId), inArray(rankCheckJobItems.state, [...OPEN_STATES])))
    .returning({ id: rankCheckJobItems.id });
  return rows.length > 0;
}

export async function settleRankJobItem(db: Db, input: { accountId: string; jobId: string;
  keywordId: string; state: TerminalState; reason: RankCheckItemReason | null; attempts?: number; now: Date;
}): Promise<boolean> {
  const rows = await db.update(rankCheckJobItems).set({ state: input.state, reason: input.reason,
    ...(input.attempts === undefined ? {} : { attempts: Math.min(10, input.attempts) }),
    finishedAt: input.now, updatedAt: input.now }).where(and(eq(rankCheckJobItems.jobId, input.jobId),
      inArray(rankCheckJobItems.jobId, db.select({ id: rankCheckJobs.id }).from(rankCheckJobs)
        .where(eq(rankCheckJobs.accountId, input.accountId))),
      eq(rankCheckJobItems.keywordId, input.keywordId), inArray(rankCheckJobItems.state, [...OPEN_STATES])))
    .returning({ id: rankCheckJobItems.id });
  return rows.length > 0;
}

export async function settleOpenRankJobItems(db: Db, input: { accountId: string; jobId: string;
  state: TerminalState; reason: RankCheckItemReason; now: Date;
  keywordIds?: readonly string[]; attempted?: boolean;
}): Promise<string[]> {
  if (input.keywordIds?.length === 0) return [];
  const rows = await db.update(rankCheckJobItems).set({ state: input.state, reason: input.reason,
    finishedAt: input.now, updatedAt: input.now }).where(and(eq(rankCheckJobItems.jobId, input.jobId),
      inArray(rankCheckJobItems.jobId, db.select({ id: rankCheckJobs.id }).from(rankCheckJobs)
        .where(eq(rankCheckJobs.accountId, input.accountId))),
      inArray(rankCheckJobItems.state, [...OPEN_STATES]),
      ...(input.keywordIds ? [inArray(rankCheckJobItems.keywordId, [...input.keywordIds])] : []),
      ...(input.attempted === undefined ? [] : [input.attempted
        ? gt(rankCheckJobItems.attempts, 0) : eq(rankCheckJobItems.attempts, 0)])))
    .returning({ keywordId: rankCheckJobItems.keywordId });
  return rows.map((row) => row.keywordId).sort();
}

export async function finalizeRankJob(db: Db, jobId: string, now: Date): Promise<RankCheckJobStatus> {
  const items = await loadItems(db, jobId);
  const status = deriveRankJobStatus(items);
  const terminal = items.every((item) => !isOpen(item.state));
  await db.update(rankCheckJobs).set({ status, ...(terminal ? { finishedAt: now } : {}), updatedAt: now })
    .where(and(eq(rankCheckJobs.id, jobId), isNull(rankCheckJobs.finishedAt)));
  return status;
}

/** Deadline safety net. Only work actually attempted can mark a keyword failed. */
export async function expireOverdueRankJobs(db: Db, input: { now: Date; logger: Pick<Logger, 'warn'> }): Promise<{
  jobs: number; items: number;
}> {
  const overdue = await db.select({ id: rankCheckJobs.id, siteId: rankCheckJobs.siteId,
    accountId: rankCheckJobs.accountId }).from(rankCheckJobs)
    .where(and(isNull(rankCheckJobs.finishedAt), lte(rankCheckJobs.deadlineAt, input.now)))
    .orderBy(asc(rankCheckJobs.deadlineAt)).limit(SWEEP_BATCH);
  let items = 0;
  for (const job of overdue) {
    const timedOut = await settleOpenRankJobItems(db, { accountId: job.accountId, jobId: job.id,
      state: 'expired', reason: 'deadline', now: input.now, attempted: true });
    const untouched = await settleOpenRankJobItems(db, { accountId: job.accountId, jobId: job.id,
      state: 'expired', reason: 'not_attempted', now: input.now, attempted: false });
    if (timedOut.length > 0) {
      const reason: RankCheckFailureReason = 'vendor_timeout';
      await db.update(keywords).set({ lastFailedCheckAt: input.now, lastFailedReason: reason })
        .where(inArray(keywords.id, timedOut));
    }
    items += timedOut.length + untouched.length;
    const status = await finalizeRankJob(db, job.id, input.now);
    input.logger.warn({ rankJobId: job.id, siteId: job.siteId, expired: timedOut.length + untouched.length,
      notAttempted: untouched.length, status }, 'rank job passed its deadline');
  }
  return { jobs: overdue.length, items };
}
