import type { RouteObject } from 'react-router-dom';

/** Resolve route modules for synchronous page assertions, retaining route metadata. */
export async function resolveLazyRoutes(routes: RouteObject[]): Promise<RouteObject[]> {
  return Promise.all(routes.map(async ({ lazy, children, ...route }) => ({
    ...route,
    ...(lazy ? await lazy() : {}),
    ...(children ? { children: await resolveLazyRoutes(children) } : {}),
  } as RouteObject)));
}
