/**
 * Public-page change monitoring — worker processor.
 *
 * A webhook receipt is also the notification outbox. Processing advances
 * through durable states:
 *
 *   received -> processing -> notification_pending -> processed
 *                           \-> processed (no material change)
 *
 * The immutable processing plan is committed before cross-store effects, so a
 * replay never re-decides materiality against a baseline that an earlier
 * attempt already advanced. A material receipt becomes `processed` only in the
 * same Mongo write that durably records a delivered/suppressed notification
 * outcome. Delivery uses a renewable claim and a stable provider idempotency
 * key; a crash after Resend accepts the email safely retries the same key.
 *
 * The processor never calls the content vendor. All
 * processor-written events carry `units: 0`; replay only repairs our own
 * evidence/baseline/outbox state.
 *
 * SEC-REDACT: crawled/diff text and notification targets never reach logs.
 */
import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import type { Logger } from 'pino';
import { isSupportedLocale } from '../../shared/i18n/index.js';
import { filterPausedSiteIds } from '../sites/sites.guard.js';
import { contentMonitorJobSchema, parseConsumedPayload, rankPeriodKey, type ContentMonitorJob, } from '../../shared/queue/index.js';
import { ContentMonitor, MonitorEvidence, MonitorWebhookReceipt, MONITOR_EVIDENCE_TTL_DAYS, isSafeMonitorSingleLineText, isSafeMonitorStoredText, type ContentMonitorHydrated, type MonitorWebhookReceiptHydrated, } from './monitor.model.js';
import { detectChange, type ChangeDecision } from './change-detector.js';
import { recordContentMonitorEvent } from './monitoring.events.js';
import { monitorNotificationRequestFingerprint, notifyMonitorMaterialChange, prepareMonitorMaterialChangeNotification, } from './monitoring.notifications.js';
import { cancelAndScrubMonitorReceipts, terminalSkipMonitorReceipt, } from './monitoring.receipts.js';
export const MONITOR_NOTIFICATION_LEASE_MS = 5 * 60 * 1000;
/** Hard cap across BullMQ attempts and reconciliation recovery cycles. */
export const MONITOR_NOTIFICATION_MAX_ATTEMPTS = 6;
/** Resend retains an idempotency key for 24h; close locally with 1h headroom. */
export const MONITOR_NOTIFICATION_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** One monitor baseline planner at a time; expired owners are helped, not stolen. */
export const MONITOR_PLANNING_LEASE_MS = 5 * 60 * 1000;
/** Durable pre-outbox retry budget, independent of BullMQ's immediate attempts. */
export const MONITOR_PROCESSING_MAX_ATTEMPTS = 6;
export const MONITOR_PROCESSING_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
type MaterialReason = Extract<ChangeDecision, {
    material: true;
}>['reason'];
export interface ContentMonitorProcessorDeps {
    db: ApplicationDb;
    logger: Logger;
    /** Test seam — literal default so tests never touch the clock. */
    now?: () => Date;
    evidenceTtlDays?: number;
    /** Test seam — inject the notifier so processor tests never send mail. */
    notify?: typeof notifyMonitorMaterialChange;
    /** Test seam for freezing the exact retry payload. */
    prepareNotification?: typeof prepareMonitorMaterialChangeNotification;
    /** Hostile crash-window seam: runs after the durable plan, before effects. */
    afterProcessingPlanPersisted?: () => Promise<void>;
    /** Planning race seam: runs with the planner held, before the immutable plan insert. */
    beforeProcessingPlanPersist?: () => Promise<void>;
    /** Deletion race seam: runs after monitor lookup, before baseline commit. */
    beforeBaselineCommit?: () => Promise<void>;
    /** Hostile crash-window seam: runs after transport, before outcome commit. */
    afterNotificationAttempted?: () => Promise<void>;
    /** Deletion-barrier seam: runs after payload validation, before the final activity check. */
    beforeNotificationActivityRecheck?: () => Promise<void>;
}
type ProcessingFailureReason = 'receipt-binding-invalid' | 'processing-plan-missing' | 'notification-payload-invalid' | 'processing-retries-exhausted' | 'processing-window-expired';
class PermanentMonitorProcessingError extends Error {
    constructor(readonly reason: ProcessingFailureReason, message: string) {
        super(message);
        this.name = 'PermanentMonitorProcessingError';
    }
}
class MonitorPlanningBusyError extends Error {
    constructor() {
        super('content-monitor baseline planner is busy');
        this.name = 'MonitorPlanningBusyError';
    }
}
interface ObservationCursor {
    occurredAt: Date;
    eventKey: string;
}
function compareCursor(left: ObservationCursor | null, right: ObservationCursor | null): number {
    if (!left)
        return right ? -1 : 0;
    if (!right)
        return 1;
    const byTime = left.occurredAt.getTime() - right.occurredAt.getTime();
    return byTime === 0 ? left.eventKey.localeCompare(right.eventKey) : byTime;
}
function monitorCursor(monitor: ContentMonitorHydrated): ObservationCursor | null {
    return monitor.baselineOccurredAt
        ? {
            occurredAt: monitor.baselineOccurredAt,
            eventKey: monitor.baselineEventKey ?? '',
        }
        : null;
}
function planNextCursor(receipt: MonitorWebhookReceiptHydrated): ObservationCursor | null {
    const plan = receipt.processingPlan;
    if (!plan?.nextCursorOccurredAt)
        return null;
    return {
        occurredAt: plan.nextCursorOccurredAt,
        eventKey: plan.nextCursorEventKey ?? '',
    };
}
function terminalProcessorError(): UnrecoverableError {
    return new UnrecoverableError('content-monitor durable terminal failure');
}
/** Stable, bounded, non-content-bearing key forwarded to the email provider. */
export function monitorNotificationIdempotencyKey(receiptId: string): string {
    return `content-monitor/${receiptId}`;
}
/**
 * Generic BullMQ exhaustion is not the content-monitor business boundary.
 * Archive only after Mongo says the receipt itself is durably terminal, so a
 * recoverable attempt-three failure can never leave a false permanent DLQ.
 */
