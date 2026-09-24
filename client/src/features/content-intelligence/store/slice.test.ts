import { describe, expect, it } from 'vitest';
import {
  clearFormDraft,
  clearInventorySubmitError,
  clearSubmitError,
  contentIntelligenceReducer,
  initialState,
  resetContentIntelligence,
  setActiveAnalysisId,
  updateFormDraft,
  upsertAnalysis,
  type ContentIntelligenceState,
} from './slice';
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
import type { ContentAnalysis, InventoryRun, InventoryRunDetail } from '../types';

function makeRun(overrides: Partial<InventoryRun> = {}): InventoryRun {
  return {
    runId: 'r1',
    siteId: 's1',
    origin: 'https://example.com',
    locale: 'en',
    status: 'queued',
    input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    progress: {
      pagesRequested: 20,
      pagesProcessed: 0,
      pagesFailed: 0,
      blocksReserved: 5,
      blocksRefunded: 0,
    },
    warnings: [],
    error: null,
    thresholdsVersion: '2026-07-20.1',
    findings: null,
    reservation: {
      key: 'k',
      reservedUnits: 5,
      refundedUnits: 0,
      refundedAt: null,
      refundReason: null,
    },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: '2026-07-20T00:00:00Z',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<InventoryRunDetail> = {}): InventoryRunDetail {
  return { ...makeRun(), pages: [], ...overrides };
}

function makeAnalysis(overrides: Partial<ContentAnalysis> = {}): ContentAnalysis {
  return {
    analysisId: 'a1',
    siteId: 's1',
    ownedUrl: 'https://example.com/a',
    keyword: 'foo',
    locale: 'en',
    status: 'queued',
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
    ...overrides,
  };
}

describe('contentIntelligenceReducer', () => {
  it('returns initial state', () => {
    const s = contentIntelligenceReducer(undefined, { type: '@@INIT' });
    expect(s).toEqual(initialState);
  });

  it('resetContentIntelligence returns initial state', () => {
    const s: ContentIntelligenceState = {
      ...initialState,
      siteId: 's',
      submitting: true,
    };
    expect(contentIntelligenceReducer(s, resetContentIntelligence())).toEqual(
      initialState,
    );
  });

  it('setActiveAnalysisId updates active id', () => {
    const s = contentIntelligenceReducer(initialState, setActiveAnalysisId('x'));
    expect(s.activeAnalysisId).toBe('x');
  });

  it('updateFormDraft merges the patch', () => {
    const s = contentIntelligenceReducer(
      initialState,
      updateFormDraft({ ownedUrl: 'https://x/', keyword: 'k' }),
    );
    expect(s.formDraft.ownedUrl).toBe('https://x/');
    expect(s.formDraft.keyword).toBe('k');
  });

  it('clearFormDraft preserves locale', () => {
    const dirty: ContentIntelligenceState = {
      ...initialState,
      formDraft: { ownedUrl: 'x', keyword: 'y', locale: 'de', consent: true },
      submitError: 'bad',
    };
    const s = contentIntelligenceReducer(dirty, clearFormDraft());
    expect(s.formDraft).toEqual({
      ownedUrl: '',
      keyword: '',
      locale: 'de',
      consent: false,
    });
    expect(s.submitError).toBe('');
  });

  it('clearSubmitError resets error flags', () => {
    const dirty: ContentIntelligenceState = {
      ...initialState,
      submitError: 'e',
    };
    const s = contentIntelligenceReducer(dirty, clearSubmitError());
    expect(s.submitError).toBe('');
  });

  it('upsertAnalysis inserts new and updates existing', () => {
    const first = contentIntelligenceReducer(
      initialState,
      upsertAnalysis(makeAnalysis()),
    );
    expect(first.analyses).toHaveLength(1);
    const updated = contentIntelligenceReducer(
      first,
      upsertAnalysis(makeAnalysis({ status: 'completed' })),
    );
    expect(updated.analyses[0]!.status).toBe('completed');
  });

  it('loadAnalyses.pending rekeys on site change', () => {
    const prior: ContentIntelligenceState = {
      ...initialState,
      siteId: 'old',
      analyses: [makeAnalysis()],
    };
    const action = {
      type: loadAnalyses.pending.type,
      meta: { requestId: 'r', arg: { siteId: 'new' } },
    };
    const s = contentIntelligenceReducer(prior, action);
    expect(s.siteId).toBe('new');
    expect(s.analyses).toEqual([]);
    expect(s.listLoading).toBe(true);

    const sameSite = contentIntelligenceReducer(s, {
      type: loadAnalyses.pending.type,
      meta: { requestId: 'r2', arg: { siteId: 'new' } },
    });
    expect(sameSite.siteId).toBe('new');
  });

  it('loadAnalyses.fulfilled ignores stale site', () => {
    const s: ContentIntelligenceState = { ...initialState, siteId: 'active' };
    const action = {
      type: loadAnalyses.fulfilled.type,
      meta: { requestId: 'r', arg: { siteId: 'stale' } },
      payload: {
        page: { items: [makeAnalysis()], nextCursor: null },
        append: false,
        siteId: 'stale',
      },
    };
    const next = contentIntelligenceReducer(s, action);
    expect(next.analyses).toEqual([]);
  });

  it('loadAnalyses.fulfilled append merges without duplicates', () => {
    const initial = contentIntelligenceReducer(
      { ...initialState, siteId: 's', analyses: [makeAnalysis({ analysisId: 'a1' })] },
      {
        type: loadAnalyses.fulfilled.type,
        meta: { requestId: 'r', arg: { siteId: 's', append: true } },
        payload: {
          page: {
            items: [makeAnalysis({ analysisId: 'a1' }), makeAnalysis({ analysisId: 'a2' })],
            nextCursor: 'c',
          },
          append: true,
          siteId: 's',
        },
      },
    );
    expect(initial.analyses.map((a) => a.analysisId)).toEqual(['a1', 'a2']);
    expect(initial.nextCursor).toBe('c');

    const replaced = contentIntelligenceReducer(initial, {
      type: loadAnalyses.fulfilled.type,
      meta: { requestId: 'r2', arg: { siteId: 's' } },
      payload: {
        page: { items: [makeAnalysis({ analysisId: 'replacement' })], nextCursor: null },
        append: false,
        siteId: 's',
      },
    });
    expect(replaced.analyses.map((item) => item.analysisId)).toEqual(['replacement']);
  });

  it('loadAnalyses.rejected records error unless aborted', () => {
    const rejected = contentIntelligenceReducer(initialState, {
      type: loadAnalyses.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 's' }, aborted: false },
      payload: { error: 'boom' },
    });
    expect(rejected.listError).toBe('boom');
    const aborted = contentIntelligenceReducer(initialState, {
      type: loadAnalyses.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 's' }, aborted: true },
      payload: { error: 'x' },
    });
    expect(aborted.listError).toBe('');
  });

  it('loadAnalysis.pending/fulfilled/rejected flow', () => {
    let s = contentIntelligenceReducer(initialState, {
      type: loadAnalysis.pending.type,
      meta: { requestId: 'r', arg: { siteId: 's1', analysisId: 'x' } },
    });
    expect(s.detailLoading['x']).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: loadAnalysis.fulfilled.type,
      meta: { requestId: 'r', arg: { siteId: 's1', analysisId: 'x' } },
      payload: makeAnalysis({ analysisId: 'x' }),
    });
    expect(s.detail['x']?.analysisId).toBe('x');
    s = contentIntelligenceReducer(s, {
      type: loadAnalysis.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 's1', analysisId: 'x' }, aborted: false },
      payload: { error: 'nope' },
    });
    expect(s.detailError['x']).toBe('nope');

    const aborted = contentIntelligenceReducer(s, {
      type: loadAnalysis.rejected.type,
      meta: { requestId: 'r2', arg: { siteId: 's1', analysisId: 'x' }, aborted: true },
      payload: { error: 'ignored' },
    });
    expect(aborted.detailError['x']).toBe('nope');
  });

  it('ignores stale detail fulfillments and rejections after a site switch', () => {
    const active: ContentIntelligenceState = { ...initialState, siteId: 'active' };
    const staleRequest = {
      requestId: 'stale',
      arg: { siteId: 'other', analysisId: 'x' },
    };
    const staleByRequest = contentIntelligenceReducer(active, {
      type: loadAnalysis.fulfilled.type,
      meta: staleRequest,
      payload: makeAnalysis({ analysisId: 'x', siteId: 'other' }),
    });
    expect(staleByRequest.detail).toEqual({});

    const staleByPayload = contentIntelligenceReducer(active, {
      type: loadAnalysis.fulfilled.type,
      meta: { requestId: 'payload', arg: { siteId: 'active', analysisId: 'x' } },
      payload: makeAnalysis({ analysisId: 'x', siteId: 'other' }),
    });
    expect(staleByPayload.detail).toEqual({});

    const staleRejection = contentIntelligenceReducer(active, {
      type: loadAnalysis.rejected.type,
      meta: { ...staleRequest, aborted: false },
      payload: { error: 'must stay hidden' },
    });
    expect(staleRejection.detailError).toEqual({});
  });

  it('submitAnalysis + preflight lifecycle', () => {
    let s = contentIntelligenceReducer(initialState, {
      type: runPreflight.pending.type,
      meta: { requestId: 'pending', arg: {} },
    });
    expect(s.preflightLoading).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: runPreflight.fulfilled.type,
      meta: { requestId: 'r', arg: {} },
      payload: { ok: true, reason: null },
    });
    expect(s.preflight?.ok).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: submitAnalysis.pending.type,
      meta: { requestId: 'r', arg: {} },
    });
    expect(s.submitting).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: submitAnalysis.fulfilled.type,
      meta: { requestId: 'r', arg: {} },
      payload: { analysisId: 'a1', status: 'queued', duplicate: false, message: 'ok' },
    });
    expect(s.lastStartedId).toBe('a1');
    expect(s.submitting).toBe(false);
    s = contentIntelligenceReducer(s, {
      type: submitAnalysis.rejected.type,
      meta: { requestId: 'r', arg: {}, aborted: false },
      payload: { error: 'x' },
    });
    expect(s.submitError).toBe('x');

    const preflightAborted = contentIntelligenceReducer(s, {
      type: runPreflight.rejected.type,
      meta: { requestId: 'r2', arg: {}, aborted: true },
    });
    expect(preflightAborted.preflight).toEqual(s.preflight);
    const preflightRejected = contentIntelligenceReducer(s, {
      type: runPreflight.rejected.type,
      meta: { requestId: 'r3', arg: {}, aborted: false },
    });
    expect(preflightRejected.preflight).toBeNull();
    const submitAborted = contentIntelligenceReducer(s, {
      type: submitAnalysis.rejected.type,
      meta: { requestId: 'r4', arg: {}, aborted: true },
      payload: { error: 'ignored' },
    });
    expect(submitAborted.submitError).toBe('x');
  });

  it('clearInventorySubmitError resets inventory submit flags', () => {
    const dirty: ContentIntelligenceState = {
      ...initialState,
      inventory: {
        ...initialState.inventory,
        submitError: 'e',
      },
    };
    const s = contentIntelligenceReducer(dirty, clearInventorySubmitError());
    expect(s.inventory.submitError).toBe('');
  });

  it('loadInventoryRuns pending rekeys, fulfilled appends/replaces, rejected records error', () => {
    const prior: ContentIntelligenceState = {
      ...initialState,
      siteId: 'old',
      inventory: { ...initialState.inventory, runs: [makeRun()] },
    };
    const pending = contentIntelligenceReducer(prior, {
      type: loadInventoryRuns.pending.type,
      meta: { requestId: 'r', arg: { siteId: 'new' } },
    });
    expect(pending.siteId).toBe('new');
    expect(pending.inventory.runs).toEqual([]);
    expect(pending.inventory.listLoading).toBe(true);

    const stale = contentIntelligenceReducer(pending, {
      type: loadInventoryRuns.fulfilled.type,
      meta: { requestId: 'r', arg: { siteId: 'other' } },
      payload: { page: { items: [makeRun()], nextCursor: null }, append: false, siteId: 'other' },
    });
    expect(stale.inventory.runs).toEqual([]);

    const first = contentIntelligenceReducer(pending, {
      type: loadInventoryRuns.fulfilled.type,
      meta: { requestId: 'r', arg: { siteId: 'new' } },
      payload: {
        page: { items: [makeRun({ runId: 'r1' })], nextCursor: 'c' },
        append: false,
        siteId: 'new',
      },
    });
    expect(first.inventory.runs.map((r) => r.runId)).toEqual(['r1']);
    expect(first.inventory.nextCursor).toBe('c');

    const appended = contentIntelligenceReducer(first, {
      type: loadInventoryRuns.fulfilled.type,
      meta: { requestId: 'r2', arg: { siteId: 'new', append: true } },
      payload: {
        page: { items: [makeRun({ runId: 'r1' }), makeRun({ runId: 'r2' })], nextCursor: null },
        append: true,
        siteId: 'new',
      },
    });
    expect(appended.inventory.runs.map((r) => r.runId)).toEqual(['r1', 'r2']);

    const rejected = contentIntelligenceReducer(pending, {
      type: loadInventoryRuns.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 'new' }, aborted: false },
      payload: { error: 'boom' },
    });
    expect(rejected.inventory.listError).toBe('boom');

    const aborted = contentIntelligenceReducer(pending, {
      type: loadInventoryRuns.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 'new' }, aborted: true },
      payload: { error: 'ignored' },
    });
    expect(aborted.inventory.listError).toBe('');
  });

  it('loadInventoryRun pending/fulfilled/rejected flow', () => {
    const base: ContentIntelligenceState = {
      ...initialState,
      inventory: { ...initialState.inventory, runs: [makeRun({ runId: 'x' })] },
    };
    let s = contentIntelligenceReducer(base, {
      type: loadInventoryRun.pending.type,
      meta: { requestId: 'r', arg: { siteId: 's1', runId: 'x' } },
    });
    expect(s.inventory.detailLoading['x']).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: loadInventoryRun.fulfilled.type,
      meta: { requestId: 'r', arg: { siteId: 's1', runId: 'x' } },
      payload: makeDetail({ runId: 'x', status: 'completed' }),
    });
    expect(s.inventory.detail['x']?.status).toBe('completed');
    expect(s.inventory.runs[0]?.status).toBe('completed');
    s = contentIntelligenceReducer(s, {
      type: loadInventoryRun.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 's1', runId: 'x' }, aborted: false },
      payload: { error: 'nope' },
    });
    expect(s.inventory.detailError['x']).toBe('nope');
    const aborted = contentIntelligenceReducer(s, {
      type: loadInventoryRun.rejected.type,
      meta: { requestId: 'r2', arg: { siteId: 's1', runId: 'x' }, aborted: true },
      payload: { error: 'ignored' },
    });
    expect(aborted.inventory.detailError['x']).toBe('nope');
  });

  it('startInventory + cancelInventory lifecycle', () => {
    let s = contentIntelligenceReducer(initialState, {
      type: startInventoryThunk.pending.type,
      meta: { requestId: 'r', arg: {} },
    });
    expect(s.inventory.submitting).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: startInventoryThunk.fulfilled.type,
      meta: { requestId: 'r', arg: {} },
      payload: { runId: 'r9', status: 'queued', reservedBlocks: 5, duplicate: false, message: 'ok' },
    });
    expect(s.inventory.lastStartedRunId).toBe('r9');
    expect(s.inventory.submitting).toBe(false);
    s = contentIntelligenceReducer(s, {
      type: startInventoryThunk.rejected.type,
      meta: { requestId: 'r', arg: {}, aborted: false },
      payload: { error: 'x' },
    });
    expect(s.inventory.submitError).toBe('x');
    const submitAborted = contentIntelligenceReducer(s, {
      type: startInventoryThunk.rejected.type,
      meta: { requestId: 'r2', arg: {}, aborted: true },
      payload: { error: 'ignored' },
    });
    expect(submitAborted.inventory.submitError).toBe('x');

    s = contentIntelligenceReducer(s, {
      type: cancelInventoryThunk.pending.type,
      meta: { requestId: 'r', arg: { siteId: 's1', runId: 'r9' } },
    });
    expect(s.inventory.cancelling['r9']).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: cancelInventoryThunk.fulfilled.type,
      meta: { requestId: 'r', arg: { siteId: 's1', runId: 'r9' } },
      payload: { ok: true },
    });
    expect(s.inventory.cancelling['r9']).toBe(false);
    s = contentIntelligenceReducer(s, {
      type: cancelInventoryThunk.rejected.type,
      meta: { requestId: 'r', arg: { siteId: 's1', runId: 'r9' } },
    });
    expect(s.inventory.cancelling['r9']).toBe(false);
  });

  it('cancel + regenerate track per-id flags', () => {
    let s = contentIntelligenceReducer(initialState, {
      type: cancelAnalysisThunk.pending.type,
      meta: { requestId: 'r', arg: { analysisId: 'a1' } },
    });
    expect(s.cancelling['a1']).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: cancelAnalysisThunk.fulfilled.type,
      meta: { requestId: 'r', arg: { analysisId: 'a1' } },
      payload: { ok: true },
    });
    expect(s.cancelling['a1']).toBe(false);
    s = contentIntelligenceReducer(s, {
      type: regenerateAnalysisThunk.pending.type,
      meta: { requestId: 'r', arg: { analysisId: 'a1' } },
    });
    expect(s.regenerating['a1']).toBe(true);
    s = contentIntelligenceReducer(s, {
      type: regenerateAnalysisThunk.fulfilled.type,
      meta: { requestId: 'r', arg: { analysisId: 'a1' } },
      payload: { analysisId: 'a2', status: 'queued', duplicate: false, message: 'ok' },
    });
    expect(s.lastStartedId).toBe('a2');
    expect(s.regenerating['a1']).toBe(false);
    s = contentIntelligenceReducer(s, {
      type: cancelAnalysisThunk.rejected.type,
      meta: { requestId: 'r2', arg: { analysisId: 'a1' } },
    });
    expect(s.cancelling['a1']).toBe(false);
    s = contentIntelligenceReducer(s, {
      type: regenerateAnalysisThunk.rejected.type,
      meta: { requestId: 'r3', arg: { analysisId: 'a1' } },
    });
    expect(s.regenerating['a1']).toBe(false);
  });
});
