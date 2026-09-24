import type { Request, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { createReportExportBodySchema, listReportExportSharesQuerySchema, listReportExportsQuerySchema, reportExportSnapshotParamsSchema, type CreateReportExportBody, } from './report-exports.schema.js';
import { env } from '../../config/env.js';
import { REPORT_CATALOG } from '../../shared/report-exports/index.js';
import { localizeSemanticCopy } from '../../shared/i18n/index.js';
import { allowedTeamSiteIds, assertTeamSiteAccess, } from '../../shared/middleware/team-site-access.js';
import { getReportExportAdapterRegistry } from './report-exports.holder.js';
import { listReportExportSharesForAccount } from './report-export-shares.service.js';
import { observeReportExportOutcome, reportExportOutcomeFields, } from './report-exports.observability.js';
import { createReportExport, deleteReportExport, downloadReportExport, inspectReportExport, listReportExports, reportExportRefusalCode, } from './report-exports.service.js';
function assertAccountScopedReportAccess(teamSiteAccessMode: Request['teamSiteAccessMode']): void {
    if (teamSiteAccessMode === 'selected') {
        throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
    }
}
function canManageAllReports(teamRole: Request['teamRole']): boolean {
    return teamRole !== 'member';
}
export const create: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const actorUserId = requireUserId(req.user);
    let body: CreateReportExportBody | null = null;
    try {
        body = createReportExportBodySchema.parse(req.body);
        const targetSiteId = body.target.siteId;
        if (targetSiteId) {
            assertTeamSiteAccess(req, targetSiteId);
        }
        else
            assertAccountScopedReportAccess(req.teamSiteAccessMode);
        const snapshot = await createReportExport({
            ...body,
            accountId,
            actorUserId,
            requestLocale: req.language,
        });
        await recordAudit({
            actorUserId,
            action: 'report_export.created',
            targetType: 'report_export',
            targetId: snapshot.id,
            ip: extractIp(req),
            metadata: reportExportOutcomeFields({
                kind: snapshot.kind,
                format: snapshot.format,
                status: 'created',
            }),
        });
        observeReportExportOutcome({
            kind: snapshot.kind,
            format: snapshot.format,
            status: 'created',
        });
        res.status(201).json({ snapshot });
    }
    catch (error) {
        const reason = reportExportRefusalCode(error);
        if (body && reason) {
            await recordAudit({
                actorUserId,
                action: 'report_export.refused',
                targetType: 'report_export',
                targetId: body.kind,
                ip: extractIp(req),
                metadata: reportExportOutcomeFields({
                    kind: body.kind,
                    format: body.format,
                    status: 'refused',
                }),
            });
            observeReportExportOutcome({
                kind: body.kind,
                format: body.format,
                status: 'refused',
            });
        }
        throw error;
    }
});
export const capabilities: RequestHandler = asyncHandler(async (req, res) => {
    const registry = getReportExportAdapterRegistry();
    const kinds = REPORT_CATALOG.filter((descriptor) => registry.has(descriptor.kind)).map((descriptor) => {
        const title = localizeSemanticCopy(req.language, descriptor.localization.titleKey);
        const description = localizeSemanticCopy(req.language, descriptor.localization.descriptionKey);
        const bound = localizeSemanticCopy(req.language, descriptor.localization.boundKey);
        return {
            kind: descriptor.kind,
            kindVersion: descriptor.kindVersion,
            classification: descriptor.classification,
            targetScope: descriptor.targetScope,
            formats: [...descriptor.formats],
            share: {
                eligible: descriptor.share.eligible,
                formats: [...descriptor.share.formats],
            },
            brandingModes: [...descriptor.branding.modes],
            bounds: {
                selectedItems: descriptor.bounds.selectedItems,
                pdfItems: descriptor.bounds.pdfItems,
                csvRows: descriptor.bounds.csvRows,
                narrowingFields: [...descriptor.bounds.narrowingFields],
            },
            title: title.message,
            titleKey: title.messageKey,
            description: description.message,
            descriptionKey: description.messageKey,
            bound: bound.message,
            boundKey: bound.messageKey,
        };
    });
    res.setHeader('Content-Language', req.language);
    res.status(200).json({ enabled: env.PUBLIC_EXPORTS_ENABLED, kinds });
});
export const listAllShares: RequestHandler = asyncHandler(async (req, res) => {
    const query = listReportExportSharesQuerySchema.parse(req.query);
    const page = await listReportExportSharesForAccount({
        ...query,
        accountId: requireAccountId(req),
        actorUserId: requireUserId(req.user),
        allowedSiteIds: allowedTeamSiteIds(req),
    });
    res.status(200).json(page);
});
export const list: RequestHandler = asyncHandler(async (req, res) => {
    const query = listReportExportsQuerySchema.parse(req.query);
    const page = await listReportExports({
        ...query,
        accountId: requireAccountId(req),
        actorUserId: requireUserId(req.user),
        allowedSiteIds: allowedTeamSiteIds(req),
    });
    res.status(200).json(page);
});
export const inspect: RequestHandler = asyncHandler(async (req, res) => {
    const { snapshotId } = reportExportSnapshotParamsSchema.parse(req.params);
    const snapshot = await inspectReportExport({
        accountId: requireAccountId(req),
        actorUserId: requireUserId(req.user),
        snapshotId,
    });
    res.status(200).json({ snapshot });
});
export const remove: RequestHandler = asyncHandler(async (req, res) => {
    const { snapshotId } = reportExportSnapshotParamsSchema.parse(req.params);
    const actorUserId = requireUserId(req.user);
    const snapshot = await deleteReportExport({
        accountId: requireAccountId(req),
        actorUserId,
        snapshotId,
        canManageAll: canManageAllReports(req.teamRole),
    });
    if (snapshot) {
        await recordAudit({
            actorUserId,
            action: 'report_export.deleted',
            targetType: 'report_export',
            targetId: snapshot.id,
            ip: extractIp(req),
            metadata: {
                kind: snapshot.kind,
                format: snapshot.format,
                status: 'deleted',
            },
        });
    }
    res.status(204).end();
});
export const download: RequestHandler = asyncHandler(async (req, res) => {
    const { snapshotId } = reportExportSnapshotParamsSchema.parse(req.params);
    const actorUserId = requireUserId(req.user);
    const result = await downloadReportExport({
        accountId: requireAccountId(req),
        actorUserId,
        snapshotId,
    });
    await recordAudit({
        actorUserId,
        action: 'report_export.rendered',
        targetType: 'report_export',
        targetId: result.snapshotId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: result.kind,
            format: result.format,
            status: 'rendered',
        }),
    });
    observeReportExportOutcome({
        kind: result.kind,
        format: result.format,
        status: 'rendered',
    });
    await recordAudit({
        actorUserId,
        action: 'report_export.downloaded',
        targetType: 'report_export',
        targetId: result.snapshotId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: result.kind,
            format: result.format,
            status: 'downloaded',
        }),
    });
    observeReportExportOutcome({
        kind: result.kind,
        format: result.format,
        status: 'downloaded',
    });
    for (const [name, value] of Object.entries(result.headers)) {
        res.setHeader(name, value);
    }
    res.setHeader('Content-Language', result.locale);
    res.status(200).send(result.bytes);
});
export const reportExportControllerTestables = Object.freeze({
    assertAccountScopedReportAccess,
    canManageAllReports,
});
