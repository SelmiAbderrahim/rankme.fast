import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  return { apiClient: vi.fn(), ApiError };
});

import { apiClient, ApiError } from '@shared/api/client';
import {
  isResolvedActionState,
  openFindingCount,
  resolvedTotals,
  tallyResolvedAuditFindings,
} from './auditDecisions';
import { actionsReducer, initialState } from './store/slice';
import { AUDIT_DECISIONS_LIMIT, loadActions, loadAuditDecisions } from './store/thunks';
import { selectAuditDecisionStates, selectOverviewActions } from './store/selectors';
import type { ActionItem, ListActionsResponse } from './types';

const mocked = vi.mocked(apiClient);

const makeItem = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: 'a1',
  siteId: 's1',
  sourceType: 'audit_finding',
  sourceId: 'missing-title',
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

const response = (items: ActionItem[]): ListActionsResponse => ({
  items,
  sourceStatus: { audit_finding: { status: 'available' } },
  nextCursor: null,
});

beforeEach(() => mocked.mockReset());

describe('audit decision helpers', () => {
  it('treats only dismissed and completed as resolved', () => {
    expect(isResolvedActionState('dismissed')).toBe(true);
    expect(isResolvedActionState('completed')).toBe(true);
    expect(isResolvedActionState('open')).toBe(false);
    expect(isResolvedActionState('planned')).toBe(false);
  });

  it('tallies resolved Fix now and Watch findings and ignores everything else', () => {
    const tally = tallyResolvedAuditFindings(
      [
        { ruleId: 'a', bucket: 'fix-now' },
        { ruleId: 'b', bucket: 'fix-now' },
        { ruleId: 'c', bucket: 'watch' },
        { ruleId: 'd', bucket: 'watch' },
        { ruleId: 'e', bucket: 'passed' },
        { ruleId: 'f', bucket: 'not-evaluated' },
        { ruleId: 'g', bucket: 'watch' },
      ],
      {
        a: 'dismissed',
        b: 'planned',
        c: 'completed',
        d: 'dismissed',
        e: 'dismissed',
        f: 'completed',
      },
    );
    expect(tally).toEqual({
      fixNow: { dismissed: 1, completed: 0 },
      watch: { dismissed: 1, completed: 1 },
    });
    expect(resolvedTotals(tally)).toEqual({ dismissed: 2, completed: 1 });
  });

  it('subtracts resolved findings from a bucket total without going negative', () => {
    expect(openFindingCount(18, { dismissed: 0, completed: 3 })).toBe(15);
    expect(openFindingCount(1, { dismissed: 2, completed: 0 })).toBe(0);
    expect(openFindingCount(null, { dismissed: 1, completed: 0 })).toBeNull();
    expect(openFindingCount(undefined, { dismissed: 0, completed: 0 })).toBeNull();
  });
});

describe('loadAuditDecisions', () => {
  it('reads only resolved audit findings and keys them by rule', async () => {
    const store = configureStore({ reducer: { actions: actionsReducer } });
    mocked.mockResolvedValueOnce(
      response([
        makeItem({ sourceId: 'broken-links', state: 'dismissed' }),
        makeItem({ id: 'a2', sourceId: 'thin-content', state: 'completed' }),
      ]) as never,
    );
    const result = await store.dispatch(loadAuditDecisions({ siteId: 's1' }));
    expect(result.type).toBe('actions/loadAuditDecisions/fulfilled');
    const [path] = mocked.mock.calls[0]!;
    const query = new URLSearchParams(String(path).split('?')[1]);
    expect(query.getAll('source')).toEqual(['audit_finding']);
    expect(query.getAll('state')).toEqual(['dismissed', 'completed']);
    expect(query.get('limit')).toBe(String(AUDIT_DECISIONS_LIMIT));
    expect(store.getState().actions.auditDecisions).toEqual({
      siteId: 's1',
      status: 'ready',
      byRuleId: { 'broken-links': 'dismissed', 'thin-content': 'completed' },
    });
  });

  it('records an error status on a failed read', async () => {
    const store = configureStore({ reducer: { actions: actionsReducer } });
    mocked.mockRejectedValueOnce(new ApiError('nope', 500, {}));
    const result = await store.dispatch(loadAuditDecisions({ siteId: 's1' }));
    expect(result.type).toBe('actions/loadAuditDecisions/rejected');
    expect(store.getState().actions.auditDecisions.status).toBe('error');
  });
});

