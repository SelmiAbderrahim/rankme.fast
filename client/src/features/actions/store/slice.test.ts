import { describe, expect, it } from 'vitest';
import {
  actionsReducer,
  applyMutatedAction,
  clearActionErrors,
  initialState,
  resetActions,
} from './slice';
import {
  loadActionHistory,
  loadActions,
  submitActionState,
  submitRetestAction,
} from './thunks';
import type { ActionItem } from '../types';

const makeItem = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: 'a1',
  siteId: 's1',
  sourceType: 'audit_finding',
  sourceId: 'run1:missing-title',
  sourceLink: '/sites/s1/report?bucket=fix-now',
  problem: 'p',
  whyItMatters: 'why',
  nextStep: 'do it',
  affectedUrls: ['https://x/'],
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

describe('actions slice reducers', () => {
  it('resetActions returns initial state', () => {
    const s = actionsReducer(
      { ...initialState, siteId: 'x', items: [makeItem()] },
      resetActions(),
    );
    expect(s).toEqual(initialState);
  });

  it('clearActionErrors drops per-action entries', () => {
    const seed = {
      ...initialState,
      errors: {
        state: { a1: 'err' },
        retest: { a1: 'boom' },
        history: {},
      },
      conflictIds: { a1: true },
    };
    const s = actionsReducer(seed, clearActionErrors('a1'));
    expect(s.errors.state.a1).toBeUndefined();
    expect(s.errors.retest.a1).toBeUndefined();
    expect(s.conflictIds.a1).toBeUndefined();
  });

  it('applyMutatedAction updates matching row and no-ops otherwise', () => {
    const seed = { ...initialState, items: [makeItem()] };
    const s = actionsReducer(
      seed,
      applyMutatedAction({ actionId: 'a1', state: 'planned', version: 4 }),
    );
    expect(s.items[0]!.state).toBe('planned');
    expect(s.items[0]!.version).toBe(4);
    const s2 = actionsReducer(
      seed,
      applyMutatedAction({ actionId: 'missing', state: 'completed', version: 9 }),
    );
    expect(s2.items[0]!.state).toBe('open');
  });
});

describe('actions slice — loadActions lifecycle', () => {
  it('pending on a new siteId rekeys, sets loading', () => {
    const s = actionsReducer(
      initialState,
      loadActions.pending('req1', {
        siteId: 's1',
        requestSeq: 1,
      }),
    );
    expect(s.siteId).toBe('s1');
    expect(s.listStatus).toBe('loading');
    expect(s.latestRequestSeq).toBe(1);
  });

  it('pending with existing items becomes refreshing', () => {
    const seed = {
      ...initialState,
      siteId: 's1',
      items: [makeItem()],
      listStatus: 'ready' as const,
    };
    const s = actionsReducer(
      seed,
      loadActions.pending('req2', { siteId: 's1', requestSeq: 2 }),
    );
    expect(s.listStatus).toBe('refreshing');
    expect(s.items.length).toBe(1);
  });

  it('fulfilled replaces items + sourceStatus + nextCursor', () => {
    const seed = actionsReducer(
      initialState,
      loadActions.pending('r', { siteId: 's1', requestSeq: 5 }),
    );
    const s = actionsReducer(
      seed,
      loadActions.fulfilled(
        {
          response: {
            items: [makeItem()],
            sourceStatus: { audit_finding: { status: 'available' } },
            nextCursor: 'next',
          },
          siteId: 's1',
          requestSeq: 5,
        },
        'r',
        { siteId: 's1', requestSeq: 5 },
      ),
    );
    expect(s.listStatus).toBe('ready');
    expect(s.items.length).toBe(1);
    expect(s.sourceStatus.audit_finding?.status).toBe('available');
    expect(s.nextCursor).toBe('next');
    expect(s.lastAppliedSeq).toBe(5);
  });

  it('fulfilled with stale requestSeq is dropped', () => {
    const seed = actionsReducer(
      initialState,
      loadActions.pending('r10', { siteId: 's1', requestSeq: 10 }),
    );
    const s = actionsReducer(
      seed,
      loadActions.fulfilled(
        {
          response: {
            items: [makeItem({ id: 'stale' })],
            sourceStatus: {},
            nextCursor: null,
          },
          siteId: 's1',
          requestSeq: 3,
        },
        'r3',
        { siteId: 's1', requestSeq: 3 },
      ),
    );
    expect(s.items.length).toBe(0);
    expect(s.listStatus).toBe('loading');
  });

  it('fulfilled for a different siteId (race across sites) is ignored', () => {
    const seed = actionsReducer(
      initialState,
      loadActions.pending('r', { siteId: 's1', requestSeq: 1 }),
    );
    const s = actionsReducer(
      seed,
      loadActions.fulfilled(
        {
          response: { items: [makeItem()], sourceStatus: {}, nextCursor: null },
          siteId: 'other',
          requestSeq: 1,
        },
        'r',
        { siteId: 'other', requestSeq: 1 },
      ),
    );
    expect(s.items.length).toBe(0);
  });

  it('rejected sets listError and status; ignores stale + aborted', () => {
    const seed = actionsReducer(
      initialState,
      loadActions.pending('r', { siteId: 's1', requestSeq: 4 }),
    );
    const s = actionsReducer(
      seed,
      loadActions.rejected(
        null,
        'r',
        { siteId: 's1', requestSeq: 4 },
        {
          error: 'nope',
          overCap: true,
          unauthorized: false,
          notFound: false,
        },
      ),
    );
    expect(s.listStatus).toBe('error');
    expect(s.listError.overCap).toBe(true);
    expect(s.listError.message).toBe('nope');

    // Stale rejected is a no-op.
    const s2 = actionsReducer(
      seed,
      loadActions.rejected(
        null,
        'r',
        { siteId: 's1', requestSeq: 2 },
        { error: 'stale', overCap: false },
      ),
    );
    expect(s2.listStatus).toBe('loading');

    // Aborted rejected is a no-op.
    const abortedAction = {
      type: loadActions.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: {
        arg: { siteId: 's1', requestSeq: 4 },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
        rejectedWithValue: false,
      },
    };
    const s3 = actionsReducer(seed, abortedAction as never);
    expect(s3.listStatus).toBe('loading');
  });

  it('rejected uses empty defaults when payload absent', () => {
    const seed = actionsReducer(
      initialState,
      loadActions.pending('r', { siteId: 's1', requestSeq: 1 }),
    );
    const s = actionsReducer(
      seed,
      loadActions.rejected(null, 'r', { siteId: 's1', requestSeq: 1 }),
    );
    expect(s.listError.message).toBe('');
    expect(s.listError.overCap).toBe(false);
  });
});

