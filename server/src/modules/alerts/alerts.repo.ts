/**
 * Every `alert_rules` / `alert_deliveries` mutation funnels through this
 * repository so ownership scoping and the exactly-once claim live in one place.
 *
 * Ownership: every read and write carries `accountId` in its WHERE clause, so a
 * foreign id simply yields no row and the service raises 404 — never 403.
 */
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { alertDeliveries, alertRules, ALERT_MAX_ATTEMPTS, backlinkRowSnapshots, keywords, rankDropConfirmations, type AlertChannel, type AlertDeliveryErrorCode, type AlertDeliveryRow, type AlertDeliveryStatus, type AlertRuleRow, type AlertRuleType, type AlertSuppressionReason, type NewAlertDeliveryRow, type NewAlertRuleRow, } from '../../db/schema/index.js';
export async function countRulesForAccount(db: Db, accountId: string): Promise<number> {
    const rows = await db
        .select({ total: count() })
        .from(alertRules)
        .where(eq(alertRules.accountId, accountId));
    // `count()` always yields exactly one row, so there is no empty-result case
    // to defend against — a `?? 0` here would be an unreachable branch.
    return Number(rows[0]!.total);
}
export async function insertRule(db: Db, row: NewAlertRuleRow): Promise<AlertRuleRow> {
    const inserted = await db.insert(alertRules).values(row).returning();
    return inserted[0]!;
}
export interface ListRulesFilter {
    accountId: string;
    siteId?: string;
    type?: AlertRuleType;
    enabled?: boolean;
}
export async function listRules(db: Db, filter: ListRulesFilter): Promise<AlertRuleRow[]> {
    const clauses = [eq(alertRules.accountId, filter.accountId)];
    if (filter.siteId !== undefined)
        clauses.push(eq(alertRules.siteId, filter.siteId));
    if (filter.type !== undefined)
        clauses.push(eq(alertRules.type, filter.type));
    if (filter.enabled !== undefined) {
        clauses.push(eq(alertRules.enabled, filter.enabled));
    }
    return db
        .select()
        .from(alertRules)
        .where(and(...clauses))
        .orderBy(desc(alertRules.createdAt), desc(alertRules.id));
}
export async function findRule(db: Db, accountId: string, ruleId: string): Promise<AlertRuleRow | null> {
    const rows = await db
        .select()
        .from(alertRules)
        .where(and(eq(alertRules.accountId, accountId), eq(alertRules.id, ruleId)))
        .limit(1);
    return rows[0] ?? null;
}
/**
 * Enabled rules of one type for one site — the detection-side lookup. Ordered
 * so a fan-out is deterministic across replays.
 */
