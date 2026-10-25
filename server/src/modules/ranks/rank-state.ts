/** One classification for every stored keyword rank display. */
export const RANK_STATE_TOP_DEPTH = 100;
export const KEYWORD_RANK_STATES = ['ranked', 'improved', 'declined', 'unchanged', 'new', 'lost',
  'not_in_top_100', 'failed_last_check', 'never_checked'] as const;
export type KeywordRankState = (typeof KEYWORD_RANK_STATES)[number];
export type KeywordComparisonState = Exclude<KeywordRankState, 'failed_last_check' | 'never_checked'>;
export type RankStateBaseline = 'previous_check' | 'best_ever';
export interface RankStateHistoryEntry { position: number | null; checkedAt: Date }
export interface KeywordRankStateResult {
  state: KeywordRankState;
  comparison: KeywordComparisonState | null;
  baseline: RankStateBaseline;
  position: number | null;
  baselinePosition: number | null;
  change: number | null;
  checkedAt: string | null;
  baselineCheckedAt: string | null;
  failedAt: string | null;
}

const topPosition = (position: number | null): number | null =>
  position !== null && position >= 1 && position <= RANK_STATE_TOP_DEPTH ? position : null;

function pickBaseline(earlier: readonly RankStateHistoryEntry[], baseline: RankStateBaseline): RankStateHistoryEntry | null {
  if (earlier.length === 0) return null;
  if (baseline === 'previous_check') return earlier[0]!;
  let best: RankStateHistoryEntry | null = null;
  for (const entry of earlier) {
    const position = topPosition(entry.position);
    if (position !== null && (best === null || position < topPosition(best.position)!)) best = entry;
  }
  return best ?? earlier[0]!;
}

export function classifyKeywordRankState(keyword: { lastFailedCheckAt: Date | null },
  history: readonly RankStateHistoryEntry[], baseline: RankStateBaseline = 'previous_check'): KeywordRankStateResult {
  const ordered = [...history].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
  const latest = ordered[0];
  const failedAt = keyword.lastFailedCheckAt;
  const failed = failedAt !== null && (!latest || failedAt > latest.checkedAt);
  if (!latest) return { state: failed ? 'failed_last_check' : 'never_checked', comparison: null,
    baseline, position: null, baselinePosition: null, change: null, checkedAt: null,
    baselineCheckedAt: null, failedAt: failedAt?.toISOString() ?? null };
  const position = topPosition(latest.position);
  const earlier = pickBaseline(ordered.slice(1), baseline);
  const before = earlier ? topPosition(earlier.position) : null;
  let comparison: KeywordComparisonState;
  let change: number | null = null;
  if (!earlier) comparison = position === null ? 'not_in_top_100' : 'ranked';
  else if (position === null) comparison = before === null ? 'not_in_top_100' : 'lost';
  else if (before === null) comparison = 'new';
  else if (position === before) { comparison = 'unchanged'; change = 0; }
  else if (position < before) { comparison = 'improved'; change = before - position; }
  else { comparison = 'declined'; change = position - before; }
  return { state: failed ? 'failed_last_check' : comparison, comparison, baseline, position,
    baselinePosition: before, change, checkedAt: latest.checkedAt.toISOString(),
    baselineCheckedAt: earlier?.checkedAt.toISOString() ?? null,
    failedAt: failedAt?.toISOString() ?? null };
}

export type KeywordRankStateCounts = Record<KeywordRankState, number>;
export function countKeywordRankStates(results: Iterable<Pick<KeywordRankStateResult, 'state'>>): KeywordRankStateCounts {
  const counts = Object.fromEntries(KEYWORD_RANK_STATES.map((state) => [state, 0])) as KeywordRankStateCounts;
  for (const result of results) counts[result.state] += 1;
  return counts;
}

export type KeywordCheckStatus = 'ok' | 'not_in_top_100' | 'failed' | 'never_checked';
export function keywordCheckStatus(result: Pick<KeywordRankStateResult, 'state'>): KeywordCheckStatus {
  if (result.state === 'failed_last_check') return 'failed';
  if (result.state === 'never_checked') return 'never_checked';
  return result.state === 'lost' || result.state === 'not_in_top_100' ? 'not_in_top_100' : 'ok';
}
