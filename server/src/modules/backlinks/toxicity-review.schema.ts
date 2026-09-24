import { z } from 'zod';
import { TOXICITY_BANDS } from '../../db/schema/index.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { TOXICITY_REVIEW_STATUSES } from './toxicity-review.model.js';
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/iu, 'backlinks.errors.siteNotFound');
const boundedListLimit = z.coerce
    .number()
    .finite()
    .int()
    .transform((value) => Math.min(100, Math.max(1, value)))
    .default(20);
export const toxicityPreviewBodySchema = z
    .object({ siteId: objectIdHexSchema })
    .strict();
export const toxicityStartBodySchema = z
    .object({
    siteId: objectIdHexSchema,
    locale: z.enum(SUPPORTED_LOCALES).optional(),
})
    .strict();
export const toxicityRunsQuerySchema = z
    .object({
    siteId: objectIdHexSchema,
    status: z.enum(TOXICITY_REVIEW_STATUSES).optional(),
    cursor: objectIdHexSchema.optional(),
    limit: boundedListLimit,
})
    .strict();
export const toxicityRunParamsSchema = z
    .object({ runId: objectIdHexSchema })
    .strict();
export const toxicityDetailQuerySchema = z
    .object({ band: z.enum(TOXICITY_BANDS).optional() })
    .strict();
export const disavowBuildBodySchema = z
    .object({
    entries: z
        .array(z
        .object({
        rowId: z.string().uuid(),
        kind: z.enum(['domain', 'url']),
    })
        .strict())
        .max(1000),
})
    .strict();
export type ToxicityStartBody = z.infer<typeof toxicityStartBodySchema>;
export type ToxicityRunsQuery = z.infer<typeof toxicityRunsQuerySchema>;
export type ToxicityDetailQuery = z.infer<typeof toxicityDetailQuerySchema>;
export type DisavowBuildBody = z.infer<typeof disavowBuildBodySchema>;
