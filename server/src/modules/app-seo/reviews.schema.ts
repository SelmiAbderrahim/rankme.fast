import { z } from 'zod';
import { appStoreKindSchema } from '../../shared/providers/app-data.js';
// Keep resource ids opaque at the request boundary. Services validate Mongo
// shape and ownership together so malformed, missing, and foreign ids all
// produce the same non-enumerating 404 response.
const opaqueResourceIdSchema = z.string().trim().min(1).max(64);
export const appReviewRunBodySchema = z
    .object({
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
    confirm: z.boolean().optional().default(false),
    locationCode: z.number().int().positive().optional().default(2840),
    languageCode: z.string().trim().min(2).max(16).optional().default('en'),
})
    .strict();
export const appReviewRunListQuerySchema = z.object({
    profileId: opaqueResourceIdSchema.optional(),
    store: appStoreKindSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export const appReviewRunParamsSchema = z.object({
    siteId: opaqueResourceIdSchema,
    runId: opaqueResourceIdSchema,
});
export type AppReviewRunInput = z.infer<typeof appReviewRunBodySchema>;
