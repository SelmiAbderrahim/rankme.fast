import { z } from 'zod';
export const REPORT_PUBLIC_FORMATS = ['view', 'pdf', 'csv'] as const;
export const createReportExportShareBodySchema = z
    .object({
    expiresInDays: z.number().int().min(1).max(90).default(30),
    formats: z
        .array(z.enum(REPORT_PUBLIC_FORMATS))
        .min(1)
        .max(REPORT_PUBLIC_FORMATS.length)
        .refine((formats) => new Set(formats).size === formats.length)
        .refine((formats) => formats.includes('view'), {
        message: 'reportExports.errors.invalidSelection',
    }),
})
    .strict();
export const reportExportShareParamsSchema = z
    .object({
    snapshotId: z.string().regex(/^[a-fA-F0-9]{24}$/u),
    shareId: z.string().regex(/^[a-fA-F0-9]{24}$/u).optional(),
})
    .strict();
export const publicReportShareParamsSchema = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
    .strict();
export const publicReportShareFileParamsSchema = publicReportShareParamsSchema
    .extend({ format: z.enum(['pdf', 'csv']) })
    .strict();
export type CreateReportExportShareBody = z.infer<typeof createReportExportShareBodySchema>;
