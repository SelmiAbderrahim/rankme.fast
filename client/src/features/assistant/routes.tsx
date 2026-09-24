import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';

const injectAssistantReducer = async () => {
  const { assistantReducer } = await import('./store/slice');
  rootReducer.inject({ reducerPath: 'assistant', reducer: assistantReducer });
};

export const assistantRoutes: RouteObject[] = [
  {
    path: 'assistant',
    lazy: async () => {
      const [{ AssistantPage }] = await Promise.all([
        import('./components/AssistantPage'),
        injectAssistantReducer(),
      ]);

      return {
        element: (
          <RequireVerified>
            <AssistantPage />
          </RequireVerified>
        ),
      };
    },
  },
];
