import { Navigate, useParams, type RouteObject } from 'react-router-dom';

export const TrafficInsightsRedirect = () => {
  const { siteId } = useParams<{ siteId: string }>();
  return <Navigate to={`/sites/${siteId ?? ''}?tab=traffic`} replace />;
};

export const trafficRoutes: RouteObject[] = [
  { path: 'sites/:siteId/traffic', element: <TrafficInsightsRedirect /> },
];
