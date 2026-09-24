/**
 * Pure-unit contract for the Keyword Trends helpers that the
 * integration suites only exercise on their happy path: input normalization
 * (dedupe / blank drop / geo + language present and absent) and the
 * defensive run-id guard on the stored-run read.
 *
 * No mongo connection is needed — `findTrendsRun` rejects a malformed id
 * before it ever builds a query.
 */
import { describe, expect, it } from 'vitest';
import {
  TRENDS_MAX_QUERY_CHARS,
  TRENDS_MAX_RELATED_QUERIES,
  findTrendsRun,
  normalizeTrendsExploreInputs,
  trendsGeoToLocationCode,
} from './keyword-research.service.js';

describe('normalizeTrendsExploreInputs', () => {
  it('lowercases, trims, drops blanks and duplicates, then sorts', () => {
    expect(
      normalizeTrendsExploreInputs({
        keywords: ['  Zeta ', 'alpha', '   ', 'ALPHA', 'beta'],
      }),
    ).toEqual({ keywords: ['alpha', 'beta', 'zeta'], geo: null, language: null });
  });

  it('normalizes geo and language when both are supplied', () => {
    expect(
      normalizeTrendsExploreInputs({ keywords: ['seo'], geo: ' US ', language: ' EN ' }),
    ).toEqual({ keywords: ['seo'], geo: 'us', language: 'en' });
  });

  it('treats whitespace-only geo and language as absent', () => {
    expect(
      normalizeTrendsExploreInputs({ keywords: ['seo'], geo: '   ', language: '  ' }),
    ).toEqual({ keywords: ['seo'], geo: null, language: null });
  });

  it('treats undefined geo and language as absent', () => {
    expect(
      normalizeTrendsExploreInputs({
        keywords: ['seo'],
        geo: undefined,
        language: undefined,
      }),
    ).toEqual({ keywords: ['seo'], geo: null, language: null });
  });
});

describe('trendsGeoToLocationCode', () => {
  it.each([
    ['us', 2840],
    ['gb', 2826],
    ['de', 2276],
    ['fr', 2250],
    [null, undefined],
    ['unsupported', undefined],
  ] as const)('maps %j to %j', (geo, expected) => {
    expect(trendsGeoToLocationCode(geo)).toBe(expected);
  });
});

describe('findTrendsRun run-id guard', () => {
  it.each(['', 'not-an-id', 'ZZZZZZZZZZZZZZZZZZZZZZZZ', 'abc'])(
    'returns null without querying for %j',
    async (runId) => {
      await expect(findTrendsRun({ accountId: 'acct-1', runId })).resolves.toBeNull();
    },
  );
});

describe('trends clamp constants', () => {
  it('pins the SEC-OUT related-query ceilings', () => {
    expect(TRENDS_MAX_RELATED_QUERIES).toBe(50);
    expect(TRENDS_MAX_QUERY_CHARS).toBe(100);
  });
});
