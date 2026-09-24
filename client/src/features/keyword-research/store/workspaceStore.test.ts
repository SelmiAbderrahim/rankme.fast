/**
 * Workspace store coverage: the eight new thunks against the
 * real slice reducer, including error payloads, preview lifecycle, cluster run identity, cursor paging, and 409 conflict flags.
 */
import { configureStore } from '@reduxjs/toolkit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';

beforeAll(() => {
  // The generic-error path falls back to `i18n.t(<key>)` — init once so the
  // fallback resolves a real localized string instead of an empty value.
  initI18n({ initialLocale: 'en' });
});

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    fetchKeywordPreviewRequest: vi.fn(),
    fetchGapRequest: vi.fn(),
    fetchOverviewRequest: vi.fn(),
    fetchTrendsRequest: vi.fn(),
    runClustersRequest: vi.fn(),
    fetchClusterRunsRequest: vi.fn(),
    fetchClusterRunRequest: vi.fn(),
    postClusterDecisionRequest: vi.fn(),
  };
});

import * as api from '../api';
import { clearPreview, decisionKey, initialState, keywordResearchReducer } from './slice';
import {
  decideCluster,
  fetchKeywordPreview,
  loadClusterRun,
  loadClusterRuns,
  runClusters,
  runGap,
  runOverview,
  runTrends,
} from './thunks';
import type {
  ClusterDecisionResponse,
  ClusterRun,
  GapResponse,
  KeywordObservationMeta,
  KeywordSpendPreview,
} from '../types';

const meta: KeywordObservationMeta = {
  kind: 'provider_observation',
  observedAt: '2026-07-01T00:00:00.000Z',
  freshUntil: '2026-07-31T00:00:00.000Z',
  market: { locationCode: 2840, languageCode: 'en' },
};

const preview: KeywordSpendPreview = {};

const gapResponse: GapResponse = {
  ownDomain: 'own.example',
  pairs: [
    {
      ownDomain: 'own.example',
      competitorDomain: 'rival.example',
      cached: false,
      fetchedAt: '2026-07-19T00:00:00.000Z',
      expiresAt: '2026-08-18T00:00:00.000Z',
      rows: [{ keyword: 'seo audit', ownPosition: null, competitorPosition: 3, searchVolume: 900 }],
      meta,
    },
  ],
};

function clusterRun(runId = 'a'.repeat(64), cached = false): ClusterRun {
  return {
    runId,
    market: { locationCode: 2840, languageCode: 'en' },
    memberRefs: [
      { keyword: 'seo audit', source: 'vendor_cache', observedAt: '2026-07-01T00:00:00.000Z' },
    ],
    clusters: [
      {
        clusterId: 'c'.repeat(32),
        label: 'Audit topics',
        memberKeywords: ['seo audit'],
        suggestedRoute: 'brief',
        confidence: 'high',
        summedSearchVolume: 900,
      },
    ],
    aiProfile: { name: 'keyword-clusters', version: '1' },
    costMicros: 1200,
    createdAt: '2026-07-19T00:00:00.000Z',
    cached,
  };
}

const decision: ClusterDecisionResponse = {
  id: 'd1',
  runId: 'a'.repeat(64),
  clusterId: 'c'.repeat(32),
  kind: 'accepted',
  siteId: 'f'.repeat(24),
  recommendationId: `keyword-cluster:${'0'.repeat(32)}`,
  createdAt: '2026-07-19T00:00:00.000Z',
};

const vendorError = new ApiError('vendor', 503, {
  error: { message: 'Keyword data is temporarily unavailable.' },
});

const conflictError = new ApiError('conflict', 409, {
  error: { message: 'That cluster already has a different decision.' },
});

function makeStore() {
  return configureStore({ reducer: { keywordResearch: keywordResearchReducer } });
}

beforeEach(() => {
  vi.mocked(api.fetchKeywordPreviewRequest).mockReset();
  vi.mocked(api.fetchGapRequest).mockReset();
  vi.mocked(api.fetchOverviewRequest).mockReset();
  vi.mocked(api.fetchTrendsRequest).mockReset();
  vi.mocked(api.runClustersRequest).mockReset();
  vi.mocked(api.fetchClusterRunsRequest).mockReset();
  vi.mocked(api.fetchClusterRunRequest).mockReset();
  vi.mocked(api.postClusterDecisionRequest).mockReset();
});

