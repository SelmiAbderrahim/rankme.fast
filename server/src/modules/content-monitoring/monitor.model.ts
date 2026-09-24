/**
 * Public-page change monitoring — Mongo documents.
 *
 * Three collections:
 *   - `ContentMonitor` — one monitored public page (owned or confirmed
 *     competitor) + its lifecycle state. The vendor monitor id is a capability
 *     token against Firecrawl, so it is envelope-encrypted at rest
 *     (`providerMonitorIdEncrypted`, AES-256-GCM via `shared/crypto`) and the
 *     plaintext is NEVER persisted. A NON-secret `providerMonitorRef =
 *     sha256(providerId)` is stored alongside so an inbound webhook delivery can
 *     be correlated to a monitor WITHOUT decrypting the token.
 *   - `MonitorWebhookReceipt` — atomic `(provider, eventId)` dedupe row on a
 *     30-day TTL (the documented replay window). Stores the bounded normalized
 *     events + a payload hash + a crash-replay processing plan and embedded
 *     notification outbox — never the raw body, never a signature.
 *   - `MonitorEvidence` — sanitized, length-capped diff fragments on a 7-day TTL
 *     (mirrors the content-snapshot pattern). Never raw HTML, never page prose.
 *
 * Every derived text field is checked for raw-HTML markers in a pre-validate
 * hook (SEC-OUT / no-raw-HTML) so a downstream regression cannot land a
 * `<script>`/`<iframe>` in workflow state.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { CONTENT_MONITOR_CADENCES, CONTENT_MONITOR_DIFF_MAX_CHARS, PAGE_CHANGE_STATUSES, } from '../../shared/providers/index.js';
/** Local monitor lifecycle status (superset of the provider status). */
export const CONTENT_MONITOR_STATUSES = [
    'active',
    'paused',
    'error',
] as const;
export type ContentMonitorStatus = (typeof CONTENT_MONITOR_STATUSES)[number];
/** A monitor targets an owned page or a confirmed-competitor page — nothing else. */
export const CONTENT_MONITOR_TARGET_KINDS = ['owned', 'competitor'] as const;
export type ContentMonitorTargetKind = (typeof CONTENT_MONITOR_TARGET_KINDS)[number];
export const CONTENT_MONITOR_ERROR_CATEGORIES = [
    'provider_unavailable',
    'reconcile_failed',
    'unexpected',
] as const;
export type ContentMonitorErrorCategory = (typeof CONTENT_MONITOR_ERROR_CATEGORIES)[number];
/**
 * Stored monitor text is rendered in several downstream surfaces. Reject any
 * tag-like markup and ASCII control characters at the field level so both
 * document saves and query updates (`runValidators: true`) enforce the same
 * boundary. Newlines are allowed only in the plain-text email body; subjects
 * and URL-like fields reject them as header/URL injection.
 */
