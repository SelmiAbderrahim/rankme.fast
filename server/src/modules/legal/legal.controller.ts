import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { env } from '../../config/env.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { cancelAccountDeletion, exportUserData, getAccountDeletionStatus, scheduleAccountDeletion, type PurgeQueue, type WarningMailer, } from './legal.service.js';
import { getContentIntelligenceDb } from '../content-intelligence/index.js';
// The purge queue + warning mailer are injectable so tests + wiring do not
// pull the whole communication module into unit tests. Production
// wiring calls `configureLegalController` at boot.
let queue: PurgeQueue | null = null;
let mailer: WarningMailer | null = null;
export interface ConfigureLegalControllerDeps {
    queue: PurgeQueue;
    mailer?: WarningMailer;
}
export function configureLegalController(deps: ConfigureLegalControllerDeps): void {
    queue = deps.queue;
    mailer = deps.mailer ?? null;
}
export function resetLegalController(): void {
    queue = null;
    mailer = null;
}
export const exportMyData: RequestHandler = asyncHandler(async (req, res) => {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    const userId = req.user.id;
    const exportDb = getContentIntelligenceDb();
    const data = await exportUserData(userId, {
        ...(exportDb ? { db: exportDb } : {}),
    });
    await recordAudit({
        actorUserId: userId,
        action: 'data.export',
        targetType: 'user',
        targetId: userId,
        ip: extractIp(req),
    });
    res.status(200).json(data);
});
export const deleteMyAccount: RequestHandler = asyncHandler(async (req, res) => {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    if (!queue) {
        throw HttpError.internal({ code: 'SECURITY_DELETION_NOT_CONFIGURED', messageKey: 'security.deletion.notConfigured' });
    }
    const userId = req.user.id;
    const result = await scheduleAccountDeletion(userId, {
        graceHours: env.ACCOUNT_DELETION_GRACE_HOURS,
        queue,
        mailer: mailer ?? undefined,
        locale: req.language,
        ip: extractIp(req),
    });
    res.status(202).json(result);
});
export const cancelMyAccountDeletion: RequestHandler = asyncHandler(async (req, res) => {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    if (!queue) {
        throw HttpError.internal({ code: 'SECURITY_DELETION_NOT_CONFIGURED', messageKey: 'security.deletion.notConfigured' });
    }
    const userId = req.user.id;
    const result = await cancelAccountDeletion(userId, {
        queue,
        ip: extractIp(req),
    });
    res.status(200).json(result);
});
export const accountDeletionStatus: RequestHandler = asyncHandler(async (req, res) => {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    res.status(200).json(await getAccountDeletionStatus(req.user.id));
});
