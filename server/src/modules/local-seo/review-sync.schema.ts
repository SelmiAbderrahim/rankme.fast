/**
 * Review Intelligence request schemas.
 *
 * Every `target` is bounded per source before it can reach the vendor
 * adapter — the adapter also bounds length and rejects control characters,
 * but a request that cannot possibly identify a business must never consume
 * the account's rate bucket allowance or reach the queue.
 */
import { z } from 'zod';
import { validateSiteUrl } from '../../shared/validation/site-url.js';
import { REVIEW_SOURCES, REVIEW_SYNC_MAX_DEPTH } from './review-sync.model.js';
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'reviewIntelligence.errors.notFound');
export const reviewSourceEnumSchema = z.enum(REVIEW_SOURCES);
const INVALID_TARGET_KEY = 'reviewIntelligence.errors.invalidTarget';
function isOpaqueTargetToken(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x20 || code === 0x7f)
            return false;
    }
    return true;
}
/**
 * Google Place/CID and Tripadvisor location identifiers are opaque provider
 * tokens. Their punctuation is deliberately not constrained, so
 * this module only applies the shared provider bound and rejects ASCII
 * controls/whitespace. Prefix forms such as `place_id:` / `location_id:` are
 * therefore valid without opening an unbounded input path.
 */
const opaqueReviewTargetSchema = z
    .string()
    .trim()
    .min(1, INVALID_TARGET_KEY)
    .max(200, INVALID_TARGET_KEY)
    .refine(isOpaqueTargetToken, INVALID_TARGET_KEY);
/**
 * Trustpilot business identifier — the reviewed business DOMAIN, which is
 * what the Business Data endpoint keys on. Normalized through the shipped
 * site-URL validator so `WWW.Example.COM` and `example.com` are one target.
 */
const trustpilotTargetSchema = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform((raw, context) => {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_TARGET_KEY });
        return z.NEVER;
    }
    const parsed = validateSiteUrl(`https://${raw}`);
    if (!parsed.ok || parsed.domain.length > 200) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_TARGET_KEY });
        return z.NEVER;
    }
    return parsed.domain.toLowerCase().replace(/^www\./, '');
});
/** Per-source target validation — the discriminant decides the shape. */
export const createReviewSourceSchema = z
    .discriminatedUnion('source', [
    z
        .object({
        profileId: objectIdHexSchema,
        source: z.literal('google'),
        target: opaqueReviewTargetSchema,
    })
        .strict(),
    z
        .object({ profileId: objectIdHexSchema, source: z.literal('trustpilot'), target: trustpilotTargetSchema })
        .strict(),
    z
        .object({ profileId: objectIdHexSchema, source: z.literal('tripadvisor'), target: opaqueReviewTargetSchema })
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
