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
