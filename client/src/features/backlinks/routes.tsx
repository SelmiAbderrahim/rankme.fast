import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';
import { backlinksReducer } from './store/slice';

/** Standalone six-tab link-intelligence workspace with lazy reducer injection. */
export const backlinksRoutes: RouteObject[] = [
  {
    path: 'sites/:siteId/backlinks',
    lazy: async () => {
      const { BacklinksWorkspaceRoute } = await import('./components/BacklinksWorkspaceRoute');
      rootReducer.inject({ reducerPath: 'backlinks', reducer: backlinksReducer });
      return {
        element: (
          <RequireVerified>
            <BacklinksWorkspaceRoute />
          </RequireVerified>
        ),
      };
    },
  },
];
