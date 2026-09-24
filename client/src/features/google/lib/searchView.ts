import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Drill-in subviews of the site-workspace Google tab, persisted as `?view=`.
 * Absent (or invalid) means the overview — the summary + connection cards.
 */
export const GOOGLE_SEARCH_VIEWS = [
  'queries',
  'pages',
  'countries',
  'devices',
  'sitemaps',
] as const;
export type GoogleSearchView = (typeof GOOGLE_SEARCH_VIEWS)[number];

export function isGoogleSearchView(value: unknown): value is GoogleSearchView {
  return (
    typeof value === 'string' &&
    (GOOGLE_SEARCH_VIEWS as readonly string[]).includes(value)
  );
}

/**
 * `?view=` state for the Google tab drill-in — mirrors the `useTabParam`
 * mechanics (see `.claude/rules/url-tab-state.md`): reads from the URL,
 * writes with `replace: true`, and invalid values fall back to the default.
 * The default here is `null` (no drill-in → overview), so setting `null`
 * DELETES the param — that is the back link. Every write starts from the
 * current search string, so `?tab=google` is always preserved.
 */
export function useGoogleSearchView(): [
  GoogleSearchView | null,
  (next: GoogleSearchView | null) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();

  const view = useMemo<GoogleSearchView | null>(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get('view');
    return isGoogleSearchView(value) ? value : null;
  }, [location.search]);

  const setView = useCallback(
    (next: GoogleSearchView | null) => {
      const params = new URLSearchParams(location.search);
      if (next === null) {
        params.delete('view');
      } else {
        params.set('view', next);
      }
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [view, setView];
}
