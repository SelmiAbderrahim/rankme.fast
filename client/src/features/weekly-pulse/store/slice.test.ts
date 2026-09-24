import { describe, expect, it } from 'vitest';
import {
  clearPreview,
  clearSaveError,
  initialState,
  resetWeeklyPulse,
  setSelectedPulseId,
  weeklyPulseReducer,
} from './slice';
import {
  fetchGenerativeAppearance,
  fetchWeeklyPulseDetail,
  fetchWeeklyPulseHistory,
  fetchWeeklyPulseState,
  previewWeeklyPulseSpend,
  setSubscription,
} from './thunks';
import type {
  DigestProjectionPayload,
  GscGenerativeAppearanceRead,
  PulseHistoryDetail,
  PulseHistoryPage,
  PulseStateView,
  SpendPreview,
} from '../types';

const stateView = (over: Partial<PulseStateView> = {}): PulseStateView => ({
  siteId: 's1',
  subscription: null,
  setting: null,
  lastRun: null,
  coverage: [],
  gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
  ...over,
});

const preview = (): SpendPreview => ({
  productUnits: 1,
  estimatedAt: '2026-01-05T09:00:00.000Z',
});

describe('weeklyPulseReducer', () => {
  it('returns the initial state', () => {
    expect(weeklyPulseReducer(undefined, { type: 'unknown' })).toEqual(initialState);
  });

  it('resetWeeklyPulse restores the initial state', () => {
    const dirty = { ...initialState, saving: true };
    expect(weeklyPulseReducer(dirty, resetWeeklyPulse())).toEqual(initialState);
  });

  it('setSelectedPulseId updates the selected id', () => {
    const next = weeklyPulseReducer(initialState, setSelectedPulseId('pulse-1'));
    expect(next.selectedPulseId).toBe('pulse-1');
    const cleared = weeklyPulseReducer(next, setSelectedPulseId(null));
    expect(cleared.selectedPulseId).toBeNull();
  });

  it('clearSaveError removes the save error', () => {
    const errored = { ...initialState, saveError: { error: 'x' } };
    expect(weeklyPulseReducer(errored, clearSaveError()).saveError).toBeNull();
  });

  it('clearPreview wipes preview state', () => {
    const populated = {
      ...initialState,
      preview: preview(),
      previewFetchedAt: 'iso',
      previewError: { error: 'x' },
    };
    const cleared = weeklyPulseReducer(populated, clearPreview());
    expect(cleared.preview).toBeNull();
    expect(cleared.previewFetchedAt).toBeNull();
    expect(cleared.previewError).toBeNull();
  });
});

describe('fetchWeeklyPulseState reducers', () => {
  it('records loading on pending', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseState.pending('rq1', { siteId: 'site-1' }),
    );
    expect(next.stateLoading).toBe(true);
    expect(next.siteId).toBe('site-1');
  });

  it('records payload on fulfilled', () => {
    const view = stateView();
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseState.fulfilled(view, 'rq1', { siteId: 's1' }),
    );
    expect(next.state).toEqual(view);
    expect(next.stateLoading).toBe(false);
  });

  it('records error on rejected (with rejectValue)', () => {
    const rejected = fetchWeeklyPulseState.rejected(new Error('boom'), 'rq1', { siteId: 's1' }, {
      error: 'boom',
    });
    const next = weeklyPulseReducer(initialState, rejected);
    expect(next.stateError?.error).toBe('boom');
  });

  it('records error on rejected (without rejectValue payload)', () => {
    const rejected = fetchWeeklyPulseState.rejected(new Error('nope'), 'rq1', { siteId: 's1' });
    const next = weeklyPulseReducer(initialState, rejected);
    expect(next.stateError?.error).toBe('nope');
  });
});

