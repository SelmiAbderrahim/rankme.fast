import { z } from 'zod';
/** Structural per-audit crawl ceiling; an omitted request crawls up to this. */
export const AUDIT_PAGE_CAP_MAX = 10000;
/**
 * Largest crawl a run can cover while it also loads images, scripts and
 * stylesheets. The vendor loads resources for every crawled page, so a run that
 * scans is limited to this many pages; opt a run out of the scan to crawl more.
 */
export const RESOURCE_SCAN_MAX_PAGES = 1000;
/** Whether a run loads images, scripts and stylesheets: on unless the caller opts out. */
export function resolveResourceScan(requested?: boolean): boolean {
    return requested !== false;
}
/** Crawl ceiling for a run: a scanning run never crawls past `RESOURCE_SCAN_MAX_PAGES`. */
export function pageCapForScan(pageCap: number, resourceScan: boolean): number {
    return resourceScan ? Math.min(pageCap, RESOURCE_SCAN_MAX_PAGES) : pageCap;
}
export const startAuditBodySchema = z.object({
    /** Optional user-requested cap — clamped to `AUDIT_PAGE_CAP_MAX`. */
    requestedPageCap: z.coerce.number().int().positive().max(AUDIT_PAGE_CAP_MAX).optional(),
    /** Scan images, scripts and stylesheets. Omitted = on; `false` opts this run out. */
    resourceScan: z.boolean().optional(),
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