describe('fetchKeywordPreview', () => {
  it('stores the server preview verbatim for its operation', async () => {
    vi.mocked(api.fetchKeywordPreviewRequest).mockResolvedValue(preview);
    const store = makeStore();
    await store.dispatch(
      fetchKeywordPreview({
        operation: 'gap',
        ownDomain: 'own.example',
        competitors: ['rival.example'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    const state = store.getState().keywordResearch;
    expect(state.preview.loading).toBe(false);
    expect(state.preview.forOperation).toBe('gap');
    expect(state.preview.data).toEqual(preview);
  });

  it('marks the pending state while in flight', () => {
    vi.mocked(api.fetchKeywordPreviewRequest).mockReturnValue(new Promise(() => {}));
    const store = makeStore();
    void store.dispatch(
      fetchKeywordPreview({
        operation: 'overview',
        keywords: ['a'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    const state = store.getState().keywordResearch;
    expect(state.preview.loading).toBe(true);
    expect(state.preview.forOperation).toBe('overview');
  });

  it('a rejection records the localized error', async () => {
    vi.mocked(api.fetchKeywordPreviewRequest).mockRejectedValue(vendorError);
    const store = makeStore();
    await store.dispatch(
      fetchKeywordPreview({
        operation: 'trends',
        keywords: ['a'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    const state = store.getState().keywordResearch;
    expect(state.preview.error).toBe('Keyword data is temporarily unavailable.');
    expect(state.preview.data).toBeNull();
  });

  it('clearPreview resets the slot', async () => {
    vi.mocked(api.fetchKeywordPreviewRequest).mockResolvedValue(preview);
    const store = makeStore();
    await store.dispatch(
      fetchKeywordPreview({
        operation: 'gap',
        ownDomain: 'o.example',
        competitors: ['r.example'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    store.dispatch(clearPreview());
    expect(store.getState().keywordResearch.preview).toEqual({
      loading: false,
      data: null,
      error: '',
      forOperation: null,
    });
  });
});

describe('runGap', () => {
  const args = {
    ownDomain: 'own.example',
    competitors: ['rival.example'],
    locationCode: 2840,
    languageCode: 'en',
  };

  it('stores the response and clears the confirmed preview', async () => {
    vi.mocked(api.fetchKeywordPreviewRequest).mockResolvedValue(preview);
    vi.mocked(api.fetchGapRequest).mockResolvedValue(gapResponse);
    const store = makeStore();
    await store.dispatch(fetchKeywordPreview({ operation: 'gap', ...args }));
    await store.dispatch(runGap(args));
    const state = store.getState().keywordResearch;
    expect(state.gap.data).toEqual(gapResponse);
    expect(state.gap.loading).toBe(false);
    expect(state.preview.data).toBeNull();
  });

  it('records the localized error on rejection', async () => {
    vi.mocked(api.fetchGapRequest).mockRejectedValue(vendorError);
    const store = makeStore();
    await store.dispatch(runGap(args));
    const state = store.getState().keywordResearch;
    expect(state.gap.error).toContain('temporarily unavailable');
    expect(state.gap.loading).toBe(false);
  });

  it('marks loading while pending', () => {
    vi.mocked(api.fetchGapRequest).mockReturnValue(new Promise(() => {}));
    const store = makeStore();
    void store.dispatch(runGap(args));
    expect(store.getState().keywordResearch.gap.loading).toBe(true);
  });
});

describe('runOverview / runTrends', () => {
  const args = { keywords: ['a'], locationCode: 2840, languageCode: 'en' };

  it('overview stores rows and clears the preview', async () => {
    vi.mocked(api.fetchOverviewRequest).mockResolvedValue({
      keywords: [
        {
          keyword: 'a',
          searchVolume: 10,
          difficulty: 20,
          cpc: '1.000000',
          intent: 'informational',
          serpFeatures: ['ai_overview'],
          resultsCount: 100,
          observedAt: '2026-07-01T00:00:00.000Z',
          cached: false,
          fetchedAt: '2026-07-19T00:00:00.000Z',
          expiresAt: '2026-08-18T00:00:00.000Z',
          meta,
        },
      ],
    });
    const store = makeStore();
    await store.dispatch(runOverview(args));
    const state = store.getState().keywordResearch;
    expect(state.overview.rows).toHaveLength(1);
    expect(state.overview.loaded).toBe(true);
  });

  it('overview pending + rejected transitions', async () => {
    const store = makeStore();
    vi.mocked(api.fetchOverviewRequest).mockReturnValueOnce(new Promise(() => {}));
    void store.dispatch(runOverview(args));
    expect(store.getState().keywordResearch.overview.loading).toBe(true);
    vi.mocked(api.fetchOverviewRequest).mockRejectedValueOnce(vendorError);
    await store.dispatch(runOverview(args));
    expect(store.getState().keywordResearch.overview.error).toContain('temporarily unavailable');
    expect(store.getState().keywordResearch.overview.loaded).toBe(true);
  });

  it('trends stores rows; a rejection records the error', async () => {
    vi.mocked(api.fetchTrendsRequest).mockResolvedValueOnce({
      keywords: [
        {
          keyword: 'a',
          monthlySearches: [{ year: 2026, month: 1, searchVolume: 100 }],
          trends: {
            yoyDelta: null,
            twelveMonthMomentum: null,
            seasonalityFlags: { peakMonth: null, troughMonth: null },
          },
          cached: true,
          fetchedAt: '2026-07-19T00:00:00.000Z',
          expiresAt: '2026-08-18T00:00:00.000Z',
          meta: { ...meta, kind: 'estimate' },
        },
      ],
    });
    const store = makeStore();
    await store.dispatch(runTrends(args));
    expect(store.getState().keywordResearch.trends.rows).toHaveLength(1);
    vi.mocked(api.fetchTrendsRequest).mockReturnValueOnce(new Promise(() => {}));
    void store.dispatch(runTrends(args));
    expect(store.getState().keywordResearch.trends.loading).toBe(true);
    vi.mocked(api.fetchTrendsRequest).mockRejectedValueOnce(vendorError);
    await store.dispatch(runTrends(args));
    expect(store.getState().keywordResearch.trends.error).toContain('temporarily unavailable');
  });
});

describe('runClusters', () => {
  const args = {
    phrases: Array.from({ length: 10 }, (_, i) => `phrase ${i}`),
    locationCode: 2840,
    languageCode: 'en',
  };

  it('prepends a fresh run and replaces an identical rerun in the list', async () => {
    const first = clusterRun('a'.repeat(64), false);
    vi.mocked(api.runClustersRequest).mockResolvedValueOnce(first);
    const store = makeStore();
    await store.dispatch(runClusters(args));
    expect(store.getState().keywordResearch.clusters.run).toEqual(first);
    expect(store.getState().keywordResearch.clusters.runs).toHaveLength(1);

    const rerun = clusterRun('a'.repeat(64), true);
    vi.mocked(api.runClustersRequest).mockResolvedValueOnce(rerun);
    await store.dispatch(runClusters(args));
    const state = store.getState().keywordResearch;
    expect(state.clusters.run?.cached).toBe(true);
    // Identity: the identical rerun replaced its stored entry — no duplicate.
    expect(state.clusters.runs).toHaveLength(1);
  });

  it('pending + server + generic error transitions', async () => {
    const store = makeStore();
    vi.mocked(api.runClustersRequest).mockReturnValueOnce(new Promise(() => {}));
    void store.dispatch(runClusters(args));
    expect(store.getState().keywordResearch.clusters.running).toBe(true);
    vi.mocked(api.runClustersRequest).mockRejectedValueOnce(vendorError);
    await store.dispatch(runClusters(args));
    expect(store.getState().keywordResearch.clusters.runError).toContain('temporarily unavailable');
    vi.mocked(api.runClustersRequest).mockRejectedValueOnce(new Error('boom'));
    await store.dispatch(runClusters(args));
    expect(store.getState().keywordResearch.clusters.runError).not.toBe('');
    expect(store.getState().keywordResearch.clusters.running).toBe(false);
  });
});

describe('loadClusterRuns', () => {
  it('replaces on a cursor-less load and appends on cursor pages', async () => {
    const store = makeStore();
    vi.mocked(api.fetchClusterRunsRequest).mockResolvedValueOnce({
      runs: [clusterRun('a'.repeat(64))],
      nextCursor: 'cur-1',
    });
    await store.dispatch(loadClusterRuns({}));
    expect(store.getState().keywordResearch.clusters.runs).toHaveLength(1);
    expect(store.getState().keywordResearch.clusters.runsCursor).toBe('cur-1');

    vi.mocked(api.fetchClusterRunsRequest).mockResolvedValueOnce({
      runs: [clusterRun('b'.repeat(64))],
      nextCursor: null,
    });
    await store.dispatch(loadClusterRuns({ cursor: 'cur-1' }));
    const state = store.getState().keywordResearch;
    expect(state.clusters.runs).toHaveLength(2);
    expect(state.clusters.runsCursor).toBeNull();
    expect(state.clusters.runsLoaded).toBe(true);
  });

  it('pending + rejected transitions', async () => {
    const store = makeStore();
    vi.mocked(api.fetchClusterRunsRequest).mockReturnValueOnce(new Promise(() => {}));
    void store.dispatch(loadClusterRuns({}));
    expect(store.getState().keywordResearch.clusters.runsLoading).toBe(true);
    vi.mocked(api.fetchClusterRunsRequest).mockRejectedValueOnce(vendorError);
    await store.dispatch(loadClusterRuns({}));
    expect(store.getState().keywordResearch.clusters.runsError).not.toBe('');
  });
});

describe('loadClusterRun', () => {
  it('stores the run detail (reload survival path)', async () => {
    const run = clusterRun('b'.repeat(64), true);
    vi.mocked(api.fetchClusterRunRequest).mockResolvedValueOnce(run);
    const store = makeStore();
    await store.dispatch(loadClusterRun({ runId: run.runId }));
    expect(store.getState().keywordResearch.clusters.run).toEqual(run);
  });

  it('pending + 404 rejections', async () => {
    const store = makeStore();
    vi.mocked(api.fetchClusterRunRequest).mockReturnValueOnce(new Promise(() => {}));
    void store.dispatch(loadClusterRun({ runId: 'a'.repeat(64) }));
    expect(store.getState().keywordResearch.clusters.detailLoading).toBe(true);
    vi.mocked(api.fetchClusterRunRequest).mockRejectedValueOnce(
      new ApiError('nf', 404, { error: { message: 'That clustering run was not found.' } }),
    );
    await store.dispatch(loadClusterRun({ runId: 'a'.repeat(64) }));
    expect(store.getState().keywordResearch.clusters.detailError).toContain('not found');
    expect(store.getState().keywordResearch.clusters.detailLoading).toBe(false);
  });
});

describe('decideCluster', () => {
  const args = {
    runId: 'a'.repeat(64),
    clusterId: 'c'.repeat(32),
    kind: 'accepted' as const,
    siteId: 'f'.repeat(24),
    idempotencyKey: 'ik-1',
  };
  const key = decisionKey(args.runId, args.clusterId);

  it('stores the terminal decision on success', async () => {
    vi.mocked(api.postClusterDecisionRequest).mockResolvedValueOnce(decision);
    const store = makeStore();
    const dispatched = store.dispatch(decideCluster(args));
    expect(
      store.getState().keywordResearch.clusters.decisions[key]?.pending,
    ).toBe(true);
    await dispatched;
    const slot = store.getState().keywordResearch.clusters.decisions[key];
    expect(slot?.pending).toBe(false);
    expect(slot?.result).toEqual(decision);
    expect(slot?.conflict).toBe(false);
  });

  it('a 409 sets the conflict flag and keeps the error message', async () => {
    vi.mocked(api.postClusterDecisionRequest).mockRejectedValueOnce(conflictError);
    const store = makeStore();
    await store.dispatch(decideCluster(args));
    const slot = store.getState().keywordResearch.clusters.decisions[key];
    expect(slot?.conflict).toBe(true);
    expect(slot?.error).toContain('different decision');
  });

  it('a non-409 failure records the error without the conflict flag', async () => {
    vi.mocked(api.postClusterDecisionRequest).mockRejectedValueOnce(
      new ApiError('bad', 400, { error: { message: 'Choose the site.' } }),
    );
    const store = makeStore();
    await store.dispatch(decideCluster(args));
    const slot = store.getState().keywordResearch.clusters.decisions[key];
    expect(slot?.conflict).toBe(false);
    expect(slot?.error).toBe('Choose the site.');
  });

  it('a new attempt after a conflict resets the conflict flag (pending)', async () => {
    vi.mocked(api.postClusterDecisionRequest).mockRejectedValueOnce(conflictError);
    const store = makeStore();
    await store.dispatch(decideCluster(args));
    vi.mocked(api.postClusterDecisionRequest).mockReturnValueOnce(new Promise(() => {}));
    void store.dispatch(decideCluster(args));
    const slot = store.getState().keywordResearch.clusters.decisions[key];
    expect(slot?.pending).toBe(true);
    expect(slot?.conflict).toBe(false);
  });
});

describe('rejected actions without a payload (defensive reducer fallbacks)', () => {
  // A thunk that dies before rejectWithValue (e.g. an aborted dispatch)
  // produces a rejected action with NO payload — every error slot must fall
  // back to its empty value instead of crashing.
  const bare = new Error('network down');

  it('fetchKeywordPreview empties the preview error', () => {
    const next = keywordResearchReducer(
      initialState,
      fetchKeywordPreview.rejected(bare, 'r', { operation: 'gap' } as never),
    );
    expect(next.preview.error).toBe('');
  });

  it('runGap empties error', () => {
    const next = keywordResearchReducer(
      initialState,
      runGap.rejected(bare, 'r', {} as never),
    );
    expect(next.gap.error).toBe('');
  });

  it('runOverview empties error', () => {
    const next = keywordResearchReducer(
      initialState,
      runOverview.rejected(bare, 'r', {} as never),
    );
    expect(next.overview.error).toBe('');
  });

  it('runTrends empties error', () => {
    const next = keywordResearchReducer(
      initialState,
      runTrends.rejected(bare, 'r', {} as never),
    );
    expect(next.trends.error).toBe('');
  });

  it('runClusters empties runError', () => {
    const next = keywordResearchReducer(
      initialState,
      runClusters.rejected(bare, 'r', {} as never),
    );
    expect(next.clusters.runError).toBe('');
  });

  it('loadClusterRuns empties runsError', () => {
    const next = keywordResearchReducer(
      initialState,
      loadClusterRuns.rejected(bare, 'r', {} as never),
    );
    expect(next.clusters.runsError).toBe('');
    expect(next.clusters.runsLoaded).toBe(true);
  });

  it('loadClusterRun empties detailError', () => {
    const next = keywordResearchReducer(
      initialState,
      loadClusterRun.rejected(bare, 'r', { runId: 'a'.repeat(64) } as never),
    );
    expect(next.clusters.detailError).toBe('');
  });

  it('decideCluster without a payload leaves the decisions map untouched', () => {
    const next = keywordResearchReducer(
      initialState,
      decideCluster.rejected(bare, 'r', {
        runId: 'a'.repeat(64),
        clusterId: 'c'.repeat(32),
        kind: 'accepted',
        siteId: 's',
        idempotencyKey: 'k',
      } as never),
    );
    expect(next.clusters.decisions).toEqual({});
  });

  it('decideCluster rejected with a payload seeds a fresh decision slot', () => {
    // No pending action first — the reducer must build the slot from the
    // EMPTY_DECISION template instead of an existing row.
    const runId = 'a'.repeat(64);
    const clusterId = 'c'.repeat(32);
    const next = keywordResearchReducer(
      initialState,
      decideCluster.rejected(
        bare,
        'r',
        { runId, clusterId, kind: 'accepted', siteId: 's', idempotencyKey: 'k' } as never,
        { error: 'boom', status: 500, runId, clusterId },
      ),
    );
    const slot = next.clusters.decisions[decisionKey(runId, clusterId)];
    expect(slot).toEqual({
      pending: false,
      result: null,
      error: 'boom',
      conflict: false,
    });
  });
});
