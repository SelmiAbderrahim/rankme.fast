import { configureStore } from '@reduxjs/toolkit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import type { RunResultView, RunStatusView } from '../types';
import {
  audienceResearchReducer,
  clearSignalDecisionError,
  clearStartStatus,
  DEFAULT_FORM_MARKET,
  ensureSignalIdempotencyKey,
  initialState,
  resetAudienceResearch,
  resetForm,
  setFormCompetitors,
  setFormTopics,
  setSelectedRunId,
  updateFormMarket,
} from './slice';
import {
  decideSignal,
  fetchRun,
  fetchRunResult,
  fetchRuns,
  startRun,
} from './thunks';
import {
  selectAudienceResearchSiteId,
  selectForm,
  selectListCanGoPrev,
  selectListCursor,
  selectListError,
  selectListLoaded,
  selectListLoading,
  selectResultError,
  selectResultLoading,
  selectRunById,
  selectRunError,
  selectRunLoading,
  selectRunResultById,
  selectRuns,
  selectSelectedRunId,
  selectStartStatus,
} from './selectors';

const api = vi.hoisted(() => ({
  startAudienceResearchRun: vi.fn(),
  listAudienceResearchRuns: vi.fn(),
  getAudienceResearchRun: vi.fn(),
  getAudienceResearchRunResult: vi.fn(),
  postAudienceResearchSignalDecision: vi.fn(),
}));

vi.mock('../api', () => api);

function run(id = 'r1', overrides: Partial<RunStatusView> = {}): RunStatusView {
  return {
    runId: id,
    siteId: 's1',
    state: 'queued',
    stage: 'queued',
    counts: { candidates: 0, sources: 0, signals: 0 },
    progress: { percent: 0 },
    coverageNoteKey: null,
    costMicros: { total: 0, byStage: {} },
    terminal: { state: null, reasonCode: null, completedAt: null },
    requestedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    outputLocale: overrides.outputLocale === undefined ? 'en' : overrides.outputLocale,
  };
}

function result(id = 'r1'): RunResultView {
  return {
    ...run(id, { state: 'completed', stage: 'terminal', terminal: { state: 'completed', reasonCode: 'ok', completedAt: '2026-01-01T01:00:00.000Z' } }),
    input: {
      siteMarket: DEFAULT_FORM_MARKET,
      competitorDomains: [],
      seedTopics: [],
      queryTemplateVersion: 1,
      outputLocale: 'en',
    },
    sources: [],
    signals: [],
    ledgerSummary: { total: 0, ai: 0, byStage: {} },
  };
}

function makeStore() {
  return configureStore({ reducer: { audienceResearch: audienceResearchReducer } });
}

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audienceResearch selectors — lazy-inject fallback', () => {
  it('falls back to initialState when the slice has not been injected', () => {
    const bareState = {} as never;
    expect(selectAudienceResearchSiteId(bareState)).toBeNull();
    expect(selectRuns(bareState)).toEqual([]);
    expect(selectListLoading(bareState)).toBe(false);
    expect(selectListLoaded(bareState)).toBe(false);
    expect(selectListError(bareState)).toBe('');
    expect(selectListCursor(bareState)).toBeNull();
    expect(selectListCanGoPrev(bareState)).toBe(false);
    expect(selectSelectedRunId(bareState)).toBeNull();
    expect(selectForm(bareState)).toEqual(initialState.form);
    expect(selectStartStatus(bareState)).toEqual(initialState.startStatus);
    expect(selectRunById('missing')(bareState)).toBeUndefined();
    expect(selectRunById(null)(bareState)).toBeUndefined();
    expect(selectRunResultById('missing')(bareState)).toBeUndefined();
    expect(selectRunResultById(undefined)(bareState)).toBeUndefined();
    expect(selectRunLoading(null)(bareState)).toBe(false);
    expect(selectRunError(null)(bareState)).toBe('');
    expect(selectResultLoading(null)(bareState)).toBe(false);
    expect(selectResultError(null)(bareState)).toBe('');
  });
});

