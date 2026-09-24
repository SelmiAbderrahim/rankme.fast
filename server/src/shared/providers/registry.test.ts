import { describe, expect, it } from 'vitest';
import {
  createProviderRegistry,
  providerSelectionFromEnv,
  providerSelectionSchema,
  type ProviderSelection,
} from './index.js';
import { createFakeAiGenerationProvider } from './ai-generation-fake.js';

const ALL_FAKE: ProviderSelection = {
  audit: 'fake',
  rank: 'fake',
  keyword: 'fake',
  backlink: 'fake',
  competitor: 'fake',
  localListings: 'fake',
  pagespeed: 'fake',
  gsc: 'fake',
  ga4: 'fake',
  summary: 'fake',
  aiVisibility: 'fake',
  contentSource: 'fake',
  contentAnalysis: 'fake',
  reviews: 'fake',
  trends: 'fake',
  appData: 'fake',
};

describe('provider registry', () => {
  it('builds every provider from an all-fake selection', async () => {
    const registry = createProviderRegistry(ALL_FAKE);
    await expect(registry.audit.startAudit({ domain: 'example.com', pageCap: 1 })).resolves.toEqual(
      { vendorTaskId: 'fake-audit-task-1' },
    );
    await expect(
      registry.rank.checkRank({
        keyword: 'k',
        domain: 'example.com',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      }),
    ).resolves.toMatchObject({ position: 3 });
    await expect(registry.keyword.getMetrics(['k'], 2840, 'en')).resolves.toHaveLength(2);
    await expect(registry.localListings.getBusinessListings('example.com')).resolves.toHaveLength(
      3,
    );
    await expect(registry.backlink.getSummary('example.com')).resolves.toMatchObject({
      backlinks: 1543,
    });
    await expect(registry.competitor.getCompetitors('example.com', 2840, 'en', 5)).resolves.toHaveLength(
      2,
    );
    expect(typeof registry.competitor.compareDomains).toBe('function');
    await expect(
      registry.pagespeed.analyze({ url: 'https://example.com/', strategy: 'mobile' }),
    ).resolves.toMatchObject({ labScores: { performance: 92 } });
    await expect(registry.gsc.listProperties({ accessToken: 't' })).resolves.toHaveLength(2);
    await expect(registry.ga4.listProperties({ accessToken: 't' })).resolves.toHaveLength(2);
    await expect(
      registry.aiVisibility.checkMentions({ domain: 'example.com', prompts: ['seo'] }),
    ).resolves.toHaveLength(3);
    await expect(
      registry.contentSource.scrapePage({
        url: 'https://example.com/',
        formats: ['markdown', 'metadata'],
        timeoutMs: 1_000,
        maxCharacters: 1_000,
      }),
    ).resolves.toMatchObject({ usage: { credits: 1 } });
    expect(typeof registry.appData.searchApps).toBe('function');
  });

  it('content source fake boots keyless; live requires a key and rejects unknown selection', () => {
    expect(createProviderRegistry(ALL_FAKE).contentSource).toBeDefined();
    expect(() => createProviderRegistry({ ...ALL_FAKE, contentSource: 'firecrawl' })).toThrow(
      /FIRECRAWL_API_KEY/,
    );
    const live = createProviderRegistry(
      { ...ALL_FAKE, contentSource: 'firecrawl' },
      {
        logger: console as never,
        firecrawl: {
          apiKey: 'test-key',
          fallbackApiKeys: ['fallback-test-key'],
          baseUrl: 'https://api.firecrawl.dev',
          timeoutMs: 1_000,
          maxPageCharacters: 1_000,
          maxCrawlPages: 10,
          costMicrosPerCredit: 1_000,
          zdrEnabled: true,
        },
      },
    );
    expect(typeof live.contentSource.crawlSite).toBe('function');
    // Content monitoring shares the PROVIDER_CONTENT_SOURCE selection.
    expect(typeof live.contentMonitor.createMonitor).toBe('function');
    const liveWithoutLogger = createProviderRegistry(
      { ...ALL_FAKE, contentSource: 'firecrawl' },
      {
        firecrawl: {
          apiKey: 'test-key',
          baseUrl: 'https://api.firecrawl.dev',
          timeoutMs: 1_000,
          maxPageCharacters: 1_000,
          maxCrawlPages: 10,
          costMicrosPerCredit: 1_000,
          zdrEnabled: true,
        },
      },
    );
    expect(typeof liveWithoutLogger.contentMonitor.createMonitor).toBe('function');
    expect(typeof createProviderRegistry(ALL_FAKE).contentMonitor.normalizeWebhookDelivery).toBe(
      'function',
    );
    expect(
      providerSelectionSchema.safeParse({ ...ALL_FAKE, contentSource: 'unknown' }).success,
    ).toBe(false);
  });

  it.each([false, undefined] as const)(
    'content source live refuses to boot without operator ZDR attestation (zdrEnabled=%p)',
    (zdrEnabled) => {
      expect(() =>
        createProviderRegistry(
          { ...ALL_FAKE, contentSource: 'firecrawl' },
          {
            firecrawl: {
              apiKey: 'test-key',
              baseUrl: 'https://api.firecrawl.dev',
              timeoutMs: 1_000,
              maxPageCharacters: 1_000,
              maxCrawlPages: 10,
              costMicrosPerCredit: 1_000,
              zdrEnabled: zdrEnabled as unknown as boolean,
            },
          },
        ),
      ).toThrow(/FIRECRAWL_ZDR_ENABLED=true/);
    },
  );

  it('ga4=google without OAuth creds fails startup loudly; with creds it builds', () => {
    expect(() => createProviderRegistry({ ...ALL_FAKE, ga4: 'google' })).toThrow(
      /PROVIDER_GA4=google requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/,
    );
    const registry = createProviderRegistry(
      { ...ALL_FAKE, ga4: 'google' },
      { googleOAuth: { clientId: 'id', clientSecret: 'secret' } },
    );
    expect(typeof registry.ga4.listProperties).toBe('function');
    expect(typeof registry.ga4.runReport).toBe('function');
  });

  it('ga4=google threads the registry logger into the adapter (logger branch)', () => {
    const logger = {
      child: () => logger,
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      trace: () => {},
    } as never;
    const registry = createProviderRegistry(
      { ...ALL_FAKE, ga4: 'google', rank: 'dataforseo' },
      {
        googleOAuth: { clientId: 'id', clientSecret: 'secret' },
        dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' },
        serpLiveDepth: 20,
        logger,
      },
    );
    expect(typeof registry.ga4.runReport).toBe('function');
    expect(typeof registry.rank.checkRank).toBe('function');
  });

  it('threads explicit async SERP polling bounds into the live rank adapter', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, rank: 'dataforseo' },
      {
        dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' },
        serpTaskPollIntervalMs: 25,
        serpTaskMaxPollAttempts: 4,
      },
    );
    expect(typeof registry.rank.checkRank).toBe('function');
  });

  it('rejects an unknown PROVIDER_GA4 value', () => {
    expect(providerSelectionSchema.safeParse({ ...ALL_FAKE, ga4: 'dataforseo' }).success).toBe(
      false,
    );
  });

  it('wires the DataForSEO AI Visibility adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, aiVisibility: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.aiVisibility.checkMentions).toBe('function');
    expect(typeof registry.aiVisibility.getAnswers).toBe('function');
    expect(typeof registry.aiVisibility.getAiKeywordVolume).toBe('function');
  });

  it('fails startup when DataForSEO AI Visibility selected without credentials', () => {
    expect(() =>
      createProviderRegistry({ ...ALL_FAKE, aiVisibility: 'dataforseo' }),
    ).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
  });

  it('wires the DataForSEO backlink adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, backlink: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.backlink.getSummary).toBe('function');
    expect(typeof registry.backlink.listBacklinks).toBe('function');
  });

  it('wires the DataForSEO competitor adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, competitor: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.competitor.getCompetitors).toBe('function');
    expect(typeof registry.competitor.getDomainIntersection).toBe('function');
    expect(typeof registry.competitor.compareDomains).toBe('function');
  });

  it('wires the DataForSEO local listings adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, localListings: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.localListings.getBusinessListings).toBe('function');
    expect(typeof registry.localListings.getReviews).toBe('function');
    expect(typeof registry.localListings.getQuestionsAndAnswers).toBe('function');
  });

  it('fails startup when DataForSEO backlink/competitor selected without credentials', () => {
    expect(() => createProviderRegistry({ ...ALL_FAKE, backlink: 'dataforseo' })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    expect(() => createProviderRegistry({ ...ALL_FAKE, competitor: 'dataforseo' })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    expect(() => createProviderRegistry({ ...ALL_FAKE, localListings: 'dataforseo' })).toThrow(
      /PROVIDER_LOCAL_LISTINGS=dataforseo requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it('wires the DataForSEO keyword adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, keyword: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.keyword.getMetrics).toBe('function');
    expect(typeof registry.keyword.getRelated).toBe('function');
  });

  it('fails startup when DataForSEO keyword is selected without credentials', () => {
    expect(() => createProviderRegistry({ ...ALL_FAKE, keyword: 'dataforseo' })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it('fails startup when a selected adapter has not shipped yet', () => {
    // pagespeed=google is SHIPPED — verify it demands GOOGLE_API_KEY.
    expect(() => createProviderRegistry({ ...ALL_FAKE, pagespeed: 'google' })).toThrow(
      /PROVIDER_PAGESPEED=google requires GOOGLE_API_KEY/,
    );
    expect(() => createProviderRegistry({ ...ALL_FAKE, gsc: 'google' })).toThrow(
      /PROVIDER_GSC=google requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/,
    );
  });

  it('eagerly builds every capability — a gsc=google caller still needs dataForSeo when other caps are dataforseo', () => {
    // Regression: server.ts once built a second registry to grab only `.gsc`,
    // passing googleOAuth but NOT dataForSeo. createProviderRegistry is eager
    // (selectImpl runs the real factory immediately), so the dataforseo audit
    // provider threw at boot the moment Google OAuth creds were present. The
    // registry contract is correct — the fix is that callers must pass ONE
    // shared options object carrying every credential.
    expect(() =>
      createProviderRegistry(
        { ...ALL_FAKE, audit: 'dataforseo', rank: 'dataforseo', gsc: 'google' },
        { googleOAuth: { clientId: 'id', clientSecret: 'secret' } },
      ),
    ).toThrow(/PROVIDER_AUDIT=dataforseo requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);

    // With the full options object every capability builds, gsc included.
    const registry = createProviderRegistry(
      { ...ALL_FAKE, audit: 'dataforseo', rank: 'dataforseo', gsc: 'google' },
      {
        dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' },
        googleOAuth: { clientId: 'id', clientSecret: 'secret' },
      },
    );
    expect(typeof registry.gsc.listProperties).toBe('function');
    expect(typeof registry.audit.startAudit).toBe('function');
  });

  it('wires the Google GSC adapter when selected with OAuth credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, gsc: 'google' },
      { googleOAuth: { clientId: 'id', clientSecret: 'secret' } },
    );
    expect(typeof registry.gsc.listProperties).toBe('function');
    expect(typeof registry.gsc.inspectUrl).toBe('function');
  });

  it('passes the registry logger through to the Google GSC adapter', () => {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      trace: () => {},
    } as never;
    const registry = createProviderRegistry(
      { ...ALL_FAKE, gsc: 'google' },
      { googleOAuth: { clientId: 'id', clientSecret: 'secret' }, logger },
    );
    expect(typeof registry.gsc.listProperties).toBe('function');
  });

  it('rejects PROVIDER_GSC=google with a missing clientSecret', () => {
    expect(() =>
      createProviderRegistry(
        { ...ALL_FAKE, gsc: 'google' },
        { googleOAuth: { clientId: 'id', clientSecret: '' } },
      ),
    ).toThrow(/PROVIDER_GSC=google requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
  });

  it('wires the Google PageSpeed adapter when selected with GOOGLE_API_KEY', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, pagespeed: 'google' },
      { google: { apiKey: 'test-key' } },
    );
    expect(typeof registry.pagespeed.analyze).toBe('function');
  });

  it('wires the DataForSEO PageSpeed adapter with the shared credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, pagespeed: 'dataforseo' },
      {
        dataForSeo: {
          login: 'l',
          password: 'p',
          baseUrl: 'https://api.dataforseo.com/v3',
        },
      },
    );
    expect(typeof registry.pagespeed.analyze).toBe('function');
  });

  it('passes the registry logger through to the DataForSEO PageSpeed adapter', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, pagespeed: 'dataforseo' },
      {
        dataForSeo: {
          login: 'l',
          password: 'p',
          baseUrl: 'https://api.dataforseo.com/v3',
        },
        logger: console as never,
      },
    );

    expect(typeof registry.pagespeed.analyze).toBe('function');
  });

  it('fails startup when DataForSEO PageSpeed is selected without credentials', () => {
    expect(() =>
      createProviderRegistry({ ...ALL_FAKE, pagespeed: 'dataforseo' }),
    ).toThrow(
      /PROVIDER_PAGESPEED=dataforseo requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it('passes the registry logger through to the Google PageSpeed adapter', () => {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      trace: () => {},
    } as never;
    const registry = createProviderRegistry(
      { ...ALL_FAKE, pagespeed: 'google' },
      { google: { apiKey: 'test-key' }, logger },
    );
    expect(typeof registry.pagespeed.analyze).toBe('function');
  });

  it('rejects PROVIDER_PAGESPEED=google with an empty apiKey', () => {
    expect(() =>
      createProviderRegistry(
        { ...ALL_FAKE, pagespeed: 'google' },
        { google: { apiKey: '' } },
      ),
    ).toThrow(/PROVIDER_PAGESPEED=google requires GOOGLE_API_KEY/);
  });

  it('wires the DataForSEO SERP rank adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, rank: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.rank.checkRank).toBe('function');
  });

  it('passes a configured SERP depth through to the DataForSEO rank adapter', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, rank: 'dataforseo' },
      {
        dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' },
        serpDepth: 50,
      },
    );
    expect(typeof registry.rank.checkRank).toBe('function');
  });

  it('fails startup when DataForSEO rank is selected without credentials', () => {
    expect(() => createProviderRegistry({ ...ALL_FAKE, rank: 'dataforseo' })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it('wires the DataForSEO on-page audit adapter when selected with credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, audit: 'dataforseo' },
      { dataForSeo: { login: 'l', password: 'p', baseUrl: 'https://api.dataforseo.com/v3' } },
    );
    expect(typeof registry.audit.startAudit).toBe('function');
  });

  it('fails startup when DataForSEO audit is selected without credentials', () => {
    expect(() => createProviderRegistry({ ...ALL_FAKE, audit: 'dataforseo' })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    expect(() =>
      createProviderRegistry(
        { ...ALL_FAKE, audit: 'dataforseo' },
        { dataForSeo: { login: '', password: '', baseUrl: 'https://api.dataforseo.com/v3' } },
      ),
    ).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
  });

  it('fails startup on an unknown selection value', () => {
    expect(() =>
      createProviderRegistry({ ...ALL_FAKE, rank: 'bogus' } as unknown as ProviderSelection),
    ).toThrow();
    expect(providerSelectionSchema.safeParse({ ...ALL_FAKE, gsc: 'dataforseo' }).success).toBe(
      false,
    );
  });

  it('maps PROVIDER_* env vars onto the selection', () => {
    expect(
      providerSelectionFromEnv({
        PROVIDER_AUDIT: 'fake',
        PROVIDER_RANK: 'dataforseo',
        PROVIDER_KEYWORD: 'fake',
        PROVIDER_BACKLINK: 'dataforseo',
        PROVIDER_COMPETITOR: 'fake',
        PROVIDER_LOCAL_LISTINGS: 'dataforseo',
        PROVIDER_PAGESPEED: 'google',
        PROVIDER_GSC: 'google',
        PROVIDER_GA4: 'google',
        PROVIDER_SUMMARY: 'anthropic',
        PROVIDER_AI_VISIBILITY: 'dataforseo',
        PROVIDER_CONTENT_SOURCE: 'firecrawl',
        PROVIDER_CONTENT_ANALYSIS: 'dataforseo',
        PROVIDER_REVIEWS: 'dataforseo',
        PROVIDER_TRENDS: 'dataforseo',
        PROVIDER_APP_DATA: 'fake',
      }),
    ).toEqual({
      audit: 'fake',
      rank: 'dataforseo',
      keyword: 'fake',
      backlink: 'dataforseo',
      competitor: 'fake',
      localListings: 'dataforseo',
      pagespeed: 'google',
      gsc: 'google',
      ga4: 'google',
      summary: 'anthropic',
      aiVisibility: 'dataforseo',
      contentSource: 'firecrawl',
      contentAnalysis: 'dataforseo',
      reviews: 'dataforseo',
      trends: 'dataforseo',
      appData: 'fake',
    });
  });

  it('content analysis + reviews boot on fakes by default', async () => {
    const registry = createProviderRegistry(ALL_FAKE);
    expect(typeof registry.contentAnalysis.searchMentions).toBe('function');
    expect(typeof registry.contentAnalysis.getMentionSummary).toBe('function');
    expect(typeof registry.reviews.getReviews).toBe('function');
    const mentions = await registry.contentAnalysis.searchMentions({
      query: 'rankme',
      limit: 10,
    });
    expect(Array.isArray(mentions)).toBe(true);
    const summary = await registry.contentAnalysis.getMentionSummary({
      query: 'rankme',
      limit: 10,
    });
    expect(summary.totalMentions).toBeGreaterThanOrEqual(0);
    const reviews = await registry.reviews.getReviews({
      source: 'google',
      target: 'place_id:ChIJexample',
      depth: 10,
    });
    expect(reviews.source).toBe('google');
  });

  it('trends boots on fakes by default and exposes explore', async () => {
    const registry = createProviderRegistry(ALL_FAKE);
    expect(typeof registry.trends.explore).toBe('function');
    const result = await registry.trends.explore({ keywords: ['rankme'] });
    expect(Array.isArray(result.series)).toBe(true);
  });

  it('trends live requires DATAFORSEO_LOGIN/PASSWORD and builds when supplied', () => {
    expect(() =>
      createProviderRegistry({ ...ALL_FAKE, trends: 'dataforseo' }),
    ).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
    const live = createProviderRegistry(
      { ...ALL_FAKE, trends: 'dataforseo' },
      {
        dataForSeo: {
          login: 'sandbox-login',
          password: 'sandbox-password',
          baseUrl: 'https://api.dataforseo.com/v3',
        },
      },
    );
    expect(typeof live.trends.explore).toBe('function');
  });

  it('rejects an unknown PROVIDER_TRENDS value', () => {
    expect(
      providerSelectionSchema.safeParse({ ...ALL_FAKE, trends: 'bogus' }).success,
    ).toBe(false);
  });

  it('fails closed for invalid or keyless app data selections and boots the fake', () => {
    expect(
      providerSelectionSchema.safeParse({ ...ALL_FAKE, appData: 'bogus' }).success,
    ).toBe(false);
    expect(() =>
      createProviderRegistry({ ...ALL_FAKE, appData: 'dataforseo' }),
    ).toThrow(
      /PROVIDER_APP_DATA=dataforseo requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    expect(createProviderRegistry(ALL_FAKE).appData).toBeDefined();
  });

  it('boots the DataForSEO app data adapter only with explicit credentials', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, appData: 'dataforseo' },
      {
        dataForSeo: {
          login: 'sandbox-login',
          password: 'sandbox-password',
          baseUrl: 'https://dataforseo.mock/v3',
        },
      },
    );
    expect(typeof registry.appData.searchApps).toBe('function');
    expect(typeof registry.appData.bulkAppMetrics).toBe('function');
  });

  it.each(['contentAnalysis', 'reviews'] as const)(
    '%s live requires DATAFORSEO_LOGIN/PASSWORD',
    (kind) => {
      expect(() =>
        createProviderRegistry({ ...ALL_FAKE, [kind]: 'dataforseo' } as ProviderSelection),
      ).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
      const live = createProviderRegistry(
        { ...ALL_FAKE, [kind]: 'dataforseo' } as ProviderSelection,
        {
          dataForSeo: {
            login: 'sandbox-login',
            password: 'sandbox-password',
            baseUrl: 'https://api.dataforseo.com/v3',
          },
        },
      );
      expect(live[kind]).toBeDefined();
    },
  );

  it.each(['contentAnalysis', 'reviews'] as const)(
    'rejects an unknown %s selection value',
    (kind) => {
      expect(
        providerSelectionSchema.safeParse({ ...ALL_FAKE, [kind]: 'bogus' }).success,
      ).toBe(false);
    },
  );

  it('rejects an unknown PROVIDER_AI_VISIBILITY value', () => {
    expect(
      providerSelectionSchema.safeParse({ ...ALL_FAKE, aiVisibility: 'bogus' }).success,
    ).toBe(false);
  });

  it('summary is null when AI helper is disabled', () => {
    const registry = createProviderRegistry(ALL_FAKE);
    expect(registry.summary).toBeNull();
    const explicitlyOff = createProviderRegistry(ALL_FAKE, {
      anthropic: { enabled: false, apiKey: 'k' },
    });
    expect(explicitlyOff.summary).toBeNull();
  });

  it('summary is the fake when enabled + PROVIDER_SUMMARY=fake', async () => {
    const registry = createProviderRegistry(ALL_FAKE, {
      anthropic: { enabled: true },
    });
    expect(registry.summary).not.toBeNull();
    const result = await registry.summary!.summarize({
      findings: [],
      locale: 'en',
      siteDomain: 'x.com',
    });
    expect(result.summary).toBeTruthy();
  });

  it('summary is null when enabled + anthropic selected but no API key', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, summary: 'anthropic' },
      { anthropic: { enabled: true } },
    );
    expect(registry.summary).toBeNull();
  });

  it('summary is anthropic when enabled + key present', () => {
    const registry = createProviderRegistry(
      { ...ALL_FAKE, summary: 'anthropic' },
      {
        anthropic: {
          enabled: true,
          apiKey: 'sk',
          model: 'claude-haiku-4-5',
          inputCostMicrosPerMillion: 1,
          outputCostMicrosPerMillion: 1,
        },
      },
    );
    expect(registry.summary).not.toBeNull();
    expect(typeof registry.summary!.summarize).toBe('function');
  });

  it('summary AI SDK mode requires and uses the ordered generation runtime', () => {
    expect(() => createProviderRegistry(
      { ...ALL_FAKE, summary: 'ai-sdk' },
      { anthropic: { enabled: true } },
    )).toThrow(/configured AI generation runtime/);

    const aiGeneration = {
      ordered: createFakeAiGenerationProvider(),
      providerOrder: ['openai'] as const,
    };
    const registry = createProviderRegistry(
      { ...ALL_FAKE, summary: 'ai-sdk' },
      {
        anthropic: { enabled: true },
        aiGeneration,
      },
    );
    expect(registry.summary).not.toBeNull();
    expect(createProviderRegistry(
      { ...ALL_FAKE, summary: 'ai-sdk' },
      {
        anthropic: { enabled: true },
        aiGeneration: { ...aiGeneration, recordRun: async () => {} },
      },
    ).summary).not.toBeNull();
  });

  it.each([
    { inputCostMicrosPerMillion: 1 },
    { outputCostMicrosPerMillion: 1 },
  ])('legacy summary rejects either missing cost rate', (rates) => {
    expect(() => createProviderRegistry(
      { ...ALL_FAKE, summary: 'anthropic' },
      { anthropic: { enabled: true, apiKey: 'sk', ...rates } },
    )).toThrow(/ANTHROPIC_INPUT_COST.*ANTHROPIC_OUTPUT_COST/);
  });

  it('summary anthropic path passes logger through', () => {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      trace: () => {},
    } as never;
    const registry = createProviderRegistry(
      { ...ALL_FAKE, summary: 'anthropic' },
      {
        anthropic: {
          enabled: true,
          apiKey: 'sk',
          inputCostMicrosPerMillion: 1,
          outputCostMicrosPerMillion: 1,
          totalTimeoutMs: 1_000,
          telemetryEnabled: true,
        },
        aiGeneration: {
          ordered: createFakeAiGenerationProvider(),
          providerOrder: ['openai'],
          recordRun: async () => {},
        },
        logger,
      },
    );
    expect(registry.summary).not.toBeNull();
  });

  it('the real env defaults build a working all-fake registry', async () => {
    const { env, envSchema } = await import('../../config/env.js');
    const defaults = envSchema.parse({
      ...process.env,
      PROVIDER_AUDIT: undefined,
      PROVIDER_RANK: undefined,
      PROVIDER_KEYWORD: undefined,
      PROVIDER_BACKLINK: undefined,
      PROVIDER_COMPETITOR: undefined,
      PROVIDER_LOCAL_LISTINGS: undefined,
      PROVIDER_PAGESPEED: undefined,
      PROVIDER_GSC: undefined,
      PROVIDER_GA4: undefined,
      PROVIDER_SUMMARY: undefined,
      PROVIDER_AI_VISIBILITY: undefined,
      PROVIDER_CONTENT_SOURCE: undefined,
      PROVIDER_CONTENT_ANALYSIS: undefined,
      PROVIDER_REVIEWS: undefined,
      PROVIDER_TRENDS: undefined,
      PROVIDER_APP_DATA: undefined,
    });
    expect(env).toBeDefined();
    const registry = createProviderRegistry(providerSelectionFromEnv(defaults));
    await expect(registry.gsc.listProperties({ accessToken: 't' })).resolves.toHaveLength(2);
    expect(registry.summary).toBeNull();
    expect(typeof registry.appData.getAppInfo).toBe('function');
  });
});
