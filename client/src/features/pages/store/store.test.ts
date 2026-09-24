import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchPagesList: vi.fn(),
  fetchPagesDetail: vi.fn(),
  requestPagesRefresh: vi.fn(),
}));

import { makeStore, rootReducer, type RootState } from '@app/store';
import { PagesClientError } from '../error';
import { fetchPagesDetail, fetchPagesList, requestPagesRefresh } from '../api';
import { DEFAULT_PAGES_URL_STATE, pagesDetailCacheKey, pagesListCacheKey } from '../urlState';
import type {
  PageMetrics,
  PagesCacheEntry,
  PagesCoverage,
  PagesDetailResponse,
  PagesEnvelope,
  PagesListQuery,
  PagesListResponse,
  PagesRequestError,
} from '../types';
import {
  pagesDetailLoadState,
  pagesListLoadState,
  pagesSourceCapabilities,
  selectPagesDetailEntry,
  selectPagesDetailLoadState,
  selectPagesListEntry,
  selectPagesListLoadState,
  selectPagesRefresh,
  selectPagesSourceCapabilities,
  selectPagesState,
} from './selectors';
import { initialPagesState, pagesReducer, resetPagesState } from './slice';
import {
  abortPagesRequests,
  loadPagesDetail,
  loadPagesList,
  refreshPages,
} from './thunks';

const mockedList = vi.mocked(fetchPagesList);
const mockedDetail = vi.mocked(fetchPagesDetail);
const mockedRefresh = vi.mocked(requestPagesRefresh);
const SITE_A = 'site-a';
const SITE_B = 'site-b';
const PAGE_A = 'a'.repeat(43);
const PAGE_B = 'b'.repeat(43);
const QUERY: PagesListQuery = { ...DEFAULT_PAGES_URL_STATE };

const metrics = (overrides: Partial<PageMetrics> = {}): PageMetrics => ({
  clicks: null,
  impressions: null,
  ctr: null,
  averagePosition: 8,
  bestPosition: 4,
  keywordCount: 2,
  searchVolume: null,
  difficulty: null,
  estimatedTraffic: null,
  associatedQueryCount: 2,
  ...overrides,
});

const coverage: PagesCoverage = {
  reportingLagDays: null,
  sampled: null,
  sourceRowsFetched: 2,
  sourceRowsAccepted: 2,
  sourceRowsDropped: 0,
  dropped: {
    malformedUrl: 0,
    offsiteUrl: 0,
    duplicateUrl: 0,
    invalidMetric: 0,
  },
  sourceLimit: 1000,
  sourceTruncated: false,
  auditRowsFetched: 1,
  auditRowsAccepted: 1,
  auditRowsDropped: 0,
  auditTruncated: false,
  inventoryPages: 1,
  measuredPages: 1,
  unmeasuredPages: 0,
};

const envelope = (overrides: Partial<PagesEnvelope> = {}): PagesEnvelope => ({
  source: 'dataforseo',
  status: 'ready',
  fallbackReason: 'gsc_not_connected',
  observedAt: '2026-08-10T10:00:00.000Z',
  staleAt: '2026-08-11T10:00:00.000Z',
  range: '28d',
  rangeSemantics: 'point_in_time',
  comparison: { label: 'since_previous_sync', previousObservedAt: null },
  market: { locationCode: 2840, languageCode: 'en', selection: 'default' },
  coverage,
  ...overrides,
});

const listResponse = (
  pageId = PAGE_A,
  envelopeOverrides: Partial<PagesEnvelope> = {},
): PagesListResponse => ({
  envelope: envelope(envelopeOverrides),
  summary: metrics(),
  items: [{
    pageId,
    url: `https://example.com/${pageId.slice(0, 1)}`,
    displayUrl: `example.com/${pageId.slice(0, 1)}`,
    title: null,
    performanceSource: 'dataforseo',
    isIndexable: true,
    nonIndexableReason: null,
    onPageScore: null,
    metrics: metrics(),
    deltas: { positionChange: null, clickChangePct: null },
    insights: ['striking_distance'],
  }],
  pageInfo: {
    limit: 25,
    hasNext: false,
    nextCursor: null,
    totalFiltered: 1,
    totalInventory: 1,
    totalMeasured: 1,
  },
});

