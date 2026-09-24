import { z } from 'zod';
/** Structural per-audit crawl ceiling; an omitted request crawls up to this. */
export const AUDIT_PAGE_CAP_MAX = 10000;
export const startAuditBodySchema = z.object({
    /** Optional user-requested cap — clamped to `AUDIT_PAGE_CAP_MAX`. */
    requestedPageCap: z.coerce.number().int().positive().max(AUDIT_PAGE_CAP_MAX).optional(),
});
export type StartAuditBody = z.infer<typeof startAuditBodySchema>;
export const listAuditRunsQuerySchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAuditRunsQuery = z.infer<typeof listAuditRunsQuerySchema>;
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const runIdParamsSchema = z.object({
    runId: z.string().min(1),
});
