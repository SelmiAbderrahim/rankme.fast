import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getAppSeoDb } from './app-seo.holder.js';
import { deleteAppProfile, listAppProfiles, registerAppProfile, } from './app-seo.service.js';
import { appSeoProfileParamsSchema, appSeoSiteParamsSchema, registerAppProfileBodySchema, } from './app-seo.schema.js';
export const registerAppProfileController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const profile = registerAppProfileBodySchema.parse(req.body);
    const created = await registerAppProfile({ accountId, siteId: params.siteId, profile });
    res.status(201).json({ profile: created });
});
export const listAppProfilesController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const items = await listAppProfiles({ accountId, siteId: params.siteId });
    res.status(200).json({ items });
});
export const deleteAppProfileController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoProfileParamsSchema.parse(req.params);
    await deleteAppProfile({
        accountId,
        siteId: params.siteId,
        profileId: params.profileId,
    }, { db: getAppSeoDb() });
    res.status(204).end();
});
