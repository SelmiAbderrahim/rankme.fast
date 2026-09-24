import { z } from 'zod';
const opaqueResourceIdSchema = z.string().trim().min(1).max(64);
export const appListingRunBodySchema = z
    .object({
    profileId: opaqueResourceIdSchema,
    confirm: z.boolean().optional().default(false),
    locationCode: z.number().int().positive().optional().default(2840),
    languageCode: z.string().trim().min(2).max(16).optional().default('en'),
})
    .strict();
export const appListingReadQuerySchema = z.object({
    profileId: opaqueResourceIdSchema,
});
export const appListingHistoryQuerySchema = appListingReadQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(52).optional().default(20),
});
export type AppListingRunInput = z.infer<typeof appListingRunBodySchema>;
