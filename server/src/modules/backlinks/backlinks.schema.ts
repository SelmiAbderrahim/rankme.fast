import { z } from 'zod';
// Zod boundary schemas for /api/sites/:siteId/backlinks/*.
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const backlinksListQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce
        .number({ invalid_type_error: 'backlinks.errors.limitInvalid' })
        .int()
        .positive()
        .optional(),
});
export type BacklinksListQuery = z.infer<typeof backlinksListQuerySchema>;
