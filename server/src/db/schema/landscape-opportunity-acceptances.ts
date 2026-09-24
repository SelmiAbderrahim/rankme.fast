import { index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
/** Mutable decision overlay; the Mongo landscape snapshot remains immutable. */
export const landscapeOpportunityAcceptances = pgTable('landscape_opportunity_acceptances', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    reportId: text('report_id').notNull(),
    opportunityId: text('opportunity_id').notNull(),
    actionId: text('action_id').notNull(),
    acceptedByUserId: text('accepted_by_user_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('landscape_acceptance_opportunity_uq').on(table.accountId, table.reportId, table.opportunityId),
    uniqueIndex('landscape_acceptance_idempotency_uq').on(table.accountId, table.idempotencyKey),
    index('landscape_acceptance_site_idx').on(table.accountId, table.siteId, table.acceptedAt),
    index('landscape_acceptance_action_idx').on(table.accountId, table.actionId),
]);
export type LandscapeOpportunityAcceptanceRow = typeof landscapeOpportunityAcceptances.$inferSelect;
export type NewLandscapeOpportunityAcceptanceRow = typeof landscapeOpportunityAcceptances.$inferInsert;
