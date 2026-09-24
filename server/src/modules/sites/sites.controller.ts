import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { allowedTeamSiteIds } from '../../shared/middleware/team-site-access.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { scheduleGoogleSiteAutoMatch } from '../google-connections/index.js';
import { createSiteSchema, listSitesQuerySchema, siteIdParamsSchema, updateSiteSchema, } from './sites.schema.js';
import { createSite, deleteSite, getSite, listSites, pauseSite, resumeSite, updateSite, } from './sites.service.js';
export const create: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = createSiteSchema.parse(req.body);
    const site = await createSite(accountId, body);
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'site.create',
        targetType: 'site',
        targetId: site.id,
        ip: extractIp(req),
        metadata: { domain: site.domain },
    });
    await scheduleGoogleSiteAutoMatch(accountId, site.id);
    sendLocalizedMessage(req, res, 201, 'sites.created', { site });
});
export const list: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = listSitesQuerySchema.parse(req.query);
    const page = await listSites(accountId, query, {
        allowedSiteIds: allowedTeamSiteIds(req),
    });
    res.status(200).json(page);
});
export const getOne: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = siteIdParamsSchema.parse(req.params);
    const site = await getSite(accountId, id);
    res.status(200).json({ site });
});
export const update: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = siteIdParamsSchema.parse(req.params);
    const body = updateSiteSchema.parse(req.body);
    const site = await updateSite(accountId, id, body);
    sendLocalizedMessage(req, res, 200, 'sites.updated', { site });
});
export const pause: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = siteIdParamsSchema.parse(req.params);
    const site = await pauseSite(accountId, id);
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'site.pause',
        targetType: 'site',
        targetId: site.id,
        ip: extractIp(req),
        metadata: { domain: site.domain },
    });
    sendLocalizedMessage(req, res, 200, 'sites.paused', { site });
});
export const resume: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = siteIdParamsSchema.parse(req.params);
    const site = await resumeSite(accountId, id);
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'site.resume',
        targetType: 'site',
        targetId: site.id,
        ip: extractIp(req),
        metadata: { domain: site.domain },
    });
    await scheduleGoogleSiteAutoMatch(accountId, site.id);
    sendLocalizedMessage(req, res, 200, 'sites.resumed', { site });
});
export const remove: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = siteIdParamsSchema.parse(req.params);
    await deleteSite(accountId, id, { ip: extractIp(req) });
    sendLocalizedMessage(req, res, 200, 'sites.deleted', {});
});
