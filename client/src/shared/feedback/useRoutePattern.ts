import { useContext } from 'react';
import { UNSAFE_DataRouterStateContext, UNSAFE_RouteContext } from 'react-router-dom';

/** Read declared paths only. Data-router matches retain the failing child's
 * path even when an error renders at an ancestor boundary. The route context
 * also supports declarative routers used by isolated shell renders. */
export function useRoutePattern(): string {
  const state = useContext(UNSAFE_DataRouterStateContext);
  const context = useContext(UNSAFE_RouteContext);
  // A small isolated shell (and a route error while a declarative router is
  // being replaced) may have neither context. The report remains useful with
  // the harmless root pattern; never fall back to location data.
  // The route context always has a default value, so it is never missing.
  const matches = state?.matches ?? context.matches;
  // Every step returns a non-empty path, so the root seed is the floor.
  return matches.reduce((pattern, { route }) => {
    if (!route.path) return pattern;
    return route.path.startsWith('/')
      ? route.path
      : `${pattern.replace(/\/$/u, '')}/${route.path}`;
  }, '/');
}
