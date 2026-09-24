/**
 * Content inventory + cannibalization — HTTP controllers.
 *
 * Thin `asyncHandler` handlers: parse (zod) → delegate to the service → JSON.
 * Every handler is owner-scoped through the service (`Site.findOne({ _id,
 * accountId })` → 404, never 403). Reads never write, never enqueue, never
 * crawl. The kill switch lives in `startInventoryRun` (spec-defined ordering),
 * so `cancel` stays open — an in-flight run must always be cancellable.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { db as productionDb } from '../../db/client.js';
import { getContentIntelligenceDb } from './content-intelligence.holders.js';
import { getContentInventoryQueue } from './content-intelligence.holders.js';
import { cancelInventoryRun, getInventoryRun, listInventoryRuns, startInventoryRun, } from './inventory.service.js';
import { inventoryRunParamsSchema, listInventoryQuerySchema, siteIdParamsSchema, startInventoryBodySchema, } from './inventory.schemas.js';
export function resolveInventoryDb() {
    return getContentIntelligenceDb() ?? productionDb;
}
function requireUser(req: Request) {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user;
}
/** POST /api/sites/:siteId/content-intelligence/inventory — start a run. */
export const startInventoryController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = startInventoryBodySchema.parse(req.body);
    const result = await startInventoryRun({
        accountId: accountId,
        ownerUserId: user.id,
        siteId: params.siteId,
        body,
    }, { db: resolveInventoryDb(), queue: getContentInventoryQueue() });
    sendLocalizedMessage(req, res, 202, 'contentIntelligence.inventory.messages.started', {
        runId: result.runId,
        status: result.status,
        reservedBlocks: result.reservedBlocks,
        duplicate: result.duplicate,
    });
});
/** GET /api/sites/:siteId/content-intelligence/inventory — paginated list. */
export const listInventoryController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listInventoryQuerySchema.parse(req.query);
    const locale = toSupportedLocale(req.language);
    const page = await listInventoryRuns({
        accountId: accountId,
        siteId: params.siteId,
        limit: query.limit,
        locale,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    res.setHeader('Content-Language', locale);
    res.status(200).json(page);
});
/** GET /api/sites/:siteId/content-intelligence/inventory/:runId — one run. */
export const getInventoryController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = inventoryRunParamsSchema.parse(req.params);
    const locale = toSupportedLocale(req.language);
    const run = await getInventoryRun({
        accountId: accountId,
        runId: params.runId,
        locale,
    });
    res.setHeader('Content-Language', locale);
    res.status(200).json(run);
});
/** POST /api/sites/:siteId/content-intelligence/inventory/:runId/cancel. */
export const cancelInventoryController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = inventoryRunParamsSchema.parse(req.params);
    await cancelInventoryRun({ accountId: accountId, runId: params.runId });
    res.status(202).json({ ok: true });
});