export async function listEnabledRulesForSite(db: Db, input: {
    accountId: string;
    siteId: string;
    type: AlertRuleType;
}): Promise<AlertRuleRow[]> {
    return db
        .select()
        .from(alertRules)
        .where(and(eq(alertRules.accountId, input.accountId), eq(alertRules.siteId, input.siteId), eq(alertRules.type, input.type), eq(alertRules.enabled, true)))
        .orderBy(alertRules.createdAt, alertRules.id);
}
export type RuleUpdatePatch = Partial<Pick<NewAlertRuleRow, 'threshold' | 'enabled' | 'emailRecipientIds' | 'slackWebhook' | 'slackHostMasked' | 'webhookUrl' | 'webhookSecret' | 'webhookSecretLast4'>>;
export async function updateRule(db: Db, accountId: string, ruleId: string, patch: RuleUpdatePatch, now: Date): Promise<AlertRuleRow | null> {
    const rows = await db
        .update(alertRules)
        .set({ ...patch, updatedAt: now })
        .where(and(eq(alertRules.accountId, accountId), eq(alertRules.id, ruleId)))
        .returning();
    return rows[0] ?? null;
}
export async function deleteRule(db: Db, accountId: string, ruleId: string, now: Date): Promise<boolean> {
    return db.transaction(async (tx) => {
        // Deletion cancels only work that provably never crossed a provider
        // boundary. A fingerprint-bound leg may already have been accepted and is
        // retained for byte-identical reconciliation even after its rule is gone.
        await tx.update(alertDeliveries).set({
            status: 'suppressed',
            claimToken: null,
            requestPayload: null,
            errorCode: null,
            suppressedReason: 'rule_disabled',
            updatedAt: now,
        }).where(and(eq(alertDeliveries.accountId, accountId), eq(alertDeliveries.ruleId, ruleId), inArray(alertDeliveries.status, ['pending', 'failed']), isNull(alertDeliveries.requestFingerprint)));
        const rows = await tx
            .delete(alertRules)
            .where(and(eq(alertRules.accountId, accountId), eq(alertRules.id, ruleId)))
            .returning({ id: alertRules.id });
        return rows.length === 1;
    });
}
// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------
export interface FreezeAlertDeliveryPlanResult {
    state: 'created' | 'exists' | 'stale_rule';
    rows: AlertDeliveryRow[];
}
export function assertFrozenDeliveryPlanComplete(insertedCount: number, expectedCount: number): void {
    if (insertedCount !== expectedCount) {
        throw new Error('alert delivery plan was not frozen atomically');
    }
}
/**
 * Atomically freeze every leg before the first provider call. The rule row is
 * locked and version-checked so a concurrent update/delete cannot produce a
 * half-old, half-new plan.
 */
export async function freezeAlertDeliveryPlan(db: Db, input: {
    accountId: string;
    ruleId: string;
    transitionId: string;
    expectedRuleUpdatedAt: Date;
    rows: NewAlertDeliveryRow[];
}): Promise<FreezeAlertDeliveryPlanResult> {
    if (input.rows.length === 0)
        return { state: 'created', rows: [] };
    return db.transaction(async (tx) => {
        const locked = await tx.select({ id: alertRules.id })
            .from(alertRules)
            .where(and(eq(alertRules.accountId, input.accountId), eq(alertRules.id, input.ruleId), eq(alertRules.updatedAt, input.expectedRuleUpdatedAt)))
            .for('update')
            .limit(1);
        if (!locked[0])
            return { state: 'stale_rule' as const, rows: [] };
        const existing = await tx.select().from(alertDeliveries).where(and(eq(alertDeliveries.accountId, input.accountId), eq(alertDeliveries.ruleId, input.ruleId), eq(alertDeliveries.transitionId, input.transitionId))).orderBy(alertDeliveries.id);
        if (existing.length > 0)
            return { state: 'exists' as const, rows: existing };
        const inserted = await tx.insert(alertDeliveries).values(input.rows).returning();
        assertFrozenDeliveryPlanComplete(inserted.length, input.rows.length);
        return { state: 'created' as const, rows: inserted };
    });
}
export async function listTransitionDeliveries(db: Db, input: {
    accountId: string;
    ruleId: string;
    transitionId: string;
}): Promise<AlertDeliveryRow[]> {
    return db.select().from(alertDeliveries).where(and(eq(alertDeliveries.accountId, input.accountId), eq(alertDeliveries.ruleId, input.ruleId), eq(alertDeliveries.transitionId, input.transitionId))).orderBy(alertDeliveries.id);
}
/** Claim only durable rows from the frozen plan; current rule config is irrelevant. */
export async function claimFrozenAlertDeliveries(db: Db, input: {
    rows: AlertDeliveryRow[];
    now: Date;
    staleBefore: Date;
    retryAfter: Date;
}): Promise<AlertDeliveryRow[]> {
    const claims: AlertDeliveryRow[] = [];
    for (const row of input.rows) {
        const claimToken = randomUUID();
        if (row.status === 'failed' && row.attempt < ALERT_MAX_ATTEMPTS) {
            if (row.errorCode === 'provider_outcome_unknown_payload_drift' ||
                row.errorCode === 'provider_outcome_unknown_idempotency_window_expired' ||
                row.errorCode === 'idempotency_window_expired')
                continue;
            const [claim] = await db.update(alertDeliveries).set({
                status: 'pending',
                attempt: sql `${alertDeliveries.attempt} + 1`,
                claimToken,
                errorCode: null,
                suppressedReason: null,
                updatedAt: input.now,
            }).where(and(eq(alertDeliveries.id, row.id), eq(alertDeliveries.status, 'failed'), eq(alertDeliveries.attempt, row.attempt), eq(alertDeliveries.updatedAt, row.updatedAt), isNotNull(alertDeliveries.requestPayload), or(and(isNotNull(alertDeliveries.firstAttemptAt), gte(alertDeliveries.firstAttemptAt, input.retryAfter)), and(isNull(alertDeliveries.firstAttemptAt), gte(alertDeliveries.createdAt, input.retryAfter))))).returning();
            if (claim)
                claims.push(claim);
            continue;
        }
        if (row.status !== 'pending' ||
            row.claimToken === null ||
            row.updatedAt > input.staleBefore)
            continue;
        const [claim] = await db.update(alertDeliveries).set({
            claimToken,
            updatedAt: input.now,
        }).where(and(eq(alertDeliveries.id, row.id), eq(alertDeliveries.status, 'pending'), eq(alertDeliveries.claimToken, row.claimToken), eq(alertDeliveries.updatedAt, row.updatedAt), isNotNull(alertDeliveries.requestPayload), or(and(isNotNull(alertDeliveries.firstAttemptAt), gte(alertDeliveries.firstAttemptAt, input.retryAfter)), and(isNull(alertDeliveries.firstAttemptAt), gte(alertDeliveries.createdAt, input.retryAfter))))).returning();
        if (claim)
            claims.push(claim);
    }
    return claims;
}
/**
 * Claim one delivery attempt without replacing its frozen evidence.
 *
 * A first attempt inserts the row. A later BullMQ attempt may atomically
 * re-claim that SAME row when the previous attempt settled `failed`, or when a
 * worker died after claiming it as `pending`, and the new BullMQ attempt has a
 * higher attempt number. Sent/suppressed rows and concurrent workers on the
 * same attempt remain unclaimable. Email retries additionally use the stable
 * provider idempotency key derived from this row id; webhook retries carry the
 * same delivery id so receivers can collapse an ambiguous transport replay.
 */
