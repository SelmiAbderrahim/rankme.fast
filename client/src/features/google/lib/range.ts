import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GoogleRange } from '../types';

/**
 * Date-range windows offered by both summary cards, persisted as `?range=`.
 * Absent (or invalid) means the 28-day default — the param is deleted when the
 * user picks the default so URLs stay canonical.
 */
export const GOOGLE_RANGES: readonly GoogleRange[] = ['7d', '28d', '90d'];

export const DEFAULT_GOOGLE_RANGE: GoogleRange = '28d';

const RANGE_DAYS: Record<GoogleRange, number> = { '7d': 7, '28d': 28, '90d': 90 };

/** Day count for `{{days}}` interpolations in card titles/captions. */
export const rangeDays = (range: GoogleRange): number => RANGE_DAYS[range];

export function isGoogleRange(value: unknown): value is GoogleRange {
  return (
    typeof value === 'string' && (GOOGLE_RANGES as readonly string[]).includes(value)
  );
}

/**
 * `?range=` state for the Google tab — mirrors `useGoogleSearchView` mechanics
 * (see `.claude/rules/url-tab-state.md`): reads from the URL, writes with
 * `replace: true`, invalid values fall back to the default, and every write
 * starts from the current search string so `?tab=google` / `?view=` survive.
 * ONE param drives both summary cards and the drill-in panel.
 */
export function useGoogleRange(): [GoogleRange, (next: GoogleRange) => void] {
  const location = useLocation();
  const navigate = useNavigate();

  const range = useMemo<GoogleRange>(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get('range');
    return isGoogleRange(value) ? value : DEFAULT_GOOGLE_RANGE;
  }, [location.search]);

  const setRange = useCallback(
    (next: GoogleRange) => {
      const params = new URLSearchParams(location.search);
      if (next === DEFAULT_GOOGLE_RANGE) {
        params.delete('range');
      } else {
        params.set('range', next);
      }
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [range, setRange];
}
