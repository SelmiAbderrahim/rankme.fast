import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';

export const keywordResearchRoutes: RouteObject[] = [
  {
    path: 'keyword-research',
    lazy: async () => {
      const [
        { KeywordResearchPage },
        { keywordResearchReducer },
      ] = await Promise.all([
        import('./components/KeywordResearchPage'),
        import('./store/slice'),
      ]);

      rootReducer.inject({
        reducerPath: 'keywordResearch',
        reducer: keywordResearchReducer,
      });

      return {
        element: (
          <RequireVerified>
            <KeywordResearchPage />
          </RequireVerified>
        ),
      };
    },
  },
  {
    path: 'keyword-research/live-trends',
    lazy: async () => {
      const [
        { KeywordLiveTrendsPage },
        { keywordResearchReducer },
      ] = await Promise.all([
        import('./components/KeywordLiveTrendsPage'),
        import('./store/slice'),
      ]);

      rootReducer.inject({
        reducerPath: 'keywordResearch',
        reducer: keywordResearchReducer,
      });

      return {
        element: (
          <RequireVerified>
            <KeywordLiveTrendsPage />
          </RequireVerified>
        ),
      };
    },
  },
  {
    path: 'keyword-research/history',
    lazy: async () => {
      const [
        { KeywordResearchHistoryPage },
        { keywordResearchReducer },
      ] = await Promise.all([
        import('./components/KeywordResearchHistoryPage'),
        import('./store/slice'),
      ]);

      rootReducer.inject({
        reducerPath: 'keywordResearch',
        reducer: keywordResearchReducer,
      });

      return {
        element: (
          <RequireVerified>
            <KeywordResearchHistoryPage />
          </RequireVerified>
        ),
      };
    },
  },
];
