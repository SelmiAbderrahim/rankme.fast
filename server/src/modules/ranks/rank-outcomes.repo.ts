import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { rankCheckOutcomes, type RankCheckOutcomeReason, type RankCheckOutcomeRow,
  type RankCheckOutcomeStatus } from '../../db/schema/rank-check-outcomes.js';

export const RANK_RETRY_OFFSETS_MS = [30 * 60_000, 2 * 60 * 60_000] as const;
export const RANK_RETRY_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_RANK_ATTEMPTS = 1 + RANK_RETRY_OFFSETS_MS.length;
const RETRYABLE_REASONS: ReadonlySet<RankCheckOutcomeReason> = new Set([
  'vendor_timeout', 'vendor_unavailable', 'vendor_quota', 'vendor_error',
]);
export const isRetryableReason = (reason: RankCheckOutcomeReason | null): boolean =>
  reason !== null && RETRYABLE_REASONS.has(reason);
export const isBatchWideReason = (reason: RankCheckOutcomeReason | null): boolean =>
  reason === 'vendor_auth' || reason === 'vendor_quota';

export function nextPeriodStart(cadence: 'daily' | 'weekly', at: Date): Date {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  if (cadence === 'daily') return new Date(day + 86_400_000);
  return new Date(day + (8 - (at.getUTCDay() || 7)) * 86_400_000);
}
export function retryDeadlineFor(at: Date, cadence: 'daily' | 'weekly'): Date {
  return new Date(Math.min(at.getTime() + RANK_RETRY_WINDOW_MS, nextPeriodStart(cadence, at).getTime()));
}
export function retryDueAt(row: Pick<RankCheckOutcomeRow, 'firstAttemptAt' | 'retryDeadline'>,
  retryIndex: number): Date | null {
  const offset = RANK_RETRY_OFFSETS_MS[retryIndex - 1];
  if (offset === undefined) return null;
  const due = new Date(row.firstAttemptAt.getTime() + offset);
  return due < row.retryDeadline ? due : null;
}

export interface RecordOutcomeInput { accountId: string; siteId: string; keywordId: string;
  periodKey: string; status: RankCheckOutcomeStatus; reason: RankCheckOutcomeReason | null;
  at: Date; cadence: 'daily' | 'weekly'; countAttempt?: boolean }
export async function recordOutcome(db: Db, input: RecordOutcomeInput): Promise<void> {
  const settled = input.status === 'checked' || input.status === 'skipped';
  await db.insert(rankCheckOutcomes).values({ accountId: input.accountId, siteId: input.siteId,
    keywordId: input.keywordId, periodKey: input.periodKey, status: input.status,
    reason: input.reason, attempts: 1, firstAttemptAt: input.at, lastAttemptAt: input.at,
    completedAt: settled ? input.at : null, nextRetryAt: null,
    retryDeadline: retryDeadlineFor(input.at, input.cadence), updatedAt: input.at })
    .onConflictDoUpdate({ target: [rankCheckOutcomes.keywordId, rankCheckOutcomes.periodKey],
      set: { status: input.status, reason: input.reason,
        attempts: input.countAttempt === false ? rankCheckOutcomes.attempts
          : sql`least(${rankCheckOutcomes.attempts} + 1, 10)`,
        lastAttemptAt: input.countAttempt === false ? rankCheckOutcomes.lastAttemptAt : input.at,
        completedAt: settled ? input.at : null, nextRetryAt: null, updatedAt: input.at } });
}

export async function readSitePeriodOutcomes(db: Db, input: { accountId: string; siteId: string;
  periodKey: string }): Promise<RankCheckOutcomeRow[]> {
  return db.select().from(rankCheckOutcomes).where(and(eq(rankCheckOutcomes.accountId, input.accountId),
    eq(rankCheckOutcomes.siteId, input.siteId), eq(rankCheckOutcomes.periodKey, input.periodKey)));
}

export async function planRetry(db: Db, input: { keywordIds: readonly string[]; periodKey: string;
  nextRetryAt: Date | null; at: Date }): Promise<void> {
  if (input.keywordIds.length === 0) return;
  await db.update(rankCheckOutcomes).set({ nextRetryAt: input.nextRetryAt,
    completedAt: input.nextRetryAt === null ? input.at : null, updatedAt: input.at })
    .where(and(inArray(rankCheckOutcomes.keywordId, [...input.keywordIds]),
      eq(rankCheckOutcomes.periodKey, input.periodKey), isNull(rankCheckOutcomes.completedAt)));
}

export interface KeywordLatestOutcome { status: RankCheckOutcomeStatus; reason: RankCheckOutcomeReason | null;
  at: string; periodKey: string; attempts: number; nextRetryAt: string | null }
export async function readLatestOutcomes(db: Db, input: { accountId: string; siteId: string;
  keywordIds: readonly string[] }): Promise<Map<string, KeywordLatestOutcome>> {
  if (input.keywordIds.length === 0) return new Map();
  const rows = await db.select().from(rankCheckOutcomes).where(and(
    eq(rankCheckOutcomes.accountId, input.accountId), eq(rankCheckOutcomes.siteId, input.siteId),
    inArray(rankCheckOutcomes.keywordId, [...input.keywordIds])))
    .orderBy(desc(rankCheckOutcomes.lastAttemptAt));
  const latest = new Map<string, KeywordLatestOutcome>();
  for (const row of rows) if (!latest.has(row.keywordId)) latest.set(row.keywordId, {
    status: row.status, reason: row.reason, at: row.lastAttemptAt.toISOString(),
    periodKey: row.periodKey, attempts: row.attempts,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
  });
  return latest;
}
