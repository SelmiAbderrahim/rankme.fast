import { describe, expect, it } from 'vitest';
import { classifyKeywordRankState, countKeywordRankStates, keywordCheckStatus } from './rank-state.js';

const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);

describe('keyword rank state', () => {
  it('separates a failed latest attempt from a completed check outside the top 100', () => {
    const failed = classifyKeywordRankState({ lastFailedCheckAt: at(3) },
      [{ position: null, checkedAt: at(2) }, { position: 8, checkedAt: at(1) }]);
    expect(failed).toMatchObject({ state: 'failed_last_check', comparison: 'lost',
      position: null, baselinePosition: 8 });
    expect(keywordCheckStatus(failed)).toBe('failed');
    expect(keywordCheckStatus(classifyKeywordRankState({ lastFailedCheckAt: null },
      [{ position: null, checkedAt: at(2) }]))).toBe('not_in_top_100');
  });

  it('uses the requested baseline and treats positions beyond depth as unranked', () => {
    const history = [{ position: 4, checkedAt: at(3) }, { position: 9, checkedAt: at(2) },
      { position: 2, checkedAt: at(1) }];
    expect(classifyKeywordRankState({ lastFailedCheckAt: null }, history))
      .toMatchObject({ state: 'improved', change: 5, baselinePosition: 9 });
    expect(classifyKeywordRankState({ lastFailedCheckAt: null }, history, 'best_ever'))
      .toMatchObject({ state: 'declined', change: 2, baselinePosition: 2 });
    expect(classifyKeywordRankState({ lastFailedCheckAt: null },
      [{ position: 101, checkedAt: at(3) }, { position: 8, checkedAt: at(2) }]))
      .toMatchObject({ state: 'lost', position: null });
  });

  it('counts every state through one fixed vocabulary', () => {
    const counts = countKeywordRankStates([{ state: 'never_checked' }, { state: 'failed_last_check' }]);
    expect(counts.never_checked).toBe(1);
    expect(counts.failed_last_check).toBe(1);
    expect(counts.improved).toBe(0);
  });
});
