import { z } from 'zod';
/** Required GSC scope — least-privilege sufficient for URL Inspection + sites list. */
export const SCOPE_GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
/**
 * GA4 scope — read-only Analytics Data + Admin (account summaries). Granted
 * incrementally via a second `linkSocial` on the SAME Google account; the
 * connection's `scopes[]` unions grants across links.
 */
export const SCOPE_GA4 = 'https://www.googleapis.com/auth/analytics.readonly';
/**
 * Body accepted by `POST /api/sites/:siteId/google/connect/complete`.
 *
 * In the real OAuth flow the client sends placeholder values; the server
 * resolves the refresh token + account email from the Better Auth `account`
 * row (provider `google`) so the plaintext token never transits the browser.
 * The fields stay accepted (and validated when non-empty) so test mode and an
 * explicitly selected fake GSC provider can exercise connect → sync end to
 * end without seeding a Better Auth account row. Live-provider deployments
 * ignore them and resolve the server-owned Better Auth row instead.
 */
export const completeConnectionSchema = z.object({
    refreshToken: z.preprocess((v) => (typeof v === 'string' && v === '' ? undefined : v), z.string().min(1).optional()),
    googleAccountEmail: z.preprocess((v) => (typeof v === 'string' && v === '' ? undefined : v), z.string().email().optional()),
    scopes: z.array(z.string()).default([]),
});
export type CompleteConnectionInput = z.infer<typeof completeConnectionSchema>;
export const siteGoogleParamsSchema = z.object({
    siteId: z.string().regex(/^[0-9a-f]{24}$/i, 'validation.issue.invalidString'),
});
/**
 * Body accepted by `PATCH /api/sites/:siteId/google/bindings` — set the chosen
 * Search Console property and/or GA4 property on a Site. Server-side
 * validation confirms each value is one of the account's live properties.
 * At least one of the two fields must be present.
 */
export const setSiteBindingsSchema = z
    .object({
    gscPropertyUrl: z.string().min(1).nullable().optional(),
    ga4PropertyId: z
        .string()
        .regex(/^properties\/\d+$/, 'validation.issue.invalidString')
        .nullable()
        .optional(),
})
    .refine((value) => value.gscPropertyUrl !== undefined || value.ga4PropertyId !== undefined, { message: 'validation.custom.analyticsPropertyRequired' });
export type SetSiteBindingsInput = z.infer<typeof setSiteBindingsSchema>;
export const revokeGoogleCredentialSchema = z.object({
    acknowledgeAllSites: z.literal(true),
});
/**
 * The `?range=` options shared by every windowed Google data read. Maps to
 * the `window_days` column (7 | 28 | 90); default stays the historical 28.
 */
export const RANGE_VALUES = ['7d', '28d', '90d'] as const;
export type RangeValue = (typeof RANGE_VALUES)[number];
/**
 * Query accepted by `GET /api/sites/:siteId/google/search-summary`.
 * The Site identifier is validated separately from the path params.
 */
export const searchSummaryQuerySchema = z.object({
    range: z.enum(RANGE_VALUES).default('28d'),
});
export type SearchSummaryQuery = z.infer<typeof searchSummaryQuerySchema>;
/**
 * Body accepted by `POST /api/sites/:siteId/google/search-refresh`.
 * Re-syncs the Site's Search Analytics snapshot on demand (free Google quota)
 * and returns the same summary shape as the GET.
 */
export const searchRefreshSchema = z.object({
    range: z.enum(['7d', '28d', '90d']).default('28d'),
});
export type SearchRefreshInput = z.infer<typeof searchRefreshSchema>;
/**
 * Dimension sets exposed by the drill-in endpoint. The `date` set backs the
 * summary chart, not a table, so it is not requestable here.
 */
export const GSC_DETAIL_DIMENSIONS = [
    'query',
    'page',
    'country',
    'device',
] as const;
export type GscDetailDimension = (typeof GSC_DETAIL_DIMENSIONS)[number];
/**
 * Query accepted by `GET /api/sites/:siteId/google/search-analytics` — the
 * full latest snapshot for one dimension set (rows are hard-capped at 1000 by
 * the sync, so no server-side pagination; the client filters/sorts locally).
 */
export const searchAnalyticsQuerySchema = z.object({
    dimension: z.enum(GSC_DETAIL_DIMENSIONS),
    range: z.enum(RANGE_VALUES).default('28d'),
});
export type SearchAnalyticsQuery = z.infer<typeof searchAnalyticsQuerySchema>;
/** Query accepted by `GET /api/sites/:siteId/google/sitemaps`. */
export const sitemapsQuerySchema = z.object({});
export type SitemapsQuery = z.infer<typeof sitemapsQuerySchema>;
/**
 * Query accepted by `GET /api/sites/:siteId/google/generative-appearance`
 *. Reads persisted snapshots only — never calls the vendor.
 */
export const generativeAppearanceQuerySchema = z.object({});
export type GenerativeAppearanceQuery = z.infer<typeof generativeAppearanceQuerySchema>;
/** GA4 aggregate dimensions exposed by the analytics drill-in endpoint. */
export const GA4_DETAIL_DIMENSIONS = [
    'channel',
    'page',
    'country',
    'device',
] as const;
export type Ga4DetailDimension = (typeof GA4_DETAIL_DIMENSIONS)[number];
/** Query accepted by `GET /api/sites/:siteId/google/analytics-summary` (Pro+). */
export const analyticsSummaryQuerySchema = z.object({
    range: z.enum(RANGE_VALUES).default('28d'),
});
export type AnalyticsSummaryQuery = z.infer<typeof analyticsSummaryQuerySchema>;
/** Query accepted by `GET /api/sites/:siteId/google/analytics-detail` (Pro+). */
export const analyticsDetailQuerySchema = z.object({
    dimension: z.enum(GA4_DETAIL_DIMENSIONS),
    range: z.enum(RANGE_VALUES).default('28d'),
});
export type AnalyticsDetailQuery = z.infer<typeof analyticsDetailQuerySchema>;
/** Body accepted by `POST /api/sites/:siteId/google/analytics-refresh` (Pro+). */
export const analyticsRefreshSchema = z.object({
    range: z.enum(RANGE_VALUES).default('28d'),
});
export type AnalyticsRefreshInput = z.infer<typeof analyticsRefreshSchema>;
