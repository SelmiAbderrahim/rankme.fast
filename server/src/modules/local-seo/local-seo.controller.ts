import type { RequestHandler } from 'express';
import { CooldownError } from '../../shared/cooldown/index.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getLocalSeoCooldown, getLocalSeoDb, getLocalSeoProvider, getLocalSeoRankProvider, } from './local-seo.holder.js';
import { keywordRankParamsSchema, siteIdParamsSchema } from './local-seo.schema.js';
import { checkLocalPackRank, readLatestSnapshot, refreshLocalListings } from './local-seo.service.js';
function mapCooldown(req: Parameters<RequestHandler>[0], err: CooldownError): never {
    throw HttpError.tooMany({
        code: 'LOCAL_SEO_REFRESH_COOLDOWN',
        messageKey: 'localSeo.errors.refreshCooldown',
        vars: { seconds: Math.ceil(err.retryAfterMs / 1000) },
    }, { retryAfterMs: err.retryAfterMs });
}
export const readLocalSeoHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await readLatestSnapshot({ accountId, siteId }, { db: getLocalSeoDb() });
    res.status(200).json(result);
});
export const refreshLocalSeoHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    try {
        const result = await refreshLocalListings({ accountId, siteId }, {
            db: getLocalSeoDb(),
            provider: getLocalSeoProvider(),
            rankProvider: getLocalSeoRankProvider(),
            cooldown: getLocalSeoCooldown(),
        });
        res.status(200).json(result);
    }
    catch (err) {
        if (err instanceof CooldownError)
            mapCooldown(req, err);
        throw err;
    }
});
export const localPackRankHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, keywordId } = keywordRankParamsSchema.parse(req.params);
    const result = await checkLocalPackRank({ accountId, siteId, keywordId }, {
        db: getLocalSeoDb(),
        provider: getLocalSeoProvider(),
        rankProvider: getLocalSeoRankProvider(),
    });
    res.status(200).json(result);
});
