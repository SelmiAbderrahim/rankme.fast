import type { RouteObject } from 'react-router-dom';
import { RequireVerified } from '@features/auth';
import { Dashboard } from './components/Dashboard';

export const dashboardRoutes: RouteObject[] = [
  {
    path: 'dashboard',
    element: (
      <RequireVerified>
        <Dashboard />
      </RequireVerified>
    ),
  },
];
