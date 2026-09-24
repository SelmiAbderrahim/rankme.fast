/** Crash-safe, short-lived exact email outbox for scheduled client reports. */
import { createHash, randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { and, eq, inArray, isNull, lt, lte, notInArray, or, } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import { isSupportedLocale, SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import type { Db } from '../../db/client.js';
import { CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES, scheduledReportDeliveries, scheduledReportRuns, type ScheduledReportDeliveryRow, type ScheduledReportRow, } from '../../db/schema/index.js';
import { CLIENT_REPORT_JOB_NAME } from '../../shared/queue/index.js';
import { clientReportEmailRequestFingerprint, type FrozenClientReportEmailPayload, type PreparedClientReportEmail, } from '../communication/index.js';
export const CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS = 3;
export const CLIENT_REPORT_DELIVERY_LEASE_MS = 30000;
export const CLIENT_REPORT_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const CLIENT_REPORT_RECONCILE_LIMIT = 100;
const fingerprintSchema = z.string().regex(/^request-hmac-v1:[0-9a-f]{64}$/u);
const frozenPayloadBase = {
    senderIdentity: z.string().max(320).nullable(),
    subject: z.string().max(2000),
    text: z.string().max(50000),
    html: z.string().max(100000),
    attachment: z.object({
        filename: z.literal('client-report.pdf'),
        contentBase64: z.string().max(Math.ceil(CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES * 4 / 3)),
        contentType: z.literal('application/pdf'),
    }).strict(),
};
const legacyFrozenPayloadSchema = z.object({
    version: z.literal('rankmefast.client-report-email.v1'),
    ...frozenPayloadBase,
}).strict();
const frozenPayloadSchema = z.discriminatedUnion('version', [
    legacyFrozenPayloadSchema,
    z.object({
        version: z.literal('rankmefast.client-report-email.v2'),
        locale: z.enum(SUPPORTED_LOCALES),
        ...frozenPayloadBase,
    }).strict(),
]);
function legacyClientReportPayloadLocale(html: string): string | null {
    const locale = /<html\b[^>]*\blang="([a-z]{2})"/u.exec(html)?.[1];
    return isSupportedLocale(locale) ? locale : null;
}
export function parseFrozenClientReportPayload(value: unknown): FrozenClientReportEmailPayload {
    const payload = frozenPayloadSchema.parse(value);
    if (payload.version === 'rankmefast.client-report-email.v1' &&
        legacyClientReportPayloadLocale(payload.html) === null) {
        throw new Error('legacy client report payload has no unambiguous stored locale');
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES) {
        throw new Error('client report frozen payload exceeds the durable outbox ceiling');
    }
    return payload;
}
export interface ClientReportDeliveryClaim extends ScheduledReportDeliveryRow {
    claimToken: string;
    requestFingerprint: string;
}
export async function freezeClientReportRun(db: Db, input: {
    schedule: ScheduledReportRow;
    runKey: string;
    scheduledFor: Date;
    snapshotDate: Date;
    prepared: PreparedClientReportEmail;
    now: Date;
}): Promise<{
    created: boolean;
    claims: ClientReportDeliveryClaim[];
}> {
    const payload = parseFrozenClientReportPayload(input.prepared.payload);
    return db.transaction(async (tx) => {
        const [run] = await tx
            .insert(scheduledReportRuns)
            .values({
            scheduleId: input.schedule.id,
            accountId: input.schedule.accountId,
            siteId: input.schedule.siteId,
            runKey: input.runKey,
            scheduledFor: input.scheduledFor,
            snapshotDate: input.snapshotDate,
            payload,
            createdAt: input.now,
            updatedAt: input.now,
        })
            .onConflictDoNothing({
            target: [scheduledReportRuns.scheduleId, scheduledReportRuns.runKey],
        })
            .returning();
        if (!run)
            return { created: false, claims: [] };
        // A prior composition failure is known to have crossed no provider
        // boundary, so this is the only failed state safe to replace with a claim.
        await tx.delete(scheduledReportDeliveries).where(and(eq(scheduledReportDeliveries.scheduleId, input.schedule.id), eq(scheduledReportDeliveries.runKey, input.runKey), eq(scheduledReportDeliveries.status, 'failed'), eq(scheduledReportDeliveries.errorCode, 'composition_failed')));
        const eligible = new Map(input.prepared.recipients.map((recipient) => [
            recipient.email,
            recipient,
        ]));
        const suppressed = new Map(input.prepared.suppressed.map((outcome) => [
            outcome.email,
            outcome,
        ]));
        const values = input.schedule.recipients.map((recipient) => {
            const send = eligible.get(recipient);
            if (send) {
                return {
                    scheduleId: input.schedule.id,
                    accountId: input.schedule.accountId,
                    siteId: input.schedule.siteId,
                    runKey: input.runKey,
                    recipient,
                    status: 'pending' as const,
                    attempt: 1,
                    claimToken: randomUUID(),
                    requestFingerprint: clientReportEmailRequestFingerprint(payload, send),
                    firstAttemptAt: input.now,
                    suppressionReason: null,
                    errorCode: null,
                    providerMessageId: null,
                    snapshotDate: input.snapshotDate,
                    createdAt: input.now,
                    updatedAt: input.now,
                    finishedAt: null,
                };
            }
            const terminal = suppressed.get(recipient);
            if (!terminal)
                throw new Error('client report recipient preparation is incomplete');
            return {
                scheduleId: input.schedule.id,
                accountId: input.schedule.accountId,
                siteId: input.schedule.siteId,
                runKey: input.runKey,
                recipient,
                status: 'suppressed' as const,
                attempt: 0,
                claimToken: null,
                requestFingerprint: null,
                firstAttemptAt: null,
                suppressionReason: terminal.suppressionReason,
                errorCode: null,
                providerMessageId: null,
                snapshotDate: input.snapshotDate,
                createdAt: input.now,
                updatedAt: input.now,
                finishedAt: input.now,
            };
        });
        const inserted = await tx
            .insert(scheduledReportDeliveries)
            .values(values)
            .onConflictDoNothing({
            target: [
                scheduledReportDeliveries.scheduleId,
                scheduledReportDeliveries.runKey,
                scheduledReportDeliveries.recipient,
            ],
        })
            .returning();
        const claims = inserted.filter((row): row is ClientReportDeliveryClaim => row.status === 'pending' &&
            row.claimToken !== null &&
            row.requestFingerprint !== null);
        return { created: true, claims };
    });
}
export async function loadClientReportRun(db: Db, scheduleId: string, runKey: string) {
    return db.query.scheduledReportRuns.findFirst({
        where: and(eq(scheduledReportRuns.scheduleId, scheduleId), eq(scheduledReportRuns.runKey, runKey)),
    });
}
export async function claimClientReportRunDeliveries(db: Db, input: {
    scheduleId: string;
    runKey: string;
    payload: FrozenClientReportEmailPayload;
    now: Date;
}): Promise<ClientReportDeliveryClaim[]> {
    const rows = await db.select().from(scheduledReportDeliveries).where(and(eq(scheduledReportDeliveries.scheduleId, input.scheduleId), eq(scheduledReportDeliveries.runKey, input.runKey), inArray(scheduledReportDeliveries.status, ['pending', 'failed'])));
    const claims: ClientReportDeliveryClaim[] = [];
    const retryAfter = new Date(input.now.getTime() - CLIENT_REPORT_IDEMPOTENCY_RETRY_WINDOW_MS);
    const staleBefore = new Date(input.now.getTime() - CLIENT_REPORT_DELIVERY_LEASE_MS);
    for (const row of rows) {
        const expected = clientReportEmailRequestFingerprint(input.payload, {
            email: row.recipient,
            idempotencyKey: clientReportDeliveryIdempotencyKey(row.scheduleId, row.runKey, row.recipient),
        });
        if (!row.requestFingerprint || !fingerprintSchema.safeParse(row.requestFingerprint).success ||
            row.requestFingerprint !== expected) {
            await terminalizeClientReportDelivery(db, row, {
                errorCode: 'provider_outcome_unknown_payload_drift',
                now: input.now,
            });
            continue;
        }
        if (!row.firstAttemptAt || row.firstAttemptAt < retryAfter) {
            await terminalizeClientReportDelivery(db, row, {
                errorCode: row.status === 'pending' || row.errorCode === 'provider_outcome_unknown'
                    ? 'provider_outcome_unknown_idempotency_window_expired'
                    : 'idempotency_window_expired',
                now: input.now,
            });
            continue;
        }
        const token = randomUUID();
        if (row.status === 'failed') {
            if (row.attempt >= CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS ||
                row.errorCode === 'provider_outcome_unknown_payload_drift' ||
                row.errorCode === 'provider_outcome_unknown_idempotency_window_expired' ||
                row.errorCode === 'idempotency_window_expired')
                continue;
            const [claim] = await db.update(scheduledReportDeliveries).set({
                status: 'pending',
                attempt: row.attempt + 1,
                claimToken: token,
                errorCode: null,
                providerMessageId: null,
                updatedAt: input.now,
                finishedAt: null,
            }).where(and(eq(scheduledReportDeliveries.id, row.id), eq(scheduledReportDeliveries.status, 'failed'), eq(scheduledReportDeliveries.attempt, row.attempt), eq(scheduledReportDeliveries.updatedAt, row.updatedAt))).returning();
            appendReturnedClaim(claim, claims);
            continue;
        }
        // The pending-row shape constraint guarantees a non-null claim token here.
        if (row.updatedAt > staleBefore)
            continue;
        const [claim] = await db.update(scheduledReportDeliveries).set({
            claimToken: token,
            updatedAt: input.now,
        }).where(and(eq(scheduledReportDeliveries.id, row.id), eq(scheduledReportDeliveries.status, 'pending'), eq(scheduledReportDeliveries.claimToken, row.claimToken!), eq(scheduledReportDeliveries.updatedAt, row.updatedAt))).returning();
        appendReturnedClaim(claim, claims);
    }
    return claims;
}
export function clientReportDeliveryIdempotencyKey(scheduleId: string, runKey: string, recipient: string): string {
    const digest = createHash('sha256')
        .update(recipient.trim().toLowerCase(), 'utf8')
        .digest('hex');
    return `client-report/${scheduleId}/${runKey}/${digest}`;
}
async function terminalizeClientReportDelivery(db: Db, row: ScheduledReportDeliveryRow, input: {
    errorCode: 'provider_outcome_unknown_payload_drift' | 'provider_outcome_unknown_idempotency_window_expired' | 'idempotency_window_expired';
    now: Date;
}): Promise<void> {
    await db.update(scheduledReportDeliveries).set({
        status: 'failed',
        attempt: CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS,
        claimToken: null,
        errorCode: input.errorCode,
        providerMessageId: null,
        updatedAt: input.now,
        finishedAt: input.now,
    }).where(and(eq(scheduledReportDeliveries.id, row.id), eq(scheduledReportDeliveries.status, row.status), eq(scheduledReportDeliveries.updatedAt, row.updatedAt)));
}
export async function settleClientReportDelivery(db: Db, claim: ClientReportDeliveryClaim, outcome: {
    status: 'sent' | 'failed';
    errorCode: 'transport_reported_failure' | 'transport_exception' | 'retries_exhausted' | 'provider_outcome_unknown' | null;
    providerMessageId: string | null;
}, now: Date): Promise<ScheduledReportDeliveryRow | null> {
    const [row] = await db.update(scheduledReportDeliveries).set({
        status: outcome.status,
        claimToken: null,
        errorCode: outcome.status === 'failed' &&
            outcome.errorCode !== 'provider_outcome_unknown' &&
            claim.attempt >= CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS
            ? 'retries_exhausted'
            : outcome.errorCode,
        providerMessageId: outcome.providerMessageId,
        updatedAt: now,
        finishedAt: now,
    }).where(and(eq(scheduledReportDeliveries.id, claim.id), eq(scheduledReportDeliveries.status, 'pending'), eq(scheduledReportDeliveries.attempt, claim.attempt), eq(scheduledReportDeliveries.claimToken, claim.claimToken))).returning();
    return row ?? null;
}
export async function purgeClientReportRunIfTerminal(db: Db, scheduleId: string, runKey: string): Promise<boolean> {
    const retryable = await db.select({ id: scheduledReportDeliveries.id })
        .from(scheduledReportDeliveries)
        .where(and(eq(scheduledReportDeliveries.scheduleId, scheduleId), eq(scheduledReportDeliveries.runKey, runKey), or(eq(scheduledReportDeliveries.status, 'pending'), and(eq(scheduledReportDeliveries.status, 'failed'), lt(scheduledReportDeliveries.attempt, CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS), or(isNull(scheduledReportDeliveries.errorCode), notInArray(scheduledReportDeliveries.errorCode, [
        'provider_outcome_unknown_payload_drift',
        'provider_outcome_unknown_idempotency_window_expired',
        'idempotency_window_expired',
    ])))))).limit(1);
    if (retryable.length > 0)
        return false;
    const deleted = await db.delete(scheduledReportRuns).where(and(eq(scheduledReportRuns.scheduleId, scheduleId), eq(scheduledReportRuns.runKey, runKey))).returning({ id: scheduledReportRuns.id });
    return deleted.length > 0;
}
export async function reconcileClientReportDeliveries(db: Db, queue: Queue, options: {
    now?: () => Date;
    logger?: Logger;
} = {}): Promise<{
    examined: number;
    expired: number;
    enqueued: number;
    purged: number;
}> {
    const now = (options.now ?? (() => new Date()))();
    const runs = await db.select().from(scheduledReportRuns)
        .orderBy(scheduledReportRuns.updatedAt, scheduledReportRuns.id)
        .limit(CLIENT_REPORT_RECONCILE_LIMIT);
    let expired = 0;
    let enqueued = 0;
    let purged = 0;
    for (const run of runs) {
        let payload: FrozenClientReportEmailPayload;
        try {
            payload = parseFrozenClientReportPayload(run.payload);
        }
        catch (error) {
            const rows = await db.select().from(scheduledReportDeliveries).where(and(eq(scheduledReportDeliveries.scheduleId, run.scheduleId), eq(scheduledReportDeliveries.runKey, run.runKey), inArray(scheduledReportDeliveries.status, ['pending', 'failed'])));
            for (const row of rows) {
                await terminalizeClientReportDelivery(db, row, {
                    errorCode: 'provider_outcome_unknown_payload_drift',
                    now,
                });
            }
            options.logger?.warn({ runId: run.id, errorName: reconciliationErrorName(error) }, 'client report reconciliation purged an invalid frozen payload');
            await db.delete(scheduledReportRuns).where(eq(scheduledReportRuns.id, run.id));
            purged += 1;
            continue;
        }
        const rows = await db.select().from(scheduledReportDeliveries).where(and(eq(scheduledReportDeliveries.scheduleId, run.scheduleId), eq(scheduledReportDeliveries.runKey, run.runKey), inArray(scheduledReportDeliveries.status, ['pending', 'failed'])));
        const retryAfter = new Date(now.getTime() - CLIENT_REPORT_IDEMPOTENCY_RETRY_WINDOW_MS);
        const staleBefore = new Date(now.getTime() - CLIENT_REPORT_DELIVERY_LEASE_MS);
        for (const row of rows) {
            const expected = clientReportEmailRequestFingerprint(payload, {
                email: row.recipient,
                idempotencyKey: clientReportDeliveryIdempotencyKey(row.scheduleId, row.runKey, row.recipient),
            });
            if (!row.requestFingerprint || row.requestFingerprint !== expected) {
                await terminalizeClientReportDelivery(db, row, {
                    errorCode: 'provider_outcome_unknown_payload_drift',
                    now,
                });
            }
            else if (!row.firstAttemptAt || row.firstAttemptAt < retryAfter) {
                await terminalizeClientReportDelivery(db, row, {
                    errorCode: row.status === 'pending' || row.errorCode === 'provider_outcome_unknown'
                        ? 'provider_outcome_unknown_idempotency_window_expired'
                        : 'idempotency_window_expired',
                    now,
                });
                expired += 1;
            }
        }
        const recoverable = await db.select().from(scheduledReportDeliveries).where(and(eq(scheduledReportDeliveries.scheduleId, run.scheduleId), eq(scheduledReportDeliveries.runKey, run.runKey), or(and(eq(scheduledReportDeliveries.status, 'pending'), lte(scheduledReportDeliveries.updatedAt, staleBefore)), and(eq(scheduledReportDeliveries.status, 'failed'), lt(scheduledReportDeliveries.attempt, CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS), or(isNull(scheduledReportDeliveries.errorCode), notInArray(scheduledReportDeliveries.errorCode, [
            'provider_outcome_unknown_payload_drift',
            'provider_outcome_unknown_idempotency_window_expired',
            'idempotency_window_expired',
        ]))))));
        if (recoverable.length > 0) {
            const generation = Math.max(...recoverable.map((row) => row.updatedAt.getTime()));
            await queue.add(CLIENT_REPORT_JOB_NAME, {
                accountId: run.accountId,
                siteId: run.siteId,
                scheduleId: run.scheduleId,
                runKey: run.runKey,
                scheduledFor: run.scheduledFor.toISOString(),
            }, { jobId: `client-report-recovery-${run.id}-${generation}` });
            enqueued += 1;
        }
        if (await purgeClientReportRunIfTerminal(db, run.scheduleId, run.runKey)) {
            purged += 1;
        }
        else {
            // Rotate every examined live run to the back of the bounded sweep. This
            // prevents 100 fresh/deduped rows from starving the 101st actionable one.
            await db.update(scheduledReportRuns).set({ updatedAt: now })
                .where(eq(scheduledReportRuns.id, run.id));
        }
    }
    return { examined: runs.length, expired, enqueued, purged };
}
function reconciliationErrorName(error: unknown): string {
    return error instanceof Error ? error.name : 'NonError';
}
function appendReturnedClaim(claim: ScheduledReportDeliveryRow | undefined, claims: ClientReportDeliveryClaim[]): void {
    if (!claim)
        return;
    // Both update statements write `pending` with a token, while the table shape
    // constraint guarantees the retained request fingerprint is non-null.
    claims.push(claim as ClientReportDeliveryClaim);
}
export const deliveryOutboxTestables = {
    appendReturnedClaim,
    legacyClientReportPayloadLocale,
    reconciliationErrorName,
};
