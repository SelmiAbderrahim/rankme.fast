/**
 * Geogrid HTTP controllers.
 *
 * Thin: parse → delegate → JSON. Every handler is wrapped by `asyncHandler`,
 * so a thrown `HttpError` reaches the global error handler with its localized
 * message key intact.
 */
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getGeogridDb, getGeogridQueue } from './geogrid.holder.js';
import { geogridDefinitionSchema, geogridScanIdParamSchema, geogridSiteParamSchema, listGeogridScansQuerySchema, } from './geogrid.schema.js';
import { createGeogridScan, getGeogridScan, listGeogridScans, previewGeogridScan, } from './geogrid.service.js';
export const previewGeogridScanHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = geogridSiteParamSchema.parse(req.params);
    const body = geogridDefinitionSchema.parse(req.body);
    res
        .status(200)
        .json(await previewGeogridScan(accountId, siteId, body, { db: getGeogridDb() }));
});
export const createGeogridScanHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = geogridSiteParamSchema.parse(req.params);
    const body = geogridDefinitionSchema.parse(req.body);
    res.status(202).json(await createGeogridScan(accountId, siteId, body, {
        db: getGeogridDb(),
        queue: getGeogridQueue(),
    }));
});
export const listGeogridScansHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = geogridSiteParamSchema.parse(req.params);
    const query = listGeogridScansQuerySchema.parse(req.query);
    res
        .status(200)
        .json(await listGeogridScans(accountId, siteId, query, { db: getGeogridDb() }));
});
export const getGeogridScanHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, scanId } = geogridScanIdParamSchema.parse(req.params);
    res
        .status(200)
        .json(await getGeogridScan(accountId, siteId, scanId, { db: getGeogridDb() }));
});
