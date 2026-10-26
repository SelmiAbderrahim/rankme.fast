import type { Queue } from 'bullmq';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { domainStates, keywords, rankings } from '../../db/schema/index.js';
import type { RankEngineKind } from '../../db/schema/keywords.js';
import { env } from '../../config/env.js';
import { enqueueRankJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { altEngineWeeklyStamp } from './rank.processor.js';
import { assertSiteNotPausedById, assertSiteOwnership } from './keywords.service.js';
import { finalizeRankJob, findActiveRankJob, findRankJobByIdempotencyKey,
  insertRankCheckJob, readRankJob, settleOpenRankJobItems, type RankJobDto } from './rank-jobs.repo.js';

const MANUAL_RANK_CHECK_COOLDOWN_MS = 60_000;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface RankCheckResult {
  queued: boolean; startedAt: Date; job: RankJobDto | null; reused: boolean;
}

interface EnqueueInput {
  accountId: string; siteId: string; scope: 'site' | 'keyword' | 'retry';
  idempotencyKey: string | null; retryOfJobId: string | null;
  keywordIds: readonly string[] | null; skipCooldown?: boolean;
}

export async function enqueueRankCheckJob(input: EnqueueInput, deps: { db: Db; ranksQueue: Queue | null }): Promise<RankCheckResult> {
  const now = new Date();
  if (input.idempotencyKey) {
    const replay = await findRankJobByIdempotencyKey(deps.db, input as EnqueueInput & { idempotencyKey: string });
    if (replay) return { queued: true, startedAt: new Date(replay.createdAt), job: replay, reused: true };
  }
  if (input.scope !== 'retry') {
    const active = await findActiveRankJob(deps.db, input);
    if (active && (input.keywordIds === null ? active.scope === 'site'
      : input.keywordIds.every((id) => active.items.some((item) => item.keywordId === id &&
        (item.state === 'queued' || item.state === 'running'))))) {
      return { queued: true, startedAt: new Date(active.createdAt), job: active, reused: true };
    }
  }

  const [state] = await deps.db.select({ lastRankCheckAt: domainStates.lastRankCheckAt })
    .from(domainStates).where(eq(domainStates.siteId, input.siteId)).limit(1);
  const last = state?.lastRankCheckAt?.getTime() ?? 0;
  if (!input.skipCooldown && now.getTime() - last < MANUAL_RANK_CHECK_COOLDOWN_MS) {
    throw new HttpError(429, { code: 'RANKS_ERRORS_CHECK_COOLDOWN', messageKey: 'ranks.errors.checkCooldown' });
  }
  const stampCooldown = () => deps.db.insert(domainStates).values({ siteId: input.siteId,
    lastRankCheckAt: now }).onConflictDoUpdate({ target: domainStates.siteId,
    set: { lastRankCheckAt: now, updatedAt: now } });
  if (!deps.ranksQueue) {
    await stampCooldown();
    return { queued: false, startedAt: now, job: null, reused: false };
  }

  const engines: RankEngineKind[] = env.ALT_ENGINE_TRACKING_ENABLED
    ? ['google', 'bing', 'youtube', 'amazon'] : ['google'];
  const candidates = await deps.db.select({ id: keywords.id, engine: keywords.engine,
    trackLocalPack: keywords.trackLocalPack }).from(keywords).where(and(
    eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId), eq(keywords.active, true),
    inArray(keywords.engine, engines),
    ...(input.keywordIds === null ? [] : [inArray(keywords.id, [...input.keywordIds])]),
  )).orderBy(asc(keywords.createdAt), asc(keywords.id));
  const altIds = candidates.filter((row) => row.engine !== 'google').map((row) => row.id);
  const doneAlt = altIds.length === 0 ? new Set<string>() : new Set((await deps.db.select({ keywordId: rankings.keywordId })
    .from(rankings).where(and(inArray(rankings.keywordId, altIds),
      eq(rankings.checkedAt, altEngineWeeklyStamp(now))))).map((row) => row.keywordId));
  const targets = candidates.filter((row) => !doneAlt.has(row.id))
    .map((row) => ({ keywordId: row.id, engine: row.engine, trackLocalPack: row.trackLocalPack }));
  if (targets.length === 0) return { queued: false, startedAt: now, job: null, reused: false };

  let job: RankJobDto;
  try {
    job = await insertRankCheckJob(deps.db, { ...input, targets, now });
  } catch (error) {
    const winner = input.idempotencyKey && isUniqueViolation(error)
      ? await findRankJobByIdempotencyKey(deps.db, { ...input, idempotencyKey: input.idempotencyKey }) : null;
    if (!winner) throw error;
    return { queued: true, startedAt: new Date(winner.createdAt), job: winner, reused: true };
  }
  try {
    await stampCooldown();
    await enqueueRankJob(deps.ranksQueue, { accountId: input.accountId, siteId: input.siteId,
      keywordIds: input.scope === 'keyword' && targets.length === 1 ? [targets[0]!.keywordId] : [],
      rankJobId: job.id, schedulerKey: 'manual', manual: true,
      altEnginesEnabledAtEnqueue: env.ALT_ENGINE_TRACKING_ENABLED }, `manual-${job.id}`);
  } catch (error) {
    await settleOpenRankJobItems(deps.db, { accountId: input.accountId, jobId: job.id,
      state: 'cancelled', reason: 'enqueue_failed', now });
    await finalizeRankJob(deps.db, job.id, now);
    await deps.db.update(domainStates).set({ lastRankCheckAt: state?.lastRankCheckAt ?? null,
      updatedAt: new Date() }).where(and(eq(domainStates.siteId, input.siteId),
      eq(domainStates.lastRankCheckAt, now)));
    throw new HttpError(503, { code: 'ERRORS_INTERNAL', messageKey: 'errors.internal' }, undefined, { cause: error });
  }
  return { queued: true, startedAt: now, job, reused: false };
}

