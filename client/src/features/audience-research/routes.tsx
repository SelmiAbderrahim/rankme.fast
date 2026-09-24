import type { RouteObject } from 'react-router-dom';

/**
 * The workspace is a tab on the shared site-workspace page
 * (`/sites/:siteId?tab=audience-research`), not a standalone route — see
 * `.claude/rules/url-tab-state.md`. No route to register.
 */
export const audienceResearchRoutes: RouteObject[] = [];