const HTML_MARKER_PATTERN = /(?:<\s*\/?\s*[a-z][^>]*>|<![^>]*>|<\?[^>]*>)/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function isSafeMonitorStoredText(value: unknown): boolean {
    return (value === null ||
        value === undefined ||
        (typeof value === 'string' &&
            !HTML_MARKER_PATTERN.test(value) &&
            !CONTROL_CHARACTER_PATTERN.test(value)));
}
export function isSafeMonitorSingleLineText(value: unknown): boolean {
    return isSafeMonitorStoredText(value) &&
        (typeof value !== 'string' ||
            (!value.includes('\t') && !value.includes('\n') && !value.includes('\r')));
}
const safeStoredTextValidator = {
    validator: isSafeMonitorStoredText,
    message: 'stored monitor text must not contain raw HTML markup or control characters',
};
const safeSingleLineTextValidator = {
    validator: isSafeMonitorSingleLineText,
    message: 'stored monitor single-line text must not contain raw HTML markup or control characters',
};
const encryptedSecretSchema = new mongoose.Schema({
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true },
    aadBound: { type: Boolean, required: false },
}, { _id: false });
const errorInfoSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: CONTENT_MONITOR_ERROR_CATEGORIES,
        required: true,
    },
    messageKey: { type: String, required: true },
}, { _id: false });
const contentMonitorSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    ownerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true,
    },
    /** Normalized, already-SSRF-checked public URL. */
    targetUrl: {
        type: String,
        required: true,
        validate: safeSingleLineTextValidator,
    },
    targetKind: {
        type: String,
        enum: CONTENT_MONITOR_TARGET_KINDS,
        required: true,
    },
    cadence: {
        type: String,
        enum: CONTENT_MONITOR_CADENCES,
        default: 'weekly',
        required: true,
    },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    status: {
        type: String,
        enum: CONTENT_MONITOR_STATUSES,
        default: 'active',
        required: true,
    },
    // Who paused the monitor: 'site' = site-level pause cascade (auto-resumes
    // when the site resumes); 'user' / null = explicit user action (never
    // auto-resumed by a site resume).
    pausedBy: {
        type: String,
        enum: ['user', 'site'],
        default: null,
    },
    /** Envelope-encrypted vendor monitor id — plaintext never persisted. */
    providerMonitorIdEncrypted: { type: encryptedSecretSchema, required: true },
    /** sha256(providerMonitorId) — non-secret webhook correlation key. */
    providerMonitorRef: { type: String, required: true, index: true },
    /**
     * Domain-separated hash of the API key that owns the vendor resource.
     * Internal-only; null/absent means a legacy resource owned by the primary.
     */
    providerCredentialRef: { type: String, default: null },
    /** Last MATERIAL normalized fingerprint (fed to the change detector). */
    normalizedHash: { type: String, default: null },
    /** Last accepted provider observation status (used to suppress duplicate removals). */
    baselineStatus: {
        type: String,
        enum: PAGE_CHANGE_STATUSES,
        default: null,
    },
    /** Monotonic receipt/event cursor. Equal timestamps are ordered by event key. */
    baselineOccurredAt: { type: Date, default: null },
    baselineEventKey: { type: String, default: null },
    /**
     * One receipt may plan this monitor at a time. Deliberately no Mongoose
     * `ref`: the site/account deletion graph must not gain a circular edge.
     */
    planningReceiptId: { type: mongoose.Schema.Types.ObjectId, default: null },
    planningLeaseUntil: { type: Date, default: null },
    /** Set before remote teardown; all webhook/processor paths fail closed. */
    deletionStartedAt: { type: Date, default: null, index: true },
    lastCheckAt: { type: Date, default: null },
    lastMaterialChangeAt: { type: Date, default: null },
    lastReconcileAt: { type: Date, default: null },
    error: { type: errorInfoSchema, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
// One monitor per (account, target URL) — a resend of the same URL is a
// duplicate, resolved by the service to the existing row, never a second
// vendor monitor.
contentMonitorSchema.index({ accountId: 1, targetUrl: 1 }, { unique: true });
contentMonitorSchema.index({ accountId: 1, siteId: 1, createdAt: -1 });
contentMonitorSchema.index({ status: 1 });
contentMonitorSchema.index({ planningReceiptId: 1, planningLeaseUntil: 1 });
// Firecrawl monitor ids are only account-local. Bound resources are therefore
// unique by (credential, monitor id); legacy null/absent rows are excluded.
contentMonitorSchema.index({ providerCredentialRef: 1, providerMonitorRef: 1 }, {
    unique: true,
    partialFilterExpression: { providerCredentialRef: { $type: 'string' } },
});
contentMonitorSchema.pre('validate', function pre() {
    const doc = this as ContentMonitorHydrated;
    if (!isSafeMonitorSingleLineText(doc.targetUrl)) {
        doc.invalidate('targetUrl', 'contentMonitor.targetUrl must not contain raw HTML markup or control characters');
    }
});
export type ContentMonitorDocument = InferSchemaType<typeof contentMonitorSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ContentMonitorHydrated = HydratedDocument<ContentMonitorDocument>;
export const ContentMonitor = mongoose.model('ContentMonitor', contentMonitorSchema);
// ---------------------------------------------------------------------------
// Webhook receipt — atomic (provider, eventId) dedupe on a 30-day TTL.
// ---------------------------------------------------------------------------
export const MONITOR_WEBHOOK_RECEIPT_STATUSES = [
    'received',
    'processing',
    'notification_pending',
    'processed',
    'skipped',
    'failed',
] as const;
export type MonitorWebhookReceiptStatus = (typeof MONITOR_WEBHOOK_RECEIPT_STATUSES)[number];
/**
 * The receipt doubles as the durable notification outbox. `waiting` means the
 * immutable change plan is committed but its evidence/baseline writes have not
 * all been replayed yet; only `pending`/an expired `sending` lease may dispatch.
 */
export const MONITOR_NOTIFICATION_STATES = [
    'waiting',
    'pending',
    'sending',
    'delivered',
    'suppressed',
    'failed',
] as const;
export type MonitorNotificationState = (typeof MONITOR_NOTIFICATION_STATES)[number];
export const MONITOR_NOTIFICATION_OUTCOMES = [
    'delivered',
    'opted-out',
    'no-recipient',
    'retries-exhausted',
    'retry-window-expired',
    'provider-outcome-unknown',
    'monitor-deleted',
] as const;
export type MonitorNotificationOutcome = (typeof MONITOR_NOTIFICATION_OUTCOMES)[number];
/** Documented replay window. */
export const MONITOR_WEBHOOK_RECEIPT_TTL_DAYS = 30;
const receiptEventSchema = new mongoose.Schema({
    eventKey: { type: String, required: true },
    checkId: { type: String, required: true },
    targetUrl: {
        type: String,
        required: true,
        validate: safeSingleLineTextValidator,
    },
    status: { type: String, enum: PAGE_CHANGE_STATUSES, required: true },
    changed: { type: Boolean, required: true },
    contentHash: { type: String, default: null },
    diffText: {
        type: String,
        default: null,
        maxlength: CONTENT_MONITOR_DIFF_MAX_CHARS,
        validate: safeStoredTextValidator,
    },
    occurredAt: { type: Date, required: true },
}, { _id: false });
const materialEventPlanSchema = new mongoose.Schema({
    eventKey: { type: String, required: true },
    reason: {
        type: String,
        enum: ['hash_changed', 'page_removed', 'page_restored'] as const,
        required: true,
    },
}, { _id: false });
/**
 * Immutable decision plan written before any cross-store effects. A replay
 * consumes this plan instead of comparing against a baseline that an earlier
 * attempt may already have advanced.
 */
const receiptProcessingPlanSchema = new mongoose.Schema({
    plannedAt: { type: Date, required: true },
    isoWeek: { type: String, required: true },
    previousNormalizedHash: { type: String, default: null },
    previousBaselineStatus: {
        type: String,
        enum: PAGE_CHANGE_STATUSES,
        default: null,
    },
    previousCursorOccurredAt: { type: Date, default: null },
    previousCursorEventKey: { type: String, default: null },
    nextNormalizedHash: { type: String, default: null },
    nextBaselineStatus: {
        type: String,
        enum: PAGE_CHANGE_STATUSES,
        default: null,
    },
    nextCursorOccurredAt: { type: Date, default: null },
    nextCursorEventKey: { type: String, default: null },
    acceptedEventKeys: { type: [String], default: [], required: true },
    materialEvents: {
        type: [materialEventPlanSchema],
        default: [],
        required: true,
    },
    baselineCommittedAt: { type: Date, default: null },
}, { _id: false });
/**
 * Embedded outbox row. The immutable recipient/render inputs and idempotency
 * key are captured with the processing plan; lease/outcome fields are updated
 * atomically with the receipt terminal state.
 */
const receiptNotificationSchema = new mongoose.Schema({
    state: {
        type: String,
        enum: MONITOR_NOTIFICATION_STATES,
        required: true,
    },
    ownerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    /** Exact normalized recipient frozen before the first provider request. */
    recipientEmail: { type: String, trim: true, lowercase: true, default: null },
    /** Exact configured From identity frozen with the email payload. */
    senderIdentity: { type: String, default: null, maxlength: 320 },
    /** Eligibility is decided once; later preference changes affect future events. */
    suppressionReason: {
        type: String,
        enum: ['opted-out', 'no-recipient'] as const,
        default: null,
    },
    targetUrl: {
        type: String,
        default: null,
        validate: safeSingleLineTextValidator,
    },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    /** Exact rendered payload; retries must be byte-for-byte equivalent. */
    subject: {
        type: String,
        default: null,
        maxlength: 1000,
        validate: safeSingleLineTextValidator,
    },
    text: {
        type: String,
        default: null,
        maxlength: 10000,
        validate: safeStoredTextValidator,
    },
    /** Trusted escaped HTML frozen alongside text; never contains raw page prose. */
    html: { type: String, default: null, maxlength: 20000 },
    idempotencyKey: { type: String, required: true, maxlength: 256 },
    requestFingerprint: {
        type: String,
        default: null,
        match: /^request-hmac-v1:[0-9a-f]{64}$/u,
    },
    leaseId: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    attemptCount: { type: Number, min: 0, default: 0, required: true },
    firstAttemptAt: { type: Date, default: null },
    retryUntil: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    outcome: {
        type: String,
        enum: MONITOR_NOTIFICATION_OUTCOMES,
        default: null,
    },
    providerMessageId: { type: String, default: null, maxlength: 256 },
    lastFailure: {
        type: String,
        enum: ['transport-failure', 'provider-outcome-unknown'] as const,
        default: null,
    },
}, { _id: false });
const monitorWebhookReceiptSchema = new mongoose.Schema({
    provider: { type: String, required: true },
    /** Vendor delivery/event id — the `(provider, eventId)` dedupe discriminant. */
    eventId: { type: String, required: true },
    monitorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContentMonitor',
        required: true,
        index: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    providerMonitorRef: { type: String, required: true },
    checkId: { type: String, required: true },
    eventType: { type: String, required: true },
    /** sha256 of the raw body — an integrity breadcrumb, NOT the body itself. */
    payloadHash: { type: String, required: true },
    events: { type: [receiptEventSchema], default: [], required: true },
    status: {
        type: String,
        enum: MONITOR_WEBHOOK_RECEIPT_STATUSES,
        default: 'received',
        required: true,
    },
    /** Durable decision plan; present from `processing` onward. */
    processingPlan: { type: receiptProcessingPlanSchema, default: null },
    /** Durable notification outbox; present only for material receipts. */
    notification: { type: receiptNotificationSchema, default: null },
    /** Durable pre-outbox retry budget (independent of notification attempts). */
    processingAttemptCount: { type: Number, min: 0, default: 0, required: true },
    processingFirstAttemptAt: { type: Date, default: null },
    processingRetryUntil: { type: Date, default: null },
    processingLastAttemptAt: { type: Date, default: null },
    failureReason: {
        type: String,
        enum: [
            'receipt-binding-invalid',
            'processing-plan-missing',
            'notification-payload-invalid',
            'processing-retries-exhausted',
            'processing-window-expired',
        ] as const,
        default: null,
    },
    /** Round-robin recovery cursor prevents an old runnable batch starving later rows. */
    recoveryCheckedAt: { type: Date, default: null },
    receivedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    // Mongo TTL — the row is reaped once `expiryAt` passes (30 days).
    expiryAt: { type: Date, required: true },
}, { timestamps: true });
// Atomic dedupe key — a concurrent duplicate delivery loses the insert race.
monitorWebhookReceiptSchema.index({ provider: 1, eventId: 1 }, { unique: true });
monitorWebhookReceiptSchema.index({ expiryAt: 1 }, { expireAfterSeconds: 0 });
monitorWebhookReceiptSchema.index({ status: 1, updatedAt: 1 });
monitorWebhookReceiptSchema.index({ status: 1, 'notification.leaseUntil': 1 });
monitorWebhookReceiptSchema.index({ status: 1, recoveryCheckedAt: 1, receivedAt: 1 });
monitorWebhookReceiptSchema.pre('validate', function pre() {
    const doc = this as MonitorWebhookReceiptHydrated;
    for (const event of doc.events) {
        if (!isSafeMonitorSingleLineText(event.targetUrl) ||
            !isSafeMonitorStoredText(event.diffText)) {
            doc.invalidate('events', 'monitorWebhookReceipt.events must not contain raw HTML markup or control characters');
            break;
        }
        if (event.checkId !== doc.checkId) {
            doc.invalidate('events', 'monitorWebhookReceipt event checkId must match receipt');
            break;
        }
    }
    for (const field of ['targetUrl', 'subject', 'text'] as const) {
        const value = doc.notification?.[field];
        const safe = field === 'text'
            ? isSafeMonitorStoredText(value)
            : isSafeMonitorSingleLineText(value);
        if (!safe) {
            doc.invalidate(`notification.${field}`, `monitorWebhookReceipt.notification.${field} must not contain raw HTML markup or control characters`);
        }
    }
    if (doc.notification &&
        ['waiting', 'pending', 'sending'].includes(doc.notification.state) &&
        (!doc.notification.targetUrl ||
            !doc.notification.subject ||
            !doc.notification.text)) {
        doc.invalidate('notification', 'active monitor notification payload must be complete');
    }
});
export type MonitorWebhookReceiptDocument = InferSchemaType<typeof monitorWebhookReceiptSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type MonitorWebhookReceiptHydrated = HydratedDocument<MonitorWebhookReceiptDocument>;
export const MonitorWebhookReceipt = mongoose.model('MonitorWebhookReceipt', monitorWebhookReceiptSchema);
// ---------------------------------------------------------------------------
// Sanitized diff evidence — 7-day TTL (mirrors content-snapshot).
// ---------------------------------------------------------------------------
export const MONITOR_EVIDENCE_TTL_DAYS = 7;
const monitorEvidenceSchema = new mongoose.Schema({
    monitorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContentMonitor',
        required: true,
        index: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    checkId: { type: String, required: true },
    eventKey: { type: String, required: true },
    sourceUrl: {
        type: String,
        required: true,
        validate: safeSingleLineTextValidator,
    },
    reason: { type: String, required: true },
    diffText: {
        type: String,
        default: null,
        maxlength: CONTENT_MONITOR_DIFF_MAX_CHARS,
        validate: safeStoredTextValidator,
    },
    observedAt: { type: Date, required: true },
    // Mongo TTL — reaped as soon as `expiryAt` is in the past (7 days).
    expiryAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
monitorEvidenceSchema.index({ monitorId: 1, eventKey: 1 }, { unique: true });
monitorEvidenceSchema.index({ expiryAt: 1 }, { expireAfterSeconds: 0 });
monitorEvidenceSchema.index({ monitorId: 1, observedAt: -1 });
monitorEvidenceSchema.pre('validate', function pre() {
    const doc = this as MonitorEvidenceHydrated;
    for (const field of ['sourceUrl', 'diffText'] as const) {
        const value = doc[field];
        const safe = field === 'diffText'
            ? isSafeMonitorStoredText(value)
            : isSafeMonitorSingleLineText(value);
        if (!safe) {
            doc.invalidate(field, `monitorEvidence.${field} must not contain raw HTML markup or control characters`);
        }
    }
});
export type MonitorEvidenceDocument = InferSchemaType<typeof monitorEvidenceSchema> & {
    createdAt: Date;
};
export type MonitorEvidenceHydrated = HydratedDocument<MonitorEvidenceDocument>;
export const MonitorEvidence = mongoose.model('MonitorEvidence', monitorEvidenceSchema);