describe('previewWeeklyPulseSpend reducers', () => {
  it('pending clears prior error', () => {
    const s = { ...initialState, previewError: { error: 'x' } };
    const next = weeklyPulseReducer(s, previewWeeklyPulseSpend.pending('r', { siteId: 's' }));
    expect(next.previewError).toBeNull();
    expect(next.previewLoading).toBe(true);
  });

  it('fulfilled sets preview', () => {
    const next = weeklyPulseReducer(
      initialState,
      previewWeeklyPulseSpend.fulfilled(preview(), 'r', { siteId: 's' }),
    );
    expect(next.preview).toEqual(preview());
    expect(next.previewFetchedAt).not.toBeNull();
  });

  it('rejected records error', () => {
    const next = weeklyPulseReducer(
      initialState,
      previewWeeklyPulseSpend.rejected(new Error('boom'), 'r', { siteId: 's' }, {
        error: 'boom',
        status: 500,
      }),
    );
    expect(next.previewError).toEqual({ error: 'boom', status: 500 });
  });

  it('rejected without payload falls back to error.message', () => {
    const next = weeklyPulseReducer(
      initialState,
      previewWeeklyPulseSpend.rejected(new Error('unhandled'), 'r', { siteId: 's' }),
    );
    expect(next.previewError?.error).toBe('unhandled');
  });
});

describe('setSubscription reducers', () => {
  it('pending sets saving', () => {
    const next = weeklyPulseReducer(
      initialState,
      setSubscription.pending('r', { siteId: 's', enabled: true }),
    );
    expect(next.saving).toBe(true);
  });

  it('fulfilled replaces state', () => {
    const v = stateView();
    const next = weeklyPulseReducer(
      initialState,
      setSubscription.fulfilled(v, 'r', { siteId: 's', enabled: true }),
    );
    expect(next.state).toEqual(v);
  });

  it('rejected records error', () => {
    const next = weeklyPulseReducer(
      initialState,
      setSubscription.rejected(new Error('bad'), 'r', { siteId: 's', enabled: true }, {
        error: 'bad',
      }),
    );
    expect(next.saveError?.error).toBe('bad');
  });

  it('rejected without payload falls back to error.message', () => {
    const next = weeklyPulseReducer(
      initialState,
      setSubscription.rejected(new Error('nope'), 'r', { siteId: 's', enabled: true }),
    );
    expect(next.saveError?.error).toBe('nope');
  });
});

describe('fetchWeeklyPulseHistory reducers', () => {
  const page: PulseHistoryPage = {
    siteId: 's1',
    runs: [
      {
        runId: 'r1',
        isoWeek: '2026-W01',
        status: 'completed',
        startedAt: null,
        finishedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    nextCursor: 'cur',
  };
  it('pending clears error', () => {
    const s = { ...initialState, historyError: { error: 'x' } };
    const next = weeklyPulseReducer(
      s,
      fetchWeeklyPulseHistory.pending('r', { siteId: 's1' }),
    );
    expect(next.historyError).toBeNull();
  });

  it('initial fulfilled replaces history', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseHistory.fulfilled(
        { page, siteId: 's1', direction: 'initial' },
        'r',
        { siteId: 's1' },
      ),
    );
    expect(next.history?.runs).toHaveLength(1);
  });

  it('next fulfilled appends when history exists', () => {
    const seed = { ...initialState, history: page };
    const nextPage: PulseHistoryPage = {
      siteId: 's1',
      runs: [
        {
          runId: 'r2',
          isoWeek: '2026-W02',
          status: 'partial',
          startedAt: null,
          finishedAt: null,
          createdAt: '2026-01-08T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    };
    const next = weeklyPulseReducer(
      seed,
      fetchWeeklyPulseHistory.fulfilled(
        { page: nextPage, siteId: 's1', direction: 'next' },
        'r',
        { siteId: 's1' },
      ),
    );
    expect(next.history?.runs).toHaveLength(2);
    expect(next.history?.nextCursor).toBeNull();
  });

  it('rejected records error', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseHistory.rejected(new Error('x'), 'r', { siteId: 's1' }, {
        error: 'x',
      }),
    );
    expect(next.historyError?.error).toBe('x');
  });

  it('rejected without payload falls back to error.message', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseHistory.rejected(new Error('e'), 'r', { siteId: 's1' }),
    );
    expect(next.historyError?.error).toBe('e');
  });
});