export async function shouldDeadLetterContentMonitorJob(job: Job): Promise<boolean> {
    const parsed = contentMonitorJobSchema.safeParse(job.data);
    if (!parsed.success)
        return true;
    const receipt = await MonitorWebhookReceipt.findById(parsed.data.receiptId)
        .select('status notification.state')
        .lean();
    return Boolean(receipt &&
        (receipt.status === 'failed' ||
            (receipt.status === 'processed' && receipt.notification?.state === 'failed')));
}
/**
 * Closes an exhausted notification outbox. Without `leaseId`, only an
 * available pending/expired claim may be closed; with `leaseId`, the caller
 * must still own the sending lease. The receipt and terminal outcome land in
 * one Mongo write so reconciliation can never revive it afterward.
 */
export async function finalizeClosedMonitorNotification(receiptId: string, at: Date, leaseId?: string): Promise<'retries-exhausted' | 'retry-window-expired' | 'provider-outcome-unknown' | null> {
    const close = async (outcome: 'retries-exhausted' | 'retry-window-expired' | 'provider-outcome-unknown', boundary: Record<string, unknown>, availability: Record<string, unknown>): Promise<boolean> => {
        const result = await MonitorWebhookReceipt.updateOne({
            _id: receiptId,
            status: 'notification_pending',
            ...boundary,
            ...availability,
        }, {
            $set: {
                status: 'processed',
                processedAt: at,
                'notification.state': 'failed',
                'notification.leaseId': null,
                'notification.leaseUntil': null,
                'notification.completedAt': at,
                'notification.outcome': outcome,
                'notification.providerMessageId': null,
                'events.$[].diffText': null,
                'notification.lastFailure': outcome === 'provider-outcome-unknown'
                    ? 'provider-outcome-unknown'
                    : 'transport-failure',
            },
        }, { runValidators: true });
        return result.matchedCount === 1;
    };
    // An attempted legacy/malformed row without a frozen deadline cannot safely
    // reuse a Resend key: its 24-hour retention age is unknowable. Fail closed.
    const retryExpiredBoundary = {
        'notification.attemptCount': { $gt: 0 },
        $or: [
            { 'notification.retryUntil': { $lte: at } },
            { 'notification.retryUntil': null },
        ],
    };
    if (await close('retries-exhausted', {
        'notification.attemptCount': {
            $gte: MONITOR_NOTIFICATION_MAX_ATTEMPTS,
        },
    }, { 'notification.state': 'pending' })) {
        return 'retries-exhausted';
    }
    if (await close('retry-window-expired', retryExpiredBoundary, { 'notification.state': 'pending' })) {
        return 'retry-window-expired';
    }
    const ambiguousAvailability = leaseId
        ? {
            'notification.state': 'sending',
            'notification.leaseId': leaseId,
        }
        : {
            'notification.state': 'sending',
            'notification.leaseUntil': { $lte: at },
        };
    if (await close('provider-outcome-unknown', {
        $or: [
            {
                'notification.attemptCount': {
                    $gte: MONITOR_NOTIFICATION_MAX_ATTEMPTS,
                },
            },
            retryExpiredBoundary,
        ],
    }, ambiguousAvailability)) {
        return 'provider-outcome-unknown';
    }
    return null;
}
async function releasePlanningOwner(receiptId: string): Promise<void> {
    await ContentMonitor.updateOne({ planningReceiptId: receiptId }, { $set: { planningReceiptId: null, planningLeaseUntil: null } }, { runValidators: true });
}
async function terminalizeProcessingFailure(receipt: MonitorWebhookReceiptHydrated, reason: ProcessingFailureReason, at: Date): Promise<boolean> {
    const result = await MonitorWebhookReceipt.updateOne({
        _id: receipt._id,
        status: { $in: ['received', 'processing', 'notification_pending'] },
    }, {
        $set: {
            status: 'failed',
            failureReason: reason,
            processedAt: at,
            'events.$[].diffText': null,
        },
        $unset: { notification: 1 },
    }, { runValidators: true });
    await releasePlanningOwner(String(receipt._id));
    return result.matchedCount === 1;
}
async function beginProcessingAttempt(receipt: MonitorWebhookReceiptHydrated, at: Date): Promise<MonitorWebhookReceiptHydrated> {
    if (!receipt.processingFirstAttemptAt) {
        await MonitorWebhookReceipt.updateOne({
            _id: receipt._id,
            status: { $in: ['received', 'processing'] },
            processingAttemptCount: 0,
            processingFirstAttemptAt: null,
        }, {
            $set: {
                processingFirstAttemptAt: at,
                processingRetryUntil: new Date(at.getTime() + MONITOR_PROCESSING_RETRY_WINDOW_MS),
            },
        }, { runValidators: true });
    }
    const claimed = await MonitorWebhookReceipt.findOneAndUpdate({
        _id: receipt._id,
        status: { $in: ['received', 'processing'] },
        processingAttemptCount: { $lt: MONITOR_PROCESSING_MAX_ATTEMPTS },
        processingRetryUntil: { $gt: at },
    }, {
        $set: { processingLastAttemptAt: at },
        $inc: { processingAttemptCount: 1 },
    }, { new: true, runValidators: true });
    if (claimed)
        return claimed;
    const fresh = await MonitorWebhookReceipt.findById(receipt._id);
    if (!fresh || !['received', 'processing'].includes(fresh.status)) {
        throw terminalProcessorError();
    }
    const reason: ProcessingFailureReason = !fresh.processingRetryUntil || fresh.processingRetryUntil <= at
        ? 'processing-window-expired'
        : 'processing-retries-exhausted';
    await terminalizeProcessingFailure(fresh, reason, at);
    throw terminalProcessorError();
}
function assertFrozenNotificationPayload(prepared: {
    locale: string;
    recipientEmail: string | null;
    senderIdentity: string | null;
    subject: string;
    text: string;
    html: string;
}): void {
    if (!isSupportedLocale(prepared.locale) ||
        prepared.subject.length > 1000 ||
        prepared.text.length > 10000 ||
        prepared.html.length > 20000 ||
        !(prepared.html.startsWith(`<html lang="${prepared.locale}"`) ||
            prepared.html.startsWith(`<!doctype html>\n<html lang="${prepared.locale}"`)) ||
        !isSafeMonitorSingleLineText(prepared.subject) ||
        !isSafeMonitorStoredText(prepared.text) ||
        !isSafeMonitorSingleLineText(prepared.recipientEmail) ||
        !isSafeMonitorSingleLineText(prepared.senderIdentity)) {
        throw new PermanentMonitorProcessingError('notification-payload-invalid', 'content-monitor frozen notification payload is invalid');
    }
}
function assertReceiptBindings(receipt: MonitorWebhookReceiptHydrated, monitor: ContentMonitorHydrated): void {
    if (String(receipt.accountId) !== String(monitor.accountId) ||
        String(receipt.siteId) !== String(monitor.siteId) ||
        String(receipt.monitorId) !== String(monitor._id) ||
        receipt.providerMonitorRef !== monitor.providerMonitorRef) {
        throw new PermanentMonitorProcessingError('receipt-binding-invalid', 'content-monitor receipt ownership binding is invalid');
    }
    let normalizedTarget: string;
    try {
        normalizedTarget = new URL(monitor.targetUrl).toString();
    }
    catch {
        throw new PermanentMonitorProcessingError('receipt-binding-invalid', 'content-monitor target binding is invalid');
    }
    for (const event of receipt.events) {
        let normalizedEventTarget: string;
        try {
            normalizedEventTarget = new URL(event.targetUrl).toString();
        }
        catch {
            throw new PermanentMonitorProcessingError('receipt-binding-invalid', 'content-monitor event target binding is invalid');
        }
        if (event.checkId !== receipt.checkId ||
            normalizedEventTarget !== normalizedTarget) {
            throw new PermanentMonitorProcessingError('receipt-binding-invalid', 'content-monitor event binding is invalid');
        }
    }
}
async function commitProcessingPlanBaseline(receipt: MonitorWebhookReceiptHydrated, at: Date): Promise<'committed' | 'monitor-missing'> {
    const plan = receipt.processingPlan;
    if (!plan) {
        throw new PermanentMonitorProcessingError('processing-plan-missing', 'content-monitor receipt processing plan is missing');
    }
    if (plan.baselineCommittedAt)
        return 'committed';
    const result = await ContentMonitor.updateOne({
        _id: receipt.monitorId,
        accountId: receipt.accountId,
        siteId: receipt.siteId,
        providerMonitorRef: receipt.providerMonitorRef,
        deletionStartedAt: null,
        planningReceiptId: receipt._id,
    }, {
        $set: {
            normalizedHash: plan.nextNormalizedHash ?? null,
            baselineStatus: plan.nextBaselineStatus ?? null,
            baselineOccurredAt: plan.nextCursorOccurredAt ?? null,
            baselineEventKey: plan.nextCursorEventKey ?? null,
            planningLeaseUntil: new Date(at.getTime() + MONITOR_PLANNING_LEASE_MS),
        },
        $max: {
            lastCheckAt: plan.plannedAt,
            ...(plan.materialEvents.length > 0
                ? { lastMaterialChangeAt: plan.plannedAt }
                : {}),
        },
    }, { runValidators: true });
    if (result.matchedCount !== 1) {
        const monitor = await ContentMonitor.findOne({
            _id: receipt.monitorId,
            accountId: receipt.accountId,
            siteId: receipt.siteId,
            providerMonitorRef: receipt.providerMonitorRef,
            deletionStartedAt: null,
        });
        if (!monitor)
            return 'monitor-missing';
        if (compareCursor(monitorCursor(monitor), planNextCursor(receipt)) < 0) {
            throw new Error('content-monitor baseline ownership was lost before commit');
        }
        if (String(monitor.planningReceiptId) !== String(receipt._id)) {
            throw new Error('content-monitor baseline ownership changed before commit');
        }
        await ContentMonitor.updateOne({ _id: monitor._id, planningReceiptId: receipt._id }, {
            $set: {
                planningLeaseUntil: new Date(at.getTime() + MONITOR_PLANNING_LEASE_MS),
            },
        }, { runValidators: true });
    }
    await MonitorWebhookReceipt.updateOne({ _id: receipt._id, status: 'processing' }, { $set: { 'processingPlan.baselineCommittedAt': at } }, { runValidators: true });
    return 'committed';
}
async function repairLegacyProcessingPlan(receipt: MonitorWebhookReceiptHydrated): Promise<MonitorWebhookReceiptHydrated> {
    const plan = receipt.processingPlan;
    if (!plan)
        return receipt;
    if (plan.nextCursorOccurredAt || receipt.events.length === 0)
        return receipt;
    const sorted = [...receipt.events].sort((left, right) => compareCursor({ occurredAt: left.occurredAt, eventKey: left.eventKey }, { occurredAt: right.occurredAt, eventKey: right.eventKey }));
    const last = sorted.at(-1)!;
    const lastNonError = [...sorted].reverse().find((event) => event.status !== 'error');
    const updated = await MonitorWebhookReceipt.findOneAndUpdate({ _id: receipt._id, status: 'processing' }, {
        $set: {
            'processingPlan.acceptedEventKeys': sorted.map((event) => event.eventKey),
            'processingPlan.nextCursorOccurredAt': last.occurredAt,
            'processingPlan.nextCursorEventKey': last.eventKey,
            'processingPlan.nextBaselineStatus': lastNonError?.status ?? null,
        },
    }, { new: true, runValidators: true });
    return updated ?? receipt;
}
async function helpExpiredPlanningOwner(monitor: ContentMonitorHydrated, at: Date): Promise<void> {
    if (!monitor.planningReceiptId || (monitor.planningLeaseUntil ?? at) > at) {
        return;
    }
    let owner = await MonitorWebhookReceipt.findById(monitor.planningReceiptId);
    if (owner?.status === 'processing' && owner.processingPlan) {
        owner = await repairLegacyProcessingPlan(owner);
        await commitProcessingPlanBaseline(owner, at);
        return;
    }
    await ContentMonitor.updateOne({
        _id: monitor._id,
        planningReceiptId: monitor.planningReceiptId,
        $or: [
            { planningLeaseUntil: null },
            { planningLeaseUntil: { $lte: at } },
        ],
    }, { $set: { planningReceiptId: null, planningLeaseUntil: null } }, { runValidators: true });
}
async function acquirePlanningMonitor(receipt: MonitorWebhookReceiptHydrated, at: Date): Promise<ContentMonitorHydrated | null> {
    for (let pass = 0; pass < 2; pass += 1) {
        const claimed = await ContentMonitor.findOneAndUpdate({
            _id: receipt.monitorId,
            accountId: receipt.accountId,
            siteId: receipt.siteId,
            providerMonitorRef: receipt.providerMonitorRef,
            deletionStartedAt: null,
            $or: [
                { planningReceiptId: null },
                { planningReceiptId: receipt._id },
            ],
        }, {
            $set: {
                planningReceiptId: receipt._id,
                planningLeaseUntil: new Date(at.getTime() + MONITOR_PLANNING_LEASE_MS),
            },
        }, { new: true, runValidators: true });
        if (claimed)
            return claimed;
        const existing = await ContentMonitor.findOne({
            _id: receipt.monitorId,
            accountId: receipt.accountId,
            siteId: receipt.siteId,
            providerMonitorRef: receipt.providerMonitorRef,
            deletionStartedAt: null,
        });
        if (!existing)
            return null;
        await helpExpiredPlanningOwner(existing, at);
    }
    throw new MonitorPlanningBusyError();
}
async function persistProcessingPlan(receipt: MonitorWebhookReceiptHydrated, monitor: ContentMonitorHydrated, at: Date, prepareNotification: typeof prepareMonitorMaterialChangeNotification): Promise<{
    receipt: MonitorWebhookReceiptHydrated;
    claimed: boolean;
}> {
    assertReceiptBindings(receipt, monitor);
    let nextNormalizedHash = monitor.normalizedHash ?? null;
    let nextBaselineStatus = monitor.baselineStatus ?? null;
    let nextCursor = monitorCursor(monitor);
    const acceptedEventKeys: string[] = [];
    const materialEvents: Array<{
        eventKey: string;
        reason: MaterialReason;
    }> = [];
    const sorted = [...receipt.events].sort((left, right) => compareCursor({ occurredAt: left.occurredAt, eventKey: left.eventKey }, { occurredAt: right.occurredAt, eventKey: right.eventKey }));
    for (const event of sorted) {
        const cursor = { occurredAt: event.occurredAt, eventKey: event.eventKey };
        if (compareCursor(cursor, nextCursor) <= 0)
            continue;
        const decision = detectChange({ normalizedHash: nextNormalizedHash, status: nextBaselineStatus }, {
            status: event.status,
            contentHash: event.contentHash ?? null,
            diffText: event.diffText ?? null,
        });
        acceptedEventKeys.push(event.eventKey);
        nextCursor = cursor;
        nextNormalizedHash = decision.normalizedHash;
        nextBaselineStatus = decision.normalizedStatus;
        if (decision.material) {
            materialEvents.push({ eventKey: event.eventKey, reason: decision.reason });
        }
    }
    const prepared = materialEvents.length > 0
        ? await prepareNotification({
            ownerUserId: String(monitor.ownerUserId),
            siteId: String(monitor.siteId),
            targetUrl: monitor.targetUrl,
            locale: monitor.locale,
        })
        : null;
    if (prepared)
        assertFrozenNotificationPayload(prepared);
    const notificationIdempotencyKey = monitorNotificationIdempotencyKey(String(receipt._id));
    const requestFingerprint = prepared
        ? monitorNotificationRequestFingerprint({
            locale: prepared.locale,
            recipientEmail: prepared.recipientEmail,
            senderIdentity: prepared.senderIdentity,
            subject: prepared.subject,
            text: prepared.text,
            html: prepared.html,
            idempotencyKey: notificationIdempotencyKey,
        })
        : null;
    const previousCursor = monitorCursor(monitor);
    const planned = await MonitorWebhookReceipt.findOneAndUpdate({
        _id: receipt._id,
        accountId: receipt.accountId,
        siteId: receipt.siteId,
        monitorId: receipt.monitorId,
        status: 'received',
        processingPlan: null,
    }, {
        $set: {
            status: 'processing',
            processingPlan: {
                plannedAt: at,
                isoWeek: rankPeriodKey('weekly', at),
                previousNormalizedHash: monitor.normalizedHash ?? null,
                previousBaselineStatus: monitor.baselineStatus ?? null,
                previousCursorOccurredAt: previousCursor?.occurredAt ?? null,
                previousCursorEventKey: previousCursor?.eventKey ?? null,
                nextNormalizedHash,
                nextBaselineStatus,
                nextCursorOccurredAt: nextCursor?.occurredAt ?? null,
                nextCursorEventKey: nextCursor?.eventKey ?? null,
                acceptedEventKeys,
                materialEvents,
                baselineCommittedAt: null,
            },
            notification: materialEvents.length > 0
                ? {
                    state: 'waiting',
                    ownerUserId: monitor.ownerUserId,
                    recipientEmail: prepared!.recipientEmail,
                    senderIdentity: prepared!.senderIdentity,
                    suppressionReason: prepared!.suppressionReason,
                    targetUrl: monitor.targetUrl,
                    locale: prepared!.locale,
                    subject: prepared!.subject,
                    text: prepared!.text,
                    html: prepared!.html,
                    idempotencyKey: notificationIdempotencyKey,
                    requestFingerprint: requestFingerprint!,
                    leaseId: null,
                    leaseUntil: null,
                    attemptCount: 0,
                    firstAttemptAt: null,
                    retryUntil: null,
                    lastAttemptAt: null,
                    completedAt: null,
                    outcome: null,
                    providerMessageId: null,
                    lastFailure: null,
                }
                : null,
        },
    }, { new: true, runValidators: true });
    if (planned)
        return { receipt: planned, claimed: true };
    const concurrent = await MonitorWebhookReceipt.findById(receipt._id);
    if (!concurrent)
        throw new Error('content-monitor receipt disappeared while planning');
    return { receipt: concurrent, claimed: false };
}
async function applyProcessingPlan(deps: ContentMonitorProcessorDeps, receiptInput: MonitorWebhookReceiptHydrated, evidenceTtlDays: number, at: Date): Promise<MonitorWebhookReceiptHydrated | null> {
    let receipt = await repairLegacyProcessingPlan(receiptInput);
    const plan = receipt.processingPlan;
    if (!plan) {
        throw new PermanentMonitorProcessingError('processing-plan-missing', 'content-monitor receipt processing plan is missing');
    }
    const monitor = await ContentMonitor.findOne({
        _id: receipt.monitorId,
        accountId: receipt.accountId,
        siteId: receipt.siteId,
        providerMonitorRef: receipt.providerMonitorRef,
        deletionStartedAt: null,
    });
    if (!monitor) {
        await terminalSkipMonitorReceipt(String(receipt._id), at);
        await releasePlanningOwner(String(receipt._id));
        deps.logger.info({ receiptId: String(receipt._id), monitorId: String(receipt.monitorId) }, 'content-monitor processor: planned receipt lost its monitor; receipt skipped');
        return null;
    }
    assertReceiptBindings(receipt, monitor);
    await deps.beforeBaselineCommit?.();
    if ((await commitProcessingPlanBaseline(receipt, at)) === 'monitor-missing') {
        await terminalSkipMonitorReceipt(String(receipt._id), at);
        return null;
    }
    receipt = (await MonitorWebhookReceipt.findById(receipt._id)) ?? receipt;
    await recordContentMonitorEvent(deps.db, {
        accountId: String(receipt.accountId),
        siteId: String(receipt.siteId),
        monitorId: String(receipt.monitorId),
        checkId: receipt.checkId,
        eventKey: receipt.checkId,
        kind: 'check_completed',
        isoWeek: plan.isoWeek,
        units: 0,
    });
    const plannedByEvent = new Map(plan.materialEvents.map((event) => [event.eventKey, event.reason] as const));
    for (const event of receipt.events) {
        const reason = plannedByEvent.get(event.eventKey);
        if (!reason)
            continue;
        await recordContentMonitorEvent(deps.db, {
            accountId: String(receipt.accountId),
            siteId: String(receipt.siteId),
            monitorId: String(receipt.monitorId),
            checkId: event.checkId,
            eventKey: event.eventKey,
            kind: 'change_detected',
            isoWeek: plan.isoWeek,
            units: 0,
        });
        await MonitorEvidence.updateOne({ monitorId: receipt.monitorId, eventKey: event.eventKey }, {
            $set: {
                accountId: receipt.accountId,
                checkId: event.checkId,
                sourceUrl: event.targetUrl,
                reason,
                diffText: event.diffText ?? null,
                observedAt: plan.plannedAt,
                expiryAt: new Date(plan.plannedAt.getTime() + evidenceTtlDays * 24 * 60 * 60 * 1000),
            },
        }, { upsert: true, runValidators: true });
    }
    await MonitorWebhookReceipt.updateOne({ _id: receipt._id, status: 'processing' }, plan.materialEvents.length > 0
        ? {
            $set: {
                status: 'notification_pending',
                'notification.state': 'pending',
                'events.$[].diffText': null,
            },
        }
        : {
            $set: {
                status: 'processed',
                processedAt: plan.plannedAt,
                'events.$[].diffText': null,
            },
        }, { runValidators: true });
    await releasePlanningOwner(String(receipt._id));
    return MonitorWebhookReceipt.findById(receipt._id);
}
async function releaseNotificationClaim(receiptId: string, leaseId: string): Promise<void> {
    await MonitorWebhookReceipt.updateOne({
        _id: receiptId,
        status: 'notification_pending',
        'notification.state': 'sending',
        'notification.leaseId': leaseId,
    }, {
        $set: {
            'notification.state': 'pending',
            'notification.leaseId': null,
            'notification.leaseUntil': null,
            'notification.lastFailure': 'transport-failure',
        },
    }, { runValidators: true });
}
async function terminalizeMalformedNotification(receipt: MonitorWebhookReceiptHydrated, at: Date): Promise<void> {
    await MonitorWebhookReceipt.updateOne({ _id: receipt._id, status: 'notification_pending' }, {
        $set: {
            status: 'failed',
            failureReason: 'notification-payload-invalid',
            processedAt: at,
            'events.$[].diffText': null,
        },
        $unset: { notification: 1 },
    }, { runValidators: true });
}
async function deliverPendingNotification(deps: ContentMonitorProcessorDeps, receipt: MonitorWebhookReceiptHydrated, notify: typeof notifyMonitorMaterialChange, now: () => Date): Promise<void> {
    const claimAt = now();
    if (!receipt.notification) {
        await terminalizeMalformedNotification(receipt, claimAt);
        throw terminalProcessorError();
    }
    const activeMonitor = await ContentMonitor.exists({
        _id: receipt.monitorId,
        accountId: receipt.accountId,
        siteId: receipt.siteId,
        providerMonitorRef: receipt.providerMonitorRef,
        deletionStartedAt: null,
    });
    if (!activeMonitor) {
        await cancelAndScrubMonitorReceipts(String(receipt.monitorId), claimAt);
        return;
    }
    const preClaimClosure = await finalizeClosedMonitorNotification(String(receipt._id), claimAt);
    if (preClaimClosure) {
        deps.logger.warn({ receiptId: String(receipt._id), notificationOutcome: preClaimClosure }, 'content-monitor processor: notification retry boundary closed');
        throw terminalProcessorError();
    }
    if (!receipt.notification?.firstAttemptAt) {
        await MonitorWebhookReceipt.updateOne({
            _id: receipt._id,
            status: 'notification_pending',
            'notification.attemptCount': 0,
            'notification.firstAttemptAt': null,
        }, {
            $set: {
                'notification.firstAttemptAt': claimAt,
                'notification.retryUntil': new Date(claimAt.getTime() + MONITOR_NOTIFICATION_RETRY_WINDOW_MS),
            },
        }, { runValidators: true });
    }
    const leaseId = randomUUID();
    const claimed = await MonitorWebhookReceipt.findOneAndUpdate({
        _id: receipt._id,
        accountId: receipt.accountId,
        status: 'notification_pending',
        'notification.attemptCount': { $lt: MONITOR_NOTIFICATION_MAX_ATTEMPTS },
        'notification.retryUntil': { $gt: claimAt },
        $or: [
            { 'notification.state': 'pending' },
            {
                'notification.state': 'sending',
                'notification.leaseUntil': { $lte: claimAt },
            },
        ],
    }, {
        $set: {
            'notification.state': 'sending',
            'notification.leaseId': leaseId,
            'notification.leaseUntil': new Date(claimAt.getTime() + MONITOR_NOTIFICATION_LEASE_MS),
            'notification.lastAttemptAt': claimAt,
            'notification.lastFailure': null,
        },
        $inc: { 'notification.attemptCount': 1 },
    }, { new: true, runValidators: true });
    if (!claimed) {
        deps.logger.info({ receiptId: String(receipt._id) }, 'content-monitor processor: notification already claimed or terminal');
        return;
    }
    const notification = claimed.notification;
    if (!notification ||
        !notification.targetUrl ||
        !notification.subject ||
        !notification.text ||
        !notification.html ||
        !notification.requestFingerprint ||
        !isSupportedLocale(notification.locale) ||
        !isSafeMonitorSingleLineText(notification.targetUrl) ||
        !isSafeMonitorSingleLineText(notification.subject) ||
        !isSafeMonitorStoredText(notification.text)) {
        await terminalizeMalformedNotification(claimed, claimAt);
        throw terminalProcessorError();
    }
    await deps.beforeNotificationActivityRecheck?.();
    // Explicit deletion marks the monitor before it scrubs receipt tombstones.
    // Re-check after the receipt claim so no replay can begin a new request once
    // that marker is visible. A previously-started ambiguous request remains an
    // honest unknown outcome in the cancellation helper.
    const stillActive = await ContentMonitor.exists({
        _id: claimed.monitorId,
        accountId: claimed.accountId,
        siteId: claimed.siteId,
        providerMonitorRef: claimed.providerMonitorRef,
        deletionStartedAt: null,
    });
    if (!stillActive) {
        await cancelAndScrubMonitorReceipts(String(claimed.monitorId), now());
        return;
    }
    let outcome: Awaited<ReturnType<typeof notifyMonitorMaterialChange>>;
    try {
        outcome = await notify({
            ownerUserId: String(notification.ownerUserId),
            recipientEmail: notification.recipientEmail ?? null,
            senderIdentity: notification.senderIdentity ?? null,
            suppressionReason: notification.suppressionReason ?? null,
            subject: notification.subject,
            text: notification.text,
            html: notification.html,
            locale: notification.locale,
            idempotencyKey: notification.idempotencyKey,
            requestFingerprint: notification.requestFingerprint,
        });
    }
    catch {
        const closedNotification = await finalizeClosedMonitorNotification(String(claimed._id), now(), leaseId);
        if (closedNotification) {
            deps.logger.warn({
                receiptId: String(claimed._id),
                notificationOutcome: closedNotification,
            }, 'content-monitor processor: notification retry boundary closed');
            throw terminalProcessorError();
        }
        await releaseNotificationClaim(String(claimed._id), leaseId);
        throw new Error('content-monitor notification transport threw');
    }
    // Deliberately outside the transport catch: a hostile test crash here leaves
    // the sending lease intact, exactly like process death after provider accept.
    await deps.afterNotificationAttempted?.();
    const terminalAt = now();
    if (!outcome.delivered && outcome.outcomeUnknown) {
        // No authoritative provider response was observed. Keep the sending claim
        // intact while evaluating the terminal boundary so the final record says
        // provider-outcome-unknown, not the stronger (and potentially false)
        // retries-exhausted claim. Before the boundary, release for an idempotent
        // replay of the exact frozen request.
        const closedNotification = await finalizeClosedMonitorNotification(String(claimed._id), terminalAt, leaseId);
        if (closedNotification) {
            deps.logger.warn({
                receiptId: String(claimed._id),
                notificationOutcome: closedNotification,
            }, 'content-monitor processor: ambiguous notification boundary closed');
            throw terminalProcessorError();
        }
        await releaseNotificationClaim(String(claimed._id), leaseId);
        throw new Error('content-monitor notification provider outcome is unknown');
    }
    if (outcome.delivered) {
        const settled = await MonitorWebhookReceipt.updateOne({
            _id: claimed._id,
            status: 'notification_pending',
            'notification.state': 'sending',
            'notification.leaseId': leaseId,
        }, {
            $set: {
                status: 'processed',
                processedAt: terminalAt,
                'notification.state': 'delivered',
                'notification.leaseId': null,
                'notification.leaseUntil': null,
                'notification.completedAt': terminalAt,
                'notification.outcome': 'delivered',
                'notification.providerMessageId': outcome.providerMessageId ?? null,
                'notification.lastFailure': null,
                'events.$[].diffText': null,
            },
        }, { runValidators: true });
        if (settled.matchedCount !== 1)
            return;
        deps.logger.info({ monitorId: String(claimed.monitorId), receiptId: String(claimed._id) }, 'content-monitor processor: material change notification delivered');
        return;
    }
    if (outcome.reason === 'opted-out' || outcome.reason === 'no-recipient') {
        const settled = await MonitorWebhookReceipt.updateOne({
            _id: claimed._id,
            status: 'notification_pending',
            'notification.state': 'sending',
            'notification.leaseId': leaseId,
        }, {
            $set: {
                status: 'processed',
                processedAt: terminalAt,
                'notification.state': 'suppressed',
                'notification.leaseId': null,
                'notification.leaseUntil': null,
                'notification.completedAt': terminalAt,
                'notification.outcome': outcome.reason,
                'notification.providerMessageId': null,
                'notification.lastFailure': null,
                'events.$[].diffText': null,
            },
        }, { runValidators: true });
        if (settled.matchedCount !== 1)
            return;
        deps.logger.info({
            monitorId: String(claimed.monitorId),
            receiptId: String(claimed._id),
            notificationOutcome: outcome.reason,
        }, 'content-monitor processor: material change notification suppressed');
        return;
    }
    // A returned `delivered:false` is a known failed response. Release the
    // sending lease before terminal-boundary evaluation so it is not mislabeled
    // as the ambiguous crash-after-provider-acceptance window.
    await releaseNotificationClaim(String(claimed._id), leaseId);
    const closedNotification = await finalizeClosedMonitorNotification(String(claimed._id), terminalAt);
    if (closedNotification) {
        deps.logger.warn({
            receiptId: String(claimed._id),
            notificationOutcome: closedNotification,
        }, 'content-monitor processor: notification retry boundary closed');
        throw terminalProcessorError();
    }
    throw new Error('content-monitor notification transport failure');
}
export function createContentMonitorProcessor(deps: ContentMonitorProcessorDeps): Processor<ContentMonitorJob, void> {
    const now = deps.now ?? (() => new Date());
    const evidenceTtlDays = deps.evidenceTtlDays ?? MONITOR_EVIDENCE_TTL_DAYS;
    const notify = deps.notify ?? notifyMonitorMaterialChange;
    const prepareNotification = deps.prepareNotification ?? prepareMonitorMaterialChangeNotification;
    return async (job: Job<ContentMonitorJob>) => {
        const payload = parseConsumedPayload(contentMonitorJobSchema, job.data);
        let receipt = await MonitorWebhookReceipt.findById(payload.receiptId);
        if (!receipt) {
            deps.logger.warn({ receiptId: payload.receiptId, accountId: payload.accountId }, 'content-monitor processor: receipt not found; dropping job');
            return;
        }
        if (receipt.status === 'processed' ||
            receipt.status === 'skipped' ||
            receipt.status === 'failed') {
            deps.logger.info({ receiptId: payload.receiptId, status: receipt.status }, 'content-monitor processor: receipt already terminal; no-op');
            return;
        }
        const payloadMatchesReceipt = String(receipt.accountId) === payload.accountId &&
            String(receipt.siteId) === payload.siteId &&
            String(receipt.monitorId) === payload.monitorId;
        if (!payloadMatchesReceipt) {
            await terminalizeProcessingFailure(receipt, 'receipt-binding-invalid', now());
            throw terminalProcessorError();
        }
        if (receipt.status === 'received' || receipt.status === 'processing') {
            const attemptAt = now();
            receipt = await beginProcessingAttempt(receipt, attemptAt);
            try {
                if (receipt.status === 'received') {
                    const monitor = await acquirePlanningMonitor(receipt, attemptAt);
                    if (!monitor) {
                        await terminalSkipMonitorReceipt(String(receipt._id), attemptAt);
                        deps.logger.info({ receiptId: payload.receiptId, monitorId: payload.monitorId }, 'content-monitor processor: monitor missing or deleting; receipt skipped');
                        return;
                    }
                    assertReceiptBindings(receipt, monitor);
                    // A page paused before the receipt acquired its immutable processing
                    // plan may be dropped. Once planned, accepted evidence still drains.
                    const pausedSites = await filterPausedSiteIds([String(monitor.siteId)]);
                    if (pausedSites.size > 0) {
                        await terminalSkipMonitorReceipt(String(receipt._id), attemptAt);
                        await releasePlanningOwner(String(receipt._id));
                        deps.logger.info({ receiptId: payload.receiptId, monitorId: payload.monitorId }, 'content-monitor processor: site paused before planning; receipt skipped');
                        return;
                    }
                    await deps.beforeProcessingPlanPersist?.();
                    const planned = await persistProcessingPlan(receipt, monitor, attemptAt, prepareNotification);
                    receipt = planned.receipt;
                    if (planned.claimed)
                        await deps.afterProcessingPlanPersisted?.();
                }
                if (receipt.status === 'processing') {
                    if (!receipt.processingPlan) {
                        throw new PermanentMonitorProcessingError('processing-plan-missing', 'content-monitor receipt processing plan is missing');
                    }
                    if (!receipt.processingPlan.baselineCommittedAt) {
                        const planningMonitor = await acquirePlanningMonitor(receipt, attemptAt);
                        if (!planningMonitor) {
                            await terminalSkipMonitorReceipt(String(receipt._id), attemptAt);
                            return;
                        }
                        assertReceiptBindings(receipt, planningMonitor);
                    }
                    const applied = await applyProcessingPlan(deps, receipt, evidenceTtlDays, attemptAt);
                    if (!applied)
                        return;
                    receipt = applied;
                }
            }
            catch (error) {
                const fresh = await MonitorWebhookReceipt.findById(receipt._id);
                if (!fresh || !['received', 'processing'].includes(fresh.status)) {
                    throw error;
                }
                if (error instanceof PermanentMonitorProcessingError) {
                    await terminalizeProcessingFailure(fresh, error.reason, now());
                    throw terminalProcessorError();
                }
                const boundaryAt = now();
                if (fresh.processingAttemptCount >= MONITOR_PROCESSING_MAX_ATTEMPTS ||
                    !fresh.processingRetryUntil ||
                    fresh.processingRetryUntil <= boundaryAt) {
                    await terminalizeProcessingFailure(fresh, !fresh.processingRetryUntil || fresh.processingRetryUntil <= boundaryAt
                        ? 'processing-window-expired'
                        : 'processing-retries-exhausted', boundaryAt);
                    throw terminalProcessorError();
                }
                throw error;
            }
        }
        if (receipt.status === 'notification_pending') {
            await deliverPendingNotification(deps, receipt, notify, now);
            return;
        }
        deps.logger.info({ monitorId: payload.monitorId, receiptId: payload.receiptId, material: false }, 'content-monitor processor: no material change');
    };
}
/** Exposed for the reconciliation stuck-receipt sweep + tests. */
export type MonitorForProcessing = ContentMonitorHydrated;
/** Narrow deterministic seams for cursor, plan, and durable-race tests. */
export const monitoringProcessorTestables = Object.freeze({
    compareCursor,
    monitorCursor,
    planNextCursor,
    assertFrozenNotificationPayload,
    assertReceiptBindings,
    beginProcessingAttempt,
    commitProcessingPlanBaseline,
    repairLegacyProcessingPlan,
    helpExpiredPlanningOwner,
    acquirePlanningMonitor,
    persistProcessingPlan,
    applyProcessingPlan,
    terminalizeMalformedNotification,
});
