import { z } from 'zod';
import { appBulkMetricsRowSchema, appCompetitorRowSchema, appIntersectionRowSchema, appKeywordRowSchema, appStoreKindSchema, } from '../../shared/providers/app-data.js';
import { APP_STORE_ID_REGEX, PLAY_PACKAGE_ID_REGEX, } from './app-seo.schema.js';
const opaqueResourceIdSchema = z.string().trim().min(1).max(64);
const locationCodeSchema = z.number().int().positive().optional().default(2840);
const languageCodeSchema = z.string().trim().min(2).max(16).optional().default('en');
const validateStoreId = (store: 'google_play' | 'app_store', appId: string): boolean => store === 'google_play'
    ? PLAY_PACKAGE_ID_REGEX.test(appId)
    : APP_STORE_ID_REGEX.test(appId);
export const appResearchBaseSchema = z
    .object({
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
})
    .strict();
export const appResearchKeywordsBodySchema = appResearchBaseSchema.extend({
    cursor: z.number().int().min(0).max(99).optional().default(0),
    pageSize: z.number().int().positive().max(100).optional().default(25),
});
export const appResearchGapBodySchema = appResearchBaseSchema
    .extend({
    appIds: z.array(z.string().trim().min(1).max(255)).min(2).max(20),
})
    .superRefine((value, context) => {
    value.appIds.forEach((appId, index) => {
        if (!validateStoreId(value.store, appId)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'appSeo.research.errors.invalidAppId',
                path: ['appIds', index],
            });
        }
    });
});
export const appResearchCompetitorsBodySchema = appResearchBaseSchema;
export const appResearchPreviewQuerySchema = z.object({
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
    locationCode: z.coerce.number().int().positive().optional().default(2840),
    languageCode: languageCodeSchema,
    appIds: z.string().trim().max(5120).optional(),
});
export const appResearchStoredQuerySchema = z.object({
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
});
export const appKeywordRowsSchema = z.array(appKeywordRowSchema).max(100);
export const appIntersectionRowsSchema = z.array(appIntersectionRowSchema).max(100);
export const appCompetitorRowsSchema = z.array(appCompetitorRowSchema).max(100);
export const appBulkMetricRowsSchema = z.array(appBulkMetricsRowSchema).max(50);
export const appResearchKeywordResultSchema = z
    .object({
    surface: z.literal('keywords'),
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
    appId: z.string().min(1).max(255),
    rows: appKeywordRowsSchema,
    cursor: z.number().int().min(0).max(100),
    nextCursor: z.number().int().min(1).max(100).nullable(),
    totalRows: z.number().int().nonnegative().max(100),
    cached: z.boolean(),
    fetchedAt: z.string().datetime({ offset: true }),
})
    .strict();
export const appResearchGapResultSchema = z
    .object({
    surface: z.literal('gap'),
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
    ownAppId: z.string().min(1).max(255),
    appIds: z.array(z.string().min(1).max(255)).min(2).max(20),
    rows: appIntersectionRowsSchema,
    cached: z.boolean(),
    fetchedAt: z.string().datetime({ offset: true }),
})
    .strict();
export const appResearchCompetitorResultSchema = z
    .object({
    surface: z.literal('competitors'),
    profileId: opaqueResourceIdSchema,
    store: appStoreKindSchema,
    appId: z.string().min(1).max(255),
    rows: z.array(z.object({
        competitor: appCompetitorRowSchema,
        metrics: appBulkMetricsRowSchema.nullable(),
    }).strict()).max(100),
    partial: z.boolean(),
    noteKey: z.string().max(160).nullable(),
    cached: z.boolean(),
    fetchedAt: z.string().datetime({ offset: true }),
})
    .strict();
export type AppResearchKeywordsInput = z.infer<typeof appResearchKeywordsBodySchema>;
export type AppResearchGapInput = z.infer<typeof appResearchGapBodySchema>;
export type AppResearchCompetitorsInput = z.infer<typeof appResearchCompetitorsBodySchema>;
export type AppResearchKeywordResult = z.infer<typeof appResearchKeywordResultSchema>;
export type AppResearchGapResult = z.infer<typeof appResearchGapResultSchema>;
export type AppResearchCompetitorResult = z.infer<typeof appResearchCompetitorResultSchema>;
