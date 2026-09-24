import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import type {
  CompetitorContentRun,
  CompetitorContentRunDetail,
  CompetitorProfile,
  CompetitorSuggestion,
} from '../types';
import {
  clearCompetitorAddError,
  clearCompetitorSubmitError,
  contentIntelligenceReducer,
  initialState,
  type ContentIntelligenceState,
} from './slice';
import {
  addCompetitorThunk,
  archiveCompetitorThunk,
  cancelCompetitorRunThunk,
  loadCompetitorProfiles,
  loadCompetitorRun,
  loadCompetitorRuns,
  loadCompetitorSuggestions,
  restoreCompetitorThunk,
  startCompetitorRunThunk,
} from './thunks';
import {
  selectCompetitorAddError,
  selectCompetitorAddingKey,
  selectCompetitorCancelling,
  selectCompetitorDetailError,
  selectCompetitorDetailLoading,
  selectCompetitorListError,
  selectCompetitorListLoaded,
  selectCompetitorListLoading,
  selectCompetitorMutateError,
  selectCompetitorMutating,
  selectCompetitorProfiles,
  selectCompetitorProfilesError,
  selectCompetitorProfilesLoaded,
  selectCompetitorProfilesLoading,
  selectCompetitorRunById,
  selectCompetitorRuns,
  selectCompetitorRunsNextCursor,
  selectCompetitorSubmitError,
  selectCompetitorSuggestions,
  selectCompetitorSuggestionsError,
  selectCompetitorSuggestionsLoaded,
  selectCompetitorSuggestionsLoading,
  selectCompetitorLastStartedRunId,
} from './selectors';

const api = vi.hoisted(() => ({
  suggestCompetitors: vi.fn(),
  listCompetitors: vi.fn(),
  addCompetitor: vi.fn(),
  archiveCompetitor: vi.fn(),
  restoreCompetitor: vi.fn(),
  startCompetitorRun: vi.fn(),
  listCompetitorRuns: vi.fn(),
  getCompetitorRun: vi.fn(),
  cancelCompetitorRun: vi.fn(),
}));

vi.mock('../api', () => api);