const detailResponse = (pageId = PAGE_A): PagesDetailResponse => ({
  envelope: envelope(),
  page: listResponse(pageId).items[0]!,
  associated: {
    kind: 'keywords',
    rows: [{
      query: 'query',
      position: 4,
      clicks: null,
      impressions: null,
      ctr: null,
      searchVolume: null,
      difficulty: null,
      estimatedTraffic: null,
    }],
    total: 1,
    truncated: false,
  },
  trend: [{
    observedAt: '2026-08-10T10:00:00.000Z',
    source: 'dataforseo',
    range: '28d',
    market: null,
    metrics: metrics(),
  }],
});

const requestError = (
  kind: PagesRequestError['kind'] = 'unavailable',
  retained: PagesListResponse | null = null,
): PagesRequestError => ({
  kind,
  status: 503,
  code: 'PAGES_PROVIDER_UNAVAILABLE',
  message: 'localized',
  details: null,
  retryAfterMs: null,
  state: retained,
});

beforeEach(() => {
  abortPagesRequests();
  mockedList.mockReset();
  mockedDetail.mockReset();
  mockedRefresh.mockReset();
  rootReducer.inject({ reducerPath: 'pages', reducer: pagesReducer });
});

describe('Pages keyed Redux state', () => {
  it('starts empty, lazily injects, and resets atomically', () => {
    expect(initialPagesState).toEqual({ lists: {}, details: {}, refreshes: {} });
    const store = makeStore();
    expect(selectPagesState(store.getState())).toEqual(initialPagesState);
    mockedList.mockResolvedValueOnce(listResponse());
    store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    expect(Object.keys(selectPagesState(store.getState()).lists)).toHaveLength(1);
    store.dispatch(resetPagesState());
    expect(selectPagesState(store.getState())).toEqual(initialPagesState);
  });

  it('separates list caches by site and canonical query', async () => {
    const store = makeStore();
    const queryB = { ...QUERY, range: '90d' as const, q: 'second' };
    mockedList.mockResolvedValueOnce(listResponse(PAGE_A));
    mockedList.mockResolvedValueOnce(listResponse(PAGE_B));
    await store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    await store.dispatch(loadPagesList({ siteId: SITE_B, query: queryB }));
    expect(selectPagesListEntry(store.getState(), SITE_A, QUERY).data?.items[0]?.pageId).toBe(PAGE_A);
    expect(selectPagesListEntry(store.getState(), SITE_B, queryB).data?.items[0]?.pageId).toBe(PAGE_B);
    expect(Object.keys(selectPagesState(store.getState()).lists)).toHaveLength(2);
  });

  it('separates detail caches by site/range/pageId and preserves nullable metrics exactly', async () => {
    const store = makeStore();
    mockedDetail.mockResolvedValueOnce(detailResponse(PAGE_A));
    mockedDetail.mockResolvedValueOnce(detailResponse(PAGE_B));
    await store.dispatch(loadPagesDetail({ siteId: SITE_A, range: '28d', pageId: PAGE_A }));
    await store.dispatch(loadPagesDetail({ siteId: SITE_B, range: '90d', pageId: PAGE_B }));
    const first = selectPagesDetailEntry(store.getState(), SITE_A, '28d', PAGE_A).data;
    expect(first?.associated.rows[0]).toMatchObject({ clicks: null, impressions: null, ctr: null });
    expect(first?.trend[0]?.metrics).toMatchObject({
      clicks: null,
      impressions: null,
      ctr: null,
      searchVolume: null,
      difficulty: null,
      estimatedTraffic: null,
    });
    expect(selectPagesDetailEntry(store.getState(), SITE_B, '90d', PAGE_B).data?.page.pageId).toBe(PAGE_B);
  });

  it('ignores stale list and detail request IDs', () => {
    const listKey = pagesListCacheKey(SITE_A, QUERY);
    let state = pagesReducer(undefined, loadPagesList.pending('list-1', { siteId: SITE_A, query: QUERY }));
    state = pagesReducer(state, loadPagesList.pending('list-2', { siteId: SITE_A, query: QUERY }));
    state = pagesReducer(state, loadPagesList.fulfilled(
      { key: listKey, data: listResponse(PAGE_A) },
      'list-1',
      { siteId: SITE_A, query: QUERY },
    ));
    expect(state.lists[listKey]?.data).toBeNull();

    const detailKey = pagesDetailCacheKey(SITE_A, '28d', PAGE_A);
    state = pagesReducer(state, loadPagesDetail.pending(
      'detail-1',
      { siteId: SITE_A, range: '28d', pageId: PAGE_A },
    ));
    state = pagesReducer(state, loadPagesDetail.pending(
      'detail-2',
      { siteId: SITE_A, range: '28d', pageId: PAGE_A },
    ));
    state = pagesReducer(state, loadPagesDetail.fulfilled(
      { key: detailKey, data: detailResponse() },
      'detail-1',
      { siteId: SITE_A, range: '28d', pageId: PAGE_A },
    ));
    expect(state.details[detailKey]?.data).toBeNull();
  });

  it('handles untyped reducer rejections and ignores aborted/stale detail failures', () => {
    const listInput = { siteId: SITE_A, query: QUERY };
    let state = pagesReducer(undefined, loadPagesList.pending('list', listInput));
    state = pagesReducer(state, loadPagesList.rejected(null, 'list', listInput));
    expect(state.lists[pagesListCacheKey(SITE_A, QUERY)]).toMatchObject({
      loading: false,
      loaded: true,
      error: null,
    });

    const detailInput = { siteId: SITE_A, range: '28d' as const, pageId: PAGE_A };
    state = pagesReducer(state, loadPagesDetail.pending('detail-old', detailInput));
    state = pagesReducer(state, loadPagesDetail.pending('detail-new', detailInput));
    state = pagesReducer(state, loadPagesDetail.rejected(null, 'detail-old', detailInput));
    expect(state.details[pagesDetailCacheKey(SITE_A, '28d', PAGE_A)]?.loading).toBe(true);
    state = pagesReducer(state, loadPagesDetail.rejected(
      { name: 'AbortError', message: 'aborted' },
      'detail-new',
      detailInput,
    ));
    expect(state.details[pagesDetailCacheKey(SITE_A, '28d', PAGE_A)]?.loading).toBe(true);
    state = pagesReducer(state, loadPagesDetail.pending('detail-final', detailInput));
    state = pagesReducer(state, loadPagesDetail.rejected(null, 'detail-final', detailInput));
    expect(state.details[pagesDetailCacheKey(SITE_A, '28d', PAGE_A)]).toMatchObject({
      loading: false,
      loaded: true,
      error: null,
    });
  });

  it('aborts obsolete list requests without allowing them to overwrite the newer query', async () => {
    const seen: AbortSignal[] = [];
    mockedList.mockImplementationOnce((_siteId, _query, signal) => new Promise((_, reject) => {
      seen.push(signal!);
      signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    }));
    mockedList.mockResolvedValueOnce(listResponse(PAGE_B));
    const store = makeStore();
    const first = store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    const queryB = { ...QUERY, q: 'new' };
    const second = store.dispatch(loadPagesList({ siteId: SITE_B, query: queryB }));
    await Promise.all([first, second]);
    expect(seen[0]?.aborted).toBe(true);
    expect(selectPagesListEntry(store.getState(), SITE_B, queryB).data?.items[0]?.pageId).toBe(PAGE_B);
    expect(selectPagesListEntry(store.getState(), SITE_A, QUERY).data).toBeNull();
  });

  it('retains successful rows and detail while background requests fail', async () => {
    const store = makeStore();
    const list = listResponse();
    const detail = detailResponse();
    mockedList.mockResolvedValueOnce(list);
    mockedDetail.mockResolvedValueOnce(detail);
    await store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    await store.dispatch(loadPagesDetail({ siteId: SITE_A, range: '28d', pageId: PAGE_A }));
    mockedList.mockRejectedValueOnce(new PagesClientError(requestError()));
    mockedDetail.mockRejectedValueOnce(new PagesClientError(requestError('not_found')));
    await store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    await store.dispatch(loadPagesDetail({ siteId: SITE_A, range: '28d', pageId: PAGE_A }));
    expect(selectPagesListEntry(store.getState(), SITE_A, QUERY)).toMatchObject({ data: list, error: { kind: 'unavailable' } });
    expect(selectPagesDetailEntry(store.getState(), SITE_A, '28d', PAGE_A)).toMatchObject({ data: detail, error: { kind: 'not_found' } });
  });

  it('treats a successful zero-row list as empty rather than a transport error', async () => {
    const empty = listResponse();
    empty.items = [];
    empty.pageInfo.totalFiltered = 0;
    mockedList.mockResolvedValueOnce(empty);
    const store = makeStore();
    await store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    const entry = selectPagesListEntry(store.getState(), SITE_A, QUERY);
    expect(entry.error).toBeNull();
    expect(entry.data?.items).toEqual([]);
    expect(pagesListLoadState(entry)).toBe('empty');
  });
});