describe('audienceResearch reducers', () => {
  it('resetAudienceResearch returns initialState', () => {
    const dirty = { ...initialState, siteId: 'x' };
    expect(audienceResearchReducer(dirty, resetAudienceResearch())).toEqual(initialState);
  });

  it('setSelectedRunId sets and clears the selected run', () => {
    let state = audienceResearchReducer(undefined, setSelectedRunId('r1'));
    expect(state.selectedRunId).toBe('r1');
    state = audienceResearchReducer(state, setSelectedRunId(null));
    expect(state.selectedRunId).toBeNull();
  });

  it('updateFormMarket merges into the current market', () => {
    const state = audienceResearchReducer(undefined, updateFormMarket({ country: 'FR', language: 'fr' }));
    expect(state.form.market).toEqual({ ...DEFAULT_FORM_MARKET, country: 'FR', language: 'fr' });
  });

  it('setFormCompetitors and setFormTopics replace their arrays', () => {
    let state = audienceResearchReducer(undefined, setFormCompetitors(['a.com', 'b.com']));
    expect(state.form.competitors).toEqual(['a.com', 'b.com']);
    state = audienceResearchReducer(state, setFormTopics(['pricing', 'support']));
    expect(state.form.topics).toEqual(['pricing', 'support']);
  });

  it('resetForm resets only the form slice', () => {
    let state = audienceResearchReducer(undefined, setFormTopics(['x']));
    state = audienceResearchReducer(state, resetForm());
    expect(state.form).toEqual(initialState.form);
  });

  it('clearStartStatus resets its sub-state', () => {
    let state = audienceResearchReducer(undefined, startRun.rejected(new Error('x'), 'id', { siteId: 's', input: { siteMarket: DEFAULT_FORM_MARKET, competitorDomains: [], seedTopics: [] } }, { error: 'boom' }));
    expect(state.startStatus.error).toBe('boom');
    state = audienceResearchReducer(state, clearStartStatus());
    expect(state.startStatus).toEqual(initialState.startStatus);
  });

  it('every rejected reducer falls back to an empty string / false when rejectWithValue was never reached (no payload)', () => {
    const input = { siteMarket: DEFAULT_FORM_MARKET, competitorDomains: [], seedTopics: [] };

    let state = audienceResearchReducer(
      undefined,
      startRun.rejected(new Error('x'), 'id', { siteId: 's', input }),
    );
    expect(state.startStatus.error).toBe('');

    state = audienceResearchReducer(
      undefined,
      fetchRuns.rejected(new Error('x'), 'id', { siteId: 's' }),
    );
    expect(state.listError).toBe('');

    state = audienceResearchReducer(
      undefined,
      fetchRun.rejected(new Error('x'), 'id', { siteId: 's', runId: 'r1' }),
    );
    expect(state.runStatus.error.r1).toBe('');

    state = audienceResearchReducer(
      undefined,
      fetchRunResult.rejected(new Error('x'), 'id', { siteId: 's', runId: 'r1' }),
    );
    expect(state.resultStatus.error.r1).toBe('');
  });

  it('an aborted rejection is a no-op for every rejected reducer', () => {
    const input = { siteMarket: DEFAULT_FORM_MARKET, competitorDomains: [], seedTopics: [] };
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });

    let state = audienceResearchReducer(
      undefined,
      startRun.rejected(aborted, 'id', { siteId: 's', input }),
    );
    expect(state).toEqual(initialState);

    state = audienceResearchReducer(
      undefined,
      fetchRuns.rejected(aborted, 'id', { siteId: 's' }),
    );
    expect(state).toEqual(initialState);

    state = audienceResearchReducer(
      undefined,
      fetchRun.rejected(aborted, 'id', { siteId: 's', runId: 'r1' }),
    );
    expect(state.runStatus.error.r1).toBeUndefined();

    state = audienceResearchReducer(
      undefined,
      fetchRunResult.rejected(aborted, 'id', { siteId: 's', runId: 'r1' }),
    );
    expect(state.resultStatus.error.r1).toBeUndefined();
  });
});

describe('audienceResearch thunks — startRun', () => {
  const input = { siteMarket: DEFAULT_FORM_MARKET, competitorDomains: [], seedTopics: [] };

  it('fulfilled path stores lastStartedId and selects the run', async () => {
    api.startAudienceResearchRun.mockResolvedValue({
      runId: 'r9',
      status: 'queued',
      duplicate: false,
      outputLocale: 'en',
    });
    const store = makeStore();
    await store.dispatch(startRun({ siteId: 's1', input }));
    const state = store.getState();
    expect(selectStartStatus(state).lastStartedId).toBe('r9');
    expect(selectSelectedRunId(state)).toBe('r9');
    expect(selectStartStatus(state).duplicate).toBe(false);
  });

  it('rejected (ApiError) surfaces the server message', async () => {
    api.startAudienceResearchRun.mockRejectedValue(new ApiError('x', 503, { error: { message: 'Try again.' } }));
    const store = makeStore();
    await store.dispatch(startRun({ siteId: 's1', input }));
    expect(selectStartStatus(store.getState()).loading).toBe(false);
    expect(selectStartStatus(store.getState()).error).toBe('Try again.');
  });
});

