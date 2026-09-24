import { Navigate, useParams, type RouteObject } from 'react-router-dom';

/**
 * `/sites/:siteId/ai-visibility` → the unified workspace tab
 * (`/sites/:siteId?tab=ai-visibility`). The panel lives in the workspace; the
 * old path stays as a `replace` redirect so existing links keep working.
 */
const AiVisibilityRedirect = () => {
  const { siteId } = useParams<{ siteId: string }>();
  return <Navigate to={`/sites/${siteId}?tab=ai-visibility`} replace />;
};

export const aiVisibilityRoutes: RouteObject[] = [
  { path: 'sites/:siteId/ai-visibility', element: <AiVisibilityRedirect /> },
];
