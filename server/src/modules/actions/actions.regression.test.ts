import { describe, expect, it } from 'vitest';
import type { ActionEventRow } from '../../db/schema/action-events.js';
import type { ActionEventsDb } from './actions.events.repo.js';
import { loadAuditDecisionStates } from './audit-decisions.js';
import { hashActionId } from './actions.identity.js';
import { AUDIT_REGRESSION_ACTOR, reconcileAuditRegressions } from './actions.regression.js';

const accountId = 'account';
const siteId = 'site';
const actionId = 'action';
const completed = {
  actionId, newState: 'completed', createdAt: new Date('2026-07-01T00:00:00.000Z'), ordinal: 4,
  actorUserId: 'user',
} as ActionEventRow;

function failedAppendDb(stored: ActionEventRow | null, failure: unknown): ActionEventsDb {
  let reads = 0;
  return {
    select: () => {
      reads += 1;
      const rows = reads === 1 ? [] : stored ? [stored] : [];
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
      };
      return query;
    },
    transaction: async () => { throw failure; },
  } as unknown as ActionEventsDb;
}

describe('audit regression recovery', () => {
  it('uses a concurrently stored open event after append fails', async () => {
    const stored = { ...completed, newState: 'open', ordinal: 5 } as ActionEventRow;
    const reopened = await reconcileAuditRegressions(failedAppendDb(stored, new Error('write conflict')), {
      accountId, siteId,
      evidence: [{ actionId, ruleId: 'title-missing', latest: completed, observedAt: '2026-07-02T00:00:00.000Z', runId: 'run' }],
    });
    expect(reopened.get(actionId)).toBe(stored);
  });

  it.each([
    { stored: null, latest: completed, expectedOrdinal: 5, failure: new Error('database down') },
    { stored: completed, latest: completed, expectedOrdinal: 5, failure: 'database down' },
    { stored: null, latest: { ...completed, actionId: 'legacy' } as ActionEventRow, expectedOrdinal: 1, failure: new Error('database down') },
  ])('returns a synthetic reopen when no usable event is stored', async ({ stored, latest, expectedOrdinal, failure }) => {
    const reopened = await reconcileAuditRegressions(failedAppendDb(stored, failure), {
      accountId, siteId,
      evidence: [{ actionId, ruleId: 'title-missing', latest, observedAt: '2026-07-02T00:00:00.000Z', runId: 'run' }],
    });
    expect(reopened.get(actionId)).toMatchObject({
      actionId, priorState: 'completed', newState: 'open', eventKind: 'reopen',
      actorUserId: AUDIT_REGRESSION_ACTOR, ordinal: expectedOrdinal,
    });
  });

  it('returns only the latest states for matching rule identities', async () => {
    const id = hashActionId({ accountId, siteId, sourceType: 'audit_finding', sourceId: 'title-missing' });
    const event = { ...completed, actionId: id, newState: 'dismissed' } as ActionEventRow;
    const db = {
      select: () => {
        const query = { from: () => query, where: () => query, orderBy: async () => [event] };
        return query;
      },
    } as unknown as ActionEventsDb;
    expect([...await loadAuditDecisionStates(db, {
      accountId, siteId, runId: 'run', ruleIds: ['title-missing', 'unseen'],
    })]).toEqual([['title-missing', 'dismissed']]);
  });
});
