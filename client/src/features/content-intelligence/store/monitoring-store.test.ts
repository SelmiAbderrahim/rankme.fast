import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import type { ContentMonitor, MonitorFeedEvent } from '../types';
import {
  clearMonitorMutateError,
  clearMonitorSubmitError,
  contentIntelligenceReducer,
  initialState,
  type ContentIntelligenceState,
} from './slice';
import {
  createMonitorThunk,
  deleteMonitorThunk,
  loadMonitorFeed,
  loadMonitorNotificationPref,
  loadMonitors,
  pauseMonitorThunk,
  resumeMonitorThunk,
  updateMonitorNotificationPref,
} from './thunks';
import {
  selectMonitorActiveLimit,
  selectMonitorById,
  selectMonitorDetailError,
  selectMonitorDetailLoading,
  selectMonitorFeed,
  selectMonitorFeedCursor,
  selectMonitorLastCreatedId,
  selectMonitorListLoaded,
  selectMonitorListLoading,
  selectMonitorMutating,
  selectMonitorNotificationLoading,
  selectMonitorNotificationPref,
  selectMonitorNotificationSaving,
  selectMonitors,
  selectMonitorUsedSlots,
} from './selectors';

const api = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  createMonitor: vi.fn(),
  getMonitorFeed: vi.fn(),
  pauseMonitor: vi.fn(),
  resumeMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  getMonitorNotifications: vi.fn(),
  patchMonitorNotifications: vi.fn(),
}));

vi.mock('../api', () => api);

