import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import type { ContentAnalysis } from '../types';
import { contentIntelligenceReducer, initialState } from './slice';
import {
  cancelAnalysisThunk,
  cancelInventoryThunk,
  loadAnalyses,
  loadAnalysis,
  loadInventoryRun,
  loadInventoryRuns,
  regenerateAnalysisThunk,
  runPreflight,
  startInventoryThunk,
  submitAnalysis,
} from './thunks';
import {
  selectAnalyses,
  selectAnalysesNextCursor,
  selectAnalysisById,
  selectAnalysisSiteId,
  selectCancelling,
  selectDetailError,
  selectDetailLoading,
  selectFormDraft,
  selectLastStartedId,
  selectListError,
  selectListLoaded,
  selectListLoading,
  selectRegenerating,
  selectSubmitError,
  selectSubmitting,
  selectInventoryCancelling,
  selectInventoryDetailError,
  selectInventoryDetailLoading,
  selectInventoryLastStartedRunId,
  selectInventoryListError,
  selectInventoryListLoaded,
  selectInventoryListLoading,
  selectInventoryNextCursor,
  selectInventoryRunById,
  selectInventoryRuns,
  selectInventorySubmitError,
  selectInventorySubmitting,
} from './selectors';

const api = vi.hoisted(() => ({
  listAnalyses: vi.fn(),
  getAnalysis: vi.fn(),
  preflightAnalysis: vi.fn(),
  startAnalysis: vi.fn(),
  cancelAnalysis: vi.fn(),
  regenerateAnalysis: vi.fn(),
  listInventoryRuns: vi.fn(),
  getInventoryRun: vi.fn(),
  startInventory: vi.fn(),
  cancelInventory: vi.fn(),
}));

vi.mock('../api', () => api);

function analysis(id = 'a1'): ContentAnalysis {
  return {
    analysisId: id,
    siteId: 's1',
    ownedUrl: 'https://example.com/a',
    keyword: 'query',
    locale: 'en',
    status: 'completed',
    stages: [],
    warnings: [],
    scorecard: null,
    schemaVersion: '2026-07-15.1',
    scorecardV2: null,
    owned: null,
    recommendations: [],
    recommendationStates: [],
    brief: null,
    draft: null,
    citations: [],
    error: null,
    reservation: { key: 'k', reservedUnits: 1, refundedAt: null, refundReason: null },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  };
}

function store() {
  return configureStore({ reducer: { contentIntelligence: contentIntelligenceReducer } });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.listAnalyses.mockResolvedValue({ items: [analysis()], nextCursor: null });
  api.getAnalysis.mockResolvedValue(analysis());
  api.preflightAnalysis.mockResolvedValue({ ok: true, reason: null });
  api.startAnalysis.mockResolvedValue({ analysisId: 'a2', status: 'queued', duplicate: false, message: 'ok' });
  api.cancelAnalysis.mockResolvedValue({ ok: true });
  api.regenerateAnalysis.mockResolvedValue({ analysisId: 'a3', status: 'queued', duplicate: false, message: 'ok' });
  api.listInventoryRuns.mockResolvedValue({ items: [], nextCursor: null });
  api.getInventoryRun.mockResolvedValue({ runId: 'r1', pages: [] });
  api.startInventory.mockResolvedValue({ runId: 'r9', status: 'queued', reservedBlocks: 5, duplicate: false, message: 'ok' });
  api.cancelInventory.mockResolvedValue({ ok: true });
});

