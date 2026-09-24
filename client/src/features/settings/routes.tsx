import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';

export const settingsRoutes: RouteObject[] = [
  {
    path: 'settings/notifications',
    lazy: async () => {
      const [
        { NotificationPreferences },
        { settingsReducer },
        { apiKeysReducer },
        { brandingReducer },
      ] = await Promise.all([
        import('./components/NotificationPreferences'),
        import('./store/slice'),
        import('./store/apiKeysSlice'),
        import('./store/brandingSlice'),
      ]);

      rootReducer.inject({ reducerPath: 'settings', reducer: settingsReducer });
      rootReducer.inject({ reducerPath: 'apiKeys', reducer: apiKeysReducer });
      rootReducer.inject({ reducerPath: 'branding', reducer: brandingReducer });

      return {
        element: (
          <RequireVerified>
            <NotificationPreferences />
          </RequireVerified>
        ),
      };
    },
  },
];
