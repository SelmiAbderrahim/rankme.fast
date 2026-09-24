/**
 * Weekly Pulse — Resend delivery.
 *
 * `deliverPulseDigest(runId, deps)`:
 *   1. Reads the frozen `weekly_pulse_digest_projection.payload`.
 *      Missing projection → throws `MissingProjectionError` (delivery MUST
 *      NOT recollect).
 *   2. Atomically freezes eligible `site_pulse_subscriptions` into one
 *      durable delivery event per recipient.
 *   3. For each frozen recipient, renders subject + plain-text body via
 *      `translate(locale, ...)` and calls the shared Resend transport.
 *   4. Every provider submission uses the same opaque, non-PII idempotency
 *      key derived from the delivery-event UUID. Crash recovery can therefore
 *      replay an ambiguous `queued` request without a second visible email.
 *   5. CAS transitions fence concurrent/stale attempts. `delivered` is
 *      monotonic; a late transport failure cannot overwrite it.
 *   6. Per-recipient failure isolation: one bad recipient does not block
 *      the others; each terminal state is written independently.
 *
 * Bounded content invariants:
 *   • host, count, keyword, action verb + target, appearance name + numerics.
 *   • NEVER raw AI answers, source excerpts, competitor prose, prompts,
 *     cost internals, vendor task ids, or secrets.
 *   • Every URL is derived from `CLIENT_URL` via the digest renderer's
 *     `buildDeepLinks` (already validated in the projection).
 *
 * Suppression:
 *   • Resend unconfigured → `suppressed_no_transport` (no email sent).
 *   • Membership removed (account owner no longer contains user) →
 *     `suppressed_membership_removed`.
 *   • Subscription disabled before delivery → `suppressed_unsubscribed`.
 */
import { createHmac } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../shared/crypto/index.js';
import { sitePulseSubscriptions, weeklyPulseDeliveryEvents, weeklyPulseRuns, type WeeklyPulseDeliveryEventRow, type WeeklyPulseDeliveryStatus, } from '../../db/schema/weekly-pulse.js';
import { DEFAULT_LOCALE, isSupportedLocale, SUPPORTED_LOCALES, toSupportedLocale, translate, type SupportedLocale, } from '../../shared/i18n/index.js';
import { renderEmailTemplate } from '../../shared/utils/email-template.js';
import { localizeDigestProjection, readDigestProjection, type DigestBrandDelta, type DigestCitationEntry, type DigestGscRow, type DigestProjectionPayload, type DigestRankDrop, type LocalizedDigestActionEntry, } from './digest.renderer.js';
export class MissingProjectionError extends Error {
    constructor(runId: string) {
        super(`weeklyPulse.errors.missingProjection:${runId}`);
        this.name = 'MissingProjectionError';
    }
}
/**
 * Resend retains an idempotency key for 24 hours. Keep a one-hour safety
 * margin for clock skew and provider-boundary latency; an ambiguous request
 * is never replayed after this deadline because doing so could create a
 * second visible email.
 */
export const WEEKLY_PULSE_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** Normal transport/identity attempts are bounded by BullMQ's three tries. */
export const WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS = 3;
/**
 * An in-flight provider call owns its row for longer than the Resend HTTP
 * adapter's 15-second timeout. Reconciliation waits for this lease before it
 * treats `queued` as an interrupted/ambiguous request.
 */