describe('audienceResearch thunks — fetchRuns', () => {
  it('initial fetch populates the list and resets the cursor stack', async () => {
    api.listAudienceResearchRuns.mockResolvedValue({ items: [run('r1'), run('r2')], nextCursor: 'c2' });
    const store = makeStore();
    await store.dispatch(fetchRuns({ siteId: 's1' }));
    const state = store.getState();
    expect(selectRuns(state).map((r) => r.runId)).toEqual(['r1', 'r2']);
    expect(selectListCursor(state)).toBe('c2');
    expect(selectListCanGoPrev(state)).toBe(false);
    expect(selectListLoaded(state)).toBe(true);
  });

  it('next then prev navigation maintains the cursor stack', async () => {
    api.listAudienceResearchRuns.mockResolvedValueOnce({ items: [run('r1')], nextCursor: 'c2' });
    const store = makeStore();
    await store.dispatch(fetchRuns({ siteId: 's1' }));

    api.listAudienceResearchRuns.mockResolvedValueOnce({ items: [run('r2')], nextCursor: null });
    await store.dispatch(fetchRuns({ siteId: 's1', cursor: 'c2', direction: 'next' }));
    expect(selectListCanGoPrev(store.getState())).toBe(true);

    api.listAudienceResearchRuns.mockResolvedValueOnce({ items: [run('r1')], nextCursor: 'c2' });
    await store.dispatch(fetchRuns({ siteId: 's1', cursor: null, direction: 'prev' }));
    expect(selectListCanGoPrev(store.getState())).toBe(false);
  });

  it('rejected path surfaces a list error', async () => {
    api.listAudienceResearchRuns.mockRejectedValue(new ApiError('x', 500, {}));
    const store = makeStore();
    await store.dispatch(fetchRuns({ siteId: 's1' }));
    expect(selectListError(store.getState())).not.toBe('');
    expect(selectListLoaded(store.getState())).toBe(true);
  });

  it('switching siteId rekeys the slice', async () => {
    api.listAudienceResearchRuns.mockResolvedValue({ items: [run('r1')], nextCursor: null });
    const store = makeStore();
    await store.dispatch(fetchRuns({ siteId: 's1' }));
    expect(selectAudienceResearchSiteId(store.getState())).toBe('s1');

    api.listAudienceResearchRuns.mockResolvedValue({ items: [run('r5')], nextCursor: null });
    await store.dispatch(fetchRuns({ siteId: 's2' }));
    expect(selectAudienceResearchSiteId(store.getState())).toBe('s2');
    expect(selectRuns(store.getState()).map((r) => r.runId)).toEqual(['r5']);
  });

  it('a stale fulfilled response for a superseded siteId is ignored', async () => {
    let resolveFirst!: (v: { items: RunStatusView[]; nextCursor: string | null }) => void;
    api.listAudienceResearchRuns.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    const store = makeStore();
    const first = store.dispatch(fetchRuns({ siteId: 's1' }));

    api.listAudienceResearchRuns.mockResolvedValueOnce({ items: [run('r2')], nextCursor: null });
    await store.dispatch(fetchRuns({ siteId: 's2' }));

    resolveFirst({ items: [run('r1')], nextCursor: null });
    await first;

    expect(selectAudienceResearchSiteId(store.getState())).toBe('s2');
    expect(selectRuns(store.getState()).map((r) => r.runId)).toEqual(['r2']);
  });
});