export async function claimDelivery(db: Db, row: NewAlertDeliveryRow & {
    attempt: number;
    claimToken: string;
    updatedAt: Date;
}, bounds: {
    staleBefore: Date;
    retryAfter: Date;
}): Promise<AlertDeliveryRow | null> {
    const inserted = await db
        .insert(alertDeliveries)
        .values(row)
        .onConflictDoNothing({ target: alertDeliveries.idempotencyKey })
        .returning();
    if (inserted[0])
        return inserted[0];
    const failedRetry = await db
        .update(alertDeliveries)
        .set({
        status: 'pending',
        attempt: sql `${alertDeliveries.attempt} + 1`,
        claimToken: row.claimToken,
        errorCode: null,
        suppressedReason: null,
        updatedAt: row.updatedAt,
    })
        .where(and(eq(alertDeliveries.idempotencyKey, row.idempotencyKey), eq(alertDeliveries.accountId, row.accountId), eq(alertDeliveries.ruleId, row.ruleId), eq(alertDeliveries.status, 'failed'), lt(alertDeliveries.attempt, ALERT_MAX_ATTEMPTS), gte(alertDeliveries.createdAt, bounds.retryAfter), or(isNull(alertDeliveries.errorCode), notInArray(alertDeliveries.errorCode, [
        'provider_outcome_unknown_payload_drift',
        'provider_outcome_unknown_idempotency_window_expired',
        'idempotency_window_expired',
    ]))))
        .returning();
    if (failedRetry[0])
        return failedRetry[0];
    // BullMQ can replay a stalled job without incrementing attemptsMade, and a
    // Redis restart can recreate it at attempt one. Reclaim a stale in-flight
    // row under a fresh token while preserving its known-failure attempt count.
    const interruptedRetry = await db
        .update(alertDeliveries)
        .set({
        claimToken: row.claimToken,
        updatedAt: row.updatedAt,
    })
        .where(and(eq(alertDeliveries.idempotencyKey, row.idempotencyKey), eq(alertDeliveries.accountId, row.accountId), eq(alertDeliveries.ruleId, row.ruleId), eq(alertDeliveries.status, 'pending'), lte(alertDeliveries.updatedAt, bounds.staleBefore), gte(alertDeliveries.createdAt, bounds.retryAfter)))
        .returning();
    return interruptedRetry[0] ?? null;
}
/** Bind an opaque exact-email request before crossing the provider boundary. */
export async function bindDeliveryRequestFingerprint(db: Db, input: {
    id: string;
    attempt: number;
    claimToken: string;
    fingerprint: string;
    now: Date;
}): Promise<AlertDeliveryRow | null> {
    const rows = await db
        .update(alertDeliveries)
        .set({
        requestFingerprint: input.fingerprint,
        firstAttemptAt: sql `coalesce(${alertDeliveries.firstAttemptAt}, ${input.now})`,
        updatedAt: input.now,
    })
        .where(and(eq(alertDeliveries.id, input.id), eq(alertDeliveries.status, 'pending'), eq(alertDeliveries.attempt, input.attempt), eq(alertDeliveries.claimToken, input.claimToken), isNull(alertDeliveries.requestFingerprint), isNotNull(alertDeliveries.requestPayload)))
        .returning();
    return rows[0] ?? null;
}
export interface SettleDeliveryInput {
    id: string;
    status: AlertDeliveryStatus;
    attempt: number;
    claimToken: string;
    errorCode?: AlertDeliveryErrorCode | null;
    suppressedReason?: AlertSuppressionReason | null;
    providerMessageId?: string | null;
    now: Date;
}
export async function settleDelivery(db: Db, input: SettleDeliveryInput): Promise<AlertDeliveryRow | null> {
    const scrubRequest = input.status === 'sent' ||
        input.status === 'suppressed' ||
        (input.status === 'failed' &&
            (input.attempt >= ALERT_MAX_ATTEMPTS ||
                input.errorCode === 'provider_outcome_unknown_payload_drift' ||
                input.errorCode === 'provider_outcome_unknown_idempotency_window_expired' ||
                input.errorCode === 'idempotency_window_expired'));
    const rows = await db
        .update(alertDeliveries)
        .set({
        status: input.status,
        attempt: input.attempt,
        claimToken: null,
        errorCode: input.errorCode ?? null,
        suppressedReason: input.suppressedReason ?? null,
        providerMessageId: input.providerMessageId ?? null,
        requestPayload: scrubRequest ? null : undefined,
        updatedAt: input.now,
    })
        .where(and(eq(alertDeliveries.id, input.id), eq(alertDeliveries.status, 'pending'), eq(alertDeliveries.attempt, input.attempt), eq(alertDeliveries.claimToken, input.claimToken)))
        .returning();
    return rows[0] ?? null;
}
/** Terminally close rows outside Resend's provider-idempotency window. */
export async function expireAlertDeliveryClaims(db: Db, input: {
    retryAfter: Date;
    now: Date;
    limit: number;
}): Promise<AlertDeliveryRow[]> {
    const candidates = await db
        .select({
        id: alertDeliveries.id,
        status: alertDeliveries.status,
        errorCode: alertDeliveries.errorCode,
        requestFingerprint: alertDeliveries.requestFingerprint,
    })
        .from(alertDeliveries)
        .where(and(or(eq(alertDeliveries.status, 'pending'), and(eq(alertDeliveries.status, 'failed'), lt(alertDeliveries.attempt, ALERT_MAX_ATTEMPTS))), 
    // `coalesce(...)` carries no column type, so drizzle has nothing to map
    // the bound value through and postgres.js receives a raw Date it cannot
    // encode. Bind the cutoff as an explicit ISO `timestamptz` instead.
    sql `coalesce(${alertDeliveries.firstAttemptAt}, ${alertDeliveries.createdAt}) < ${input.retryAfter.toISOString()}::timestamptz`))
        .orderBy(alertDeliveries.createdAt, alertDeliveries.id)
        .limit(input.limit);
    if (candidates.length === 0)
        return [];
    const unknownIds = candidates.filter((row) => row.requestFingerprint !== null &&
        (row.status === 'pending' || row.errorCode === 'provider_outcome_unknown')).map((row) => row.id);
    const knownIds = candidates
        .filter((row) => !unknownIds.includes(row.id))
        .map((row) => row.id);
    const expired: AlertDeliveryRow[] = [];
    for (const group of [
        {
            ids: unknownIds,
            errorCode: 'provider_outcome_unknown_idempotency_window_expired' as const,
        },
        { ids: knownIds, errorCode: 'idempotency_window_expired' as const },
    ]) {
        if (group.ids.length === 0)
            continue;
        const rows = await db.update(alertDeliveries).set({
            status: 'failed',
            attempt: ALERT_MAX_ATTEMPTS,
            claimToken: null,
            requestPayload: null,
            errorCode: group.errorCode,
            suppressedReason: null,
            updatedAt: input.now,
        }).where(and(inArray(alertDeliveries.id, group.ids), or(eq(alertDeliveries.status, 'pending'), and(eq(alertDeliveries.status, 'failed'), lt(alertDeliveries.attempt, ALERT_MAX_ATTEMPTS))), 
        // `coalesce(...)` carries no column type, so drizzle has nothing to map
        // the bound value through and postgres.js receives a raw Date it cannot
        // encode. Bind the cutoff as an explicit ISO `timestamptz` instead.
        sql `coalesce(${alertDeliveries.firstAttemptAt}, ${alertDeliveries.createdAt}) < ${input.retryAfter.toISOString()}::timestamptz`)).returning();
        expired.push(...rows);
    }
    return expired;
}
/** Bounded rows whose dispatch job may have vanished with Redis/a worker. */
export async function listRecoverableAlertDeliveries(db: Db, input: {
    retryAfter: Date;
    staleBefore: Date;
    limit: number;
}): Promise<AlertDeliveryRow[]> {
    return db
        .select()
        .from(alertDeliveries)
        .where(and(
    // Same driver constraint as the expiry sweep above — bind an explicit
    // ISO `timestamptz` rather than a raw Date.
    sql `coalesce(${alertDeliveries.firstAttemptAt}, ${alertDeliveries.createdAt}) >= ${input.retryAfter.toISOString()}::timestamptz`, or(and(eq(alertDeliveries.status, 'failed'), lt(alertDeliveries.attempt, ALERT_MAX_ATTEMPTS), or(isNull(alertDeliveries.errorCode), notInArray(alertDeliveries.errorCode, [
        'provider_outcome_unknown_payload_drift',
        'provider_outcome_unknown_idempotency_window_expired',
        'idempotency_window_expired',
    ]))), and(eq(alertDeliveries.status, 'pending'), lte(alertDeliveries.updatedAt, input.staleBefore)))))
        .orderBy(sql `${alertDeliveries.reconciledAt} asc nulls first`, alertDeliveries.updatedAt, alertDeliveries.id)
        .limit(input.limit);
}
export async function markAlertDeliveriesReconciled(db: Db, ids: string[], now: Date): Promise<void> {
    if (ids.length === 0)
        return;
    await db.update(alertDeliveries).set({ reconciledAt: now })
        .where(inArray(alertDeliveries.id, ids));
}
/** Fail closed and scrub a corrupt durable request/evidence row. */
export async function terminalizeInvalidAlertDeliveries(db: Db, ids: string[], now: Date): Promise<void> {
    if (ids.length === 0)
        return;
    await db.update(alertDeliveries).set({
        status: 'failed',
        attempt: ALERT_MAX_ATTEMPTS,
        claimToken: null,
        requestPayload: null,
        errorCode: 'provider_outcome_unknown_payload_drift',
        suppressedReason: null,
        updatedAt: now,
        reconciledAt: now,
    }).where(and(inArray(alertDeliveries.id, ids), inArray(alertDeliveries.status, ['pending', 'failed'])));
}
export async function findDeliveryByKey(db: Db, idempotencyKey: string): Promise<AlertDeliveryRow | null> {
    const rows = await db
        .select()
        .from(alertDeliveries)
        .where(eq(alertDeliveries.idempotencyKey, idempotencyKey))
        .limit(1);
    return rows[0] ?? null;
}
export interface ListDeliveriesFilter {
    accountId: string;
    ruleId: string;
    status?: AlertDeliveryStatus;
    channel?: AlertChannel;
    limit: number;
}
export async function listDeliveries(db: Db, filter: ListDeliveriesFilter): Promise<AlertDeliveryRow[]> {
    const clauses = [
        eq(alertDeliveries.accountId, filter.accountId),
        eq(alertDeliveries.ruleId, filter.ruleId),
    ];
    if (filter.status !== undefined) {
        clauses.push(eq(alertDeliveries.status, filter.status));
    }
    if (filter.channel !== undefined) {
        clauses.push(eq(alertDeliveries.channel, filter.channel));
    }
    return db
        .select()
        .from(alertDeliveries)
        .where(and(...clauses))
        .orderBy(desc(alertDeliveries.createdAt), desc(alertDeliveries.id))
        .limit(filter.limit);
}
/**
 * Distinct domain set for one stored toxicity review. `selectDistinct` so a
 * domain linking from many URLs counts exactly once.
 */