export async function checkSiteNow(input: { accountId: string; siteId: string; idempotencyKey: string | null },
  deps: { db: Db; ranksQueue: Queue | null }): Promise<RankCheckResult> {
  await assertSiteOwnership(input.accountId, input.siteId);
  await assertSiteNotPausedById(input.accountId, input.siteId);
  return enqueueRankCheckJob({ ...input, scope: 'site', retryOfJobId: null, keywordIds: null }, deps);
}

export async function checkKeywordNow(input: { accountId: string; keywordId: string; idempotencyKey: string | null },
  deps: { db: Db; ranksQueue: Queue | null }): Promise<RankCheckResult> {
  if (!UUID_RE.test(input.keywordId)) throw HttpError.notFound({
    code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound',
  });
  const [keyword] = await deps.db.select().from(keywords).where(and(eq(keywords.id, input.keywordId),
    eq(keywords.accountId, input.accountId), eq(keywords.active, true))).limit(1);
  if (!keyword) throw HttpError.notFound({ code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound' });
  await assertSiteOwnership(input.accountId, keyword.siteId);
  await assertSiteNotPausedById(input.accountId, keyword.siteId);
  return enqueueRankCheckJob({ accountId: input.accountId, siteId: keyword.siteId,
    scope: 'keyword', idempotencyKey: input.idempotencyKey,
    retryOfJobId: null, keywordIds: [keyword.id] }, deps);
}

export async function getRankCheckJob(input: { accountId: string; siteId: string; jobId: string },
  db: Db): Promise<RankJobDto> {
  await assertSiteOwnership(input.accountId, input.siteId);
  const job = UUID_RE.test(input.jobId) ? await readRankJob(db, input) : null;
  if (!job) throw HttpError.notFound({ code: 'RANKS_ERRORS_RANK_JOB_NOT_FOUND', messageKey: 'ranks.errors.rankJobNotFound' });
  return job;
}

export async function getActiveRankCheckJob(input: { accountId: string; siteId: string },
  db: Db): Promise<RankJobDto | null> {
  await assertSiteOwnership(input.accountId, input.siteId);
  return findActiveRankJob(db, input);
}

export async function retryFailedRankCheckJob(input: { accountId: string; siteId: string; jobId: string },
  deps: { db: Db; ranksQueue: Queue | null }): Promise<RankCheckResult> {
  const source = await getRankCheckJob(input, deps.db);
  await assertSiteNotPausedById(input.accountId, input.siteId);
  const key = `retry:${source.id}`;
  const replay = await findRankJobByIdempotencyKey(deps.db, { ...input, idempotencyKey: key });
  if (replay) return { queued: true, startedAt: new Date(replay.createdAt), job: replay, reused: true };
  if (source.finishedAt === null) throw HttpError.conflict({ code: 'RANKS_ERRORS_RANK_JOB_STILL_RUNNING',
    messageKey: 'ranks.errors.rankJobStillRunning' });
  const failedIds = source.items.filter((item) => item.state === 'failed' || item.state === 'expired')
    .map((item) => item.keywordId);
  if (failedIds.length === 0) throw HttpError.conflict({ code: 'RANKS_ERRORS_RANK_JOB_NOTHING_TO_RETRY',
    messageKey: 'ranks.errors.rankJobNothingToRetry' });
  return enqueueRankCheckJob({ accountId: input.accountId, siteId: input.siteId, scope: 'retry',
    idempotencyKey: key, retryOfJobId: source.id, keywordIds: failedIds, skipCooldown: true }, deps);
}