describe('content intelligence thunks', () => {
  it('forwards every success path and append metadata', async () => {
    const s = store();
    const signal = expect.any(AbortSignal);
    await s.dispatch(loadAnalyses({ siteId: 's1', cursor: 'cursor', limit: 5, append: true }));
    expect(api.listAnalyses).toHaveBeenCalledWith(
      { siteId: 's1', cursor: 'cursor', limit: 5 },
      { signal },
    );
    expect(s.getState().contentIntelligence.analyses).toHaveLength(1);
    await s.dispatch(loadAnalysis({ siteId: 's1', analysisId: 'a1' }));
    await s.dispatch(runPreflight({ siteId: 's1', ownedUrl: 'https://example.com', keyword: 'q', locale: 'en' }));
    await s.dispatch(submitAnalysis({ siteId: 's1', ownedUrl: 'https://example.com', keyword: 'q', locale: 'en' }));
    await s.dispatch(cancelAnalysisThunk({ analysisId: 'a1' }));
    await s.dispatch(regenerateAnalysisThunk({ analysisId: 'a1' }));
    expect(api.getAnalysis).toHaveBeenCalledWith('a1', 's1', { signal });
    expect(api.preflightAnalysis).toHaveBeenCalled();
    expect(api.startAnalysis).toHaveBeenCalled();
    expect(api.cancelAnalysis).toHaveBeenCalledWith('a1', { signal });
    expect(api.regenerateAnalysis).toHaveBeenCalledWith('a1', { signal });
  });

  it('normalizes API and ordinary errors for every rejection path', async () => {
    const s = store();
    api.listAnalyses.mockRejectedValueOnce(new ApiError('forbidden', 403, null));
    api.getAnalysis.mockRejectedValueOnce(new ApiError('missing', 404, null));
    api.preflightAnalysis.mockRejectedValueOnce(new Error('offline'));
    api.startAnalysis.mockRejectedValueOnce(new Error('offline'));
    api.cancelAnalysis.mockRejectedValueOnce(new Error('offline'));
    api.regenerateAnalysis.mockRejectedValueOnce(new Error('offline'));
    const list = await s.dispatch(loadAnalyses({ siteId: 's1' }));
    const detail = await s.dispatch(loadAnalysis({ siteId: 's1', analysisId: 'a1' }));
    const preflight = await s.dispatch(runPreflight({ siteId: 's1', ownedUrl: 'https://example.com', keyword: 'q', locale: 'en' }));
    const submit = await s.dispatch(submitAnalysis({ siteId: 's1', ownedUrl: 'https://example.com', keyword: 'q', locale: 'en' }));
    const cancel = await s.dispatch(cancelAnalysisThunk({ analysisId: 'a1' }));
    const regenerate = await s.dispatch(regenerateAnalysisThunk({ analysisId: 'a1' }));
    expect(list.payload).toMatchObject({ status: 403 });
    expect(detail.payload).toMatchObject({ status: 404 });
    for (const result of [preflight, submit, cancel, regenerate]) {
      expect(result.meta.requestStatus).toBe('rejected');
      expect(result.payload).toHaveProperty('error');
    }
  });
});

describe('content inventory thunks', () => {
  it('forwards inventory success paths', async () => {
    const s = store();
    const signal = expect.any(AbortSignal);
    await s.dispatch(loadInventoryRuns({ siteId: 's1', cursor: 'c', limit: 5, append: true }));
    expect(api.listInventoryRuns).toHaveBeenCalledWith({ siteId: 's1', cursor: 'c', limit: 5 }, { signal });
    await s.dispatch(loadInventoryRun({ siteId: 's1', runId: 'r1' }));
    expect(api.getInventoryRun).toHaveBeenCalledWith('s1', 'r1', { signal });
    await s.dispatch(
      startInventoryThunk({
        siteId: 's1',
        pageLimit: 20,
        allowedPaths: [],
        excludedPaths: [],
        sitemapSeeds: [],
        locale: 'en',
      }),
    );
    expect(api.startInventory).toHaveBeenCalled();
    await s.dispatch(cancelInventoryThunk({ siteId: 's1', runId: 'r1' }));
    expect(api.cancelInventory).toHaveBeenCalledWith('s1', 'r1', { signal });
  });

  it('normalizes inventory rejections', async () => {
    const s = store();
    api.listInventoryRuns.mockRejectedValueOnce(new ApiError('conflict', 409, null));
    api.getInventoryRun.mockRejectedValueOnce(new Error('offline'));
    api.startInventory.mockRejectedValueOnce(new Error('offline'));
    api.cancelInventory.mockRejectedValueOnce(new Error('offline'));
    const list = await s.dispatch(loadInventoryRuns({ siteId: 's1' }));
    const detail = await s.dispatch(loadInventoryRun({ siteId: 's1', runId: 'r1' }));
    const start = await s.dispatch(
      startInventoryThunk({
        siteId: 's1',
        pageLimit: 20,
        allowedPaths: [],
        excludedPaths: [],
        sitemapSeeds: [],
        locale: 'en',
      }),
    );
    const cancel = await s.dispatch(cancelInventoryThunk({ siteId: 's1', runId: 'r1' }));
    expect(list.payload).toMatchObject({ status: 409 });
    for (const result of [detail, start, cancel]) {
      expect(result.meta.requestStatus).toBe('rejected');
      expect(result.payload).toHaveProperty('error');
    }
  });
});