describe('Pages explicit refresh', () => {
  it('invalidates then reloads the current list/detail only after explicit refresh', async () => {
    const store = makeStore();
    const refreshed = listResponse(PAGE_B);
    const refreshedDetail = detailResponse(PAGE_A);
    mockedRefresh.mockResolvedValueOnce({
      refresh: {
        outcome: 'refreshed',
        source: 'dataforseo',
        cache: 'hit',
        observedAt: '2026-08-10T11:00:00.000Z',
      },
      state: refreshed,
    });
    mockedList.mockResolvedValueOnce(refreshed);
    mockedDetail.mockResolvedValueOnce(refreshedDetail);

    expect(mockedRefresh).not.toHaveBeenCalled();
    const action = await store.dispatch(refreshPages({ siteId: SITE_A, query: QUERY, pageId: PAGE_A }));
    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith(SITE_A, QUERY, expect.any(AbortSignal));
    expect(mockedDetail).toHaveBeenCalledWith(SITE_A, PAGE_A, '28d', expect.any(AbortSignal));
    expect(selectPagesListEntry(store.getState(), SITE_A, QUERY)).toMatchObject({
      invalidated: false,
      data: refreshed,
    });
    expect(selectPagesRefresh(store.getState(), SITE_A)).toMatchObject({
      loading: false,
      error: null,
      lastResult: { cache: 'hit', source: 'dataforseo' },
    });
  });

  it('reloads only the list when no detail is open', async () => {
    const response = listResponse();
    mockedRefresh.mockResolvedValueOnce({
      refresh: {
        outcome: 'empty',
        source: 'demo',
        cache: 'miss',
        observedAt: '2026-08-10T11:00:00.000Z',
      },
      state: response,
    });
    mockedList.mockResolvedValueOnce(response);
    const store = makeStore();
    await store.dispatch(refreshPages({ siteId: SITE_A, query: QUERY, pageId: null }));
    expect(mockedDetail).not.toHaveBeenCalled();
  });

  it('retains rows, adopts the stale envelope, and exposes typed retry state on failure', async () => {
    const store = makeStore();
    const existing = listResponse();
    mockedList.mockResolvedValueOnce(existing);
    await store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    const retained = listResponse(PAGE_B, { status: 'stale' });
    const error = requestError('unavailable', retained);
    mockedRefresh.mockRejectedValueOnce(new PagesClientError(error));
    await store.dispatch(refreshPages({ siteId: SITE_A, query: QUERY, pageId: null }));
    const entry = selectPagesListEntry(store.getState(), SITE_A, QUERY);
    expect(entry.data?.items[0]?.pageId).toBe(PAGE_A);
    expect(entry.data?.envelope.status).toBe('stale');
    expect(selectPagesRefresh(store.getState(), SITE_A).error).toBe(error);
  });

  it('ignores stale and aborted refresh completions', () => {
    const input = { siteId: SITE_A, query: QUERY, pageId: null };
    let state = pagesReducer(undefined, refreshPages.pending('refresh-1', input));
    state = pagesReducer(state, refreshPages.pending('refresh-2', input));
    const result = {
      refresh: {
        outcome: 'empty' as const,
        source: 'demo' as const,
        cache: 'miss' as const,
        observedAt: 'now',
      },
      state: listResponse(),
    };
    state = pagesReducer(state, refreshPages.fulfilled(result, 'refresh-1', input));
    expect(state.refreshes[SITE_A]?.loading).toBe(true);
    state = pagesReducer(state, refreshPages.rejected(
      { name: 'AbortError', message: 'aborted' },
      'refresh-2',
      input,
    ));
    expect(state.refreshes[SITE_A]?.loading).toBe(true);
  });

  it('handles an untyped latest refresh rejection without retained data', () => {
    const input = { siteId: SITE_A, query: QUERY, pageId: null };
    let state = pagesReducer(undefined, refreshPages.pending('refresh', input));
    state = pagesReducer(state, refreshPages.rejected(null, 'refresh', input));
    expect(state.refreshes[SITE_A]).toMatchObject({ loading: false, error: null });
  });
});

