import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Inner sub-view of the site workspace's Keyword Clusters tab. The param is
 * `?view=`: `?tab=` now belongs to the workspace
 * itself, and the site comes from the route, so this hook no longer owns a
 * `?siteId=`.
 */
export const KEYWORD_CLUSTER_VIEWS = ['runs', 'new'] as const;
export type KeywordClusterView = (typeof KEYWORD_CLUSTER_VIEWS)[number];

export const KEYWORD_CLUSTER_SIZE_FILTERS = ['all', 'grouped', 'singleton'] as const;
export type KeywordClusterSizeFilter =
  (typeof KEYWORD_CLUSTER_SIZE_FILTERS)[number];

const OBJECT_ID = /^[0-9a-f]{24}$/u;
const CLUSTER_ID = /^cluster-[1-9][0-9]{0,3}$/u;

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

export const isKeywordClusterView = (value: unknown): value is KeywordClusterView =>
  oneOf(KEYWORD_CLUSTER_VIEWS, value);
export const isKeywordClusterSizeFilter = (
  value: unknown,
): value is KeywordClusterSizeFilter => oneOf(KEYWORD_CLUSTER_SIZE_FILTERS, value);
export const isKeywordClusterObjectId = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID.test(value);
export const isKeywordClusterId = (value: unknown): value is string =>
  typeof value === 'string' && CLUSTER_ID.test(value);

export interface KeywordClusterUrlState {
  view: KeywordClusterView;
  runId: string | null;
  clusterId: string | null;
  size: KeywordClusterSizeFilter;
  setView: (value: KeywordClusterView) => void;
  setRunId: (value: string | null) => void;
  setClusterId: (value: string | null) => void;
  setSize: (value: KeywordClusterSizeFilter) => void;
}

export function useKeywordClusterUrlState(): KeywordClusterUrlState {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const rawView = params.get('view');
  const rawRun = params.get('run');
  const rawCluster = params.get('cluster');
  const rawSize = params.get('size');

  const view = isKeywordClusterView(rawView) ? rawView : 'runs';
  const runId = isKeywordClusterObjectId(rawRun) ? rawRun : null;
  const clusterId = isKeywordClusterId(rawCluster) ? rawCluster : null;
  const size = isKeywordClusterSizeFilter(rawSize) ? rawSize : 'all';

  useEffect(() => {
    const invalid = {
      view: rawView !== null && (!isKeywordClusterView(rawView) || rawView === 'runs'),
      run: rawRun !== null && !isKeywordClusterObjectId(rawRun),
      cluster: rawCluster !== null && !isKeywordClusterId(rawCluster),
      size:
        rawSize !== null && (!isKeywordClusterSizeFilter(rawSize) || rawSize === 'all'),
    };
    if (!Object.values(invalid).some(Boolean)) return;
    const next = new URLSearchParams(params);
    for (const [key, shouldDelete] of Object.entries(invalid)) {
      if (shouldDelete) next.delete(key);
    }
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  }, [
    location.pathname,
    navigate,
    params,
    rawCluster,
    rawRun,
    rawSize,
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
    clusterId,
    size,
    setView: useCallback((value) => write('view', value, value === 'runs'), [write]),
    setRunId: useCallback((value) => write('run', value), [write]),
    setClusterId: useCallback((value) => write('cluster', value), [write]),
    setSize: useCallback((value) => write('size', value, value === 'all'), [write]),
  };
}
