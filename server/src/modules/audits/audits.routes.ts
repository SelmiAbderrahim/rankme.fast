import { Router } from 'express';
import { getFindingRecheck, getFindingUrls, getReport, getReportPdf, getRun, getSummary, listRuns, postFindingRecheck, postSummary, startAudit, } from './audits.controller.js';
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
auditsRouter.get('/:runId/findings/:ruleId/urls', getFindingUrls);
auditsRouter.get('/:runId/findings/:ruleId/recheck', getFindingRecheck);
auditsRouter.post('/:runId/findings/:ruleId/recheck', postFindingRecheck);
// White-label PDF export (workstream B).
auditsRouter.get('/:runId/report.pdf', getReportPdf);
auditsRouter.get('/:runId/summary', getSummary);
auditsRouter.post('/:runId/summary', postSummary);
