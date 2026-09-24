import { describe, expect, it } from 'vitest';
import { FAKE_DOMAIN_COMPARISON } from './fakes.js';
import {
  DOMAIN_COMPARISON_MAX_ROWS,
  compareDomainComparisonRows,
  domainComparisonTestables,
  normalizeDomainComparisonKeyword,
  normalizeDomainComparisonResult,
  normalizeDomainComparisonRows,
} from './domain-comparison.js';
import type { DomainComparisonRow } from './types.js';

const template = FAKE_DOMAIN_COMPARISON.shared[0]!;

function row(overrides: Partial<DomainComparisonRow>): DomainComparisonRow {
  return { ...template, keyword: 'keyword', normalizedKeyword: 'keyword', ...overrides };
}

describe('domain comparison normalization', () => {
  it('covers nullable comparators and leg-specific primary evidence', () => {
    const t = domainComparisonTestables;
    expect(t.compareNullableNumberAscending(null, null)).toBe(0);
    expect(t.compareNullableNumberAscending(null, 1)).toBe(1);
    expect(t.compareNullableNumberAscending(1, null)).toBe(-1);
    expect(t.compareNullableNumberAscending(1, 3)).toBe(-2);
    expect(t.compareNullableNumberDescending(null, null)).toBe(0);
    expect(t.compareNullableNumberDescending(null, 1)).toBe(1);
    expect(t.compareNullableNumberDescending(1, null)).toBe(-1);
    expect(t.compareNullableNumberDescending(3, 1)).toBe(-2);
    expect(t.compareNullableStringAscending(null, null)).toBe(0);
    expect(t.compareNullableStringAscending(null, 'a')).toBe(1);
    expect(t.compareNullableStringAscending('a', null)).toBe(-1);
    expect(t.compareNullableStringAscending('a', 'b')).toBe(-1);

    const evidence = row({
      ownedPosition: 2,
      competitorPosition: 4,
      ownedUrl: 'https://owned.example/page',
      competitorUrl: 'https://rival.example/page',
    });
    expect(t.primaryPosition(evidence, 'shared')).toBe(2);
    expect(t.primaryPosition(evidence, 'ownedOnly')).toBe(2);
    expect(t.primaryPosition(evidence, 'competitorOnly')).toBe(4);
    expect(t.primaryUrl(evidence, 'shared')).toBe('https://owned.example/page');
    expect(t.primaryUrl(evidence, 'competitorOnly')).toBe('https://rival.example/page');
  });

  it('walks every deterministic winner tie-break in order', () => {
    const base = row({
      ownedPosition: 2,
      ownedUrl: 'https://same.example/page',
      searchVolume: 100,
      keywordDifficulty: 50,
      intent: 'commercial',
      keyword: 'same',
    });
    expect(compareDomainComparisonRows(row({ ...base, ownedPosition: 1 }), base, 'shared'))
      .toBeLessThan(0);
    expect(compareDomainComparisonRows(row({ ...base, ownedUrl: 'https://a.example' }), base, 'shared'))
      .toBeLessThan(0);
    expect(compareDomainComparisonRows(row({ ...base, searchVolume: 200 }), base, 'shared'))
      .toBeLessThan(0);
    expect(compareDomainComparisonRows(row({ ...base, keywordDifficulty: 80 }), base, 'shared'))
      .toBeLessThan(0);
    expect(compareDomainComparisonRows(row({ ...base, intent: 'commercial' }), row({ ...base, intent: 'transactional' }), 'shared'))
      .toBeLessThan(0);
    expect(compareDomainComparisonRows(row({ ...base, keyword: 'a' }), base, 'shared'))
      .toBeLessThan(0);
    expect(compareDomainComparisonRows(base, base, 'shared')).toBe(0);
  });

  it('normalizes, deduplicates, sorts, caps, and applies all three legs', () => {
    expect(normalizeDomainComparisonKeyword('  CAFE\u0301   SEO ')).toBe('café seo');
    const rows = [
      row({ keyword: ' ', ownedPosition: 1 }),
      row({ keyword: 'Beta', ownedPosition: 9 }),
      row({ keyword: ' beta ', ownedPosition: 2 }),
      row({ keyword: 'BETA', ownedPosition: 7 }),
      ...Array.from({ length: DOMAIN_COMPARISON_MAX_ROWS + 5 }, (_, index) =>
        row({ keyword: `term-${String(index).padStart(3, '0')}`, ownedPosition: index + 1 })),
    ];
    const normalized = normalizeDomainComparisonRows(rows, 'shared');
    expect(normalized).toHaveLength(DOMAIN_COMPARISON_MAX_ROWS);
    expect(normalized.find((candidate) => candidate.normalizedKeyword === 'beta')?.ownedPosition)
      .toBe(2);
    expect(normalized.map((candidate) => candidate.normalizedKeyword))
      .toEqual([...normalized.map((candidate) => candidate.normalizedKeyword)].sort());

    const result = normalizeDomainComparisonResult({
      shared: [row({ keyword: ' Shared ' })],
      ownedOnly: [row({ keyword: ' Owned ' })],
      competitorOnly: [row({ keyword: ' Rival ', competitorPosition: 1 })],
    });
    expect(result.shared[0]?.normalizedKeyword).toBe('shared');
    expect(result.ownedOnly[0]?.normalizedKeyword).toBe('owned');
    expect(result.competitorOnly[0]?.normalizedKeyword).toBe('rival');
  });
});