export async function readReviewDomains(db: Db, input: {
    accountId: string;
    siteId: string;
    reviewId: string;
}): Promise<string[]> {
    const rows = await db
        .selectDistinct({ domain: backlinkRowSnapshots.domain })
        .from(backlinkRowSnapshots)
        .where(and(eq(backlinkRowSnapshots.accountId, input.accountId), eq(backlinkRowSnapshots.siteId, input.siteId), eq(backlinkRowSnapshots.reviewId, input.reviewId)))
        .orderBy(backlinkRowSnapshots.domain);
    return rows.map((row) => row.domain);
}
/**
 * The review immediately preceding `capturedAt` for this site, by capture time.
 * `null` = no baseline; the caller must NOT emit a link alert.
 */
export async function findPreviousReview(db: Db, input: {
    accountId: string;
    siteId: string;
    capturedAt: Date;
}): Promise<{
    reviewId: string;
    capturedAt: Date;
    rowCount: number;
} | null> {
    const rows = await db
        .select({
        reviewId: backlinkRowSnapshots.reviewId,
        capturedAt: sql<Date> `max(${backlinkRowSnapshots.capturedAt})`,
        rowCount: sql<number> `count(distinct ${backlinkRowSnapshots.domain})`,
    })
        .from(backlinkRowSnapshots)
        .where(and(eq(backlinkRowSnapshots.accountId, input.accountId), eq(backlinkRowSnapshots.siteId, input.siteId), lt(backlinkRowSnapshots.capturedAt, input.capturedAt)))
        .groupBy(backlinkRowSnapshots.reviewId)
        .orderBy(sql `max(${backlinkRowSnapshots.capturedAt}) desc`)
        .limit(1);
    const row = rows[0];
    if (!row)
        return null;
    return {
        reviewId: row.reviewId,
        capturedAt: new Date(row.capturedAt),
        rowCount: Number(row.rowCount),
    };
}
// ---------------------------------------------------------------------------
// Confirmed rank drops — READ ONLY
// ---------------------------------------------------------------------------
export interface ConfirmedRankDropRow {
    confirmationId: string;
    accountId: string;
    siteId: string;
    keyword: string;
    beforePosition: number;
    beforeAt: Date;
    afterPosition: number | null;
    afterAt: Date;
}
/**
 * Settled `confirmed` confirmations inside a bounded recency window.
 *
 * This module is a pure CONSUMER of this table: it never inserts, never settles,
 * and never touches the `alert_claimed_at` / `alert_delivered_at`
 * columns. Re-scanning is safe because the whole idempotency contract lives on
 * `alert_deliveries.idempotency_key` (transition `rank:<confirmationId>`), so a
 * repeated sweep collapses on the deterministic job id and then on the DB
 * claim rather than re-delivering.
 *
 * Rows whose evidence pair is incomplete are filtered out at the SQL level —
 * an alert without both dated observations must never be constructible.
 */
