import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { LANDSCAPE_MAX_COMPETITORS, LANDSCAPE_CLASSES, LANDSCAPE_STATES, } from './landscape/landscape.schemas.js';
const objectId = z.string().regex(/^[0-9a-f]{24}$/);
const profileId = z.string().uuid();
const visibleAsciiKey = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[\x21-\x7e]+$/);
export const competitorIntelligenceSiteParamsSchema = z
    .object({ siteId: objectId })
    .strict();
export const competitorProfileParamsSchema = z
    .object({ siteId: objectId, competitorId: profileId })
    .strict();
export const landscapeRunParamsSchema = z
    .object({ siteId: objectId, runId: objectId })
    .strict();
export const landscapeOpportunityParamsSchema = z
    .object({
    siteId: objectId,
    runId: objectId,
    opportunityId: z.string().min(1).max(128),
})
    .strict();
export const landscapePageMatchParamsSchema = z
    .object({
    siteId: objectId,
    runId: objectId,
    suggestionId: z.string().min(1).max(128),
})
    .strict();
export const landscapePageMatchReviewBodySchema = z
    .object({
    decision: z.enum(['approved', 'rejected']),
    ownedUrl: z.string().trim().min(1).max(2048).url().nullable(),
    competitorUrl: z.string().trim().min(1).max(2048).url().nullable(),
    version: z.number().int().min(0),
})
    .strict()
    .superRefine((value, context) => {
    const approved = value.decision === 'approved';
    if (approved !== (value.ownedUrl !== null && value.competitorUrl !== null)) {
        context.addIssue({
            code: 'custom',
            path: ['decision'],
            message: 'validation.issue.custom',
        });
    }
});
export const idempotencyHeadersSchema = z
    .object({ 'idempotency-key': visibleAsciiKey })
    .strict();
export const emptyMutationBodySchema = z.object({}).strict();
export const emptyQuerySchema = z.object({}).strict();
export const competitorPortfolioQuerySchema = z
    .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
    .strict();
export const addCompetitorProfileBodySchema = z
    .object({
    url: z.string().trim().min(1).max(2048).url(),
    source: z.enum(['suggested', 'manual']).default('manual'),
})
    .strict();
export const landscapePreviewBodySchema = z
    .object({
    competitorProfileIds: z
        .array(profileId)
        .min(1)
        .max(LANDSCAPE_MAX_COMPETITORS)
        .refine((ids) => new Set(ids).size === ids.length),
})
    .strict();
export const landscapeStartBodySchema = landscapePreviewBodySchema
    .extend({ locale: z.enum(SUPPORTED_LOCALES) })
    .strict();
export const landscapeListQuerySchema = z
    .object({
    state: z.enum(LANDSCAPE_STATES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
export const landscapeDetailQuerySchema = z
    .object({
    class: z.enum(LANDSCAPE_CLASSES).optional(),
    competitor: z.string().trim().min(1).max(253).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
export type LandscapeDetailQuery = z.infer<typeof landscapeDetailQuerySchema>;
