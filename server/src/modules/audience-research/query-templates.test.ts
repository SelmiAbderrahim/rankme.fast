import { describe, expect, it } from 'vitest';
import {
  QUERY_CAP,
  QUERY_TEMPLATE_VERSION,
  generateQueries,
} from './query-templates.js';

describe('generateQueries v1', () => {
  it('locks the version constant', () => {
    expect(QUERY_TEMPLATE_VERSION).toBe(1);
    expect(QUERY_CAP).toBe(40);
  });

  it('returns only the alternative row when no seed topics and no keywords', () => {
    const qs = generateQueries({
      seedTopics: [],
      competitorDomains: ['acme.com'],
    });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.templateId).toBe('v1.alternative.competitor_alt');
  });

  it('returns empty when no seeds, no competitors, no keywords', () => {
    expect(
      generateQueries({ seedTopics: [], competitorDomains: [] }),
    ).toEqual([]);
  });

  it('falls back to existing keywords when no seed topics', () => {
    const qs = generateQueries({
      seedTopics: [],
      competitorDomains: [],
      existingKeywords: ['pricing', 'onboarding'],
    });
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.some((q) => q.text.includes('pricing'))).toBe(true);
  });

  it('produces deterministic order for identical input', () => {
    const a = generateQueries({
      seedTopics: ['pricing', 'onboarding'],
      competitorDomains: ['acme.com', 'zeta.com'],
      ownDomain: 'ours.com',
    });
    const b = generateQueries({
      seedTopics: ['onboarding', 'pricing'],
      competitorDomains: ['zeta.com', 'acme.com'],
      ownDomain: 'ours.com',
    });
    expect(a.map((q) => q.text)).toEqual(b.map((q) => q.text));
  });

  it('applies all v1 templates with the locked ids', () => {
    const qs = generateQueries({
      seedTopics: ['seo'],
      competitorDomains: ['acme.com'],
      ownDomain: 'ours.com',
    });
    const templateIds = new Set(qs.map((q) => q.templateId));
    expect(templateIds).toEqual(
      new Set([
        'v1.complaint.problems_site',
        'v1.complaint.reviews',
        'v1.request.feature_request',
        'v1.question.how_to',
        'v1.question.why_does',
        'v1.review.best',
        'v1.comparison.competitor_vs_own',
        'v1.alternative.competitor_alt',
      ]),
    );
  });

  it('respects the total cap of 40', () => {
    const topics = Array.from({ length: 10 }, (_, i) => `topic${i}`);
    const competitors = Array.from({ length: 5 }, (_, i) => `c${i}.com`);
    const qs = generateQueries({
      seedTopics: topics,
      competitorDomains: competitors,
      ownDomain: 'ours.com',
    });
    expect(qs.length).toBeLessThanOrEqual(QUERY_CAP);
    // Ids are stable ordinals.
    expect(qs[0]!.id).toBe('q-001');
  });

  it('drops the comparison grid when ownDomain is empty', () => {
    const qs = generateQueries({
      seedTopics: ['seo'],
      competitorDomains: ['acme.com'],
    });
    expect(qs.some((q) => q.templateId === 'v1.comparison.competitor_vs_own')).toBe(false);
    expect(qs.some((q) => q.templateId === 'v1.alternative.competitor_alt')).toBe(true);
  });

  it('caps by pushing complaint × competitor first', () => {
    const topics = ['a', 'b', 'c', 'd', 'e'];
    const competitors = ['x.com', 'y.com', 'z.com', 'q.com', 'r.com'];
    const qs = generateQueries({
      seedTopics: topics,
      competitorDomains: competitors,
      ownDomain: 'ours.com',
    });
    expect(qs.length).toBeLessThanOrEqual(QUERY_CAP);
    expect(qs[0]!.templateId).toBe('v1.complaint.problems_site');
  });

  it('honors the tracked-keyword cap (5)', () => {
    const qs = generateQueries({
      seedTopics: [],
      competitorDomains: [],
      existingKeywords: Array.from({ length: 20 }, (_, i) => `kw${i}`),
    });
    const topicSet = new Set(qs.filter((q) => q.templateId === 'v1.review.best').map((q) => q.text));
    expect(topicSet.size).toBeLessThanOrEqual(5);
  });

  it('drops blank topics before dedupe', () => {
    const qs = generateQueries({
      seedTopics: ['   ', ''],
      competitorDomains: [],
    });
    expect(qs).toEqual([]);
  });

  it('dedupes topics case-insensitively', () => {
    const qs = generateQueries({
      seedTopics: ['SEO', 'seo', 'Seo'],
      competitorDomains: [],
    });
    const revs = qs.filter((q) => q.templateId === 'v1.review.best');
    expect(revs).toHaveLength(1);
    expect(revs[0]!.text).toBe('best seo');
  });
});
