import { z } from 'zod';
import { reportFormatSchema, reportKindIdSchema, reportLocaleSchema, reportSelectionSchema, reportSourceTargetSchema, } from '../../shared/report-exports/index.js';
export const createReportExportBodySchema = z
    .object({
    kind: reportKindIdSchema,
    format: reportFormatSchema,
    target: reportSourceTargetSchema,
    selection: reportSelectionSchema.default({}),
    locale: reportLocaleSchema.optional(),
    brandingMode: z.enum(['rankmefast', 'white_label']).default('rankmefast'),
})
    .strict();
export const reportExportSnapshotParamsSchema = z
    .object({ snapshotId: z.string().regex(/^[a-fA-F0-9]{24}$/u) })
    .strict();
export const listReportExportsQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().regex(/^[a-fA-F0-9]{24}$/u).optional(),
    kind: reportKindIdSchema.optional(),
    format: reportFormatSchema.optional(),
})
    .strict();
export const listReportExportSharesQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().regex(/^[a-fA-F0-9]{24}$/u).optional(),
})
    .strict();
export type CreateReportExportBody = z.infer<typeof createReportExportBodySchema>;
export type ReportExportSnapshotParams = z.infer<typeof reportExportSnapshotParamsSchema>;
export type ListReportExportsQuery = z.infer<typeof listReportExportsQuerySchema>;
export type ListReportExportSharesQuery = z.infer<typeof listReportExportSharesQuerySchema>;
