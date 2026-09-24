import { z } from 'zod';
export const PAGES_RANGES = ['7d', '28d', '90d'] as const;
export const PAGES_INSIGHTS = [
    'striking_distance',
    'low_ctr',
    'declining',
    'winning',
    'non_indexable_visibility',
    'unmeasured',
] as const;
export const PAGES_SORTS = [
    'opportunity',
    'url',
    'title',
    'clicks',
    'impressions',
    'ctr',
    'average_position',
    'best_position',
    'keyword_count',
    'search_volume',
    'difficulty',
    'estimated_traffic',
    'position_change',
    'click_change_pct',
] as const;
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/u);
export const pagesSiteParamsSchema = z.object({ siteId: objectId }).strict();
export const pagesDetailParamsSchema = z
    .object({
    siteId: objectId,
    pageId: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
})
    .strict();
const rangeSchema = z.enum(PAGES_RANGES).default('28d');
export const pagesListQuerySchema = z
    .object({
    range: rangeSchema,
    q: z.string().trim().min(1).max(200).optional(),
    insight: z.enum(PAGES_INSIGHTS).optional(),
    indexability: z.enum(['indexable', 'non_indexable']).optional(),
    visibility: z.enum(['measured', 'unmeasured']).optional(),
    sort: z.enum(PAGES_SORTS).default('opportunity'),
    direction: z.enum(['asc', 'desc']).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z
        .union([z.literal('25'), z.literal('50'), z.literal('100'), z.literal(25), z.literal(50), z.literal(100)])
        .transform(Number)
        .default(25),
})
    .strict();
export const pagesDetailQuerySchema = z.object({ range: rangeSchema }).strict();
export const pagesRefreshBodySchema = z.object({}).strict().default({});
export type PagesRange = (typeof PAGES_RANGES)[number];
export type PagesInsight = (typeof PAGES_INSIGHTS)[number];
export type PagesSort = (typeof PAGES_SORTS)[number];
export type PagesListQuery = z.infer<typeof pagesListQuerySchema>;
export type PagesDetailQuery = z.infer<typeof pagesDetailQuerySchema>;
export const DEFAULT_PAGES_DIRECTIONS: Record<PagesSort, 'asc' | 'desc'> = {
    opportunity: 'desc',
    url: 'asc',
    title: 'asc',
    clicks: 'desc',
    impressions: 'desc',
    ctr: 'desc',
    average_position: 'asc',
    best_position: 'asc',
    keyword_count: 'desc',
    search_volume: 'desc',
    difficulty: 'asc',
    estimated_traffic: 'desc',
    position_change: 'desc',
    click_change_pct: 'desc',
};
