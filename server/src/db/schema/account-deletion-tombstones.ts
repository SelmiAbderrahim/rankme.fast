import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
/**
 * Permanent, non-personal account deletion barrier. The internal account id is
 * retained solely to reject late webhook/worker writes after identity removal.
 */
export const accountDeletionTombstones = pgTable('account_deletion_tombstones', {
    accountId: text('account_id').primaryKey(),
    deletionStartedAt: timestamp('deletion_started_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});
export type AccountDeletionTombstone = typeof accountDeletionTombstones.$inferSelect;
export type NewAccountDeletionTombstone = typeof accountDeletionTombstones.$inferInsert;
/**
 * One-way provider identifiers retained after purge. Webhook ingest hashes an
 * incoming Polar customer/subscription/order id and can therefore recognize a
 * deleted principal without retaining the remote identifier itself.
 */
export const accountDeletionProviderRefs = pgTable('account_deletion_provider_refs', {
    providerRefHash: text('provider_ref_hash').primaryKey(),
    accountId: text('account_id').notNull(),
    provider: text('provider').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('account_deletion_provider_refs_account_idx').on(table.accountId)]);
export type AccountDeletionProviderRef = typeof accountDeletionProviderRefs.$inferSelect;
export type NewAccountDeletionProviderRef = typeof accountDeletionProviderRefs.$inferInsert;
