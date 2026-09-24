/**
 * Public-API keys (workstream C).
 *
 * One row per issued key. The key itself is NEVER stored — only its sha256
 * hex digest (`key_hash`, unique) plus a display `prefix` so the UI can show
 * "rmf_ab12cd34…" without ever holding the secret again. Relational +
 * uniqueness-constrained lookup table → Postgres via Drizzle (per
 * rules/drizzle-postgres-scope). Revocation is a soft tombstone
 * (`revoked_at`) so the audit trail survives.
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const apiKeys = pgTable('api_keys', {
    id: uuid('id').primaryKey().defaultRandom(),
    // Better Auth user id (ObjectId-compatible hex) — same convention as the
    // other account-scoped Postgres tables (text, not uuid).
    accountId: text('account_id').notNull(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    // Optional per-key MCP permission scopes —
    // `{ tools?, allowedSiteIds?, allowSpend? }`, zod-validated on read by
    // `shared/mcp-permissions` (`parseStoredScopes`; malformed → null =
    // permissive). NULL = unscoped: the key behaves exactly as before the
    // column existed. Scopes only restrict the account defaults, never widen.
    scopes: jsonb('scopes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [index('api_keys_account_idx').on(table.accountId)]);
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;
