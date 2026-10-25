import { isResolvedActionState, type ActionState } from '@features/actions';
import type { LocalizedFinding } from './types';

/**
 * The decision a report shows for one finding. The server
 * applies the site's decisions to every report, latest or pinned; a decision
 * the user takes on this page (the actions list) wins until the report is
 * read again.
 */
export function effectiveDecisionState(
  finding: Pick<LocalizedFinding, 'decision'>,
  live: ActionState | undefined,
): ActionState | undefined {
  return live ?? finding.decision?.state;
}

/**
 * Whether the finding is left out of its tab and its count: dismissed or
 * fixed — unless a later audit resurfaced the same dismissal.
 */
export function isFindingUncounted(
  finding: Pick<LocalizedFinding, 'decision' | 'bucket'>,
  live: ActionState | undefined,
): boolean {
  if (finding.bucket !== 'fix-now' && finding.bucket !== 'watch') return false;
  const state = effectiveDecisionState(finding, live);
  if (state === undefined || !isResolvedActionState(state)) return false;
  const resurfaced = state === 'dismissed' && finding.decision?.state === 'dismissed' && finding.decision.resurfaced !== null;
  return !resurfaced;
}

/**
 * Decision states keyed by rule for the findings that leave the counts —
 * the shape the shared resolved-finding tally reads.
 */
export function uncountedDecisions(
  findings: readonly LocalizedFinding[],
  live: Readonly<Record<string, ActionState>>,
): Record<string, ActionState> {
  const out: Record<string, ActionState> = {};
  for (const finding of findings) {
    const state = effectiveDecisionState(finding, live[finding.ruleId]);
    if (state !== undefined && isFindingUncounted(finding, live[finding.ruleId])) out[finding.ruleId] = state;
  }
  return out;
}

/**
 * True when a decision taken on this page changed what the loaded report
 * counted, so an AI summary written for the loaded state is out of date.
 */
export function triageChangedSinceLoad(
  findings: readonly LocalizedFinding[],
  live: Readonly<Record<string, ActionState>>,
): boolean {
  return findings.some(
    (finding) => isFindingUncounted(finding, live[finding.ruleId]) !== isFindingUncounted(finding, undefined),
  );
}
