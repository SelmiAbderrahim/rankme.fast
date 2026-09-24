/**
 * Superadmin-controlled kill switches.
 *
 * One row per known feature flag. The set of KEYS is a closed allowlist
 * declared in code (`FEATURE_FLAG_KEYS`) — a superadmin can only pause /
 * resume a switch that already exists here, never invent a new one from the
 * UI. This is a control-plane surface, not a customer-facing toggle.
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const FEATURE_FLAG_KEYS = [
    'content_intelligence_pipeline',
    'firecrawl_change_monitoring',
    'ai_recommendations',
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export const featureFlags = pgTable('feature_flags', {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by'),
});
export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type NewFeatureFlagRow = typeof featureFlags.$inferInsert;
