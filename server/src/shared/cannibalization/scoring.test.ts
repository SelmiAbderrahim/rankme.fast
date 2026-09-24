/**
 * The shared cannibalization scoring authority.
 *
 * These tests pin the behaviour the content inventory relied on BEFORE the
 * promotion (grades, ordering, evidence-id order, `cannibal-<n>` ids) plus the
 * new deterministic primary-page recommendation.
 */
import { describe, expect, it } from 'vitest';
import {
  CANNIBALIZATION_CONFIDENCE_LEVELS,
  buildCannibalizationCandidates,
  gradeCannibalizationConfidence,
  recommendPrimaryPage,
} from './index.js';
import { cannibalizationCandidateSchema } from './schemas.js';
import type { CannibalizationGroup } from './types.js';

const group = (
  urls: string[],
  gscUrls: string[] = [],
  rankUrls: string[] = [],
): CannibalizationGroup => ({
  urls: new Set(urls),
  gscUrls: new Set(gscUrls),
  rankUrls: new Set(rankUrls),
});

describe('gradeCannibalizationConfidence', () => {
  it('grades two GSC pages high', () => {
    expect(gradeCannibalizationConfidence(group(['/a', '/b'], ['/a', '/b']))).toBe(
      'high',
    );
  });

  it('grades one GSC page medium', () => {
    expect(gradeCannibalizationConfidence(group(['/a', '/b'], ['/a']))).toBe(
      'medium',
    );
  });

  it('grades rank-only evidence medium', () => {
    expect(gradeCannibalizationConfidence(group(['/a', '/b'], [], ['/a']))).toBe(
      'medium',
    );
  });

  it('grades shared-target-query-only evidence low', () => {
    expect(gradeCannibalizationConfidence(group(['/a', '/b']))).toBe('low');
  });

  it('exposes the confidence ladder high → low', () => {
    expect(CANNIBALIZATION_CONFIDENCE_LEVELS).toEqual(['high', 'medium', 'low']);
  });
});

describe('buildCannibalizationCandidates', () => {
  it('skips queries with fewer than two competing pages', () => {
    const out = buildCannibalizationCandidates(
      new Map([['solo', group(['/only'], ['/only'])]]),
    );
    expect(out).toEqual([]);
  });

  it('orders by query and numbers ids from zero', () => {
    const out = buildCannibalizationCandidates(
      new Map([
        ['zeta', group(['/z1', '/z2'], ['/z1', '/z2'])],
        ['alpha', group(['/a1', '/a2'], ['/a1'])],
      ]),
    );
    expect(out.map((c) => [c.id, c.query, c.confidence])).toEqual([
      ['cannibal-0', 'alpha', 'medium'],
      ['cannibal-1', 'zeta', 'high'],
    ]);
    for (const candidate of out) {
      expect(() => cannibalizationCandidateSchema.parse(candidate)).not.toThrow();
    }
  });

  it('lists gsc evidence ids before rank ids and sets hasGscEvidence', () => {
    const [candidate] = buildCannibalizationCandidates(
      new Map([['q', group(['/b', '/a'], ['/b'], ['/a'])]]),
    );
    expect(candidate?.evidenceSourceIds).toEqual(['gsc:/b', 'rank:/a']);
    expect(candidate?.hasGscEvidence).toBe(true);
    expect(candidate?.urls).toEqual(['/a', '/b']);
  });

  it('appends query: evidence ids only on the low-confidence branch', () => {
    const [candidate] = buildCannibalizationCandidates(
      new Map([['q', group(['/b', '/a'])]]),
    );
    expect(candidate?.confidence).toBe('low');
    expect(candidate?.evidenceSourceIds).toEqual(['query:/a', 'query:/b']);
    expect(candidate?.hasGscEvidence).toBe(false);
  });
});

describe('recommendPrimaryPage', () => {
  it('picks the page with the most clicks', () => {
    expect(
      recommendPrimaryPage([
        { url: '/b', clicks: 10, impressions: 100, position: 2 },
        { url: '/a', clicks: 40, impressions: 100, position: 9 },
      ]),
    ).toEqual({ url: '/a', reason: 'most_clicks' });
  });

  it('breaks a clicks tie on the better position', () => {
    expect(
      recommendPrimaryPage([
        { url: '/b', clicks: 10, impressions: 100, position: 8 },
        { url: '/a', clicks: 10, impressions: 100, position: 3 },
      ]),
    ).toEqual({ url: '/a', reason: 'best_position' });
  });

  it('breaks a full tie on URL order and says so', () => {
    expect(
      recommendPrimaryPage([
        { url: '/b', clicks: 10, impressions: 100, position: 4 },
        { url: '/a', clicks: 10, impressions: 100, position: 4 },
      ]),
    ).toEqual({ url: '/a', reason: 'stable_order' });
  });

  it('recommends the only page when a single page is passed', () => {
    expect(
      recommendPrimaryPage([
        { url: '/solo', clicks: 0, impressions: 0, position: 0 },
      ]),
    ).toEqual({ url: '/solo', reason: 'most_clicks' });
  });
});
