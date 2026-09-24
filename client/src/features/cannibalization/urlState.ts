/**
 * URL-backed workspace state (`.claude/rules/url-tab-state.md`).
 *
 * `?view=` switches reports ⇄ new-report (the workspace owns `?tab=` and the
 * route owns the site);
 * `?window=` picks the aggregation window; `?confidence=` filters the loaded
 * candidate table; `?report=` opens a stored report; `?query=` opens one
 * candidate's page drill-down. Every param defaults when absent, and an
 * INVALID value is normalized back out of the URL with
 * `navigate({ search }, { replace: true })` so a shared link never leaves the
 * address bar disagreeing with the screen.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CANNIBALIZATION_CONFIDENCE_LEVELS,
  CANNIBALIZATION_WINDOWS,
  DEFAULT_CANNIBALIZATION_WINDOW,
  type CannibalizationConfidence,
  type CannibalizationWindow,
} from './types';

export const CANNIBALIZATION_VIEWS = ['reports', 'new'] as const;
export type CannibalizationView = (typeof CANNIBALIZATION_VIEWS)[number];
export const DEFAULT_CANNIBALIZATION_VIEW: CannibalizationView = 'reports';

export const CANNIBALIZATION_CONFIDENCE_FILTERS = [
  'all',
  ...CANNIBALIZATION_CONFIDENCE_LEVELS,
] as const;
export type CannibalizationConfidenceFilter = 'all' | CannibalizationConfidence;
export const DEFAULT_CONFIDENCE_FILTER: CannibalizationConfidenceFilter = 'all';

/** Candidate ids are `cannibal-<n>` — anything else was hand-typed. */
const CANDIDATE_ID = /^cannibal-\d{1,4}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/;

export const isCannibalizationView = (value: unknown): value is CannibalizationView =>
  typeof value === 'string' &&
  (CANNIBALIZATION_VIEWS as readonly string[]).includes(value);

export const isCannibalizationWindow = (
  value: unknown,
): value is CannibalizationWindow =>
  typeof value === 'string' &&
  (CANNIBALIZATION_WINDOWS as readonly number[]).includes(Number(value));

export const isConfidenceFilter = (
  value: unknown,
): value is CannibalizationConfidenceFilter =>
  typeof value === 'string' &&
  (CANNIBALIZATION_CONFIDENCE_FILTERS as readonly string[]).includes(value);

export const isObjectId = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID.test(value);

export const isCandidateId = (value: unknown): value is string =>
  typeof value === 'string' && CANDIDATE_ID.test(value);

export interface CannibalizationUrlState {
  view: CannibalizationView;
  window: CannibalizationWindow;
  confidence: CannibalizationConfidenceFilter;
  report: string | null;
  query: string | null;
  setView: (next: CannibalizationView) => void;
  setWindow: (next: CannibalizationWindow) => void;
  setConfidence: (next: CannibalizationConfidenceFilter) => void;
  setReport: (next: string | null) => void;
  setQuery: (next: string | null) => void;
}

export function useCannibalizationUrlState(): CannibalizationUrlState {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const rawView = params.get('view');
  const rawWindow = params.get('window');
  const rawConfidence = params.get('confidence');
  const rawReport = params.get('report');
  const rawQuery = params.get('query');

  const view = isCannibalizationView(rawView) ? rawView : DEFAULT_CANNIBALIZATION_VIEW;
  const windowDays = isCannibalizationWindow(rawWindow)
    ? (Number(rawWindow) as CannibalizationWindow)
    : DEFAULT_CANNIBALIZATION_WINDOW;
  const confidence = isConfidenceFilter(rawConfidence)
    ? rawConfidence
    : DEFAULT_CONFIDENCE_FILTER;
  const report = isObjectId(rawReport) ? rawReport : null;
  const query = isCandidateId(rawQuery) ? rawQuery : null;

  useEffect(() => {
    // Defaults are spelled as an ABSENT param, so normalization deletes.
    const invalidView = rawView !== null && !isCannibalizationView(rawView);
    const invalidWindow =
      rawWindow !== null &&
      (!isCannibalizationWindow(rawWindow) ||
        Number(rawWindow) === DEFAULT_CANNIBALIZATION_WINDOW);
    const invalidConfidence =
      rawConfidence !== null &&
      (!isConfidenceFilter(rawConfidence) ||
        rawConfidence === DEFAULT_CONFIDENCE_FILTER);
    const invalidReport = rawReport !== null && !isObjectId(rawReport);
    const invalidQuery = rawQuery !== null && !isCandidateId(rawQuery);
    if (
      !invalidView &&
      !invalidWindow &&
      !invalidConfidence &&
      !invalidReport &&
      !invalidQuery
    ) {
      return;
    }
    const next = new URLSearchParams(params);
    if (invalidView) next.delete('view');
    if (invalidWindow) next.delete('window');
    if (invalidConfidence) next.delete('confidence');
    if (invalidReport) next.delete('report');
    if (invalidQuery) next.delete('query');
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { replace: true },
    );
  }, [
    rawView,
    rawWindow,
    rawConfidence,
    rawReport,
    rawQuery,
    params,
    navigate,
    location.pathname,
  ]);

  /**
   * Latest params, tracked in a ref so two writes in ONE handler compose
   * (`setReport(id)` then `setTab('reports')`). Reading the render-time
   * `params` for both would make the second write silently discard the first.
   */
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const write = useCallback(
    (key: string, value: string, isDefault: boolean) => {
      const next = new URLSearchParams(paramsRef.current);
      if (isDefault) next.delete(key);
      else next.set(key, value);
      paramsRef.current = next;
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [navigate, location.pathname],
  );

  return {
    view,
    window: windowDays,
    confidence,
    report,
    query,
    setView: useCallback(
      (next: CannibalizationView) =>
        write('view', next, next === DEFAULT_CANNIBALIZATION_VIEW),
      [write],
    ),
    setWindow: useCallback(
      (next: CannibalizationWindow) =>
        write('window', String(next), next === DEFAULT_CANNIBALIZATION_WINDOW),
      [write],
    ),
    setConfidence: useCallback(
      (next: CannibalizationConfidenceFilter) =>
        write('confidence', next, next === DEFAULT_CONFIDENCE_FILTER),
      [write],
    ),
    setReport: useCallback(
      (next: string | null) => write('report', next ?? '', next === null),
      [write],
    ),
    setQuery: useCallback(
      (next: string | null) => write('query', next ?? '', next === null),
      [write],
    ),
  };
}
