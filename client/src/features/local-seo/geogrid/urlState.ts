import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * URL-backed state for the geogrid surface.
 *
 * - `?scan=` — the stored scan the heat grid is showing (shareable).
 * - `?cell=` — the focused cell's `pointIndex` (direction-independent, so the
 *   same link opens the same cell in Arabic RTL as in English LTR).
 *
 * Writes start from the current search string so `?tab=geogrid` survives, and
 * use `replace: true` so switching scans never pollutes history.
 */
export interface GeogridUrlState {
  scanId: string | null;
  cellIndex: number | null;
}

export function parseCellIndex(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function useGeogridUrlState(): [
  GeogridUrlState,
  (next: Partial<GeogridUrlState>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();

  const state = useMemo<GeogridUrlState>(() => {
    const params = new URLSearchParams(location.search);
    return {
      scanId: params.get('scan') || null,
      cellIndex: parseCellIndex(params.get('cell')),
    };
  }, [location.search]);

  const setState = useCallback(
    (next: Partial<GeogridUrlState>) => {
      const params = new URLSearchParams(location.search);
      if (next.scanId !== undefined) {
        if (next.scanId === null) params.delete('scan');
        else params.set('scan', next.scanId);
      }
      if (next.cellIndex !== undefined) {
        if (next.cellIndex === null) params.delete('cell');
        else params.set('cell', String(next.cellIndex));
      }
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  return [state, setState];
}
