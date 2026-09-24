import type { RequestHandler } from 'express';
import { CooldownError } from '../../shared/cooldown/index.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getCompetitorProvider, getCompetitorsCooldown, getCompetitorsDb, } from './competitors.holder.js';
import { intersectionQuerySchema, siteIdParamsSchema, techStackParamsSchema, } from './competitors.schema.js';
import { getCompetitorTechStack, getIntersection, listCompetitors, refreshCompetitors, } from './competitors.service.js';
export const listHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await listCompetitors({ accountId, siteId }, { db: getCompetitorsDb(), provider: getCompetitorProvider() });
    res.status(200).json(result);
});
export const refreshHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    try {
        const result = await refreshCompetitors({ accountId, siteId }, {
            db: getCompetitorsDb(),
            provider: getCompetitorProvider(),
            cooldown: getCompetitorsCooldown(),
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
                code: 'COMPETITORS_REFRESH_COOLDOWN',
                messageKey: 'competitors.errors.refreshCooldown',
                vars: { seconds: Math.ceil(err.retryAfterMs / 1000) },
            }, { retryAfterMs: err.retryAfterMs });
        }
        throw err;
    }
});
export const intersectionHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const query = intersectionQuerySchema.parse(req.query);
    const result = await getIntersection({
        accountId,
        siteId,
        competitor: query.competitor,
        ...(query.locationCode !== undefined
            ? { locationCode: query.locationCode }
            : {}),
        ...(query.languageCode !== undefined
            ? { languageCode: query.languageCode }
            : {}),
    }, { db: getCompetitorsDb(), provider: getCompetitorProvider() });
    res.status(200).json(result);
});
export const techStackHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, domain } = techStackParamsSchema.parse(req.params);
    const result = await getCompetitorTechStack({ accountId, siteId, competitorDomain: domain }, { db: getCompetitorsDb(), provider: getCompetitorProvider() });
    res.status(200).json(result);
});
