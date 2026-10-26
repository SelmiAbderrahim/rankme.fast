import { describe, expect, it, vi } from 'vitest';
import { classifyKeywordRankState } from './rank-state.js';
import { readRankMovementForSite } from './rank-movement.service.js';

const reads = vi.hoisted(() => ({ states: vi.fn(), outcomes: vi.fn() }));
vi.mock('./rank-state.repo.js', () => ({
  RANK_STATE_READ_LIMIT: 100,
  readKeywordRankStates: reads.states,
}));
vi.mock('./rank-outcomes.repo.js', () => ({ readLatestOutcomes: reads.outcomes }));

describe('site rank movement summary', () => {
  it('uses the newest failed-at timestamp when a later check failed', async () => {
    const checkedAt = new Date('2026-10-24T12:00:00.000Z');
    const failedAt = new Date('2026-10-25T12:00:00.000Z');
    reads.states.mockResolvedValueOnce([{ keywordId: 'keyword-1',
      rankState: classifyKeywordRankState({ lastFailedCheckAt: failedAt },
        [{ position: 5, checkedAt }]) }]);
    reads.outcomes.mockResolvedValueOnce(new Map());
    const db = { select: () => ({ from: () => ({ where: () => ({
      limit: async () => [{ cadence: 'weekly' }],
    }) }) }) } as never;
    expect(await readRankMovementForSite(db, { accountId: 'owner', siteId: 'site' }))
      .toMatchObject({ tracked: 1, notCompared: { failed: 1 }, latestCheckedAt: failedAt });
  });

  it('counts compared, skipped, and unranked keywords while keeping the latest attempt time', async () => {
    const checkedAt = new Date('2026-10-24T12:00:00.000Z');
    const previousAt = new Date('2026-10-23T12:00:00.000Z');
    const rankState = (latest: number | null, previous?: number | null) =>
      classifyKeywordRankState({ lastFailedCheckAt: null }, [
        { position: latest, checkedAt },
        ...(previous === undefined ? [] : [{ position: previous, checkedAt: previousAt }]),
      ]);
    reads.states.mockResolvedValueOnce([
      { keywordId: 'skipped', rankState: rankState(null) },
      { keywordId: 'unranked', rankState: rankState(null, null) },
      { keywordId: 'new', rankState: rankState(5) },
      { keywordId: 'improved', rankState: rankState(3, 8) },
      { keywordId: 'declined', rankState: rankState(8, 3) },
      { keywordId: 'unchanged', rankState: rankState(3, 3) },
    ]);
    reads.outcomes.mockResolvedValueOnce(new Map([
      ['skipped', { status: 'skipped', at: '2026-10-25T12:00:00.000Z' }],
      ['unranked', { status: 'checked', at: '2026-10-22T12:00:00.000Z' }],
    ]));
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as never;
    expect(await readRankMovementForSite(db, { accountId: 'owner', siteId: 'site' })).toEqual({
      tracked: 6, compared: 3,
      notCompared: { failed: 0, skipped: 1, noPair: 1, unranked: 1 },
      improved: 1, declined: 1, unchanged: 1,
      latestCheckedAt: new Date('2026-10-25T12:00:00.000Z'), cadence: 'weekly',
    });
  });
});
