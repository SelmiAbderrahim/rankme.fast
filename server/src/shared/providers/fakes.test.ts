import { describe, expect, it } from 'vitest';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from './errors.js';
import {
  FAKE_AI_ANSWERS,
  FAKE_AI_KEYWORD_VOLUME,
  FAKE_AI_MENTIONS,
  FAKE_AUDIT_RESULT,
  FAKE_BACKLINK_PAGE,
  FAKE_BACKLINK_SUMMARY,
  FAKE_CLOCK,
  FAKE_COMPETITORS,
  FAKE_DOMAIN_COMPARISON,
  FAKE_GA4_PROPERTIES,
  FAKE_GA4_REPORT_CHANNEL,
  FAKE_GA4_REPORT_DATE,
  FAKE_GSC_INSPECTION,
  FAKE_GSC_PROPERTIES,
  FAKE_GSC_SEARCH_ANALYTICS,
  FAKE_GSC_SEARCH_ANALYTICS_COUNTRY,
  FAKE_GSC_SEARCH_ANALYTICS_DATE,
  FAKE_GSC_SEARCH_ANALYTICS_DEVICE,
  FAKE_GSC_SITEMAPS,
  FAKE_INTERSECTION,
  FAKE_LANDSCAPE_MALFORMED_DOMAIN,
  FAKE_LANDSCAPE_TIMEOUT_DOMAIN,
  FAKE_SERP_COMPETITORS,
  FAKE_TECH_STACK,
  FAKE_INTENT_RESULTS,
  FAKE_KEYWORD_HISTORICAL_VOLUME,
  FAKE_KEYWORD_IDEAS,
  FAKE_LONG_TAIL_SUGGESTIONS,
  FAKE_KEYWORD_METRICS,
  FAKE_KEYWORD_OVERVIEW,
  FAKE_BUSINESS_LISTINGS,
  FAKE_LOCAL_PACK_RESULT,
  FAKE_QA_SUMMARY,
  FAKE_REVIEWS_SUMMARY,
  FAKE_PAGESPEED_RESULT,
  FAKE_RANK_RESULT,
  createFakeAiVisibilityProvider,
  createFakeAuditProvider,
  createFakeBacklinkProvider,
  createFakeCompetitorProvider,
  createFakeGa4Provider,
  createFakeGscProvider,
  createFakeKeywordProvider,
  createFakeLocalListingsProvider,
  createFakePageSpeedProvider,
  createFakeRankProvider,
} from './fakes.js';
import type {
  AiVisibilityProvider,
  AuditProvider,
  BacklinkProvider,
  CompetitorProvider,
  DomainComparisonResult,
  Ga4Provider,
  GscProvider,
  KeywordProvider,
  LocalListingsProvider,
  PageSpeedProvider,
  RankProvider,
} from './types.js';

// Type-level contract check: each fake must satisfy its interface — a
// drifted fake fails `tsc` before any test runs.
const _typeCheck = {
  audit: createFakeAuditProvider(),
  rank: createFakeRankProvider(),
  keyword: createFakeKeywordProvider(),
  localListings: createFakeLocalListingsProvider(),
  backlink: createFakeBacklinkProvider(),
  competitor: createFakeCompetitorProvider(),
  pagespeed: createFakePageSpeedProvider(),
  gsc: createFakeGscProvider(),
  ga4: createFakeGa4Provider(),
  aiVisibility: createFakeAiVisibilityProvider(),
} satisfies {
  audit: AuditProvider;
  rank: RankProvider;
  keyword: KeywordProvider;
  localListings: LocalListingsProvider;
  backlink: BacklinkProvider;
  competitor: CompetitorProvider;
  pagespeed: PageSpeedProvider;
  gsc: GscProvider;
  ga4: Ga4Provider;
  aiVisibility: AiVisibilityProvider;
};
void _typeCheck;

