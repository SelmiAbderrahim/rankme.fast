import { describe, expect, it } from 'vitest';
import {
  effectiveDecisionState,
  isFindingUncounted,
  triageChangedSinceLoad,
  uncountedDecisions,
} from './findingDecisions';
import type { FindingDecision, LocalizedFinding } from './types';

const decision = (over: Partial<FindingDecision> = {}): FindingDecision => ({
  state: 'dismissed',
  regressed: false,
  decidedAt: '2026-10-16T00:00:00.000Z',
  decidedBy: null,
  reason: null,
  affectedCountAtDismissal: null,
  latest: null,
  resurfaced: null,
  recheckable: false,
  recheck: null,
  ...over,
});
const f = (ruleId: string, bucket: LocalizedFinding['bucket'], d?: FindingDecision) =>
  ({ ruleId, bucket, ...(d ? { decision: d } : {}) }) as LocalizedFinding;

describe('finding decisions on the report', () => {
  it('prefers the decision taken on the page over the loaded one', () => {
    expect(effectiveDecisionState(f('a', 'fix-now', decision()), 'open')).toBe('open');
    expect(effectiveDecisionState(f('a', 'fix-now', decision()), undefined)).toBe('dismissed');
    expect(effectiveDecisionState(f('a', 'fix-now'), undefined)).toBeUndefined();
  });

  it('leaves dismissed and fixed Fix-now / Watch findings out, but not resurfaced, passed or open ones', () => {
    expect(isFindingUncounted(f('a', 'fix-now', decision()), undefined)).toBe(true);
    expect(isFindingUncounted(f('a', 'watch'), 'completed')).toBe(true);
    expect(isFindingUncounted(f('a', 'passed'), 'dismissed')).toBe(false);
    expect(isFindingUncounted(f('a', 'watch'), 'planned')).toBe(false);
    expect(isFindingUncounted(f('a', 'watch'), undefined)).toBe(false);
    expect(isFindingUncounted(f('a', 'fix-now', decision({ resurfaced: { addedCount: 3 } })), 'dismissed')).toBe(false);
    // A fresh dismissal on the page has no resurfacing.
    expect(isFindingUncounted(f('a', 'fix-now', decision({ state: 'completed', resurfaced: null })), 'dismissed')).toBe(true);
  });

  it('keys the uncounted findings by rule and spots a change since load', () => {
    const findings = [f('a', 'fix-now', decision()), f('b', 'watch'), f('c', 'watch')];
    expect(uncountedDecisions(findings, { c: 'completed' })).toEqual({ a: 'dismissed', c: 'completed' });
    expect(triageChangedSinceLoad(findings, {})).toBe(false);
    expect(triageChangedSinceLoad(findings, { a: 'dismissed' })).toBe(false);
    expect(triageChangedSinceLoad(findings, { a: 'open' })).toBe(true);
    expect(triageChangedSinceLoad(findings, { b: 'dismissed' })).toBe(true);
  });
});
