import { Navigate, useLocation, useParams, type RouteObject } from 'react-router-dom';
import { DEFAULT_CONTENT_SUB_VIEW, isContentSubView } from './types';

const ContentIntelligenceRedirect = () => {
  const { siteId } = useParams<{ siteId: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', 'content');
  const rawView = params.get('view');
  if (rawView !== null && !isContentSubView(rawView)) {
    params.set('view', DEFAULT_CONTENT_SUB_VIEW);
  }
  return (
    <Navigate
      to={{
        pathname: `/sites/${encodeURIComponent(siteId!)}`,
        search: params.toString(),
      }}
      replace
    />
  );
};

export const contentIntelligenceRoutes: RouteObject[] = [
  { path: 'sites/:siteId/content-intelligence', element: <ContentIntelligenceRedirect /> },
];
