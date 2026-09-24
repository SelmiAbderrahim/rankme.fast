import type { RouteObject } from 'react-router-dom';
import { RequireVerified } from '@features/auth';
import { SitesPage } from './components/SitesPage';
import { SiteWorkspacePage } from './components/SiteWorkspacePage';

export const sitesRoutes: RouteObject[] = [
  {
    path: 'sites',
    element: (
      <RequireVerified>
        <SitesPage />
      </RequireVerified>
    ),
  },
  {
    path: 'sites/:siteId',
    element: (
      <RequireVerified>
        <SiteWorkspacePage />
      </RequireVerified>
    ),
  },
];
