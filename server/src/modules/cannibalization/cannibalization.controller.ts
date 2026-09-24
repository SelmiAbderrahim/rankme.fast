import type { Request, Response } from 'express';
import { db as productionDb } from '../../db/client.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getCannibalizationDb } from './cannibalization.holder.js';
import { generateReport, getReport, listReports, previewReport, } from './cannibalization.service.js';
import { generateReportBodySchema, listReportsQuerySchema, previewReportBodySchema, reportIdParamsSchema, siteIdParamsSchema, } from './cannibalization.schema.js';
export function resolveCannibalizationDb() {
    return getCannibalizationDb() ?? productionDb;
}
/** POST /api/sites/:siteId/cannibalization-reports/preview — no spend. */
export const previewReportController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = previewReportBodySchema.parse(req.body);
    const preview = await previewReport({
        accountId: accountId,
        siteId: params.siteId,
        windowDays: body.windowDays,
    });
    res.status(200).json(preview);
});
/** POST /api/sites/:siteId/cannibalization-reports — generate from stored rows. */
export const generateReportController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = generateReportBodySchema.parse(req.body);
    const report = await generateReport({
        accountId: accountId,
        siteId: params.siteId,
        windowDays: body.windowDays,
    }, { db: resolveCannibalizationDb() });
    res.status(201).json(report);
});
/** GET /api/sites/:siteId/cannibalization-reports — free list. */
export const listReportsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listReportsQuerySchema.parse(req.query);
    const page = await listReports({
        accountId: accountId,
        siteId: params.siteId,
        limit: query.limit,
        ...(query.windowDays !== undefined ? { windowDays: query.windowDays } : {}),
    });
    res.status(200).json(page);
});
/** GET /api/cannibalization-reports/:reportId — free re-open, owner-scoped. */
export const getReportController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = reportIdParamsSchema.parse(req.params);
    const report = await getReport({
        accountId: accountId,
        reportId: params.reportId,
    });
    res.status(200).json(report);
});
