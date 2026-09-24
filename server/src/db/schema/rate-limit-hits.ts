/**
 * Rate-limit metrics sink.
 *
 * One row per 429 emitted by `rateLimitHandler`. Relational, ordered time
 * series → Postgres via Drizzle (per rules/drizzle-postgres-scope). Aggregated
 * per route over a rolling window on the admin overview so operators can spot
 * rate-limit pressure. Fire-and-forget from the middleware — a metrics-write
 * failure must never mask the 429 or throw into the request.
 *
 * PII policy — only the request-source ip is stored (already logged elsewhere
 * for pino-http request logs); `accountId` is stored only when the request
 * carried an authenticated session. No email, no path, no headers.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const RATE_LIMIT_ROUTES = [
    'auth',
    'webhook',
    'api',
    'content_intelligence_create',
    'content_intelligence_poll',
    'content_recommendation_state',
    'inventory_start',
    'competitor_manage',
    'link_intel',
    'review_sync',
    'brand_radar_create',
    'brand_radar_poll',
    'firecrawl_webhook',
    'mcp',
    'report_exports_create',
    'report_exports_manage',
    'report_exports_download',
    // AI Assistant chat bucket. Plain-text route
    // column — no CHECK constraint, so extending the union needs no migration.
    'chat',
    'superadmin_ops',
] as const;
export type RateLimitRoute = (typeof RATE_LIMIT_ROUTES)[number];
export const rateLimitHits = pgTable('rate_limit_hits', {
    id: uuid('id').primaryKey().defaultRandom(),
    route: text('route').notNull(),
    hitAt: timestamp('hit_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    // Always null on the current rate-limit surface:
    // every limiter that inserts here fires BEFORE session resolution (auth,
    // webhook HMAC verify, public /api/v1 bearer). Kept in the schema as an
    // operator hook for a future post-auth limiter that wants per-account
    // attribution; the daily prune sweep still trims by `hit_at`.
    accountId: text('account_id'),
}, (table) => [
    index('rate_limit_hits_route_hit_at_idx').on(table.route, table.hitAt),
]);
export type RateLimitHitRow = typeof rateLimitHits.$inferSelect;
export type NewRateLimitHitRow = typeof rateLimitHits.$inferInsert;
