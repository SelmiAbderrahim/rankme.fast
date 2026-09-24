import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { db as productionDb } from '../../db/client.js';
import { translate } from '../../shared/i18n/index.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { renderAuditReportPdf } from '../audits/index.js';
import { resolveClientReportsDb } from './client-reports.db-holder.js';
import { clientReportSiteParamsSchema, composeClientReportSchema, } from './client-reports.schema.js';
import { composeClientReport } from './report-composer.service.js';
import { getClientReportsQueue } from './client-reports.queue-holder.js';
import { clientPortalCreateBodySchema, clientPortalParamsSchema, clientReportDeliveryQuerySchema, clientReportScheduleBodySchema, clientReportScheduleParamsSchema, publicClientPortalParamsSchema, publicClientPortalQuerySchema, } from './client-reports.schema.js';
import { createSchedule, deleteSchedule, listDeliveries, listSchedules, updateSchedule, } from './schedules.service.js';
import { createClientPortal, listClientPortals, readClientPortal, revokeClientPortal, } from './portal.service.js';
export const downloadClientReportPdf: RequestHandler = asyncHandler(async (req, res) => {
    if (!env.CLIENT_REPORTS_ENABLED) {
        throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_UNAVAILABLE', messageKey: 'clientReports.errors.unavailable' });
    }
    const accountId = requireAccountId(req);
    const { siteId } = clientReportSiteParamsSchema.parse(req.params);
    const body = composeClientReportSchema.parse(req.body);
    const snapshot = await composeClientReport({ accountId, siteId, locale: body.locale, sections: body.sections }, resolveClientReportsDb(productionDb));
    const companyName = snapshot.branding.companyName.trim() ||
        translate(snapshot.locale, 'report.pdf.neutralBrand');
    const bytes = await renderAuditReportPdf({
        report: snapshot.sections.audit?.report ?? null,
        branding: {
            companyName,
            accentColor: snapshot.branding.accentColor,
        },
        locale: snapshot.locale,
        generatedAt: new Date(snapshot.generatedAt),
        siteDomain: snapshot.siteDomain,
        logoPngBytes: snapshot.branding.logoPngBase64
            ? Buffer.from(snapshot.branding.logoPngBase64, 'base64')
            : null,
        auditSnapshotDate: snapshot.sections.audit?.snapshotDate ?? null,
        rankSummary: snapshot.sections.ranks,
        gscSummary: snapshot.sections.gsc,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Language', snapshot.locale);
    res.setHeader('Content-Disposition', 'attachment; filename="client-report.pdf"');
    res.status(200).end(Buffer.from(bytes));
});
function resolveDb() {
    return resolveClientReportsDb(productionDb);
}
export const getClientReportsOverview: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = clientReportSiteParamsSchema.parse(req.params);
    const db = resolveDb();
    const [schedules, portals] = await Promise.all([
        listSchedules(accountId, siteId, db),
        listClientPortals(accountId, siteId),
    ]);
    res.status(200).json({
        enabled: env.CLIENT_REPORTS_ENABLED,
        schedules: schedules.schedules,
        portals: portals.portals,
    });
});
export const createClientReportSchedule: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = clientReportSiteParamsSchema.parse(req.params);
    const body = clientReportScheduleBodySchema.parse(req.body);
    const schedule = await createSchedule({ accountId, siteId, body }, { db: resolveDb(), queue: getClientReportsQueue() });
    res.status(201).json(schedule);
});
export const updateClientReportSchedule: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, scheduleId } = clientReportScheduleParamsSchema.parse(req.params);
    const body = clientReportScheduleBodySchema.parse(req.body);
    const schedule = await updateSchedule({ accountId, siteId, scheduleId, body }, { db: resolveDb(), queue: getClientReportsQueue() });
    res.status(200).json(schedule);
});
export const deleteClientReportSchedule: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, scheduleId } = clientReportScheduleParamsSchema.parse(req.params);
    await deleteSchedule({ accountId, siteId, scheduleId }, { db: resolveDb(), queue: getClientReportsQueue() });
    res.status(204).end();
});
export const listClientReportDeliveries: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = clientReportSiteParamsSchema.parse(req.params);
    const query = clientReportDeliveryQuerySchema.parse(req.query);
    res.status(200).json(await listDeliveries({ accountId, siteId, query }, resolveDb()));
});
export const createClientPortalLink: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = clientReportSiteParamsSchema.parse(req.params);
    const body = clientPortalCreateBodySchema.parse(req.body);
    const portal = await createClientPortal({ accountId, siteId, body });
    res.status(201).json(portal);
});
export const revokeClientPortalLink: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, portalId } = clientPortalParamsSchema.parse(req.params);
    res.status(200).json(await revokeClientPortal({ accountId, siteId, portalId }));
});
export const getPublicClientPortal: RequestHandler = asyncHandler(async (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store');
    const { token } = publicClientPortalParamsSchema.parse(req.params);
    const { locale } = publicClientPortalQuerySchema.parse(req.query);
    const portal = await readClientPortal(token, locale, resolveDb());
    res.setHeader('Content-Language', portal.locale);
    res.status(200).json(portal);
});
