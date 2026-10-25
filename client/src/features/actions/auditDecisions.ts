import type { ActionState } from './types';

/**
 * States that close an action: the user dismissed it (false positive) or
 * marked it fixed. Neither belongs in an open worklist or an open count.
 */
export const RESOLVED_ACTION_STATES = ['dismissed', 'completed'] as const;
export type ResolvedActionState = (typeof RESOLVED_ACTION_STATES)[number];

export function isResolvedActionState(state: ActionState): state is ResolvedActionState {
  return (RESOLVED_ACTION_STATES as readonly ActionState[]).includes(state);
}

export type ResolvedBucketTally = Record<ResolvedActionState, number>;

export interface ResolvedAuditTally {
  fixNow: ResolvedBucketTally;
  watch: ResolvedBucketTally;
}

interface BucketedFinding {
  ruleId: string;
  bucket: string;
}

/**
 * Count the report's Fix now / Watch findings the user already resolved.
 * Passed and not-evaluated findings carry no decision and are ignored.
 */
export function tallyResolvedAuditFindings(
  findings: readonly BucketedFinding[],
  decisions: Readonly<Record<string, ActionState>>,
): ResolvedAuditTally {
  const tally: ResolvedAuditTally = {
    fixNow: { dismissed: 0, completed: 0 },
    watch: { dismissed: 0, completed: 0 },
  };
  for (const finding of findings) {
    const decision = decisions[finding.ruleId];
    if (decision === undefined || !isResolvedActionState(decision)) continue;
    if (finding.bucket === 'fix-now') tally.fixNow[decision] += 1;
    else if (finding.bucket === 'watch') tally.watch[decision] += 1;
  }
  return tally;
}

/**
 * A bucket total from the frozen report minus the findings already resolved.
 * A missing total stays missing (`null`) so callers keep their placeholder.
 */
export function openFindingCount(total: number, resolved: ResolvedBucketTally): number;
export function openFindingCount(
  total: number | null | undefined,
  resolved: ResolvedBucketTally,
): number | null;
export function openFindingCount(
  total: number | null | undefined,
  resolved: ResolvedBucketTally,
): number | null {
  if (typeof total !== 'number') return null;
  return Math.max(0, total - resolved.dismissed - resolved.completed);
}

/** Both buckets' resolved findings, for the "not counted" note. */
export function resolvedTotals(tally: ResolvedAuditTally): ResolvedBucketTally {
  return {
    dismissed: tally.fixNow.dismissed + tally.watch.dismissed,
    completed: tally.fixNow.completed + tally.watch.completed,
  };
}
