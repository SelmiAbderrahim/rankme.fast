/**
 * Route + service tests: keyword CRUD, cadence, history,
 * scheduler wiring. Uses the same real-Better-Auth + PGlite + Mongo-memory
 * harness the sites/audits tests use.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { Site } from '../sites/index.js';
import {
  keywords as keywordsTable,
  rankings as rankingsTable,
  domainStates,
} from '../../db/schema/keywords.js';
import { vendorCache, vendorResponses } from '../../db/schema/vendor-cache.js';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { eq } from 'drizzle-orm';
import * as scheduler from '../../shared/queue/schedulers.js';
import { setRanksDb, setRanksQueue } from './ranks.queue-holder.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { env } from '../../config/env.js';
import { AuditLog } from '../audit/index.js';
import {
  setKeywordDiscoveryContentSourceProvider,
  setKeywordProvider,
} from '../keyword-research/index.js';
import { createFakeKeywordProvider } from '../../shared/providers/fakes.js';
import { createFakeContentSourceProvider } from '../../shared/providers/content-source-fake.js';
import { VendorAuthError, VendorUnavailableError } from '../../shared/providers/errors.js';
import {
  createKeyword,
  requireReturnedKeyword,
} from './keywords.service.js';

const app = createApp();

async function seedUser(email = 'ranker@x.co'): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = 'example.com') {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
    gscPropertyUrl: `sc-domain:${domain}`,
    gscBindingGenerationId: 'keyword-suggestions-test-generation',
  });
  return site.id as string;
}

const fakeQueue = () => ({
  upsertJobScheduler: vi.fn(async () => undefined),
  removeJobScheduler: vi.fn(async () => true),
  // enqueueRankJob (immediate/manual on-demand checks) calls queue.add.
  add: vi.fn(async () => ({ id: 'manual-rank-job' })),
});

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setRanksDb(db as unknown as never);
  setKeywordProvider(createFakeKeywordProvider());
  setKeywordDiscoveryContentSourceProvider(createFakeContentSourceProvider());
});
afterAll(async () => {
  uninstallTestAuth();
  setRanksDb(null);
  setKeywordProvider(null);
  setKeywordDiscoveryContentSourceProvider(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setRanksQueue(null);
  setKeywordProvider(createFakeKeywordProvider());
  setKeywordDiscoveryContentSourceProvider(createFakeContentSourceProvider());
  vi.restoreAllMocks();
});

/** One stored Search Console `query` row for the suggestion source. */
async function seedGscQuery(input: {
  accountId: string;
  siteId: string;
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  windowDays?: number;
  snapshotDate?: string;
  fetchedAt?: Date;
  bindingGenerationId?: string;
}) {
  await getTestDb().insert(gscSearchAnalytics).values({
    accountId: input.accountId,
    siteId: input.siteId,
    bindingGenerationId: input.bindingGenerationId ?? 'keyword-suggestions-test-generation',
    snapshotDate: input.snapshotDate ?? '2026-08-01',
    dimensionSet: 'query',
    windowDays: input.windowDays ?? 28,
    dimensionKey: input.query,
    clicks: input.clicks,
    impressions: input.impressions,
    ctr: input.impressions === 0 ? 0 : input.clicks / input.impressions,
    position: input.position,
    ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
  });
}