function profile(overrides: Partial<CompetitorProfile> = {}): CompetitorProfile {
  return {
    id: 'p1',
    origin: 'https://rival.com',
    registrableDomain: 'rival.com',
    source: 'manual',
    status: 'active',
    createdAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

function suggestion(overrides: Partial<CompetitorSuggestion> = {}): CompetitorSuggestion {
  return {
    registrableDomain: 'rival.com',
    origin: 'https://rival.com',
    avgPosition: 3,
    intersections: 12,
    alreadyConfirmed: false,
    ...overrides,
  };
}

function run(overrides: Partial<CompetitorContentRun> = {}): CompetitorContentRun {
  return {
    runId: 'r1',
    siteId: 's1',
    origin: 'https://example.com',
    ownedUrl: 'https://example.com/p',
    keyword: 'k',
    locale: 'en',
    status: 'completed',
    input: { competitorIds: ['p1'], competitorDomains: ['rival.com'], pageLimit: 15 },
    progress: {
      competitorsRequested: 1,
      competitorsProcessed: 1,
      competitorsFailed: 0,
      pagesScraped: 5,
    },
    warnings: [],
    error: null,
    thresholdsVersion: 'v',
    findings: null,
    reservation: { key: 'k', reservedUnits: 1, refundedUnits: 0, refundedAt: null, refundReason: null },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: '2026-07-20T00:00:00Z',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<CompetitorContentRunDetail> = {}): CompetitorContentRunDetail {
  return { ...run(), pages: [], ...overrides };
}

function store() {
  return configureStore({ reducer: { contentIntelligence: contentIntelligenceReducer } });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.suggestCompetitors.mockResolvedValue({ suggestions: [suggestion()] });
  api.listCompetitors.mockResolvedValue({ competitors: [profile()] });
  api.addCompetitor.mockResolvedValue({ profile: profile(), duplicate: false });
  api.archiveCompetitor.mockResolvedValue({ profile: profile({ status: 'archived' }) });
  api.restoreCompetitor.mockResolvedValue({ profile: profile({ status: 'active' }) });
  api.startCompetitorRun.mockResolvedValue({
    runId: 'r9',
    status: 'queued',
    reservedUnits: 1,
    duplicate: false,
    message: 'ok',
  });
  api.listCompetitorRuns.mockResolvedValue({ items: [run()], nextCursor: null });
  api.getCompetitorRun.mockResolvedValue(detail());
  api.cancelCompetitorRun.mockResolvedValue({ ok: true });
});

describe('competitor content thunks — success paths', () => {
  it('loads profiles, suggestions, and runs and exposes them via selectors', async () => {
    const s = store();
    await s.dispatch(loadCompetitorProfiles({ siteId: 's1', status: 'all' }));
    await s.dispatch(loadCompetitorSuggestions({ siteId: 's1' }));
    await s.dispatch(loadCompetitorRuns({ siteId: 's1' }));
    const state = s.getState();
    expect(selectCompetitorProfiles(state)).toHaveLength(1);
    expect(selectCompetitorProfilesLoaded(state)).toBe(true);
    expect(selectCompetitorProfilesLoading(state)).toBe(false);
    expect(selectCompetitorSuggestions(state)).toHaveLength(1);
    expect(selectCompetitorSuggestionsLoaded(state)).toBe(true);
    expect(selectCompetitorSuggestionsLoading(state)).toBe(false);
    expect(selectCompetitorRuns(state)).toHaveLength(1);
    expect(selectCompetitorListLoaded(state)).toBe(true);
    expect(selectCompetitorListLoading(state)).toBe(false);
    expect(selectCompetitorRunsNextCursor(state)).toBeNull();
  });

  it('adds a competitor and tracks the addingKey lifecycle', async () => {
    const s = store();
    const promise = s.dispatch(addCompetitorThunk({ siteId: 's1', url: 'https://rival.com', source: 'manual' }));
    expect(selectCompetitorAddingKey(s.getState())).toBe('https://rival.com');
    await promise;
    expect(selectCompetitorAddingKey(s.getState())).toBeNull();
  });

  it('archives a profile in place and clears the mutating flag', async () => {
    const s = store();
    await s.dispatch(loadCompetitorProfiles({ siteId: 's1' }));
    const promise = s.dispatch(archiveCompetitorThunk({ siteId: 's1', competitorId: 'p1' }));
    expect(selectCompetitorMutating('p1')(s.getState())).toBe(true);
    await promise;
    expect(selectCompetitorMutating('p1')(s.getState())).toBe(false);
    expect(selectCompetitorProfiles(s.getState())[0]!.status).toBe('archived');
  });

  it('restores a profile in place', async () => {
    const s = store();
    await s.dispatch(loadCompetitorProfiles({ siteId: 's1' }));
    await s.dispatch(archiveCompetitorThunk({ siteId: 's1', competitorId: 'p1' }));
    await s.dispatch(restoreCompetitorThunk({ siteId: 's1', competitorId: 'p1' }));
    expect(selectCompetitorProfiles(s.getState())[0]!.status).toBe('active');
  });

  it('does not touch profiles when the mutated id is unknown', async () => {
    const s = store();
    await s.dispatch(loadCompetitorProfiles({ siteId: 's1' }));
    api.archiveCompetitor.mockResolvedValueOnce({ profile: profile({ id: 'ghost', status: 'archived' }) });
    await s.dispatch(archiveCompetitorThunk({ siteId: 's1', competitorId: 'ghost' }));
    expect(selectCompetitorProfiles(s.getState())[0]!.status).toBe('active');
  });

  it('starts a run and records the last started run id', async () => {
    const s = store();
    await s.dispatch(startCompetitorRunThunk({
      siteId: 's1',
      competitorIds: ['p1'],
      ownedUrl: 'https://example.com/p',
      pageLimit: 15,
      locale: 'en',
    }));
    expect(selectCompetitorLastStartedRunId(s.getState())).toBe('r9');
  });

  it('loads a run detail and folds it into the runs list', async () => {
    const s = store();
    await s.dispatch(loadCompetitorRuns({ siteId: 's1' }));
    api.getCompetitorRun.mockResolvedValueOnce(detail({ runId: 'r1', status: 'partial' }));
    await s.dispatch(loadCompetitorRun({ siteId: 's1', runId: 'r1' }));
    const state = s.getState();
    expect(selectCompetitorRunById('r1')(state)?.status).toBe('partial');
    expect(selectCompetitorRuns(state)[0]!.status).toBe('partial');
    expect(selectCompetitorDetailLoading('r1')(state)).toBe(false);
  });

  it('stores a run detail even when it is not present in the runs list', async () => {
    const s = store();
    api.getCompetitorRun.mockResolvedValueOnce(detail({ runId: 'lonely' }));
    await s.dispatch(loadCompetitorRun({ siteId: 's1', runId: 'lonely' }));
    expect(selectCompetitorRunById('lonely')(s.getState())?.runId).toBe('lonely');
    expect(selectCompetitorRuns(s.getState())).toEqual([]);
  });

  it('cancels a run and clears the cancelling flag', async () => {
    const s = store();
    const promise = s.dispatch(cancelCompetitorRunThunk({ siteId: 's1', runId: 'r1' }));
    expect(selectCompetitorCancelling('r1')(s.getState())).toBe(true);
    await promise;
    expect(selectCompetitorCancelling('r1')(s.getState())).toBe(false);
  });

  it('appends and de-duplicates paged runs', async () => {
    const s = store();
    api.listCompetitorRuns.mockResolvedValueOnce({ items: [run({ runId: 'r1' })], nextCursor: 'c' });
    await s.dispatch(loadCompetitorRuns({ siteId: 's1' }));
    api.listCompetitorRuns.mockResolvedValueOnce({
      items: [run({ runId: 'r1' }), run({ runId: 'r2' })],
      nextCursor: null,
    });
    await s.dispatch(loadCompetitorRuns({ siteId: 's1', cursor: 'c', append: true }));
    expect(selectCompetitorRuns(s.getState()).map((r) => r.runId)).toEqual(['r1', 'r2']);
  });
});

describe('competitor content thunks — error paths', () => {
  it('normalizes API and generic errors on the rejected payload', async () => {
    const s = store();
    // Establish the site first so later loads do not rekey the branch.
    await s.dispatch(loadCompetitorRuns({ siteId: 's1' }));
    api.startCompetitorRun.mockRejectedValueOnce(new ApiError('conflict', 409, null));
    api.listCompetitorRuns.mockRejectedValueOnce(new ApiError('forbidden', 403, null));
    api.suggestCompetitors.mockRejectedValueOnce(new Error('offline'));

    const started = await s.dispatch(startCompetitorRunThunk({
      siteId: 's1',
      competitorIds: ['p1'],
      ownedUrl: 'https://example.com/p',
      pageLimit: 15,
      locale: 'en',
    }));
    const listed = await s.dispatch(loadCompetitorRuns({ siteId: 's1' }));
    const suggested = await s.dispatch(loadCompetitorSuggestions({ siteId: 's1' }));

    expect(started.meta.requestStatus).toBe('rejected');
    expect(started.payload).toMatchObject({ status: 409 });
    expect(listed.payload).toMatchObject({ status: 403 });
    // Generic (non-ApiError) → no status field.
    expect(suggested.payload).not.toHaveProperty('status');
    // The rejected state flags are set and the loaded/loading flags settle.
    const state = s.getState();
    expect(selectCompetitorListLoaded(state)).toBe(true);
    expect(selectCompetitorListLoading(state)).toBe(false);
    expect(selectCompetitorSuggestionsLoaded(state)).toBe(true);
  });

  it('surfaces add + mutate + detail rejections and clears the in-flight flags', async () => {
    const s = store();
    api.addCompetitor.mockRejectedValueOnce(new ApiError('addboom', 400, null));
    api.archiveCompetitor.mockRejectedValueOnce(new ApiError('mutboom', 500, null));
    api.getCompetitorRun.mockRejectedValueOnce(new ApiError('detailboom', 404, null));
    const added = await s.dispatch(addCompetitorThunk({ siteId: 's1', url: 'https://x', source: 'manual' }));
    const archived = await s.dispatch(archiveCompetitorThunk({ siteId: 's1', competitorId: 'p1' }));
    const detailed = await s.dispatch(loadCompetitorRun({ siteId: 's1', runId: 'r1' }));
    expect(added.meta.requestStatus).toBe('rejected');
    expect(archived.meta.requestStatus).toBe('rejected');
    expect(detailed.meta.requestStatus).toBe('rejected');
    const state = s.getState();
    expect(selectCompetitorAddingKey(state)).toBeNull();
    expect(selectCompetitorMutating('p1')(state)).toBe(false);
    expect(selectCompetitorDetailLoading('r1')(state)).toBe(false);
    // Error strings resolve through the shared error mapper (present in-suite).
    expect(selectCompetitorAddError(state)).not.toBeNull();
    expect(selectCompetitorMutateError(state)).not.toBeNull();
    expect(selectCompetitorDetailError('r1')(state)).not.toBeNull();
  });

  it('routes profile-load, restore, and cancel rejections through the catch blocks', async () => {
    const s = store();
    api.listCompetitors.mockRejectedValueOnce(new ApiError('p', 500, null));
    api.restoreCompetitor.mockRejectedValueOnce(new ApiError('r', 500, null));
    api.cancelCompetitorRun.mockRejectedValueOnce(new ApiError('c', 500, null));
    const loaded = await s.dispatch(loadCompetitorProfiles({ siteId: 's1' }));
    const restored = await s.dispatch(restoreCompetitorThunk({ siteId: 's1', competitorId: 'p1' }));
    const cancelled = await s.dispatch(cancelCompetitorRunThunk({ siteId: 's1', runId: 'r1' }));
    expect(loaded.meta.requestStatus).toBe('rejected');
    expect(restored.meta.requestStatus).toBe('rejected');
    expect(cancelled.meta.requestStatus).toBe('rejected');
    const state = s.getState();
    expect(selectCompetitorProfilesLoaded(state)).toBe(true);
    expect(selectCompetitorMutating('p1')(state)).toBe(false);
    expect(selectCompetitorCancelling('r1')(state)).toBe(false);
  });

  it('writes error strings from crafted rejected payloads', () => {
    const base = { contentIntelligence: { ...initialState, siteId: 's1' } };
    const withError = (type: string, arg: Record<string, unknown>, error: string) => ({
      contentIntelligence: contentIntelligenceReducer(base.contentIntelligence, {
        type,
        payload: { error },
        error: { message: 'x' },
        meta: { arg, requestId: 'x', requestStatus: 'rejected', aborted: false, condition: false },
      }),
    });
    expect(selectCompetitorProfilesError(withError(loadCompetitorProfiles.rejected.type, { siteId: 's1' }, 'profiles'))).toBe('profiles');
    expect(selectCompetitorSuggestionsError(withError(loadCompetitorSuggestions.rejected.type, { siteId: 's1' }, 'sugg'))).toBe('sugg');
    expect(selectCompetitorListError(withError(loadCompetitorRuns.rejected.type, { siteId: 's1' }, 'runs'))).toBe('runs');
    expect(selectCompetitorSubmitError(withError(startCompetitorRunThunk.rejected.type, { siteId: 's1' }, 'start'))).toBe('start');
    expect(selectCompetitorAddError(withError(addCompetitorThunk.rejected.type, { siteId: 's1', url: 'u' }, 'add'))).toBe('add');
    expect(selectCompetitorMutateError(withError(archiveCompetitorThunk.rejected.type, { siteId: 's1', competitorId: 'p1' }, 'arch'))).toBe('arch');
    expect(selectCompetitorDetailError('r1')(withError(loadCompetitorRun.rejected.type, { siteId: 's1', runId: 'r1' }, 'det'))).toBe('det');
  });
});

describe('competitor content reducers + edge branches', () => {
  it('resets the competitorContent branch on a site change', () => {
    let state = contentIntelligenceReducer(
      { ...initialState, siteId: 's1' },
      { type: loadCompetitorRuns.fulfilled.type, payload: { page: { items: [run()], nextCursor: null }, append: false, siteId: 's1' }, meta: { arg: { siteId: 's1' }, requestId: 'x', requestStatus: 'fulfilled' } },
    );
    expect(state.competitorContent.runs).toHaveLength(1);
    // A pending for a different site rekeys the whole slice.
    state = contentIntelligenceReducer(state, {
      type: loadCompetitorRuns.pending.type,
      payload: undefined,
      meta: { arg: { siteId: 's2' }, requestId: 'y', requestStatus: 'pending' },
    });
    expect(state.siteId).toBe('s2');
    expect(state.competitorContent.runs).toEqual([]);
    expect(state.competitorContent.listLoading).toBe(true);
  });

  it('ignores fulfilled payloads for a stale site', () => {
    const base = { ...initialState, siteId: 's2' };
    const fulfilled = contentIntelligenceReducer(base, {
      type: loadCompetitorRuns.fulfilled.type,
      payload: { page: { items: [run()], nextCursor: null }, append: false, siteId: 's1' },
      meta: { arg: { siteId: 's1' }, requestId: 'x', requestStatus: 'fulfilled' },
    });
    expect(fulfilled.competitorContent.runs).toEqual([]);

    const profilesStale = contentIntelligenceReducer(base, {
      type: loadCompetitorProfiles.fulfilled.type,
      payload: { profiles: [profile()], siteId: 's1' },
      meta: { arg: { siteId: 's1' }, requestId: 'x', requestStatus: 'fulfilled' },
    });
    expect(profilesStale.competitorContent.profiles).toEqual([]);

    const suggestionsStale = contentIntelligenceReducer(base, {
      type: loadCompetitorSuggestions.fulfilled.type,
      payload: { suggestions: [suggestion()], siteId: 's1' },
      meta: { arg: { siteId: 's1' }, requestId: 'x', requestStatus: 'fulfilled' },
    });
    expect(suggestionsStale.competitorContent.suggestions).toEqual([]);
  });

  it('ignores aborted rejections across every list + mutation thunk', () => {
    const abortedMeta = (siteId: string, extra: Record<string, unknown> = {}) => ({
      type: '',
      payload: undefined,
      error: { message: 'Aborted' },
      meta: { arg: { siteId, ...extra }, requestId: 'x', requestStatus: 'rejected', aborted: true, condition: false },
    });
    const cases = [
      { ...abortedMeta('s1'), type: loadCompetitorProfiles.rejected.type },
      { ...abortedMeta('s1'), type: loadCompetitorSuggestions.rejected.type },
      { ...abortedMeta('s1'), type: loadCompetitorRuns.rejected.type },
      { ...abortedMeta('s1'), type: startCompetitorRunThunk.rejected.type },
      { ...abortedMeta('s1', { competitorId: 'p1' }), type: archiveCompetitorThunk.rejected.type },
      { ...abortedMeta('s1', { competitorId: 'p1' }), type: restoreCompetitorThunk.rejected.type },
      { ...abortedMeta('s1', { url: 'https://x' }), type: addCompetitorThunk.rejected.type },
      { ...abortedMeta('s1', { runId: 'r1' }), type: loadCompetitorRun.rejected.type },
    ];
    let state: ContentIntelligenceState = { ...initialState, siteId: 's1' };
    for (const action of cases) {
      state = contentIntelligenceReducer(state, action);
    }
    expect(state.competitorContent.profilesError).toBe('');
    expect(state.competitorContent.suggestionsError).toBe('');
    expect(state.competitorContent.listError).toBe('');
    expect(state.competitorContent.submitError).toBe('');
    expect(state.competitorContent.addError).toBe('');
  });

  it('restores a profile via the restore rejected path clearing its flag', () => {
    const withFlag = {
      ...initialState,
      siteId: 's1',
      competitorContent: {
        ...initialState.competitorContent,
        mutatingId: { p1: true },
      },
    };
    const state = contentIntelligenceReducer(withFlag, {
      type: restoreCompetitorThunk.rejected.type,
      payload: { error: 'nope' },
      error: { message: 'x' },
      meta: { arg: { siteId: 's1', competitorId: 'p1' }, requestId: 'x', requestStatus: 'rejected', aborted: false, condition: false },
    });
    expect(state.competitorContent.mutatingId.p1).toBe(false);
    expect(state.competitorContent.mutateError).toBe('nope');
  });

  it('clears submit + add errors via the reducers', () => {
    const dirty = {
      ...initialState,
      competitorContent: {
        ...initialState.competitorContent,
        submitError: 'e',
        addError: 'a',
      },
    };
    const cleared = contentIntelligenceReducer(dirty, clearCompetitorSubmitError());
    expect(cleared.competitorContent.submitError).toBe('');
    const clearedAdd = contentIntelligenceReducer(cleared, clearCompetitorAddError());
    expect(clearedAdd.competitorContent.addError).toBe('');
  });

  it('falls back to defaults when the slice is absent', () => {
    expect(selectCompetitorProfiles({})).toEqual([]);
    expect(selectCompetitorRuns({})).toEqual([]);
    expect(selectCompetitorRunById(undefined)({})).toBeUndefined();
    expect(selectCompetitorRunById('x')({})).toBeUndefined();
    expect(selectCompetitorDetailLoading(null)({})).toBe(false);
    expect(selectCompetitorDetailLoading('x')({})).toBe(false);
    expect(selectCompetitorDetailError(undefined)({})).toBe('');
    expect(selectCompetitorDetailError('x')({})).toBe('');
    expect(selectCompetitorMutating('x')({})).toBe(false);
    expect(selectCompetitorCancelling('x')({})).toBe(false);
    expect(selectCompetitorSuggestionsLoading({})).toBe(false);
  });
});
