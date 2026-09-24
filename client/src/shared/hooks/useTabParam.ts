import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Persist tab state in a URL query parameter (default `?tab=`).
 *
 * Contract (see `.claude/rules/url-tab-state.md`):
 *   - default value applied when the param is absent
 *   - invalid values (not in `validTabs`) fall back to the default
 *   - switching a tab uses `navigate({search}, { replace: true })` so the
 *     browser history is not polluted per click
 *
 * `paramName` overrides the default `tab` — used by nested tab surfaces
 * (e.g. the report screen uses `?bucket=` so it doesn't collide with the
 * outer site-workspace `?tab=`).
 */
export function useTabParam<T extends string>(
  defaultTab: T,
  validTabs?: readonly T[],
  paramName: string = 'tab',
): [T, (next: T) => void] {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useMemo<T>(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get(paramName);
    if (!value) return defaultTab;
    if (validTabs && !(validTabs as readonly string[]).includes(value)) return defaultTab;
    return value as T;
  }, [location.search, defaultTab, validTabs, paramName]);

  useEffect(() => {
    if (!validTabs) return;
    const params = new URLSearchParams(location.search);
    const value = params.get(paramName);
    if (value === null || (validTabs as readonly string[]).includes(value)) return;
    params.set(paramName, defaultTab);
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true },
    );
  }, [
    defaultTab,
    location.pathname,
    location.search,
    navigate,
    paramName,
    validTabs,
  ]);

  const setActiveTab = useCallback(
    (next: T) => {
      const params = new URLSearchParams(location.search);
      params.set(paramName, next);
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    },
    [location.pathname, location.search, navigate, paramName],
  );

  return [activeTab, setActiveTab];
}
