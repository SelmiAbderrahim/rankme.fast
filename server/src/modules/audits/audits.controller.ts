import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { db as productionDb } from '../../db/client.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { getAuditsQueue } from './audits.queue-holder.js';
import { findingRuleParamsSchema, listAuditRunsQuerySchema, runIdParamsSchema, siteIdParamsSchema, startAuditBodySchema, } from './audits.schema.js';
import { getAuditRun, listAuditRuns, startAuditForSite, } from './audits.service.js';
import { getAuditReport } from './report.service.js';
import { applyDismissals } from './report-dismissals.js';
import { findingUrlsFromReport, toBrowserAuditReport } from './report-browser.js';
import { previewFindingRecheck, runFindingRecheck } from './finding-recheck.service.js';
import { getSummaryDb } from './summary.db-holder.js';
import { renderAuditReportPdf } from './report-pdf.service.js';
import { AuditRun } from './audit-run.model.js';
import { Site } from '../sites/index.js';
// Direct model import (NOT the users/index barrel): the barrel re-exports
// users.routes.js, which sits in the documented require-auth ↔ auth ↔ users
// import cycle — pulling it into the audits controller graph breaks
// middleware init order. See modules/users/index.ts header comment.
import { User, resolveStoredUserBranding } from '../users/users.model.js';
import { AUDIT_FRESH_DAYS } from '../../shared/observations/freshness-policy.js';
import { getSummaryProvider } from './summary.holder.js';
import { getAuditSummaryProgress, getAuditSummaryState, startAuditSummary, } from './summary.service.js';
import { extractIp, recordAudit } from '../audit/index.js';
export const startAudit: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = startAuditBodySchema.parse(req.body);
    const run = await startAuditForSite({ accountId, siteId, requestedPageCap: body.requestedPageCap, resourceScan: body.resourceScan }, {
        auditsQueue: getAuditsQueue(),
    });
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'audit.run',
        targetType: 'site',
        targetId: siteId,
        ip: extractIp(req),
        metadata: { runId: run.id, pageCap: run.pageCap, resourceScan: run.resourceScan },
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
/* c8 ignore next -- production seam: tests inject a PGlite db via setSummaryDb(); the productionDb fallback fires only at boot. */
const resolveDecisionsDb = () => getSummaryDb() ?? productionDb;
/** The site a run belongs to, for a caller that owns the run; otherwise the standard 404. */
async function ownedRunSiteId(accountId: string, runId: string): Promise<string> {
    if (!Types.ObjectId.isValid(runId))
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const run = await AuditRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean<{
        siteId: unknown;
    } | null>();
    if (!run)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    return String(run.siteId);
}
export const getReport: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = runIdParamsSchema.parse(req.params);
    const siteId = await ownedRunSiteId(accountId, runId);
    // The latest view and the pinned-run view read this one endpoint, and both
    // get the site's decisions applied the same way.
    const report = await applyDismissals(await getAuditReport({ accountId, runId, locale: req.language }), { accountId, siteId, db: resolveDecisionsDb() });
    const aiSummaryEnabled = env.AI_SUMMARY_ENABLED && getSummaryProvider() !== null;
    // A stored summary is flagged (never regenerated) when the owner has since
    // dismissed, fixed or reopened a finding it was built from.
    const aiSummaryFreshness = report.aiSummary
        ? (await getAuditSummaryState({ accountId, runId, locale: req.language }, { db: resolveDecisionsDb() })).freshness ?? null
        : null;
    res.setHeader('Content-Language', req.language);
    // `auditFreshDays` is the one staleness threshold the Actions evidence uses
    // too, so Overview and Report prompt for a new audit exactly when an action
    // card would call the evidence stale.
    res.status(200).json({ ...toBrowserAuditReport(report), aiSummaryEnabled, aiSummaryFreshness, auditFreshDays: AUDIT_FRESH_DAYS });
});
/**
 * GET /api/audits/:runId/findings/:ruleId/urls — the full affected-URL,
 * broken-link and per-URL diff lists of one finding, loaded when the reader
 * opens them. The report screen only carries a preview of each list. Stored
 * data only; a run the caller does not own is a 404.
 */
export const getFindingUrls: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId, ruleId } = findingRuleParamsSchema.parse(req.params);
    const report = await getAuditReport({ accountId, runId, locale: req.language });
    const payload = findingUrlsFromReport(report, ruleId);
    if (!payload) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    res.status(200).json(payload);
});
/**
 * GET / POST /api/audits/:runId/findings/:ruleId/recheck — the targeted
 * re-check of a dismissed finding. GET is the read-only preview (the URLs a
 * re-check would request); POST requests them again with first-party
 * requests and stores the result. No vendor call is made.
 */
async function recheckInput(req: Parameters<RequestHandler>[0]) {
    const accountId = requireAccountId(req);
    const { runId, ruleId } = findingRuleParamsSchema.parse(req.params);
    const siteId = await ownedRunSiteId(accountId, runId);
    return { accountId, siteId, runId, ruleId, locale: req.language, db: resolveDecisionsDb() };
}
export const getFindingRecheck: RequestHandler = asyncHandler(async (req, res) => {
    res.status(200).json(await previewFindingRecheck(await recheckInput(req)));
});
export const postFindingRecheck: RequestHandler = asyncHandler(async (req, res) => {
    res.status(200).json({ recheck: await runFindingRecheck(await recheckInput(req)) });
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
    const state = await getAuditSummaryState({ accountId, runId, locale: req.language }, { db: resolveDecisionsDb() });
    // Stage, elapsed time and failure reason of the latest job.
    const progress = await getAuditSummaryProgress({ accountId, runId, locale: req.language });
    res.setHeader('Content-Language', req.language);
    res.status(200).json({ ...state, progress });
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
        db: resolveDecisionsDb(),
        provider: getSummaryProvider(),
        queue: getAuditsQueue(),
    });
    const progress = await getAuditSummaryProgress({ accountId, runId, locale: req.language });
    res.setHeader('Content-Language', req.language);
    res.status(202).json({ ...state, progress });
});
