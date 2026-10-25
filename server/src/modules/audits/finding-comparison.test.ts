import { describe, expect, it } from 'vitest';
import {
  FINDING_COMPARISON_STATUSES,
  SCOPE_MISMATCH_MIN_PAGES,
  compareFinding,
  compareFindings,
  crawlScopesDiffer,
} from './finding-comparison.js';

const PASSED = { bucket: 'passed', affectedUrls: [] as string[] };
const NOT_EVALUATED = { bucket: 'not-evaluated', affectedUrls: [] as string[], meta: { insufficientData: true } };
const LEGACY_NOT_EVALUATED = { bucket: 'watch', affectedUrls: [] as string[], meta: { insufficientData: true } };
const watch = (count: number) => ({ bucket: 'watch', affectedUrls: Array.from({ length: count }, (_, i) => `u${i}`) });
const fixNow = (count: number) => ({ bucket: 'fix-now', affectedUrls: Array.from({ length: count }, (_, i) => `u${i}`) });

describe('compareFinding — every baseline × current combination', () => {
  const baselines = {
    absent: undefined,
    'not evaluated': NOT_EVALUATED,
    'legacy not evaluated (watch + insufficientData)': LEGACY_NOT_EVALUATED,
    passed: PASSED,
    'watch ×2': watch(2),
    'fix-now ×2': fixNow(2),
  } as const;
  const currents = {
    'not evaluated': NOT_EVALUATED,
    passed: PASSED,
    'watch ×1': watch(1),
    'watch ×2': watch(2),
    'watch ×3': watch(3),
    'fix-now ×2': fixNow(2),
  } as const;
  // [baseline][current] → [same scope, scope mismatch]
  const expected: Record<keyof typeof baselines, Record<keyof typeof currents, [string | null, string | null]>> = {
    absent: {
      'not evaluated': [null, null], passed: [null, null], 'watch ×1': ['new', 'new'],
      'watch ×2': ['new', 'new'], 'watch ×3': ['new', 'new'], 'fix-now ×2': ['new', 'new'],
    },
    'not evaluated': {
      'not evaluated': [null, null], passed: [null, null], 'watch ×1': ['new', 'new'],
      'watch ×2': ['new', 'new'], 'watch ×3': ['new', 'new'], 'fix-now ×2': ['new', 'new'],
    },
    'legacy not evaluated (watch + insufficientData)': {
      'not evaluated': [null, null], passed: [null, null], 'watch ×1': ['new', 'new'],
      'watch ×2': ['new', 'new'], 'watch ×3': ['new', 'new'], 'fix-now ×2': ['new', 'new'],
    },
    passed: {
      'not evaluated': [null, null], passed: ['unchanged', 'unchanged'], 'watch ×1': ['regressed', 'regressed'],
      'watch ×2': ['regressed', 'regressed'], 'watch ×3': ['regressed', 'regressed'], 'fix-now ×2': ['regressed', 'regressed'],
    },
    'watch ×2': {
      'not evaluated': [null, null], passed: ['resolved', 'resolved'], 'watch ×1': ['improved', 'not_comparable'],
      'watch ×2': ['unchanged', 'unchanged'], 'watch ×3': ['regressed', 'not_comparable'], 'fix-now ×2': ['regressed', 'regressed'],
    },
    'fix-now ×2': {
      'not evaluated': [null, null], passed: ['resolved', 'resolved'], 'watch ×1': ['improved', 'improved'],
      'watch ×2': ['improved', 'improved'], 'watch ×3': ['improved', 'improved'], 'fix-now ×2': ['unchanged', 'unchanged'],
    },
  };
  for (const [baselineName, baseline] of Object.entries(baselines)) {
    for (const [currentName, current] of Object.entries(currents)) {
      const [same, mismatch] = expected[baselineName as keyof typeof baselines][currentName as keyof typeof currents];
      it(`${baselineName} → ${currentName}: ${same} / ${mismatch}`, () => {
        expect(compareFinding(baseline, current, false)).toBe(same);
        expect(compareFinding(baseline, current, true)).toBe(mismatch);
      });
    }
  }

  it('never says regressed without an evaluated baseline', () => {
    for (const baseline of [undefined, NOT_EVALUATED, LEGACY_NOT_EVALUATED]) {
      for (const current of [watch(5), fixNow(9)]) {
        expect(compareFinding(baseline, current, false)).toBe('new');
      }
    }
  });

  it('exposes the status vocabulary group 05 consumes', () => {
    expect(FINDING_COMPARISON_STATUSES).toEqual(['new', 'regressed', 'improved', 'unchanged', 'resolved', 'not_comparable']);
  });
});

describe('compareFindings', () => {
  it('keys statuses by rule and omits findings with nothing to say', () => {
    const statuses = compareFindings(
      [{ ruleId: 'a', ...PASSED }, { ruleId: 'b', ...NOT_EVALUATED }],
      [{ ruleId: 'a', ...watch(1) }, { ruleId: 'b', ...watch(1) }, { ruleId: 'c', ...PASSED }],
      false,
    );
    expect([...statuses]).toEqual([['a', 'regressed'], ['b', 'new']]);
  });
});

describe('crawlScopesDiffer', () => {
  it.each([
    // Cap 100 / 100 crawled vs cap 5000 / 128 crawled.
    [{ pageCap: 100, pagesCrawled: 100 }, { pageCap: 5000, pagesCrawled: 128 }, true],
    // Same cap, crawl sizes within the churn band.
    [{ pageCap: 500, pagesCrawled: 100 }, { pageCap: 500, pagesCrawled: 108 }, false],
    // A large relative change on a tiny site is still under the page floor.
    [{ pageCap: 500, pagesCrawled: 2 }, { pageCap: 500, pagesCrawled: 2 + SCOPE_MISMATCH_MIN_PAGES - 1 }, false],
    // Different caps that never stopped either crawl.
    [{ pageCap: 100, pagesCrawled: 40 }, { pageCap: 5000, pagesCrawled: 41 }, false],
    // Different caps, the new crawl hit its cap, sizes close.
    [{ pageCap: 100, pagesCrawled: 98 }, { pageCap: 99, pagesCrawled: 99 }, true],
    // Unrecorded counts prove nothing.
    [{ pageCap: 100, pagesCrawled: null }, { pageCap: 5000, pagesCrawled: null }, false],
    [{ pageCap: 100, pagesCrawled: 100 }, { pageCap: 5000, pagesCrawled: null }, true],
  ] as const)('%o vs %o → %s', (previous, current, differ) => {
    expect(crawlScopesDiffer(previous, current)).toBe(differ);
  });
});
