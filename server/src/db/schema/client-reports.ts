import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const CLIENT_REPORT_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ClientReportFrequency = (typeof CLIENT_REPORT_FREQUENCIES)[number];
export const CLIENT_REPORT_DELIVERY_STATUSES = [
    'pending',
    'sent',
    'failed',
    'suppressed',
] as const;
export type ClientReportDeliveryStatus = (typeof CLIENT_REPORT_DELIVERY_STATUSES)[number];
export const CLIENT_REPORT_SUPPRESSION_REASONS = [
    'preference',
    'removed_user',
    'transport',
] as const;
export type ClientReportSuppressionReason = (typeof CLIENT_REPORT_SUPPRESSION_REASONS)[number];
export const CLIENT_REPORT_DELIVERY_ERROR_CODES = [
    'composition_failed',
    'transport_reported_failure',
    'transport_exception',
    'retries_exhausted',
    'provider_outcome_unknown',
    'provider_outcome_unknown_payload_drift',
    'provider_outcome_unknown_idempotency_window_expired',
    'idempotency_window_expired',
] as const;
export type ClientReportDeliveryErrorCode = (typeof CLIENT_REPORT_DELIVERY_ERROR_CODES)[number];
/**
 * Exact common portion of one Resend request, frozen only for the bounded
 * retry window. Recipient address and idempotency key remain per delivery.
 */
interface StoredClientReportEmailPayloadBase {
    senderIdentity: string | null;
    subject: string;
    text: string;
    html: string;
    attachment: {
        filename: 'client-report.pdf';
        contentBase64: string;
        contentType: 'application/pdf';
    };
}
export type StoredClientReportEmailPayload = (StoredClientReportEmailPayloadBase & {
    version: 'rankmefast.client-report-email.v1';
}) | (StoredClientReportEmailPayloadBase & {
    version: 'rankmefast.client-report-email.v2';
    locale: 'en' | 'ar' | 'fr' | 'de' | 'es' | 'ru' | 'zh';
});
/** JSONB ceiling for the short-lived exact email body + PDF attachment. */
export const CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES = 12 * 1024 * 1024;
export interface StoredClientReportSections {
    audit: boolean;
    ranks: boolean;
    gsc: boolean;
}
export const scheduledReports = pgTable('scheduled_reports', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    name: text('name').notNull(),
    frequency: text('frequency', { enum: CLIENT_REPORT_FREQUENCIES }).notNull(),
    weekdayUtc: integer('weekday_utc'),
    monthdayUtc: integer('monthday_utc'),
    hourUtc: integer('hour_utc').notNull(),
    minuteUtc: integer('minute_utc').notNull(),
    locale: text('locale').notNull(),
    recipients: jsonb('recipients').$type<string[]>().notNull(),
    sections: jsonb('sections').$type<StoredClientReportSections>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index('scheduled_reports_account_created_idx').on(table.accountId, table.createdAt.desc()),
    index('scheduled_reports_site_enabled_idx').on(table.siteId, table.enabled),
    check('scheduled_reports_frequency_check', sql `${table.frequency} in ('weekly','monthly')`),
    check('scheduled_reports_cadence_fields_check', sql `(${table.frequency} = 'weekly' and ${table.weekdayUtc} between 0 and 6 and ${table.monthdayUtc} is null) or (${table.frequency} = 'monthly' and ${table.monthdayUtc} between 1 and 28 and ${table.weekdayUtc} is null)`),
    check('scheduled_reports_hour_check', sql `${table.hourUtc} between 0 and 23`),
    check('scheduled_reports_minute_check', sql `${table.minuteUtc} between 0 and 59`),
    check('scheduled_reports_locale_check', sql `${table.locale} in ('en','ar','fr','de','es','ru','zh')`),
]);
export type ScheduledReportRow = typeof scheduledReports.$inferSelect;
export type NewScheduledReportRow = typeof scheduledReports.$inferInsert;
/**
 * Short-lived exact-delivery outbox. The row is deleted as soon as every
 * recipient is terminal, or when the provider idempotency window expires;
 * delivery-log metadata remains in `scheduled_report_deliveries`.
 */
export const scheduledReportRuns = pgTable('scheduled_report_runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id')
        .notNull()
        .references(() => scheduledReports.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runKey: text('run_key').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    snapshotDate: timestamp('snapshot_date', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<StoredClientReportEmailPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('scheduled_report_runs_schedule_run_uidx').on(table.scheduleId, table.runKey),
    index('scheduled_report_runs_reconcile_idx').on(table.createdAt, table.id),
    index('scheduled_report_runs_account_site_idx').on(table.accountId, table.siteId),
    check('scheduled_report_runs_payload_size_check', sql `octet_length(${table.payload}::text) between 1 and ${sql.raw(String(CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES))}`),
]);
export type ScheduledReportRunRow = typeof scheduledReportRuns.$inferSelect;
export type NewScheduledReportRunRow = typeof scheduledReportRuns.$inferInsert;
export const scheduledReportDeliveries = pgTable('scheduled_report_deliveries', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id')
        .notNull()
        .references(() => scheduledReports.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runKey: text('run_key').notNull(),
    recipient: text('recipient').notNull(),
    status: text('status', { enum: CLIENT_REPORT_DELIVERY_STATUSES }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    /** Rotated on every claim; terminal CAS rejects a stale worker. */
    claimToken: uuid('claim_token'),
    /** HMAC of the exact sender/to/body/attachment/idempotency-key request. */
    requestFingerprint: text('request_fingerprint'),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
    suppressionReason: text('suppression_reason', {
        enum: CLIENT_REPORT_SUPPRESSION_REASONS,
    }),
    errorCode: text('error_code', { enum: CLIENT_REPORT_DELIVERY_ERROR_CODES }),
    providerMessageId: text('provider_message_id'),
    snapshotDate: timestamp('snapshot_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => [
    uniqueIndex('scheduled_report_deliveries_schedule_run_recipient_uidx').on(table.scheduleId, table.runKey, table.recipient),
    index('scheduled_report_deliveries_schedule_created_idx').on(table.scheduleId, table.createdAt.desc()),
    index('scheduled_report_deliveries_account_site_idx').on(table.accountId, table.siteId),
    check('scheduled_report_deliveries_status_check', sql `${table.status} in ('pending','sent','failed','suppressed')`),
    check('scheduled_report_deliveries_suppression_check', sql `${table.suppressionReason} is null or ${table.suppressionReason} in ('preference','removed_user','transport')`),
    check('scheduled_report_deliveries_error_check', sql `${table.errorCode} is null or ${table.errorCode} in ('composition_failed','transport_reported_failure','transport_exception','retries_exhausted','provider_outcome_unknown','provider_outcome_unknown_payload_drift','provider_outcome_unknown_idempotency_window_expired','idempotency_window_expired')`),
    check('scheduled_report_deliveries_attempt_check', sql `${table.attempt} between 0 and 3`),
    check('scheduled_report_deliveries_pending_shape_check', sql `(${table.status} = 'pending' and ${table.claimToken} is not null and ${table.requestFingerprint} is not null and ${table.firstAttemptAt} is not null and ${table.finishedAt} is null) or (${table.status} <> 'pending' and ${table.claimToken} is null and ${table.finishedAt} is not null)`),
]);
export type ScheduledReportDeliveryRow = typeof scheduledReportDeliveries.$inferSelect;
export type NewScheduledReportDeliveryRow = typeof scheduledReportDeliveries.$inferInsert;
