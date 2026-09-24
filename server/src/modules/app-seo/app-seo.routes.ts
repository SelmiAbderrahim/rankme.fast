import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { deleteAppProfileController, listAppProfilesController, registerAppProfileController, } from './app-seo.controller.js';
import { createAppKeywordRouter } from './keywords.routes.js';
import { createAppListingRouter } from './listing.routes.js';
import { createAppChartRouter } from './charts.routes.js';
import { createAppResearchRouter } from './research.routes.js';
import { createAppReviewRouter } from './reviews.routes.js';
import { createAppSeoCompareRouter } from './compare.routes.js';
/**
 * Site-nested App SEO router. Registration routes land in checklist item 4;
 * later waves append their own sub-routers through this single mounted shell.
 */
export function createAppSeoRouter(): Router {
    const router = Router({ mergeParams: true });
    const createLimiter = createBatchRateLimiter('app_seo_create');
    const pollLimiter = createBatchRateLimiter('app_seo_poll');
    router.post('/profiles', createLimiter, registerAppProfileController);
    router.get('/profiles', pollLimiter, listAppProfilesController);
    router.delete('/profiles/:profileId', createLimiter, deleteAppProfileController);
    router.use('/keywords', createAppKeywordRouter({ createLimiter, pollLimiter }));
    router.use('/listing', createAppListingRouter({ createLimiter, pollLimiter }));
    router.use('/charts', createAppChartRouter({ createLimiter, pollLimiter }));
    router.use('/research', createAppResearchRouter({ createLimiter, pollLimiter }));
    router.use('/reviews', createAppReviewRouter({ createLimiter, pollLimiter }));
    router.use('/compare', createAppSeoCompareRouter(pollLimiter));
    return router;
}