export const WEEKLY_PULSE_DELIVERY_LEASE_MS = 30000;
export interface DeliverPulseDigestDeps {
    db: ApplicationDb;
    /** Injectable transport for the Resend send. Tests pass a stub. */
    sendEmail: (message: {
        to: string;
        subject: string;
        text: string;
        html?: string;
        idempotencyKey: string;
        expectedSenderIdentity?: string | null;
    }) => Promise<{
        delivered: boolean;
        providerMessageId?: string | null;
        /** No authoritative provider response; the request may have landed. */
        outcomeUnknown?: boolean;
    }>;
    /** Optional per-recipient membership resolver. When null → active member. */
    resolveRecipient(input: {
        accountId: string;
        userId: string;
        siteId?: string;
    }): Promise<{
        email: string;
        membership: 'active' | 'removed';
    } | {
        email: null;
        membership: 'active' | 'removed';
    } | null>;
    transportAvailable: () => boolean;
    logger?: Logger;
    now?: () => Date;
    /** Test-only crash seam after provider acceptance and before the DB CAS. */
    afterProviderAccepted?: () => Promise<void>;
    /** Test seam; production HMACs the complete provider payload. */
    fingerprintRequest?: (payload: string) => string;
    /** Test-only race seam immediately before an attempt-status CAS. */
    beforePersistAttemptStatus?: (input: {
        eventId: string;
        attempt: number;
        status: WeeklyPulseDeliveryStatus;
    }) => Promise<void>;
    /** Test-only race seam immediately before the request fingerprint CAS. */
    beforeFingerprintBinding?: (input: {
        eventId: string;
        attempt: number;
        requestFingerprint: string;
        /** Test-only exact encrypted request prepared for the binding CAS. */
        requestEnvelope: string;
    }) => Promise<void>;
}
export interface DeliverPulseDigestOutcome {
    runId: string;
    attempted: number;
    delivered: number;
    suppressed: number;
    errors: number;
    /** Recipients that still need a bounded BullMQ/reconciler replay. */
    retryable: number;
}
export class RetryablePulseDeliveryError extends Error {
    constructor(public readonly outcome: DeliverPulseDigestOutcome) {
        super(`weeklyPulse.errors.deliveryRetryable:${outcome.runId}:${outcome.retryable}`);
        this.name = 'RetryablePulseDeliveryError';
    }
}
interface DeliveryAttemptOutcome {
    status: WeeklyPulseDeliveryStatus;
    retryable: boolean;
    deadLetter: boolean;
}
const REQUEST_ENVELOPE_PREFIX = 'request-envelope-v1:';
const REQUEST_FINGERPRINT_PREFIX = 'request-hmac-v1:';
const frozenPulseEmailRequestSchema = z.object({
    version: z.literal('rankmefast.weekly-pulse-email.v1'),
    locale: z.enum(SUPPORTED_LOCALES),
    senderIdentity: z.string().max(320).nullable(),
    to: z.string().email().max(320),
    subject: z.string().min(1).max(2000),
    text: z.string().min(1).max(50000),
    html: z.string().min(1).max(100000),
    idempotencyKey: z.string().min(1).max(256),
    requestFingerprint: z.string().regex(/^request-hmac-v1:[0-9a-f]{64}$/u),
}).strict();
const historicalEnglishPulseEmailRequestSchema = z.object({
    version: z.literal('rankmefast.weekly-pulse-email.legacy-en.v1'),
    historicalEnglishProvenance: z.literal(true),
    senderIdentity: z.string().max(320).nullable(),
    to: z.string().email().max(320),
    subject: z.string().min(1).max(2000),
    text: z.string().min(1).max(50000),
    idempotencyKey: z.string().min(1).max(256),
    requestFingerprint: z.string().regex(/^request-hmac-v1:[0-9a-f]{64}$/u),
}).strict();
const pulseEmailRequestSchema = z.discriminatedUnion('version', [
    frozenPulseEmailRequestSchema,
    historicalEnglishPulseEmailRequestSchema,
]);
type FrozenPulseEmailRequest = z.infer<typeof pulseEmailRequestSchema>;
function requestEnvelopeAad(eventId: string): string {
    return `weekly-pulse-delivery:${eventId}:request`;
}
function requestFingerprintPayload(request: Omit<z.infer<typeof frozenPulseEmailRequestSchema>, 'requestFingerprint'>): string {
    return JSON.stringify({
        locale: request.locale,
        from: request.senderIdentity,
        to: [request.to],
        subject: request.subject,
        text: request.text,
        html: request.html,
        idempotencyKey: request.idempotencyKey,
    });
}
function historicalEnglishFingerprintPayload(request: Omit<z.infer<typeof historicalEnglishPulseEmailRequestSchema>, 'requestFingerprint'>): string {
    return JSON.stringify({
        from: request.senderIdentity ?? '',
        to: request.to,
        subject: request.subject,
        text: request.text,
    });
}
function fingerprintPayload(deps: DeliverPulseDigestDeps, payload: string): string {
    const digest = deps.fingerprintRequest
        ? deps.fingerprintRequest(payload)
        : createHmac('sha256', env.MASTER_ENCRYPTION_KEY).update(payload).digest('hex');
    return `${REQUEST_FINGERPRINT_PREFIX}${digest}`;
}
function sealFrozenPulseRequest(eventId: string, request: FrozenPulseEmailRequest): string {
    const encrypted = encryptSecret(JSON.stringify(request), {
        aad: requestEnvelopeAad(eventId),
    });
    return `${REQUEST_ENVELOPE_PREFIX}${Buffer.from(JSON.stringify(encrypted), 'utf8').toString('base64url')}`;
}
function openFrozenPulseRequest(deps: DeliverPulseDigestDeps, eventId: string, stored: string | null): FrozenPulseEmailRequest | null {
    if (!stored?.startsWith(REQUEST_ENVELOPE_PREFIX))
        return null;
    const encoded = stored.slice(REQUEST_ENVELOPE_PREFIX.length);
    const encrypted = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Parameters<typeof decryptSecret>[0];
    const request = pulseEmailRequestSchema.parse(JSON.parse(decryptSecret(encrypted, {
        aad: requestEnvelopeAad(eventId),
    })));
    const payload = request.version === 'rankmefast.weekly-pulse-email.v1'
        ? requestFingerprintPayload(request)
        : historicalEnglishFingerprintPayload(request);
    return fingerprintPayload(deps, payload) === request.requestFingerprint
        ? request
        : null;
}
/**
 * Emit the pulse digest to every frozen eligible recipient. Retries are safe:
 * the unique index collapses recipient replays, CAS transitions fence stale
 * workers, and the stable provider idempotency key collapses the external
 * side effect too.
 */
