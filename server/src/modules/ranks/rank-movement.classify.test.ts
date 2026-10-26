import { describe, expect, it } from 'vitest';
import {
  addToRankMovementTally, classifyRankMovement, emptyRankMovementTally,
  movementFromRankState, rankMovementBucket, tallyRankMovement,
} from './rank-movement.classify.js';
import { classifyKeywordRankState } from './rank-state.js';

const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);
const state = (latest: number | null, previous?: number | null, failed = false) =>
  classifyKeywordRankState({ lastFailedCheckAt: failed ? at(3) : null }, [
    { position: latest, checkedAt: at(2) },
    ...(previous === undefined ? [] : [{ position: previous, checkedAt: at(1) }]),
  ]);

describe('rank movement classification', () => {
  it('maps every comparison into a movement', () => {
    expect(movementFromRankState(state(3, 8))).toEqual({ kind: 'improved', amount: 5 });
    expect(movementFromRankState(state(8, 3))).toEqual({ kind: 'declined', amount: 5 });
    expect(movementFromRankState(state(3, 3))).toEqual({ kind: 'unchanged', amount: 0 });
    expect(movementFromRankState(state(3, null))).toEqual({ kind: 'entered', amount: null });
    expect(movementFromRankState(state(null, 3))).toEqual({ kind: 'dropped', amount: null });
    expect(movementFromRankState(state(null, null))).toEqual({ kind: 'unranked', amount: null });
    expect(movementFromRankState(state(null))).toEqual({ kind: 'new', amount: null });
    expect(movementFromRankState(classifyKeywordRankState({ lastFailedCheckAt: null }, [])))
      .toEqual({ kind: 'new', amount: null });
  });

  it('classifies missing snapshots and every movement bucket', () => {
    expect(classifyRankMovement(null, { position: 4 })).toEqual({ kind: 'new', amount: null });
    expect(classifyRankMovement({ position: 3 }, undefined)).toEqual({ kind: 'new', amount: null });
    expect(classifyRankMovement({ position: 7 }, { position: 3 })).toEqual({ kind: 'improved', amount: 4 });
    expect(rankMovementBucket(state(3, 8))).toBe('improved');
    expect(rankMovementBucket(state(3, null))).toBe('improved');
    expect(rankMovementBucket(state(8, 3))).toBe('declined');
    expect(rankMovementBucket(state(null, 3))).toBe('declined');
    expect(rankMovementBucket(state(3, 3))).toBe('unchanged');
    expect(rankMovementBucket(state(null, null))).toBe('unranked');
    expect(rankMovementBucket(state(3))).toBe('noPair');
    expect(rankMovementBucket(state(3, 8, true))).toBe('failed');
  });

  it('tallies comparable and noncomparable states', () => {
    const results = [state(3, 8), state(3, null), state(8, 3), state(null, 3),
      state(3, 3), state(null, null), state(3), state(3, 8, true)];
    expect(tallyRankMovement(results)).toEqual({
      compared: 5, improved: 2, declined: 2, unchanged: 1,
      failed: 1, unranked: 1, noPair: 1,
    });
    const tally = emptyRankMovementTally();
    addToRankMovementTally(tally, 'unranked');
    expect(tally.compared).toBe(0);
  });
});
