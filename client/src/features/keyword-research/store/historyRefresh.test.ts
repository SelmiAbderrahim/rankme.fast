/**
 * "Recent research" must reflect a lookup without a page reload.
 *
 * Every research call the server records into history refreshes the first
 * history page once it succeeds (only when a view has already loaded
 * history), and the slice applies only the newest first-page load so the
 * metrics + intent refreshes racing after one lookup cannot overwrite each
 * other with a stale page.
 */
import { configureStore } from '@reduxjs/toolkit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    fetchHistoryRequest: vi.fn(),
    fetchStoredResultRequest: vi.fn(),
    fetchKeywordPreviewRequest: vi.fn(),
    fetchMetricsRequest: vi.fn(),
    fetchRelatedRequest: vi.fn(),
    fetchIntentRequest: vi.fn(),
    fetchIdeasRequest: vi.fn(),
    fetchLongTailRequest: vi.fn(),
    fetchGapRequest: vi.fn(),
    fetchOverviewRequest: vi.fn(),
    fetchTrendsRequest: vi.fn(),
    runClustersRequest: vi.fn(),
  };
});

import * as api from '../api';
import { ApiError } from '@shared/api/client';
import { clearStored, initialState, keywordResearchReducer } from './slice';
import {
  fetchIdeas,
  fetchIntent,
  fetchLongTail,
  loadHistory,
  loadMetrics,
  fetchKeywordPreview,
  loadRelated,
  openStoredResearch,
  runClusters,
  runGap,
  runOverview,
  runTrends,
} from './thunks';
import type { ResearchHistoryItem } from '../types';

const mocked = vi.mocked(api);

const item = (id: string, kind: ResearchHistoryItem['kind'] = 'metrics'): ResearchHistoryItem => ({
  id,
  kind,
  phrases: ['rank tracker'],
  locationCode: 2840,
  languageCode: 'en',
  resultCount: 1,
  cached: false,
  lookupId: null,
  createdAt: '2026-07-10T00:00:00.000Z',
});

const makeStore = (historyLoaded: boolean) =>
  configureStore({
    reducer: { keywordResearch: keywordResearchReducer },
    preloadedState: { keywordResearch: { ...initialState, historyLoaded } },
  });

const market = { locationCode: 2840, languageCode: 'en' };

/** Every thunk whose server handler writes a research-history row. */
const researchCalls = [
  {
    name: 'loadMetrics',
    arrange: () => mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] }),
    fail: () => mocked.fetchMetricsRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => loadMetrics({ keywords: ['a'], ...market }),
  },
  {
    name: 'loadRelated',
    arrange: () =>
      mocked.fetchRelatedRequest.mockResolvedValueOnce({ keyword: 'a', related: [], cached: false } as never),
    fail: () => mocked.fetchRelatedRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => loadRelated({ keyword: 'a', ...market }),
  },
  {
    name: 'fetchIntent',
    arrange: () => mocked.fetchIntentRequest.mockResolvedValueOnce({ intents: [] }),
    fail: () => mocked.fetchIntentRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => fetchIntent({ keywords: ['a'], ...market }),
  },
  {
    name: 'fetchIdeas',
    arrange: () =>
      mocked.fetchIdeasRequest.mockResolvedValueOnce({ seed: 'a', ideas: [], cached: false } as never),
    fail: () => mocked.fetchIdeasRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => fetchIdeas({ seed: 'a', ...market }),
  },
  {
    name: 'fetchLongTail',
    arrange: () =>
      mocked.fetchLongTailRequest.mockResolvedValueOnce({ seed: 'a', suggestions: [], cached: false }),
    fail: () => mocked.fetchLongTailRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => fetchLongTail({ seed: 'a', ...market }),
  },
  {
    name: 'runGap',
    arrange: () => mocked.fetchGapRequest.mockResolvedValueOnce({} as never),
    fail: () => mocked.fetchGapRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => runGap({} as never),
  },
  {
    name: 'runOverview',
    arrange: () => mocked.fetchOverviewRequest.mockResolvedValueOnce({ rows: [] } as never),
    fail: () => mocked.fetchOverviewRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => runOverview({} as never),
  },
  {
    name: 'runTrends',
    arrange: () => mocked.fetchTrendsRequest.mockResolvedValueOnce({ rows: [] } as never),
    fail: () => mocked.fetchTrendsRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => runTrends({} as never),
  },
  {
    name: 'runClusters',
    arrange: () => mocked.runClustersRequest.mockResolvedValueOnce({ runId: 'r1', clusters: [] } as never),
    fail: () => mocked.runClustersRequest.mockRejectedValueOnce(new Error('boom')),
    thunk: () => runClusters({} as never),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchHistoryRequest.mockResolvedValue({ items: [item('fresh')], nextCursor: null });
});

