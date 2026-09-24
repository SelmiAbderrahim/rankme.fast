import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { z } from 'zod';
export const BACKLINK_DEEP_SNAPSHOT_TYPES = [
    'refDomains',
    'anchors',
    'history',
    'bulkRanks',
] as const;
export type BacklinkDeepSnapshotType = (typeof BACKLINK_DEEP_SNAPSHOT_TYPES)[number];
export const BACKLINK_DEEP_ROW_LIMIT = 500;
export const BACKLINK_HISTORY_POINT_LIMIT = 24;
export const BACKLINK_BULK_RANK_LIMIT = 100;
export const LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH = 253;
const domainSchema = z.string().trim().min(1).max(LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH);
const nonNegativeIntegerSchema = z.number().int().nonnegative().finite();
const nullableRankSchema = z.number().int().min(0).max(100).nullable();
const nullableObservedAtSchema = z.string().datetime({ offset: true }).nullable();
export const backlinkDeepPayloadSchemas = {
    refDomains: z
        .array(z
        .object({
        domain: domainSchema,
        backlinks: nonNegativeIntegerSchema,
        domainRank: nullableRankSchema,
        firstSeen: nullableObservedAtSchema,
        lastSeen: nullableObservedAtSchema,
    })
        .strict())
        .max(BACKLINK_DEEP_ROW_LIMIT),
    anchors: z
        .array(z
        .object({
        anchor: z.string().max(200),
        backlinks: nonNegativeIntegerSchema,
        referringDomains: nonNegativeIntegerSchema,
    })
        .strict())
        .max(BACKLINK_DEEP_ROW_LIMIT),
    history: z
        .array(z
        .object({
        year: z.number().int().min(1970).max(9999),
        month: z.number().int().min(1).max(12),
        backlinks: nonNegativeIntegerSchema,
        referringDomains: nonNegativeIntegerSchema,
    })
        .strict())
        .max(BACKLINK_HISTORY_POINT_LIMIT),
    bulkRanks: z
        .array(z
        .object({
        domain: domainSchema,
        rank: nullableRankSchema,
    })
        .strict())
        .max(BACKLINK_BULK_RANK_LIMIT),
} as const;
export type BacklinkDeepSnapshotPayloadByType = {
    [Type in BacklinkDeepSnapshotType]: z.infer<(typeof backlinkDeepPayloadSchemas)[Type]>;
};
export type BacklinkDeepSnapshotPayload = BacklinkDeepSnapshotPayloadByType[BacklinkDeepSnapshotType];
/** Parse every jsonb read before it crosses the persistence boundary. */
export function parseBacklinkDeepSnapshotPayload<Type extends BacklinkDeepSnapshotType>(type: Type, payload: unknown): BacklinkDeepSnapshotPayloadByType[Type] {
    return backlinkDeepPayloadSchemas[type].parse(payload) as BacklinkDeepSnapshotPayloadByType[Type];
}
/**
 * Append-only normalized output for one deep backlink operation. Mongo owns
 * the run lifecycle; this table owns bounded result rows and has no update
 * timestamp by design.
 */
export const backlinkDeepSnapshots = pgTable('backlink_deep_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runId: text('run_id').notNull(),
    type: text('type', { enum: BACKLINK_DEEP_SNAPSHOT_TYPES }).notNull(),
    domain: text('domain').notNull(),
    payload: jsonb('payload').$type<BacklinkDeepSnapshotPayload>().notNull(),
    retainedCount: integer('retained_count').notNull(),
    retainedAt: timestamp('retained_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('backlink_deep_snapshots_account_run_type_uq').on(table.accountId, table.runId, table.type),
    index('backlink_deep_snapshots_site_retained_idx').on(table.accountId, table.siteId, table.retainedAt),
    check('backlink_deep_snapshots_type_check', sql `${table.type} in ('refDomains', 'anchors', 'history', 'bulkRanks')`),
    check('backlink_deep_snapshots_domain_length_check', sql `char_length(${table.domain}) between 1 and 253`),
    check('backlink_deep_snapshots_payload_check', sql `jsonb_typeof(${table.payload}) = 'array' and jsonb_array_length(${table.payload}) <= case when ${table.type} = 'history' then 24 when ${table.type} = 'bulkRanks' then 100 else 500 end`),
    check('backlink_deep_snapshots_retained_count_check', sql `${table.retainedCount} >= 0 and ${table.retainedCount} = jsonb_array_length(${table.payload})`),
]);
export type BacklinkDeepSnapshotRow = typeof backlinkDeepSnapshots.$inferSelect;
export type NewBacklinkDeepSnapshotRow = typeof backlinkDeepSnapshots.$inferInsert;
