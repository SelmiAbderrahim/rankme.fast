import { describe, expect, it } from 'vitest';
import { findingApplicability, localSeoApplies } from './finding-applicability.js';

describe('localSeoApplies', () => {
  it.each([
    [false, null, false],
    [false, 'not-configured', false],
    [false, 'ok', true],
    [false, 'unavailable', true],
    [true, null, true],
    [true, 'not-configured', true],
  ] as const)('localBusiness=%s, status=%s → %s', (localBusiness, localSeoStatus, applies) => {
    expect(localSeoApplies({ localBusiness, localSeoStatus })).toBe(applies);
  });
});

describe('findingApplicability', () => {
  const notEvaluated = { bucket: 'not-evaluated', meta: { insufficientData: true } };
  it('marks only Local SEO checks that did not run on a non-local site', () => {
    expect(findingApplicability({ ruleId: 'nap-inconsistency', ...notEvaluated }, false)).toBe('not_applicable');
    expect(findingApplicability({ ruleId: 'nap-inconsistency', ...notEvaluated }, true)).toBe('applicable');
    expect(findingApplicability({ ruleId: 'not-indexed', ...notEvaluated }, false)).toBe('applicable');
  });

  it('never hides a Local SEO check that produced a result', () => {
    expect(findingApplicability({ ruleId: 'low-review-rating', bucket: 'watch', meta: null }, false)).toBe('applicable');
  });
});
