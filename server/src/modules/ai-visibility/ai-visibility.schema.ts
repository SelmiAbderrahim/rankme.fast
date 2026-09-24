import { z } from 'zod';
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const promptIdParamsSchema = siteIdParamsSchema.extend({
    promptId: z.string().uuid(),
});
export const addTrackedPromptBodySchema = z.object({
    prompt: z.string().trim().min(1, 'aiVisibility.errors.promptRequired').max(280),
});
export type AddTrackedPromptBody = z.infer<typeof addTrackedPromptBodySchema>;
export const trendQuerySchema = z.object({
    days: z.coerce.number().int().min(7).max(365).default(90),
});
export type TrendQuery = z.infer<typeof trendQuerySchema>;