describe('Pages loading and source-capability selectors', () => {
  const entry = (
    data: PagesListResponse | null,
    overrides: Partial<PagesCacheEntry<PagesListResponse>> = {},
  ): PagesCacheEntry<PagesListResponse> => ({
    data,
    loading: false,
    loaded: data !== null,
    invalidated: false,
    error: null,
    requestId: null,
    ...overrides,
  });
  const detailEntry = (
    data: PagesDetailResponse | null,
    overrides: Partial<PagesCacheEntry<PagesDetailResponse>> = {},
  ): PagesCacheEntry<PagesDetailResponse> => ({
    data,
    loading: false,
    loaded: data !== null,
    invalidated: false,
    error: null,
    requestId: null,
    ...overrides,
  });

  it('classifies initial, background, ready, empty, syncing, stale, unavailable, and error states', () => {
    expect(pagesListLoadState(entry(null))).toBe('initial_loading');
    expect(pagesListLoadState(entry(null, { loading: true }))).toBe('initial_loading');
    expect(pagesListLoadState(entry(listResponse(), { loading: true }))).toBe('background_loading');
    expect(pagesListLoadState(entry(listResponse()))).toBe('ready');
    expect(pagesListLoadState(entry(listResponse(PAGE_A, { status: 'empty' })))).toBe('empty');
    expect(pagesListLoadState(entry(listResponse(PAGE_A, { status: 'syncing' })))).toBe('syncing');
    expect(pagesListLoadState(entry(listResponse(PAGE_A, { status: 'stale' })))).toBe('stale');
    expect(pagesListLoadState(entry(listResponse(PAGE_A, { status: 'unavailable' })))).toBe('unavailable');
    expect(pagesListLoadState(entry(null, { loaded: true, error: requestError() }))).toBe('error');

    const detail = detailResponse();
    expect(pagesDetailLoadState(detailEntry(null, { loading: true }))).toBe('initial_loading');
    expect(pagesDetailLoadState(detailEntry(null))).toBe('initial_loading');
    expect(pagesDetailLoadState(detailEntry(detail, { loading: true }))).toBe('background_loading');
    expect(pagesDetailLoadState(detailEntry(detail))).toBe('ready');
    expect(pagesDetailLoadState(detailEntry(null, { loaded: true }))).toBe('error');
    expect(pagesDetailLoadState(detailEntry(null, { error: requestError() }))).toBe('error');
    expect(pagesDetailLoadState(detailEntry(null, { loaded: true, error: requestError() }))).toBe('error');
  });

  it('derives observed, estimated, demo, none, actions, filters, sorts, metrics, and coverage', () => {
    const observed = pagesSourceCapabilities(envelope({
      source: 'gsc',
      status: 'syncing',
      fallbackReason: null,
      rangeSemantics: 'rolling_window',
    }));
    expect(observed).toMatchObject({
      isObserved: true,
      isEstimated: false,
      isDemo: false,
      connectionAction: 'collect',
      canRefresh: true,
      coverage,
      metricAvailability: { clicks: true, bestPosition: false, associatedQueryCount: true },
    });
    expect(observed.supportedInsights).toContain('low_ctr');
    expect(observed.supportedSorts).toContain('click_change_pct');

    const estimated = pagesSourceCapabilities(envelope());
    expect(estimated).toMatchObject({
      isObserved: false,
      isEstimated: true,
      isDemo: false,
      connectionAction: 'connect',
      metricAvailability: { clicks: false, bestPosition: true },
    });
    expect(estimated.supportedInsights).not.toContain('low_ctr');
    expect(estimated.supportedSorts).toContain('estimated_traffic');

    expect(pagesSourceCapabilities(envelope({
      source: 'demo',
      fallbackReason: 'gsc_needs_reconnect',
    }))).toMatchObject({ isDemo: true, connectionAction: 'reconnect' });
    expect(pagesSourceCapabilities(envelope({
      source: 'none',
      fallbackReason: 'gsc_revoked',
    }))).toMatchObject({ isEstimated: false, connectionAction: 'reconnect' });
    const none = pagesSourceCapabilities(envelope({
      source: 'none',
      fallbackReason: 'gsc_property_unmatched',
    }));
    expect(none.connectionAction).toBe('select_property');
    expect(none.supportedInsights).toEqual(['unmeasured']);
    expect(none.supportedSorts).toEqual(['opportunity', 'url', 'title']);
    expect(pagesSourceCapabilities(envelope({ source: 'gsc', fallbackReason: null })).connectionAction).toBeNull();
  });

  it('selects phases and capabilities with lazy-state fallbacks and refresh-error envelopes', () => {
    const emptyRoot = {} as RootState;
    expect(selectPagesListEntry(emptyRoot, SITE_A, QUERY).data).toBeNull();
    expect(selectPagesDetailEntry(emptyRoot, SITE_A, '28d', PAGE_A).data).toBeNull();
    expect(selectPagesRefresh(emptyRoot, SITE_A).loading).toBe(false);
    expect(selectPagesSourceCapabilities(emptyRoot, SITE_A, QUERY)).toBeNull();
    expect(selectPagesListLoadState(emptyRoot, SITE_A, QUERY)).toBe('initial_loading');

    const store = makeStore();
    store.dispatch(loadPagesList.pending('request', { siteId: SITE_A, query: QUERY }));
    expect(selectPagesListLoadState(store.getState(), SITE_A, QUERY)).toBe('initial_loading');
    store.dispatch(loadPagesDetail.pending('detail', { siteId: SITE_A, range: '28d', pageId: PAGE_A }));
    expect(selectPagesDetailLoadState(store.getState(), SITE_A, '28d', PAGE_A)).toBe('initial_loading');

    store.dispatch(resetPagesState());
    const error = requestError('unavailable', listResponse(PAGE_A, { status: 'unavailable' }));
    store.dispatch(refreshPages.pending('refresh', { siteId: SITE_A, query: QUERY, pageId: null }));
    store.dispatch(refreshPages.rejected(
      null,
      'refresh',
      { siteId: SITE_A, query: QUERY, pageId: null },
      error,
    ));
    expect(selectPagesSourceCapabilities(store.getState(), SITE_A, QUERY)?.isEstimated).toBe(true);
    expect(selectPagesListLoadState(store.getState(), SITE_A, QUERY)).toBe('unavailable');
  });
});