describe('actions slice — audit decisions lifecycle', () => {
  const pending = (siteId: string) =>
    loadAuditDecisions.pending('r', { siteId });

  it('keeps known decisions while refreshing the same site and drops them for a new one', () => {
    const ready = {
      ...initialState,
      auditDecisions: {
        siteId: 's1',
        status: 'ready' as const,
        byRuleId: { a: 'dismissed' as const },
      },
    };
    expect(actionsReducer(ready, pending('s1')).auditDecisions).toEqual({
      siteId: 's1',
      status: 'loading',
      byRuleId: { a: 'dismissed' },
    });
    expect(actionsReducer(ready, pending('s2')).auditDecisions).toEqual({
      siteId: 's2',
      status: 'loading',
      byRuleId: {},
    });
  });

  it('ignores rows from other sources and results for a superseded site', () => {
    let s = actionsReducer(initialState, pending('s1'));
    s = actionsReducer(
      s,
      loadAuditDecisions.fulfilled(
        {
          siteId: 's1',
          items: [
            makeItem({ sourceId: 'rule-a', state: 'dismissed' }),
            makeItem({ sourceType: 'gsc_decline', sourceId: 'q', state: 'dismissed' }),
          ],
        },
        'r',
        { siteId: 's1' },
      ),
    );
    expect(s.auditDecisions.byRuleId).toEqual({ 'rule-a': 'dismissed' });

    const moved = actionsReducer(s, pending('s2'));
    const stale = actionsReducer(
      moved,
      loadAuditDecisions.fulfilled(
        { siteId: 's1', items: [makeItem({ sourceId: 'rule-b', state: 'completed' })] },
        'r',
        { siteId: 's1' },
      ),
    );
    expect(stale.auditDecisions).toEqual(moved.auditDecisions);
  });

  it('ignores aborted and superseded rejections', () => {
    const loading = actionsReducer(initialState, pending('s1'));
    const aborted = actionsReducer(loading, {
      type: loadAuditDecisions.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: {
        arg: { siteId: 's1' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
        rejectedWithValue: false,
      },
    } as never);
    expect(aborted.auditDecisions.status).toBe('loading');
    const superseded = actionsReducer(
      loading,
      loadAuditDecisions.rejected(null, 'r', { siteId: 's0' }),
    );
    expect(superseded.auditDecisions.status).toBe('loading');
  });

  it('survives a list read that rekeys the slice to the same site', () => {
    let s = actionsReducer(initialState, pending('s1'));
    s = actionsReducer(
      s,
      loadAuditDecisions.fulfilled(
        { siteId: 's1', items: [makeItem({ sourceId: 'rule-a', state: 'dismissed' })] },
        'r',
        { siteId: 's1' },
      ),
    );
    s = actionsReducer(s, loadActions.pending('l', { siteId: 's1', requestSeq: 1 }));
    expect(s.siteId).toBe('s1');
    expect(s.auditDecisions.byRuleId).toEqual({ 'rule-a': 'dismissed' });
  });
});

describe('audit decision selectors', () => {
  it('overlays list rows on the resolved-decisions read for the same site', () => {
    const state = {
      actions: {
        ...initialState,
        siteId: 's1',
        items: [
          makeItem({ sourceId: 'reopened', state: 'open' }),
          makeItem({ sourceId: 'fresh-dismissal', state: 'dismissed' }),
          makeItem({ sourceType: 'gsc_decline', sourceId: 'query', state: 'dismissed' }),
        ],
        auditDecisions: {
          siteId: 's1',
          status: 'ready' as const,
          byRuleId: { reopened: 'dismissed' as const, older: 'completed' as const },
        },
      },
    };
    expect(selectAuditDecisionStates(state, 's1')).toEqual({
      reopened: 'open',
      older: 'completed',
      'fresh-dismissal': 'dismissed',
    });
  });

  it('never borrows decisions or rows that belong to another site', () => {
    const state = {
      actions: {
        ...initialState,
        siteId: 's2',
        items: [makeItem({ sourceId: 'other-site', state: 'dismissed' })],
        auditDecisions: {
          siteId: 's3',
          status: 'ready' as const,
          byRuleId: { elsewhere: 'dismissed' as const },
        },
      },
    };
    expect(selectAuditDecisionStates(state, 's1')).toEqual({});
    expect(selectAuditDecisionStates({} as never, 's1')).toEqual({});
  });

  it('keeps only open and planned rows for the overview, capped at five', () => {
    const items = [
      makeItem({ id: 'd', state: 'dismissed' }),
      makeItem({ id: 'c', state: 'completed' }),
      ...['1', '2', '3', '4', '5', '6'].map((id) =>
        makeItem({ id, state: id === '2' ? 'planned' : 'open' }),
      ),
    ];
    const overview = selectOverviewActions({ actions: { ...initialState, items } });
    expect(overview.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});
