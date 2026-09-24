import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { createReportExportShareBodySchema, publicReportShareFileParamsSchema, publicReportShareParamsSchema, reportExportShareParamsSchema, } from './report-export-shares.schema.js';
import { authenticatePublicReportShareToken, createReportExportShare, listReportExportShares, resolvePublicReportShare, revokeReportExportShare, } from './report-export-shares.service.js';
import { observeReportExportOutcome, reportExportOutcomeFields, } from './report-exports.observability.js';
import { inspectReportExport } from './report-exports.service.js';
function publicViewParams(params: unknown): {
    token: string;
} {
    const parsed = publicReportShareParamsSchema.safeParse(params);
    if (!parsed.success)
        throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
    return parsed.data;
}
function publicFileParams(params: unknown): {
    token: string;
    format: 'pdf' | 'csv';
} {
    const parsed = publicReportShareFileParamsSchema.safeParse(params);
    if (!parsed.success)
        throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
    return parsed.data;
}
function refusalFormats(error: unknown, formats: readonly ('view' | 'pdf' | 'csv')[]): readonly ('view' | 'pdf' | 'csv')[] {
    return error instanceof HttpError ? formats : [];
}
function requiredShareId(shareId: string | undefined): string {
    if (!shareId)
        throw new TypeError('shareId is required');
    return shareId;
}
function throwObservedPublicRefusal(format: 'view' | 'pdf' | 'csv' | 'unknown', error: unknown): never {
    observeReportExportOutcome({ kind: 'unknown', format, status: 'refused' });
    throw error;
}
function requiredPublicFile<File>(file: File | undefined): File {
    if (!file)
        throw new TypeError('public report file is missing');
    return file;
}
async function observedPublicOperation<Result>(format: 'view' | 'pdf' | 'csv' | 'unknown', operation: () => Promise<Result>): Promise<Result> {
    try {
        return await operation();
    }
    catch (error) {
        throwObservedPublicRefusal(format, error);
    }
}
export const createShare: RequestHandler = asyncHandler(async (req, res) => {
    const actorUserId = requireUserId(req.user);
    const { snapshotId } = reportExportShareParamsSchema.parse(req.params);
    const accountId = requireAccountId(req);
    const body = createReportExportShareBodySchema.parse(req.body);
    let kind = 'unknown';
    try {
        kind = (await inspectReportExport({ accountId, actorUserId, snapshotId })).kind;
        const share = await createReportExportShare({
            accountId,
            actorUserId,
            snapshotId,
            body,
        });
        for (const format of share.formats) {
            await recordAudit({
                actorUserId,
                action: 'report_export.share_created',
                targetType: 'report_export_share',
                targetId: share.id,
                ip: extractIp(req),
                metadata: reportExportOutcomeFields({ kind, format, status: 'shared' }),
            });
            observeReportExportOutcome({ kind, format, status: 'shared' });
        }
        res.status(201).json({ share });
    }
    catch (error) {
        for (const format of refusalFormats(error, body.formats)) {
            await recordAudit({
                actorUserId,
                action: 'report_export.refused',
                targetType: 'report_export',
                targetId: snapshotId,
                ip: extractIp(req),
                metadata: reportExportOutcomeFields({
                    kind,
                    format,
                    status: 'refused',
                }),
            });
            observeReportExportOutcome({ kind, format, status: 'refused' });
        }
        throw error;
    }
});
export const listShares: RequestHandler = asyncHandler(async (req, res) => {
    const { snapshotId } = reportExportShareParamsSchema.parse(req.params);
    const shares = await listReportExportShares({
        accountId: requireAccountId(req),
        actorUserId: requireUserId(req.user),
        snapshotId,
    });
    res.status(200).json({ shares });
});
export const revokeShare: RequestHandler = asyncHandler(async (req, res) => {
    const actorUserId = requireUserId(req.user);
    const { snapshotId, shareId } = reportExportShareParamsSchema.parse(req.params);
    const requiredId = requiredShareId(shareId);
    const accountId = requireAccountId(req);
    const kind = (await inspectReportExport({ accountId, actorUserId, snapshotId })).kind;
    const share = await revokeReportExportShare({
        accountId,
        actorUserId,
        snapshotId,
        shareId: requiredId,
    });
    for (const format of share.formats) {
        await recordAudit({
            actorUserId,
            action: 'report_export.share_revoked',
            targetType: 'report_export_share',
            targetId: share.id,
            ip: extractIp(req),
            metadata: reportExportOutcomeFields({ kind, format, status: 'revoked' }),
        });
        observeReportExportOutcome({ kind, format, status: 'revoked' });
    }
    res.status(200).json({ share });
});
export const authenticatePublicView: RequestHandler = asyncHandler(async (req, _res, next) => {
    try {
        const { token } = publicViewParams(req.params);
        req.reportShareTokenHash = (await authenticatePublicReportShareToken({ rawToken: token, format: 'view' })).tokenHash;
        next();
    }
    catch (error) {
        throwObservedPublicRefusal('view', error);
    }
});
export const authenticatePublicFile: RequestHandler = asyncHandler(async (req, _res, next) => {
    let requestedFormat: 'pdf' | 'csv' | 'unknown' = 'unknown';
    try {
        const { token, format } = publicFileParams(req.params);
        requestedFormat = format;
        req.reportShareTokenHash = (await authenticatePublicReportShareToken({ rawToken: token, format })).tokenHash;
        next();
    }
    catch (error) {
        throwObservedPublicRefusal(requestedFormat, error);
    }
});
export const getPublicShare: RequestHandler = asyncHandler(async (req, res) => {
    const { token } = publicViewParams(req.params);
    const access = await observedPublicOperation('view', () => resolvePublicReportShare({ rawToken: token, format: 'view' }));
    await recordAudit({
        actorUserId: access.actorUserId,
        action: 'report_export.rendered',
        targetType: 'report_export',
        targetId: access.snapshotId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: access.kind,
            format: access.format,
            status: 'rendered',
        }),
    });
    observeReportExportOutcome({
        kind: access.kind,
        format: access.format,
        status: 'rendered',
    });
    await recordAudit({
        actorUserId: access.actorUserId,
        action: 'report_export.share_viewed',
        targetType: 'report_export_share',
        targetId: access.shareId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: access.kind,
            format: access.format,
            status: 'accessed',
        }),
    });
    observeReportExportOutcome({
        kind: access.kind,
        format: access.format,
        status: 'accessed',
    });
    res.setHeader('Content-Language', access.report!.locale);
    res.status(200).json({ report: access.report });
});
export const downloadPublicShare: RequestHandler = asyncHandler(async (req, res) => {
    const { token, format } = publicFileParams(req.params);
    const access = await observedPublicOperation(format, () => resolvePublicReportShare({ rawToken: token, format }));
    const file = requiredPublicFile(access.file);
    await recordAudit({
        actorUserId: access.actorUserId,
        action: 'report_export.rendered',
        targetType: 'report_export',
        targetId: access.snapshotId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: access.kind,
            format: access.format,
            status: 'rendered',
        }),
    });
    observeReportExportOutcome({
        kind: access.kind,
        format: access.format,
        status: 'rendered',
    });
    await recordAudit({
        actorUserId: access.actorUserId,
        action: 'report_export.downloaded',
        targetType: 'report_export',
        targetId: access.snapshotId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: access.kind,
            format: access.format,
            status: 'downloaded',
        }),
    });
    observeReportExportOutcome({
        kind: access.kind,
        format: access.format,
        status: 'downloaded',
    });
    await recordAudit({
        actorUserId: access.actorUserId,
        action: 'report_export.share_viewed',
        targetType: 'report_export_share',
        targetId: access.shareId,
        ip: extractIp(req),
        metadata: reportExportOutcomeFields({
            kind: access.kind,
            format: access.format,
            status: 'accessed',
        }),
    });
    observeReportExportOutcome({
        kind: access.kind,
        format: access.format,
        status: 'accessed',
    });
    for (const [name, value] of Object.entries(file.headers)) {
        res.setHeader(name, value);
    }
    res.setHeader('Content-Language', file.locale);
    res.status(200).send(file.bytes);
});
export const reportExportShareControllerTestables = Object.freeze({
    observedPublicOperation,
    publicFileParams,
    publicViewParams,
    refusalFormats,
    requiredPublicFile,
    requiredShareId,
    throwObservedPublicRefusal,
});
