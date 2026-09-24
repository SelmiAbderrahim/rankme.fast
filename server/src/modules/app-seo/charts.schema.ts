import { z } from 'zod';
import { appStoreKindSchema } from '../../shared/providers/app-data.js';
const opaqueIdSchema = z.string().trim().min(1).max(64);
export const createAppChartSubscriptionBodySchema = z
    .object({
    profileId: opaqueIdSchema,
    store: appStoreKindSchema,
    chartId: z.string().trim().min(1).max(100),
    categoryId: z.string().trim().min(1).max(100),
    locationCode: z.number().int().positive().optional().default(2840),
    languageCode: z.string().trim().min(2).max(16).optional().default('en'),
})
    .strict();
export const appChartListQuerySchema = z.object({
    profileId: opaqueIdSchema,
});
export const appChartSubscriptionParamsSchema = z.object({
    siteId: opaqueIdSchema,
    subscriptionId: opaqueIdSchema,
});
export const appChartHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(104).optional().default(52),
});
export const appChartRecheckBodySchema = z
    .object({ confirm: z.boolean().optional().default(false) })
    .strict();
export type CreateAppChartSubscriptionInput = z.infer<typeof createAppChartSubscriptionBodySchema>;
