import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { BACKLINK_DEEP_ROW_LIMIT, LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH, } from './backlink-deep-snapshots.js';
const gapDomainSchema = z
    .string()
    .trim()
    .min(1)
    .max(LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH);
export const linkGapSnapshotPayloadSchema = z
    .array(z
    .object({
    domain: gapDomainSchema,
    intersections: z.number().int().nonnegative().finite(),
    rank: z.number().int().min(0).max(100).nullable(),
    // The authoritative competitors operation does not always expose a
    // first-seen timestamp. Keep the field explicit and nullable so
    // stored reads and the client table never invent recency.
    firstSeen: z
        .string()
        .datetime({ offset: true })
        .nullable()
        .default(null),
})
    .strict())
    .max(BACKLINK_DEEP_ROW_LIMIT);
export type LinkGapSnapshotPayload = z.infer<typeof linkGapSnapshotPayloadSchema>;
/** Parse every gap jsonb read before returning normalized provider rows. */
export function parseLinkGapSnapshotPayload(payload: unknown): LinkGapSnapshotPayload {
    return linkGapSnapshotPayloadSchema.parse(payload);
}
/** One append-only bounded result row per settled competitor leg. */
export const linkGapSnapshots = pgTable('link_gap_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runId: text('run_id').notNull(),
    ownDomain: text('own_domain').notNull(),
    competitor: text('competitor').notNull(),
    payload: jsonb('payload').$type<LinkGapSnapshotPayload>().notNull(),
    retainedCount: integer('retained_count').notNull(),
    retainedAt: timestamp('retained_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('link_gap_snapshots_account_run_competitor_uq').on(table.accountId, table.runId, table.competitor),
    index('link_gap_snapshots_site_retained_idx').on(table.accountId, table.siteId, table.retainedAt),
    check('link_gap_snapshots_domain_length_check', sql `char_length(${table.ownDomain}) between 1 and 253 and char_length(${table.competitor}) between 1 and 253`),
    check('link_gap_snapshots_payload_check', sql `jsonb_typeof(${table.payload}) = 'array' and jsonb_array_length(${table.payload}) <= 500`),
    check('link_gap_snapshots_retained_count_check', sql `${table.retainedCount} >= 0 and ${table.retainedCount} = jsonb_array_length(${table.payload})`),
]);
export type LinkGapSnapshotRow = typeof linkGapSnapshots.$inferSelect;
export type NewLinkGapSnapshotRow = typeof linkGapSnapshots.$inferInsert;
