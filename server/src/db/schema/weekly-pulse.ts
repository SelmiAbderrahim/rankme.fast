/**
 * Weekly Pulse — relational surface.
 *
 * Seven forward-only tables covering the whole feature set (this
 * file):
 *
 *   1. `site_pulse_settings`          — one row per (account, site) with the
 *                                       deterministic staggered schedule key,
 *                                       `enabled`, `next_run_at`, `last_run_at`,
 *                                       `last_status`.
 *   2. `site_pulse_subscriptions`     — one row per (account, site, user); the
 *                                       verified-recipient consent record.
 * Only the row's own user
 *                                       may mutate it (enforced at the API
 *                                       layer; this table only guarantees
 *                                       uniqueness).
 *   3. `weekly_pulse_runs`            — one immutable row per (account, site,
 *                                       ISO week UTC) capturing the collection
 *                                       outcome. Terminal-state
 *                                       machine: queued → collecting →
 *                                       completed | partial | blocked_capacity
 *                                       | unsupported | failed.
 *   4. `weekly_pulse_citations`       — immutable per-run normalized citation
 *                                       snapshot rows. No vendor
 *                                       envelopes.
 *   5. `weekly_pulse_citation_changes`— derived new / lost / unknown_partial
 *                                       rows per compatible prior pulse.
 *   6. `weekly_pulse_digest_projection`— bounded projection frozen at digest
 *                                       render time so retries stay accurate
 *                                       even when source records change.
 * Exactly ONE
 *                                       projection per run.
 *   7. `weekly_pulse_delivery_events` — per-recipient durable delivery outbox.
 *                                       Unique per (pulse, user, channel);
 *                                       queued/not_delivered can be replayed
 *                                       with one provider idempotency key,
 *                                       while suppression/delivered are final.
 *
 * Identifier types: text (not uuid) for `account_id`, `site_id`, `user_id`
 * because upstream ids are 24-char Mongo ObjectId hex (accounts / sites) or
 * Better Auth string ids — matches the identical pattern in
 * `audience-research-signal-decision-events.ts` and `usage-counters.ts`.
 * Internal ids (`pulse_run_id`, `citation_id`) are true `uuid` because they
 * are minted here.
 *
 * Retention-safe projection rule: `weekly_pulse_digest_projection.payload`
 * carries only IDs + bounded safe fields. NEVER raw AI answer text, source
 * excerpts, competitor prose, prompts, cost internals, or vendor task ids.
 * The DB shape does not enforce that (jsonb is opaque); the renderer +
 * validator do (later sub-prompts).
 *
 * Idempotency invariants:
 *   • `(account_id, site_id, iso_week)` unique → one collection per week.
 *   • `(pulse_run_id, engine, surface, cohort_id, cohort_version, canonical_url)`
 *     unique on citations → collector replays cannot double a row.
 *   • Same tuple + `change` unique on citation_changes → new/lost detection is
 *     replay-safe.
 *   • `(pulse_run_id)` unique on digest projection → one frozen render per run.
 *   • `(pulse_run_id, user_id, channel)` unique on delivery events → retries
 *     update the same row and can never double-send.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// ---------------------------------------------------------------------------
// Enums — the string-union columns.
// ---------------------------------------------------------------------------
/** Terminal states of a `weekly_pulse_runs` row. */
export const WEEKLY_PULSE_RUN_STATUSES = [
    'queued',
    'collecting',
    'completed',
    'partial',
    'blocked_capacity',
    'unsupported',
    'failed',
] as const;
export type WeeklyPulseRunStatus = (typeof WEEKLY_PULSE_RUN_STATUSES)[number];
/** Surfaces persisted per citation snapshot. */
export const WEEKLY_PULSE_CITATION_SURFACES = ['mentions', 'citations'] as const;
export type WeeklyPulseCitationSurface = (typeof WEEKLY_PULSE_CITATION_SURFACES)[number];
/** Change kinds relative to a compatible prior pulse. */
export const WEEKLY_PULSE_CHANGE_KINDS = ['new', 'lost', 'unknown_partial'] as const;
export type WeeklyPulseChangeKind = (typeof WEEKLY_PULSE_CHANGE_KINDS)[number];
/** Delivery channels — email-only in v1. */
export const WEEKLY_PULSE_DELIVERY_CHANNELS = ['email'] as const;
export type WeeklyPulseDeliveryChannel = (typeof WEEKLY_PULSE_DELIVERY_CHANNELS)[number];
/** Durable states of one recipient's delivery attempt. */
export const WEEKLY_PULSE_DELIVERY_STATUSES = [
    'queued',
    'delivered',
    'not_delivered',
    'suppressed_no_transport',
    'suppressed_membership_removed',
    'suppressed_unsubscribed',
] as const;
export type WeeklyPulseDeliveryStatus = (typeof WEEKLY_PULSE_DELIVERY_STATUSES)[number];
// ---------------------------------------------------------------------------
// 4.1 site_pulse_settings — one row per (account, site).
// ---------------------------------------------------------------------------
export const sitePulseSettings = pgTable('site_pulse_settings', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    /** Derived at write time from subscription count: TRUE iff ≥1 valid
     * subscription row exists. Set FALSE on last-unsubscribe / site deletion
     * / account purge. */
    enabled: boolean('enabled').notNull().default(false),
    /** Pure-function hash of `siteId` used to derive weekday (Mon..Sat) and
     * UTC hour/minute. Stored so the scheduler never re-derives
     * from siteId at read time. Stable across the site's lifetime. */
    scheduleKey: integer('schedule_key').notNull(),
    /** Next planned collection tick in UTC. Recomputed on subscription
     * mutation and after each run. */
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    /** Wall-clock of the last completed / terminal run. NULL until first
     * run finishes. */
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /** Mirrors the last `weekly_pulse_runs.status` — used by dashboard cards
     * without loading the full run row. */
    lastStatus: text('last_status', { enum: WEEKLY_PULSE_RUN_STATUSES }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('site_pulse_settings_account_site_uidx').on(table.accountId, table.siteId),
    // Scheduler drainer read pattern: pull enabled sites whose next_run_at is
    // in the past.
    index('site_pulse_settings_enabled_next_run_idx').on(table.enabled, table.nextRunAt),
    // Schedule key non-negative — the pure hash always returns >=0.
    check('site_pulse_settings_schedule_key_nonneg_check', sql `${table.scheduleKey} >= 0`),
]);
export type SitePulseSettingRow = typeof sitePulseSettings.$inferSelect;
export type NewSitePulseSettingRow = typeof sitePulseSettings.$inferInsert;
// ---------------------------------------------------------------------------
// 4.2 site_pulse_subscriptions — one row per (account, site, user).
// ---------------------------------------------------------------------------
export const sitePulseSubscriptions = pgTable('site_pulse_subscriptions', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    userId: text('user_id').notNull(),
    /** Snapshot of the user's resolved locale at opt-in — updates when the
     * user re-opts-in from a different locale. Delivery renders in THIS
     * locale, not the run-time locale. One of the shipped 7. */
    locale: text('locale').notNull(),
    /** When the user enabled the subscription. `updatedAt` is not enough —
     * enabling / disabling toggles need separate wall-clock anchors so the
     * pulse audit trail can prove consent at collection time. */
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL while enabled. Set on unsubscribe; row is preserved (not
     * deleted) so the pulse audit trail keeps consent history. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('site_pulse_subscriptions_account_site_user_uidx').on(table.accountId, table.siteId, table.userId),
    // Fast enabled-recipient lookup at collection time.
    index('site_pulse_subscriptions_site_enabled_idx').on(table.siteId, table.disabledAt),
]);
export type SitePulseSubscriptionRow = typeof sitePulseSubscriptions.$inferSelect;
export type NewSitePulseSubscriptionRow = typeof sitePulseSubscriptions.$inferInsert;
// ---------------------------------------------------------------------------
// 4.3 weekly_pulse_runs — one immutable row per (account, site, ISO week).
// ---------------------------------------------------------------------------
export const weeklyPulseRuns = pgTable('weekly_pulse_runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    /** `YYYY-Www` in UTC (ISO 8601). Any timezone drift is
     * eliminated by the pure UTC ISO week helper in
     * `server/src/modules/weekly-pulse/schedule.ts`. */
    isoWeek: text('iso_week').notNull(),
    status: text('status', { enum: WEEKLY_PULSE_RUN_STATUSES }).notNull(),
    /** Deep-equal to the site's `SiteMarket` at run start. Frozen — later
     * SiteMarket edits do not mutate this row. */
    marketSnapshot: jsonb('market_snapshot').notNull(),
    /** Immutable prompt cohort. */
    promptCohortId: text('prompt_cohort_id').notNull(),
    promptCohortVersion: integer('prompt_cohort_version').notNull(),
    /** Array of `{ engine, surface, supported: boolean, reason: string|null }`
     * coverage. */
    engineSurfaceSet: jsonb('engine_surface_set').notNull(),
    /** First-party ObservationMeta — provider request digest + UTC window
     * boundaries. Never carries raw vendor envelopes. */
    observationMeta: jsonb('observation_meta').notNull(),
    /** `{ unit:'ai_mentions_checks', charged:0|1, cost_micros_usd:number|null,
     *    activity_event_id: uuid|null }`. Safe reference
     * back to `usage_activity_events`; never a full envelope. */
    usageReference: jsonb('usage_reference').notNull(),
    /** Digest header counts — bounded scalars only (no raw text). */
    counts: jsonb('counts').notNull(),
    /** Bounded localized-key friendly error code. NULL on `completed`. */
    errorCode: text('error_code'),
    /** Bounded safe error detail (never a vendor envelope). NULL on
     * `completed`. */
    errorDetailSafe: text('error_detail_safe'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // The load-bearing invariant of the whole 12-set: ONE run per (account,
    // site, ISO week). Two concurrent scheduler ticks race here and the
    // second one gets a duplicate-key conflict — never a second charge.
    uniqueIndex('weekly_pulse_runs_account_site_week_uidx').on(table.accountId, table.siteId, table.isoWeek),
    // History pagination on the workspace card.
    index('weekly_pulse_runs_site_created_idx').on(table.siteId, table.createdAt),
    index('weekly_pulse_runs_status_created_idx').on(table.status, table.createdAt),
    check('weekly_pulse_runs_status_check', sql `${table.status} in ('queued','collecting','completed','partial','blocked_capacity','unsupported','failed')`),
    check('weekly_pulse_runs_cohort_version_nonneg_check', sql `${table.promptCohortVersion} >= 0`),
]);
export type WeeklyPulseRunRow = typeof weeklyPulseRuns.$inferSelect;
export type NewWeeklyPulseRunRow = typeof weeklyPulseRuns.$inferInsert;
// ---------------------------------------------------------------------------
// 4.4 weekly_pulse_citations — immutable per-run normalized snapshot rows.
// ---------------------------------------------------------------------------
export const weeklyPulseCitations = pgTable('weekly_pulse_citations', {
    id: uuid('id').primaryKey().defaultRandom(),
    pulseRunId: uuid('pulse_run_id')
        .notNull()
        .references(() => weeklyPulseRuns.id, { onDelete: 'cascade' }),
    /** Platform slug. */
    engine: text('engine').notNull(),
    surface: text('surface', { enum: WEEKLY_PULSE_CITATION_SURFACES }).notNull(),
    promptCohortId: text('prompt_cohort_id').notNull(),
    promptCohortVersion: integer('prompt_cohort_version').notNull(),
    /** Normalized canonical URL canonicalization rules — the
     * new / lost / unknown_partial comparison key. */
    canonicalUrl: text('canonical_url').notNull(),
    /** Bounded output-encoded page title for digest render. NULL if the
     * vendor did not supply one. */
    titleSafe: text('title_safe'),
    host: text('host').notNull(),
    mentionCount: integer('mention_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('weekly_pulse_citations_run_cell_url_uidx').on(table.pulseRunId, table.engine, table.surface, table.promptCohortId, table.promptCohortVersion, table.canonicalUrl),
    index('weekly_pulse_citations_run_engine_idx').on(table.pulseRunId, table.engine, table.surface),
    check('weekly_pulse_citations_surface_check', sql `${table.surface} in ('mentions','citations')`),
    check('weekly_pulse_citations_mention_count_nonneg_check', sql `${table.mentionCount} >= 0`),
    check('weekly_pulse_citations_cohort_version_nonneg_check', sql `${table.promptCohortVersion} >= 0`),
]);
export type WeeklyPulseCitationRow = typeof weeklyPulseCitations.$inferSelect;
export type NewWeeklyPulseCitationRow = typeof weeklyPulseCitations.$inferInsert;
// ---------------------------------------------------------------------------
// 4.5 weekly_pulse_citation_changes — derived (new | lost | unknown_partial).
// ---------------------------------------------------------------------------
export const weeklyPulseCitationChanges = pgTable('weekly_pulse_citation_changes', {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The current pulse run this change belongs to. */
    pulseRunId: uuid('pulse_run_id')
        .notNull()
        .references(() => weeklyPulseRuns.id, { onDelete: 'cascade' }),
    /** Prior compatible pulse. NULL when no compatible
     * pulse existed → every citation is `unknown_partial`. */
    priorPulseRunId: uuid('prior_pulse_run_id').references(() => weeklyPulseRuns.id, {
        onDelete: 'set null',
    }),
    change: text('change', { enum: WEEKLY_PULSE_CHANGE_KINDS }).notNull(),
    engine: text('engine').notNull(),
    surface: text('surface', { enum: WEEKLY_PULSE_CITATION_SURFACES }).notNull(),
    promptCohortId: text('prompt_cohort_id').notNull(),
    promptCohortVersion: integer('prompt_cohort_version').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    host: text('host').notNull(),
    /** Reference into `weekly_pulse_citations` when the change is `new` or
     * `unknown_partial` and there's a concrete row for it. NULL for
     * `lost` (the citation lives on the prior run only) or when the row
     * did not persist for the current run. */
    citationId: uuid('citation_id').references(() => weeklyPulseCitations.id, {
        onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('weekly_pulse_citation_changes_cell_url_uidx').on(table.pulseRunId, table.change, table.engine, table.surface, table.promptCohortId, table.promptCohortVersion, table.canonicalUrl),
    index('weekly_pulse_citation_changes_run_idx').on(table.pulseRunId, table.change),
    check('weekly_pulse_citation_changes_change_check', sql `${table.change} in ('new','lost','unknown_partial')`),
    check('weekly_pulse_citation_changes_surface_check', sql `${table.surface} in ('mentions','citations')`),
]);
export type WeeklyPulseCitationChangeRow = typeof weeklyPulseCitationChanges.$inferSelect;
export type NewWeeklyPulseCitationChangeRow = typeof weeklyPulseCitationChanges.$inferInsert;
// ---------------------------------------------------------------------------
// 4.6 weekly_pulse_digest_projection — bounded frozen render.
// ---------------------------------------------------------------------------
export const weeklyPulseDigestProjections = pgTable('weekly_pulse_digest_projection', {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unique per run (a rerender always overwrites the same row via UPSERT
     * on this unique key — never a second projection). */
    pulseRunId: uuid('pulse_run_id')
        .notNull()
        .references(() => weeklyPulseRuns.id, { onDelete: 'cascade' }),
    renderedAt: timestamp('rendered_at', { withTimezone: true }).notNull().defaultNow(),
    /** Bounded projection payload — IDs + safe fields only (host, title,
     * keyword, prior_rank, current_rank, action_id, verb, target,
     * appearance_name, clicks, impressions, ctr, position). NEVER raw AI
     * answers, source excerpts, competitor prose, prompts, cost internals,
     * or vendor task ids. The renderer enforces this shape. */
    payload: jsonb('payload').notNull(),
}, (table) => [
    uniqueIndex('weekly_pulse_digest_projection_run_uidx').on(table.pulseRunId),
]);
export type WeeklyPulseDigestProjectionRow = typeof weeklyPulseDigestProjections.$inferSelect;
export type NewWeeklyPulseDigestProjectionRow = typeof weeklyPulseDigestProjections.$inferInsert;
// ---------------------------------------------------------------------------
// 4.7 weekly_pulse_delivery_events — one row per (run, user, channel).
// ---------------------------------------------------------------------------
export const weeklyPulseDeliveryEvents = pgTable('weekly_pulse_delivery_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    pulseRunId: uuid('pulse_run_id')
        .notNull()
        .references(() => weeklyPulseRuns.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    channel: text('channel', { enum: WEEKLY_PULSE_DELIVERY_CHANNELS }).notNull(),
    /** Recipient locale — copied from the subscription row at delivery time
     * so the email renders in the consented locale even if the site's
     * default changes later. */
    locale: text('locale').notNull(),
    status: text('status', { enum: WEEKLY_PULSE_DELIVERY_STATUSES }).notNull(),
    attempt: integer('attempt').notNull().default(1),
    /** Bounded safe transport-side message id (Resend / SES message id).
     * NEVER a full transport envelope. */
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    errorDetailSafe: text('error_detail_safe'),
    /** Cost in bigint micros USD — the per-delivery slice of the pulse's
     * accounting envelope, not vendor cost. */
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // One delivery outbox event per (run, user, channel). Retries UPDATE this
    // row and reuse its opaque UUID as the external idempotency identity.
    uniqueIndex('weekly_pulse_delivery_events_run_user_channel_uidx').on(table.pulseRunId, table.userId, table.channel),
    index('weekly_pulse_delivery_events_run_status_idx').on(table.pulseRunId, table.status),
    check('weekly_pulse_delivery_events_status_check', sql `${table.status} in ('queued','delivered','not_delivered','suppressed_no_transport','suppressed_membership_removed','suppressed_unsubscribed')`),
    check('weekly_pulse_delivery_events_channel_check', sql `${table.channel} in ('email')`),
    check('weekly_pulse_delivery_events_attempt_positive_check', sql `${table.attempt} >= 1`),
    check('weekly_pulse_delivery_events_cost_nonneg_check', sql `${table.costMicros} >= 0`),
]);
export type WeeklyPulseDeliveryEventRow = typeof weeklyPulseDeliveryEvents.$inferSelect;
export type NewWeeklyPulseDeliveryEventRow = typeof weeklyPulseDeliveryEvents.$inferInsert;
