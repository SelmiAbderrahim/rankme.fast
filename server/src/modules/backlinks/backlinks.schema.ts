import { z } from 'zod';
// Zod boundary schemas for /api/sites/:siteId/backlinks/*.
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const backlinksListQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce
        .number({ error: 'backlinks.errors.limitInvalid' })
        .int()
        .positive()
        .optional(),
    // Explicit fresh pull, sent after a refresh. Absent: a stored-data read.
    fresh: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
});
export type BacklinksListQuery = z.infer<typeof backlinksListQuerySchema>;
