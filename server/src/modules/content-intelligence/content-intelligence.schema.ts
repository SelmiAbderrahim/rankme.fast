/**
 * Content Intelligence request schemas.
 *
 * Everything user-supplied passes through these zod schemas BEFORE the
 * ownership check, `assertPublicUrlSafe`, or any Mongo
 * query fires. Per SEC-BOUND every string is length-capped; per SEC-URL
 * the URL string is `safeUrlString` and `assertPublicUrlSafe` runs later;
 * per SEC-INJECT the keyword and locale are the shared bounded primitives
 *. The optional client-supplied idempotency key is
 * server-namespaced by `makeIdempotencyKey` in the service layer — the
 * schema only validates its shape.
 */
import { z } from 'zod';
import { keywordString, localeEnum, safeUrlString, boundedPageLimit, noteString, } from '../../shared/security/index.js';
/** Better Auth id shape (ObjectId-compatible 24-char hex). */
const objectIdHex = z
    .string()
    .regex(/^[0-9a-f]{24}$/, 'validation.issue.invalidString');
/** URL-safe client idempotency key. Length-capped and character-restricted. */
const clientIdempotencyKey = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'validation.issue.invalidString');
export const siteIdParamsSchema = z
    .object({
    siteId: objectIdHex,
})
    .strict();
export const analysisIdParamsSchema = z
    .object({
    analysisId: objectIdHex,
})
    .strict();
/** Optional workspace binding for the legacy analysis-scoped read route. */
export const getAnalysisQuerySchema = z
    .object({
    siteId: objectIdHex.optional(),
})
    .strict();
const recommendationId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'validation.issue.invalidString');
export const recommendationParamsSchema = z
    .object({
    analysisId: objectIdHex,
    recommendationId,
})
    .strict();
const recommendationClientKey = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'validation.issue.invalidString');
const recommendationMutationBase = z.object({
    analysisVersion: z.string().min(1).max(64),
    expectedVersion: z.number().int().min(0),
    clientKey: recommendationClientKey,
    note: noteString.optional(),
});
export const recommendationMutationBodySchema = recommendationMutationBase.strict();
export const applyRecommendationBodySchema = recommendationMutationBase
    .extend({ confirm: z.literal(true) })
    .strict();
/**
 * The core request body. Same shape for `create` and `preflight`; the
 * `regenerate` path derives its own key server-side so it does not accept
 * `clientKey`.
 */
export const createAnalysisBodySchema = z
    .object({
    ownedUrl: safeUrlString,
    keyword: keywordString,
    locale: localeEnum,
    clientKey: clientIdempotencyKey.optional(),
    reviewedPageMatches: z
        .array(z
        .object({
        landscapeReportId: z.string().regex(/^[0-9a-f]{24}$/),
        landscapeOpportunityId: z.string().min(1).max(128).nullable().optional(),
        suggestionId: z.string().min(1).max(128),
    })
        .strict())
        .max(3)
        .default([]),
})
    .strict();
export const preflightAnalysisBodySchema = z
    .object({
    ownedUrl: safeUrlString,
    keyword: keywordString,
    locale: localeEnum,
})
    .strict();
/** Regenerate — no body; the source analysis id supplies keyword/url/locale. */
export const regenerateAnalysisBodySchema = z
    .object({})
    .strict();
export const saveDraftVersionBodySchema = z
    .object({
    markdown: z.string().min(1).max(100000),
    clientKey: clientIdempotencyKey,
})
    .strict();
const briefSectionBodySchema = z
    .object({
    heading: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
})
    .strict();
export const saveBriefVersionBodySchema = z
    .object({
    sections: z.array(briefSectionBodySchema).min(1).max(50),
    clientKey: clientIdempotencyKey,
})
    .strict()
    .superRefine((value, ctx) => {
    const totalCharacters = value.sections.reduce((total, section) => total + section.heading.length + section.body.length, 0);
    if (totalCharacters > 100000) {
        ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            maximum: 100000,
            inclusive: true,
            type: 'string',
            path: ['sections'],
            message: 'validation.custom.briefTooLong',
        });
    }
});
/**
 * Listing query — cursor + limit. Uses the shared bounded pagination limit
 * and the opaque HMAC cursor codec.
 */
export const listAnalysesQuerySchema = z
    .object({
    limit: boundedPageLimit,
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
export type CreateAnalysisBody = z.infer<typeof createAnalysisBodySchema>;
export type PreflightAnalysisBody = z.infer<typeof preflightAnalysisBodySchema>;
export type ListAnalysesQuery = z.infer<typeof listAnalysesQuerySchema>;
