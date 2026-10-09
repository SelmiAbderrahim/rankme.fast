import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    code: string;
    constructor(message: string, status: number, data: unknown, code = 'http') {
      super(message);
      this.status = status;
      this.data = data;
      this.code = code;
    }
  }
  return {
    apiClient: vi.fn(),
    ApiError,
  };
});

vi.mock('i18next', () => ({
  default: { t: (k: string) => `[t:${k}]` },
}));

import { apiClient, ApiError } from '@shared/api/client';
import { actionsReducer, initialState } from './slice';
import {
  loadActionHistory,
  loadActions,
  submitActionState,
  submitRetestAction,
} from './thunks';
import {
  selectActionConflict,
  selectActionError,
  selectActionHistory,
  selectActionPending,
  selectActions,
  selectActionsListError,
  selectActionsListStatus,
  selectActionsNextCursor,
  selectActionsSiteId,
  selectAllSourcesUnavailable,
  selectAnyPartialSource,
  selectAuditActionByRuleId,
  selectLastRetestRunId,
  selectOverviewActions,
  selectSourceStatus,
} from './selectors';
import type { ActionItem, ListActionsResponse } from '../types';

const mocked = vi.mocked(apiClient);

const makeItem = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: 'a1',
  siteId: 's1',
  sourceType: 'audit_finding',
  sourceId: 'run1:missing-title',
  sourceLink: '/sites/s1/report',
  problem: 'p',
  whyItMatters: 'w',
  nextStep: 'n',
  affectedUrls: [],
  evidence: [],
  severity: 'critical',
  firstPartyImpact: 'high',
  confidence: 'high',
  effort: 'low',
  state: 'open',
  version: 0,
  reappearedAfterFix: false,
  observedAt: '2026-01-01T00:00:00Z',
  lastVerifiedAt: null,
  retest: { available: true },
  ...overrides,
  copy: overrides.copy ?? {
    problem: { messageKey: 'auditRules.missing-title.title' },
    whyItMatters: { messageKey: 'auditRules.missing-title.why' },
    nextStep: { messageKey: 'auditRules.missing-title.fix' },
  },
});

function makeStore() {
  return configureStore({ reducer: { actions: actionsReducer } });
}

