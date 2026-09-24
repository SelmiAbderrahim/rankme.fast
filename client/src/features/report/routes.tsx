import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';
import { reportReducer } from './store/slice';

const loadReportRoute = async () => {
  const { ReportPage } = await import('./components/ReportPage');

  rootReducer.inject({ reducerPath: 'report', reducer: reportReducer });

  return {
    element: (
      <RequireVerified>
        <ReportPage />
      </RequireVerified>
    ),
  };
};

export const reportRoutes: RouteObject[] = [
  {
    path: 'sites/:siteId/report',
    lazy: loadReportRoute,
  },
  {
    path: 'sites/:siteId/report/:runId',
    lazy: loadReportRoute,
  },
];
