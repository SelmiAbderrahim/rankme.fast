/**
 * Durable evidence for confirmed rank alerts.
 *
 * Every mutation is scoped through this repository so evidence rows cannot be
 * rewritten from outside the module. The service layer sees insert / settle /
 * alert-claim primitives; ordinary rank-history reads use `readForRankings`
 * to attach a confirmation DTO additively.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { rankDropConfirmations, type NewRankDropConfirmationRow, type RankDropConfirmationReason, type RankDropConfirmationRow, type RankDropConfirmationState, } from '../../db/schema/index.js';
/**
 * INSERT ... ON CONFLICT (ranking_id) DO NOTHING.
 *
 * Loser sees `rowCount === 0` and MUST exit without calling the provider or
 * dispatching an alert. Replay/concurrency is safe.
 */
export async function claimAttempt(db: Db, row: NewRankDropConfirmationRow): Promise<RankDropConfirmationRow | null> {
    const inserted = await db
        .insert(rankDropConfirmations)
        .values(row)
        .onConflictDoNothing({ target: rankDropConfirmations.rankingId })
        .returning();
    return inserted[0] ?? null;
}
/** Read the current row for a candidate ranking (owner-agnostic; caller enforces ownership). */
export async function findByRankingId(db: Db, rankingId: string): Promise<RankDropConfirmationRow | null> {
    const rows = await db
        .select()
        .from(rankDropConfirmations)
        .where(eq(rankDropConfirmations.rankingId, rankingId))
        .limit(1);
    return rows[0] ?? null;
}
/**
 * Cross paid-call boundary atomically. Sets `provider_called_at = now()` iff
 * still null. Loser returns `false` and MUST NOT re-invoke the provider.
 */
export async function claimProviderCall(db: Db, id: string, now: Date): Promise<boolean> {
    const rows = await db
        .update(rankDropConfirmations)
        .set({ providerCalledAt: now })
        .where(and(eq(rankDropConfirmations.id, id), isNull(rankDropConfirmations.providerCalledAt)))
        .returning({ id: rankDropConfirmations.id });
    return rows.length === 1;
}
export interface SettlementInput {
    id: string;
    state: RankDropConfirmationState;
    reason: RankDropConfirmationReason | null;
    confirmationPosition: number | null;
    confirmationObservedAt: Date | null;
    settledAt: Date;
}
/**
 * Move to a public terminal state. Evidence fields (positions, observed times,
 * reason) are set here and NEVER updated again — the repo has no other method
 * that touches them.
 *
 * The schema CHECKs enforce the state/reason/observation invariants; a bad
 * input rejects at the DB, not silently at the app.
 */
export async function settle(db: Db, input: SettlementInput): Promise<RankDropConfirmationRow | null> {
    const rows = await db
        .update(rankDropConfirmations)
        .set({
        state: input.state,
        reason: input.reason,
        confirmationPosition: input.confirmationPosition,
        confirmationObservedAt: input.confirmationObservedAt,
        settledAt: input.settledAt,
    })
        .where(eq(rankDropConfirmations.id, input.id))
        .returning();
    return rows[0] ?? null;
}
/**
 * Atomic single-winner alert claim. Rejects any row whose state is not
 * `confirmed` (schema CHECK also enforces this). Loser returns `false`.
 */
export async function claimAlertDispatch(db: Db, id: string, now: Date): Promise<boolean> {
    const rows = await db
        .update(rankDropConfirmations)
        .set({ alertClaimedAt: now })
        .where(and(eq(rankDropConfirmations.id, id), eq(rankDropConfirmations.state, 'confirmed'), isNull(rankDropConfirmations.alertClaimedAt)))
        .returning({ id: rankDropConfirmations.id });
    return rows.length === 1;
}
export async function recordAlertDelivery(db: Db, id: string, deliveredAt: Date): Promise<void> {
    await db
        .update(rankDropConfirmations)
        .set({ alertDeliveredAt: deliveredAt })
        .where(eq(rankDropConfirmations.id, id));
}
export async function recordAlertError(db: Db, id: string, categoryKey: string): Promise<void> {
    await db
        .update(rankDropConfirmations)
        .set({ alertError: categoryKey })
        .where(eq(rankDropConfirmations.id, id));
}
/**
 * Additive read for the rank latest/history DTO: given a set of candidate
 * ranking ids, return a map keyed by rankingId. Old rank rows (no candidate,
 * no confirmation) simply don't appear in the map and the caller renders
 * `confirmation: null`.
 */
