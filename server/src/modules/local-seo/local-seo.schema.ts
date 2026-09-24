import { z } from 'zod';
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const keywordRankParamsSchema = siteIdParamsSchema.extend({
    keywordId: z.string().min(1),
});
