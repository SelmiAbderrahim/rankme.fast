import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';

vi.mock('../api', () => ({
  getWeeklyPulseState: vi.fn(),
  previewWeeklyPulse: vi.fn(),
  setWeeklyPulseSubscription: vi.fn(),
  listWeeklyPulseHistory: vi.fn(),
  getWeeklyPulseHistoryDetail: vi.fn(),
  getGenerativeAppearance: vi.fn(),
}));

import * as api from '../api';
import {
  fetchGenerativeAppearance,
  fetchWeeklyPulseDetail,
  fetchWeeklyPulseHistory,
  fetchWeeklyPulseState,
  previewWeeklyPulseSpend,
  setSubscription,
} from './thunks';
import { weeklyPulseReducer } from './slice';

function makeStore() {
  return configureStore({ reducer: { weeklyPulse: weeklyPulseReducer } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchWeeklyPulseState', () => {
  it('dispatches fulfilled on success', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: null,
      setting: null,
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseState({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.state?.siteId).toBe('s1');
  });

  it('normalizes ApiError to reject payload', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('boom', 500, null),
    );
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseState({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.stateError).toEqual({
      error: 'boom',
      status: 500,
      reconnectRequired: false,
    });
  });

  it('normalizes non-ApiError to reject payload with message', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('random'),
    );
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseState({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.stateError?.error).toBe('random');
  });

  it('normalizes ApiError with empty message to unexpected key', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('', 500, null),
    );
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseState({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.stateError?.error).toBe(
      'weeklyPulse.errors.unexpected',
    );
  });

  it('normalizes non-Error with no message to unexpected key', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockRejectedValue({});
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseState({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.stateError?.error).toBe(
      'weeklyPulse.errors.unexpected',
    );
  });
});

describe('previewWeeklyPulseSpend', () => {
  it('stores the preview on success', async () => {
    (api.previewWeeklyPulse as ReturnType<typeof vi.fn>).mockResolvedValue({
      productUnits: 1,
      estimatedAt: 'iso',
    });
    const store = makeStore();
    await store.dispatch(previewWeeklyPulseSpend({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.preview).toEqual({
      productUnits: 1,
      estimatedAt: 'iso',
    });
  });

  it('records the server error on failure', async () => {
    (api.previewWeeklyPulse as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('Preview unavailable', 503, null),
    );
    const store = makeStore();
    await store.dispatch(previewWeeklyPulseSpend({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.previewError).toMatchObject({
      error: 'Preview unavailable',
      status: 503,
    });
  });
});

describe('setSubscription', () => {
  it('updates state on success', async () => {
    (api.setWeeklyPulseSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: true, locale: 'en', enabledAt: 'iso', disabledAt: null },
      setting: null,
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const store = makeStore();
    await store.dispatch(setSubscription({ siteId: 's1', enabled: true }));
    expect(store.getState().weeklyPulse.state?.subscription?.enabled).toBe(true);
  });
});

describe('fetchWeeklyPulseHistory', () => {
  it('appends on direction=next', async () => {
    (api.listWeeklyPulseHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      runs: [
        {
          runId: 'r2',
          isoWeek: '2026-W02',
          status: 'completed',
          startedAt: null,
          finishedAt: null,
          createdAt: '2026-01-08T00:00:00Z',
        },
      ],
      nextCursor: null,
    });
    const store = makeStore();
    // Seed initial page.
    (api.listWeeklyPulseHistory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        siteId: 's1',
        runs: [
          {
            runId: 'r1',
            isoWeek: '2026-W01',
            status: 'completed',
            startedAt: null,
            finishedAt: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        nextCursor: 'cur',
      })
      .mockResolvedValueOnce({
        siteId: 's1',
        runs: [
          {
            runId: 'r2',
            isoWeek: '2026-W02',
            status: 'completed',
            startedAt: null,
            finishedAt: null,
            createdAt: '2026-01-08T00:00:00Z',
          },
        ],
        nextCursor: null,
      });
    await store.dispatch(fetchWeeklyPulseHistory({ siteId: 's1' }));
    await store.dispatch(
      fetchWeeklyPulseHistory({ siteId: 's1', cursor: 'cur', direction: 'next', limit: 1 }),
    );
    expect(store.getState().weeklyPulse.history?.runs).toHaveLength(2);
  });

  it('rejects on 500', async () => {
    (api.listWeeklyPulseHistory as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('boom', 500, null),
    );
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseHistory({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.historyError?.status).toBe(500);
  });
});

describe('fetchWeeklyPulseDetail', () => {
  it('stores detail by pulseId', async () => {
    (api.getWeeklyPulseHistoryDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      runId: 'r1',
      isoWeek: '2026-W01',
      status: 'completed',
      projection: null,
      citationChanges: [],
    });
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseDetail({ siteId: 's1', pulseId: 'r1' }));
    expect(store.getState().weeklyPulse.detailByPulseId['r1']?.runId).toBe('r1');
  });

  it('records error on failure', async () => {
    (api.getWeeklyPulseHistoryDetail as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('x'),
    );
    const store = makeStore();
    await store.dispatch(fetchWeeklyPulseDetail({ siteId: 's1', pulseId: 'r1' }));
    expect(store.getState().weeklyPulse.detailError).not.toBeNull();
  });
});

describe('fetchGenerativeAppearance', () => {
  it('unwraps the { appearance } envelope', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'available',
        window: null,
        rows: [],
        observationMeta: null,
      },
    });
    const store = makeStore();
    await store.dispatch(fetchGenerativeAppearance({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.gscAppearance?.status).toBe('available');
  });

  it('flags reconnectRequired when the reconnect message surfaces', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('reconnect required', 404, null),
    );
    const store = makeStore();
    await store.dispatch(fetchGenerativeAppearance({ siteId: 's1' }));
    expect(store.getState().weeklyPulse.gscError?.reconnectRequired).toBe(true);
  });
});