function monitor(overrides: Partial<ContentMonitor> = {}): ContentMonitor {
  return {
    monitorId: 'm1',
    siteId: 's1',
    targetUrl: 'https://example.com/pricing',
    targetKind: 'owned',
    cadence: 'weekly',
    locale: 'en',
    status: 'active',
    hasBaseline: false,
    lastCheckAt: null,
    lastMaterialChangeAt: null,
    lastReconcileAt: null,
    error: null,
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

function feedEvent(overrides: Partial<MonitorFeedEvent> = {}): MonitorFeedEvent {
  return {
    eventKey: 'e1',
    kind: 'check_completed',
    checkId: 'c1',
    isoWeek: '2026-W29',
    recordedAt: '2026-07-20T00:00:00Z',
    diffText: null,
    ...overrides,
  };
}

function store() {
  return configureStore({ reducer: { contentIntelligence: contentIntelligenceReducer } });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.listMonitors.mockResolvedValue({ monitors: [monitor()], activeLimit: 5, usedSlots: 1 });
  api.createMonitor.mockResolvedValue({ monitor: monitor({ monitorId: 'm9' }), duplicate: false });
  api.getMonitorFeed.mockResolvedValue({ monitor: monitor(), feed: [feedEvent()], nextCursor: null });
  api.pauseMonitor.mockResolvedValue({ monitor: monitor({ status: 'paused' }) });
  api.resumeMonitor.mockResolvedValue({ monitor: monitor({ status: 'active' }) });
  api.deleteMonitor.mockResolvedValue({ ok: true });
  api.getMonitorNotifications.mockResolvedValue({ preferences: { emailMonitorChange: true } });
  api.patchMonitorNotifications.mockResolvedValue({ preferences: { emailMonitorChange: false } });
});

describe('monitoring thunks — success paths', () => {
  it('loads monitors + allowance and exposes them via selectors', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    const state = s.getState();
    expect(selectMonitors(state)).toHaveLength(1);
    expect(selectMonitorActiveLimit(state)).toBe(5);
    expect(selectMonitorUsedSlots(state)).toBe(1);
    expect(selectMonitorListLoaded(state)).toBe(true);
    expect(selectMonitorListLoading(state)).toBe(false);
    expect(selectMonitorById('m1')(state)?.status).toBe('active');
  });

  it('passes a status filter to the api', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1', status: 'cap_paused' }));
    expect(api.listMonitors).toHaveBeenCalledWith('s1', 'cap_paused', expect.anything());
  });

  it('creates a monitor and records the last created id (unshift into list)', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    await s.dispatch(
      createMonitorThunk({ siteId: 's1', targetUrl: 'https://x', targetKind: 'owned', locale: 'en' }),
    );
    const state = s.getState();
    expect(selectMonitorLastCreatedId(state)).toBe('m9');
    expect(selectMonitors(state).map((m) => m.monitorId)).toEqual(['m9', 'm1']);
  });

  it('replaces an existing monitor on create instead of duplicating it', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    api.createMonitor.mockResolvedValueOnce({ monitor: monitor({ status: 'paused' }), duplicate: true });
    await s.dispatch(
      createMonitorThunk({ siteId: 's1', targetUrl: 'https://x', targetKind: 'owned', locale: 'en' }),
    );
    const list = selectMonitors(s.getState());
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('paused');
  });

  it('loads a feed, folds the monitor into the list, and appends de-duplicated pages', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    api.getMonitorFeed.mockResolvedValueOnce({
      monitor: monitor({ status: 'paused' }),
      feed: [feedEvent({ eventKey: 'e1' })],
      nextCursor: 'cur',
    });
    await s.dispatch(loadMonitorFeed({ siteId: 's1', monitorId: 'm1' }));
    let state = s.getState();
    expect(selectMonitorFeed('m1')(state)).toHaveLength(1);
    expect(selectMonitorFeedCursor('m1')(state)).toBe('cur');
    expect(selectMonitorById('m1')(state)?.status).toBe('paused');
    expect(selectMonitors(state)[0]!.status).toBe('paused');

    api.getMonitorFeed.mockResolvedValueOnce({
      monitor: monitor(),
      feed: [feedEvent({ eventKey: 'e1' }), feedEvent({ eventKey: 'e2' })],
      nextCursor: null,
    });
    await s.dispatch(loadMonitorFeed({ siteId: 's1', monitorId: 'm1', cursor: 'cur', append: true }));
    state = s.getState();
    expect(selectMonitorFeed('m1')(state).map((e) => e.eventKey)).toEqual(['e1', 'e2']);
    expect(selectMonitorFeedCursor('m1')(state)).toBeNull();
    expect(selectMonitorDetailLoading('m1')(state)).toBe(false);
  });

  it('pauses + resumes a monitor in place and clears the mutating flag', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    const promise = s.dispatch(pauseMonitorThunk({ siteId: 's1', monitorId: 'm1' }));
    expect(selectMonitorMutating('m1')(s.getState())).toBe(true);
    await promise;
    expect(selectMonitorMutating('m1')(s.getState())).toBe(false);
    expect(selectMonitors(s.getState())[0]!.status).toBe('paused');
    await s.dispatch(resumeMonitorThunk({ siteId: 's1', monitorId: 'm1' }));
    expect(selectMonitors(s.getState())[0]!.status).toBe('active');
  });

  it('deletes a monitor, drops it from state, and decrements the used slots', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    await s.dispatch(loadMonitorFeed({ siteId: 's1', monitorId: 'm1' }));
    await s.dispatch(deleteMonitorThunk({ siteId: 's1', monitorId: 'm1' }));
    const state = s.getState();
    expect(selectMonitors(state)).toEqual([]);
    expect(selectMonitorUsedSlots(state)).toBe(0);
    expect(selectMonitorById('m1')(state)).toBeUndefined();
    expect(selectMonitorFeed('m1')(state)).toEqual([]);
    expect(selectMonitorFeedCursor('m1')(state)).toBeNull();
    expect(selectMonitorMutating('m1')(state)).toBe(false);
  });

  it('appends a feed page even when the monitor had no cached feed', async () => {
    const s = store();
    api.getMonitorFeed.mockResolvedValueOnce({
      monitor: monitor(),
      feed: [feedEvent({ eventKey: 'e1' })],
      nextCursor: null,
    });
    // append:true with no prior feed[id] exercises the `?? []` fallback.
    await s.dispatch(loadMonitorFeed({ siteId: 's1', monitorId: 'm1', cursor: 'c', append: true }));
    expect(selectMonitorFeed('m1')(s.getState()).map((e) => e.eventKey)).toEqual(['e1']);
  });

  it('loads and toggles the notification preference', async () => {
    const s = store();
    const loadPromise = s.dispatch(loadMonitorNotificationPref());
    expect(selectMonitorNotificationLoading(s.getState())).toBe(true);
    await loadPromise;
    expect(selectMonitorNotificationPref(s.getState())).toBe(true);
    expect(selectMonitorNotificationLoading(s.getState())).toBe(false);

    const savePromise = s.dispatch(updateMonitorNotificationPref({ value: false }));
    expect(selectMonitorNotificationSaving(s.getState())).toBe(true);
    await savePromise;
    expect(selectMonitorNotificationPref(s.getState())).toBe(false);
    expect(selectMonitorNotificationSaving(s.getState())).toBe(false);
  });
});

