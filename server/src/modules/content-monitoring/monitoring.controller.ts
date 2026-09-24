/**
 * Public-page change monitoring — HTTP controllers.
 *
 * Thin `asyncHandler` handlers: parse (zod) → resolve deps (holders) → delegate
 * to the service → JSON. Every handler is owner-scoped through the service
 * (`Site.findOne({ _id, accountId })` → 404, never 403). The kill switches live
 * in `createMonitor` (spec-defined ordering); reads + delete stay reachable so a
 * user can always inspect and tear down existing monitors.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { db as productionDb } from '../../db/client.js';
import { getContentMonitorDb, getContentMonitorProvider, getContentMonitorQueue, } from './monitoring.holders.js';
import { createMonitor, deleteMonitor, getMonitor, listMonitors, pauseMonitor, resumeMonitor, type MonitoringDeps, } from './monitoring.service.js';
import { changeFeedQuerySchema, createMonitorBodySchema, listMonitorsQuerySchema, monitorIdParamsSchema, siteIdParamsSchema, } from './monitoring.schemas.js';
export function resolveContentMonitorDb() {
    return getContentMonitorDb() ?? productionDb;
}
function resolveDeps(): MonitoringDeps {
    return {
        db: resolveContentMonitorDb(),
        queue: getContentMonitorQueue(),
        provider: getContentMonitorProvider(),
    };
}
function requireUser(req: Request) {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user;
}
/** POST /:siteId/content-monitoring/monitors — create a monitor. */
export const createMonitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = createMonitorBodySchema.parse(req.body);
    const result = await createMonitor({
        accountId: accountId,
        ownerUserId: user.id,
        siteId: params.siteId,
        body,
    }, resolveDeps());
    res.status(result.duplicate ? 200 : 201).json(result);
});
/** GET /:siteId/content-monitoring/monitors — list monitors + allowance. */
export const listMonitorsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listMonitorsQuerySchema.parse(req.query);
    const result = await listMonitors({
        accountId: accountId,
        siteId: params.siteId,
        status: query.status,
    });
    res.status(200).json(result);
});
/** GET /:siteId/content-monitoring/monitors/:monitorId — monitor + change feed. */
export const getMonitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = monitorIdParamsSchema.parse(req.params);
    const query = changeFeedQuerySchema.parse(req.query);
    const result = await getMonitor({
        db: resolveContentMonitorDb(),
        accountId: accountId,
        siteId: params.siteId,
        monitorId: params.monitorId,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    res.status(200).json(result);
});
/** POST /:siteId/content-monitoring/monitors/:monitorId/pause. */
export const pauseMonitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = monitorIdParamsSchema.parse(req.params);
    const monitor = await pauseMonitor({ accountId: accountId, siteId: params.siteId, monitorId: params.monitorId }, resolveDeps());
    res.status(200).json({ monitor });
});
/** POST /:siteId/content-monitoring/monitors/:monitorId/resume. */
export const resumeMonitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = monitorIdParamsSchema.parse(req.params);
    const monitor = await resumeMonitor({ accountId: accountId, siteId: params.siteId, monitorId: params.monitorId }, resolveDeps());
    res.status(200).json({ monitor });
});
/** DELETE /:siteId/content-monitoring/monitors/:monitorId. */
export const deleteMonitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = monitorIdParamsSchema.parse(req.params);
    await deleteMonitor({ accountId: accountId, siteId: params.siteId, monitorId: params.monitorId }, resolveDeps());
    res.status(200).json({ ok: true });
});