describe('audienceResearch thunks — fetchRun / fetchRunResult', () => {
  it('fetchRun fulfilled stores the run by id', async () => {
    api.getAudienceResearchRun.mockResolvedValue(run('r7'));
    const store = makeStore();
    await store.dispatch(fetchRun({ siteId: 's1', runId: 'r7' }));
    expect(selectRunById('r7')(store.getState())).toEqual(run('r7'));
    expect(selectRunLoading('r7')(store.getState())).toBe(false);
  });

  it('fetchRun rejected stores a per-run error', async () => {
    api.getAudienceResearchRun.mockRejectedValue(new ApiError('x', 404, {}));
    const store = makeStore();
    await store.dispatch(fetchRun({ siteId: 's1', runId: 'r7' }));
    expect(selectRunError('r7')(store.getState())).not.toBe('');
  });

  it('fetchRunResult fulfilled stores both the result and the status view', async () => {
    api.getAudienceResearchRunResult.mockResolvedValue(result('r7'));
    const store = makeStore();
    await store.dispatch(fetchRunResult({ siteId: 's1', runId: 'r7' }));
    expect(selectRunResultById('r7')(store.getState())).toEqual(result('r7'));
    expect(selectRunById('r7')(store.getState())?.runId).toBe('r7');
    expect(selectResultLoading('r7')(store.getState())).toBe(false);
  });

  it('fetchRunResult fulfilled hydrates the durable terminal decisions the server attached', async () => {
    // The session-local decision cache loses every accepted/dismissed state
    // on reload; the server rows on the result view are the authority.
    const decisions = [
      {
        signalId: 'sig-a',
        terminalDecision: 'accepted' as const,
        destination: 'product' as const,
        downstreamId: 'product:abc',
        deepLinkPath: '/sites/s1?tab=actions&action=product:abc',
        decidedAt: '2026-06-02T00:00:00.000Z',
        decidedBy: { userId: 'u1' },
        duplicate: false,
      },
      {
        signalId: 'sig-b',
        terminalDecision: 'dismissed' as const,
        destination: null,
        downstreamId: null,
        deepLinkPath: null,
        decidedAt: '2026-06-02T00:01:00.000Z',
        decidedBy: { userId: 'u1' },
        duplicate: false,
      },
    ];
    api.getAudienceResearchRunResult.mockResolvedValue({
      ...result('r8'),
      decisions,
    });
    const store = makeStore();
    await store.dispatch(fetchRunResult({ siteId: 's1', runId: 'r8' }));
    const terminal = store.getState().audienceResearch.decisions.terminal;
    expect(terminal['sig-a']).toEqual(decisions[0]);
    expect(terminal['sig-b']).toEqual(decisions[1]);
  });

  it('fetchRunResult rejected stores a per-run result error', async () => {
    api.getAudienceResearchRunResult.mockRejectedValue(new ApiError('x', 404, {}));
    const store = makeStore();
    await store.dispatch(fetchRunResult({ siteId: 's1', runId: 'r7' }));
    expect(selectResultError('r7')(store.getState())).not.toBe('');
  });

  it('selectResultError falls back to an empty string for a run with no recorded error', async () => {
    api.getAudienceResearchRunResult.mockRejectedValue(new ApiError('x', 404, {}));
    const store = makeStore();
    await store.dispatch(fetchRunResult({ siteId: 's1', runId: 'r7' }));
    expect(selectResultError('never-fetched')(store.getState())).toBe('');
  });
});

