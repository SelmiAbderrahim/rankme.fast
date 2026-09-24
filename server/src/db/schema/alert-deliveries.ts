/**
 * Terminal per-channel, per-recipient alert delivery records.
 *
 * `idempotency_key` is UNIQUE and keeps one durable row per leg. Sent and
 * suppressed rows cannot be reclaimed; a higher retry attempt may atomically
 * move a prior `failed` or crash-stranded `pending` row back to pending. Email
 * uses the stable row id at the provider boundary, while generic webhooks
 * expose it to receivers. External transports cannot offer strict exactly-once
 * semantics across an ambiguous network failure.
 *
 * `evidence` is frozen at claim time and is the ONLY source every rendered
 * channel body reads from — see the honesty invariant in
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import type { EncryptedSecret } from '../../shared/crypto/index.js';
import { ALERT_CHANNELS, ALERT_RULE_TYPES } from './alert-rules.js';
export const ALERT_DELIVERY_STATUSES = [
    'pending',
    'sent',
    'failed',
    'suppressed',
] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];
/** Closed allowlist — never vendor prose, never a transport message. */
export const ALERT_DELIVERY_ERROR_CODES = [
    'transport_unavailable',
    'transport_rejected',
    'transport_exception',
    'unsafe_url',
    'channel_timeout',
    'retries_exhausted',
    'provider_outcome_unknown',
    'provider_outcome_unknown_payload_drift',
    'provider_outcome_unknown_idempotency_window_expired',
    'idempotency_window_expired',
] as const;
export type AlertDeliveryErrorCode = (typeof ALERT_DELIVERY_ERROR_CODES)[number];
export const ALERT_SUPPRESSION_REASONS = [
    'opted_out',
    'membership_removed',
    'no_transport',
    'rule_disabled',
    'retries_exhausted',
    'flag_disabled',
] as const;
export type AlertSuppressionReason = (typeof ALERT_SUPPRESSION_REASONS)[number];
/** Bounded retries then terminal suppression — never infinite redelivery. */
export const ALERT_MAX_ATTEMPTS = 3;
/**
 * Exact provider request frozen before the first email submission. Mutable
 * membership, address, locale, preference, and From configuration are never
 * consulted again for an ambiguous replay of this event.
 */
export interface StoredAlertEmailRequest {
    version: 'rankmefast.alert-email.v1';
    senderIdentity: string | null;
    to: string;
    subject: string;
    text: string;
    html?: string;
    locale: 'en' | 'ar' | 'fr' | 'de' | 'es' | 'ru' | 'zh';
}
export interface StoredAlertSlackRequest {
    version: 'rankmefast.alert-slack.v1';
    encryptedUrl: EncryptedSecret;
    body: string;
    locale?: 'en' | 'ar' | 'fr' | 'de' | 'es' | 'ru' | 'zh';
}
export interface StoredAlertWebhookRequest {
    version: 'rankmefast.alert-webhook.v1';
    encryptedUrl: EncryptedSecret;
    rawBody: string;
    timestampSeconds: number;
    signature: string;
}
export type StoredAlertRequest = StoredAlertEmailRequest | StoredAlertSlackRequest | StoredAlertWebhookRequest;
export const ALERT_REQUEST_PAYLOAD_MAX_BYTES = 128 * 1024;
export const alertDeliveries = pgTable('alert_deliveries', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    ruleId: uuid('rule_id')
        .notNull(),
    channel: text('channel', { enum: ALERT_CHANNELS }).notNull(),
    /** User id for `email`; NULL for `slack` / `webhook`. */
    recipientRef: text('recipient_ref'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** Stored explicitly so Redis-loss reconciliation never parses a key. */
    transitionId: text('transition_id').notNull(),
    transitionKind: text('transition_kind', { enum: ALERT_RULE_TYPES }).notNull(),
    status: text('status', { enum: ALERT_DELIVERY_STATUSES }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    /** Rotated on every claim; terminal CAS rejects a stale worker. */
    claimToken: uuid('claim_token'),
    /** HMAC of the exact outbound request, bound before first submission. */
    requestFingerprint: text('request_fingerprint'),
    /** Timestamp of the first provider-bound claim, never a later replay. */
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
    /** Short-lived exact request used for byte-identical provider replays. */
    requestPayload: jsonb('request_payload').$type<StoredAlertRequest>(),
    errorCode: text('error_code', { enum: ALERT_DELIVERY_ERROR_CODES }),
    providerMessageId: text('provider_message_id'),
    suppressedReason: text('suppressed_reason', {
        enum: ALERT_SUPPRESSION_REASONS,
    }),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    /** Rotation cursor for bounded Redis-loss reconciliation sweeps. */
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
}, (table) => [
    uniqueIndex('alert_deliveries_idempotency_uq').on(table.idempotencyKey),
    index('alert_deliveries_rule_created_idx').on(table.accountId, table.ruleId, table.createdAt, table.id),
    index('alert_deliveries_rule_transition_idx').on(table.accountId, table.ruleId, table.transitionId, table.id),
    check('alert_deliveries_status_check', sql `${table.status} in ('pending', 'sent', 'failed', 'suppressed')`),
    check('alert_deliveries_channel_check', sql `${table.channel} in ('email', 'slack', 'webhook')`),
    check('alert_deliveries_reason_when_suppressed', sql `(${table.status} = 'suppressed' AND ${table.suppressedReason} IS NOT NULL) OR (${table.status} <> 'suppressed' AND ${table.suppressedReason} IS NULL)`),
    check('alert_deliveries_recipient_when_email', sql `(${table.channel} = 'email' AND ${table.recipientRef} IS NOT NULL) OR (${table.channel} <> 'email' AND ${table.recipientRef} IS NULL)`),
    check('alert_deliveries_attempt_bound', sql `${table.attempt} between 0 and ${sql.raw(String(ALERT_MAX_ATTEMPTS))}`),
    check('alert_deliveries_claim_shape', sql `(${table.status} = 'pending' and ${table.claimToken} is not null) or (${table.status} <> 'pending' and ${table.claimToken} is null)`),
    check('alert_deliveries_request_size', sql `${table.requestPayload} is null or octet_length(${table.requestPayload}::text) between 1 and ${sql.raw(String(ALERT_REQUEST_PAYLOAD_MAX_BYTES))}`),
]);
export type AlertDeliveryRow = typeof alertDeliveries.$inferSelect;
export type NewAlertDeliveryRow = typeof alertDeliveries.$inferInsert;