describe('research thunks refresh the history page', () => {
  for (const call of researchCalls) {
    it(`${call.name} refetches the first history page after success`, async () => {
      const store = makeStore(true);
      call.arrange();
      await store.dispatch(call.thunk() as never);
      await vi.waitFor(() =>
        expect(store.getState().keywordResearch.history.map((h) => h.id)).toEqual(['fresh']),
      );
      expect(mocked.fetchHistoryRequest).toHaveBeenCalledTimes(1);
      expect(mocked.fetchHistoryRequest).toHaveBeenCalledWith({});
    });

    it(`${call.name} does not refetch history after a failure`, async () => {
      const store = makeStore(true);
      call.fail();
      await store.dispatch(call.thunk() as never);
      expect(mocked.fetchHistoryRequest).not.toHaveBeenCalled();
    });
  }

  it('a site-scoped list refreshes with its site scope', async () => {
    const store = configureStore({
      reducer: { keywordResearch: keywordResearchReducer },
      preloadedState: {
        keywordResearch: { ...initialState, historyLoaded: true, historySiteId: 'site-1' },
      },
    });
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] });
    await store.dispatch(loadMetrics({ keywords: ['a'], ...market, siteId: 'site-1' }));
    expect(mocked.fetchHistoryRequest).toHaveBeenCalledWith({ siteId: 'site-1' });
  });

  it('skips the refresh when no view has loaded history yet', async () => {
    const store = makeStore(false);
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] });
    await store.dispatch(loadMetrics({ keywords: ['a'], ...market }));
    expect(mocked.fetchHistoryRequest).not.toHaveBeenCalled();
  });

  it('skips the refresh when the slice is not mounted', async () => {
    const store = configureStore({ reducer: { other: (s: number = 0) => s } });
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] });
    await store.dispatch(loadMetrics({ keywords: ['a'], ...market }) as never);
    expect(mocked.fetchHistoryRequest).not.toHaveBeenCalled();
  });
});