describe('monitoring thunks — error paths', () => {
  it('normalizes API errors on create + list', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    api.createMonitor.mockRejectedValueOnce(new ApiError('conflict', 409, null));
    api.listMonitors.mockRejectedValueOnce(new ApiError('forbidden', 403, null));
    const created = await s.dispatch(
      createMonitorThunk({ siteId: 's1', targetUrl: 'https://x', targetKind: 'owned', locale: 'en' }),
    );
    const listed = await s.dispatch(loadMonitors({ siteId: 's1' }));
    expect(created.payload).toMatchObject({ status: 409 });
    expect(listed.payload).toMatchObject({ status: 403 });
    const state = s.getState();
    expect(selectMonitorListLoaded(state)).toBe(true);
  });

  it('surfaces feed, mutate, delete, and notification rejections and clears flags', async () => {
    const s = store();
    await s.dispatch(loadMonitors({ siteId: 's1' }));
    api.getMonitorFeed.mockRejectedValueOnce(new ApiError('feedboom', 404, null));
    api.pauseMonitor.mockRejectedValueOnce(new ApiError('mutboom', 500, null));
    api.resumeMonitor.mockRejectedValueOnce(new ApiError('resumeboom', 500, null));
    api.deleteMonitor.mockRejectedValueOnce(new ApiError('delboom', 500, null));
    api.getMonitorNotifications.mockRejectedValueOnce(new Error('offline'));
    api.patchMonitorNotifications.mockRejectedValueOnce(new ApiError('saveboom', 500, null));
    const feed = await s.dispatch(loadMonitorFeed({ siteId: 's1', monitorId: 'm1' }));
    const paused = await s.dispatch(pauseMonitorThunk({ siteId: 's1', monitorId: 'm1' }));
    const resumed = await s.dispatch(resumeMonitorThunk({ siteId: 's1', monitorId: 'm1' }));
    const deleted = await s.dispatch(deleteMonitorThunk({ siteId: 's1', monitorId: 'm1' }));
    const loadedPref = await s.dispatch(loadMonitorNotificationPref());
    const savedPref = await s.dispatch(updateMonitorNotificationPref({ value: true }));
    expect(feed.meta.requestStatus).toBe('rejected');
    expect(paused.meta.requestStatus).toBe('rejected');
    expect(resumed.meta.requestStatus).toBe('rejected');
    expect(deleted.meta.requestStatus).toBe('rejected');
    expect(loadedPref.meta.requestStatus).toBe('rejected');
    expect(savedPref.meta.requestStatus).toBe('rejected');
    const state = s.getState();
    expect(selectMonitorMutating('m1')(state)).toBe(false);
    expect(selectMonitorNotificationSaving(state)).toBe(false);
    expect(selectMonitorNotificationLoading(state)).toBe(false);
  });
});

