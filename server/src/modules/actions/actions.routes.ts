import { Router } from 'express';
import { getActionHistoryHandler, listActions, mutateActionStateHandler, retestActionHandler, } from './actions.controller.js';
// Router mounted under the site-scoped path (`/api/sites/:siteId/actions`).
// `mergeParams: true` propagates the `:siteId` up from the parent router.
export const actionsSiteRouter = Router({ mergeParams: true });
actionsSiteRouter.get('/', listActions);
actionsSiteRouter.get('/:actionId/history', getActionHistoryHandler);
actionsSiteRouter.post('/:actionId/state', mutateActionStateHandler);
actionsSiteRouter.post('/:actionId/retest', retestActionHandler);
