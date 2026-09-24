import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { getAuditsQueue } from './audits.queue-holder.js';
import { listAuditRunsQuerySchema, runIdParamsSchema, siteIdParamsSchema, startAuditBodySchema, } from './audits.schema.js';
import { getAuditRun, listAuditRuns, startAuditForSite, } from './audits.service.js';
import { getAuditReport } from './report.service.js';
import { renderAuditReportPdf } from './report-pdf.service.js';
import { AuditRun } from './audit-run.model.js';
import { Site } from '../sites/index.js';
// Direct model import (NOT the users/index barrel): the barrel re-exports
// users.routes.js, which sits in the documented require-auth ↔ auth ↔ users
// import cycle — pulling it into the audits controller graph breaks
// middleware init order. See modules/users/index.ts header comment.
import { User, resolveStoredUserBranding } from '../users/users.model.js';
import { getSummaryProvider } from './summary.holder.js';
import { getAuditSummaryState, startAuditSummary, } from './summary.service.js';
import { extractIp, recordAudit } from '../audit/index.js';
export const startAudit: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = startAuditBodySchema.parse(req.body);
    const run = await startAuditForSite({ accountId, siteId, requestedPageCap: body.requestedPageCap }, {
        auditsQueue: getAuditsQueue(),
    });
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'audit.run',
        targetType: 'site',
        targetId: siteId,
        ip: extractIp(req),
        metadata: { runId: run.id, pageCap: run.pageCap },
    });
    sendLocalizedMessage(req, res, 202, 'audits.started', { run });
});
export const listRuns: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const query = listAuditRunsQuerySchema.parse(req.query);
    const page = await listAuditRuns({ accountId, siteId, ...query });
    res.status(200).json(page);
});
export const getRun: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = runIdParamsSchema.parse(req.params);
    const result = await getAuditRun({ accountId, runId });
    res.status(200).json(result);
});
export const getReport: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = runIdParamsSchema.parse(req.params);
    const report = await getAuditReport({ accountId, runId, locale: req.language });
    const aiSummaryEnabled = env.AI_SUMMARY_ENABLED && getSummaryProvider() !== null;
    res.setHeader('Content-Language', req.language);
    res.status(200).json({ ...report, aiSummaryEnabled });
});
/**
 * GET /api/audits/:runId/report.pdf — white-label PDF export (workstream B).
 *
 * Ownership is enforced by getAuditReport (cross-account → 404).
 * The report copy arrives already localized for `req.language`; branding
 * comes from the Mongo user mirror. `generatedAt` is the only wall-clock
 * input — the renderer itself is deterministic.
 */
export const getReportPdf: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = runIdParamsSchema.parse(req.params);
    const locale = req.language;
    const report = await getAuditReport({ accountId, runId, locale });
    // getAuditReport already 404'd unless this account owns the run — but that
    // load happens behind the service; re-read here to look up the site domain
    // and enforce cross-account isolation on the Site row too (findById would
    // otherwise return any site with a matching id).
    const run = await AuditRun.findOne({ _id: runId, accountId });
    /* c8 ignore next -- getAuditReport threw first if the run does not belong to the caller; this guard closes a re-check window. */
    if (!run)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const site = await Site.findOne({
        _id: run.siteId,
        accountId,
        deletionStartedAt: null,
    });
    const siteDomain = site ? site.url.replace(/^https?:\/\//, '').replace(/\/+$/, '') : '';
    const user = await User.findById(accountId).select('branding').lean();
    const { companyName, accentColor, logoPngBase64 } = resolveStoredUserBranding(user);
    const branding = companyName.trim().length > 0 || accentColor.length > 0 || logoPngBase64.length > 0
        ? { companyName, accentColor }
        : null;
    const bytes = await renderAuditReportPdf({
        report,
        branding,
        locale,
        generatedAt: new Date(),
        siteDomain,
        logoPngBytes: logoPngBase64.length > 0 ? Buffer.from(logoPngBase64, 'base64') : null,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Language', locale);
    res.setHeader('Content-Disposition', `attachment; filename="rankmefast-report-${runId}.pdf"`);
    res.status(200).end(Buffer.from(bytes));
});
/**
 * GET /api/audits/:runId/summary — poll durable generation state.
 */
export const getSummary: RequestHandler = asyncHandler(async (req, res) => {
    if (!env.AI_SUMMARY_ENABLED) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    const accountId = requireAccountId(req);
    const { runId } = runIdParamsSchema.parse(req.params);
    const state = await getAuditSummaryState({ accountId, runId, locale: req.language });
    res.setHeader('Content-Language', req.language);
    res.status(200).json(state);
});
/**
 * POST /api/audits/:runId/summary — enqueue AI-summary generation.
 *
 * `AI_SUMMARY_ENABLED=false` → 404 (endpoint contract). When
 * the flag is on but the configured provider registry is unavailable, the service
 * throws a localized 503 — the boot still succeeds so this branch is a
 * runtime state, never a startup crash.
 */
export const postSummary: RequestHandler = asyncHandler(async (req, res) => {
    if (!env.AI_SUMMARY_ENABLED) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    const accountId = requireAccountId(req);
    const { runId } = runIdParamsSchema.parse(req.params);
    const state = await startAuditSummary({ accountId, runId, locale: req.language }, {
        provider: getSummaryProvider(),
        queue: getAuditsQueue(),
    });
    res.setHeader('Content-Language', req.language);
    res.status(202).json(state);
});
