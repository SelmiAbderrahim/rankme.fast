/**
 * Public-page change monitoring — ordered event log.
 *
 * One append-only row per monitoring lifecycle transition that matters for
 * billing reconciliation or the change feed. Every write is idempotent by
 * `(monitorId, eventKey)` — the unique index guarantees a webhook replay, a
 * concurrent duplicate delivery, or a reconciliation re-run never doubles a
 * reserved check, a completion, a detected change, or a cap-pause entry.
 *
 * `eventKey` semantics by kind:
 *   - check_reserved  : `reserve:<isoWeek>` (one reservation per monitor per week)
 *   - check_completed : the vendor checkId
 *   - change_detected : the per-page event key `sha256(monitorId,checkId,url)`
 *   - check_failed    : the vendor checkId (or `reserve:<isoWeek>` for a
 *                       reservation that never produced a check)
 *   - cap_paused      : `cap:<period>` (one cap-pause row per monitor per period)
 *
 * The paid unit itself lives on `usage_counters.content_monitor_checks` — this
 * table is an append-only archive alongside that authoritative counter, never
 * the source of truth for what was billed. Money is bigint micros USD.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const CONTENT_MONITOR_EVENT_KINDS = [
    'check_reserved',
    'check_completed',
    'change_detected',
    'check_failed',
    'cap_paused',
] as const;
export type ContentMonitorEventKind = (typeof CONTENT_MONITOR_EVENT_KINDS)[number];
export const contentMonitorEvents = pgTable('content_monitor_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    monitorId: text('monitor_id').notNull(),
    /** Vendor check id for check-scoped events; null for reservation-only rows. */
    checkId: text('check_id'),
    /** Idempotency discriminant within a monitor (see file header). */
    eventKey: text('event_key').notNull(),
    kind: text('kind', { enum: CONTENT_MONITOR_EVENT_KINDS }).notNull(),
    /** `YYYY-Www` UTC ISO week the check was reserved for (change/check rows). */
    isoWeek: text('iso_week'),
    units: bigint('units', { mode: 'number' }).notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('content_monitor_events_monitor_eventkey_uidx').on(table.monitorId, table.eventKey),
    index('content_monitor_events_account_recorded_idx').on(table.accountId, table.recordedAt),
    index('content_monitor_events_monitor_recorded_idx').on(table.monitorId, table.recordedAt),
    check('content_monitor_events_kind_check', sql `${table.kind} in ('check_reserved', 'check_completed', 'change_detected', 'check_failed', 'cap_paused')`),
    check('content_monitor_events_units_nonneg_check', sql `${table.units} >= 0`),
    check('content_monitor_events_cost_nonneg_check', sql `${table.costMicros} >= 0`),
]);
export type ContentMonitorEventRow = typeof contentMonitorEvents.$inferSelect;
export type NewContentMonitorEventRow = typeof contentMonitorEvents.$inferInsert;
