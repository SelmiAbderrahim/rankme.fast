import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DEFAULT_PAGES_DIRECTIONS,
  PAGES_INSIGHTS,
  PAGES_RANGES,
  PAGES_SORTS,
  type PagesDirection,
  type PagesIndexability,
  type PagesInsight,
  type PagesLimit,
  type PagesListQuery,
  type PagesRange,
  type PagesSort,
  type PagesUrlState,
  type PagesVisibility,
} from './types';

export const DEFAULT_PAGES_URL_STATE: PagesUrlState = {
  range: '28d',
  q: '',
  insight: null,
  indexability: null,
  visibility: null,
  sort: 'opportunity',
  direction: 'desc',
  cursor: null,
  limit: 25,
  pageId: null,
};

export const PAGES_QUERY_MAX_LENGTH = 200;
export const PAGES_CURSOR_MAX_LENGTH = 2048;

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MANAGED_KEYS = [
  'tab',
  'range',
  'q',
  'insight',
  'indexability',
  'visibility',
  'sort',
  'direction',
  'cursor',
  'limit',
  'pageId',
] as const;

const includes = <T extends string>(values: readonly T[], value: string | null): value is T =>
  value !== null && (values as readonly string[]).includes(value);

const readSearch = (raw: string | URLSearchParams): URLSearchParams =>
  new URLSearchParams(typeof raw === 'string' ? raw.replace(/^\?/u, '') : raw);

const readTrimmedQuery = (value: string | null): string => {
  if (value === null) return '';
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= PAGES_QUERY_MAX_LENGTH ? trimmed : '';
};

const readCursor = (value: string | null): string | null =>
  value !== null && value.length > 0 && value.length <= PAGES_CURSOR_MAX_LENGTH
    ? value
    : null;

const readLimit = (value: string | null): PagesLimit => {
  if (value === '50') return 50;
  if (value === '100') return 100;
  return 25;
};

export function parsePagesUrlState(raw: string | URLSearchParams): PagesUrlState {
  const params = readSearch(raw);
  const range: PagesRange = includes(PAGES_RANGES, params.get('range'))
    ? params.get('range') as PagesRange
    : DEFAULT_PAGES_URL_STATE.range;
  const insight: PagesInsight | null = includes(PAGES_INSIGHTS, params.get('insight'))
    ? params.get('insight') as PagesInsight
    : null;
  const indexability: PagesIndexability | null = includes(
    ['indexable', 'non_indexable'] as const,
    params.get('indexability'),
  ) ? params.get('indexability') as PagesIndexability : null;
  const visibility: PagesVisibility | null = includes(
    ['measured', 'unmeasured'] as const,
    params.get('visibility'),
  ) ? params.get('visibility') as PagesVisibility : null;
  const sort: PagesSort = includes(PAGES_SORTS, params.get('sort'))
    ? params.get('sort') as PagesSort
    : DEFAULT_PAGES_URL_STATE.sort;
  const direction: PagesDirection = includes(['asc', 'desc'] as const, params.get('direction'))
    ? params.get('direction') as PagesDirection
    : DEFAULT_PAGES_DIRECTIONS[sort];
  const rawPageId = params.get('pageId');

  return {
    range,
    q: readTrimmedQuery(params.get('q')),
    insight,
    indexability,
    visibility,
    sort,
    direction,
    cursor: readCursor(params.get('cursor')),
    limit: readLimit(params.get('limit')),
    pageId: rawPageId !== null && PAGE_ID_PATTERN.test(rawPageId) ? rawPageId : null,
  };
}

function appendManaged(params: URLSearchParams, state: PagesUrlState): void {
  params.append('tab', 'pages');
  if (state.range !== DEFAULT_PAGES_URL_STATE.range) params.append('range', state.range);
  if (state.q) params.append('q', state.q);
  if (state.insight) params.append('insight', state.insight);
  if (state.indexability) params.append('indexability', state.indexability);
  if (state.visibility) params.append('visibility', state.visibility);
  if (state.sort !== DEFAULT_PAGES_URL_STATE.sort) params.append('sort', state.sort);
  if (state.direction !== DEFAULT_PAGES_DIRECTIONS[state.sort]) {
    params.append('direction', state.direction);
  }
  if (state.cursor) params.append('cursor', state.cursor);
  if (state.limit !== DEFAULT_PAGES_URL_STATE.limit) params.append('limit', String(state.limit));
  if (state.pageId) params.append('pageId', state.pageId);
}