describe('loadHistory ordering guard', () => {
  it('a superseded first-page load never overwrites the newer one', async () => {
    const store = makeStore(true);
    let resolveOld: (v: { items: ResearchHistoryItem[]; nextCursor: string | null }) => void =
      () => undefined;
    mocked.fetchHistoryRequest
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValueOnce({ items: [item('new-2'), item('new-1')], nextCursor: null });
    const older = store.dispatch(loadHistory({}));
    await store.dispatch(loadHistory({}));
    expect(store.getState().keywordResearch.history.map((h) => h.id)).toEqual(['new-2', 'new-1']);
    resolveOld({ items: [item('old-1')], nextCursor: null });
    await older;
    expect(store.getState().keywordResearch.history.map((h) => h.id)).toEqual(['new-2', 'new-1']);
  });

  it('a superseded failure is still surfaced but keeps the newer load in flight', () => {
    const pendingNew = keywordResearchReducer(
      initialState,
      loadHistory.pending('new', {}),
    );
    const next = keywordResearchReducer(
      pendingNew,
      loadHistory.rejected(new Error('x'), 'old', {}, { error: 'nope' }),
    );
    expect(next.historyLoading).toBe(true);
    expect(next.historyError).toBe('nope');
  });

  it('cursor pages are never treated as superseded', () => {
    const base = keywordResearchReducer(
      { ...initialState, history: [item('a')], historyRequestId: 'first' },
      loadHistory.pending('page-2', { cursor: 'c1' }),
    );
    expect(base.historyRequestId).toBe('first');
    const next = keywordResearchReducer(
      base,
      loadHistory.fulfilled({ items: [item('b')], nextCursor: null }, 'page-2', { cursor: 'c1' }),
    );
    expect(next.history.map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('a first-page load for another scope clears the old rows; the same scope keeps them', () => {
    const accountWide = { ...initialState, history: [item('acct')], historyCursor: 'c9' };
    const sameScope = keywordResearchReducer(accountWide, loadHistory.pending('r1', {}));
    expect(sameScope.history.map((h) => h.id)).toEqual(['acct']);
    const siteScope = keywordResearchReducer(accountWide, loadHistory.pending('r2', { siteId: 's1' }));
    expect(siteScope.history).toEqual([]);
    expect(siteScope.historyCursor).toBeNull();
    expect(siteScope.historySiteId).toBe('s1');
  });
});

describe('openStoredResearch', () => {
  const stored = (id: string) => ({
    id,
    kind: 'metrics' as const,
    lookupId: null,
    phrases: ['rank tracker'],
    locationCode: 2840,
    languageCode: 'en',
    status: 'available' as const,
    requestedCount: 1,
    storedCount: 1,
    seed: null,
    keywords: [],
    items: [],
    fetchedAt: null,
    expiresAt: null,
  });

  it('shows the row being opened, stores its result, and does not refresh history', async () => {
    const store = makeStore(false);
    mocked.fetchStoredResultRequest.mockResolvedValueOnce(stored('row-1'));
    const request = store.dispatch(openStoredResearch({ historyId: 'row-1' }));
    expect(store.getState().keywordResearch.stored).toMatchObject({ loading: true, historyId: 'row-1' });
    await request;
    expect(store.getState().keywordResearch.stored).toMatchObject({
      loading: false,
      error: '',
      historyId: 'row-1',
      result: { id: 'row-1' },
    });
    expect(mocked.fetchHistoryRequest).not.toHaveBeenCalled();
  });

  it('records a failure and drops responses for a row that is no longer open', async () => {
    const store = makeStore(false);
    mocked.fetchStoredResultRequest.mockRejectedValueOnce(new ApiError('missing', 404, {}));
    await store.dispatch(openStoredResearch({ historyId: 'row-1' }));
    expect(store.getState().keywordResearch.stored.error).not.toBe('');
    expect(store.getState().keywordResearch.stored.loading).toBe(false);

    let resolveFirst: (value: ReturnType<typeof stored>) => void = () => undefined;
    mocked.fetchStoredResultRequest
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(stored('row-2'));
    const first = store.dispatch(openStoredResearch({ historyId: 'row-1' }));
    await store.dispatch(openStoredResearch({ historyId: 'row-2' }));
    resolveFirst(stored('row-1'));
    await first;
    expect(store.getState().keywordResearch.stored.result?.id).toBe('row-2');

    mocked.fetchStoredResultRequest.mockRejectedValueOnce(new ApiError('late', 500, {}));
    const late = store.dispatch(openStoredResearch({ historyId: 'row-3' }));
    store.dispatch(clearStored());
    await late;
    expect(store.getState().keywordResearch.stored).toEqual({
      loading: false,
      error: '',
      historyId: null,
      result: null,
    });
  });

  it('drops a late success for a row that was closed', async () => {
    const store = makeStore(false);
    let resolve: (value: ReturnType<typeof stored>) => void = () => undefined;
    mocked.fetchStoredResultRequest.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const request = store.dispatch(openStoredResearch({ historyId: 'row-1' }));
    store.dispatch(clearStored());
    resolve(stored('row-1'));
    await request;
    expect(store.getState().keywordResearch.stored.result).toBeNull();
  });
});

describe('history scope', () => {
  it('clears the list when the scope changes and records the total', async () => {
    const store = makeStore(false);
    mocked.fetchHistoryRequest.mockResolvedValueOnce({ items: [item('a')], nextCursor: 'a', total: 4 });
    await store.dispatch(loadHistory({}));
    expect(store.getState().keywordResearch).toMatchObject({ historySiteId: null, historyTotal: 4 });
    mocked.fetchHistoryRequest.mockImplementationOnce(() => new Promise(() => undefined));
    void store.dispatch(loadHistory({ siteId: 's1' }));
    expect(store.getState().keywordResearch).toMatchObject({
      historySiteId: 's1',
      history: [],
      historyCursor: null,
      historyTotal: null,
    });
  });
});

describe('competitors field refusal', () => {
  it('carries the field message from the preview and the run into the gap form state', async () => {
    const store = makeStore(false);
    const refusal = new ApiError('x', 400, {
      error: {
        message: 'Validation failed.',
        details: { fieldErrors: { competitors: ['Remove the duplicate competitor domain.'] } },
      },
    });
    mocked.fetchKeywordPreviewRequest.mockRejectedValueOnce(refusal);
    await store.dispatch(fetchKeywordPreview({ operation: 'gap', ownDomain: 'a.example', competitors: ['b.example'], ...market }));
    expect(store.getState().keywordResearch.preview.competitorsError).toBe(
      'Remove the duplicate competitor domain.',
    );
    mocked.fetchGapRequest.mockRejectedValueOnce(refusal);
    await store.dispatch(runGap({ ownDomain: 'a.example', competitors: ['b.example'], ...market }));
    expect(store.getState().keywordResearch.gap.competitorsError).toBe(
      'Remove the duplicate competitor domain.',
    );
    // A new attempt clears both until the server answers again.
    mocked.fetchGapRequest.mockImplementationOnce(() => new Promise(() => undefined));
    void store.dispatch(runGap({ ownDomain: 'a.example', competitors: ['b.example'], ...market }));
    expect(store.getState().keywordResearch.gap.competitorsError).toBe('');
  });

  it('treats a refusal without a field message and an empty payload as no field error', async () => {
    const store = makeStore(false);
    mocked.fetchKeywordPreviewRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await store.dispatch(fetchKeywordPreview({ operation: 'gap', ownDomain: 'a.example', competitors: ['b.example'], ...market }));
    expect(store.getState().keywordResearch.preview.competitorsError).toBe('');
    const bare = {
      type: runGap.rejected.type,
      payload: undefined,
      error: { message: 'x' },
      meta: { arg: {}, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    };
    store.dispatch(bare);
    expect(store.getState().keywordResearch.gap.competitorsError).toBe('');
    store.dispatch({ ...bare, type: fetchKeywordPreview.rejected.type });
    expect(store.getState().keywordResearch.preview.competitorsError).toBe('');
  });
});
