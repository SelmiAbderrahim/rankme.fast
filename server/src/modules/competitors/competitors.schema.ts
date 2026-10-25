import { z } from 'zod';
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
// Explicit fresh pull (spends vendor budget). Absent: free read of stored data.
export const listQuerySchema = z.object({
    fresh: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
});
export const intersectionQuerySchema = z.object({
    competitor: z
        .string({ error: (issue) => issue.input === undefined ? undefined : 'competitors.errors.competitorRequired' })
        .trim()
        .min(1, 'competitors.errors.competitorRequired')
        .max(253, 'competitors.errors.competitorTooLong'),
    locationCode: z.coerce.number().int().positive().optional(),
    languageCode: z.string().trim().min(2).max(10).optional(),
});
export type IntersectionQuery = z.infer<typeof intersectionQuerySchema>;
export const techStackParamsSchema = z.object({
    siteId: z.string().min(1),
    domain: z
        .string({ error: (issue) => issue.input === undefined ? undefined : 'competitors.errors.competitorRequired' })
        .trim()
        .min(1, 'competitors.errors.competitorRequired')
        .max(253, 'competitors.errors.competitorTooLong'),
});
export type TechStackParams = z.infer<typeof techStackParamsSchema>;