export function serializePagesUrlState(
  current: string | URLSearchParams,
  state: PagesUrlState,
): URLSearchParams {
  const source = readSearch(current);
  const next = new URLSearchParams();
  const unrelated = [...source.entries()]
    .filter(([key]) => !(MANAGED_KEYS as readonly string[]).includes(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  for (const [key, value] of unrelated) next.append(key, value);
  appendManaged(next, state);
  return next;
}

export function canonicalizePagesSearch(raw: string | URLSearchParams): string {
  const params = readSearch(raw);
  return serializePagesUrlState(params, parsePagesUrlState(params)).toString();
}

export function pagesListQueryFromUrlState(state: PagesUrlState): PagesListQuery {
  const { pageId: _pageId, ...query } = state;
  return query;
}

export function serializePagesListQuery(query: PagesListQuery): string {
  const params = new URLSearchParams();
  params.append('range', query.range);
  if (query.q) params.append('q', query.q);
  if (query.insight) params.append('insight', query.insight);
  if (query.indexability) params.append('indexability', query.indexability);
  if (query.visibility) params.append('visibility', query.visibility);
  params.append('sort', query.sort);
  params.append('direction', query.direction);
  if (query.cursor) params.append('cursor', query.cursor);
  params.append('limit', String(query.limit));
  return params.toString();
}

export function pagesListCacheKey(siteId: string, query: PagesListQuery): string {
  return `${siteId}?${serializePagesListQuery(query)}`;
}

export function pagesDetailCacheKey(
  siteId: string,
  range: PagesRange,
  pageId: string,
): string {
  return `${siteId}/${range}/${pageId}`;
}

export type PagesContextPatch = Partial<
  Pick<
    PagesUrlState,
    | 'range'
    | 'q'
    | 'insight'
    | 'indexability'
    | 'visibility'
    | 'sort'
    | 'direction'
    | 'limit'
  >
>;

export function changePagesContext(
  state: PagesUrlState,
  patch: PagesContextPatch,
): PagesUrlState {
  const next = { ...state, ...patch, cursor: null, pageId: null };
  if (patch.sort !== undefined && patch.direction === undefined) {
    next.direction = DEFAULT_PAGES_DIRECTIONS[patch.sort];
  }
  return next;
}

export function changePagesDetail(state: PagesUrlState, pageId: string | null): PagesUrlState {
  return { ...state, pageId };
}

export function changePagesCursor(state: PagesUrlState, cursor: string | null): PagesUrlState {
  return { ...state, cursor, pageId: null };
}

export type PagesHistoryAction = 'search' | 'context' | 'pagination' | 'detail';

export function pagesHistoryMode(action: PagesHistoryAction): 'replace' | 'push' {
  return action === 'search' ? 'replace' : 'push';
}

export interface PagesUrlController {
  state: PagesUrlState;
  setSearch: (q: string) => void;
  changeContext: (patch: PagesContextPatch) => void;
  setCursor: (cursor: string | null) => void;
  setPageId: (pageId: string | null) => void;
}

export function usePagesUrlState(): PagesUrlController {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(() => parsePagesUrlState(location.search), [location.search]);
  const canonicalSearch = useMemo(
    () => canonicalizePagesSearch(location.search),
    [location.search],
  );

  useEffect(() => {
    const current = location.search.replace(/^\?/u, '');
    // The site workspace owns `?tab=`. Radix can keep an outgoing panel
    // mounted briefly while its replacement is loading, so Pages must not
    // canonicalize a location that has already moved to another workspace
    // tab (otherwise `?tab=actions` is immediately rewritten to `?tab=pages`).
    if (new URLSearchParams(current).get('tab') !== 'pages') return;
    if (current === canonicalSearch) return;
    navigate(
      { pathname: location.pathname, search: canonicalSearch },
      { replace: true },
    );
  }, [canonicalSearch, location.pathname, location.search, navigate]);

  const write = useCallback(
    (nextState: PagesUrlState, action: PagesHistoryAction) => {
      const search = serializePagesUrlState(location.search, nextState).toString();
      navigate(
        { pathname: location.pathname, search },
        { replace: pagesHistoryMode(action) === 'replace' },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const setSearch = useCallback(
    (q: string) => write(changePagesContext(state, { q }), 'search'),
    [state, write],
  );
  const changeContext = useCallback(
    (patch: PagesContextPatch) => write(changePagesContext(state, patch), 'context'),
    [state, write],
  );
  const setCursor = useCallback(
    (cursor: string | null) => write(changePagesCursor(state, cursor), 'pagination'),
    [state, write],
  );
  const setPageId = useCallback(
    (pageId: string | null) => write(changePagesDetail(state, pageId), 'detail'),
    [state, write],
  );

  return {
    state,
    setSearch,
    changeContext,
    setCursor,
    setPageId,
  };
}