describe('fake providers', () => {
  it('audit fake returns deterministic canned data', async () => {
    const fake = createFakeAuditProvider();
    await expect(
      fake.startAudit({ domain: 'example.com', pageCap: 100 }),
    ).resolves.toEqual({ vendorTaskId: 'fake-audit-task-1' });
    await expect(fake.getAuditStatus('fake-audit-task-1')).resolves.toEqual({
      state: 'finished',
      pagesCrawled: 2,
    });
    await expect(fake.getAuditResult('fake-audit-task-1')).resolves.toBe(FAKE_AUDIT_RESULT);
  });

  it('audit fake honours canned-result overrides', async () => {
    const fake = createFakeAuditProvider({
      vendorTaskId: 'custom-task',
      status: { state: 'failed', error: 'crawler blocked' },
      result: { domainChecks: FAKE_AUDIT_RESULT.domainChecks, pages: [] },
    });
    await expect(fake.startAudit({ domain: 'example.com', pageCap: 5 })).resolves.toEqual({
      vendorTaskId: 'custom-task',
    });
    await expect(fake.getAuditStatus('custom-task')).resolves.toEqual({
      state: 'failed',
      error: 'crawler blocked',
    });
    await expect(fake.getAuditResult('custom-task')).resolves.toEqual({
      domainChecks: FAKE_AUDIT_RESULT.domainChecks,
      pages: [],
    });
  });

  it('rank fake returns canned data and honours overrides', async () => {
    const input = {
      keyword: 'seo audit tool',
      domain: 'example.com',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop' as const,
    };
    await expect(createFakeRankProvider().checkRank(input)).resolves.toEqual({
      ...FAKE_RANK_RESULT,
      aiOverview: { present: false, cited: false },
      // The fake reports the SERP-feature
      // snapshot on the same result. "seo audit tool" matches neither
      // deterministic scenario, so it is the honest "checked, nothing
      // observed" empty snapshot, never an "absent on Google" claim.
      serpFeatures: { features: [], featuredSnippet: null, paa: [] },
    });
    const notRanked = { position: null, checkedAt: FAKE_CLOCK };
    await expect(
      createFakeRankProvider({ result: notRanked }).checkRank(input),
    ).resolves.toBe(notRanked);
    await expect(createFakeRankProvider().checkLocalPackRank(input)).resolves.toBe(
      FAKE_LOCAL_PACK_RESULT,
    );
    const localPackResult = { position: null, totalPackSize: 3, checkedAt: FAKE_CLOCK };
    await expect(
      createFakeRankProvider({ localPackResult }).checkLocalPackRank(input),
    ).resolves.toBe(localPackResult);
  });

  it('rank fake derives a deterministic AI Overview signal from the keyword', async () => {
    const base = {
      domain: 'example.com',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop' as const,
    };
    const fake = createFakeRankProvider();
    await expect(fake.checkRank({ ...base, keyword: 'ai seo tool' })).resolves.toMatchObject({
      aiOverview: { present: true, cited: true, citedUrl: 'https://example.com/ai' },
    });
    await expect(
      fake.checkRank({ ...base, keyword: 'serp overview tracker' }),
    ).resolves.toMatchObject({
      aiOverview: { present: true, cited: false },
    });
  });

  it('keyword fake returns metrics and slices related to the limit', async () => {
    const fake = createFakeKeywordProvider();
    await expect(fake.getMetrics(['seo audit tool'], 2840, 'en')).resolves.toBe(
      FAKE_KEYWORD_METRICS,
    );
    await expect(fake.getRelated('seo', 2840, 'en', 1)).resolves.toEqual([
      FAKE_KEYWORD_METRICS[0],
    ]);
    const custom = createFakeKeywordProvider({ metrics: [], related: [] });
    await expect(custom.getMetrics([], 2840, 'en')).resolves.toEqual([]);
    await expect(custom.getRelated('seo', 2840, 'en', 10)).resolves.toEqual([]);
  });

  it('keyword fake classifies intent (one of each + null) and slices ideas to the limit', async () => {
    const fake = createFakeKeywordProvider();
    await expect(fake.classifyIntent(['seo audit tool'], 2840, 'en')).resolves.toBe(
      FAKE_INTENT_RESULTS,
    );
    // Ships one row of each of the four intents plus one unclassified row.
    const labels = FAKE_INTENT_RESULTS.map((r) => r.intent);
    expect(labels).toEqual([
      'commercial',
      'informational',
      'transactional',
      'navigational',
      null,
    ]);
    await expect(fake.getIdeas('seo audit tool', 2840, 'en', 5)).resolves.toBe(
      FAKE_KEYWORD_IDEAS,
    );
    await expect(fake.getIdeas('seo audit tool', 2840, 'en', 2)).resolves.toEqual(
      FAKE_KEYWORD_IDEAS.slice(0, 2),
    );
    await expect(
      fake.getLongTailSuggestions('seo audit tool', 2840, 'en', 1),
    ).resolves.toEqual(FAKE_LONG_TAIL_SUGGESTIONS.slice(0, 1));
    await expect(
      fake.getRankedKeywordsForSite('example.com', 2840, 'en', 1),
    ).resolves.toHaveLength(1);
    await expect(
      fake.getKeywordIdeasForSite(['seo audit tool'], 2840, 'en', 2),
    ).resolves.toHaveLength(2);
    const custom = createFakeKeywordProvider({ intent: [], ideas: [] });
    await expect(custom.classifyIntent(['x'], 2840, 'en')).resolves.toEqual([]);
    await expect(custom.getIdeas('x', 2840, 'en', 10)).resolves.toEqual([]);
  });

  it('keyword fake serves overview + historical-volume canned data and honours overrides', async () => {
    const fake = createFakeKeywordProvider();
    await expect(fake.getOverview(['seo audit tool'], 2840, 'en')).resolves.toBe(
      FAKE_KEYWORD_OVERVIEW,
    );
    // Ships one row exercising every SerpFeatureType path plus the null (unclassified) row.
    const intents = FAKE_KEYWORD_OVERVIEW.map((r) => r.intent);
    expect(intents).toContain('commercial');
    expect(intents).toContain('transactional');
    expect(intents).toContain(null);
    const features = new Set(FAKE_KEYWORD_OVERVIEW.flatMap((r) => r.serpFeatures));
    expect(features.has('ai_overview')).toBe(true);
    expect(features.has('featured_snippet')).toBe(true);
    await expect(fake.getHistoricalVolume(['seo audit tool'], 2840, 'en')).resolves.toBe(
      FAKE_KEYWORD_HISTORICAL_VOLUME,
    );
    // Anchor keyword series is long enough for yoyDelta/momentum math.
    expect(FAKE_KEYWORD_HISTORICAL_VOLUME[0]?.monthlySearches.length).toBeGreaterThanOrEqual(24);
    // Deterministic ascending order per keyword.
    for (const row of FAKE_KEYWORD_HISTORICAL_VOLUME) {
      for (let i = 1; i < row.monthlySearches.length; i += 1) {
        const prev = row.monthlySearches[i - 1]!;
        const curr = row.monthlySearches[i]!;
        expect(prev.year * 12 + prev.month).toBeLessThan(curr.year * 12 + curr.month);
      }
    }
    const custom = createFakeKeywordProvider({ overview: [], historicalVolume: [] });
    await expect(custom.getOverview(['x'], 2840, 'en')).resolves.toEqual([]);
    await expect(custom.getHistoricalVolume(['x'], 2840, 'en')).resolves.toEqual([]);
  });

  it('local listings fake returns listings, reviews, and Q&A summaries with overrides', async () => {
    const fake = createFakeLocalListingsProvider();
    await expect(fake.getBusinessListings('example.com')).resolves.toBe(FAKE_BUSINESS_LISTINGS);
    await expect(fake.getReviews('example.com')).resolves.toBe(FAKE_REVIEWS_SUMMARY);
    await expect(fake.getQuestionsAndAnswers('example.com')).resolves.toBe(FAKE_QA_SUMMARY);

    const businessListings = [FAKE_BUSINESS_LISTINGS[0]!];
    const reviews = { averageRating: null, reviewCount: 0, recentReviewCount: null };
    const questionsAndAnswers = { questionCount: 0, unansweredCount: 0 };
    const custom = createFakeLocalListingsProvider({
      businessListings,
      reviews,
      questionsAndAnswers,
    });
    await expect(custom.getBusinessListings('example.com')).resolves.toBe(businessListings);
    await expect(custom.getReviews('example.com')).resolves.toBe(reviews);
    await expect(custom.getQuestionsAndAnswers('example.com')).resolves.toBe(
      questionsAndAnswers,
    );
  });

  it('backlink fake returns summary and pages, with overrides', async () => {
    const fake = createFakeBacklinkProvider();
    await expect(fake.getSummary('example.com')).resolves.toBe(FAKE_BACKLINK_SUMMARY);
    await expect(fake.listBacklinks('example.com', { limit: 10 })).resolves.toBe(
      FAKE_BACKLINK_PAGE,
    );
    const empty = { rows: [] };
    const custom = createFakeBacklinkProvider({
      summary: { ...FAKE_BACKLINK_SUMMARY, backlinks: 0 },
      page: empty,
    });
    await expect(custom.getSummary('example.com')).resolves.toMatchObject({ backlinks: 0 });
    await expect(
      custom.listBacklinks('example.com', { limit: 10, cursor: 'fake-cursor-2' }),
    ).resolves.toBe(empty);
  });

  it('competitor fake slices to the limit and returns intersections', async () => {
    const fake = createFakeCompetitorProvider();
    await expect(fake.getCompetitors('example.com', 2840, 'en', 1)).resolves.toEqual([
      FAKE_COMPETITORS[0],
    ]);
    await expect(
      fake.getDomainIntersection('example.com', 'rival-one.example', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 5,
      }),
    ).resolves.toBe(FAKE_INTERSECTION);
    await expect(fake.getTechnologies('example.com')).resolves.toBe(FAKE_TECH_STACK);
    const custom = createFakeCompetitorProvider({
      competitors: [],
      serpCompetitors: [],
      intersection: [],
      comparison: { shared: [], ownedOnly: [], competitorOnly: [] },
      techStack: [],
    });
    await expect(custom.getCompetitors('example.com', 2840, 'en', 5)).resolves.toEqual([]);
    await expect(
      custom.getSerpCompetitors(['uptime monitor'], 2840, 'en', 5),
    ).resolves.toEqual([]);
    await expect(
      custom.getDomainIntersection('a.example', 'b.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).resolves.toEqual([]);
    await expect(custom.getTechnologies('example.com')).resolves.toEqual([]);
    await expect(
      custom.compareDomains({
        ownedDomain: 'a.example',
        ownedOrigin: 'https://a.example',
        competitorDomain: 'b.example',
        competitorOrigin: 'https://b.example',
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).resolves.toEqual({ shared: [], ownedOnly: [], competitorOnly: [] });
  });

  it('competitor fake returns deterministic normalized comparison rows with URLs and nulls', async () => {
    const result = await createFakeCompetitorProvider().compareDomains({
      ownedDomain: 'example.com',
      ownedOrigin: 'https://example.com',
      competitorDomain: 'rival-one.example',
      competitorOrigin: 'https://rival-one.example',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(result).toEqual(FAKE_DOMAIN_COMPARISON);
    expect(result.shared.map((row) => row.normalizedKeyword)).toEqual([
      'rank tracker',
      'seo audit tool',
    ]);
    expect(result.shared[1]).toMatchObject({
      ownedPosition: 2,
      ownedUrl: 'https://example.com/seo-audit',
      competitorUrl: 'https://rival-one.example/seo-audit',
    });
    expect(result.shared[0]).toMatchObject({
      ownedUrl: null,
      competitorUrl: null,
      searchVolume: null,
      keywordDifficulty: null,
      intent: null,
    });
  });

  it('rebases default comparison URLs to the requested safe origins', async () => {
    const result = await createFakeCompetitorProvider().compareDomains({
      ownedDomain: 'iana.org',
      ownedOrigin: 'https://iana.org',
      competitorDomain: 'example.org',
      competitorOrigin: 'https://example.org',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(result.shared[1]).toMatchObject({
      ownedUrl: 'https://iana.org/seo-audit',
      competitorUrl: 'https://example.org/seo-audit',
    });
    expect(result.competitorOnly[0]?.competitorUrl).toBe(
      'https://example.org/missing-keyword',
    );
  });

  it('competitor fake de-duplicates custom comparison rows and hard-caps each class', async () => {
    const template = FAKE_DOMAIN_COMPARISON.shared[1]!;
    const many = Array.from({ length: 107 }, (_, index) => ({
      ...template,
      keyword: `keyword ${String(index).padStart(3, '0')}`,
      normalizedKeyword: 'ignored-by-normalizer',
      ownedPosition: index + 2,
    }));
    const duplicateWinner = {
      ...many[0]!,
      keyword: ' KEYWORD   000 ',
      ownedPosition: 1,
      ownedUrl: 'https://example.com/winner',
    };
    const comparison: DomainComparisonResult = {
      shared: [...many, duplicateWinner],
      ownedOnly: many,
      competitorOnly: many,
    };
    const result = await createFakeCompetitorProvider({ comparison }).compareDomains({
      ownedDomain: 'example.com',
      ownedOrigin: 'https://example.com',
      competitorDomain: 'rival-one.example',
      competitorOrigin: 'https://rival-one.example',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(result.shared).toHaveLength(100);
    expect(result.ownedOnly).toHaveLength(100);
    expect(result.competitorOnly).toHaveLength(100);
    expect(result.shared[0]).toMatchObject({
      normalizedKeyword: 'keyword 000',
      ownedPosition: 1,
      ownedUrl: 'https://example.com/winner',
    });
  });

  it.each([
    new VendorTimeoutError('timeout', { provider: 'fake', operation: 'domain-comparison' }),
    new VendorMalformedError('malformed', {
      provider: 'fake',
      operation: 'domain-comparison',
    }),
    new VendorQuotaError('quota', { provider: 'fake', operation: 'domain-comparison' }),
  ])('competitor fake injects comparison failure %s', async (failure) => {
    await expect(
      createFakeCompetitorProvider({ comparisonFailure: failure }).compareDomains({
        ownedDomain: 'example.com',
        ownedOrigin: 'https://example.com',
        competitorDomain: 'rival-one.example',
        competitorOrigin: 'https://rival-one.example',
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBe(failure);
  });

  it.each([
    [FAKE_LANDSCAPE_MALFORMED_DOMAIN, VendorMalformedError],
    [FAKE_LANDSCAPE_TIMEOUT_DOMAIN, VendorTimeoutError],
  ])('competitor fake maps the %s landscape sentinel without live traffic', async (domain, ErrorType) => {
    await expect(
      createFakeCompetitorProvider().compareDomains({
        ownedDomain: 'example.com',
        ownedOrigin: 'https://example.com',
        competitorDomain: domain,
        competitorOrigin: `https://${domain}`,
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(ErrorType);
  });

  it('competitor fake serves serp competitors, sliced to the limit', async () => {
    const fake = createFakeCompetitorProvider();
    await expect(
      fake.getSerpCompetitors(['uptime monitor'], 2840, 'en', 1),
    ).resolves.toEqual([FAKE_SERP_COMPETITORS[0]]);
  });

  it('competitor fake scopes serpFailure to getSerpCompetitors only', async () => {
    const unavailable = new VendorUnavailableError('serp down', {
      provider: 'fake',
      operation: 'serp-competitors',
    });
    const fake = createFakeCompetitorProvider({ serpFailure: unavailable });
    // Primary methods stay healthy — "primary ok, fallback fails".
    await expect(fake.getCompetitors('example.com', 2840, 'en', 5)).resolves.toEqual(
      FAKE_COMPETITORS,
    );
    await expect(
      fake.getSerpCompetitors(['uptime monitor'], 2840, 'en', 5),
    ).rejects.toBe(unavailable);
  });

  it('pagespeed fake returns canned scores, with overrides for the no-field-data state', async () => {
    await expect(
      createFakePageSpeedProvider().analyze({ url: 'https://example.com/', strategy: 'mobile' }),
    ).resolves.toBe(FAKE_PAGESPEED_RESULT);
    // coreWebVitals ABSENT = no field data — an expected state, not an error.
    const noFieldData = { labScores: FAKE_PAGESPEED_RESULT.labScores };
    await expect(
      createFakePageSpeedProvider({ result: noFieldData }).analyze({
        url: 'https://example.com/',
        strategy: 'desktop',
      }),
    ).resolves.toBe(noFieldData);
  });

  it('gsc fake returns properties and inspections, with overrides', async () => {
    const connection = { accessToken: 'fake-access' };
    const fake = createFakeGscProvider();
    await expect(fake.listProperties(connection)).resolves.toBe(FAKE_GSC_PROPERTIES);
    await expect(
      fake.inspectUrl(connection, {
        inspectionUrl: 'https://example.com/',
        siteUrl: 'sc-domain:example.com',
      }),
    ).resolves.toBe(FAKE_GSC_INSPECTION);
    const custom = createFakeGscProvider({
      properties: [],
      inspection: { ...FAKE_GSC_INSPECTION, indexVerdict: 'FAIL' as const, lastCrawlTime: null },
    });
    await expect(custom.listProperties(connection)).resolves.toEqual([]);
    await expect(
      custom.inspectUrl(connection, {
        inspectionUrl: 'https://example.com/missing',
        siteUrl: 'sc-domain:example.com',
      }),
    ).resolves.toMatchObject({ indexVerdict: 'FAIL', lastCrawlTime: null });
  });

  it('gsc fake serves search analytics echoing the requested window, with overrides', async () => {
    const connection = { accessToken: 'fake-access' };
    const fake = createFakeGscProvider();
    const result = await fake.querySearchAnalytics(connection, {
      siteUrl: 'sc-domain:example.com',
      startDate: '2026-06-07',
      endDate: '2026-07-04',
      dimensions: ['page'],
    });
    expect(result.rows).toBe(FAKE_GSC_SEARCH_ANALYTICS.rows);
    expect(result.sampled).toBe(true);
    expect(result.startDate).toBe('2026-06-07');
    expect(result.endDate).toBe('2026-07-04');
    expect(result.dimensions).toEqual(['page']);

    const custom = createFakeGscProvider({
      searchAnalytics: { ...FAKE_GSC_SEARCH_ANALYTICS, rows: [] },
    });
    const empty = await custom.querySearchAnalytics(connection, {
      siteUrl: 'sc-domain:example.com',
      startDate: '2026-06-07',
      endDate: '2026-07-04',
      dimensions: ['query'],
    });
    expect(empty.rows).toEqual([]);
  });

  it('ga4 fake returns deterministic properties and per-dimension reports echoing the request', async () => {
    const connection = { accessToken: 'fake-access' };
    const fake = createFakeGa4Provider();
    await expect(fake.listProperties(connection)).resolves.toBe(FAKE_GA4_PROPERTIES);
    await expect(
      fake.listWebDataStreams(connection, 'properties/100000001'),
    ).resolves.toEqual([
      expect.objectContaining({ defaultUri: 'https://example.com' }),
    ]);
    await expect(
      fake.listWebDataStreams(connection, 'properties/unknown'),
    ).resolves.toEqual([]);
    const channel = await fake.runReport(connection, {
      propertyId: 'properties/100000001',
      startDate: '2026-06-15',
      endDate: '2026-07-12',
      dimensions: ['sessionDefaultChannelGroup'],
      metrics: ['sessions', 'activeUsers'],
    });
    expect(channel.rows).toBe(FAKE_GA4_REPORT_CHANNEL.rows);
    expect(channel.startDate).toBe('2026-06-15');
    expect(channel.endDate).toBe('2026-07-12');
    expect(channel.dimensions).toEqual(['sessionDefaultChannelGroup']);
    expect(channel.metrics).toEqual(['sessions', 'activeUsers']);
  });

  it('ga4 fake honours overrides: report map miss falls back, then to the date default', async () => {
    const connection = { accessToken: 'fake-access' };
    const withDefault = createFakeGa4Provider({
      reportByDimension: {},
      report: { ...FAKE_GA4_REPORT_DATE, rowCount: 99 },
    });
    const fromDefault = await withDefault.runReport(connection, {
      propertyId: 'properties/1',
      startDate: '2026-06-15',
      endDate: '2026-07-12',
      dimensions: ['country'],
      metrics: ['sessions'],
    });
    expect(fromDefault.rowCount).toBe(99);

    const bare = createFakeGa4Provider({ reportByDimension: {} });
    const fallback = await bare.runReport(connection, {
      propertyId: 'properties/1',
      startDate: '2026-06-15',
      endDate: '2026-07-12',
      dimensions: ['country'],
      metrics: ['sessions'],
    });
    expect(fallback.rows).toBe(FAKE_GA4_REPORT_DATE.rows);

    const custom = createFakeGa4Provider({
      runReport: async (input) => ({
        rows: [],
        rowCount: 0,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        metrics: input.metrics,
      }),
    });
    const routed = await custom.runReport(connection, {
      propertyId: 'properties/1',
      startDate: '2026-06-15',
      endDate: '2026-07-12',
      dimensions: ['date'],
      metrics: ['sessions'],
    });
    expect(routed.rows).toEqual([]);
  });

  it('ga4 fake failure injection rejects every method', async () => {
    const connection = { accessToken: 'fake-access' };
    const failing = createFakeGa4Provider({
      failure: new VendorQuotaError('quota', { provider: 'fake', operation: 'ga4' }),
    });
    await expect(failing.listProperties(connection)).rejects.toBeInstanceOf(VendorQuotaError);
    await expect(
      failing.listWebDataStreams(connection, 'properties/1'),
    ).rejects.toBeInstanceOf(VendorQuotaError);
    await expect(
      failing.runReport(connection, {
        propertyId: 'properties/1',
        startDate: '2026-06-15',
        endDate: '2026-07-12',
        dimensions: ['date'],
        metrics: ['sessions'],
      }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('gsc fake serves per-dimension search analytics, falling back to the default', async () => {
    const connection = { accessToken: 'fake-access' };
    const fake = createFakeGscProvider({
      searchAnalyticsByDimension: {
        date: FAKE_GSC_SEARCH_ANALYTICS_DATE,
        country: FAKE_GSC_SEARCH_ANALYTICS_COUNTRY,
        device: FAKE_GSC_SEARCH_ANALYTICS_DEVICE,
      },
    });
    const range = { startDate: '2026-06-07', endDate: '2026-07-04' };
    // Mapped dimension → that fixture's rows, with the window echoed.
    const date = await fake.querySearchAnalytics(connection, {
      siteUrl: 'sc-domain:example.com',
      ...range,
      dimensions: ['date'],
    });
    expect(date.rows).toBe(FAKE_GSC_SEARCH_ANALYTICS_DATE.rows);
    expect(date.dimensions).toEqual(['date']);
    expect(date.endDate).toBe('2026-07-04');
    const country = await fake.querySearchAnalytics(connection, {
      siteUrl: 'sc-domain:example.com',
      ...range,
      dimensions: ['country'],
    });
    expect(country.rows).toBe(FAKE_GSC_SEARCH_ANALYTICS_COUNTRY.rows);
    const device = await fake.querySearchAnalytics(connection, {
      siteUrl: 'sc-domain:example.com',
      ...range,
      dimensions: ['device'],
    });
    expect(device.rows).toBe(FAKE_GSC_SEARCH_ANALYTICS_DEVICE.rows);
    // Unmapped dimension → the single default result.
    const query = await fake.querySearchAnalytics(connection, {
      siteUrl: 'sc-domain:example.com',
      ...range,
      dimensions: ['query'],
    });
    expect(query.rows).toBe(FAKE_GSC_SEARCH_ANALYTICS.rows);
  });

  it('gsc fake serves sitemaps (one healthy, one with errors), with overrides', async () => {
    const connection = { accessToken: 'fake-access' };
    const fake = createFakeGscProvider();
    const sitemaps = await fake.listSitemaps(connection, {
      siteUrl: 'sc-domain:example.com',
    });
    expect(sitemaps).toBe(FAKE_GSC_SITEMAPS);
    expect(sitemaps[0]).toMatchObject({ errors: 0, warnings: 0 });
    expect(sitemaps[1]).toMatchObject({ errors: 2 });

    const custom = createFakeGscProvider({ sitemaps: [] });
    await expect(
      custom.listSitemaps(connection, { siteUrl: 'sc-domain:example.com' }),
    ).resolves.toEqual([]);
  });

  it('gsc fake implements the full GoogleGscProvider surface (token refresh + revoke)', async () => {
    const fake = createFakeGscProvider();
    await expect(fake.refreshAccessToken('fake-refresh')).resolves.toEqual({
      accessToken: 'fake-access-token',
      expiresIn: 3600,
    });
    await expect(fake.revokeToken('fake-refresh')).resolves.toBeUndefined();
  });

  it('ai visibility fake returns canned data across all three methods', async () => {
    const fake = createFakeAiVisibilityProvider();
    const before = Date.now();
    // Default canned rows model a LIVE check: same content as the fixtures,
    // but `checkedAt` is stamped at call time so the overview's 30-day
    // recent-mentions window on a long-lived stack still surfaces them.
    const mentions = await fake.checkMentions({
      domain: 'example.com',
      prompts: ['best seo audit tool'],
    });
    expect(mentions.map(({ checkedAt: _mentionAt, ...rest }) => rest)).toEqual(
      FAKE_AI_MENTIONS.map(({ checkedAt: _fixtureAt, ...rest }) => rest),
    );
    for (const row of mentions) {
      expect(row.checkedAt.getTime()).toBeGreaterThanOrEqual(before);
    }
    // The exported fixture itself keeps the deterministic frozen clock.
    expect(FAKE_AI_MENTIONS[0]?.checkedAt).toEqual(FAKE_CLOCK);
    const answers = await fake.getAnswers({
      prompts: ['best seo audit tool'],
      models: ['chatgpt'],
    });
    expect(answers.map(({ checkedAt: _answerAt, ...rest }) => rest)).toEqual(
      FAKE_AI_ANSWERS.map(({ checkedAt: _fixtureAt, ...rest }) => rest),
    );
    for (const row of answers) {
      expect(row.checkedAt.getTime()).toBeGreaterThanOrEqual(before);
    }
    await expect(fake.getAiKeywordVolume(['seo'], 2840, 'en')).resolves.toBe(
      FAKE_AI_KEYWORD_VOLUME,
    );
  });

  it('ai visibility fake honours canned-data overrides', async () => {
    const emptyMentions: typeof FAKE_AI_MENTIONS = [];
    const emptyAnswers: typeof FAKE_AI_ANSWERS = [];
    const emptyVolume: typeof FAKE_AI_KEYWORD_VOLUME = [];
    const fake = createFakeAiVisibilityProvider({
      mentions: emptyMentions,
      answers: emptyAnswers,
      keywordVolume: emptyVolume,
    });
    await expect(
      fake.checkMentions({ domain: 'example.com', prompts: [] }),
    ).resolves.toBe(emptyMentions);
    await expect(
      fake.getAnswers({ prompts: [], models: [] }),
    ).resolves.toBe(emptyAnswers);
    await expect(fake.getAiKeywordVolume([], 2840, 'en')).resolves.toBe(emptyVolume);
  });

  it('ai visibility fake honours per-method override callbacks', async () => {
    const fake = createFakeAiVisibilityProvider({
      checkMentions: async (input) => [
        {
          prompt: input.prompts[0] ?? '',
          model: 'override-model',
          mentioned: true,
          checkedAt: FAKE_CLOCK,
        },
      ],
      getAnswers: async (input) => [
        {
          prompt: input.prompts[0] ?? '',
          model: input.models[0] ?? '',
          answer: 'override answer',
          citations: ['https://cited.example/'],
          checkedAt: FAKE_CLOCK,
        },
      ],
      getAiKeywordVolume: async (keywords) =>
        keywords.map((kw) => ({ keyword: kw, aiSearchVolume: 99 })),
    });
    await expect(
      fake.checkMentions({ domain: 'example.com', prompts: ['seo'] }),
    ).resolves.toEqual([
      { prompt: 'seo', model: 'override-model', mentioned: true, checkedAt: FAKE_CLOCK },
    ]);
    await expect(
      fake.getAnswers({ prompts: ['seo'], models: ['chatgpt'] }),
    ).resolves.toEqual([
      {
        prompt: 'seo',
        model: 'chatgpt',
        answer: 'override answer',
        citations: ['https://cited.example/'],
        checkedAt: FAKE_CLOCK,
      },
    ]);
    await expect(fake.getAiKeywordVolume(['seo'], 2840, 'en')).resolves.toEqual([
      { keyword: 'seo', aiSearchVolume: 99 },
    ]);
  });

  it('failure injection rejects every method with the injected taxonomy error', async () => {
    const failure = new VendorQuotaError('injected quota', {
      provider: 'fake',
      operation: 'any',
      retryAfterSeconds: 60,
    });
    const audit = createFakeAuditProvider({ failure });
    await expect(audit.startAudit({ domain: 'example.com', pageCap: 1 })).rejects.toBe(failure);
    await expect(audit.getAuditStatus('t')).rejects.toBe(failure);
    await expect(audit.getAuditResult('t')).rejects.toBe(failure);

    const unavailable = new VendorUnavailableError('injected 503', {
      provider: 'fake',
      operation: 'any',
    });
    await expect(
      createFakeRankProvider({ failure }).checkRank({
        keyword: 'k',
        domain: 'example.com',
        locationCode: 2840,
        languageCode: 'en',
        device: 'mobile',
      }),
    ).rejects.toBe(failure);
    await expect(
      createFakeRankProvider({ failure }).checkLocalPackRank({
        keyword: 'k',
        domain: 'example.com',
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBe(failure);
    const keyword = createFakeKeywordProvider({ failure: unavailable });
    await expect(keyword.getMetrics(['k'], 2840, 'en')).rejects.toBe(unavailable);
    await expect(keyword.getRelated('k', 2840, 'en', 5)).rejects.toBe(unavailable);
    await expect(keyword.classifyIntent(['k'], 2840, 'en')).rejects.toBe(unavailable);
    await expect(keyword.getIdeas('k', 2840, 'en', 5)).rejects.toBe(unavailable);
    await expect(keyword.getLongTailSuggestions('k', 2840, 'en', 5)).rejects.toBe(unavailable);
    await expect(keyword.getOverview(['k'], 2840, 'en')).rejects.toBe(unavailable);
    await expect(keyword.getHistoricalVolume(['k'], 2840, 'en')).rejects.toBe(unavailable);
    await expect(
      keyword.getRankedKeywordsForSite('example.com', 2840, 'en', 5),
    ).rejects.toBe(unavailable);
    await expect(
      keyword.getKeywordIdeasForSite(['seo audit tool'], 2840, 'en', 5),
    ).rejects.toBe(unavailable);
    const localListings = createFakeLocalListingsProvider({ failure: unavailable });
    await expect(localListings.getBusinessListings('example.com')).rejects.toBe(unavailable);
    await expect(localListings.getReviews('example.com')).rejects.toBe(unavailable);
    await expect(
      localListings.getQuestionsAndAnswers('example.com'),
    ).rejects.toBe(unavailable);
    const backlink = createFakeBacklinkProvider({ failure: unavailable });
    await expect(backlink.getSummary('example.com')).rejects.toBe(unavailable);
    await expect(backlink.listBacklinks('example.com', { limit: 1 })).rejects.toBe(unavailable);
    const competitor = createFakeCompetitorProvider({ failure: unavailable });
    await expect(competitor.getCompetitors('example.com', 2840, 'en', 5)).rejects.toBe(
      unavailable,
    );
    // Provider-wide failure covers getSerpCompetitors too when serpFailure is unset.
    await expect(
      competitor.getSerpCompetitors(['uptime monitor'], 2840, 'en', 5),
    ).rejects.toBe(unavailable);
    await expect(
      competitor.getDomainIntersection('a.example', 'b.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBe(unavailable);
    await expect(
      competitor.compareDomains({
        ownedDomain: 'a.example',
        ownedOrigin: 'https://a.example',
        competitorDomain: 'b.example',
        competitorOrigin: 'https://b.example',
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBe(unavailable);
    await expect(competitor.getTechnologies('example.com')).rejects.toBe(unavailable);
    await expect(
      createFakePageSpeedProvider({ failure: unavailable }).analyze({
        url: 'https://example.com/',
        strategy: 'mobile',
      }),
    ).rejects.toBe(unavailable);
    const gsc = createFakeGscProvider({ failure: unavailable });
    await expect(gsc.listProperties({ accessToken: 't' })).rejects.toBe(unavailable);
    await expect(
      gsc.inspectUrl({ accessToken: 't' }, { inspectionUrl: 'u', siteUrl: 's' }),
    ).rejects.toBe(unavailable);
    await expect(
      gsc.querySearchAnalytics(
        { accessToken: 't' },
        {
          siteUrl: 's',
          startDate: '2026-06-07',
          endDate: '2026-07-04',
          dimensions: ['query'],
        },
      ),
    ).rejects.toBe(unavailable);
    await expect(
      gsc.listSitemaps({ accessToken: 't' }, { siteUrl: 's' }),
    ).rejects.toBe(unavailable);
    await expect(gsc.refreshAccessToken('r')).rejects.toBe(unavailable);
    await expect(gsc.revokeToken('r')).rejects.toBe(unavailable);
    const ai = createFakeAiVisibilityProvider({ failure: unavailable });
    await expect(
      ai.checkMentions({ domain: 'example.com', prompts: ['x'] }),
    ).rejects.toBe(unavailable);
    await expect(
      ai.getAnswers({ prompts: ['x'], models: ['chatgpt'] }),
    ).rejects.toBe(unavailable);
    await expect(ai.getAiKeywordVolume(['x'], 2840, 'en')).rejects.toBe(unavailable);
  });
});

// ---------------------------------------------------------------------------
// searchPublicPages — deterministic fake
// ---------------------------------------------------------------------------

import {
  fakeDiscoverySeed,
  fakeSearchPublicPages,
  FAKE_PUBLIC_PAGE_POOL,
  readFakeDiscoveryForcedFailure,
} from './fakes.js';

const DISCOVERY_MARKET = {
  country: 'US',
  region: null,
  city: null,
  language: 'en',
  device: 'desktop',
} as const;

describe('createFakeRankProvider.searchPublicPages', () => {
  it('is deterministic — identical input yields identical rows', async () => {
    const provider = createFakeRankProvider();
    const input = {
      queries: [
        { id: 'q1', text: 'seo audit problems' },
        { id: 'q2', text: 'audit vs competitor' },
      ],
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 3,
    };
    const a = await provider.searchPublicPages(input);
    const b = await provider.searchPublicPages(input);
    expect(a).toEqual(b);
    expect(a.rows).toHaveLength(6);
  });

  it('surfaces every source-type hint across enough queries', async () => {
    const provider = createFakeRankProvider();
    const result = await provider.searchPublicPages({
      queries: Array.from({ length: 10 }, (_, i) => ({
        id: `q${i}`,
        text: `topic ${i}`,
      })),
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 3,
    });
    const hints = new Set(result.rows.map((r) => r.sourceTypeHint));
    for (const wanted of ['forum', 'review', 'comparison', 'question'] as const) {
      expect(hints.has(wanted)).toBe(true);
    }
  });

  it('exposes at least one row with observedAt=null (dedupe/coverage fixture)', async () => {
    const provider = createFakeRankProvider();
    const result = await provider.searchPublicPages({
      queries: Array.from({ length: 10 }, (_, i) => ({
        id: `q${i}`,
        text: `topic ${i}`,
      })),
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 3,
    });
    expect(result.rows.some((r) => r.observedAt === null)).toBe(true);
  });

  it('canonical URL surfaces on more than one query (dedupe hit)', async () => {
    const provider = createFakeRankProvider();
    const result = await provider.searchPublicPages({
      queries: [
        { id: 'a', text: 'one' },
        { id: 'b', text: 'two' },
        { id: 'c', text: 'three' },
      ],
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 5,
    });
    const seen = new Map<string, number>();
    for (const r of result.rows) {
      seen.set(r.canonicalUrl, (seen.get(r.canonicalUrl) ?? 0) + 1);
    }
    expect([...seen.values()].some((n) => n >= 2)).toBe(true);
  });

  it('honors forcedFailure=timeout', async () => {
    const provider = createFakeRankProvider({ forcedFailure: 'timeout' });
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: 'x' }],
        siteMarket: DISCOVERY_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('honors forcedFailure=malformed', async () => {
    const provider = createFakeRankProvider({ forcedFailure: 'malformed' });
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: 'x' }],
        siteMarket: DISCOVERY_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('honors forcedFailure=empty', async () => {
    const provider = createFakeRankProvider({ forcedFailure: 'empty' });
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q', text: 'x' }],
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 5,
    });
    expect(result.rows).toEqual([]);
  });

  it('resets forcedFailure=null → real deterministic output', async () => {
    const provider = createFakeRankProvider({ forcedFailure: null });
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q', text: 'x' }],
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 2,
    });
    expect(result.rows).toHaveLength(2);
  });

  it('reads env probes __FAKE_FORCE_TIMEOUT / _MALFORMED / _EMPTY', () => {
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_TIMEOUT: '1' })).toBe(
      'timeout',
    );
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_TIMEOUT: 'true' })).toBe(
      'timeout',
    );
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_MALFORMED: '1' })).toBe(
      'malformed',
    );
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_MALFORMED: 'true' })).toBe(
      'malformed',
    );
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_EMPTY: '1' })).toBe('empty');
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_EMPTY: 'true' })).toBe('empty');
    expect(readFakeDiscoveryForcedFailure({})).toBeNull();
    expect(readFakeDiscoveryForcedFailure({ __FAKE_FORCE_TIMEOUT: 'no' })).toBeNull();
  });

  it('env flag on the rank provider is picked up per-instance', async () => {
    const provider = createFakeRankProvider({ env: { __FAKE_FORCE_EMPTY: '1' } });
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q', text: 'x' }],
      siteMarket: DISCOVERY_MARKET,
      perQueryLimit: 1,
    });
    expect(result.rows).toEqual([]);
  });

  it('rejects empty queries with VendorMalformedError', () => {
    expect(() =>
      fakeSearchPublicPages({
        queries: [],
        siteMarket: DISCOVERY_MARKET,
        perQueryLimit: 1,
      }),
    ).toThrow(VendorMalformedError);
  });

  it('failure option still propagates through searchPublicPages', async () => {
    const failure = new VendorQuotaError('cap', {
      provider: 'fake',
      operation: 'discovery',
    });
    const provider = createFakeRankProvider({ failure });
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: 'x' }],
        siteMarket: DISCOVERY_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBe(failure);
  });
});

describe('fakeDiscoverySeed', () => {
  it('is deterministic and non-negative', () => {
    expect(fakeDiscoverySeed('foo')).toBe(fakeDiscoverySeed('foo'));
    expect(fakeDiscoverySeed('bar')).toBeGreaterThanOrEqual(0);
  });
  it('changes with input', () => {
    expect(fakeDiscoverySeed('a')).not.toBe(fakeDiscoverySeed('b'));
  });
  it('handles empty string', () => {
    expect(fakeDiscoverySeed('')).toBeGreaterThanOrEqual(0);
  });
});

describe('FAKE_PUBLIC_PAGE_POOL', () => {
  it('includes every source-type hint plus at least one null observedAt row', () => {
    const hints = new Set(FAKE_PUBLIC_PAGE_POOL.map((p) => p.sourceTypeHint));
    for (const wanted of ['forum', 'review', 'comparison', 'question', 'other'] as const) {
      expect(hints.has(wanted)).toBe(true);
    }
    expect(FAKE_PUBLIC_PAGE_POOL.some((p) => p.observedAt === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Geogrid per-coordinate map-pack fake
// ---------------------------------------------------------------------------

import {
  FAKE_GEOGRID_ALL_FAIL_MARKER,
  FAKE_GEOGRID_FAILING_BUCKET,
  FAKE_GEOGRID_PACK_SIZE,
  FAKE_GEOGRID_PARTIAL_MARKER,
  fakeCoordinateBucket,
  fakeLocalPackForCoordinate,
} from './fakes.js';

describe('fake geogrid coordinate map-pack', () => {
  const rank = createFakeRankProvider();

  it('is deterministic: the same coordinate always yields the same bucket', () => {
    const coordinate = { lat: 30.2672, lng: -97.7431, zoom: 17 };
    expect(fakeCoordinateBucket(coordinate)).toBe(fakeCoordinateBucket(coordinate));
    expect(fakeCoordinateBucket(coordinate)).toBeGreaterThanOrEqual(0);
    expect(fakeCoordinateBucket(coordinate)).toBeLessThanOrEqual(6);
  });

  it('buckets 0..4 are positions 1..5 and 5..6 are not-in-pack', () => {
    const seen = new Set<number | null>();
    for (let i = 0; i < 60; i += 1) {
      const result = fakeLocalPackForCoordinate('coffee', {
        lat: 30 + i * 0.001,
        lng: -97 - i * 0.001,
        zoom: 17,
      });
      expect(result.totalPackSize).toBe(FAKE_GEOGRID_PACK_SIZE);
      if (result.position !== null) {
        expect(result.position).toBeGreaterThanOrEqual(1);
        expect(result.position).toBeLessThanOrEqual(5);
      }
      seen.add(result.position);
    }
    // Both arms of the union are reachable from a plain sweep.
    expect(seen.has(null)).toBe(true);
    expect([...seen].some((p) => typeof p === 'number')).toBe(true);
  });

  it('the partial marker fails exactly the knocked-out bucket', () => {
    let failed = 0;
    let answered = 0;
    for (let i = 0; i < 40; i += 1) {
      const coordinate = { lat: 30 + i * 0.001, lng: -97, zoom: 17 };
      const expectFail = fakeCoordinateBucket(coordinate) === FAKE_GEOGRID_FAILING_BUCKET;
      try {
        fakeLocalPackForCoordinate(`coffee ${FAKE_GEOGRID_PARTIAL_MARKER}`, coordinate);
        answered += 1;
        expect(expectFail).toBe(false);
      } catch (error) {
        failed += 1;
        expect(expectFail).toBe(true);
        expect(error).toBeInstanceOf(VendorUnavailableError);
      }
    }
    expect(failed).toBeGreaterThan(0);
    expect(answered).toBeGreaterThan(0);
  });

  it('the all-fail marker fails every cell', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(() =>
        fakeLocalPackForCoordinate(`coffee ${FAKE_GEOGRID_ALL_FAIL_MARKER}`, {
          lat: 30 + i * 0.001,
          lng: -97,
          zoom: 17,
        }),
      ).toThrow(VendorUnavailableError);
    }
  });

  it('the provider routes coordinate input to the coordinate fake', async () => {
    const coordinate = { lat: 30.2672, lng: -97.7431, zoom: 17 };
    await expect(
      rank.checkLocalPackRank({
        keyword: 'dentist',
        domain: 'example.com',
        languageCode: 'en',
        coordinate,
      }),
    ).resolves.toEqual(fakeLocalPackForCoordinate('dentist', coordinate));
  });

  it('the provider keeps the shipped location_code answer unchanged', async () => {
    await expect(
      rank.checkLocalPackRank({
        keyword: 'dentist',
        domain: 'example.com',
        languageCode: 'en',
        locationCode: 2840,
      }),
    ).resolves.toEqual(FAKE_LOCAL_PACK_RESULT);
  });

  it('an explicit localPackResult override still wins over the coordinate fake', async () => {
    const pinned = { position: 9, totalPackSize: 9, checkedAt: new Date(0) };
    const provider = createFakeRankProvider({ localPackResult: pinned });
    await expect(
      provider.checkLocalPackRank({
        keyword: 'dentist',
        domain: 'example.com',
        languageCode: 'en',
        coordinate: { lat: 1, lng: 2, zoom: 17 },
      }),
    ).resolves.toEqual(pinned);
  });
});
