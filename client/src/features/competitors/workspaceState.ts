import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabParam } from '@shared/hooks/useTabParam';
import type { CompetitorWorkspaceView, LandscapeClass } from './types';

export const COMPETITOR_WORKSPACE_VIEWS = [
  'overview',
  'keywords',
  'content',
  'monitoring',
  'traffic',
  'reports',
] as const satisfies readonly CompetitorWorkspaceView[];

export const DEFAULT_COMPETITOR_WORKSPACE_VIEW: CompetitorWorkspaceView = 'overview';

export const LANDSCAPE_CLASSES = [
  'missing',
  'owned_only',
  'shared_behind',
  'shared_ahead',
  'shared_even',
] as const satisfies readonly LandscapeClass[];

export function isCompetitorWorkspaceView(value: unknown): value is CompetitorWorkspaceView {
  return (
    typeof value === 'string' &&
    (COMPETITOR_WORKSPACE_VIEWS as readonly string[]).includes(value)
  );
}

export function isLandscapeClass(value: unknown): value is LandscapeClass {
  return typeof value === 'string' && (LANDSCAPE_CLASSES as readonly string[]).includes(value);
}

/** Canonical nested navigation. Missing and invalid values become explicit `view=overview`. */
export function useCompetitorWorkspaceView(): [
  CompetitorWorkspaceView,
  (view: CompetitorWorkspaceView) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useTabParam<CompetitorWorkspaceView>(
    DEFAULT_COMPETITOR_WORKSPACE_VIEW,
    COMPETITOR_WORKSPACE_VIEWS,
    'view',
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('view') !== null) return;
    params.set('view', DEFAULT_COMPETITOR_WORKSPACE_VIEW);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  return state;
}

/**
 * Compatibility rewrite for the old content-intelligence competitor bookmark.
 * All unrelated filters survive the replace navigation.
 */
export function useLegacyCompetitorContentRedirect(): void {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') !== 'content' || params.get('view') !== 'competitors') return;
    params.set('tab', 'competitors');
    params.set('view', 'content');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate]);
}

