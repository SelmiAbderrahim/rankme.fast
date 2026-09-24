import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { allowedTeamSiteIds, assertTeamSiteAccess, } from '../../shared/middleware/team-site-access.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { getCompetitorsDb, getTrafficSnapshotsQueue, } from './competitors.holder.js';
import { createTrafficSnapshotSchema, trafficSnapshotCompareQuerySchema, trafficSnapshotListQuerySchema, trafficSnapshotParamsSchema, trafficSnapshotPreviewSchema, trafficSnapshotReadQuerySchema, } from './traffic-snapshots.schema.js';
import { enqueueSnapshot, getSnapshot, listSnapshots, } from './traffic-snapshots.service.js';
import { compareTrafficSnapshots } from './traffic-snapshots.compare.js';
import { previewTrafficSnapshotSpend } from './traffic-snapshots.preview.js';
import { localizeSemanticCopy, toSupportedLocale, } from '../../shared/i18n/index.js';
export const createTrafficSnapshotHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = createTrafficSnapshotSchema.parse(req.body);
    const allowedSiteIds = allowedTeamSiteIds(req);
    // A selected-scope teammate cannot create an account-wide snapshot: that
    // stored result would have no Site boundary to authorize on later reads.
    if (allowedSiteIds !== null && !body.siteId) {
        throw HttpError.notFound({ code: 'TRAFFIC_INSIGHTS_ERRORS_NOT_FOUND', messageKey: 'trafficInsights.errors.notFound' });
    }
    if (body.siteId)
        assertTeamSiteAccess(req, body.siteId);
    const result = await enqueueSnapshot(accountId, body, {
        db: getCompetitorsDb(),
        queue: getTrafficSnapshotsQueue(),
    });
    res.status(202).json(result);
});
export const listTrafficSnapshotsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = trafficSnapshotListQuerySchema.parse(req.query);
    res
        .status(200)
        .json(await listSnapshots(accountId, query, getCompetitorsDb(), allowedTeamSiteIds(req)));
});
export const getTrafficSnapshotHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = trafficSnapshotParamsSchema.parse(req.params);
    const { siteId } = trafficSnapshotReadQuerySchema.parse(req.query);
    res
        .status(200)
        .json(await getSnapshot(accountId, id, getCompetitorsDb(), siteId));
});
export const previewTrafficSnapshotsHandler: RequestHandler = asyncHandler(async (req, res) => {
    requireAccountId(req);
    trafficSnapshotPreviewSchema.parse(req.body);
    res.status(200).json(previewTrafficSnapshotSpend());
});
export const compareTrafficSnapshotsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = trafficSnapshotCompareQuerySchema.parse(req.query);
    const comparison = await compareTrafficSnapshots(accountId, query, getCompetitorsDb(), allowedTeamSiteIds(req));
    const locale = toSupportedLocale(req.language);
    const warning = query.clamped
        ? localizeSemanticCopy(locale, 'trafficInsights.compare.clamped', { count: 5 })
        : null;
    if (query.clamped) {
        res.setHeader('X-RankMeFast-Warning', 'RESULT_SET_CLAMPED');
        res.setHeader('Warning', '299 RankMeFast "RESULT_SET_CLAMPED"');
    }
    res.setHeader('Content-Language', locale);
    res.status(200).json({
        ...comparison,
        warning: warning
            ? {
                code: 'RESULT_SET_CLAMPED',
                messageKey: warning.messageKey,
                messageVars: { count: 5 },
                message: warning.message,
            }
            : null,
    });
});
