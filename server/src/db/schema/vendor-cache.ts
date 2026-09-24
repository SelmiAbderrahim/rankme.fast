/**
 * Generic vendor data layer — every external signal lands here.
 *
 * `vendor_cache` is the cross-user read-through cache: one row per
 * (capability, operation, cacheKey), upserted on every fresh fetch and
 * served to ANY account whose request normalizes to the same key. TTL is
 * enforced at read time via `expiresAt`; expired rows are overwritten in
 * place, never deleted.
 *
 * `vendor_responses` is the append-only archive of NORMALIZED provider
 * output (the shape modules consume, never raw vendor JSON). Kept forever —
 * retention/pruning is a deliberate non-goal. Private capabilities
 * (`gsc`, `summary`, `audit`) set `accountId` and are NEVER served
 * cross-user; public-domain capabilities keep it null.
 *
 * Payloads are jsonb of provider-normalized shapes (same precedent as the
 * former `serp_cache.top_results`); readers zod-parse on the way out and
 * treat a parse failure as a cache miss.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
/** Mirrors the provider registry's capability slots. */
export const VENDOR_CAPABILITIES = [
    'audit',
    'rank',
    'keyword',
    'backlink',
    'competitor',
    'pagespeed',
    'gsc',
    'ga4',
    'summary',
    'ai-visibility',
    'local-listings',
    'content-analysis',
    'app-data',
] as const;
export type VendorCapability = (typeof VENDOR_CAPABILITIES)[number];
export const vendorCache = pgTable('vendor_cache', {
    id: uuid('id').primaryKey().defaultRandom(),
    capability: text('capability').notNull(),
    operation: text('operation').notNull(),
    cacheKey: text('cache_key').notNull(),
    // Nullable owner scope for private-intent public facts such as competitor
    // landscape target pairs. Existing globally shared cache rows remain null.
    accountId: text('account_id'),
    siteId: text('site_id'),
    // The normalized request inputs the key was derived from — kept for
    // debuggability and margin analytics, never re-hashed on read.
    params: jsonb('params').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('vendor_cache_cap_op_key_idx').on(table.capability, table.operation, table.cacheKey),
    index('vendor_cache_expires_at_idx').on(table.expiresAt),
    index('vendor_cache_account_site_idx').on(table.accountId, table.siteId),
]);
export type VendorCacheRow = typeof vendorCache.$inferSelect;
export type NewVendorCacheRow = typeof vendorCache.$inferInsert;
// ponytail: append-only table; partition by fetched_at if it approaches 50 GB.
export const vendorResponses = pgTable('vendor_responses', {
    id: uuid('id').primaryKey().defaultRandom(),
    capability: text('capability').notNull(),
    operation: text('operation').notNull(),
    cacheKey: text('cache_key').notNull(),
    params: jsonb('params').notNull(),
    payload: jsonb('payload').notNull(),
    // Better Auth id (ObjectId hex string) for private capabilities;
    // null on shared public-domain data. String only — no SQL FK across
    // the Mongo/Postgres boundary.
    accountId: text('account_id'),
    // Nullable site scope lets lifecycle purge comparison archives without
    // scanning normalized JSON. Existing archive rows remain null.
    siteId: text('site_id'),
    // Vendor-reported spend for the provider-method invocation that produced
    // this row, in micro-dollars ($1 = 1_000_000). Null = no actual cost
    // known (pre-existing rows, fakes, vendors that don't report cost) —
    // readers fall back to the worst-case estimate model.
    costMicros: bigint('cost_micros', { mode: 'bigint' }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index('vendor_responses_cap_fetched_idx').on(table.capability, table.fetchedAt),
    index('vendor_responses_cache_key_idx').on(table.cacheKey),
    index('vendor_responses_account_fetched_idx').on(table.accountId, table.fetchedAt),
    index('vendor_responses_site_fetched_idx').on(table.siteId, table.fetchedAt),
]);
export type VendorResponseRow = typeof vendorResponses.$inferSelect;
export type NewVendorResponseRow = typeof vendorResponses.$inferInsert;
