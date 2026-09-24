import type { RequestHandler } from 'express';
import { db as productionDb } from '../../db/client.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { getAuditsQueue } from '../audits/audits.queue-holder.js';
import { getSummaryDb } from '../audits/summary.db-holder.js';
import { startAuditForSite } from '../audits/audits.service.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { isSupportedLocale, DEFAULT_LOCALE } from '../../shared/i18n/index.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import type { ActionSourceType } from '../../db/schema/action-events.js';
import { hashActionId } from './actions.identity.js';
import { actionIdParamsSchema, listActionsQuerySchema, mutateActionStateSchema, retestActionBodySchema, siteIdParamsSchema, } from './actions.schema.js';
import { getActionHistory, listActionsForSite, } from './actions.service.js';
import { mutateActionState } from './actions.state.service.js';
import { getSourceReaders } from './actions.registry.js';
function toArray<T>(v: T | T[] | undefined): T[] | undefined {
    if (v === undefined)
        return undefined;
    return Array.isArray(v) ? v : [v];
}
function resolveLocale(req: {
    language?: string;
}): SupportedLocale {
    const l = req.language;
    return l && isSupportedLocale(l) ? l : DEFAULT_LOCALE;
}
/* c8 ignore next -- production seam: tests inject a PGlite db via holders. */
function resolveDb() {
    return getSummaryDb() ?? productionDb;
}
export const listActions: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const query = listActionsQuerySchema.parse(req.query);
    const result = await listActionsForSite({
        accountId,
        siteId,
        locale: resolveLocale(req),
        db: resolveDb(),
        filters: {
            state: toArray(query.state),
            source: toArray(query.source),
            severity: toArray(query.severity),
            confidence: toArray(query.confidence),
            effort: toArray(query.effort),
        },
        limit: query.limit,
        cursor: query.cursor,
    });
    res.setHeader('Content-Language', resolveLocale(req));
    res.status(200).json(result);
});
export const getActionHistoryHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, actionId } = actionIdParamsSchema.parse(req.params);
    const result = await getActionHistory({
        accountId,
        siteId,
        actionId,
        db: resolveDb(),
        locale: resolveLocale(req),
    });
    res.status(200).json(result);
});
export const mutateActionStateHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, actionId } = actionIdParamsSchema.parse(req.params);
    const body = mutateActionStateSchema.parse(req.body);
    const result = await mutateActionState({
        accountId,
        siteId,
        actionId,
        actorUserId: requireUserId(req.user),
        newState: body.state,
        expectedVersion: body.expectedVersion,
        note: body.note ?? null,
        clientKey: body.clientKey,
        db: resolveDb(),
    });
    res.status(200).json(result);
});
export const retestActionHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, actionId } = actionIdParamsSchema.parse(req.params);
    retestActionBodySchema.parse(req.body);
    // Resolve candidate; only audit_finding actions may be retested via this
    // route. All other sources reject with a 409 before spend.
    let candidateSourceType: ActionSourceType | null = null;
    for (const [sourceType, reader] of getSourceReaders()) {
        let result;
        try {
            result = await reader({ accountId, siteId, db: resolveDb() });
        }
        catch {
            continue;
        }
        const found = result.actions.find((c) => hashActionId({
            accountId,
            siteId,
            sourceType: c.sourceType,
            sourceId: c.sourceId,
        }) === actionId);
        if (found) {
            candidateSourceType = sourceType;
            break;
        }
    }
    if (!candidateSourceType) {
        throw HttpError.notFound({ code: 'ACTIONS_ERRORS_NOT_FOUND', messageKey: 'actions.errors.notFound' });
    }
    if (candidateSourceType !== 'audit_finding') {
        throw HttpError.conflict({ code: 'ACTIONS_ERRORS_RETEST_UNSUPPORTED', messageKey: 'actions.errors.retestUnsupported' });
    }
    // Delegate to the shipped start-audit service — full parse+own+enqueue
    // path, never bypassed.
    const run = await startAuditForSite({ accountId, siteId }, { auditsQueue: getAuditsQueue() });
    res.status(202).json({ actionId, run });
});
