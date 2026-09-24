import { z } from 'zod';
import { appStoreKindSchema } from '../../shared/providers/app-data.js';
const opaqueResourceIdSchema = z.string().trim().min(1).max(64);
export const appKeywordSiteQuerySchema = z.object({
    profileId: opaqueResourceIdSchema,
});
export const appKeywordParamsSchema = z.object({
    siteId: opaqueResourceIdSchema,
    keywordId: z.string().uuid(),
});
export const mintAppKeywordBodySchema = z
    .object({
    phrase: z.string().trim().min(1).max(700).transform((value) => value.toLocaleLowerCase()),
    store: appStoreKindSchema,
    locationCode: z.number().int().positive().optional().default(2840),
    languageCode: z.string().trim().min(2).max(16).optional().default('en'),
})
    .strict();
export const appKeywordHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(104).optional().default(52),
});
export const appKeywordRecheckBodySchema = z
    .object({ confirm: z.boolean().optional().default(false) })
    .strict();
export type MintAppKeywordInput = z.infer<typeof mintAppKeywordBodySchema>;