describe('fetchWeeklyPulseDetail reducers', () => {
  const detail: PulseHistoryDetail = {
    siteId: 's1',
    runId: 'r1',
    isoWeek: '2026-W01',
    status: 'completed',
    projection: { header: { siteId: 's1', siteLabel: 'L', isoWeek: '2026-W01', market: null, renderedAt: '' } } as unknown as DigestProjectionPayload,
    citationChanges: [],
  };
  it('fulfilled stores keyed by runId', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseDetail.fulfilled(detail, 'r', { siteId: 's1', pulseId: 'r1' }),
    );
    expect(next.detailByPulseId['r1']).toEqual(detail);
  });

  it('rejected records error', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseDetail.rejected(new Error('boom'), 'r', {
        siteId: 's1',
        pulseId: 'r1',
      }),
    );
    expect(next.detailError).not.toBeNull();
  });

  it('rejected with a rejectValue payload records it verbatim', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseDetail.rejected(
        new Error('boom'),
        'r',
        { siteId: 's1', pulseId: 'r1' },
        { error: 'weeklyPulse.errors.unexpected', status: 500 },
      ),
    );
    expect(next.detailError).toEqual({
      error: 'weeklyPulse.errors.unexpected',
      status: 500,
    });
  });

  it('pending sets detailLoading and clears the prior error', () => {
    const s = { ...initialState, detailError: { error: 'x' } };
    const next = weeklyPulseReducer(
      s,
      fetchWeeklyPulseDetail.pending('r', { siteId: 's1', pulseId: 'r1' }),
    );
    expect(next.detailLoading).toBe(true);
    expect(next.detailError).toBeNull();
  });
});

describe('rejected without payload and without an error message', () => {
  // A message-less serialized error (e.g. an aborted request surfacing a bare
  // object) must fall back to the literal 'unknown' marker in every slot.
  const bareError = {} as Error;

  it('fetchWeeklyPulseState falls back to unknown', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseState.rejected(bareError, 'r', { siteId: 's1' }),
    );
    expect(next.stateError?.error).toBe('unknown');
  });

  it('previewWeeklyPulseSpend falls back to unknown', () => {
    const next = weeklyPulseReducer(
      initialState,
      previewWeeklyPulseSpend.rejected(bareError, 'r', { siteId: 's1' }),
    );
    expect(next.previewError?.error).toBe('unknown');
  });

  it('setSubscription falls back to unknown', () => {
    const next = weeklyPulseReducer(
      initialState,
      setSubscription.rejected(bareError, 'r', { siteId: 's1', enabled: true }),
    );
    expect(next.saveError?.error).toBe('unknown');
  });

  it('fetchWeeklyPulseHistory falls back to unknown', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseHistory.rejected(bareError, 'r', { siteId: 's1' }),
    );
    expect(next.historyError?.error).toBe('unknown');
  });

  it('fetchWeeklyPulseDetail falls back to unknown', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchWeeklyPulseDetail.rejected(bareError, 'r', { siteId: 's1', pulseId: 'p1' }),
    );
    expect(next.detailError?.error).toBe('unknown');
  });

  it('fetchGenerativeAppearance falls back to unknown', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchGenerativeAppearance.rejected(bareError, 'r', { siteId: 's1' }),
    );
    expect(next.gscError?.error).toBe('unknown');
  });
});

describe('fetchGenerativeAppearance reducers', () => {
  const appearance: GscGenerativeAppearanceRead = {
    status: 'available',
    window: { start: '2025-12-01', end: '2026-01-04', windowDays: 28 },
    rows: [],
    observationMeta: null,
  };
  it('fulfilled sets gscAppearance', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchGenerativeAppearance.fulfilled(appearance, 'r', { siteId: 's1' }),
    );
    expect(next.gscAppearance?.status).toBe('available');
  });
  it('pending clears error', () => {
    const s = { ...initialState, gscError: { error: 'x' } };
    const next = weeklyPulseReducer(
      s,
      fetchGenerativeAppearance.pending('r', { siteId: 's1' }),
    );
    expect(next.gscError).toBeNull();
    expect(next.gscLoading).toBe(true);
  });
  it('rejected records error', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchGenerativeAppearance.rejected(new Error('boom'), 'r', { siteId: 's1' }, {
        error: 'boom',
        reconnectRequired: true,
      }),
    );
    expect(next.gscError?.reconnectRequired).toBe(true);
  });
  it('rejected without payload falls back to error.message', () => {
    const next = weeklyPulseReducer(
      initialState,
      fetchGenerativeAppearance.rejected(new Error('boom'), 'r', { siteId: 's1' }),
    );
    expect(next.gscError?.error).toBe('boom');
  });
});
