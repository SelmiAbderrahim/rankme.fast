/**
 * Rule suite — every rule gets at least one passing and one
 * failing fixture. The meta-test at the bottom is the release gate: adding
 * a new rule to ALL_RULES without both cases makes the suite red.
 */
import { describe, expect, it, test } from 'vitest';
import {
  ALL_AIVISIBILITY_RULES,
  ALL_GSC_SEARCH_RULES,
  ALL_GSC_SITEMAPS_RULES,
  ALL_INDEXSTATUS_RULES,
  ALL_LOCALSEO_RULES,
  ALL_PAGESPEED_RULES,
  ALL_RULES,
  bucketFor,
  countByBucket,
  CTR_LOW_MIN_IMPRESSIONS,
  CTR_LOW_THRESHOLD,
  evaluateAllRules,
  RULE_IDS,
  type RuleFinding,
  type RuleId,
} from './index.js';
import {
  makeAuditPage,
  makeAuditResult,
  makeGscSearchInput,
  makeGscSitemapEntry,
  makeGscSitemapsInput,
  makeGscTopQuery,
  makeIndexStatusInput,
  makeIndexStatusSample,
  makePageSpeedInput,
  makePageSpeedSample,
} from './fixtures.js';

function findingFor(ruleId: RuleId, findings: RuleFinding[]): RuleFinding {
  const found = findings.find((f) => f.ruleId === ruleId);
  if (!found) throw new Error(`no finding for ${ruleId}`);
  return found;
}

