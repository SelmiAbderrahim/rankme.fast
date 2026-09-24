import { describe, expect, it } from 'vitest';
import { readContentAnalysisDeepLink } from './deepLinkState';

const reportId = '64b64b64b64b64b64b64b64b';

describe('readContentAnalysisDeepLink', () => {
  it('keeps unrelated state and returns no prefill for absent values', () => {
    const result = readContentAnalysisDeepLink(new URLSearchParams('tab=content&utm=kept'));
    expect(result.analysisId).toBeNull();
    expect(result.prefill).toBeUndefined();
    expect(result.canonicalParams.toString()).toBe('tab=content&utm=kept');
  });

  it('canonicalizes a complete reviewed-match handoff', () => {
    const params = new URLSearchParams({
      analysis: reportId,
      source: 'competitor',
      prefillUrl: ' https://example.com/article ',
      prefillKeyword: '  useful comparison  ',
      reviewedCompetitorUrls: 'http://rival.example/article',
      landscapeReport: reportId,
      match: 'match:one.v2',
      opportunity: 'opportunity-1',
      keep: 'yes',
    });
    const result = readContentAnalysisDeepLink(params, 'https://example.com/root');

    expect(result.analysisId).toBe(reportId);
    expect(result.prefill).toEqual({
      ownedUrl: 'https://example.com/article',
      keyword: 'useful comparison',
      reviewedCompetitorUrls: ['http://rival.example/article'],
      reviewedPageMatches: [{
        landscapeReportId: reportId,
        landscapeOpportunityId: 'opportunity-1',
        suggestionId: 'match:one.v2',
      }],
    });
    expect(result.canonicalParams.get('prefillUrl')).toBe('https://example.com/article');
    expect(result.canonicalParams.get('prefillKeyword')).toBe('useful comparison');
    expect(result.canonicalParams.get('keep')).toBe('yes');
  });

  it('removes malformed, unsafe, oversized, and unsupported values', () => {
    const result = readContentAnalysisDeepLink(
      new URLSearchParams({
        analysis: reportId.toUpperCase(),
        source: 'unknown',
        prefillUrl: `https://example.com/${'a'.repeat(2_100)}`,
        prefillKeyword: 'x'.repeat(201),
        reviewedCompetitorUrls: 'javascript:alert(1)',
        landscapeReport: 'not-an-object-id',
        match: `m${'x'.repeat(128)}`,
        opportunity: 'space is invalid',
      }),
    );

    expect(result.analysisId).toBeNull();
    expect(result.prefill).toBeUndefined();
    expect(result.canonicalParams.toString()).toBe('');
  });

  it('rejects malformed URLs, off-origin owned pages, and invalid origin constraints', () => {
    const malformed = readContentAnalysisDeepLink(
      new URLSearchParams({ prefillUrl: 'not a url', prefillKeyword: '   ' }),
    );
    expect(malformed.prefill).toBeUndefined();

    const offOrigin = readContentAnalysisDeepLink(
      new URLSearchParams({
        prefillUrl: 'https://attacker.example/path',
        reviewedCompetitorUrls: 'https://rival.example/path',
        landscapeReport: reportId,
        match: 'match-1',
      }),
      'https://example.com',
    );
    expect(offOrigin.prefill).toBeUndefined();
    expect(offOrigin.canonicalParams.has('reviewedCompetitorUrls')).toBe(false);
    expect(offOrigin.canonicalParams.has('landscapeReport')).toBe(false);

    const invalidOrigin = readContentAnalysisDeepLink(
      new URLSearchParams({ prefillUrl: 'https://example.com/path' }),
      'not an origin',
    );
    expect(invalidOrigin.prefill).toBeUndefined();
  });

  it('supports owned-only and keyword-only prefills without inventing optional fields', () => {
    const ownedOnly = readContentAnalysisDeepLink(
      new URLSearchParams({
        prefillUrl: 'http://example.com/path',
        landscapeReport: reportId,
        match: 'match-1',
      }),
      'http://example.com',
    );
    expect(ownedOnly.prefill).toEqual({
      ownedUrl: 'http://example.com/path',
      reviewedPageMatches: [{ landscapeReportId: reportId, suggestionId: 'match-1' }],
    });

    const keywordOnly = readContentAnalysisDeepLink(
      new URLSearchParams({
        prefillKeyword: 'x'.repeat(200),
        reviewedCompetitorUrls: 'https://rival.example/path',
        match: 'orphan-match',
      }),
    );
    expect(keywordOnly.prefill).toEqual({
      keyword: 'x'.repeat(200),
      reviewedCompetitorUrls: ['https://rival.example/path'],
    });
    expect(keywordOnly.canonicalParams.has('match')).toBe(false);
  });

  it('drops an incomplete report/match pair in either direction', () => {
    const reportOnly = readContentAnalysisDeepLink(
      new URLSearchParams({ prefillKeyword: 'query', landscapeReport: reportId }),
    );
    expect(reportOnly.prefill).toEqual({ keyword: 'query' });
    expect(reportOnly.canonicalParams.has('landscapeReport')).toBe(false);

    const matchOnly = readContentAnalysisDeepLink(
      new URLSearchParams({ prefillKeyword: 'query', match: 'match-1' }),
    );
    expect(matchOnly.prefill).toEqual({ keyword: 'query' });
    expect(matchOnly.canonicalParams.has('match')).toBe(false);
  });

  it('accepts every source enum while retaining already-canonical parameters', () => {
    for (const source of ['report', 'keyword', 'gsc', 'competitor']) {
      const params = new URLSearchParams({
        source,
        prefillUrl: 'https://example.com/',
        prefillKeyword: 'query',
      });
      const result = readContentAnalysisDeepLink(params);
      expect(result.canonicalParams.toString()).toBe(params.toString());
    }
  });
});
