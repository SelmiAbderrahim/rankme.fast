import type { RouteObject } from 'react-router-dom';
import { DocsLayout } from './components/DocsLayout';
import { DocsError } from './components/DocsError';
import { docsArticleLoader, docsCatalogLoader, docsSearchLoader } from './loaders';

export const docsRoute: RouteObject = {
  path: 'docs',
  element: <DocsLayout />,
  loader: docsCatalogLoader,
  errorElement: <DocsError />,
  children: [
    {
      index: true,
      loader: docsSearchLoader,
      lazy: async () => {
        const { DocsHome } = await import('./components/DocsHome');
        return { Component: DocsHome };
      },
    },
    {
      path: ':slug',
      loader: docsArticleLoader,
      lazy: async () => {
        const { DocsArticle } = await import('./components/DocsArticle');
        return { Component: DocsArticle };
      },
    },
  ],
};
