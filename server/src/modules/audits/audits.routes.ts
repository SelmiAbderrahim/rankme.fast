import { Router } from 'express';
import { getReport, getReportPdf, getRun, getSummary, listRuns, postSummary, startAudit, } from './audits.controller.js';
/**
 * Two routers so app.ts mounts each at a specific prefix — the auth
 * middleware (`verified`) only fires for actual audit paths, not every
 * unrelated `/api/*` request.
 */
/** Mounted at `/api/sites` alongside sitesRouter to serve /:siteId/audits. */
export const auditsSiteRouter: Router = Router();
auditsSiteRouter.post('/:siteId/audits', startAudit);
auditsSiteRouter.get('/:siteId/audits', listRuns);
/** Mounted at `/api/audits` for run-scoped reads. */
export const auditsRouter: Router = Router();
auditsRouter.get('/:runId', getRun);
auditsRouter.get('/:runId/report', getReport);
// White-label PDF export (workstream B).
auditsRouter.get('/:runId/report.pdf', getReportPdf);
auditsRouter.get('/:runId/summary', getSummary);
auditsRouter.post('/:runId/summary', postSummary);
