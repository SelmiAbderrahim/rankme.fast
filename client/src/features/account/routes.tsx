import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';

export const accountRoutes: RouteObject[] = [
  {
    path: 'profile',
    lazy: async () => {
      const [
        { AccountPage },
        { settingsReducer },
        { apiKeysReducer },
        { brandingReducer },
        { mcpPermissionsReducer },
      ] = await Promise.all([
        import('./components/AccountPage'),
        import('@features/settings/store/slice'),
        import('@features/settings/store/apiKeysSlice'),
        import('@features/settings/store/brandingSlice'),
        import('@features/settings/store/mcpPermissionsSlice'),
      ]);

      rootReducer.inject({ reducerPath: 'settings', reducer: settingsReducer });
      rootReducer.inject({ reducerPath: 'apiKeys', reducer: apiKeysReducer });
      rootReducer.inject({ reducerPath: 'branding', reducer: brandingReducer });
      rootReducer.inject({ reducerPath: 'mcpPermissions', reducer: mcpPermissionsReducer });

      return {
        element: (
          <RequireVerified>
            <AccountPage />
          </RequireVerified>
        ),
      };
    },
  },
];