const perRuleCases: Record<RuleId, { pass: () => void; fail: () => void }> = {
  'robots-blocked': {
    pass: () => {
      const result = makeAuditResult({
        pages: [
          { isIndexable: false, nonIndexableReason: 'noindex meta tag' },
          {},
        ],
      });
      const finding = findingFor('robots-blocked', evaluateAllRules(result));
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const result = makeAuditResult({
        pages: [
          {
            url: 'https://example.com/hidden',
            isIndexable: false,
            nonIndexableReason: 'blocked_by_robots_txt',
          },
        ],
      });
      const finding = findingFor('robots-blocked', evaluateAllRules(result));
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
      expect(finding.affectedUrls).toEqual(['https://example.com/hidden']);
    },
  },
  'sitemap-missing-or-weak': {
    pass: () => {
      const finding = findingFor(
        'sitemap-missing-or-weak',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'sitemap-missing-or-weak',
        evaluateAllRules(makeAuditResult({ domainChecks: { sitemapFound: false } })),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
    },
  },
  'title-missing-or-weak': {
    pass: () => {
      const finding = findingFor(
        'title-missing-or-weak',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'title-missing-or-weak',
        evaluateAllRules(
          makeAuditResult({
            pages: [{ url: 'https://example.com/a', title: null }],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.affectedUrls).toEqual(['https://example.com/a']);
    },
  },
  'meta-description-missing': {
    pass: () => {
      const finding = findingFor(
        'meta-description-missing',
        evaluateAllRules(
          makeAuditResult({
            pages: [
              { url: 'https://example.com/a', metaDescription: 'A page.' },
              { url: 'https://example.com/b', metaDescription: 'B page.' },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'meta-description-missing',
        evaluateAllRules(
          makeAuditResult({
            pages: [
              { url: 'https://example.com/a', metaDescription: null },
              { url: 'https://example.com/b', metaDescription: 'dup' },
              { url: 'https://example.com/c', metaDescription: 'dup' },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(new Set(finding.affectedUrls)).toEqual(
        new Set([
          'https://example.com/a',
          'https://example.com/b',
          'https://example.com/c',
        ]),
      );
    },
  },
  'headings-weak': {
    pass: () => {
      const finding = findingFor(
        'headings-weak',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'headings-weak',
        evaluateAllRules(
          makeAuditResult({
            pages: [
              { url: 'https://example.com/a', h1: [] },
              { url: 'https://example.com/b', h1: ['One', 'Two'] },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
    },
  },
  'canonical-missing-or-broken': {
    pass: () => {
      const finding = findingFor(
        'canonical-missing-or-broken',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'canonical-missing-or-broken',
        evaluateAllRules(
          makeAuditResult({
            pages: [
              { url: 'https://example.com/a', canonical: null },
              {
                url: 'https://example.com/b',
                canonical: 'https://other-site.example/b',
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.affectedUrls).toEqual([
        'https://example.com/a',
        'https://example.com/b',
      ]);
    },
  },
  'structured-data-missing': {
    pass: () => {
      const finding = findingFor(
        'structured-data-missing',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'structured-data-missing',
        evaluateAllRules(
          makeAuditResult({
            pages: [
              {
                url: 'https://example.com/a',
                hasStructuredData: true,
                structuredDataErrors: ['bad type'],
              },
              {
                url: 'https://example.com/b',
                hasStructuredData: false,
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
    },
  },
  'broken-internal-links': {
    pass: () => {
      const finding = findingFor(
        'broken-internal-links',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'broken-internal-links',
        evaluateAllRules(
          makeAuditResult({
            pages: [
              {
                url: 'https://example.com/a',
                brokenLinks: ['https://example.com/404'],
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.meta).toEqual({
        totalBroken: 1,
        brokenLinkTargets: ['https://example.com/404'],
      });
    },
  },
  'thin-content': {
    pass: () => {
      const finding = findingFor(
        'thin-content',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'thin-content',
        evaluateAllRules(
          makeAuditResult({
            pages: [{ url: 'https://example.com/tiny', wordCount: 40 }],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.affectedUrls).toEqual(['https://example.com/tiny']);
    },
  },
  'faq-content-missing': {
    pass: () => {
      const finding = findingFor(
        'faq-content-missing',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'faq-content-missing',
        evaluateAllRules(
          makeAuditResult({
            pages: [{ url: 'https://example.com/faq', hasFaqSignals: false }],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('warning');
      expect(finding.affectedUrls).toEqual(['https://example.com/faq']);
    },
  },
  'llms-txt-missing': {
    pass: () => {
      const finding = findingFor(
        'llms-txt-missing',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'llms-txt-missing',
        evaluateAllRules(
          makeAuditResult({ domainChecks: { llmsTxtFound: false } }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('info');
    },
  },
  'https-canonicalization': {
    pass: () => {
      const finding = findingFor(
        'https-canonicalization',
        evaluateAllRules(makeAuditResult()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'https-canonicalization',
        evaluateAllRules(
          makeAuditResult({ domainChecks: { httpsEnforced: false } }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
    },
  },
  'core-web-vitals-poor': {
    pass: () => {
      const finding = findingFor(
        'core-web-vitals-poor',
        evaluateAllRules(makeAuditResult(), makePageSpeedInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'core-web-vitals-poor',
        evaluateAllRules(
          makeAuditResult(),
          makePageSpeedInput({
            samples: [
              {
                url: 'https://example.com/slow',
                coreWebVitals: { lcpMs: 5200, inp: 700, cls: 0.3, category: 'poor' },
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
      expect(finding.affectedUrls).toEqual(['https://example.com/slow']);
    },
  },
  'page-speed-lab-low': {
    pass: () => {
      const finding = findingFor(
        'page-speed-lab-low',
        evaluateAllRules(makeAuditResult(), makePageSpeedInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'page-speed-lab-low',
        evaluateAllRules(
          makeAuditResult(),
          makePageSpeedInput({
            samples: [
              {
                url: 'https://example.com/heavy',
                labScores: { performance: 32, accessibility: 90, bestPractices: 80, seo: 100 },
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('warning');
      expect(finding.affectedUrls).toEqual(['https://example.com/heavy']);
    },
  },
  'mobile-unfriendly': {
    pass: () => {
      const finding = findingFor(
        'mobile-unfriendly',
        evaluateAllRules(makeAuditResult(), makePageSpeedInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'mobile-unfriendly',
        evaluateAllRules(
          makeAuditResult(),
          makePageSpeedInput({
            samples: [
              { url: 'https://example.com/mobile-broken', mobileFriendly: false },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
      expect(finding.affectedUrls).toEqual(['https://example.com/mobile-broken']);
    },
  },
  'accessibility-low': {
    pass: () => {
      const finding = findingFor(
        'accessibility-low',
        evaluateAllRules(makeAuditResult(), makePageSpeedInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'accessibility-low',
        evaluateAllRules(
          makeAuditResult(),
          makePageSpeedInput({
            samples: [
              {
                url: 'https://example.com/inaccessible',
                labScores: { performance: 92, accessibility: 85, bestPractices: 96, seo: 100 },
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('warning');
      expect(finding.affectedUrls).toEqual(['https://example.com/inaccessible']);
    },
  },
  'not-indexed': {
    pass: () => {
      const finding = findingFor(
        'not-indexed',
        evaluateAllRules(makeAuditResult(), null, makeIndexStatusInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'not-indexed',
        evaluateAllRules(
          makeAuditResult(),
          null,
          makeIndexStatusInput({
            samples: [
              {
                url: 'https://example.com/blocked',
                inspection: { indexVerdict: 'FAIL' },
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
      expect(finding.affectedUrls).toEqual(['https://example.com/blocked']);
    },
  },
  'rich-results-issues': {
    pass: () => {
      const finding = findingFor(
        'rich-results-issues',
        evaluateAllRules(makeAuditResult(), null, makeIndexStatusInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'rich-results-issues',
        evaluateAllRules(
          makeAuditResult(),
          null,
          makeIndexStatusInput({
            samples: [
              {
                url: 'https://example.com/faq',
                inspection: {
                  richResults: {
                    verdict: 'PARTIAL',
                    items: [{ type: 'FAQ', issues: 2 }],
                  },
                },
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('warning');
      expect(finding.affectedUrls).toEqual(['https://example.com/faq']);
    },
  },
  'index-partial': {
    pass: () => {
      const finding = findingFor(
        'index-partial',
        evaluateAllRules(makeAuditResult(), null, makeIndexStatusInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'index-partial',
        evaluateAllRules(
          makeAuditResult(),
          null,
          makeIndexStatusInput({
            samples: [
              {
                url: 'https://example.com/partial',
                inspection: { indexVerdict: 'PARTIAL' },
              },
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('warning');
      expect(finding.affectedUrls).toEqual(['https://example.com/partial']);
    },
  },
  'gsc-ctr-low': {
    pass: () => {
      const finding = findingFor(
        'gsc-ctr-low',
        evaluateAllRules(makeAuditResult(), null, null, makeGscSearchInput()),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'gsc-ctr-low',
        evaluateAllRules(
          makeAuditResult(),
          null,
          null,
          makeGscSearchInput({
            topQueries: [
              makeGscTopQuery({
                query: 'rank tracker',
                clicks: 8,
                impressions: 2000,
                ctr: 0.004,
                position: 9.1,
              }),
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.severity).toBe('warning');
      expect(finding.meta).toMatchObject({
        queries: [{ query: 'rank tracker', impressions: 2000 }],
      });
    },
  },
  'sitemap-errors': {
    pass: () => {
      const finding = findingFor(
        'sitemap-errors',
        evaluateAllRules(
          makeAuditResult(),
          null,
          null,
          null,
          makeGscSitemapsInput(),
        ),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'sitemap-errors',
        evaluateAllRules(
          makeAuditResult(),
          null,
          null,
          null,
          makeGscSitemapsInput({
            sitemaps: [
              makeGscSitemapEntry({
                path: 'https://example.com/broken.xml',
                errors: 2,
              }),
            ],
          }),
        ),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
      expect(finding.affectedUrls).toEqual(['https://example.com/broken.xml']);
    },
  },
  'ai-visibility-low': {
    pass: () => {
      const finding = findingFor(
        'ai-visibility-low',
        evaluateAllRules(makeAuditResult(), null, null, null, null, {
          status: 'ok',
          aiOverviewCitedCount: 1,
          aiOverviewTotalChecked: 2,
          llmMentionedCount: 1,
          llmTotalChecked: 2,
          shareOfVoicePct: 50,
          negativeSentimentCount: 0,
          competitorsPresent: true,
        }),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'ai-visibility-low',
        evaluateAllRules(makeAuditResult(), null, null, null, null, {
          status: 'ok',
          aiOverviewCitedCount: 0,
          aiOverviewTotalChecked: 2,
          llmMentionedCount: 0,
          llmTotalChecked: 2,
          shareOfVoicePct: null,
          negativeSentimentCount: 0,
          competitorsPresent: false,
        }),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toMatchObject({ noPresence: true });
    },
  },
  'nap-inconsistency': {
    pass: () => {
      const finding = findingFor(
        'nap-inconsistency',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [
            { source: 'google', consistent: true },
            { source: 'yelp', consistent: true },
          ],
          reviews: { averageRating: 4.6, reviewCount: 128 },
          qa: { unansweredCount: 2 },
          localPack: { keyword: 'plumber austin', position: 2, totalPackSize: 3 },
        }),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'nap-inconsistency',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [
            { source: 'google', consistent: true },
            { source: 'bing-places', consistent: false },
          ],
          reviews: null,
          qa: null,
          localPack: null,
        }),
      );
      expect(finding.bucket).toBe('fix-now');
      expect(finding.severity).toBe('critical');
      expect(finding.meta).toEqual({ sources: ['bing-places'] });
    },
  },
  'low-review-count': {
    pass: () => {
      const finding = findingFor(
        'low-review-count',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [],
          reviews: { averageRating: 4.6, reviewCount: 128 },
          qa: { unansweredCount: 0 },
          localPack: null,
        }),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'low-review-count',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [],
          reviews: { averageRating: 4.6, reviewCount: 3 },
          qa: { unansweredCount: 0 },
          localPack: null,
        }),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toEqual({ reviewCount: 3 });
    },
  },
  'low-review-rating': {
    pass: () => {
      const finding = findingFor(
        'low-review-rating',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [],
          reviews: { averageRating: 4.6, reviewCount: 128 },
          qa: { unansweredCount: 0 },
          localPack: null,
        }),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'low-review-rating',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [],
          reviews: { averageRating: 3.2, reviewCount: 40 },
          qa: { unansweredCount: 0 },
          localPack: null,
        }),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toEqual({ averageRating: 3.2 });
    },
  },
  'local-pack-not-ranking': {
    pass: () => {
      const finding = findingFor(
        'local-pack-not-ranking',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [],
          reviews: null,
          qa: null,
          localPack: { keyword: 'plumber austin', position: 2, totalPackSize: 3 },
        }),
      );
      expect(finding.bucket).toBe('passed');
    },
    fail: () => {
      const finding = findingFor(
        'local-pack-not-ranking',
        evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
          status: 'ok',
          listings: [],
          reviews: null,
          qa: null,
          localPack: { keyword: 'plumber austin', position: null, totalPackSize: 3 },
        }),
      );
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toEqual({ keyword: 'plumber austin', totalPackSize: 3 });
    },
  },
};

for (const ruleId of RULE_IDS) {
  describe(`rule ${ruleId}`, () => {
    const cases = perRuleCases[ruleId];
    it('passes on a healthy audit', cases.pass);
    it('fails on a broken audit', cases.fail);
  });
}

// -----------------------------------------------------------------------------
// Rule-specific extra branches (`insufficientData`, canonical-URL parse fail,
// title too-long/too-short, canonical missing without broken, etc.)
// -----------------------------------------------------------------------------

describe('rule branch coverage', () => {
  it('ai-visibility-low: null input → watch + insufficientData("unavailable")', () => {
    const finding = findingFor('ai-visibility-low', evaluateAllRules(makeAuditResult()));
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('ai-visibility-low: non-null input with a non-ok status → watch + insufficientData(status)', () => {
    const finding = findingFor(
      'ai-visibility-low',
      evaluateAllRules(makeAuditResult(), null, null, null, null, {
        status: 'no-prompts-tracked',
        aiOverviewCitedCount: 0,
        aiOverviewTotalChecked: 0,
        llmMentionedCount: 0,
        llmTotalChecked: 0,
        shareOfVoicePct: null,
        negativeSentimentCount: 0,
        competitorsPresent: false,
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-prompts-tracked' });
  });

  it('ai-visibility-low: negative mentions present but not a plurality → passed', () => {
    const finding = findingFor(
      'ai-visibility-low',
      evaluateAllRules(makeAuditResult(), null, null, null, null, {
        status: 'ok',
        aiOverviewCitedCount: 1,
        aiOverviewTotalChecked: 2,
        llmMentionedCount: 1,
        llmTotalChecked: 4,
        shareOfVoicePct: 50,
        negativeSentimentCount: 1,
        competitorsPresent: true,
      }),
    );
    expect(finding.bucket).toBe('passed');
  });


  it('sitemap rule reports insufficient data when signal missing', () => {
    const finding = findingFor(
      'sitemap-missing-or-weak',
      evaluateAllRules(
        makeAuditResult({ domainChecks: { sitemapReferencedInRobots: undefined } }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true });
  });

  it('sitemap rule reports watch when found but not referenced in robots', () => {
    const finding = findingFor(
      'sitemap-missing-or-weak',
      evaluateAllRules(
        makeAuditResult({ domainChecks: { sitemapReferencedInRobots: false } }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
  });

  it('title rule flags too-long as watch (not fix-now)', () => {
    const longTitle = 'x'.repeat(80);
    const finding = findingFor(
      'title-missing-or-weak',
      evaluateAllRules(
        makeAuditResult({ pages: [{ title: longTitle }] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
  });

  it('title rule flags too-short as watch', () => {
    const finding = findingFor(
      'title-missing-or-weak',
      evaluateAllRules(
        makeAuditResult({ pages: [{ title: 'Hi' }] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
  });

  it('title rule skips non-indexable pages', () => {
    const finding = findingFor(
      'title-missing-or-weak',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ isIndexable: false, title: null }],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('title rule flags empty (whitespace-only) title as missing', () => {
    const finding = findingFor(
      'title-missing-or-weak',
      evaluateAllRules(
        makeAuditResult({ pages: [{ title: '   ' }] }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
  });

  it('meta-description rule skips non-indexable', () => {
    const finding = findingFor(
      'meta-description-missing',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ isIndexable: false, metaDescription: null }],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('headings-weak flags multi-h1 as watch when no missing', () => {
    const finding = findingFor(
      'headings-weak',
      evaluateAllRules(
        makeAuditResult({ pages: [{ h1: ['A', 'B'] }] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
  });

  it('headings-weak skips non-indexable pages', () => {
    const finding = findingFor(
      'headings-weak',
      evaluateAllRules(
        makeAuditResult({ pages: [{ isIndexable: false, h1: [] }] }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('headings-weak ignores whitespace-only h1 entries as empty', () => {
    const finding = findingFor(
      'headings-weak',
      evaluateAllRules(
        makeAuditResult({ pages: [{ h1: ['   '] }] }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
  });

  it('canonical rule downgrades to watch when only missing (no broken)', () => {
    const finding = findingFor(
      'canonical-missing-or-broken',
      evaluateAllRules(
        makeAuditResult({ pages: [{ canonical: null }] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
  });

  it('canonical rule reports empty string as missing', () => {
    const finding = findingFor(
      'canonical-missing-or-broken',
      evaluateAllRules(
        makeAuditResult({ pages: [{ canonical: '   ' }] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
  });

  it('canonical rule treats unparseable canonical as broken', () => {
    const finding = findingFor(
      'canonical-missing-or-broken',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ url: 'https://example.com/a', canonical: 'not a url' }],
        }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
  });

  it('canonical rule skips non-indexable pages', () => {
    const finding = findingFor(
      'canonical-missing-or-broken',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ isIndexable: false, canonical: null }],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('structured-data downgrades to watch when only missing (no errors)', () => {
    const finding = findingFor(
      'structured-data-missing',
      evaluateAllRules(
        makeAuditResult({ pages: [{ hasStructuredData: false }] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
  });

  it('structured-data skips non-indexable pages', () => {
    const finding = findingFor(
      'structured-data-missing',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ isIndexable: false, hasStructuredData: false }],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('robots-blocked ignores non-robots non-indexable reasons', () => {
    const finding = findingFor(
      'robots-blocked',
      evaluateAllRules(
        makeAuditResult({
          pages: [
            {
              isIndexable: false,
              nonIndexableReason: undefined,
            },
          ],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('robots-blocked matches "robots" substring reasons', () => {
    const finding = findingFor(
      'robots-blocked',
      evaluateAllRules(
        makeAuditResult({
          pages: [
            {
              url: 'https://example.com/x',
              isIndexable: false,
              nonIndexableReason: 'meta_robots_noindex',
            },
          ],
        }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
    expect(finding.affectedUrls).toEqual(['https://example.com/x']);
  });

  it('thin-content reports insufficient data when no page has wordCount', () => {
    const page = makeAuditPage({ wordCount: undefined });
    const result = makeAuditResult({ pages: [{ wordCount: undefined }] });
    // The default fixture wordCount is 800 — override to undefined here.
    const pageWithoutCount = { ...page, wordCount: undefined };
    delete (pageWithoutCount as { wordCount?: number }).wordCount;
    const finding = findingFor(
      'thin-content',
      evaluateAllRules({
        ...result,
        pages: [pageWithoutCount],
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true });
  });

  it('thin-content ignores non-indexable pages', () => {
    const finding = findingFor(
      'thin-content',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ isIndexable: false, wordCount: 10 }],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('thin-content passes when audit has zero pages', () => {
    const finding = findingFor(
      'thin-content',
      evaluateAllRules(makeAuditResult({ pages: [] })),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('faq passes when audit has zero pages', () => {
    const finding = findingFor(
      'faq-content-missing',
      evaluateAllRules(makeAuditResult({ pages: [] })),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('faq reports insufficient data when hasFaqSignals absent everywhere', () => {
    const p = makeAuditPage();
    delete (p as { hasFaqSignals?: boolean }).hasFaqSignals;
    const finding = findingFor(
      'faq-content-missing',
      evaluateAllRules({
        domainChecks: makeAuditResult().domainChecks,
        pages: [p],
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true });
  });

  it('faq ignores non-indexable pages when sampling', () => {
    const finding = findingFor(
      'faq-content-missing',
      evaluateAllRules(
        makeAuditResult({
          pages: [{ isIndexable: false, hasFaqSignals: false }],
        }),
      ),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('llms-txt-missing reports insufficient data when signal undefined', () => {
    const result = makeAuditResult();
    delete (result.domainChecks as { llmsTxtFound?: boolean }).llmsTxtFound;
    const finding = findingFor('llms-txt-missing', evaluateAllRules(result));
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true });
  });

  it('https-canonicalization flags http-redirect=false even when SSL exposed', () => {
    const finding = findingFor(
      'https-canonicalization',
      evaluateAllRules(
        makeAuditResult({ domainChecks: { httpsRedirect: false } }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
    expect(finding.meta).toEqual({ httpsEnforced: true, httpsRedirect: false });
  });

  it('https-canonicalization reports null httpsRedirect when absent', () => {
    const result = makeAuditResult({ domainChecks: { httpsEnforced: false } });
    delete (result.domainChecks as { httpsRedirect?: boolean }).httpsRedirect;
    const finding = findingFor('https-canonicalization', evaluateAllRules(result));
    expect(finding.bucket).toBe('fix-now');
    expect(finding.meta).toEqual({ httpsEnforced: false, httpsRedirect: null });
  });

  it('https-canonicalization flags canonicalizationOk=false as watch', () => {
    const finding = findingFor(
      'https-canonicalization',
      evaluateAllRules(
        makeAuditResult({ domainChecks: { canonicalizationOk: false } }),
      ),
    );
    expect(finding.bucket).toBe('watch');
  });

  // -------------------------------------------------------------------------
  // Page-speed rule branches
  // -------------------------------------------------------------------------

  it('core-web-vitals: null pageSpeed → watch + insufficientData("unavailable")', () => {
    const finding = findingFor(
      'core-web-vitals-poor',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('core-web-vitals: provider unavailable → watch + insufficientData("unavailable")', () => {
    const finding = findingFor(
      'core-web-vitals-poor',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({ status: 'unavailable', samples: [] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('core-web-vitals: no field data on any sample → watch + insufficientData("no-field-data")', () => {
    const sampleWithoutField = makePageSpeedSample();
    delete (sampleWithoutField as { coreWebVitals?: unknown }).coreWebVitals;
    const finding = findingFor(
      'core-web-vitals-poor',
      evaluateAllRules(makeAuditResult(), {
        status: 'ok',
        samples: [{ ...sampleWithoutField, fieldDataLevel: 'none' }],
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-field-data' });
  });

  it('core-web-vitals: needs-improvement wins over passed when no poor present', () => {
    const finding = findingFor(
      'core-web-vitals-poor',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({
          samples: [
            {
              url: 'https://example.com/slowish',
              coreWebVitals: { lcpMs: 3200, inp: 250, cls: 0.15, category: 'needs-improvement' },
            },
          ],
        }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
    expect(finding.affectedUrls).toEqual(['https://example.com/slowish']);
  });

  it('core-web-vitals: poor wins when mixed with needs-improvement', () => {
    const finding = findingFor(
      'core-web-vitals-poor',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({
          samples: [
            {
              url: 'https://example.com/ni',
              coreWebVitals: { lcpMs: 3200, inp: 250, cls: 0.15, category: 'needs-improvement' },
            },
            {
              url: 'https://example.com/poor',
              coreWebVitals: { lcpMs: 5200, inp: 700, cls: 0.3, category: 'poor' },
            },
          ],
        }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
    expect(finding.affectedUrls).toEqual(['https://example.com/poor']);
  });

  it('page-speed-lab-low: null pageSpeed → watch + insufficientData', () => {
    const finding = findingFor(
      'page-speed-lab-low',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('page-speed-lab-low: unavailable → watch + insufficientData', () => {
    const finding = findingFor(
      'page-speed-lab-low',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({ status: 'unavailable', samples: [] }),
      ),
    );
    expect(finding.bucket).toBe('watch');
  });

  it('mobile-unfriendly: null pageSpeed → watch + insufficientData("unavailable")', () => {
    const finding = findingFor(
      'mobile-unfriendly',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('mobile-unfriendly: unavailable → watch + insufficientData', () => {
    const finding = findingFor(
      'mobile-unfriendly',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({ status: 'unavailable', samples: [] }),
      ),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('mobile-unfriendly: only desktop samples → no-mobile-samples', () => {
    const finding = findingFor(
      'mobile-unfriendly',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({
          samples: [{ strategy: 'desktop', mobileFriendly: undefined }],
        }),
      ),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-mobile-samples' });
  });

  it('mobile-unfriendly: mobile samples without a signal → no-signal', () => {
    const sample = makePageSpeedSample({ strategy: 'mobile' });
    delete (sample as { mobileFriendly?: boolean }).mobileFriendly;
    const finding = findingFor(
      'mobile-unfriendly',
      evaluateAllRules(makeAuditResult(), { status: 'ok', samples: [sample] }),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-signal' });
  });

  it('accessibility-low: null pageSpeed → watch + insufficientData("unavailable")', () => {
    const finding = findingFor(
      'accessibility-low',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('accessibility-low: unavailable → watch + insufficientData', () => {
    const finding = findingFor(
      'accessibility-low',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({ status: 'unavailable', samples: [] }),
      ),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('accessibility-low: any sample below 70 → fix-now (critical)', () => {
    const finding = findingFor(
      'accessibility-low',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({
          samples: [
            {
              url: 'https://example.com/bad',
              labScores: { performance: 92, accessibility: 65, bestPractices: 96, seo: 100 },
            },
            {
              url: 'https://example.com/mediocre',
              labScores: { performance: 92, accessibility: 85, bestPractices: 96, seo: 100 },
            },
          ],
        }),
      ),
    );
    expect(finding.bucket).toBe('fix-now');
    expect(finding.severity).toBe('critical');
    expect(finding.affectedUrls).toEqual([
      'https://example.com/bad',
      'https://example.com/mediocre',
    ]);
    expect(finding.meta).toEqual({
      watchThreshold: 90,
      fixNowThreshold: 70,
      samples: [
        { url: 'https://example.com/bad', accessibility: 65 },
        { url: 'https://example.com/mediocre', accessibility: 85 },
      ],
    });
  });

  it('accessibility-low: mixed 85 + 95 → only the offender in affectedUrls', () => {
    const finding = findingFor(
      'accessibility-low',
      evaluateAllRules(
        makeAuditResult(),
        makePageSpeedInput({
          samples: [
            {
              url: 'https://example.com/ok',
              labScores: { performance: 92, accessibility: 95, bestPractices: 96, seo: 100 },
            },
            {
              url: 'https://example.com/offender',
              labScores: { performance: 92, accessibility: 85, bestPractices: 96, seo: 100 },
            },
          ],
        }),
      ),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
    expect(finding.affectedUrls).toEqual(['https://example.com/offender']);
  });

  // -------------------------------------------------------------------------
  // Index-status rule branches
  // -------------------------------------------------------------------------

  it('not-indexed: null indexStatus → watch + insufficientData("not-connected")', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'not-connected' });
  });

  it('not-indexed: needs-reconnect propagates as insufficientData reason', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'needs-reconnect',
        samples: [],
      }),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'needs-reconnect' });
  });

  it('not-indexed: quota-exceeded propagates as insufficientData reason', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'quota-exceeded',
        samples: [],
      }),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'quota-exceeded' });
  });

  it('not-indexed: unavailable propagates as insufficientData reason', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'unavailable',
        samples: [],
      }),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
  });

  it('not-indexed: not-connected explicit status', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'not-connected',
        samples: [],
      }),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'not-connected' });
  });

  it('not-indexed: zero samples but status ok → passed', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult(), null, { status: 'ok', samples: [] }),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('not-indexed: NEUTRAL verdict is treated as offender', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'ok',
        samples: [
          makeIndexStatusSample({
            url: 'https://example.com/unknown',
            inspection: { indexVerdict: 'NEUTRAL' },
          }),
        ],
      }),
    );
    expect(finding.bucket).toBe('fix-now');
    expect(finding.affectedUrls).toEqual(['https://example.com/unknown']);
  });

  it('rich-results-issues: null indexStatus → watch + insufficientData', () => {
    const finding = findingFor(
      'rich-results-issues',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'not-connected' });
  });

  it('rich-results-issues: FAIL verdict is treated as offender', () => {
    const finding = findingFor(
      'rich-results-issues',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'ok',
        samples: [
          makeIndexStatusSample({
            url: 'https://example.com/bad',
            inspection: { richResults: { verdict: 'FAIL', items: [] } },
          }),
        ],
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.affectedUrls).toEqual(['https://example.com/bad']);
  });

  it('rich-results-issues: PARTIAL with zero-issue items → passed', () => {
    const finding = findingFor(
      'rich-results-issues',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'ok',
        samples: [
          makeIndexStatusSample({
            inspection: {
              richResults: { verdict: 'PARTIAL', items: [{ type: 'FAQ', issues: 0 }] },
            },
          }),
        ],
      }),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('rich-results-issues: zero samples but status ok → passed', () => {
    const finding = findingFor(
      'rich-results-issues',
      evaluateAllRules(makeAuditResult(), null, { status: 'ok', samples: [] }),
    );
    expect(finding.bucket).toBe('passed');
  });

  it('index-partial: null indexStatus → watch + insufficientData', () => {
    const finding = findingFor(
      'index-partial',
      evaluateAllRules(makeAuditResult()),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'not-connected' });
  });

  it('index-partial: needs-reconnect propagates', () => {
    const finding = findingFor(
      'index-partial',
      evaluateAllRules(makeAuditResult(), null, {
        status: 'needs-reconnect',
        samples: [],
      }),
    );
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'needs-reconnect' });
  });

  it('index-partial: zero samples but status ok → passed', () => {
    const finding = findingFor(
      'index-partial',
      evaluateAllRules(makeAuditResult(), null, { status: 'ok', samples: [] }),
    );
    expect(finding.bucket).toBe('passed');
  });
});

// -----------------------------------------------------------------------------
// Bucket + engine surface
// -----------------------------------------------------------------------------

describe('bucketFor', () => {
  it('passed always wins', () => {
    expect(bucketFor('critical', true)).toBe('passed');
    expect(bucketFor('info', true)).toBe('passed');
  });
  it('critical → fix-now, everything else → watch', () => {
    expect(bucketFor('critical', false)).toBe('fix-now');
    expect(bucketFor('warning', false)).toBe('watch');
    expect(bucketFor('info', false)).toBe('watch');
  });
});

describe('countByBucket', () => {
  it('counts one bucket per finding', () => {
    const counts = countByBucket([
      { ruleId: 'a' as RuleId, bucket: 'fix-now', severity: 'critical', affectedUrls: [] },
      { ruleId: 'b' as RuleId, bucket: 'watch', severity: 'warning', affectedUrls: [] },
      { ruleId: 'c' as RuleId, bucket: 'passed', severity: 'info', affectedUrls: [] },
      { ruleId: 'd' as RuleId, bucket: 'passed', severity: 'info', affectedUrls: [] },
    ]);
    expect(counts).toEqual({ fixNow: 1, watch: 1, passed: 2 });
  });
});

describe('evaluateAllRules', () => {
  it('emits exactly one finding per registered rule', () => {
    const findings = evaluateAllRules(makeAuditResult());
    expect(findings.map((f) => f.ruleId).sort()).toEqual([...RULE_IDS].sort());
  });

  it('never crashes on an unknown/extra field in AuditResult', () => {
    const result = makeAuditResult() as unknown as Record<string, unknown>;
    result.somethingExtra = { fromVendor: true };
    expect(() => evaluateAllRules(result as never)).not.toThrow();
  });

  it('priority: fix-now findings come before watch and passed', () => {
    const findings = evaluateAllRules(
      makeAuditResult({
        pages: [{ url: 'https://example.com/a', title: null }],
        domainChecks: { sitemapFound: false },
      }),
    );
    const first = findings[0]!.bucket;
    const last = findings[findings.length - 1]!.bucket;
    expect(first).toBe('fix-now');
    expect(last).toBe('passed');
  });

  it('priority: within same bucket + severity, larger affected-page counts win', () => {
    // Two fix-now criticals: robots-blocked (1 page) vs broken links (5 pages).
    const pages = [
      {
        url: 'https://example.com/x',
        isIndexable: false,
        nonIndexableReason: 'blocked_by_robots_txt',
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/link${i}`,
        brokenLinks: [`https://example.com/dead${i}`],
      })),
    ];
    const findings = evaluateAllRules(makeAuditResult({ pages }));
    // broken-internal-links has 5 affected, robots-blocked has 1 — broken first.
    const criticals = findings.filter((f) => f.bucket === 'fix-now');
    expect(criticals[0]!.ruleId).toBe('broken-internal-links');
  });

  it('priority tiebreak: same severity + same page count → sorted by ruleId', () => {
    // Two site-wide critical fix-nows: sitemap missing + https not enforced.
    const findings = evaluateAllRules(
      makeAuditResult({
        domainChecks: { sitemapFound: false, httpsEnforced: false },
      }),
    );
    const criticalIds = findings
      .filter((f) => f.bucket === 'fix-now' && f.affectedUrls.length === 0)
      .map((f) => f.ruleId);
    // ruleId sort: https-canonicalization < sitemap-missing-or-weak alphabetically.
    expect(criticalIds).toEqual([
      'https-canonicalization',
      'sitemap-missing-or-weak',
    ]);
  });
});

// -----------------------------------------------------------------------------
// Release gate — the meta-test that keeps the suite honest.
// -----------------------------------------------------------------------------

test('release gate: every rule (audit + page-speed + index-status + gsc + ai-visibility + local-seo) has a pass and a fail fixture', () => {
  const allRuleIds = [
    ...ALL_RULES,
    ...ALL_PAGESPEED_RULES,
    ...ALL_INDEXSTATUS_RULES,
    ...ALL_GSC_SEARCH_RULES,
    ...ALL_GSC_SITEMAPS_RULES,
    ...ALL_AIVISIBILITY_RULES,
    ...ALL_LOCALSEO_RULES,
  ]
    .map((r) => r.id)
    .sort();
  const casedRuleIds = Object.keys(perRuleCases).sort();
  expect(casedRuleIds).toEqual(allRuleIds);
  expect(RULE_IDS.slice().sort()).toEqual(allRuleIds);
  for (const ruleId of allRuleIds) {
    expect(perRuleCases[ruleId as RuleId].pass).toBeTypeOf('function');
    expect(perRuleCases[ruleId as RuleId].fail).toBeTypeOf('function');
  }
});

// -----------------------------------------------------------------------------
// gsc-ctr-low — threshold boundaries + degradation
// -----------------------------------------------------------------------------

describe('gsc-ctr-low extra branches', () => {
  function ctrFinding(input: Parameters<typeof makeGscSearchInput>[0]) {
    return findingFor(
      'gsc-ctr-low',
      evaluateAllRules(makeAuditResult(), null, null, makeGscSearchInput(input)),
    );
  }

  it('exactly 1000 impressions at low CTR qualifies (boundary inclusive)', () => {
    const finding = ctrFinding({
      topQueries: [
        makeGscTopQuery({
          impressions: CTR_LOW_MIN_IMPRESSIONS,
          clicks: 5,
          ctr: 0.005,
        }),
      ],
    });
    expect(finding.bucket).toBe('watch');
  });

  it('999 impressions never qualifies regardless of CTR', () => {
    const finding = ctrFinding({
      topQueries: [
        makeGscTopQuery({
          impressions: CTR_LOW_MIN_IMPRESSIONS - 1,
          clicks: 0,
          ctr: 0,
        }),
      ],
    });
    expect(finding.bucket).toBe('passed');
  });

  it('CTR exactly at the 1% threshold passes (strictly-below rule)', () => {
    const finding = ctrFinding({
      topQueries: [
        makeGscTopQuery({
          impressions: 2000,
          clicks: 20,
          ctr: CTR_LOW_THRESHOLD,
        }),
      ],
    });
    expect(finding.bucket).toBe('passed');
  });

  it('CTR just below the threshold fails', () => {
    const finding = ctrFinding({
      topQueries: [
        makeGscTopQuery({ impressions: 2000, clicks: 18, ctr: 0.009 }),
      ],
    });
    expect(finding.bucket).toBe('watch');
  });

  it('never lands in fix-now even with many qualifying queries', () => {
    const finding = ctrFinding({
      topQueries: Array.from({ length: 5 }, (_, i) =>
        makeGscTopQuery({
          query: `q${i}`,
          impressions: 5000,
          clicks: 1,
          ctr: 0.0002,
        }),
      ),
    });
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
  });

  for (const status of [
    'unavailable',
    'not-connected',
    'needs-reconnect',
    'no-data',
  ] as const) {
    it(`status ${status} degrades to watch with insufficientData`, () => {
      const finding = ctrFinding({ status, topQueries: [] });
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toMatchObject({
        insufficientData: true,
        reason: status,
      });
    });
  }

  it('null input (pre-feature snapshot) degrades with reason not-connected', () => {
    const finding = findingFor(
      'gsc-ctr-low',
      evaluateAllRules(makeAuditResult(), null, null, null),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toMatchObject({
      insufficientData: true,
      reason: 'not-connected',
    });
  });
});

// -----------------------------------------------------------------------------
// sitemap-errors — warnings / no-sitemaps / degradation
// -----------------------------------------------------------------------------

describe('sitemap-errors extra branches', () => {
  function sitemapFinding(input: Parameters<typeof makeGscSitemapsInput>[0]) {
    return findingFor(
      'sitemap-errors',
      evaluateAllRules(
        makeAuditResult(),
        null,
        null,
        null,
        makeGscSitemapsInput(input),
      ),
    );
  }

  it('warnings without errors → watch with the offending paths', () => {
    const finding = sitemapFinding({
      sitemaps: [
        makeGscSitemapEntry(),
        makeGscSitemapEntry({
          path: 'https://example.com/partial.xml',
          warnings: 3,
        }),
      ],
    });
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
    expect(finding.affectedUrls).toEqual(['https://example.com/partial.xml']);
    expect(finding.meta).toMatchObject({
      sitemaps: [{ path: 'https://example.com/partial.xml', warnings: 3 }],
    });
  });

  it('errors beat warnings — a mixed list lands in fix-now with error paths only', () => {
    const finding = sitemapFinding({
      sitemaps: [
        makeGscSitemapEntry({
          path: 'https://example.com/warn.xml',
          warnings: 1,
        }),
        makeGscSitemapEntry({
          path: 'https://example.com/err.xml',
          errors: 4,
        }),
      ],
    });
    expect(finding.bucket).toBe('fix-now');
    expect(finding.affectedUrls).toEqual(['https://example.com/err.xml']);
  });

  it('no-sitemaps → watch with the dedicated insufficientData marker', () => {
    const finding = sitemapFinding({ status: 'no-sitemaps', sitemaps: [] });
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toMatchObject({
      insufficientData: 'no-sitemaps',
      reason: 'no-sitemaps',
    });
  });

  for (const status of [
    'unavailable',
    'not-connected',
    'needs-reconnect',
  ] as const) {
    it(`status ${status} degrades to watch with insufficientData`, () => {
      const finding = sitemapFinding({ status, sitemaps: [] });
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toMatchObject({
        insufficientData: true,
        reason: status,
      });
    });
  }

  it('null input (pre-feature snapshot) degrades with reason not-connected', () => {
    const finding = findingFor(
      'sitemap-errors',
      evaluateAllRules(makeAuditResult(), null, null, null, null),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toMatchObject({
      insufficientData: true,
      reason: 'not-connected',
    });
  });
});

// -----------------------------------------------------------------------------
// not-indexed / index-partial meta enrichment
// -----------------------------------------------------------------------------

describe('index-status meta enrichment', () => {
  it('not-indexed carries coverageState + robotsTxtState from the first offender', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(
        makeAuditResult(),
        null,
        makeIndexStatusInput({
          samples: [
            {
              url: 'https://example.com/blocked',
              inspection: {
                indexVerdict: 'FAIL',
                coverageState: 'Blocked by robots.txt',
                robotsTxtState: 'DISALLOWED',
              },
            },
          ],
        }),
      ),
    );
    expect(finding.meta).toMatchObject({
      coverageState: 'Blocked by robots.txt',
      robotsTxtState: 'DISALLOWED',
    });
  });

  it('not-indexed omits empty coverage/robots states', () => {
    const finding = findingFor(
      'not-indexed',
      evaluateAllRules(
        makeAuditResult(),
        null,
        makeIndexStatusInput({
          samples: [
            {
              url: 'https://example.com/unknown',
              inspection: {
                indexVerdict: 'NEUTRAL',
                coverageState: '',
                robotsTxtState: '',
              },
            },
          ],
        }),
      ),
    );
    expect(finding.meta ?? {}).not.toHaveProperty('coverageState');
    expect(finding.meta ?? {}).not.toHaveProperty('robotsTxtState');
  });

  it('index-partial carries coverageState + pageFetchState', () => {
    const finding = findingFor(
      'index-partial',
      evaluateAllRules(
        makeAuditResult(),
        null,
        makeIndexStatusInput({
          samples: [
            {
              url: 'https://example.com/partial',
              inspection: {
                indexVerdict: 'PARTIAL',
                coverageState: 'Indexed, though blocked by robots.txt',
                pageFetchState: 'SOFT_404',
              },
            },
          ],
        }),
      ),
    );
    expect(finding.meta).toMatchObject({
      coverageState: 'Indexed, though blocked by robots.txt',
      pageFetchState: 'SOFT_404',
    });
  });

  it('index-partial omits a null pageFetchState', () => {
    const finding = findingFor(
      'index-partial',
      evaluateAllRules(
        makeAuditResult(),
        null,
        makeIndexStatusInput({
          samples: [
            {
              url: 'https://example.com/partial',
              inspection: {
                indexVerdict: 'PARTIAL',
                coverageState: '',
                pageFetchState: null,
              },
            },
          ],
        }),
      ),
    );
    expect(finding.meta ?? {}).not.toHaveProperty('pageFetchState');
    expect(finding.meta ?? {}).not.toHaveProperty('coverageState');
  });
});

// -----------------------------------------------------------------------------
// Local SEO rule branches
// -----------------------------------------------------------------------------

describe('local-seo rule branch coverage', () => {
  const LOCAL_SEO_RULE_IDS = [
    'nap-inconsistency',
    'low-review-count',
    'low-review-rating',
    'local-pack-not-ranking',
  ] as const;

  it('null localSeo input degrades every local-seo rule to insufficientData "not-configured"', () => {
    const findings = evaluateAllRules(makeAuditResult());
    for (const ruleId of LOCAL_SEO_RULE_IDS) {
      const finding = findingFor(ruleId, findings);
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toEqual({ insufficientData: true, reason: 'not-configured' });
    }
  });

  it('non-ok status degrades every local-seo rule to insufficientData with the reason', () => {
    const findings = evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
      status: 'unavailable',
      listings: [],
      reviews: null,
      qa: null,
      localPack: null,
    });
    for (const ruleId of LOCAL_SEO_RULE_IDS) {
      const finding = findingFor(ruleId, findings);
      expect(finding.bucket).toBe('watch');
      expect(finding.meta).toEqual({ insufficientData: true, reason: 'unavailable' });
    }
  });

  it('low-review-count: status ok but no reviews data → insufficientData', () => {
    const finding = findingFor(
      'low-review-count',
      evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
        status: 'ok',
        listings: [],
        reviews: null,
        qa: null,
        localPack: null,
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-reviews-data' });
  });

  it('low-review-rating: status ok but no reviews data → insufficientData', () => {
    const finding = findingFor(
      'low-review-rating',
      evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
        status: 'ok',
        listings: [],
        reviews: null,
        qa: null,
        localPack: null,
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-rating-data' });
  });

  it('low-review-rating: reviews present but averageRating null → insufficientData', () => {
    const finding = findingFor(
      'low-review-rating',
      evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
        status: 'ok',
        listings: [],
        reviews: { averageRating: null, reviewCount: 50 },
        qa: null,
        localPack: null,
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({ insufficientData: true, reason: 'no-rating-data' });
  });

  it('local-pack-not-ranking: no local-pack keyword tracked → insufficientData', () => {
    const finding = findingFor(
      'local-pack-not-ranking',
      evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
        status: 'ok',
        listings: [],
        reviews: null,
        qa: null,
        localPack: null,
      }),
    );
    expect(finding.bucket).toBe('watch');
    expect(finding.meta).toEqual({
      insufficientData: true,
      reason: 'no-local-pack-keyword-tracked',
    });
  });

  it('nap-inconsistency: empty listings array → passed', () => {
    const finding = findingFor(
      'nap-inconsistency',
      evaluateAllRules(makeAuditResult(), null, null, null, null, null, {
        status: 'ok',
        listings: [],
        reviews: null,
        qa: null,
        localPack: null,
      }),
    );
    expect(finding.bucket).toBe('passed');
  });
});
