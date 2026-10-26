/**
 * Review Intelligence request schemas.
 *
 * Every `target` is bounded per source before it can reach the vendor
 * adapter — the adapter also bounds length and rejects control characters,
 * but a request that cannot possibly identify a business must never consume
 * the account's rate bucket allowance or reach the queue.
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { REVIEW_SOURCES, REVIEW_SYNC_MAX_DEPTH, REVIEW_TARGET_MAX_CHARS, type ReviewSourceName, } from './review-sync.model.js';
import { normalizeReviewTarget } from './review-sync.targets.js';
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'reviewIntelligence.errors.notFound');
export const reviewSourceEnumSchema = z.enum(REVIEW_SOURCES);
const INVALID_TARGET_KEY = 'reviewIntelligence.errors.invalidTarget';
/**
 * Each source has its own target rule (see `review-sync.targets.ts`): a
 * Google Place ID heuristic, a numeric Tripadvisor location id, and a
 * Trustpilot business domain. The raw string is bounded and trimmed first so
 * an impossible value never reaches the rate bucket or the vendor adapter.
 */
function reviewTargetSchema(source: ReviewSourceName) {
    return z
        .string()
        .trim()
        .min(1, INVALID_TARGET_KEY)
        .max(REVIEW_TARGET_MAX_CHARS, INVALID_TARGET_KEY)
        .transform((raw, context) => {
        const target = normalizeReviewTarget(source, raw, {
            allowFakeScenarios: env.PROVIDER_REVIEWS === 'fake',
        });
        if (target === null) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_TARGET_KEY });
            return z.NEVER;
        }
        return target;
    });
}
/** Per-source target validation — the discriminant decides the shape. */
export const createReviewSourceSchema = z
    .discriminatedUnion('source', [
    z
        .object({
        profileId: objectIdHexSchema,
        source: z.literal('google'),
        target: reviewTargetSchema('google'),
    })
        .strict(),
    z
        .object({ profileId: objectIdHexSchema, source: z.literal('trustpilot'), target: reviewTargetSchema('trustpilot') })
        .strict(),
    z
        .object({ profileId: objectIdHexSchema, source: z.literal('tripadvisor'), target: reviewTargetSchema('tripadvisor') })
        .strict(),
]);
export type CreateReviewSourceInput = z.infer<typeof createReviewSourceSchema>;
export const reviewSourceParamsSchema = z.object({ id: objectIdHexSchema }).strict();
export const reviewRunParamsSchema = z.object({ id: objectIdHexSchema }).strict();
export const reviewSourceListQuerySchema = z
    .object({ profileId: objectIdHexSchema })
    .strict();
const requestedSourcesSchema = z
    .array(reviewSourceEnumSchema)
    .min(1)
    .max(REVIEW_SOURCES.length)
    .superRefine((sources, context) => {
    if (new Set(sources).size !== sources.length) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reviewIntelligence.errors.duplicateSource',
        });
    }
});
export const reviewPreviewSchema = z
    .object({ profileId: objectIdHexSchema, sources: requestedSourcesSchema })
    .strict();
export type ReviewPreviewInput = z.infer<typeof reviewPreviewSchema>;
export const reviewSyncSchema = z
    .object({
    profileId: objectIdHexSchema,
    sources: requestedSourcesSchema,
    depth: z.coerce.number().int().min(1).max(REVIEW_SYNC_MAX_DEPTH).default(REVIEW_SYNC_MAX_DEPTH),
})
    .strict();
export type ReviewSyncInput = z.infer<typeof reviewSyncSchema>;
export const reviewRunListQuerySchema = z
    .object({
    profileId: objectIdHexSchema,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(500).optional(),
})
    .strict();
export type ReviewRunListQuery = z.infer<typeof reviewRunListQuerySchema>;
export const REVIEW_INVENTORY_SORTS = ['newest', 'rating-high', 'source'] as const;
const reviewInventoryFilterShape = {
    profileId: objectIdHexSchema,
    src: reviewSourceEnumSchema.optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.enum(REVIEW_INVENTORY_SORTS).default('newest'),
};
export const reviewInventoryQuerySchema = z
    .object({
    ...reviewInventoryFilterShape,
    page: z.coerce.number().int().min(1).max(1000).default(1),
})
    .strict();
export type ReviewInventoryQuery = z.infer<typeof reviewInventoryQuerySchema>;
/** Free stored-data export: identical filters/sort, deliberately no page. */
export const reviewInventoryExportQuerySchema = z
    .object(reviewInventoryFilterShape)
    .strict();
export type ReviewInventoryExportQuery = z.infer<typeof reviewInventoryExportQuerySchema>;
