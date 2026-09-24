import type { RootState } from '@app/store';
import { pagesDetailCacheKey, pagesListCacheKey } from '../urlState';
import {
  PAGES_INSIGHTS,
  type PagesCacheEntry,
  type PagesDetailResponse,
  type PagesEnvelope,
  type PagesInsight,
  type PagesListQuery,
  type PagesListResponse,
  type PagesLoadState,
  type PagesRange,
  type PagesRefreshState,
  type PagesSort,
  type PagesSourceCapabilities,
  type PagesState,
} from '../types';
import { initialPagesState } from './slice';

const EMPTY_LIST_ENTRY: PagesCacheEntry<PagesListResponse> = {
  data: null,
  loading: false,
  loaded: false,
  invalidated: false,
  error: null,
  requestId: null,
};

const EMPTY_DETAIL_ENTRY: PagesCacheEntry<PagesDetailResponse> = {
  ...EMPTY_LIST_ENTRY,
  data: null,
};

const EMPTY_REFRESH: PagesRefreshState = {
  loading: false,
  error: null,
  requestId: null,
  lastResult: null,
};

export const selectPagesState = (state: RootState): PagesState =>
  state.pages ?? initialPagesState;

export const selectPagesListEntry = (
  state: RootState,
  siteId: string,
  query: PagesListQuery,
): PagesCacheEntry<PagesListResponse> =>
  selectPagesState(state).lists[pagesListCacheKey(siteId, query)] ?? EMPTY_LIST_ENTRY;

export const selectPagesDetailEntry = (
  state: RootState,
  siteId: string,
  range: PagesRange,
  pageId: string,
): PagesCacheEntry<PagesDetailResponse> =>
  selectPagesState(state).details[pagesDetailCacheKey(siteId, range, pageId)]
  ?? EMPTY_DETAIL_ENTRY;

export const selectPagesRefresh = (state: RootState, siteId: string): PagesRefreshState =>
  selectPagesState(state).refreshes[siteId] ?? EMPTY_REFRESH;

const envelopeState = (envelope: PagesEnvelope): PagesLoadState => {
  if (envelope.status === 'syncing') return 'syncing';
  if (envelope.status === 'stale') return 'stale';
  if (envelope.status === 'unavailable') return 'unavailable';
  if (envelope.status === 'empty') return 'empty';
  return 'ready';
};

export function pagesListLoadState(entry: PagesCacheEntry<PagesListResponse>): PagesLoadState {
  if (entry.loading) return entry.data === null ? 'initial_loading' : 'background_loading';
  if (entry.data !== null) {
    if (entry.data.pageInfo.totalFiltered === 0) return 'empty';
    return envelopeState(entry.data.envelope);
  }
  return entry.error !== null || entry.loaded ? 'error' : 'initial_loading';
}

export function pagesDetailLoadState(
  entry: PagesCacheEntry<PagesDetailResponse>,
): PagesLoadState {
  if (entry.loading) return entry.data === null ? 'initial_loading' : 'background_loading';
  if (entry.data !== null) return envelopeState(entry.data.envelope);
  if (entry.error !== null) return 'error';
  return entry.loaded ? 'error' : 'initial_loading';
}

export const selectPagesListLoadState = (
  state: RootState,
  siteId: string,
  query: PagesListQuery,
): PagesLoadState => {
  const entry = selectPagesListEntry(state, siteId, query);
  if (entry.data === null && !entry.loading) {
    const retainedState = selectPagesRefresh(state, siteId).error?.state;
    if (retainedState) return envelopeState(retainedState.envelope);
  }
  return pagesListLoadState(entry);
};

export const selectPagesDetailLoadState = (
  state: RootState,
  siteId: string,
  range: PagesRange,
  pageId: string,
): PagesLoadState => pagesDetailLoadState(
  selectPagesDetailEntry(state, siteId, range, pageId),
);

const BASE_SORTS: PagesSort[] = ['opportunity', 'url', 'title'];
const GSC_SORTS: PagesSort[] = [
  ...BASE_SORTS,
  'clicks',
  'impressions',
  'ctr',
  'average_position',
  'position_change',
  'click_change_pct',
];
const ESTIMATED_SORTS: PagesSort[] = [
  ...BASE_SORTS,
  'average_position',
  'best_position',
  'keyword_count',
  'search_volume',
  'difficulty',
  'estimated_traffic',
  'position_change',
];

const metricAvailability = (source: PagesEnvelope['source']): PagesSourceCapabilities['metricAvailability'] => ({
  clicks: source === 'gsc',
  impressions: source === 'gsc',
  ctr: source === 'gsc',
  averagePosition: source !== 'none',
  bestPosition: source === 'dataforseo' || source === 'demo',
  keywordCount: source === 'dataforseo' || source === 'demo',
  searchVolume: source === 'dataforseo' || source === 'demo',
  difficulty: source === 'dataforseo' || source === 'demo',
  estimatedTraffic: source === 'dataforseo' || source === 'demo',
  associatedQueryCount: true,
});

const supportedInsights = (source: PagesEnvelope['source']): PagesInsight[] => {
  if (source === 'gsc') return [...PAGES_INSIGHTS];
  if (source === 'dataforseo' || source === 'demo') {
    return PAGES_INSIGHTS.filter((insight) => insight !== 'low_ctr');
  }
  return ['unmeasured'];
};

export function pagesSourceCapabilities(envelope: PagesEnvelope): PagesSourceCapabilities {
  const estimated = envelope.source === 'dataforseo' || envelope.source === 'demo';
  const insights = supportedInsights(envelope.source);
  const connectionAction = envelope.fallbackReason === 'gsc_not_connected'
    ? 'connect'
    : envelope.fallbackReason === 'gsc_needs_reconnect' || envelope.fallbackReason === 'gsc_revoked'
      ? 'reconnect'
      : envelope.fallbackReason === 'gsc_property_unmatched'
        ? 'select_property'
        : envelope.source === 'gsc' && envelope.status === 'syncing'
          ? 'collect'
          : null;

  return {
    isObserved: envelope.source === 'gsc',
    isEstimated: estimated,
    isDemo: envelope.source === 'demo',
    metricAvailability: metricAvailability(envelope.source),
    supportedInsights: insights,
    supportedSorts: envelope.source === 'gsc'
      ? [...GSC_SORTS]
      : estimated
        ? [...ESTIMATED_SORTS]
        : [...BASE_SORTS],
    filters: {
      insight: insights,
      indexability: true,
      visibility: true,
    },
    connectionAction,
    canRefresh: true,
    coverage: envelope.coverage,
  };
}

export const selectPagesSourceCapabilities = (
  state: RootState,
  siteId: string,
  query: PagesListQuery,
): PagesSourceCapabilities | null => {
  const entry = selectPagesListEntry(state, siteId, query);
  const envelope = entry.data?.envelope ?? selectPagesRefresh(state, siteId).error?.state?.envelope;
  return envelope ? pagesSourceCapabilities(envelope) : null;
};
