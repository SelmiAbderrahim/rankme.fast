import { createBrowserRouter } from 'react-router-dom';
import { routes } from './routes';

export { routes };

/** Build the browser data router (client entry). */
export function createAppRouter() {
  return createBrowserRouter(routes);
}

type AppRouter = ReturnType<typeof createAppRouter>;

/**
 * Wait until React Router has resolved the initial lazy route module.
 *
 * The server static handler resolves route.lazy() before it emits HTML, while
 * createBrowserRouter starts that work asynchronously. Hydrating before the
 * browser router is initialized would therefore render RouterProvider's
 * fallback against the complete server tree and force a whole-root client
 * render. CSR entries deliberately keep their visible fallback; only the SSR
 * bootstrap calls this helper.
 */
export async function waitForAppRouterInitialization(router: AppRouter): Promise<void> {
  if (router.state.initialized) return;

  await new Promise<void>((resolve) => {
    const unsubscribe = router.subscribe((state) => {
      if (!state.initialized) return;
      unsubscribe();
      resolve();
    });
  });
}