describe('POST /api/sites/:siteId/keyword-suggestions — Search Console source', () => {
  it('prefers stored Search Console queries without a vendor call', async () => {
    const user = await seedUser('gsc-suggest@x.co');
    const siteId = await seedSite(user.id, 'gsc.example.com');
    const base = createFakeKeywordProvider();
    const ranked = vi.fn(base.getRankedKeywordsForSite);
    setKeywordProvider({ ...base, getRankedKeywordsForSite: ranked });
    const contentSource = createFakeContentSourceProvider();
    const crawlSite = vi.fn(contentSource.crawlSite);
    setKeywordDiscoveryContentSourceProvider({ ...contentSource, crawlSite });

    // Ordering fixture: impressions desc, then clicks desc, then key asc —
    // one pair per comparator leg. `top` is fetched latest but sorts first,
    // so the fetchedAt reduce exercises both of its branches.
    await seedGscQuery({
      accountId: user.id, siteId, query: 'pay stub generator',
      clicks: 12, impressions: 900, position: 14.2,
      fetchedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    await seedGscQuery({
      accountId: user.id, siteId, query: 'free paystub maker',
      clicks: 9, impressions: 400, position: 22.5,
      fetchedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await seedGscQuery({
      accountId: user.id, siteId, query: 'aaa equal impressions',
      clicks: 3, impressions: 400, position: 31,
      fetchedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await seedGscQuery({
      accountId: user.id, siteId, query: 'zzz equal impressions',
      clicks: 3, impressions: 400, position: 33,
      fetchedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    // Filler rows lift the untracked count past MIN_UNTRACKED_SUGGESTIONS so
    // the blend stops at Search Console and the no-spend property holds.
    for (let i = 0; i < 6; i += 1) {
      await seedGscQuery({
        accountId: user.id, siteId, query: `filler query ${i}`,
        clicks: 1, impressions: 50 - i, position: 40 + i,
        fetchedAt: new Date('2026-08-01T00:00:00.000Z'),
      });
    }

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('gsc');
    expect(res.body.sources).toEqual(['gsc']);
    expect(res.body.fallbackStatus).toBe('not_needed');
    expect(res.body.cached).toBe(true);
    // Max fetchedAt across the snapshot, not the first row's.
    expect(res.body.fetchedAt).toBe('2026-08-02T00:00:00.000Z');
    expect(
      res.body.candidates.slice(0, 4).map((c: { keyword: string }) => c.keyword),
    ).toEqual([
      'pay stub generator',
      'free paystub maker',
      'aaa equal impressions',
      'zzz equal impressions',
    ]);
    expect(res.body.candidates[0]).toMatchObject({
      keyword: 'pay stub generator',
      source: 'gsc',
      tracked: false,
      currentPosition: 14.2,
      estimatedTraffic: 12,
      // GSC reports neither — stay null rather than invent a figure.
      searchVolume: null,
      difficulty: null,
      rankingUrl: null,
    });
    // The whole point: no vendor call.
    expect(ranked).not.toHaveBeenCalled();
    expect(crawlSite).not.toHaveBeenCalled();
  });

  it('falls back to a wider window when the default one has no rows', async () => {
    const user = await seedUser('gsc-window@x.co');
    const siteId = await seedSite(user.id, 'gsc-window.example.com');
    await seedGscQuery({
      accountId: user.id, siteId, query: 'ninety day only',
      clicks: 4, impressions: 120, position: 41, windowDays: 90,
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('gsc');
    // One GSC row is under the blend minimum, so vendor sources top up the
    // list — but the Search Console row stays first.
    expect(res.body.candidates[0].keyword).toBe('ninety day only');
    expect(res.body.candidates[0].source).toBe('gsc');
    expect(res.body.sources).toContain('ranked');
  });

  it('reads legacy Search Console rows when the bound site has no generation id', async () => {
    const user = await seedUser('gsc-legacy@x.co');
    const siteId = await seedSite(user.id, 'gsc-legacy.example.com');
    await Site.updateOne({ _id: siteId }, { $unset: { gscBindingGenerationId: 1 } });
    await seedGscQuery({
      accountId: user.id,
      siteId,
      query: 'legacy search query',
      clicks: 4,
      impressions: 100,
      position: 12,
      bindingGenerationId: 'legacy',
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('gsc');
    expect(res.body.candidates[0]).toMatchObject({
      keyword: 'legacy search query',
      source: 'gsc',
    });
  });

  it('does not reuse Search Console rows after the site property is disconnected', async () => {
    const user = await seedUser('gsc-disconnected@x.co');
    const siteId = await seedSite(user.id, 'gsc-disconnected.example.com');
    await seedGscQuery({
      accountId: user.id,
      siteId,
      query: 'orphaned search query',
      clicks: 4,
      impressions: 100,
      position: 12,
    });
    await Site.updateOne(
      { _id: siteId },
      { $unset: { gscPropertyUrl: 1, gscBindingGenerationId: 1 } },
    );

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ranked');
    expect(res.body.candidates).not.toContainEqual(
      expect.objectContaining({ keyword: 'orphaned search query' }),
    );
  });

  it('skips the Search Console source when every stored query is already tracked', async () => {
    const user = await seedUser('gsc-tracked@x.co');
    const siteId = await seedSite(user.id, 'gsc-tracked.example.com');
    await seedGscQuery({
      accountId: user.id, siteId, query: 'already tracked query',
      clicks: 5, impressions: 200, position: 18,
    });
    await getTestDb().insert(keywordsTable).values({
      accountId: user.id,
      siteId,
      phrase: 'Already   Tracked Query ',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    // A list with nothing addable is not a usable answer — move on to the
    // vendor tiers. (The two fake ranked rows are still under the blend
    // minimum, so site ideas run too.)
    expect(res.body.source).toBe('ranked');
    // The tracked Search Console row stays in the payload, greyed out.
    expect(res.body.candidates).toContainEqual(
      expect.objectContaining({
        keyword: 'already tracked query',
        source: 'gsc',
        tracked: true,
      }),
    );
  });

  it('falls through to site ideas when every ranked candidate is already tracked', async () => {
    const user = await seedUser('ranked-tracked@x.co');
    const siteId = await seedSite(user.id, 'ranked-tracked.example.com');
    // Both fake ranked keywords are already on the account.
    for (const phrase of ['seo audit tool', 'website audit checklist']) {
      await getTestDb().insert(keywordsTable).values({
        accountId: user.id,
        siteId,
        phrase,
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      });
    }

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('site_ideas');
    expect(res.body.fallbackStatus).toBe('used');
    expect(res.body.candidates.some((c: { tracked: boolean }) => !c.tracked)).toBe(true);
  });

  it('ignores another site\'s Search Console rows', async () => {
    const user = await seedUser('gsc-scope@x.co');
    const siteId = await seedSite(user.id, 'gsc-scope.example.com');
    const otherSiteId = await seedSite(user.id, 'gsc-other.example.com');
    await seedGscQuery({
      accountId: user.id, siteId: otherSiteId, query: 'other site query',
      clicks: 7, impressions: 300, position: 11,
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ranked');
  });

  it('blends a thin Search Console list with vendor sources and dedupes by phrase', async () => {
    const user = await seedUser('gsc-blend@x.co');
    const siteId = await seedSite(user.id, 'gsc-blend.example.com');
    // Newer than the live vendor tiers, so freshness keeps the GSC stamp.
    const gscFetchedAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Deduping is by normalized phrase — the GSC casing/spacing variant of the
    // fake provider's top ranked keyword must swallow the vendor duplicate.
    await seedGscQuery({
      accountId: user.id, siteId, query: 'SEO  Audit Tool',
      clicks: 2, impressions: 60, position: 25,
      fetchedAt: gscFetchedAt,
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('gsc');
    expect(res.body.sources.slice(0, 2)).toEqual(['gsc', 'ranked']);
    expect(res.body.fetchedAt).toBe(gscFetchedAt.toISOString());
    const phrases = res.body.candidates.map((c: { keyword: string }) => c.keyword);
    expect(phrases[0]).toBe('SEO  Audit Tool');
    expect(phrases).not.toContain('seo audit tool');
    expect(res.body.candidates).toContainEqual(
      expect.objectContaining({ keyword: 'website audit checklist', source: 'ranked' }),
    );
  });

});

describe('POST /api/sites/:siteId/keyword-suggestions', () => {
  it('returns ranked candidates and marks tracked phrases', async () => {
    const user = await seedUser('suggestions@x.co');
    const siteId = await seedSite(user.id);
    await getTestDb().insert(keywordsTable).values({
      accountId: user.id,
      siteId,
      phrase: '  SEO   Audit Tool ',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
    // Enough untracked ranked rows to satisfy the blend minimum, so site
    // ideas stay out of this test.
    setKeywordProvider(createFakeKeywordProvider({
      rankedSiteKeywords: [
        {
          keyword: 'seo audit tool',
          searchVolume: 5400,
          difficulty: 62,
          currentPosition: 4,
          estimatedTraffic: 630.5,
          rankingUrl: 'https://example.com/seo-audit',
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          keyword: `ranked filler ${i}`,
          searchVolume: 1000 - i,
          difficulty: 30,
          currentPosition: 20 + i,
          estimatedTraffic: 10,
          rankingUrl: null,
        })),
      ],
    }));
    const contentSource = createFakeContentSourceProvider();
    const crawlSite = vi.fn(contentSource.crawlSite);
    setKeywordDiscoveryContentSourceProvider({ ...contentSource, crawlSite });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'EN' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ranked');
    expect(res.body.sources).toEqual(['ranked']);
    expect(res.body.fallbackStatus).toBe('not_needed');
    expect(res.body.candidates[0]).toMatchObject({
      keyword: 'seo audit tool',
      currentPosition: 4,
      tracked: true,
      source: 'ranked',
    });
    expect(crawlSite).not.toHaveBeenCalled();
  });

  it('uses site ideas only when the ranked footprint is empty', async () => {
    const user = await seedUser('fallback@x.co');
    const siteId = await seedSite(user.id, 'fallback.example.com');
    const base = createFakeKeywordProvider({
      rankedSiteKeywords: [],
      siteKeywordIdeas: [
        {
          keyword: 'episode summaries generator',
          searchVolume: 1_900,
          difficulty: 37,
          currentPosition: null,
          estimatedTraffic: null,
          rankingUrl: null,
        },
        {
          keyword: 'sign up',
          searchVolume: 49_500,
          difficulty: 80,
          currentPosition: null,
          estimatedTraffic: null,
          rankingUrl: null,
        },
      ],
    });
    const ideas = vi.fn(base.getKeywordIdeasForSite);
    setKeywordProvider({ ...base, getKeywordIdeasForSite: ideas });
    const contentSource = createFakeContentSourceProvider({
      mode: 'partial',
      metadataKeywords: ['podcast summary', 'episode brief'],
      headings: [{ level: 1, text: 'Podcast episode summaries' }],
    });
    const crawlSite = vi.fn(contentSource.crawlSite);
    setKeywordDiscoveryContentSourceProvider({ ...contentSource, crawlSite });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('site_ideas');
    expect(res.body.fallbackStatus).toBe('used');
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0]).toMatchObject({
      keyword: 'episode summaries generator',
      source: 'site_ideas',
      currentPosition: null,
      tracked: false,
    });
    expect(crawlSite).toHaveBeenCalledWith({
      origin: 'https://fallback.example.com',
      allowlistedPaths: [],
      maxPages: 3,
      depth: 1,
      concurrency: 3,
      timeoutMs: 20_000,
    });
    expect(ideas).toHaveBeenCalledWith(
      expect.arrayContaining(['podcast summary', 'episode brief']),
      2840,
      'en',
      100,
    );
  });

  it('returns an honest empty site-ideas response when neither source has candidates', async () => {
    const user = await seedUser('suggest-empty@x.co');
    const siteId = await seedSite(user.id, 'empty.example.com');
    setKeywordProvider(createFakeKeywordProvider({
      rankedSiteKeywords: [],
      siteKeywordIdeas: [],
    }));

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: 'site_ideas',
      candidates: [],
      fallbackStatus: 'used',
    });
  });

  it('fails closed without calling Labs when the bounded crawl is cancelled', async () => {
    const user = await seedUser('suggest-cancelled@x.co');
    const siteId = await seedSite(user.id, 'cancelled.example.com');
    const base = createFakeKeywordProvider({ rankedSiteKeywords: [] });
    const ideas = vi.fn(base.getKeywordIdeasForSite);
    setKeywordProvider({ ...base, getKeywordIdeasForSite: ideas });
    setKeywordDiscoveryContentSourceProvider(
      createFakeContentSourceProvider({ mode: 'cancelled' }),
    );

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'site_ideas', candidates: [] });
    expect(ideas).not.toHaveBeenCalled();
  });

  it('fails closed without calling Labs when a completed crawl has no same-origin documents', async () => {
    const user = await seedUser('suggest-no-documents@x.co');
    const siteId = await seedSite(user.id, 'no-documents.example.com');
    const base = createFakeKeywordProvider({ rankedSiteKeywords: [] });
    const ideas = vi.fn(base.getKeywordIdeasForSite);
    setKeywordProvider({ ...base, getKeywordIdeasForSite: ideas });
    const contentSource = createFakeContentSourceProvider();
    setKeywordDiscoveryContentSourceProvider({
      ...contentSource,
      crawlSite: async (input) => {
        const result = await contentSource.crawlSite(input);
        return {
          ...result,
          documents: [
            { ...result.documents[0]!, sourceUrl: 'https://outside.example/page' },
            { ...result.documents[0]!, sourceUrl: 'not a URL' },
          ],
        };
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'site_ideas', candidates: [] });
    expect(ideas).not.toHaveBeenCalled();
  });

  it('fails closed without calling Labs when crawled metadata has no usable seeds', async () => {
    const user = await seedUser('suggest-no-seeds@x.co');
    const siteId = await seedSite(user.id, 'no-seeds.example.com');
    const base = createFakeKeywordProvider({ rankedSiteKeywords: [] });
    const ideas = vi.fn(base.getKeywordIdeasForSite);
    setKeywordProvider({ ...base, getKeywordIdeasForSite: ideas });
    const contentSource = createFakeContentSourceProvider();
    setKeywordDiscoveryContentSourceProvider({
      ...contentSource,
      crawlSite: async (input) => {
        const result = await contentSource.crawlSite(input);
        return {
          ...result,
          documents: result.documents.map((row) => ({
            ...row,
            title: null,
            description: null,
            metadataKeywords: [],
            headings: [],
          })),
        };
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'site_ideas', candidates: [] });
    expect(ideas).not.toHaveBeenCalled();
  });

  it('degrades to ranked rows when the site crawl vendor rejects', async () => {
    const user = await seedUser('ideas-vendor-down@x.co');
    const siteId = await seedSite(user.id, 'ideas-vendor-down.example.com');
    const base = createFakeKeywordProvider({
      rankedSiteKeywords: [{
        keyword: 'ranked only',
        searchVolume: 900,
        difficulty: 30,
        currentPosition: 12,
        estimatedTraffic: 40,
        rankingUrl: 'https://ideas-vendor-down.example.com/',
      }],
    });
    const ideas = vi.fn(base.getKeywordIdeasForSite);
    setKeywordProvider({ ...base, getKeywordIdeasForSite: ideas });
    const contentSource = createFakeContentSourceProvider();
    setKeywordDiscoveryContentSourceProvider({
      ...contentSource,
      crawlSite: async () => {
        throw new VendorAuthError('credentials rejected (HTTP 403)', { provider: 'firecrawl', operation: 'crawl' });
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: 'ranked',
      sources: ['ranked'],
      fallbackStatus: 'provider_unavailable',
    });
    expect(res.body.candidates).toHaveLength(1);
    expect(ideas).not.toHaveBeenCalled();
  });

  it('still fails closed when the crawl vendor rejects and no tier produced rows', async () => {
    const user = await seedUser('ideas-vendor-down-empty@x.co');
    const siteId = await seedSite(user.id, 'ideas-vendor-down-empty.example.com');
    setKeywordProvider(createFakeKeywordProvider({ rankedSiteKeywords: [] }));
    const contentSource = createFakeContentSourceProvider();
    setKeywordDiscoveryContentSourceProvider({
      ...contentSource,
      crawlSite: async () => {
        throw new VendorAuthError('credentials rejected (HTTP 403)', { provider: 'firecrawl', operation: 'crawl' });
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('KEYWORD_RESEARCH_ERRORS_UNAVAILABLE');
  });

  it('does not swallow non-vendor crawl failures', async () => {
    const user = await seedUser('ideas-crawl-bug@x.co');
    const siteId = await seedSite(user.id, 'ideas-crawl-bug.example.com');
    setKeywordProvider(createFakeKeywordProvider({ rankedSiteKeywords: [] }));
    const contentSource = createFakeContentSourceProvider();
    setKeywordDiscoveryContentSourceProvider({
      ...contentSource,
      crawlSite: async () => {
        throw new Error('boom');
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(500);
  });

  it('shares public-domain cache rows across accounts', async () => {
    const first = await seedUser('cache-a@x.co');
    const second = await seedUser('cache-b@x.co');
    const firstSite = await seedSite(first.id, 'shared.example.com');
    const secondSite = await seedSite(second.id, 'shared.example.com');
    // Enough ranked rows to satisfy the blend minimum — site ideas stay out,
    // keeping this a pure ranked-cache test.
    const base = createFakeKeywordProvider({
      rankedSiteKeywords: Array.from({ length: 10 }, (_, i) => ({
        keyword: `shared ranked ${i}`,
        searchVolume: 1000 - i,
        difficulty: 30,
        currentPosition: 5 + i,
        estimatedTraffic: 10,
        rankingUrl: null,
      })),
    });
    const ranked = vi.fn(base.getRankedKeywordsForSite);
    setKeywordProvider({ ...base, getRankedKeywordsForSite: ranked });

    const one = await request(app)
      .post(`/api/sites/${firstSite}/keyword-suggestions`)
      .set('Cookie', first.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });
    const two = await request(app)
      .post(`/api/sites/${secondSite}/keyword-suggestions`)
      .set('Cookie', second.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(one.body.cached).toBe(false);
    expect(two.body.cached).toBe(true);
    expect(ranked).toHaveBeenCalledTimes(1);
  });

  it('caches only the grounded fallback list and reuses it across matching origins', async () => {
    const first = await seedUser('ideas-cache-a@x.co');
    const second = await seedUser('ideas-cache-b@x.co');
    const firstSite = await seedSite(first.id, 'ideas-shared.example.com');
    const secondSite = await seedSite(second.id, 'ideas-shared.example.com');
    const base = createFakeKeywordProvider({
      rankedSiteKeywords: [],
      siteKeywordIdeas: [
        {
          keyword: 'podcast summary generator',
          searchVolume: 2_400,
          difficulty: 42,
          currentPosition: null,
          estimatedTraffic: null,
          rankingUrl: null,
        },
        {
          keyword: 'outlook sign in',
          searchVolume: 450_000,
          difficulty: 91,
          currentPosition: null,
          estimatedTraffic: null,
          rankingUrl: null,
        },
      ],
    });
    const ranked = vi.fn(base.getRankedKeywordsForSite);
    const ideas = vi.fn(base.getKeywordIdeasForSite);
    setKeywordProvider({
      ...base,
      getRankedKeywordsForSite: ranked,
      getKeywordIdeasForSite: ideas,
    });
    const contentSource = createFakeContentSourceProvider({
      metadataKeywords: ['podcast summary'],
    });
    const crawlSite = vi.fn(contentSource.crawlSite);
    setKeywordDiscoveryContentSourceProvider({ ...contentSource, crawlSite });

    const one = await request(app)
      .post(`/api/sites/${firstSite}/keyword-suggestions`)
      .set('Cookie', first.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });
    const two = await request(app)
      .post(`/api/sites/${secondSite}/keyword-suggestions`)
      .set('Cookie', second.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(one.body).toMatchObject({
      source: 'site_ideas',
      cached: false,
      candidates: [{ keyword: 'podcast summary generator' }],
    });
    expect(two.body).toMatchObject({
      source: 'site_ideas',
      cached: true,
      candidates: [{ keyword: 'podcast summary generator' }],
    });
    expect(ranked).toHaveBeenCalledTimes(1);
    expect(crawlSite).toHaveBeenCalledTimes(1);
    expect(ideas).toHaveBeenCalledTimes(1);
  });

  it('returns cross-account 404 before provider access', async () => {
    const owner = await seedUser('suggest-owner@x.co');
    const other = await seedUser('suggest-other@x.co');
    const siteId = await seedSite(owner.id, 'private.example.com');
    const base = createFakeKeywordProvider();
    const ranked = vi.fn(base.getRankedKeywordsForSite);
    setKeywordProvider({ ...base, getRankedKeywordsForSite: ranked });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', other.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(404);
    expect(ranked).not.toHaveBeenCalled();
  });

  it('returns 404 for an invalid site id before provider access', async () => {
    const user = await seedUser('suggest-invalid@x.co');

    const res = await request(app)
      .post('/api/sites/not-an-object-id/keyword-suggestions')
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(404);
  });

  it('localizes provider failures and stores no cache/archive row', async () => {
    const user = await seedUser('suggest-down@x.co');
    const siteId = await seedSite(user.id, 'down.example.com');
    setKeywordProvider(createFakeKeywordProvider({
      failure: new VendorUnavailableError('down', {
        provider: 'fake',
        operation: 'site-ranked-keywords',
      }),
    }));

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.keywordResearch.errors.unavailable);
    expect(await getTestDb().select().from(vendorCache)).toHaveLength(0);
    expect(await getTestDb().select().from(vendorResponses)).toHaveLength(0);
  });

  it('does not misclassify an unexpected provider fault as a vendor outage', async () => {
    const user = await seedUser('suggest-bug@x.co');
    const siteId = await seedSite(user.id, 'bug.example.com');
    const provider = createFakeKeywordProvider();
    setKeywordProvider({
      ...provider,
      getRankedKeywordsForSite: async () => {
        throw new TypeError('unexpected provider implementation fault');
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.internal);
  });

  it('rejects invalid market input', async () => {
    const user = await seedUser('suggest-invalid@x.co');
    const siteId = await seedSite(user.id, 'invalid.example.com');
    const res = await request(app)
      .post(`/api/sites/${siteId}/keyword-suggestions`)
      .set('Cookie', user.cookie)
      .send({ locationCode: 0, languageCode: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sites/:siteId/keywords', () => {
  it('defaults direct service callers to local-pack tracking off', async () => {
    const user = await seedUser('direct-default@x.co');
    const siteId = await seedSite(user.id, 'direct-default.example.com');

    const created = await createKeyword(
      {
        accountId: user.id,
        siteId,
        phrase: 'direct service default',
        locationCode: 2840,
        languageCode: 'EN',
        device: 'desktop',
        engine: 'google',
        engineTarget: null,
      },
      { db: getTestDb() as unknown as never, ranksQueue: null },
    );

    expect(created.trackLocalPack).toBe(false);
    const [stored] = await getTestDb()
      .select({ trackLocalPack: keywordsTable.trackLocalPack })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, created.id));
    expect(stored?.trackLocalPack).toBe(false);
  });

  it('fails explicitly if a database insert returns no keyword row', () => {
    expect(() => requireReturnedKeyword([])).toThrow('errors.internal');
  });

  it('creates a keyword, seeds domain_states, upserts scheduler', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);
    const spy = vi.spyOn(scheduler, 'upsertRankSchedule').mockResolvedValue(undefined as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'seo audit', locationCode: 2840, languageCode: 'en', device: 'desktop' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe(DICTIONARIES.en.ranks.keywordAdded);
    expect(res.body.keyword.phrase).toBe('seo audit');
    expect(spy).toHaveBeenCalledWith(
      q,
      expect.objectContaining({ siteId, cadence: 'weekly' }),
    );

    const domainRow = await getTestDb()
      .select()
      .from(domainStates)
      .where(eq(domainStates.siteId, siteId));
    expect(domainRow).toHaveLength(1);

    const audit = await AuditLog.findOne({
      actorUserId: user.id,
      action: 'keyword.add',
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('keyword');
    expect(audit?.targetId).toBe(res.body.keyword.id);
  });

  it('rejects duplicate keyword with a localized 409', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const body = { phrase: 'dup', locationCode: 1, languageCode: 'en', device: 'desktop' };
    const first = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send(body);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send(body);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe(DICTIONARIES.en.ranks.errors.keywordDuplicate);
  });

  it('cross-account 404 when the site does not belong to the caller', async () => {
    const a = await seedUser('a@x.co');
    const b = await seedUser('b@x.co');
    const siteOfA = await seedSite(a.id);
    const res = await request(app)
      .post(`/api/sites/${siteOfA}/keywords`)
      .set('Cookie', b.cookie)
      .send({ phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' });
    expect(res.status).toBe(404);
  });

  it('rejects blank phrases', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: '   ', locationCode: 1, languageCode: 'en', device: 'desktop' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sites/:siteId/keywords', () => {
  it('lists with latest position + delta vs previous check', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    const kw = (await db
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    await db.insert(rankingsTable).values([
      { keywordId: kw.id, position: 5, rankAbsolute: 5, source: 'fresh', checkedAt: new Date('2026-07-01T00:00:00Z') },
      {
        keywordId: kw.id,
        position: 3,
        rankAbsolute: 3,
        source: 'cache',
        checkedAt: new Date('2026-07-08T00:00:00Z'),
        aiOverviewPresent: true,
        aiCited: true,
        aiCitedUrl: 'https://site-0.example/guide',
      },
    ]);

    const res = await request(app).get(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.keywords[0].latestPosition).toBe(3);
    expect(res.body.keywords[0].previousPosition).toBe(5);
    expect(res.body.keywords[0].delta).toBe(2);
    // AI Overview signal from the latest check flows through the list.
    expect(res.body.keywords[0].aiOverviewPresent).toBe(true);
    expect(res.body.keywords[0].aiCited).toBe(true);
    expect(res.body.keywords[0].aiCitedUrl).toBe('https://site-0.example/guide');
  });

  it('returns null delta when there is no prior check', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    await db
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' });
    const res = await request(app).get(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.keywords[0].latestPosition).toBeNull();
    expect(res.body.keywords[0].delta).toBeNull();
    expect(res.body.keywords[0].lastFailedCheckAt).toBeNull();
  });

  it('surfaces lastFailedCheckAt for a keyword whose check errored (no ranking row)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    const failedAt = new Date('2026-07-05T00:00:00.000Z');
    await db.insert(keywordsTable).values({
      accountId: user.id,
      siteId,
      phrase: 'k',
      locationCode: 1,
      languageCode: 'en',
      device: 'desktop',
      lastFailedCheckAt: failedAt,
    });
    const res = await request(app).get(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    // No ranking row → the failed-attempt timestamp surfaces so the UI renders
    // "check failed" instead of the never-checked "unavailable" state.
    expect(res.body.keywords[0].latestPosition).toBeNull();
    expect(res.body.keywords[0].lastCheckedAt).toBeNull();
    expect(res.body.keywords[0].lastFailedCheckAt).toBe(failedAt.toISOString());
  });

  it('cross-account 404', async () => {
    const a = await seedUser('a@y.co');
    const b = await seedUser('b@y.co');
    const siteOfA = await seedSite(a.id);
    const res = await request(app).get(`/api/sites/${siteOfA}/keywords`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('paginates with a cursor', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    for (let i = 0; i < 3; i += 1) {
      await db.insert(keywordsTable).values({
        accountId: user.id,
        siteId,
        phrase: `k-${i}`,
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      });
    }
    const first = await request(app)
      .get(`/api/sites/${siteId}/keywords?limit=2`)
      .set('Cookie', user.cookie);
    expect(first.body.keywords).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app)
      .get(`/api/sites/${siteId}/keywords?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', user.cookie);
    expect(second.body.keywords).toHaveLength(1);
  });

  it('applies the engine filter before pagination across the stored result set', async () => {
    const user = await seedUser('rank-engine-filter@x.co');
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    await db.insert(keywordsTable).values([
      {
        accountId: user.id,
        siteId,
        phrase: 'new google one',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
        engine: 'google',
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      },
      {
        accountId: user.id,
        siteId,
        phrase: 'new google two',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
        engine: 'google',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
      },
      {
        accountId: user.id,
        siteId,
        phrase: 'newest bing result',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
        engine: 'bing',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      },
      {
        accountId: user.id,
        siteId,
        phrase: 'older bing result',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
        engine: 'bing',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        accountId: user.id,
        siteId,
        phrase: 'oldest bing result',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
        engine: 'bing',
        createdAt: new Date('2026-06-30T00:00:00.000Z'),
      },
    ]);

    const unfiltered = await request(app)
      .get(`/api/sites/${siteId}/keywords?limit=2`)
      .set('Cookie', user.cookie);
    expect(unfiltered.body.keywords.map((row: { engine: string }) => row.engine)).toEqual([
      'google',
      'google',
    ]);

    const filtered = await request(app)
      .get(`/api/sites/${siteId}/keywords?limit=2&engine=bing`)
      .set('Cookie', user.cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.keywords).toMatchObject([
      { phrase: 'newest bing result', engine: 'bing' },
      { phrase: 'older bing result', engine: 'bing' },
    ]);
    expect(filtered.body.nextCursor).toBeTruthy();

    const filteredNext = await request(app)
      .get(
        `/api/sites/${siteId}/keywords?limit=2&engine=bing&cursor=${filtered.body.nextCursor}`,
      )
      .set('Cookie', user.cookie);
    expect(filteredNext.status).toBe(200);
    expect(filteredNext.body.keywords).toMatchObject([
      { phrase: 'oldest bing result', engine: 'bing' },
    ]);

    const invalid = await request(app)
      .get(`/api/sites/${siteId}/keywords?engine=askjeeves`)
      .set('Cookie', user.cookie);
    expect(invalid.status).toBe(400);
  });
});

describe('GET /api/sites/:siteId/keywords — cursor pagination', () => {
  it('paginates losslessly when keywords share created_at', async () => {
    const user = await seedUser('cursor-same-ts@x.co');
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    // Three keywords sharing one created_at timestamp — the tuple compare
    // over (createdAt, id) must produce a total ordering.
    const sameTs = new Date('2026-07-01T00:00:00Z');
    const inserted = await db
      .insert(keywordsTable)
      .values([
        { accountId: user.id, siteId, phrase: 'a', locationCode: 1, languageCode: 'en', device: 'desktop', createdAt: sameTs, updatedAt: sameTs },
        { accountId: user.id, siteId, phrase: 'b', locationCode: 1, languageCode: 'en', device: 'desktop', createdAt: sameTs, updatedAt: sameTs },
        { accountId: user.id, siteId, phrase: 'c', locationCode: 1, languageCode: 'en', device: 'desktop', createdAt: sameTs, updatedAt: sameTs },
      ])
      .returning();
    const allIds = new Set(inserted.map((r) => r.id));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 5 && (i === 0 || cursor); i += 1) {
      const url = cursor
        ? `/api/sites/${siteId}/keywords?limit=1&cursor=${cursor}`
        : `/api/sites/${siteId}/keywords?limit=1`;
      const res = await request(app).get(url).set('Cookie', user.cookie);
      expect(res.status).toBe(200);
      for (const kw of res.body.keywords as Array<{ id: string }>) {
        expect(seen.has(kw.id)).toBe(false);
        seen.add(kw.id);
      }
      cursor = res.body.nextCursor ?? undefined;
    }
    expect(seen.size).toBe(allIds.size);
    for (const id of allIds) expect(seen.has(id)).toBe(true);
  });

  it('rejects a non-uuid cursor with 400, not a 500', async () => {
    const user = await seedUser('cursor-bad@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/keywords?cursor=not-a-uuid`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.ranks.errors.unknownCursor,
    );
  });

  it('rejects an unknown-but-well-formed cursor with 400', async () => {
    const user = await seedUser('cursor-unknown@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(
        `/api/sites/${siteId}/keywords?cursor=00000000-0000-4000-8000-000000000000`,
      )
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.ranks.errors.unknownCursor,
    );
  });

  it('rejects a foreign-account cursor with 400 (never leaks the row)', async () => {
    const a = await seedUser('foreign-a@x.co');
    const b = await seedUser('foreign-b@x.co');
    const siteA = await seedSite(a.id);
    const siteB = await seedSite(b.id, 'b.example.com');
    const db = getTestDb();
    const kwA = (await db
      .insert(keywordsTable)
      .values({ accountId: a.id, siteId: siteA, phrase: 'a', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    // B tries to paginate B's site using A's keyword id → 400.
    const res = await request(app)
      .get(`/api/sites/${siteB}/keywords?cursor=${kwA.id}`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/keywords/:id', () => {
  it('deactivates the owner\'s keyword', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const kw = (await getTestDb()
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    const res = await request(app).delete(`/api/keywords/${kw.id}`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const row = (await getTestDb().select().from(keywordsTable).where(eq(keywordsTable.id, kw.id)))[0]!;
    expect(row.active).toBe(false);
  });

  it('hides the deactivated keyword from the list and re-adding it reactivates the same row', async () => {
    const user = await seedUser('soft-delete@x.co');
    const siteId = await seedSite(user.id);
    const body = { phrase: 'gone', locationCode: 1, languageCode: 'en', device: 'desktop' };
    const created = await request(app).post(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie).send(body);
    expect(created.status).toBe(201);
    const id = created.body.keyword.id as string;

    const del = await request(app).delete(`/api/keywords/${id}`).set('Cookie', user.cookie);
    expect(del.status).toBe(200);
    const list = await request(app).get(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie);
    expect(list.status).toBe(200);
    expect(list.body.keywords).toEqual([]);

    // A second remove is a harmless no-op.
    const again = await request(app).delete(`/api/keywords/${id}`).set('Cookie', user.cookie);
    expect(again.status).toBe(200);
    // An inactive row cannot be used as a pagination cursor.
    const cursor = await request(app).get(`/api/sites/${siteId}/keywords?cursor=${id}`).set('Cookie', user.cookie);
    expect(cursor.status).toBe(400);

    // "This can be undone by adding it back" — same tuple reactivates the row.
    const readd = await request(app).post(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie).send(body);
    expect(readd.status).toBe(201);
    expect(readd.body.keyword.id).toBe(id);
    const row = (await getTestDb().select().from(keywordsTable).where(eq(keywordsTable.id, id)))[0]!;
    expect(row.active).toBe(true);
    const relist = await request(app).get(`/api/sites/${siteId}/keywords`).set('Cookie', user.cookie);
    expect(relist.body.keywords.map((k: { id: string }) => k.id)).toEqual([id]);
  });

  it('cross-account 404', async () => {
    const a = await seedUser('a@z.co');
    const b = await seedUser('b@z.co');
    const siteOfA = await seedSite(a.id);
    const kw = (await getTestDb()
      .insert(keywordsTable)
      .values({ accountId: a.id, siteId: siteOfA, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    const res = await request(app).delete(`/api/keywords/${kw.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('removes the rank schedule when the last active keyword is deactivated', async () => {
    const user = await seedUser('last-kw@x.co');
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);
    const kw = (await getTestDb()
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'only', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    const removeSpy = vi
      .spyOn(scheduler, 'removeRankSchedule')
      .mockResolvedValue(true);
    const res = await request(app)
      .delete(`/api/keywords/${kw.id}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(removeSpy).toHaveBeenCalledWith(q, siteId);
  });

  it('does NOT remove the schedule when other active keywords remain for the site', async () => {
    const user = await seedUser('some-kw@x.co');
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);
    const [k1, _k2] = await getTestDb()
      .insert(keywordsTable)
      .values([
        { accountId: user.id, siteId, phrase: 'a', locationCode: 1, languageCode: 'en', device: 'desktop' },
        { accountId: user.id, siteId, phrase: 'b', locationCode: 1, languageCode: 'en', device: 'desktop' },
      ])
      .returning();
    const removeSpy = vi
      .spyOn(scheduler, 'removeRankSchedule')
      .mockResolvedValue(true);
    const res = await request(app)
      .delete(`/api/keywords/${k1!.id}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('tolerates a null ranks queue holder on the last-keyword branch', async () => {
    const user = await seedUser('null-q@x.co');
    const siteId = await seedSite(user.id);
    setRanksQueue(null);
    const kw = (await getTestDb()
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'only', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    const res = await request(app)
      .delete(`/api/keywords/${kw.id}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/sites/:siteId/rank-cadence', () => {
  it('daily is allowed for every account and reschedules the site', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);
    const spy = vi.spyOn(scheduler, 'upsertRankSchedule').mockResolvedValue(undefined as never);
    const res = await request(app)
      .patch(`/api/sites/${siteId}/rank-cadence`)
      .set('Cookie', user.cookie)
      .send({ cadence: 'daily' });
    expect(res.status).toBe(200);
    expect(res.body.cadence).toBe('daily');
    expect(spy).toHaveBeenCalledWith(q, expect.objectContaining({ cadence: 'daily' }));
  });

  it('switching cadence updates domain_states', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .patch(`/api/sites/${siteId}/rank-cadence`)
      .set('Cookie', user.cookie)
      .send({ cadence: 'weekly' });
    expect(res.status).toBe(200);
    const row = (await getTestDb().select().from(domainStates).where(eq(domainStates.siteId, siteId)))[0]!;
    expect(row.cadence).toBe('weekly');
  });
});

describe('GET /api/keywords/:id/history', () => {
  it('returns ordered ISO 8601 series (ascending checkedAt)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    const kw = (await db
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    await db.insert(rankingsTable).values([
      {
        keywordId: kw.id,
        position: 5,
        rankAbsolute: 5,
        source: 'fresh',
        checkedAt: new Date('2026-07-08T00:00:00Z'),
        aiOverviewPresent: true,
        aiCited: false,
      },
      { keywordId: kw.id, position: 3, rankAbsolute: 3, source: 'cache', checkedAt: new Date('2026-07-01T00:00:00Z') },
    ]);
    const res = await request(app).get(`/api/keywords/${kw.id}/history`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].checkedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(res.body.series[1].checkedAt).toBe('2026-07-08T00:00:00.000Z');
    // Pre-feature row → nulls; new row carries the AI Overview signal.
    expect(res.body.series[0].aiOverviewPresent).toBeNull();
    expect(res.body.series[0].aiCited).toBeNull();
    expect(res.body.series[1].aiOverviewPresent).toBe(true);
    expect(res.body.series[1].aiCited).toBe(false);
    expect(res.body.series[1].aiCitedUrl).toBeNull();
  });

  it('honours ?from&to bounds', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const db = getTestDb();
    const kw = (await db
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    await db.insert(rankingsTable).values([
      { keywordId: kw.id, position: 5, rankAbsolute: 5, source: 'fresh', checkedAt: new Date('2026-07-01T00:00:00Z') },
      { keywordId: kw.id, position: 3, rankAbsolute: 3, source: 'cache', checkedAt: new Date('2026-07-08T00:00:00Z') },
      { keywordId: kw.id, position: 4, rankAbsolute: 4, source: 'fresh', checkedAt: new Date('2026-07-15T00:00:00Z') },
    ]);
    const res = await request(app)
      .get(`/api/keywords/${kw.id}/history?from=2026-07-05T00:00:00.000Z&to=2026-07-10T00:00:00.000Z`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(1);
    expect(res.body.series[0].position).toBe(3);
  });

  it('cross-account 404', async () => {
    const a = await seedUser('a@w.co');
    const b = await seedUser('b@w.co');
    const siteOfA = await seedSite(a.id);
    const kw = (await getTestDb()
      .insert(keywordsTable)
      .values({ accountId: a.id, siteId: siteOfA, phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    const res = await request(app).get(`/api/keywords/${kw.id}/history`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });
});

describe('scheduler wiring skipped when queue is not configured', () => {
  it('POST without a queue still succeeds (schedules land when the queue lands)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(null);
    const spy = vi.spyOn(scheduler, 'upsertRankSchedule').mockResolvedValue(undefined as never);
    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' });
    expect(res.status).toBe(201);
    expect(spy).not.toHaveBeenCalled();
  });

  it('PATCH cadence without a queue still succeeds', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(null);
    const spy = vi.spyOn(scheduler, 'upsertRankSchedule').mockResolvedValue(undefined as never);
    const res = await request(app)
      .patch(`/api/sites/${siteId}/rank-cadence`)
      .set('Cookie', user.cookie)
      .send({ cadence: 'weekly' });
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/sites/:siteId/keywords (immediate first check)', () => {
  it('enqueues a manual rank job so the new keyword is checked right away', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'seo audit', locationCode: 2840, languageCode: 'en', device: 'desktop' });

    expect(res.status).toBe(201);
    // A `manual: true` rank job is enqueued (exact-now checkedAt) alongside the
    // weekly scheduler upsert.
    expect(q.add).toHaveBeenCalledWith(
      'rank',
      expect.objectContaining({ siteId, manual: true, schedulerKey: 'manual' }),
      expect.objectContaining({ jobId: expect.stringContaining('manual-') }),
    );
    const [row] = await getTestDb()
      .select()
      .from(domainStates)
      .where(eq(domainStates.siteId, siteId));
    expect(row!.lastRankCheckAt).not.toBeNull();
  });

  it('keeps the committed keyword when the best-effort queue write fails', async () => {
    const user = await seedUser('first-check-queue-failure@x.co');
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    q.add.mockRejectedValueOnce(new Error('queue temporarily unavailable'));
    setRanksQueue(q as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({
        phrase: 'durable despite queue failure',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      });

    expect(res.status).toBe(201);
    expect(res.body.keyword.phrase).toBe('durable despite queue failure');
    expect(q.add).toHaveBeenCalledTimes(1);
    const [state] = await getTestDb()
      .select()
      .from(domainStates)
      .where(eq(domainStates.siteId, siteId));
    expect(state?.lastRankCheckAt).toBeNull();
  });
});

describe('POST /api/sites/:siteId/keywords/check ("Check now")', () => {
  it('queues an on-demand re-check (202) and enqueues a manual job', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords/check`)
      .set('Cookie', user.cookie)
      .send();

    expect(res.status).toBe(202);
    expect(res.body.message).toBe(DICTIONARIES.en.ranks.checkQueued);
    expect(Date.parse(res.body.checkStartedAt as string)).not.toBeNaN();
    expect(q.add).toHaveBeenCalledWith(
      'rank',
      expect.objectContaining({ siteId, manual: true }),
      expect.objectContaining({ jobId: expect.stringContaining('manual-') }),
    );
  });

  it('cross-account 404 when the site does not belong to the caller', async () => {
    const a = await seedUser('a-check@x.co');
    const b = await seedUser('b-check@x.co');
    const siteOfA = await seedSite(a.id);
    setRanksQueue(fakeQueue() as never);
    const res = await request(app)
      .post(`/api/sites/${siteOfA}/keywords/check`)
      .set('Cookie', b.cookie)
      .send();
    expect(res.status).toBe(404);
  });

  it('rejects a second check inside the cooldown with a localized 429', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(fakeQueue() as never);

    const first = await request(app)
      .post(`/api/sites/${siteId}/keywords/check`)
      .set('Cookie', user.cookie)
      .send();
    expect(first.status).toBe(202);

    const second = await request(app)
      .post(`/api/sites/${siteId}/keywords/check`)
      .set('Cookie', user.cookie)
      .send();
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe(DICTIONARIES.en.ranks.errors.checkCooldown);
  });

  it('still succeeds (202) when no queue is configured — the cooldown is stamped', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(null);
    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords/check`)
      .set('Cookie', user.cookie)
      .send();
    expect(res.status).toBe(202);
    const [row] = await getTestDb()
      .select()
      .from(domainStates)
      .where(eq(domainStates.siteId, siteId));
    expect(row!.lastRankCheckAt).not.toBeNull();
  });
});

describe('POST /api/keywords/:id/check (individual "Check now")', () => {
  it('enqueues a manual job that selects only the owned keyword', async () => {
    const user = await seedUser('single-check@x.co');
    const siteId = await seedSite(user.id);
    const [keyword] = await getTestDb()
      .insert(keywordsTable)
      .values({
        accountId: user.id,
        siteId,
        phrase: 'single keyword',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        trackLocalPack: true,
      })
      .returning();
    const add = vi.fn(async (_name: string, data: unknown, options?: { jobId?: string }) => {
      expect(data).toMatchObject({
        keywordIds: [keyword!.id],
        manual: true,
      });
      expect(data).not.toHaveProperty('serpReservation');
      expect(options?.jobId).toContain(keyword!.id);
      return { id: 'single-keyword-rank-job' };
    });
    setRanksQueue({ ...fakeQueue(), add } as never);

    const res = await request(app)
      .post(`/api/keywords/${keyword!.id}/check`)
      .set('Cookie', user.cookie)
      .send();

    expect(res.status).toBe(202);
    expect(res.body.message).toBe(DICTIONARIES.en.ranks.checkQueued);
    expect(Date.parse(res.body.checkStartedAt as string)).not.toBeNaN();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('selects one alternate-engine keyword', async () => {
    const user = await seedUser('single-alt-check@x.co');
    const siteId = await seedSite(user.id);
    const [keyword] = await getTestDb()
      .insert(keywordsTable)
      .values({
        accountId: user.id,
        siteId,
        phrase: 'single bing keyword',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        engine: 'bing',
      })
      .returning();
    const q = fakeQueue();
    setRanksQueue(q as never);
    const previousFlag = env.ALT_ENGINE_TRACKING_ENABLED;
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = true;

    try {
      const res = await request(app)
        .post(`/api/keywords/${keyword!.id}/check`)
        .set('Cookie', user.cookie)
        .send();

      expect(res.status).toBe(202);
      expect(q.add).toHaveBeenCalledWith(
        'rank',
        expect.objectContaining({
          keywordIds: [keyword!.id],
          altEnginesEnabledAtEnqueue: true,
        }),
        expect.objectContaining({ jobId: expect.stringContaining(keyword!.id) }),
      );
    } finally {
      (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED =
        previousFlag;
    }
  });

  it('returns 404 for another account or an inactive keyword', async () => {
    const owner = await seedUser('single-owner@x.co');
    const stranger = await seedUser('single-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const rows = await getTestDb()
      .insert(keywordsTable)
      .values([
        {
          accountId: owner.id,
          siteId,
          phrase: 'owned active',
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        },
        {
          accountId: owner.id,
          siteId,
          phrase: 'owned inactive',
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
          active: false,
        },
      ])
      .returning();
    const q = fakeQueue();
    setRanksQueue(q as never);

    const foreign = await request(app)
      .post(`/api/keywords/${rows[0]!.id}/check`)
      .set('Cookie', stranger.cookie)
      .send();
    const inactive = await request(app)
      .post(`/api/keywords/${rows[1]!.id}/check`)
      .set('Cookie', owner.cookie)
      .send();

    expect(foreign.status).toBe(404);
    expect(inactive.status).toBe(404);
    expect(q.add).not.toHaveBeenCalled();
  });

  it('shares the site cooldown with the all-keyword action', async () => {
    const user = await seedUser('single-cooldown@x.co');
    const siteId = await seedSite(user.id);
    const [keyword] = await getTestDb()
      .insert(keywordsTable)
      .values({
        accountId: user.id,
        siteId,
        phrase: 'cooldown keyword',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    setRanksQueue(fakeQueue() as never);

    const one = await request(app)
      .post(`/api/keywords/${keyword!.id}/check`)
      .set('Cookie', user.cookie)
      .send();
    const all = await request(app)
      .post(`/api/sites/${siteId}/keywords/check`)
      .set('Cookie', user.cookie)
      .send();

    expect(one.status).toBe(202);
    expect(all.status).toBe(429);
  });

  it('returns 409 without enqueueing when the site is paused', async () => {
    const user = await seedUser('single-paused@x.co');
    const siteId = await seedSite(user.id);
    const [keyword] = await getTestDb()
      .insert(keywordsTable)
      .values({
        accountId: user.id,
        siteId,
        phrase: 'paused keyword',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    await Site.updateOne({ _id: siteId }, { $set: { paused: true } });
    const q = fakeQueue();
    setRanksQueue(q as never);

    const res = await request(app)
      .post(`/api/keywords/${keyword!.id}/check`)
      .set('Cookie', user.cookie)
      .send();

    expect(res.status).toBe(409);
    expect(q.add).not.toHaveBeenCalled();
  });

  it('returns 503 and rolls back the cooldown when the queue write fails', async () => {
    const user = await seedUser('single-queue-failure@x.co');
    const siteId = await seedSite(user.id);
    const [keyword] = await getTestDb()
      .insert(keywordsTable)
      .values({
        accountId: user.id,
        siteId,
        phrase: 'queue failure keyword',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const q = fakeQueue();
    q.add.mockRejectedValueOnce(new Error('queue unavailable'));
    setRanksQueue(q as never);

    const res = await request(app)
      .post(`/api/keywords/${keyword!.id}/check`)
      .set('Cookie', user.cookie)
      .send();

    expect(res.status).toBe(503);
    const [state] = await getTestDb()
      .select()
      .from(domainStates)
      .where(eq(domainStates.siteId, siteId));
    expect(state?.lastRankCheckAt).toBeNull();
  });
});

describe('creating a keyword reads the current cadence from domain_states', () => {
  it('picks up daily when the row already exists', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    // Switch to daily first via the cadence endpoint.
    await request(app)
      .patch(`/api/sites/${siteId}/rank-cadence`)
      .set('Cookie', user.cookie)
      .send({ cadence: 'daily' });
    const q = fakeQueue();
    setRanksQueue(q as never);
    const spy = vi.spyOn(scheduler, 'upsertRankSchedule').mockResolvedValue(undefined as never);
    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' });
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledWith(q, expect.objectContaining({ cadence: 'daily' }));
  });
});

describe('CODEBASE-REVIEW §4.1 — listKeywords single-query latest-2 rewrite', () => {
  it('returns latest-2 rankings per keyword in ONE window-function query', async () => {
    const user = await seedUser('win-func@x.co');
    const siteId = await seedSite(user.id, 'winfunc.example.com');
    const db = getTestDb();
    const inserted = await db
      .insert(keywordsTable)
      .values([
        { accountId: user.id, siteId, phrase: 'a', locationCode: 1, languageCode: 'en', device: 'desktop' },
        { accountId: user.id, siteId, phrase: 'b', locationCode: 1, languageCode: 'en', device: 'desktop' },
        { accountId: user.id, siteId, phrase: 'c', locationCode: 1, languageCode: 'en', device: 'desktop' },
      ])
      .returning();
    const [kA, kB, _kC] = inserted;
    // kA: 3 rankings, kB: 1 ranking, kC: 0 rankings.
    await db.insert(rankingsTable).values([
      { keywordId: kA!.id, position: 12, source: 'fresh', checkedAt: new Date('2026-07-01T00:00:00Z') },
      { keywordId: kA!.id, position: 8, source: 'fresh', checkedAt: new Date('2026-07-05T00:00:00Z') },
      { keywordId: kA!.id, position: 5, source: 'fresh', checkedAt: new Date('2026-07-09T00:00:00Z'), aiOverviewPresent: true, aiCited: true, aiCitedUrl: 'https://x/y' },
      { keywordId: kB!.id, position: 20, source: 'fresh', checkedAt: new Date('2026-07-03T00:00:00Z') },
    ]);

    const res = await request(app)
      .get(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const byPhrase = new Map<string, { latestPosition: number | null; previousPosition: number | null; delta: number | null; aiOverviewPresent: boolean | null }>();
    for (const kw of res.body.keywords) byPhrase.set(kw.phrase, kw);
    // kA: latest 5, previous 8, delta = 8-5 = 3, ai signals from latest row.
    expect(byPhrase.get('a')).toMatchObject({
      latestPosition: 5,
      previousPosition: 8,
      delta: 3,
      aiOverviewPresent: true,
    });
    // kB: exactly one ranking → previousPosition null, delta null.
    expect(byPhrase.get('b')).toMatchObject({
      latestPosition: 20,
      previousPosition: null,
      delta: null,
    });
    // kC: zero rankings → both null.
    expect(byPhrase.get('c')).toMatchObject({
      latestPosition: null,
      previousPosition: null,
      delta: null,
    });
  });

  it('empty keyword page issues no rankings query (inArray guard)', async () => {
    const user = await seedUser('empty-page@x.co');
    const siteId = await seedSite(user.id, 'empty.example.com');
    const res = await request(app)
      .get(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.keywords).toEqual([]);
  });
});

describe('CODEBASE-REVIEW §4.1 — getKeywordHistory caps and default window', () => {
  it('caps returned points to HISTORY_MAX_POINTS (730)', async () => {
    const user = await seedUser('cap-history@x.co');
    const siteId = await seedSite(user.id, 'caphist.example.com');
    const db = getTestDb();
    const kw = (await db
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'cap', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    // 800 rankings, one per day starting 800 days ago from a fixed anchor.
    const anchor = new Date('2026-07-01T00:00:00Z');
    const values = Array.from({ length: 800 }, (_, i) => ({
      keywordId: kw.id,
      position: (i % 100) + 1,
      source: 'fresh' as const,
      checkedAt: new Date(anchor.getTime() - (800 - i) * 24 * 60 * 60 * 1000),
    }));
    await db.insert(rankingsTable).values(values);
    // Explicit from covers the whole seeded window so nothing is dropped by
    // the default 24-month bound — the CAP is what limits the series length.
    const res = await request(app)
      .get(`/api/keywords/${kw.id}/history?from=2020-01-01T00:00:00.000Z`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.series.length).toBeLessThanOrEqual(730);
    expect(res.body.series.length).toBe(730);
  });

  it('default window drops points older than 24 months when `from` is omitted', async () => {
    const user = await seedUser('window-history@x.co');
    const siteId = await seedSite(user.id, 'winhist.example.com');
    const db = getTestDb();
    const kw = (await db
      .insert(keywordsTable)
      .values({ accountId: user.id, siteId, phrase: 'w', locationCode: 1, languageCode: 'en', device: 'desktop' })
      .returning())[0]!;
    // One ancient row + one recent row — the ancient should be filtered out.
    await db.insert(rankingsTable).values([
      { keywordId: kw.id, position: 99, source: 'fresh', checkedAt: new Date('2015-01-01T00:00:00Z') },
      { keywordId: kw.id, position: 3, source: 'fresh', checkedAt: new Date() },
    ]);
    const res = await request(app)
      .get(`/api/keywords/${kw.id}/history`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    // The ancient row was outside the 24-month default window.
    for (const point of res.body.series) {
      expect(new Date(point.checkedAt).getFullYear()).toBeGreaterThanOrEqual(2020);
    }
  });
});

describe('malformed site id → 404', () => {
  it('POST returns 404 for a non-ObjectId siteId', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(`/api/sites/not-an-id/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'k', locationCode: 1, languageCode: 'en', device: 'desktop' });
    expect(res.status).toBe(404);
  });
  it('PATCH returns 404 for a non-ObjectId siteId', async () => {
    const user = await seedUser();
    const res = await request(app)
      .patch(`/api/sites/not-an-id/rank-cadence`)
      .set('Cookie', user.cookie)
      .send({ cadence: 'weekly' });
    expect(res.status).toBe(404);
  });
});

describe('list resilience', () => {
  it('does not surface another account\'s keywords', async () => {
    const a = await seedUser('list-a@x.co');
    const b = await seedUser('list-b@x.co');
    const siteA = await seedSite(a.id);
    const siteB = await seedSite(b.id, 'other.example');
    const db = getTestDb();
    await db.insert(keywordsTable).values([
      { accountId: a.id, siteId: siteA, phrase: 'a', locationCode: 1, languageCode: 'en', device: 'desktop' },
      { accountId: b.id, siteId: siteB, phrase: 'b', locationCode: 1, languageCode: 'en', device: 'desktop' },
    ]);
    const res = await request(app).get(`/api/sites/${siteA}/keywords`).set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.keywords.every((k: { phrase: string }) => k.phrase === 'a')).toBe(true);
  });
});
