import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';

/**
 * Alerts are account-level with a URL-backed site filter, so the
 * workspace mounts at the dashboard level rather than under `/sites/:siteId`.
 */
const injectAlertsReducer = async () => {
  const { alertsReducer } = await import('./store/slice');
  rootReducer.inject({ reducerPath: 'alerts', reducer: alertsReducer });
};

export const alertsRoutes: RouteObject[] = [
  {
    // `/alerts` is the public SSR landing page; keep the authenticated
    // workspace under the dashboard namespace so both surfaces are reachable.
    path: 'dashboard/alerts',
    lazy: async () => {
      const [{ AlertsPage }] = await Promise.all([
        import('./components/AlertsPage'),
        injectAlertsReducer(),
      ]);

      return {
        element: (
          <RequireVerified>
            <AlertsPage />
          </RequireVerified>
        ),
      };
    },
  },
];