describe('Pages cancellation cleanup', () => {
  it('aborts active list, detail, and refresh lanes and safely repeats cleanup', async () => {
    const signals: AbortSignal[] = [];
    const pending = (_a: unknown, _b?: unknown, signal?: AbortSignal) => new Promise<never>((_, reject) => {
      signals.push(signal!);
      signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    });
    mockedList.mockImplementation(pending);
    mockedDetail.mockImplementation((_site, _page, _range, signal) => pending(null, null, signal));
    mockedRefresh.mockImplementation((_site, signal) => pending(null, null, signal));
    const store = makeStore();
    const actions = [
      store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY })),
      store.dispatch(loadPagesDetail({ siteId: SITE_A, range: '28d', pageId: PAGE_A })),
      store.dispatch(refreshPages({ siteId: SITE_A, query: QUERY, pageId: null })),
    ];
    abortPagesRequests();
    abortPagesRequests();
    await Promise.all(actions);
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('ignores reducer rejections marked as aborted', async () => {
    mockedList.mockImplementation((_site, _query, signal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    }));
    const store = makeStore();
    const promise = store.dispatch(loadPagesList({ siteId: SITE_A, query: QUERY }));
    promise.abort();
    await promise;
    expect(selectPagesListEntry(store.getState(), SITE_A, QUERY)).toMatchObject({
      loading: true,
      error: null,
    });
  });
});
