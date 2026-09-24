import { Navigate, useLocation, useParams, type RouteObject } from 'react-router-dom';

/**
 * `/sites/:siteId/competitors` → the unified workspace tab
 * (`/sites/:siteId?tab=competitors`). The panel lives in the workspace; the old
 * path stays as a `replace` redirect so existing links keep working.
 */
const CompetitorsRedirect = () => {
  const { siteId } = useParams<{ siteId: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', 'competitors');
  if (!params.has('view')) params.set('view', 'overview');
  return <Navigate to={`/sites/${siteId}?${params.toString()}`} replace />;
};

export const competitorsRoutes: RouteObject[] = [
  { path: 'sites/:siteId/competitors', element: <CompetitorsRedirect /> },
];
