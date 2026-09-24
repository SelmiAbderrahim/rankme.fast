/**
 * Customer-configured alert rules.
 *
 * Relational, account-scoped, ordered → Postgres (scoped exception per
 * `.claude/rules/drizzle-postgres-scope.md`). Identity/orchestration stays in
 * Mongo, so account/site ids are `text` at this cross-store boundary and every
 * query is account-scoped.
 *
 * Channel secrets (the Slack incoming-webhook URL, the generic-webhook HMAC
 * secret) are AES-256-GCM envelopes written by `shared/crypto`, AAD-bound to
 * `alert_rules:<ruleId>:<field>` so a ciphertext moved between rules or fields
 * fails GCM verification rather than an application-level check. The masked
 * display columns exist precisely so a read endpoint never has to decrypt.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid, } from 'drizzle-orm/pg-core';
import type { EncryptedSecret } from '../../shared/crypto/index.js';
export const ALERT_RULE_TYPES = [
    'rank_drop',
    'new_backlink',
    'lost_backlink',
] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];
/** Channels a rule may fan out to. Email is every paid tier; the rest are Pro+. */
export const ALERT_CHANNELS = ['email', 'slack', 'webhook'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const ALERT_THRESHOLD_MIN = 1;
export const ALERT_THRESHOLD_MAX = 100;
/** Bounded recipient fan-out — an account-member list, never free-text addresses. */
export const ALERT_MAX_EMAIL_RECIPIENTS = 20;
export const ALERT_WEBHOOK_URL_MAX_CHARS = 2048;
export const alertRules = pgTable('alert_rules', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    type: text('type', { enum: ALERT_RULE_TYPES }).notNull(),
    /** Positions. NOT NULL iff `type = 'rank_drop'` (CHECK-enforced). */
    threshold: integer('threshold'),
    enabled: boolean('enabled').notNull().default(true),
    /** Account-member user ids; delivery resolves email + locale + preference. */
    emailRecipientIds: jsonb('email_recipient_ids')
        .$type<string[]>()
        .notNull()
        .default(sql `'[]'::jsonb`),
    slackWebhook: jsonb('slack_webhook').$type<EncryptedSecret>(),
    slackHostMasked: text('slack_host_masked'),
    /** Generic webhook target — not a credential, so plaintext for host display. */
    webhookUrl: text('webhook_url'),
    webhookSecret: jsonb('webhook_secret').$type<EncryptedSecret>(),
    webhookSecretLast4: text('webhook_secret_last4'),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    check('alert_rules_type_check', sql `${table.type} in ('rank_drop', 'new_backlink', 'lost_backlink')`),
    check('alert_rules_threshold_when_rank_drop', sql `(${table.type} = 'rank_drop' AND ${table.threshold} IS NOT NULL AND ${table.threshold} between ${sql.raw(String(ALERT_THRESHOLD_MIN))} and ${sql.raw(String(ALERT_THRESHOLD_MAX))}) OR (${table.type} <> 'rank_drop' AND ${table.threshold} IS NULL)`),
    check('alert_rules_slack_pair', sql `(${table.slackWebhook} IS NULL) = (${table.slackHostMasked} IS NULL)`),
    check('alert_rules_webhook_pair', sql `(${table.webhookUrl} IS NULL) = (${table.webhookSecret} IS NULL) AND (${table.webhookUrl} IS NULL) = (${table.webhookSecretLast4} IS NULL)`),
    check('alert_rules_webhook_url_length', sql `${table.webhookUrl} IS NULL OR char_length(${table.webhookUrl}) between 1 and ${sql.raw(String(ALERT_WEBHOOK_URL_MAX_CHARS))}`),
    check('alert_rules_recipient_bound', sql `jsonb_array_length(${table.emailRecipientIds}) between 0 and ${sql.raw(String(ALERT_MAX_EMAIL_RECIPIENTS))}`),
    // A rule with no channel could never deliver — refuse it at the DB, not
    // only in zod. The service mints `id` in application code so the AAD
    // (`alert_rules:<id>:<field>`) is known before the INSERT and secrets land
    // in the same statement; there is no intermediate channel-less row.
    check('alert_rules_at_least_one_channel', sql `jsonb_array_length(${table.emailRecipientIds}) > 0 OR ${table.slackWebhook} IS NOT NULL OR ${table.webhookUrl} IS NOT NULL`),
    index('alert_rules_account_site_idx').on(table.accountId, table.siteId, table.type),
    index('alert_rules_account_enabled_idx').on(table.accountId, table.enabled, table.type),
]);
export type AlertRuleRow = typeof alertRules.$inferSelect;
export type NewAlertRuleRow = typeof alertRules.$inferInsert;
