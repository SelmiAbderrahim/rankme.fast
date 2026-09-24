import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CONTENT_SUB_VIEWS,
  DEFAULT_CONTENT_SUB_VIEW,
  isContentSubView,
  type ContentSubView,
} from './types';

const PARAM = 'view';

/**
 * `?view=analyses|inventory|competitors|monitoring|briefs` — Content Intelligence
 * sub-view state. Default `analyses`; invalid values fall back to the default.
 * A `null` write clears the param and preserves the other params (specifically
 * `?tab=content`), mirroring the google-tab sub-view mechanic.
 */
export function useContentView(): [ContentSubView, (view: ContentSubView | null) => void] {
  const location = useLocation();
  const navigate = useNavigate();

  const view = useMemo<ContentSubView>(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get(PARAM);
    return isContentSubView(value) ? value : DEFAULT_CONTENT_SUB_VIEW;
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get(PARAM);
    if (raw === null || isContentSubView(raw)) return;
    params.set(PARAM, DEFAULT_CONTENT_SUB_VIEW);
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const setView = useCallback(
    (next: ContentSubView | null) => {
      const params = new URLSearchParams(location.search);
      if (next === null) params.delete(PARAM);
      else params.set(PARAM, next);
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [view, setView];
}

export { CONTENT_SUB_VIEWS, DEFAULT_CONTENT_SUB_VIEW, isContentSubView };
export type { ContentSubView };