describe('actions slice — history lifecycle', () => {
  it('pending sets loading; fulfilled caches; rejected records error', () => {
    const seed = actionsReducer(
      initialState,
      loadActionHistory.pending('r', { siteId: 's', actionId: 'a1' }),
    );
    const key = `action-history:a1::${seed.presentationLocale}`;
    expect(seed.pending.history[key]).toBe(true);

    const done = actionsReducer(
      seed,
      loadActionHistory.fulfilled(
        {
          response: {
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
          },
          actionId: 'a1',
        },
        'r',
        { siteId: 's', actionId: 'a1' },
      ),
    );
    expect(done.pending.history[key]).toBe(false);
    expect(done.history[key]?.length).toBe(1);

    const errored = actionsReducer(
      seed,
      loadActionHistory.rejected(
        null,
        'r',
        { siteId: 's', actionId: 'a1' },
        { error: 'boom' },
      ),
    );
    expect(errored.pending.history[key]).toBe(false);
    expect(errored.errors.history[key]).toBe('boom');

    // Aborted rejected is a no-op — seed already has pending true.
    const abortedAction = {
      type: loadActionHistory.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: {
        arg: { siteId: 's', actionId: 'a1' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
        rejectedWithValue: false,
      },
    };
    const aborted = actionsReducer(seed, abortedAction as never);
    expect(aborted.pending.history[key]).toBe(true);
  });

  it('rejected without payload defaults to empty message', () => {
    const seed = actionsReducer(
      initialState,
      loadActionHistory.pending('r', { siteId: 's', actionId: 'a2' }),
    );
    const s = actionsReducer(
      seed,
      loadActionHistory.rejected(null, 'r', { siteId: 's', actionId: 'a2' }),
    );
    expect(s.errors.history[`action-history:a2::${s.presentationLocale}`]).toBe('');
  });
});

describe('actions slice — submitActionState lifecycle', () => {
  it('pending sets pending; fulfilled updates matching item + drops history cache', () => {
    const seed = {
      ...initialState,
      items: [makeItem()],
      history: { a1: [], other: [], 'action-history:a1::en': [] },
    };
    const pending = actionsReducer(
      seed,
      submitActionState.pending('r', {
        siteId: 's',
        actionId: 'a1',
        state: 'dismissed',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    expect(pending.pending.state.a1).toBe(true);

    const fulfilled = actionsReducer(
      pending,
      submitActionState.fulfilled(
        { actionId: 'a1', state: 'dismissed', version: 1, replayed: false },
        'r',
        {
          siteId: 's',
          actionId: 'a1',
          state: 'dismissed',
          expectedVersion: 0,
          clientKey: 'k',
        },
      ),
    );
    expect(fulfilled.pending.state.a1).toBe(false);
    expect(fulfilled.items[0]!.state).toBe('dismissed');
    expect(fulfilled.items[0]!.version).toBe(1);
    expect(fulfilled.history.a1).toBeUndefined();
    expect(fulfilled.history.other).toEqual([]);
    expect(fulfilled.history['action-history:a1::en']).toBeUndefined();
  });

  it('fulfilled is safe when the row is absent (server may have expired)', () => {
    const s = actionsReducer(
      { ...initialState, items: [] },
      submitActionState.fulfilled(
        { actionId: 'missing', state: 'planned', version: 1, replayed: false },
        'r',
        {
          siteId: 's',
          actionId: 'missing',
          state: 'planned',
          expectedVersion: 0,
          clientKey: 'k',
        },
      ),
    );
    expect(s.items).toEqual([]);
    expect(s.pending.state.missing).toBe(false);
  });

  it('rejected records conflict + error', () => {
    const seed = actionsReducer(
      { ...initialState, items: [makeItem()] },
      submitActionState.pending('r', {
        siteId: 's',
        actionId: 'a1',
        state: 'dismissed',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    const s = actionsReducer(
      seed,
      submitActionState.rejected(
        null,
        'r',
        {
          siteId: 's',
          actionId: 'a1',
          state: 'dismissed',
          expectedVersion: 0,
          clientKey: 'k',
        },
        { error: 'stale', conflict: true, status: 409 },
      ),
    );
    expect(s.errors.state.a1).toBe('stale');
    expect(s.conflictIds.a1).toBe(true);
    expect(s.pending.state.a1).toBe(false);
  });

  it('rejected without payload defaults to empty message + no conflict', () => {
    const seed = actionsReducer(
      { ...initialState, items: [makeItem()] },
      submitActionState.pending('r', {
        siteId: 's',
        actionId: 'a1',
        state: 'dismissed',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    const s = actionsReducer(
      seed,
      submitActionState.rejected(null, 'r', {
        siteId: 's',
        actionId: 'a1',
        state: 'dismissed',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    expect(s.errors.state.a1).toBe('');
    expect(s.conflictIds.a1).toBeUndefined();
  });

  it('ignores an aborted state mutation rejection', () => {
    const seed = actionsReducer(
      initialState,
      submitActionState.pending('r', {
        siteId: 's',
        actionId: 'a1',
        state: 'planned',
        expectedVersion: 0,
        clientKey: 'k',
      }),
    );
    const aborted = {
      type: submitActionState.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: {
        arg: {
          siteId: 's',
          actionId: 'a1',
          state: 'planned',
          expectedVersion: 0,
          clientKey: 'k',
        },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
        rejectedWithValue: false,
      },
    };

    expect(actionsReducer(seed, aborted as never).pending.state.a1).toBe(true);
  });
});

describe('actions slice — retest lifecycle', () => {
  it('pending sets pending; fulfilled records last runId; rejected records error', () => {
    const seed = actionsReducer(
      initialState,
      submitRetestAction.pending('r', { siteId: 's', actionId: 'a1' }),
    );
    expect(seed.pending.retest.a1).toBe(true);

    const done = actionsReducer(
      seed,
      submitRetestAction.fulfilled(
        {
          actionId: 'a1',
          run: { runId: 'r-42', status: 'queued' },
        },
        'r',
        { siteId: 's', actionId: 'a1' },
      ),
    );
    expect(done.pending.retest.a1).toBe(false);
    expect(done.lastRetestRunId).toBe('r-42');

    const err = actionsReducer(
      seed,
      submitRetestAction.rejected(
        null,
        'r',
        { siteId: 's', actionId: 'a1' },
        { error: 'over cap', overCap: true },
      ),
    );
    expect(err.errors.retest.a1).toBe('over cap');
  });

  it('rejected without payload defaults to empty message', () => {
    const seed = actionsReducer(
      initialState,
      submitRetestAction.pending('r', { siteId: 's', actionId: 'a1' }),
    );
    const s = actionsReducer(
      seed,
      submitRetestAction.rejected(null, 'r', { siteId: 's', actionId: 'a1' }),
    );
    expect(s.errors.retest.a1).toBe('');
  });

  it('ignores an aborted retest rejection', () => {
    const seed = actionsReducer(
      initialState,
      submitRetestAction.pending('r', { siteId: 's', actionId: 'a1' }),
    );
    const aborted = {
      type: submitRetestAction.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: {
        arg: { siteId: 's', actionId: 'a1' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
        rejectedWithValue: false,
      },
    };

    expect(actionsReducer(seed, aborted as never).pending.retest.a1).toBe(true);
  });
});
