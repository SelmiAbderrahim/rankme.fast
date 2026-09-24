import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * URL-backed state for the schema generator.
 *
 * - `?view=` — `list` (default) or `detail`. Read-only coercion: an unknown
 *   value falls back to `list` without rewriting the URL, because the Google
 *   tab owns its own `?view=` vocabulary on the same workspace route and a
 *   rewrite would clobber a sibling tab's deep link.
 * - `?generation=` — the stored generation the detail view opens.
 * - `?page=` — the page URL preselected by the report's structured-data CTA.
 *
 * Writes always start from the current search string (so `?tab=schema`
 * survives) and use `replace: true` so a pane switch never pollutes history.
 */
export const SCHEMA_VIEWS = ['list', 'detail'] as const;
export type SchemaView = (typeof SCHEMA_VIEWS)[number];
export const DEFAULT_SCHEMA_VIEW: SchemaView = 'list';

export function isSchemaView(value: unknown): value is SchemaView {
  return typeof value === 'string' && (SCHEMA_VIEWS as readonly string[]).includes(value);
}

export interface SchemaUrlState {
  view: SchemaView;
  generationId: string | null;
  page: string | null;
}

export function useSchemaUrlState(): [
  SchemaUrlState,
  (next: Partial<SchemaUrlState>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();

  const state = useMemo<SchemaUrlState>(() => {
    const params = new URLSearchParams(location.search);
    const rawView = params.get('view');
    return {
      view: isSchemaView(rawView) ? rawView : DEFAULT_SCHEMA_VIEW,
      generationId: params.get('generation') || null,
      page: params.get('page') || null,
    };
  }, [location.search]);

  const setState = useCallback(
    (next: Partial<SchemaUrlState>) => {
      const params = new URLSearchParams(location.search);
      if (next.view !== undefined) {
        if (next.view === DEFAULT_SCHEMA_VIEW) params.delete('view');
        else params.set('view', next.view);
      }
      if (next.generationId !== undefined) {
        if (next.generationId === null) params.delete('generation');
        else params.set('generation', next.generationId);
      }
      if (next.page !== undefined) {
        if (next.page === null) params.delete('page');
        else params.set('page', next.page);
      }
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [state, setState];
}
