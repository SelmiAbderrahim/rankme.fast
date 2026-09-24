import type { RequestHandler } from 'express';
import { CooldownError } from '../../shared/cooldown/index.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getBacklinkProvider, getBacklinksCooldown, getBacklinksDb, } from './backlinks.holder.js';
import { backlinksListQuerySchema, siteIdParamsSchema, } from './backlinks.schema.js';
import { getBacklinkSummary, listBacklinksPaged, refreshBacklinkSummary, } from './backlinks.service.js';
export const DEFAULT_BACKLINKS_LIST_LIMIT = 100;
export const summaryHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await getBacklinkSummary({ accountId, siteId }, { db: getBacklinksDb(), provider: getBacklinkProvider() });
    res.status(200).json(result);
});
export const refreshHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    try {
        const result = await refreshBacklinkSummary({ accountId, siteId }, {
            db: getBacklinksDb(),
            provider: getBacklinkProvider(),
            cooldown: getBacklinksCooldown(),
        });
        res.status(200).json(result);
    }
    catch (err) {
        // Client-induced throttle, not a vendor outage → 429, never 503. The
        // localized descriptor carries the bounded `seconds` variable so the error
        // handler renders it in the request locale; `retryAfterMs` rides in
        // details for the client countdown.
        if (err instanceof CooldownError) {
            throw HttpError.tooMany({
                code: 'BACKLINKS_REFRESH_COOLDOWN',
                messageKey: 'backlinks.errors.refreshCooldown',
                vars: { seconds: Math.ceil(err.retryAfterMs / 1000) },
            }, { retryAfterMs: err.retryAfterMs });
        }
        throw err;
    }
});
export const listHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const query = backlinksListQuerySchema.parse(req.query);
    const result = await listBacklinksPaged({
        accountId,
        siteId,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit ?? DEFAULT_BACKLINKS_LIST_LIMIT,
    }, {
        db: getBacklinksDb(),
        provider: getBacklinkProvider(),
    });
    res.status(200).json(result);
});