describe('content inventory selectors', () => {
  it('reads populated + closure inventory selectors', () => {
    const run = {
      runId: 'r1',
      siteId: 's1',
      origin: 'https://x',
      locale: 'en',
      status: 'completed' as const,
      input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
      progress: { pagesRequested: 20, pagesProcessed: 4, pagesFailed: 0, blocksReserved: 5, blocksRefunded: 4 },
      warnings: [],
      error: null,
      thresholdsVersion: 'v',
      findings: null,
      reservation: { key: 'k', reservedUnits: 5, refundedUnits: 4, refundedAt: null, refundReason: null },
      costMicros: 0,
      aiCostMicros: 0,
      requestedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    };
    const state = {
      contentIntelligence: {
        ...initialState,
        inventory: {
          ...initialState.inventory,
          runs: [run],
          nextCursor: 'next',
          listLoading: true,
          listLoaded: true,
          listError: 'list',
          detail: { r1: { ...run, pages: [] } },
          detailLoading: { r1: true },
          detailError: { r1: 'detail' },
          submitting: true,
          submitError: 'submit',
          lastStartedRunId: 'r1',
          cancelling: { r1: true },
        },
      },
    };
    expect(selectInventoryRuns(state)).toHaveLength(1);
    expect(selectInventoryNextCursor(state)).toBe('next');
    expect(selectInventoryListLoading(state)).toBe(true);
    expect(selectInventoryListLoaded(state)).toBe(true);
    expect(selectInventoryListError(state)).toBe('list');
    expect(selectInventoryRunById('r1')(state)?.runId).toBe('r1');
    expect(selectInventoryDetailLoading('r1')(state)).toBe(true);
    expect(selectInventoryDetailError('r1')(state)).toBe('detail');
    expect(selectInventorySubmitting(state)).toBe(true);
    expect(selectInventorySubmitError(state)).toBe('submit');
    expect(selectInventoryLastStartedRunId(state)).toBe('r1');
    expect(selectInventoryCancelling('r1')(state)).toBe(true);
  });

  it('returns inventory safe defaults for missing ids', () => {
    const state = { contentIntelligence: initialState };
    expect(selectInventoryRunById(null)(state)).toBeUndefined();
    expect(selectInventoryRunById('missing')(state)).toBeUndefined();
    expect(selectInventoryDetailLoading(null)(state)).toBe(false);
    expect(selectInventoryDetailLoading('missing')(state)).toBe(false);
    expect(selectInventoryDetailError(null)(state)).toBe('');
    expect(selectInventoryDetailError('missing')(state)).toBe('');
    expect(selectInventoryCancelling('missing')(state)).toBe(false);
    expect(selectInventoryRuns({})).toEqual([]);
  });
});

describe('content intelligence selectors', () => {
  it('reads every populated value and closure selector', () => {
    const populated = {
      ...initialState,
      siteId: 's1',
      analyses: [analysis()],
      nextCursor: 'next',
      listLoading: true,
      listLoaded: true,
      listError: 'list',
      detail: { a1: analysis() },
      detailLoading: { a1: true },
      detailError: { a1: 'detail' },
      submitting: true,
      submitError: 'submit',
      lastStartedId: 'a2',
      cancelling: { a1: true },
      regenerating: { a1: true },
    };
    const state = { contentIntelligence: populated };
    expect(selectAnalyses(state)).toHaveLength(1);
    expect(selectAnalysesNextCursor(state)).toBe('next');
    expect(selectListLoading(state)).toBe(true);
    expect(selectListLoaded(state)).toBe(true);
    expect(selectListError(state)).toBe('list');
    expect(selectAnalysisSiteId(state)).toBe('s1');
    expect(selectAnalysisById('s1', 'a1')(state)?.analysisId).toBe('a1');
    expect(selectDetailLoading('s1', 'a1')(state)).toBe(true);
    expect(selectDetailError('s1', 'a1')(state)).toBe('detail');
    expect(selectSubmitting(state)).toBe(true);
    expect(selectSubmitError(state)).toBe('submit');
    expect(selectLastStartedId(state)).toBe('a2');
    expect(selectFormDraft(state)).toEqual(populated.formDraft);
    expect(selectCancelling('a1')(state)).toBe(true);
    expect(selectRegenerating('a1')(state)).toBe(true);
  });

  it('returns safe defaults for missing ids and sparse maps', () => {
    const state = { contentIntelligence: initialState };
    expect(selectAnalysisById('s1', null)(state)).toBeUndefined();
    expect(selectAnalysisById('s1', undefined)(state)).toBeUndefined();
    expect(selectAnalysisById('s1', 'missing')(state)).toBeUndefined();
    expect(selectDetailLoading('s1', null)(state)).toBe(false);
    expect(selectDetailLoading('s1', undefined)(state)).toBe(false);
    expect(selectDetailLoading('s1', 'missing')(state)).toBe(false);
    expect(selectDetailError('s1', null)(state)).toBe('');
    expect(selectDetailError('s1', undefined)(state)).toBe('');
    expect(selectDetailError('s1', 'missing')(state)).toBe('');
    expect(selectCancelling('missing')(state)).toBe(false);
    expect(selectRegenerating('missing')(state)).toBe(false);
    expect(selectAnalyses({})).toEqual([]);
  });
});
