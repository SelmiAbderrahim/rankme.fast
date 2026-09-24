import { Navigate, useParams, type RouteObject } from 'react-router-dom';

/**
 * `/sites/:siteId/local-seo` → the unified workspace tab
 * (`/sites/:siteId?tab=local-seo`). The panel lives in the workspace; the old
 * path stays as a `replace` redirect so existing links keep working.
 */
const LocalSeoRedirect = () => {
  const { siteId } = useParams<{ siteId: string }>();
  return <Navigate to={`/sites/${siteId}?tab=local-seo`} replace />;
};

export const localSeoRoutes: RouteObject[] = [
  { path: 'sites/:siteId/local-seo', element: <LocalSeoRedirect /> },
];
