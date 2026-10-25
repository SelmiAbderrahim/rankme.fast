import { classifyKeywordRankState, type KeywordRankStateResult } from './rank-state.js';

export type RankMovementKind = 'improved' | 'declined' | 'unchanged' | 'entered' | 'dropped' | 'unranked' | 'new';
export interface RankMovement { kind: RankMovementKind; amount: number | null }

export function movementFromRankState(result: KeywordRankStateResult): RankMovement {
  switch (result.comparison) {
    case 'improved': case 'declined': return { kind: result.comparison, amount: result.change };
    case 'unchanged': return { kind: 'unchanged', amount: 0 };
    case 'new': return { kind: 'entered', amount: null };
    case 'lost': return { kind: 'dropped', amount: null };
    case 'not_in_top_100': return { kind: result.baselineCheckedAt === null ? 'new' : 'unranked', amount: null };
    default: return { kind: 'new', amount: null };
  }
}

export function classifyRankMovement(previous: { position: number | null } | null | undefined,
  latest: { position: number | null } | null | undefined): RankMovement {
  if (!previous || !latest) return { kind: 'new', amount: null };
  return movementFromRankState(classifyKeywordRankState({ lastFailedCheckAt: null }, [
    { position: latest.position, checkedAt: new Date(1) },
    { position: previous.position, checkedAt: new Date(0) },
  ]));
}

export type RankMovementBucket = 'improved' | 'declined' | 'unchanged' | 'failed' | 'unranked' | 'noPair';
export interface RankMovementTally { compared: number; improved: number; declined: number;
  unchanged: number; failed: number; unranked: number; noPair: number }
export const emptyRankMovementTally = (): RankMovementTally => ({ compared: 0, improved: 0, declined: 0,
  unchanged: 0, failed: 0, unranked: 0, noPair: 0 });

export function rankMovementBucket(result: KeywordRankStateResult): RankMovementBucket {
  if (result.state === 'failed_last_check') return 'failed';
  if (result.baselineCheckedAt === null) return 'noPair';
  const movement = movementFromRankState(result).kind;
  if (movement === 'improved' || movement === 'entered') return 'improved';
  if (movement === 'declined' || movement === 'dropped') return 'declined';
  if (movement === 'unchanged') return 'unchanged';
  return 'unranked';
}

export function addToRankMovementTally(tally: RankMovementTally, bucket: RankMovementBucket): void {
  tally[bucket] += 1;
  if (bucket === 'improved' || bucket === 'declined' || bucket === 'unchanged') tally.compared += 1;
}
export function tallyRankMovement(results: Iterable<KeywordRankStateResult>): RankMovementTally {
  const tally = emptyRankMovementTally();
  for (const result of results) addToRankMovementTally(tally, rankMovementBucket(result));
  return tally;
}
