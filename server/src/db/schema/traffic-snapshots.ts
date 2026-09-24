import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { observationMetaSchema } from '../../shared/observations/observations.js';
export const TRAFFIC_SNAPSHOT_MAX_COUNTRIES = 10;
export const TRAFFIC_SNAPSHOT_MAX_HISTORY_MONTHS = 24;
const estimatedIntegerSchema = z
    .object({
    value: z.number().int().nonnegative(),
    observation: observationMetaSchema.refine((meta) => meta.sourceKind === 'estimate', 'traffic snapshot values must be labelled as estimates'),
})
    .strict();
const estimatedNullableIntegerSchema = z
    .object({
    value: z.number().int().nonnegative().nullable(),
    observation: observationMetaSchema.refine((meta) => meta.sourceKind === 'estimate', 'traffic snapshot values must be labelled as estimates'),
})
    .strict();
export const trafficSnapshotPayloadSchema = z
    .object({
    monthlyOrganicVisits: estimatedIntegerSchema,
    topCountries: z
        .array(z
        .object({
        countryCode: z.string().regex(/^[A-Z]{2}$/),
        visits: estimatedIntegerSchema,
    })
        .strict())
        .max(TRAFFIC_SNAPSHOT_MAX_COUNTRIES),
    domainRank: estimatedNullableIntegerSchema,
    keywordCount: estimatedNullableIntegerSchema,
    history: z
        .array(z
        .object({
        capturedAt: z.string().datetime({ offset: true }),
        rank: estimatedNullableIntegerSchema,
        traffic: estimatedIntegerSchema,
        keywordCount: estimatedIntegerSchema,
    })
        .strict())
        .max(TRAFFIC_SNAPSHOT_MAX_HISTORY_MONTHS),
    retained: z
        .object({
        traffic: z.boolean(),
        rankOverview: z.boolean(),
        history: z.boolean(),
    })
        .strict(),
})
    .strict();
export type TrafficSnapshotPayload = z.infer<typeof trafficSnapshotPayloadSchema>;
export function parseTrafficSnapshotPayload(payload: unknown): TrafficSnapshotPayload {
    return trafficSnapshotPayloadSchema.parse(payload);
}
/** Append-only normalized result for one Traffic Insights run. */
export const trafficSnapshots = pgTable('traffic_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    runId: text('run_id').notNull(),
    siteId: text('site_id'),
    targetDomain: text('target_domain').notNull(),
    payload: jsonb('payload').$type<TrafficSnapshotPayload>().notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
}, (table) => [
    uniqueIndex('traffic_snapshots_account_run_uq').on(table.accountId, table.runId),
    index('traffic_snapshots_account_domain_captured_idx').on(table.accountId, table.targetDomain, table.capturedAt),
    check('traffic_snapshots_domain_length_check', sql `char_length(${table.targetDomain}) between 1 and 253`),
    check('traffic_snapshots_payload_object_check', sql `jsonb_typeof(${table.payload}) = 'object'`),
]);
export type TrafficSnapshotRow = typeof trafficSnapshots.$inferSelect;
export type NewTrafficSnapshotRow = typeof trafficSnapshots.$inferInsert;
