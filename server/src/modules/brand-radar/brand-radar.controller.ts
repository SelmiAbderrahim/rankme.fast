/**
 * Brand Radar controllers. Thin: parse with zod,
 * delegate to the service, serialize. Cross-account misses surface as 404 from
 * the service — never 403.
 */
import type { Request, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { getBrandRadarQueue } from './brand-radar.holder.js';
import { createScanBody, listMentionsQuery, listScansQuery, previewBody, scanIdParam, siteIdParams, } from './brand-radar.schemas.js';
import { createScan, getScan, listScanMentions, listScans, previewSpend, BRAND_RADAR_NOT_FOUND_KEY, } from './brand-radar.service.js';
/**
 * Site-nested route param. Like `loadOwnedSite`, a malformed id is a plain
 * miss — indistinguishable from a well-formed id on another account — so it
 * answers 404 rather than 400 and leaks no existence signal.
 */
function requireSiteId(req: Request): string {
    const parsed = siteIdParams.safeParse(req.params);
    if (!parsed.success)
        throw HttpError.notFound({ code: 'BRAND_RADAR_NOT_FOUND', messageKey: BRAND_RADAR_NOT_FOUND_KEY });
    return parsed.data.siteId;
}
export const previewBrandRadarScanHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const siteId = requireSiteId(req);
    // Preview takes the same inputs as create, so a malformed body is a 400
    // here too even though a single scan is always priced the same.
    previewBody.parse(req.body);
    res.status(200).json(await previewSpend(accountId, siteId));
});
export const createBrandRadarScanHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const siteId = requireSiteId(req);
    const body = createScanBody.parse(req.body);
    res.status(202).json(await createScan(accountId, siteId, {
        ...body,
        outputLocale: toSupportedLocale(req.language),
    }, {
        queue: getBrandRadarQueue(),
    }));
});
export const listBrandRadarScansHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const siteId = requireSiteId(req);
    const query = listScansQuery.parse(req.query);
    res.status(200).json(await listScans(accountId, siteId, query));
});
export const getBrandRadarScanHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = scanIdParam.parse(req.params);
    res.status(200).json(await getScan(accountId, id));
});
export const listBrandRadarMentionsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    // The inventory read never distinguishes "malformed id" from "not yours":
    // a non-hex id is a miss, exactly like a well-formed id on another
    // account (mirrors `loadOwnedSite`).
    const params = scanIdParam.safeParse(req.params);
    if (!params.success)
        throw HttpError.notFound({ code: 'BRAND_RADAR_NOT_FOUND', messageKey: BRAND_RADAR_NOT_FOUND_KEY });
    const query = listMentionsQuery.parse(req.query);
    res
        .status(200)
        .json(await listScanMentions(accountId, params.data.id, query));
});