export async function deliverPulseDigest(runId: string, deps: DeliverPulseDigestDeps): Promise<DeliverPulseDigestOutcome> {
    const now = (deps.now ?? (() => new Date()))();
    const projection = await readDigestProjection(deps.db, runId);
    if (!projection)
        throw new MissingProjectionError(runId);
    const runRows = await deps.db
        .select({
        accountId: weeklyPulseRuns.accountId,
        siteId: weeklyPulseRuns.siteId,
        finishedAt: weeklyPulseRuns.finishedAt,
    })
        .from(weeklyPulseRuns)
        .where(eq(weeklyPulseRuns.id, runId))
        .limit(1);
    const runMeta = runRows[0];
    // Defense-in-depth: with the shipped FK cascade a vanished run also takes
    // the projection (first check above), but a caller-supplied store without
    // that guarantee can still surface the orphan — so the throw stays.
    if (!runMeta)
        throw new MissingProjectionError(runId);
    // Completed/partial production rows always carry finishedAt. `now` is the
    // compatibility fallback for terminal rows written by an older release.
    const recipientCutoff = runMeta.finishedAt ?? now;
    const insertedEventIds = await freezeDeliveryRecipients(deps, {
        runId,
        accountId: runMeta.accountId,
        siteId: runMeta.siteId,
        recipientCutoff,
        now,
    });
    const events = await deps.db
        .select()
        .from(weeklyPulseDeliveryEvents)
        .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    const transportUp = deps.transportAvailable();
    let delivered = 0;
    let suppressed = 0;
    let errors = 0;
    let retryable = 0;
    let deadLetters = 0;
    for (const event of events) {
        const result = await deliverOne(deps, {
            runId,
            accountId: runMeta.accountId,
            siteId: runMeta.siteId,
            event,
            ownsInitialAttempt: insertedEventIds.has(event.id),
            projection,
            transportUp,
            now,
        });
        if (result.status === 'delivered')
            delivered += 1;
        else if (result.status === 'not_delivered' || result.status === 'queued') {
            errors += 1;
        }
        else
            suppressed += 1;
        if (result.retryable)
            retryable += 1;
        if (result.deadLetter)
            deadLetters += 1;
    }
    const outcome = {
        runId,
        attempted: events.length,
        delivered,
        suppressed,
        errors,
        retryable,
    };
    // Process every recipient first. Throwing only after isolation completes
    // asks BullMQ to replay the same frozen outbox without withholding a good
    // recipient because another recipient's transport was transiently down.
    if (retryable > 0)
        throw new RetryablePulseDeliveryError(outcome);
    if (deadLetters > 0) {
        throw new UnrecoverableError(`weeklyPulse.errors.deliveryPayloadInvalid:${runId}:${deadLetters}`);
    }
    return outcome;
}
async function freezeDeliveryRecipients(deps: DeliverPulseDigestDeps, args: {
    runId: string;
    accountId: string;
    siteId: string;
    recipientCutoff: Date;
    now: Date;
}): Promise<Set<string>> {
    const insertedIds = await deps.db.transaction(async (tx) => {
        // Freeze only users who were opted in by collection completion. A user
        // who subscribes during a later retry must not receive an old pulse.
        // A user who disables after collection remains frozen so the delivery
        // gate can persist the honest suppression state.
        const subscriptions = await tx
            .select({
            userId: sitePulseSubscriptions.userId,
            locale: sitePulseSubscriptions.locale,
        })
            .from(sitePulseSubscriptions)
            .where(and(eq(sitePulseSubscriptions.accountId, args.accountId), eq(sitePulseSubscriptions.siteId, args.siteId), lte(sitePulseSubscriptions.enabledAt, args.recipientCutoff), or(isNull(sitePulseSubscriptions.disabledAt), gte(sitePulseSubscriptions.disabledAt, args.recipientCutoff))));
        if (subscriptions.length === 0)
            return [];
        return tx
            .insert(weeklyPulseDeliveryEvents)
            .values(subscriptions.map((subscription) => ({
            pulseRunId: args.runId,
            userId: subscription.userId,
            channel: 'email' as const,
            locale: subscription.locale,
            status: 'queued' as const,
            attempt: 1,
            createdAt: args.now,
            updatedAt: args.now,
        })))
            .onConflictDoNothing({
            target: [
                weeklyPulseDeliveryEvents.pulseRunId,
                weeklyPulseDeliveryEvents.userId,
                weeklyPulseDeliveryEvents.channel,
            ],
        })
            .returning({ id: weeklyPulseDeliveryEvents.id });
    });
    return new Set(insertedIds.map((row) => row.id));
}
async function deliverOne(deps: DeliverPulseDigestDeps, args: {
    runId: string;
    accountId: string;
    siteId: string;
    event: WeeklyPulseDeliveryEventRow;
    ownsInitialAttempt: boolean;
    projection: DigestProjectionPayload;
    transportUp: boolean;
    now: Date;
}): Promise<DeliveryAttemptOutcome> {
    const claim = args.ownsInitialAttempt
        ? args.event
        : await claimReplayAttempt(deps, args.event, args.now);
    if (!claim) {
        const current = await readDeliveryEvent(deps, args.event.id);
        return classifyStoredStatus(current);
    }
    const persistAttemptStatus = async (status: WeeklyPulseDeliveryStatus, extras: {
        providerMessageId?: string | null;
        errorCode?: string | null;
        errorDetailSafe?: string | null;
    } = {}): Promise<DeliveryAttemptOutcome> => {
        await deps.beforePersistAttemptStatus?.({
            eventId: claim.id,
            attempt: claim.attempt,
            status,
        });
        const rows = await deps.db
            .update(weeklyPulseDeliveryEvents)
            .set({
            status,
            providerMessageId: extras.providerMessageId ?? null,
            errorCode: extras.errorCode ?? null,
            errorDetailSafe: extras.errorDetailSafe ?? null,
            updatedAt: args.now,
        })
            .where(and(eq(weeklyPulseDeliveryEvents.id, claim.id), eq(weeklyPulseDeliveryEvents.status, 'queued'), eq(weeklyPulseDeliveryEvents.attempt, claim.attempt)))
            .returning();
        const row = rows[0] ?? (await readDeliveryEvent(deps, claim.id));
        return classifyStoredStatus(row);
    };
    let request: FrozenPulseEmailRequest | null = null;
    let frozenEnvelope = claim.errorDetailSafe?.startsWith(REQUEST_ENVELOPE_PREFIX)
        ? claim.errorDetailSafe
        : null;
    try {
        request = openFrozenPulseRequest(deps, claim.id, claim.errorDetailSafe);
    }
    catch (err) {
        deps.logger?.warn({ errorName: err instanceof Error ? err.name : 'NonError', runId: args.runId }, 'weekly-pulse frozen request failed closed');
    }
    // Only the worker that inserted this event may resolve mutable recipient
    // state and render it. A crash-stranded or legacy unrendered row is
    // ambiguous and therefore terminally sends nothing.
    if (!request && !args.ownsInitialAttempt) {
        return persistAttemptStatus('not_delivered', {
            errorCode: 'legacy_unrendered_locale_or_payload_missing',
            errorDetailSafe: null,
        });
    }
    if (!request) {
        if (!isSupportedLocale(claim.locale)) {
            return persistAttemptStatus('not_delivered', {
                errorCode: 'invalid_frozen_locale',
                errorDetailSafe: null,
            });
        }
        // Freeze eligibility once: disabled subscription > membership > transport.
        const currentSubscriptions = await deps.db
            .select({ disabledAt: sitePulseSubscriptions.disabledAt })
            .from(sitePulseSubscriptions)
            .where(and(eq(sitePulseSubscriptions.accountId, args.accountId), eq(sitePulseSubscriptions.siteId, args.siteId), eq(sitePulseSubscriptions.userId, claim.userId)))
            .limit(1);
        if (!currentSubscriptions[0] || currentSubscriptions[0].disabledAt !== null) {
            return persistAttemptStatus('suppressed_unsubscribed');
        }
        let recipient: Awaited<ReturnType<DeliverPulseDigestDeps['resolveRecipient']>>;
        try {
            recipient = await deps.resolveRecipient({
                accountId: args.accountId,
                userId: claim.userId,
                siteId: args.siteId,
            });
        }
        catch (err) {
            deps.logger?.error({ errorName: err instanceof Error ? err.name : 'NonError', runId: args.runId }, 'weekly-pulse recipient resolution threw');
            return persistAttemptStatus('not_delivered', {
                errorCode: 'recipient_resolution_exception',
                errorDetailSafe: null,
            });
        }
        if (!recipient || recipient.membership === 'removed' || !recipient.email) {
            return persistAttemptStatus('suppressed_membership_removed');
        }
        if (!args.transportUp)
            return persistAttemptStatus('suppressed_no_transport');
        const locale: SupportedLocale = claim.locale;
        const subject = translate(locale, 'weeklyPulse.emailSubject', {
            siteLabel: args.projection.header.siteLabel,
            isoWeek: args.projection.header.isoWeek,
        });
        const text = renderPlainTextBody(locale, args.projection);
        const html = renderEmailTemplate({ subject, text, locale });
        const baseRequest = {
            version: 'rankmefast.weekly-pulse-email.v1' as const,
            locale,
            senderIdentity: env.RESEND_FROM ?? null,
            to: recipient.email,
            subject,
            text,
            html,
            idempotencyKey: `weekly-pulse/${claim.id}`,
        };
        const requestFingerprint = fingerprintPayload(deps, requestFingerprintPayload(baseRequest));
        request = { ...baseRequest, requestFingerprint };
        const envelope = sealFrozenPulseRequest(claim.id, request);
        await deps.beforeFingerprintBinding?.({
            eventId: claim.id,
            attempt: claim.attempt,
            requestFingerprint,
            requestEnvelope: envelope,
        });
        const boundRows = await deps.db
            .update(weeklyPulseDeliveryEvents)
            .set({ errorDetailSafe: envelope, updatedAt: args.now })
            .where(and(eq(weeklyPulseDeliveryEvents.id, claim.id), eq(weeklyPulseDeliveryEvents.status, 'queued'), eq(weeklyPulseDeliveryEvents.attempt, claim.attempt), isNull(weeklyPulseDeliveryEvents.errorDetailSafe)))
            .returning();
        const boundRow = boundRows[0] ?? (await readDeliveryEvent(deps, claim.id));
        const concurrent = openFrozenPulseRequest(deps, claim.id, boundRow.errorDetailSafe);
        if (!concurrent || concurrent.requestFingerprint !== requestFingerprint) {
            return persistAttemptStatus('not_delivered', {
                errorCode: 'provider_outcome_unknown_payload_drift',
                errorDetailSafe: boundRow.errorDetailSafe,
            });
        }
        request = concurrent;
        frozenEnvelope = boundRow.errorDetailSafe;
    }
    if (!frozenEnvelope) {
        return persistAttemptStatus('not_delivered', {
            errorCode: 'provider_outcome_unknown_payload_drift',
            errorDetailSafe: null,
        });
    }
    const envelope = frozenEnvelope;
    let result: Awaited<ReturnType<DeliverPulseDigestDeps['sendEmail']>>;
    try {
        result = await deps.sendEmail({
            to: request.to,
            subject: request.subject,
            text: request.text,
            ...(request.version === 'rankmefast.weekly-pulse-email.v1'
                ? { html: request.html }
                : {}),
            idempotencyKey: request.idempotencyKey,
            expectedSenderIdentity: request.senderIdentity,
        });
    }
    catch (err) {
        deps.logger?.error({
            errorName: err instanceof Error ? err.name : 'NonError',
            runId: args.runId,
        }, 'weekly-pulse delivery threw');
        return claim.attempt >= WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS
            ? persistAttemptStatus('not_delivered', {
                errorCode: 'provider_outcome_unknown_transport_exhausted',
                errorDetailSafe: envelope,
            })
            : persistAttemptStatus('not_delivered', {
                errorCode: 'transport_exception',
                errorDetailSafe: envelope,
            });
    }
    if (!result.delivered) {
        const terminalErrorCode = result.outcomeUnknown
            ? 'provider_outcome_unknown_transport_exhausted'
            : 'transport_retries_exhausted';
        return claim.attempt >= WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS
            ? persistAttemptStatus('not_delivered', {
                errorCode: terminalErrorCode,
                errorDetailSafe: envelope,
            })
            : persistAttemptStatus('not_delivered', {
                errorCode: result.outcomeUnknown
                    ? 'transport_exception'
                    : 'transport_reported_failure',
                errorDetailSafe: envelope,
            });
    }
    // This seam deliberately sits outside the transport try/catch: a thrown
    // value models process death, so the durable row must remain `queued`.
    await deps.afterProviderAccepted?.();
    // Delivery is monotonic. A stale failure/suppression CAS cannot overwrite
    // an accepted provider request; conversely this truthful outcome may repair
    // an ambiguous row that another claimant temporarily marked not_delivered.
    const deliveredRows = await deps.db
        .update(weeklyPulseDeliveryEvents)
        .set({
        status: 'delivered',
        providerMessageId: result.providerMessageId ?? null,
        errorCode: null,
        errorDetailSafe: null,
        updatedAt: args.now,
    })
        .where(eq(weeklyPulseDeliveryEvents.id, claim.id))
        .returning();
    return classifyStoredStatus(deliveredRows[0] ?? (await readDeliveryEvent(deps, claim.id)));
}
async function claimReplayAttempt(deps: DeliverPulseDigestDeps, event: WeeklyPulseDeliveryEventRow, now: Date): Promise<WeeklyPulseDeliveryEventRow | null> {
    if (event.errorCode?.startsWith('provider_outcome_unknown_'))
        return null;
    if (event.status === 'delivered' ||
        event.status === 'suppressed_no_transport' ||
        event.status === 'suppressed_membership_removed' ||
        event.status === 'suppressed_unsubscribed') {
        return null;
    }
    const retryDeadline = event.createdAt.getTime() + WEEKLY_PULSE_IDEMPOTENCY_RETRY_WINDOW_MS;
    if (now.getTime() >= retryDeadline) {
        await deps.db
            .update(weeklyPulseDeliveryEvents)
            .set({
            status: 'not_delivered',
            attempt: Math.max(event.attempt, WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS),
            errorCode: 'idempotency_window_expired',
            errorDetailSafe: event.errorDetailSafe,
            updatedAt: now,
        })
            .where(and(eq(weeklyPulseDeliveryEvents.id, event.id), eq(weeklyPulseDeliveryEvents.status, event.status), eq(weeklyPulseDeliveryEvents.attempt, event.attempt)));
        return null;
    }
    if (event.status === 'not_delivered' && event.attempt >= WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS) {
        return null;
    }
    if (event.status === 'queued' &&
        now.getTime() - event.updatedAt.getTime() < WEEKLY_PULSE_DELIVERY_LEASE_MS) {
        return null;
    }
    // A queued row at the normal-attempt ceiling is an interrupted request,
    // not a known transport failure. Reclaim it without increasing the normal
    // attempt counter and replay only inside Resend's idempotency window.
    const nextAttempt = event.status === 'queued' && event.attempt >= WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS
        ? event.attempt
        : event.attempt + 1;
    const rows = await deps.db
        .update(weeklyPulseDeliveryEvents)
        .set({
        status: 'queued',
        attempt: nextAttempt,
        updatedAt: now,
    })
        .where(and(eq(weeklyPulseDeliveryEvents.id, event.id), eq(weeklyPulseDeliveryEvents.status, event.status), eq(weeklyPulseDeliveryEvents.attempt, event.attempt), eq(weeklyPulseDeliveryEvents.updatedAt, event.updatedAt)))
        .returning();
    return rows[0] ?? null;
}
async function readDeliveryEvent(deps: DeliverPulseDigestDeps, eventId: string): Promise<WeeklyPulseDeliveryEventRow> {
    const rows = await deps.db
        .select()
        .from(weeklyPulseDeliveryEvents)
        .where(eq(weeklyPulseDeliveryEvents.id, eventId))
        .limit(1);
    if (!rows[0])
        throw new Error('weekly pulse delivery event disappeared');
    return rows[0];
}
function classifyStoredStatus(row: WeeklyPulseDeliveryEventRow): DeliveryAttemptOutcome {
    const outcomeUnknown = row.errorCode?.startsWith('provider_outcome_unknown_') ?? false;
    const invalidPayload = row.errorCode === 'legacy_unrendered_locale_or_payload_missing' ||
        row.errorCode === 'invalid_frozen_locale';
    return {
        status: row.status,
        retryable: (row.status === 'queued' && !outcomeUnknown && !invalidPayload) ||
            (row.status === 'not_delivered' && !outcomeUnknown && !invalidPayload &&
                row.attempt < WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS),
        deadLetter: invalidPayload,
    };
}
export const weeklyPulseDeliveryTestables = {
    claimReplayAttempt,
    deliverOne,
    fingerprintPayload,
    historicalEnglishFingerprintPayload,
    localizedDigestLink,
    openFrozenPulseRequest,
    readDeliveryEvent,
    requestFingerprintPayload,
    sealFrozenPulseRequest,
};
// ---------------------------------------------------------------------------
// Plain-text body renderer — pure (no clock, no IO)
// ---------------------------------------------------------------------------
const SECTION_SEPARATOR = '\n\n';
type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;
export function renderPlainTextBody(locale: string, projection: DigestProjectionPayload): string {
    const t: TranslateFn = (key, vars) => translate(locale, key, vars);
    const localizedActions = localizeDigestProjection(toSupportedLocale(locale), projection);
    const lines: string[] = [];
    lines.push(t('weeklyPulse.emailHeading', {
        siteLabel: projection.header.siteLabel,
    }));
    lines.push(t('weeklyPulse.sections.coverage', {
        supported: projection.coverage.supported,
        total: projection.coverage.total,
    }));
    if (projection.coverage.partial) {
        lines.push(t('weeklyPulse.partial'));
    }
    lines.push('');
    lines.push(sectionBlock(t, 'newCitations', projection.citations_new, renderCitationLine, 'empty.newCitations'));
    lines.push(sectionBlock(t, 'lostCitations', projection.citations_lost, renderCitationLine, 'empty.lostCitations'));
    lines.push(sectionBlock(t, 'unknownPartial', projection.citations_unknown_partial, renderCitationLine, 'empty.unknownPartial'));
    lines.push(sectionBlock(t, 'confirmedDrops', projection.confirmed_rank_drops, renderRankLine, 'empty.confirmedDrops'));
    lines.push(sectionBlock(t, 'actionsChanged', [...localizedActions.actions_completed, ...localizedActions.actions_regressed], renderActionLine, 'empty.actionsChanged'));
    lines.push(sectionBlock(t, 'top3', localizedActions.next_actions_top3, renderActionLine, 'empty.top3'));
    // GSC generative appearance — separate section, NEVER merged.
    lines.push('');
    lines.push(t('weeklyPulse.sections.gscGenerative'));
    if (projection.gsc_appearance.status === 'available') {
        for (const row of projection.gsc_appearance.rows.filter((r) => r.isGenerative)) {
            lines.push(`- ${renderGscRow(t, row)}`);
        }
    }
    else if (projection.gsc_appearance.status === 'reconnect_required') {
        lines.push(t('weeklyPulse.unavailable.gscReconnect'));
    }
    else if (projection.gsc_appearance.status === 'partial') {
        lines.push(t('weeklyPulse.partial'));
    }
    else {
        lines.push(t('weeklyPulse.unavailable.gscGenerative'));
    }
    // Brand Radar deltas — account-scoped, per tracked query. Bounded
    // safe fields only: the stored query label plus integer / percentage-point
    // deltas. Never a mention snippet, a mention URL, or a digest sentence.
    lines.push('');
    lines.push(t('weeklyPulse.brandDeltas.sectionTitle'));
    lines.push(t('weeklyPulse.brandDeltas.scopeNote'));
    const brandDeltas = projection.brand_deltas ?? [];
    if (brandDeltas.length === 0) {
        lines.push(t('weeklyPulse.brandDeltas.empty'));
    }
    else {
        for (const delta of brandDeltas) {
            lines.push(`- ${renderBrandDeltaLine(t, delta)}`);
        }
    }
    // Deep links — never a hardcoded origin (already CLIENT_URL-derived).
    lines.push('');
    lines.push(t('weeklyPulse.sections.deepLinks'));
    lines.push(`- ${t('weeklyPulse.cta.openDigest')}: ${localizedDigestLink(locale, projection.deep_links.digest)}`);
    lines.push(`- ${t('weeklyPulse.cta.openAiVisibility')}: ${localizedDigestLink(locale, projection.deep_links.aiVisibility)}`);
    lines.push(`- ${t('weeklyPulse.cta.openGoogle')}: ${localizedDigestLink(locale, projection.deep_links.google)}`);
    lines.push(`- ${t('weeklyPulse.cta.openContentIntelligence')}: ${localizedDigestLink(locale, projection.deep_links.contentIntelligence)}`);
    lines.push(`- ${t('weeklyPulse.cta.openAudienceResearch')}: ${localizedDigestLink(locale, projection.deep_links.audienceResearch)}`);
    lines.push(`- ${t('weeklyPulse.cta.openNextActions')}: ${localizedDigestLink(locale, projection.deep_links.nextActions)}`);
    return lines.join('\n');
}
function localizedDigestLink(locale: string, rawUrl: string): string {
    if (!isSupportedLocale(locale) || locale === DEFAULT_LOCALE)
        return rawUrl;
    try {
        const url = new URL(rawUrl);
        const app = new URL(env.APP_URL);
        if (url.origin !== app.origin || url.pathname.startsWith(`/${locale}/`))
            return rawUrl;
        url.pathname = `/${locale}${url.pathname.startsWith('/') ? '' : '/'}${url.pathname}`;
        return url.toString();
    }
    catch {
        return rawUrl;
    }
}
function sectionBlock<T>(t: TranslateFn, sectionKey: string, items: readonly T[], render: (t: TranslateFn, item: T) => string, emptyKey: string): string {
    const header = t(`weeklyPulse.sections.${sectionKey}`);
    if (items.length === 0) {
        return `${header}\n${t(`weeklyPulse.${emptyKey}`)}` + SECTION_SEPARATOR.slice(1);
    }
    const rows = items.map((item) => `- ${render(t, item)}`);
    return `${header}\n${rows.join('\n')}` + SECTION_SEPARATOR.slice(1);
}
function renderCitationLine(t: TranslateFn, entry: DigestCitationEntry): string {
    return t('weeklyPulse.citationLine', {
        host: entry.host,
        engine: entry.engine,
    });
}
function renderRankLine(t: TranslateFn, entry: DigestRankDrop): string {
    return t('weeklyPulse.rankLine', {
        keyword: entry.keyword,
        prior: entry.priorRank ?? '?',
        current: entry.currentRank ?? '?',
    });
}
function renderActionLine(t: TranslateFn, entry: LocalizedDigestActionEntry): string {
    return t('weeklyPulse.actionLine', {
        verb: entry.verb,
        target: entry.target,
    });
}
/** Signed whole number, e.g. `+3` / `-2` / `0`. */
function signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}
function renderBrandDeltaLine(t: TranslateFn, delta: DigestBrandDelta): string {
    if (!delta.hasNewScan) {
        return t('weeklyPulse.brandDeltas.noNewScan', {
            query: delta.brandQuerySafe,
        });
    }
    if (delta.newMentionCount === null || delta.sentimentShift === null) {
        return t('weeklyPulse.brandDeltas.firstScan', {
            query: delta.brandQuerySafe,
        });
    }
    const head = t('weeklyPulse.brandDeltas.queryLine', {
        query: delta.brandQuerySafe,
        delta: signed(delta.newMentionCount),
    });
    const tail = t('weeklyPulse.brandDeltas.sentimentLine', {
        positive: signed(delta.sentimentShift.positive),
        neutral: signed(delta.sentimentShift.neutral),
        negative: signed(delta.sentimentShift.negative),
        unknown: signed(delta.sentimentShift.unknown),
    });
    return `${head} ${tail}`;
}
function renderGscRow(t: TranslateFn, row: DigestGscRow): string {
    return t('weeklyPulse.gscRow', {
        appearance: row.rawAppearance,
        clicks: row.clicks,
        impressions: row.impressions,
    });
}
