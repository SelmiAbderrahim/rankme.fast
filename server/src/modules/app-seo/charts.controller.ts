import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { appSeoSiteParamsSchema } from './app-seo.schema.js';
import { appChartHistoryQuerySchema, appChartListQuerySchema, appChartRecheckBodySchema, appChartSubscriptionParamsSchema, createAppChartSubscriptionBodySchema, } from './charts.schema.js';
import { createAppChartSubscription, deleteAppChartSubscription, getAppChartHistory, listAppChartSubscriptions, recheckAppChartSubscription, } from './charts.service.js';
import { getAppSeoDb } from './app-seo.holder.js';
export const createAppChartSubscriptionController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const body = createAppChartSubscriptionBodySchema.parse(req.body);
    const subscription = await createAppChartSubscription({
        accountId,
        siteId: params.siteId,
        subscription: body,
    });
    res.status(201).json({ subscription });
});
export const listAppChartSubscriptionsController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = appChartListQuerySchema.parse(req.query);
    res.status(200).json(await listAppChartSubscriptions({
        accountId,
        siteId: params.siteId,
        profileId: query.profileId,
    }, getAppSeoDb()));
});
export const deleteAppChartSubscriptionController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appChartSubscriptionParamsSchema.parse(req.params);
    await deleteAppChartSubscription({ accountId, ...params });
    res.status(204).end();
});
export const recheckAppChartSubscriptionController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appChartSubscriptionParamsSchema.parse(req.params);
    const body = appChartRecheckBodySchema.parse(req.body);
    const result = await recheckAppChartSubscription({ accountId, ...params, confirm: body.confirm }, getAppSeoDb());
    res.status(body.confirm && result.queued ? 202 : 200).json(result);
});
export const appChartHistoryController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appChartSubscriptionParamsSchema.parse(req.params);
    const query = appChartHistoryQuerySchema.parse(req.query);
    const items = await getAppChartHistory({ accountId, ...params, limit: query.limit }, getAppSeoDb());
    res.status(200).json({ items });
});
