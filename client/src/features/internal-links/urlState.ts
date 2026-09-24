import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { InternalLinkConfidence, InternalLinkTargetFlag } from './types';

/**
 * Inner sub-view of the site workspace's Internal Links tab. The param is
 * `?view=`: `?tab=` belongs to the workspace, and the
 * site comes from the route rather than a `?siteId=`.
 */
export const INTERNAL_LINK_VIEWS = ['runs', 'new'] as const;
export type InternalLinkView = (typeof INTERNAL_LINK_VIEWS)[number];
export const INTERNAL_LINK_TARGET_FILTERS = ['all', 'orphan', 'weakly_linked'] as const;
export type InternalLinkTargetFilter = 'all' | InternalLinkTargetFlag;
export const INTERNAL_LINK_CONFIDENCE_FILTERS = ['all', 'high', 'medium', 'low'] as const;
export type InternalLinkConfidenceFilter = 'all' | InternalLinkConfidence;

const OBJECT_ID = /^[0-9a-f]{24}$/u;
const SECTION = /^\/[\p{L}\p{N}%._~-]{0,255}$/u;

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

export const isInternalLinkView = (value: unknown): value is InternalLinkView =>
  oneOf(INTERNAL_LINK_VIEWS, value);
export const isInternalLinkTargetFilter = (
  value: unknown,
): value is InternalLinkTargetFilter => oneOf(INTERNAL_LINK_TARGET_FILTERS, value);
export const isInternalLinkConfidenceFilter = (
  value: unknown,
): value is InternalLinkConfidenceFilter =>
  oneOf(INTERNAL_LINK_CONFIDENCE_FILTERS, value);
export const isInternalLinkObjectId = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID.test(value);
export const isInternalLinkSection = (value: unknown): value is string =>
  typeof value === 'string' && SECTION.test(value);

export interface InternalLinkUrlState {
  view: InternalLinkView;
  runId: string | null;
  target: InternalLinkTargetFilter;
  section: string;
  confidence: InternalLinkConfidenceFilter;
  setView: (value: InternalLinkView) => void;
  setRunId: (value: string | null) => void;
  setTarget: (value: InternalLinkTargetFilter) => void;
  setSection: (value: string) => void;
  setConfidence: (value: InternalLinkConfidenceFilter) => void;
}

export function useInternalLinkUrlState(): InternalLinkUrlState {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const rawView = params.get('view');
  const rawRun = params.get('run');
  const rawTarget = params.get('target');
  const rawSection = params.get('section');
  const rawConfidence = params.get('confidence');

  const view = isInternalLinkView(rawView) ? rawView : 'runs';
  const runId = isInternalLinkObjectId(rawRun) ? rawRun : null;
  const target = isInternalLinkTargetFilter(rawTarget) ? rawTarget : 'all';
  const section = isInternalLinkSection(rawSection) ? rawSection : 'all';
  const confidence = isInternalLinkConfidenceFilter(rawConfidence)
    ? rawConfidence
    : 'all';

  useEffect(() => {
    const invalid = {
      view: rawView !== null && (!isInternalLinkView(rawView) || rawView === 'runs'),
      run: rawRun !== null && !isInternalLinkObjectId(rawRun),
      target:
        rawTarget !== null &&
        (!isInternalLinkTargetFilter(rawTarget) || rawTarget === 'all'),
      section:
        rawSection !== null &&
        (!isInternalLinkSection(rawSection) || rawSection === 'all'),
      confidence:
        rawConfidence !== null &&
        (!isInternalLinkConfidenceFilter(rawConfidence) || rawConfidence === 'all'),
    };
    if (!Object.values(invalid).some(Boolean)) return;
    const next = new URLSearchParams(params);
    for (const [key, shouldDelete] of Object.entries(invalid)) {
      if (shouldDelete) next.delete(key);
    }
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { replace: true },
    );
  }, [
    location.pathname,
    navigate,
    params,
    rawConfidence,
    rawRun,
    rawSection,
    rawTarget,
    rawView,
  ]);

  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);

  const write = useCallback(
    (key: string, value: string | null, isDefault = false) => {
      const next = new URLSearchParams(latest.current);
      if (value === null || isDefault) next.delete(key);
      else next.set(key, value);
      latest.current = next;
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [location.pathname, navigate],
  );

  return {
    view,
    runId,
    target,
    section,
    confidence,
    setView: useCallback((value) => write('view', value, value === 'runs'), [write]),
    setRunId: useCallback((value) => write('run', value), [write]),
    setTarget: useCallback((value) => write('target', value, value === 'all'), [write]),
    setSection: useCallback((value) => write('section', value, value === 'all'), [write]),
    setConfidence: useCallback(
      (value) => write('confidence', value, value === 'all'),
      [write],
    ),
  };
}

