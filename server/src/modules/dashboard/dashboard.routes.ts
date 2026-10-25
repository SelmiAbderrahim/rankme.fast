import { Router } from 'express';
import { siteHealth, siteSummaries } from './dashboard.controller.js';

/** Auth and verification are applied at the app mount point. */
export const dashboardRouter: Router = Router();
dashboardRouter.get('/site-summaries', siteSummaries);
dashboardRouter.get('/site-health', siteHealth);