beforeEach(() => mocked.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('actions thunks', () => {
  it('loadActions success dispatches fulfilled with server payload', async () => {
    const store = makeStore();
    const response: ListActionsResponse = {
      items: [makeItem()],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    };
    mocked.mockResolvedValueOnce(response as never);
    const result = await store.dispatch(
      loadActions({ siteId: 's1', requestSeq: 1 }),
    );
    expect(result.type).toBe('actions/loadActions/fulfilled');
    expect(selectActions(store.getState()).length).toBe(1);
    expect(selectActionsSiteId(store.getState())).toBe('s1');
  });

  it('loadActions maps ApiError into RejectPayload with all status flags', async () => {
    const store = makeStore();
    const err = new ApiError('over cap', 402, {
      error: { message: 'over cap' },
    });
    mocked.mockRejectedValueOnce(err);
    const result = await store.dispatch(
      loadActions({ siteId: 's', requestSeq: 1 }),
    );
    expect(result.type).toBe('actions/loadActions/rejected');
    const state = store.getState();
    expect(selectActionsListStatus(state)).toBe('error');
    expect(selectActionsListError(state).overCap).toBe(true);
  });

  it('preserves stable server error codes and message keys', async () => {
    const store = makeStore();
    mocked.mockRejectedValueOnce(
      new ApiError('localized', 422, {
        error: {
          message: 'Localized sentence',
          code: 'ACTIONS_INVALID_FILTER',
          messageKey: 'actions.errors.invalidFilter',
        },
      }),
    );

    const result = await store.dispatch(loadActions({ siteId: 's', requestSeq: 1 }));

    expect(result.payload).toMatchObject({
      code: 'ACTIONS_INVALID_FILTER',
      messageKey: 'actions.errors.invalidFilter',
    });
  });

  it('loadActions with 409/404/401 sets conflict/notFound/unauthorized on the reject payload', async () => {
    for (const status of [409, 404, 401] as const) {
      const store = makeStore();
      mocked.mockRejectedValueOnce(new ApiError('req failed', status, {}));
      const result = await store.dispatch(
        loadActions({ siteId: 's', requestSeq: 1 }),
      );
      const rejected = result as unknown as {
        payload?: { conflict?: boolean; notFound?: boolean; unauthorized?: boolean };
      };
      expect(rejected.payload).toBeDefined();
      if (status === 409) expect(rejected.payload!.conflict).toBe(true);
      if (status === 404) expect(rejected.payload!.notFound).toBe(true);
      if (status === 401) expect(rejected.payload!.unauthorized).toBe(true);
    }
  });

  it('loadActions with non-ApiError falls back to fallback key', async () => {
    const store = makeStore();
    mocked.mockRejectedValueOnce(new Error('nope'));
    await store.dispatch(loadActions({ siteId: 's', requestSeq: 1 }));
    expect(selectActionsListError(store.getState()).message).toBe(
      '[t:actions:errors.loadFailed]',
    );
  });

  it('loadActions forwards filters/limit/cursor untouched to api layer', async () => {
    const store = makeStore();
    mocked.mockResolvedValueOnce({
      items: [],
      sourceStatus: {},
      nextCursor: null,
    } as never);
    await store.dispatch(
      loadActions({
        siteId: 's',
        filters: { state: ['open'] },
        limit: 10,
        cursor: 'c',
        requestSeq: 1,
      }),
    );
    const [path] = mocked.mock.calls[0]!;
    expect(path).toContain('state=open');
    expect(path).toContain('limit=10');
    expect(path).toContain('cursor=c');
  });

  it('loadActionHistory fulfilled path', async () => {
    const store = makeStore();
    mocked.mockResolvedValueOnce({
      entries: [
        {
          ordinal: 1,
          priorState: null,
          newState: 'planned',
          eventKind: 'plan',
          actorUserId: 'u',
          note: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    } as never);
    await store.dispatch(
      loadActionHistory({ siteId: 's', actionId: 'a1' }),
    );
    expect(selectActionHistory('a1')(store.getState())!.length).toBe(1);
  });

  it('loadActionHistory rejected sets error', async () => {
    const store = makeStore();
    mocked.mockRejectedValueOnce(new ApiError('req failed', 500, {}));
    await store.dispatch(
      loadActionHistory({ siteId: 's', actionId: 'a1' }),
    );
    expect(selectActionError('history', 'a1')(store.getState())).toBeTruthy();
  });

  it('submitActionState fulfilled updates row', async () => {
    const store = makeStore();
    mocked.mockResolvedValueOnce({
      items: [makeItem()],
      sourceStatus: {},
      nextCursor: null,
    } as never);
    await store.dispatch(loadActions({ siteId: 's1', requestSeq: 1 }));
    mocked.mockResolvedValueOnce({
      actionId: 'a1',
      state: 'dismissed',
      version: 1,
      replayed: false,
    } as never);
    await store.dispatch(
      submitActionState({
        siteId: 's1',
        actionId: 'a1',
        state: 'dismissed',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    expect(selectActions(store.getState())[0]!.state).toBe('dismissed');
  });

  it('submitActionState rejected 409 flips conflictIds', async () => {
    const store = makeStore();
    mocked.mockResolvedValueOnce({
      items: [makeItem()],
      sourceStatus: {},
      nextCursor: null,
    } as never);
    await store.dispatch(loadActions({ siteId: 's1', requestSeq: 1 }));
    mocked.mockRejectedValueOnce(
      new ApiError('conflict', 409, { error: { message: 'stale' } }),
    );
    await store.dispatch(
      submitActionState({
        siteId: 's1',
        actionId: 'a1',
        state: 'planned',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    expect(selectActionConflict('a1')(store.getState())).toBe(true);
    expect(selectActionError('state', 'a1')(store.getState())).toBe('stale');
  });

  it('submitRetestAction fulfilled records runId; rejected records error', async () => {
    const store = makeStore();
    mocked.mockResolvedValueOnce({
      actionId: 'a1',
      run: { runId: 'run-99', status: 'queued' },
    } as never);
    await store.dispatch(
      submitRetestAction({ siteId: 's1', actionId: 'a1' }),
    );
    expect(selectLastRetestRunId(store.getState())).toBe('run-99');

    mocked.mockRejectedValueOnce(new ApiError('req failed', 402, {}));
    await store.dispatch(
      submitRetestAction({ siteId: 's1', actionId: 'a1' }),
    );
    expect(selectActionError('retest', 'a1')(store.getState())).toBeTruthy();
  });
});

describe('actions selectors', () => {
  it('selectors return sensible defaults when state is missing (RootState fallback)', () => {
    const bare = {} as { actions?: unknown };
    expect(selectActionsSiteId(bare as never)).toBeNull();
    expect(selectActions(bare as never)).toEqual([]);
    expect(selectActionsNextCursor(bare as never)).toBeNull();
    expect(selectActionsListStatus(bare as never)).toBe('idle');
    expect(selectActionsListError(bare as never).message).toBe('');
    expect(selectSourceStatus(bare as never)).toEqual({});
    expect(selectAllSourcesUnavailable(bare as never)).toBe(false);
    expect(selectAnyPartialSource(bare as never)).toBe(false);
    expect(selectOverviewActions(bare as never)).toEqual([]);
    expect(selectActionHistory(null)(bare as never)).toBeUndefined();
    expect(selectActionHistory('any')(bare as never)).toBeUndefined();
    expect(selectActionPending('state', null)(bare as never)).toBe(false);
    expect(selectActionPending('state', 'x')(bare as never)).toBe(false);
    expect(selectActionError('retest', null)(bare as never)).toBe('');
    expect(selectActionError('retest', 'x')(bare as never)).toBe('');
    expect(selectActionConflict(null)(bare as never)).toBe(false);
    expect(selectActionConflict('x')(bare as never)).toBe(false);
    expect(selectLastRetestRunId(bare as never)).toBeNull();
    expect(selectAuditActionByRuleId('x')(bare as never)).toBeNull();
  });

  it('separates history pending and errors by explicit and active presentation locale', () => {
    const state = {
      actions: {
        ...initialState,
        presentationLocale: 'en' as const,
        pending: {
          ...initialState.pending,
          history: {
            'action-history:a1::en': true,
            'action-history:a1::ar': false,
          },
        },
        errors: {
          ...initialState.errors,
          history: {
            'action-history:a1::en': 'English error',
            'action-history:a1::ar': 'Arabic error',
          },
        },
      },
    };

    expect(selectActionPending('history', 'a1')(state as never)).toBe(true);
    expect(selectActionPending('history', 'a1', 'ar')(state as never)).toBe(false);
    expect(selectActionError('history', 'a1')(state as never)).toBe('English error');
    expect(selectActionError('history', 'a1', 'ar')(state as never)).toBe('Arabic error');
  });

  it('source-status derivations distinguish empty / all-unavailable / partial', () => {
    const state = {
      actions: {
        ...initialState,
        sourceStatus: {
          audit_finding: { status: 'unavailable' as const },
          gsc_decline: { status: 'unavailable' as const },
        },
      },
    };
    expect(selectAllSourcesUnavailable(state as never)).toBe(true);
    expect(selectAnyPartialSource(state as never)).toBe(true);

    const partial = {
      actions: {
        ...initialState,
        sourceStatus: {
          audit_finding: { status: 'available' as const },
          gsc_decline: { status: 'stale' as const },
        },
      },
    };
    expect(selectAllSourcesUnavailable(partial as never)).toBe(false);
    expect(selectAnyPartialSource(partial as never)).toBe(true);

    const healthy = {
      actions: {
        ...initialState,
        sourceStatus: {
          audit_finding: { status: 'available' as const },
        },
      },
    };
    expect(selectAllSourcesUnavailable(healthy as never)).toBe(false);
    expect(selectAnyPartialSource(healthy as never)).toBe(false);
  });

  it('selectOverviewActions returns at most 5 items in server order', () => {
    const items: ActionItem[] = Array.from({ length: 7 }, (_, i) =>
      makeItem({ id: `a${i}`, sourceId: `s${i}` }),
    );
    const state = { actions: { ...initialState, items } };
    const overview = selectOverviewActions(state as never);
    expect(overview.length).toBe(5);
    expect(overview[0]!.id).toBe('a0');
    expect(overview[4]!.id).toBe('a4');
    expect(selectOverviewActions(state as never)).toBe(overview);
  });

  it('selectAuditActionByRuleId matches audit rows on the bare ruleId', () => {
    const state = {
      actions: {
        ...initialState,
        items: [
          makeItem({
            id: 'a-audit',
            sourceId: 'missing-title',
            state: 'completed',
            reappearedAfterFix: true,
          }),
          makeItem({
            id: 'a-other',
            sourceType: 'gsc_decline',
            sourceId: 'missing-title',
          }),
        ],
      },
    };
    const match = selectAuditActionByRuleId('missing-title')(state as never);
    expect(match?.id).toBe('a-audit');
    expect(match?.reappearedAfterFix).toBe(true);
    const miss = selectAuditActionByRuleId('nope')(state as never);
    expect(miss).toBeNull();
  });
});

describe('loadActions — duplicate request guard', () => {
  const emptyList = { items: [], sourceStatus: {}, nextCursor: null };

  it('shares one request between identical concurrent loads from different surfaces', async () => {
    let resolve!: (value: unknown) => void;
    mocked.mockReturnValueOnce(new Promise((res) => { resolve = res; }) as never);
    const store = makeStore();
    const loads = [
      store.dispatch(loadActions({ siteId: 's1', limit: 5, requestSeq: 1 })),
      store.dispatch(loadActions({ siteId: 's1', limit: 5, requestSeq: 2 })),
      store.dispatch(loadActions({ siteId: 's1', limit: 5, requestSeq: 3 })),
    ];
    resolve({ items: [makeItem()], sourceStatus: {}, nextCursor: null });
    const results = await Promise.all(loads);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.type === 'actions/loadActions/fulfilled')).toBe(true);
    expect(selectActions(store.getState())).toHaveLength(1);
  });

  it('does not share requests that differ by site, filters, limit, or cursor', async () => {
    mocked.mockResolvedValue(emptyList as never);
    const store = makeStore();
    await Promise.all([
      store.dispatch(loadActions({ siteId: 's1', requestSeq: 1 })),
      store.dispatch(loadActions({ siteId: 's2', requestSeq: 2 })),
      store.dispatch(loadActions({ siteId: 's2', requestSeq: 3, limit: 5 })),
      store.dispatch(loadActions({ siteId: 's2', requestSeq: 4, filters: { source: ['audit_finding'] } })),
      store.dispatch(loadActions({ siteId: 's2', requestSeq: 5, cursor: 'c1' })),
    ]);
    expect(mocked).toHaveBeenCalledTimes(5);
  });

  it('does not share a request across presentation locales', async () => {
    mocked.mockResolvedValue(emptyList as never);
    const store = makeStore();
    await Promise.all([
      store.dispatch(loadActions({ siteId: 's1', requestSeq: 1, presentationLocale: 'en', presentationGeneration: 1 })),
      store.dispatch(loadActions({ siteId: 's1', requestSeq: 2, presentationLocale: 'de', presentationGeneration: 2 })),
    ]);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('refetches after the first request settled', async () => {
    mocked.mockResolvedValue(emptyList as never);
    const store = makeStore();
    await store.dispatch(loadActions({ siteId: 's1', requestSeq: 1 }));
    await store.dispatch(loadActions({ siteId: 's1', requestSeq: 2 }));
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('lets an aborted effect run redispatch onto the request still in flight', async () => {
    let resolve!: (value: unknown) => void;
    mocked.mockReturnValueOnce(new Promise((res) => { resolve = res; }) as never);
    const store = makeStore();
    const first = store.dispatch(loadActions({ siteId: 's1', requestSeq: 1 }));
    first.abort();
    const second = store.dispatch(loadActions({ siteId: 's1', requestSeq: 2 }));
    resolve({ items: [makeItem()], sourceStatus: {}, nextCursor: null });
    await Promise.all([first, second]);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(selectActionsListStatus(store.getState())).toBe('ready');
    expect(selectActions(store.getState())).toHaveLength(1);
  });

  it('never serves a read that started before a state change to a reload after it', async () => {
    let resolveStale!: (value: unknown) => void;
    mocked.mockReturnValueOnce(new Promise((res) => { resolveStale = res; }) as never);
    const store = makeStore();
    const stale = store.dispatch(loadActions({ siteId: 's1', requestSeq: 1 }));
    mocked.mockResolvedValueOnce({ id: 'a1', state: 'dismissed', version: 1, replayed: false } as never);
    await store.dispatch(
      submitActionState({ siteId: 's1', actionId: 'a1', state: 'dismissed', expectedVersion: 0, clientKey: 'k' }),
    );
    mocked.mockResolvedValueOnce({ items: [makeItem({ state: 'dismissed', version: 1 })], sourceStatus: {}, nextCursor: null } as never);
    await store.dispatch(loadActions({ siteId: 's1', requestSeq: 2 }));
    // 1 stale read + mutation + 1 post-mutation read (the stale one was not joined).
    expect(mocked).toHaveBeenCalledTimes(3);
    resolveStale(emptyList);
    await stale;
  });
});

