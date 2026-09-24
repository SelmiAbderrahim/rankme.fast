import { describe, expect, it } from 'vitest';
import { contentAnalysisHref } from './contentIntelligenceHref';

describe('contentAnalysisHref', () => {
  it('encodes site and prefill values without reflecting markup', () => {
    const href = contentAnalysisHref({
      siteId: 'site/one',
      ownedUrl: 'https://example.com/a?x=1',
      keyword: '<script>alert(1)</script>',
      source: 'gsc',
    });
    expect(href).toContain('/sites/site%2Fone?tab=content&view=analyses');
    expect(href).toContain('prefillUrl=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1');
    expect(href).not.toContain('<script>');
    expect(href).toContain('source=gsc');
  });

  it('omits absent prefill fields', () => {
    expect(contentAnalysisHref({ siteId: 's' })).toBe('/sites/s?tab=content&view=analyses');
  });
});
