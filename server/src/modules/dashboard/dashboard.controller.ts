import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { allowedTeamSiteIds } from '../../shared/middleware/team-site-access.js';
import { getRanksDb } from '../ranks/index.js';
import { getSiteHealth, getSiteSummaries, SITE_SUMMARY_MAX_IDS } from './dashboard.service.js';

const querySchema = z.object({
  ids: z.string().max(SITE_SUMMARY_MAX_IDS * 25)
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(24)).max(SITE_SUMMARY_MAX_IDS)),
});

export const siteSummaries: RequestHandler = asyncHandler(async (req, res) => {
  const { ids } = querySchema.parse(req.query);
  const result = await getSiteSummaries({ accountId: requireAccountId(req),
    allowedSiteIds: allowedTeamSiteIds(req), siteIds: ids }, getRanksDb());
  res.status(200).json(result);
});

export const siteHealth: RequestHandler = asyncHandler(async (req, res) => {
  res.status(200).json(await getSiteHealth({ accountId: requireAccountId(req),
    allowedSiteIds: allowedTeamSiteIds(req) }, getRanksDb()));
});