export async function listConfirmedRankDrops(db: Db, input: {
    since: Date;
    limit: number;
}): Promise<ConfirmedRankDropRow[]> {
    const rows = await db
        .select({
        confirmationId: rankDropConfirmations.id,
        accountId: rankDropConfirmations.accountId,
        siteId: rankDropConfirmations.siteId,
        keyword: keywords.phrase,
        beforePosition: rankDropConfirmations.previousPosition,
        beforeAt: rankDropConfirmations.candidateObservedAt,
        afterPosition: rankDropConfirmations.confirmationPosition,
        afterAt: rankDropConfirmations.confirmationObservedAt,
    })
        .from(rankDropConfirmations)
        .innerJoin(keywords, eq(keywords.id, rankDropConfirmations.keywordId))
        .where(and(eq(rankDropConfirmations.state, 'confirmed'), gte(rankDropConfirmations.settledAt, input.since)))
        .orderBy(desc(rankDropConfirmations.settledAt), desc(rankDropConfirmations.id))
        .limit(input.limit);
    return rows.flatMap((row) => row.beforePosition === null || row.beforeAt === null || row.afterAt === null
        ? []
        : [
            {
                confirmationId: row.confirmationId,
                accountId: row.accountId,
                siteId: row.siteId,
                keyword: row.keyword,
                beforePosition: row.beforePosition,
                beforeAt: row.beforeAt,
                afterPosition: row.afterPosition,
                afterAt: row.afterAt,
            },
        ]);
}
/**
 * Recent completed toxicity reviews, newest first. This module only READS
 * `backlink_row_snapshots` — the toxicity pipeline owns every write. Re-scanning is safe for
 * the same reason the rank sweep is: idempotency lives on
 * `alert_deliveries.idempotency_key`, keyed by the ordered review pair.
 */
export async function listRecentReviews(db: Db, input: {
    since: Date;
    limit: number;
}): Promise<Array<{
    accountId: string;
    siteId: string;
    reviewId: string;
    capturedAt: Date;
}>> {
    const rows = await db
        .select({
        accountId: backlinkRowSnapshots.accountId,
        siteId: backlinkRowSnapshots.siteId,
        reviewId: backlinkRowSnapshots.reviewId,
        capturedAt: sql<Date> `max(${backlinkRowSnapshots.capturedAt})`,
    })
        .from(backlinkRowSnapshots)
        .where(gte(backlinkRowSnapshots.capturedAt, input.since))
        .groupBy(backlinkRowSnapshots.accountId, backlinkRowSnapshots.siteId, backlinkRowSnapshots.reviewId)
        .orderBy(sql `max(${backlinkRowSnapshots.capturedAt}) desc`)
        .limit(input.limit);
    return rows.map((row) => ({
        accountId: row.accountId,
        siteId: row.siteId,
        reviewId: row.reviewId,
        capturedAt: new Date(row.capturedAt),
    }));
}
