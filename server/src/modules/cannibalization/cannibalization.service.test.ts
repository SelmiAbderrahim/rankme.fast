/**
 * `computeReport` unit tests — the pure stored-row → candidates
 * transform, including the bounds and the degenerate shares.
 */
import { describe, expect, it } from 'vitest';
import { computeReport } from './cannibalization.service.js';
import { MAX_CANDIDATES, MAX_PAGES_PER_QUERY } from './cannibalization.schema.js';

const row = (
  query: string,
  page: string,
  clicks: number,
  impressions: number,
  position: number,
) => ({ query, page, clicks, impressions, position });

describe('computeReport', () => {
  it('splits per-page shares and marks the primary page', () => {
    const out = computeReport([
      row('seo audit', 'https://x.test/a', 90, 900, 3.1),
      row('seo audit', 'https://x.test/b', 10, 100, 8.4),
      row('single', 'https://x.test/c', 5, 50, 4),
    ]);
    expect(out.queriesAnalyzed).toBe(2);
    expect(out.pagesInvolved).toBe(2);
    expect(out.candidates).toHaveLength(1);
    const candidate = out.candidates[0]!;
    expect(candidate.query).toBe('seo audit');
    expect(candidate.confidence).toBe('high');
    expect(candidate.totalClicks).toBe(100);
    expect(candidate.totalImpressions).toBe(1000);
    expect(candidate.primaryUrl).toBe('https://x.test/a');
    expect(candidate.primaryReason).toBe('most_clicks');
    expect(candidate.pages.map((p) => [p.url, p.clickShare, p.isPrimary])).toEqual([
      ['https://x.test/a', 0.9, true],
      ['https://x.test/b', 0.1, false],
    ]);
    expect(candidate.pages[0]?.impressionShare).toBeCloseTo(0.9, 10);
  });

  it('grades medium when only one page drew impressions', () => {
    const out = computeReport([
      row('q', 'https://x.test/a', 4, 40, 5),
      row('q', 'https://x.test/b', 0, 0, 30),
    ]);
    expect(out.candidates[0]?.confidence).toBe('medium');
  });

  it('returns zero shares when the query has no clicks or impressions', () => {
    const out = computeReport([
      row('q', 'https://x.test/a', 0, 0, 40),
      row('q', 'https://x.test/b', 0, 0, 50),
    ]);
    const candidate = out.candidates[0]!;
    expect(candidate.confidence).toBe('low');
    expect(candidate.pages.every((p) => p.clickShare === 0)).toBe(true);
    expect(candidate.pages.every((p) => p.impressionShare === 0)).toBe(true);
  });

  it('folds a duplicated (query, page) row instead of double-counting shares', () => {
    const out = computeReport([
      row('q', 'https://x.test/a', 5, 50, 4),
      row('q', 'https://x.test/a', 5, 50, 4),
      row('q', 'https://x.test/b', 2, 20, 9),
    ]);
    const candidate = out.candidates[0]!;
    expect(candidate.pages).toHaveLength(2);
    expect(candidate.totalClicks).toBe(12);
    expect(
      candidate.pages.reduce((sum, p) => sum + p.clickShare, 0),
    ).toBeCloseTo(1, 10);
  });

  it('caps candidates and pages per query at the server bounds', () => {
    const rows = [];
    for (let q = 0; q < MAX_CANDIDATES + 5; q += 1) {
      const query = `q-${String(q).padStart(4, '0')}`;
      for (let p = 0; p < MAX_PAGES_PER_QUERY + 3; p += 1) {
        rows.push(row(query, `https://x.test/${q}/${p}`, p, p * 10, p + 1));
      }
    }
    const out = computeReport(rows);
    expect(out.candidates).toHaveLength(MAX_CANDIDATES);
    expect(out.candidates[0]?.pages).toHaveLength(MAX_PAGES_PER_QUERY);
    expect(out.queriesAnalyzed).toBe(MAX_CANDIDATES + 5);
  });

  it('orders fully tied pages by URL so the report is reproducible', () => {
    const out = computeReport([
      row('q', 'https://x.test/b', 7, 70, 5),
      row('q', 'https://x.test/a', 7, 70, 5),
    ]);
    const candidate = out.candidates[0]!;
    expect(candidate.pages.map((p) => p.url)).toEqual([
      'https://x.test/a',
      'https://x.test/b',
    ]);
    expect(candidate.primaryUrl).toBe('https://x.test/a');
    expect(candidate.primaryReason).toBe('stable_order');
  });

  it('returns an empty report for no rows', () => {
    expect(computeReport([])).toEqual({
      queriesAnalyzed: 0,
      pagesInvolved: 0,
      candidates: [],
    });
  });
});
