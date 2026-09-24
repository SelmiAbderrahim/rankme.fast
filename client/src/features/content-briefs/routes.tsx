import type { RouteObject } from 'react-router-dom';
import { ContentBriefEditorPage } from './components/ContentBriefEditorPage';

export const contentBriefRoutes: RouteObject[] = [
  {
    path: 'sites/:siteId/content-briefs/:briefId/editor',
    element: <ContentBriefEditorPage />,
  },
];
