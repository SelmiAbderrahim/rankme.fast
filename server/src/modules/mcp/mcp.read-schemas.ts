import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { PAGES_INSIGHTS, PAGES_SORTS } from '../pages/pages.schema.js';
import { MCP_PAGE_LIMIT_DEFAULT, MCP_PAGE_LIMIT_MAX } from './mcp.schema.js';

/**
 * Bounded input shapes for the stored-data READ tools.
 * Every tool here is read-only, zero-spend, and strict (unknown keys 400).
 *
 * Group owners may tighten their own entries (add filters, narrow ids) but must
 * keep `siteId` required on site-scoped tools and `locale` optional on all.
 */

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/i, {
  message: 'errors.validationFailed',
});
const localeSchema = z.enum(SUPPORTED_LOCALES).optional();
const cursorSchema = z.string().min(1).max(1024).optional();
const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MCP_PAGE_LIMIT_MAX)
  .optional();

/** Search Console / GA4 windows — identical to the Google tab's range picker. */
export const READ_RANGES = ['7d', '28d', '90d'] as const;
export type ReadRange = (typeof READ_RANGES)[number];
export const READ_RANGE_DEFAULT: ReadRange = '28d';
const rangeSchema = z.enum(READ_RANGES).optional();

export { MCP_PAGE_LIMIT_DEFAULT };

export const getGscSearchSummaryInputSchema = z
  .object({ siteId: objectIdHex, range: rangeSchema, locale: localeSchema })
  .strict();

export const listGscTopQueriesInputSchema = z
  .object({
    siteId: objectIdHex,
    range: rangeSchema,
    limit: limitSchema,
    locale: localeSchema,
  })
  .strict();

export const listGscTopPagesInputSchema = z
  .object({
    siteId: objectIdHex,
    range: rangeSchema,
    limit: limitSchema,
    locale: localeSchema,
  })
  .strict();

export const getGa4SummaryInputSchema = z
  .object({ siteId: objectIdHex, range: rangeSchema, locale: localeSchema })
  .strict();

/**
 * Pages list/detail mirror the Pages API: the same range/filter/sort enums and
 * the same page-size triple (25, 50, 100) so cursors stay valid across calls.
 */
const PAGES_TOOL_RANGES = ['7d', '28d', '90d'] as const;
const PAGES_TOOL_LIMITS = [25, 50, 100] as const;

export const listPagesInputSchema = z
  .object({
    siteId: objectIdHex,
    range: z.enum(PAGES_TOOL_RANGES).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    insight: z.enum(PAGES_INSIGHTS).optional(),
    indexability: z.enum(['indexable', 'non_indexable']).optional(),
    visibility: z.enum(['measured', 'unmeasured']).optional(),
    sort: z.enum(PAGES_SORTS).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce
      .number()
      .int()
      .refine((value) => (PAGES_TOOL_LIMITS as readonly number[]).includes(value), {
        message: 'errors.validationFailed',
      })
      .optional(),
    cursor: cursorSchema,
    locale: localeSchema,
  })
  .strict();

export const getPageDetailInputSchema = z
  .object({
    siteId: objectIdHex,
    // Accepts the `pageId` exactly as `list_pages` returned it (`page:` + the
    // 43-char URL hash) or the bare hash.
    pageId: z.string().regex(/^(?:page:)?[A-Za-z0-9_-]{43}$/, { message: 'errors.validationFailed' }),
    range: z.enum(PAGES_TOOL_RANGES).optional(),
    locale: localeSchema,
  })
  .strict();

export const getBacklinksSummaryInputSchema = z
  .object({ siteId: objectIdHex, locale: localeSchema })
  .strict();

// No `cursor`: paging past the stored first page is a metered vendor pull
// (`backlink_rows`), which a read tool must never trigger.
export const listBacklinksInputSchema = z
  .object({
    siteId: objectIdHex,
    limit: limitSchema,
    locale: localeSchema,
  })
  .strict();

export const listCompetitorsInputSchema = z
  .object({
    siteId: objectIdHex,
    status: z.enum(['active', 'archived', 'all']).optional(),
    locale: localeSchema,
  })
  .strict();

export const getAiVisibilitySummaryInputSchema = z
  .object({ siteId: objectIdHex, locale: localeSchema })
  .strict();

export const getLocalSeoSummaryInputSchema = z
  .object({ siteId: objectIdHex, locale: localeSchema })
  .strict();

export const getReviewsSummaryInputSchema = z
  .object({ siteId: objectIdHex, locale: localeSchema })
  .strict();

export const listClientReportsInputSchema = z
  .object({ siteId: objectIdHex, locale: localeSchema })
  .strict();

export type GetGscSearchSummaryInput = z.infer<typeof getGscSearchSummaryInputSchema>;
export type ListGscTopQueriesInput = z.infer<typeof listGscTopQueriesInputSchema>;
export type ListGscTopPagesInput = z.infer<typeof listGscTopPagesInputSchema>;
export type GetGa4SummaryInput = z.infer<typeof getGa4SummaryInputSchema>;
export type ListPagesInput = z.infer<typeof listPagesInputSchema>;
export type GetPageDetailInput = z.infer<typeof getPageDetailInputSchema>;
export type GetBacklinksSummaryInput = z.infer<typeof getBacklinksSummaryInputSchema>;
export type ListBacklinksInput = z.infer<typeof listBacklinksInputSchema>;
export type ListCompetitorsInput = z.infer<typeof listCompetitorsInputSchema>;
export type GetAiVisibilitySummaryInput = z.infer<typeof getAiVisibilitySummaryInputSchema>;
export type GetLocalSeoSummaryInput = z.infer<typeof getLocalSeoSummaryInputSchema>;
export type GetReviewsSummaryInput = z.infer<typeof getReviewsSummaryInputSchema>;
export type ListClientReportsInput = z.infer<typeof listClientReportsInputSchema>;