describe('audienceResearch thunks — decideSignal', () => {
  const decisionResult = {
    signalId: 'sig-1',
    terminalDecision: 'accepted' as const,
    destination: 'product' as const,
    downstreamId: 'product:xyz',
    deepLinkPath: '/sites/s1?tab=actions&action=product:xyz',
    decidedAt: '2026-06-02T00:00:00.000Z',
    decidedBy: { userId: 'u1' },
    duplicate: false,
  };

  it('fulfilled stores terminal decision and clears pending / error / conflict', async () => {
    api.postAudienceResearchSignalDecision.mockResolvedValue(decisionResult);
    const store = makeStore();
    // Seed pending + error to prove they clear.
    store.dispatch(
      ensureSignalIdempotencyKey({ signalId: 'sig-1', idempotencyKey: 'ik1' }),
    );
    await store.dispatch(
      decideSignal({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'accepted',
        destination: 'product',
        idempotencyKey: 'ik1',
      }),
    );
    const s = store.getState().audienceResearch!.decisions;
    expect(s.terminal['sig-1']).toEqual(decisionResult);
    expect(s.pending['sig-1']).toBeUndefined();
    expect(s.error['sig-1']).toBeUndefined();
    expect(s.conflict['sig-1']).toBeUndefined();
  });

  it('pending records the idempotency key when none was pre-registered', async () => {
    let pendingSeen: unknown = null;
    api.postAudienceResearchSignalDecision.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(decisionResult), 10);
        }),
    );
    const store = makeStore();
    const promise = store.dispatch(
      decideSignal({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'dismissed',
        idempotencyKey: 'ik-new',
      }),
    );
    pendingSeen = store.getState().audienceResearch!.decisions.pending['sig-1'];
    expect(pendingSeen).toEqual({ idempotencyKey: 'ik-new' });
    await promise;
  });

  it('rejected with 409 sets conflict flag', async () => {
    api.postAudienceResearchSignalDecision.mockRejectedValue(
      new ApiError('conflict', 409, {}),
    );
    const store = makeStore();
    await store.dispatch(
      decideSignal({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'accepted',
        destination: 'product',
        idempotencyKey: 'ik1',
      }),
    );
    const s = store.getState().audienceResearch!.decisions;
    expect(s.conflict['sig-1']).toBe(true);
    expect(s.error['sig-1']).not.toBe('');
    expect(s.pending['sig-1']).toBeUndefined();
  });

  it('rejected with non-409 sets error but not conflict', async () => {
    api.postAudienceResearchSignalDecision.mockRejectedValue(
      new ApiError('boom', 500, {}),
    );
    const store = makeStore();
    await store.dispatch(
      decideSignal({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'dismissed',
        reason: 'other',
        idempotencyKey: 'ik1',
      }),
    );
    const s = store.getState().audienceResearch!.decisions;
    expect(s.error['sig-1']).not.toBe('');
    expect(s.conflict['sig-1']).toBeUndefined();
  });

  it('ensureSignalIdempotencyKey is a no-op when a key already exists', () => {
    const store = makeStore();
    store.dispatch(
      ensureSignalIdempotencyKey({ signalId: 'sig-1', idempotencyKey: 'first' }),
    );
    store.dispatch(
      ensureSignalIdempotencyKey({ signalId: 'sig-1', idempotencyKey: 'second' }),
    );
    expect(
      store.getState().audienceResearch!.decisions.pending['sig-1'],
    ).toEqual({ idempotencyKey: 'first' });
  });

  it('clearSignalDecisionError wipes both error and conflict for the signal', () => {
    const store = makeStore();
    // Seed by rejecting.
    api.postAudienceResearchSignalDecision.mockRejectedValue(
      new ApiError('conflict', 409, {}),
    );
    void store.dispatch(
      decideSignal({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'accepted',
        destination: 'product',
        idempotencyKey: 'ik',
      }),
    );
    // The dispatch above is async — clear should still act on any state:
    store.dispatch(clearSignalDecisionError('sig-1'));
    const s = store.getState().audienceResearch!.decisions;
    expect(s.error['sig-1']).toBeUndefined();
    expect(s.conflict['sig-1']).toBeUndefined();
  });

  it('an aborted decision is ignored by the reducer', async () => {
    api.postAudienceResearchSignalDecision.mockImplementation(
      () => new Promise(() => {}),
    );
    const store = makeStore();
    const promise = store.dispatch(
      decideSignal({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'dismissed',
        idempotencyKey: 'ik',
      }),
    );
    promise.abort();
    await promise;
    const s = store.getState().audienceResearch!.decisions;
    expect(s.error['sig-1']).toBeUndefined();
  });

  it('decideSignal.rejected with no rejectWithValue payload falls back to an empty error string', () => {
    // A rejected action that never reached `rejectWithValue` has
    // action.payload = undefined. The rejected reducer's `?? ''` fallback
    // (line 304) should land the signal in an empty-error state instead of
    // storing `undefined`. Constructed via the action-creator directly so
    // the payload really is undefined (going through the store thunk always
    // calls rejectWithValue).
    const state = audienceResearchReducer(
      undefined,
      decideSignal.rejected(
        new Error('boom'),
        'req-id',
        {
          siteId: 's1',
          runId: 'r1',
          signalId: 'sig-1',
          decision: 'dismissed',
          idempotencyKey: 'ik',
        },
      ),
    );
    expect(state.decisions.error['sig-1']).toBe('');
    expect(state.decisions.conflict['sig-1']).toBeUndefined();
    expect(state.decisions.pending['sig-1']).toBeUndefined();
  });
});