describe('monitoring reducers + edge branches', () => {
  it('resets the monitoring branch on a site change', () => {
    let state = contentIntelligenceReducer(
      { ...initialState, siteId: 's1' },
      {
        type: loadMonitors.fulfilled.type,
        payload: { response: { monitors: [monitor()], activeLimit: 5, usedSlots: 1 }, siteId: 's1' },
        meta: { arg: { siteId: 's1' }, requestId: 'x', requestStatus: 'fulfilled' },
      },
    );
    expect(state.monitoring.monitors).toHaveLength(1);
    state = contentIntelligenceReducer(state, {
      type: loadMonitors.pending.type,
      payload: undefined,
      meta: { arg: { siteId: 's2' }, requestId: 'y', requestStatus: 'pending' },
    });
    expect(state.siteId).toBe('s2');
    expect(state.monitoring.monitors).toEqual([]);
    expect(state.monitoring.listLoading).toBe(true);
  });

  it('ignores fulfilled monitor payloads for a stale site', () => {
    const base = { ...initialState, siteId: 's2' };
    const stale = contentIntelligenceReducer(base, {
      type: loadMonitors.fulfilled.type,
      payload: { response: { monitors: [monitor()], activeLimit: 5, usedSlots: 1 }, siteId: 's1' },
      meta: { arg: { siteId: 's1' }, requestId: 'x', requestStatus: 'fulfilled' },
    });
    expect(stale.monitoring.monitors).toEqual([]);
  });

  it('ignores aborted rejections across every monitoring thunk', () => {
    const aborted = (type: string, arg: Record<string, unknown>) => ({
      type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: { arg, requestId: 'x', requestStatus: 'rejected' as const, aborted: true, condition: false },
    });
    let state: ContentIntelligenceState = { ...initialState, siteId: 's1' };
    const cases = [
      aborted(loadMonitors.rejected.type, { siteId: 's1' }),
      aborted(createMonitorThunk.rejected.type, { siteId: 's1' }),
      aborted(loadMonitorFeed.rejected.type, { siteId: 's1', monitorId: 'm1' }),
      aborted(pauseMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }),
      aborted(resumeMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }),
      aborted(deleteMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }),
      aborted(loadMonitorNotificationPref.rejected.type, {}),
      aborted(updateMonitorNotificationPref.rejected.type, { value: true }),
    ];
    for (const action of cases) state = contentIntelligenceReducer(state, action);
    expect(state.monitoring.listError).toBe('');
    expect(state.monitoring.submitError).toBe('');
    expect(state.monitoring.mutateError).toBe('');
    expect(state.monitoring.notificationError).toBe('');
  });

  it('clears submit + mutate errors via the reducers', () => {
    const dirty = {
      ...initialState,
      monitoring: {
        ...initialState.monitoring,
        submitError: 'x',
        mutateError: 'y',
      },
    };
    const cleared = contentIntelligenceReducer(
      contentIntelligenceReducer(dirty, clearMonitorSubmitError()),
      clearMonitorMutateError(),
    );
    expect(cleared.monitoring.submitError).toBe('');
    expect(cleared.monitoring.mutateError).toBe('');
  });

  it('resume rejected clears the per-monitor flag and records the error', () => {
    const withFlag = {
      ...initialState,
      siteId: 's1',
      monitoring: { ...initialState.monitoring, mutatingId: { m1: true } },
    };
    const state = contentIntelligenceReducer(withFlag, {
      type: resumeMonitorThunk.rejected.type,
      payload: { error: 'nope' },
      error: { message: 'x' },
      meta: {
        arg: { siteId: 's1', monitorId: 'm1' },
        requestId: 'x',
        requestStatus: 'rejected',
        aborted: false,
        condition: false,
      },
    });
    expect(state.monitoring.mutatingId.m1).toBe(false);
    expect(state.monitoring.mutateError).toBe('nope');
  });

  it('writes error strings from crafted rejected payloads and falls back to empty', () => {
    const base = { ...initialState, siteId: 's1' };
    const reduce = (type: string, arg: Record<string, unknown>, payload: unknown) =>
      contentIntelligenceReducer(base, {
        type,
        payload,
        error: { message: 'x' },
        meta: { arg, requestId: 'x', requestStatus: 'rejected', aborted: false, condition: false },
      });
    expect(
      reduce(loadMonitors.rejected.type, { siteId: 's1' }, { error: 'list' }).monitoring.listError,
    ).toBe('list');
    expect(
      reduce(createMonitorThunk.rejected.type, { siteId: 's1' }, { error: 'sub' }).monitoring.submitError,
    ).toBe('sub');
    expect(
      reduce(loadMonitorFeed.rejected.type, { siteId: 's1', monitorId: 'm1' }, { error: 'feed' })
        .monitoring.detailError.m1,
    ).toBe('feed');
    expect(
      reduce(pauseMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }, { error: 'mut' })
        .monitoring.mutateError,
    ).toBe('mut');
    expect(
      reduce(loadMonitorNotificationPref.rejected.type, {}, { error: 'notif' }).monitoring
        .notificationError,
    ).toBe('notif');
    expect(
      reduce(updateMonitorNotificationPref.rejected.type, { value: true }, { error: 'save' })
        .monitoring.notificationError,
    ).toBe('save');
    // Missing payload → empty-string fallback branch on every handler.
    expect(reduce(loadMonitors.rejected.type, { siteId: 's1' }, undefined).monitoring.listError).toBe('');
    expect(
      reduce(createMonitorThunk.rejected.type, { siteId: 's1' }, undefined).monitoring.submitError,
    ).toBe('');
    expect(
      reduce(loadMonitorFeed.rejected.type, { siteId: 's1', monitorId: 'm1' }, undefined).monitoring
        .detailError.m1,
    ).toBe('');
    expect(
      reduce(pauseMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }, undefined).monitoring
        .mutateError,
    ).toBe('');
    expect(
      reduce(resumeMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }, undefined).monitoring
        .mutateError,
    ).toBe('');
    expect(
      reduce(deleteMonitorThunk.rejected.type, { siteId: 's1', monitorId: 'm1' }, undefined).monitoring
        .mutateError,
    ).toBe('');
    expect(
      reduce(loadMonitorNotificationPref.rejected.type, {}, undefined).monitoring.notificationError,
    ).toBe('');
    expect(
      reduce(updateMonitorNotificationPref.rejected.type, { value: true }, undefined).monitoring
        .notificationError,
    ).toBe('');
  });

  it('selectors fall back to the initial monitoring branch for a bare state', () => {
    const bare = {} as Parameters<typeof selectMonitors>[0];
    expect(selectMonitors(bare)).toEqual([]);
    expect(selectMonitorById(null)(bare)).toBeUndefined();
    expect(selectMonitorFeed(undefined)(bare)).toEqual([]);
    expect(selectMonitorFeedCursor(null)(bare)).toBeNull();
    expect(selectMonitorDetailLoading(null)(bare)).toBe(false);
    expect(selectMonitorDetailError(undefined)(bare)).toBe('');
  });
});