export async function readForRankings(db: Db, rankingIds: readonly string[]): Promise<Map<string, RankDropConfirmationRow>> {
    if (rankingIds.length === 0)
        return new Map();
    const rows = await db
        .select()
        .from(rankDropConfirmations)
        .where(inArray(rankDropConfirmations.rankingId, [...rankingIds]));
    return new Map(rows.map((r) => [r.rankingId, r]));
}
/**
 * Owner-scoped listing for the customer-facing "recent alerts" surface and
 * for account export.
 */
export async function listForKeyword(db: Db, input: {
    accountId: string;
    siteId: string;
    keywordId: string;
    limit: number;
}): Promise<RankDropConfirmationRow[]> {
    return db
        .select()
        .from(rankDropConfirmations)
        .where(and(eq(rankDropConfirmations.accountId, input.accountId), eq(rankDropConfirmations.siteId, input.siteId), eq(rankDropConfirmations.keywordId, input.keywordId)))
        .orderBy(desc(rankDropConfirmations.candidateObservedAt))
        .limit(input.limit);
}
/** Purge every confirmation row for an account (legal delete + grace purge). */
export async function purgeForAccount(db: Db, accountId: string): Promise<number> {
    const rows = await db
        .delete(rankDropConfirmations)
        .where(eq(rankDropConfirmations.accountId, accountId))
        .returning({ id: rankDropConfirmations.id });
    return rows.length;
}
/** Export snapshot for account data-export (safe fields only). */
export async function exportForAccount(db: Db, accountId: string): Promise<Array<Pick<RankDropConfirmationRow, 'id' | 'siteId' | 'keywordId' | 'state' | 'reason' | 'previousPosition' | 'candidatePosition' | 'confirmationPosition' | 'candidateObservedAt' | 'confirmationObservedAt' | 'locationCode' | 'languageCode' | 'device' | 'settledAt'>>> {
    return db
        .select({
        id: rankDropConfirmations.id,
        siteId: rankDropConfirmations.siteId,
        keywordId: rankDropConfirmations.keywordId,
        state: rankDropConfirmations.state,
        reason: rankDropConfirmations.reason,
        previousPosition: rankDropConfirmations.previousPosition,
        candidatePosition: rankDropConfirmations.candidatePosition,
        confirmationPosition: rankDropConfirmations.confirmationPosition,
        candidateObservedAt: rankDropConfirmations.candidateObservedAt,
        confirmationObservedAt: rankDropConfirmations.confirmationObservedAt,
        locationCode: rankDropConfirmations.locationCode,
        languageCode: rankDropConfirmations.languageCode,
        device: rankDropConfirmations.device,
        settledAt: rankDropConfirmations.settledAt,
    })
        .from(rankDropConfirmations)
        .where(eq(rankDropConfirmations.accountId, accountId))
        .orderBy(desc(rankDropConfirmations.candidateObservedAt));
}
/**
 * Diagnostic — count confirmations in a state; used by the ops overview and
 * as an internal invariant check in tests.
 */
export async function countByState(db: Db, input: {
    accountId: string;
    state: RankDropConfirmationState;
}): Promise<number> {
    const rows = await db
        .select({ n: sql<number> `count(*)::int` })
        .from(rankDropConfirmations)
        .where(and(eq(rankDropConfirmations.accountId, input.accountId), eq(rankDropConfirmations.state, input.state)));
    // `count(*)` without GROUP BY always yields exactly one row, so summing is
    // the total — and avoids a "no row" guard no query result can reach.
    return rows.reduce((total, row) => total + row.n, 0);
}
