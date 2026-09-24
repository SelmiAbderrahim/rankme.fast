/**
 * Keyword research route + failure-isolation tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
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
} from '../../shared/testing/auth.js';
import {
  VendorUnavailableError,
  createFakeKeywordProvider,
  type KeywordProvider,
} from '../../shared/providers/index.js';
import {
  setKeywordProvider,
  setKeywordResearchDb,
} from './keyword-research.holder.js';
import { vendorResponses } from '../../db/schema/vendor-cache.js';
import { eq } from 'drizzle-orm';
import { setRanksDb } from '../ranks/index.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';

const app = createApp();

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setKeywordResearchDb(db as unknown as never);
  setRanksDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setKeywordResearchDb(null);
  setRanksDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setKeywordProvider(createFakeKeywordProvider());
  vi.restoreAllMocks();
});

describe('POST /api/keyword-research/metrics', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(401);
  });

  it('returns metrics for a verified account', async () => {
    const user = await seedUser('pro@x.co');
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.keywords).toHaveLength(1);
    expect(res.body.keywords[0].keyword).toBe('seo audit tool');
    expect(res.body.keywords[0].cached).toBe(false);
  });

  it('validates body with zod (missing keywords → 400)', async () => {
    const user = await seedUser('pro2@x.co');
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(400);
  });

  it('validates keyword-count ceiling', async () => {
    const user = await seedUser('pro3@x.co');
    const bulk = Array.from({ length: 51 }, (_, i) => `kw${i}`);
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: bulk, locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(400);
  });

  it('returns a localized 503 when the provider is unavailable — audit flow unaffected', async () => {
    const failing: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
      async getRelated() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    setKeywordProvider(failing);
    const user = await seedUser('pro4@x.co');
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.keywordResearch.errors.unavailable,
    );
  });

  it('second identical call is served from cache', async () => {
    const user = await seedUser('procache@x.co');
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.keywords[0].cached).toBe(true);
  });

  it('cross-user hit: user B hits cache created by user A', async () => {
    const a = await seedUser('a@x.co');
    const b = await seedUser('b@x.co');
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', a.cookie)
      .send({ keywords: ['x'], locationCode: 1, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', b.cookie)
      .send({ keywords: ['x'], locationCode: 1, languageCode: 'en' })
      .expect(200);
    expect(res.body.keywords[0].cached).toBe(true);
  });

  it('money convention: cpc serializes as decimal string', async () => {
    const user = await seedUser('money@x.co');
    const res = await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' })
      .expect(200);
    // Fake fixture ships cpc: 4.1 for 'seo audit tool'
    expect(res.body.keywords[0].cpc).toMatch(/^\d+\.\d{6}$/);
  });
});

describe('POST /api/keyword-research/related', () => {
  it('returns related keywords for a verified account', async () => {
    const user = await seedUser('pror@x.co');
    const res = await request(app)
      .post('/api/keyword-research/related')
      .set('Cookie', user.cookie)
      .send({ keyword: 'seo', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(Array.isArray(res.body.related)).toBe(true);
  });

  it('rejects invalid body', async () => {
    const user = await seedUser('sri@x.co');
    const res = await request(app)
      .post('/api/keyword-research/related')
      .set('Cookie', user.cookie)
      .send({ keyword: '', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(400);
  });

  it('serves related from cache on repeat', async () => {
    const user = await seedUser('cachedr@x.co');
    await request(app)
      .post('/api/keyword-research/related')
      .set('Cookie', user.cookie)
      .send({ keyword: 'seo', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .post('/api/keyword-research/related')
      .set('Cookie', user.cookie)
      .send({ keyword: 'seo', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    expect(res.body.cached).toBe(true);
  });

  it('surfaces provider failure as 503', async () => {
    const failing: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    setKeywordProvider(failing);
    const user = await seedUser('failr@x.co');
    const res = await request(app)
      .post('/api/keyword-research/related')
      .set('Cookie', user.cookie)
      .send({ keyword: 'seo', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(503);
  });
});

describe('dedupeKeywordPhrases', () => {
  it('unit-level dedupeKeywordPhrases collapses blanks + duplicates', async () => {
    const { dedupeKeywordPhrases } = await import('./keyword-research.service.js');
    expect(dedupeKeywordPhrases(['seo', 'SEO', '  seo  ', ''])).toEqual(['seo']);
    expect(dedupeKeywordPhrases(['', '   '])).toEqual([]);
  });
});

describe('POST /api/keyword-research/intent', () => {
  it('classifies intent for a verified account (badge label from the fake)', async () => {
    const user = await seedUser('intent-pro@x.co');
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.intents).toHaveLength(1);
    expect(res.body.intents[0]).toMatchObject({
      keyword: 'seo audit tool',
      intent: 'commercial',
      cached: false,
    });
  });

  it('reports null intent for a keyword the vendor did not classify (never dropped)', async () => {
    const user = await seedUser('intent-null@x.co');
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({ keywords: ['totally-unknown-phrase'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.intents).toEqual([
      expect.objectContaining({ keyword: 'totally-unknown-phrase', intent: null, confidence: null }),
    ]);
  });

  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(401);
  });

  it('validates the body with zod (missing keywords → 400)', async () => {
    const user = await seedUser('intent-bad@x.co');
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(400);
  });

  it('dedupes phrases before classifying', async () => {
    const user = await seedUser('intent-meter@x.co');
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      // Two distinct phrases + one duplicate → 2 deduped rows.
      .send({
        keywords: ['seo audit tool', 'what is an seo audit', 'seo audit tool'],
        locationCode: 2840,
        languageCode: 'en',
      })
      .expect(200);
    expect(res.body.intents).toHaveLength(2);
  });

  it('serves a repeat from the cache', async () => {
    const user = await seedUser('intent-cache@x.co');
    await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.intents[0].cached).toBe(true);
  });

  it('surfaces provider failure as a localized 503', async () => {
    const failing: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() {
        throw new VendorUnavailableError('vendor down', { provider: 'x', operation: 'y' });
      },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    setKeywordProvider(failing);
    const user = await seedUser('intent-503@x.co');
    const res = await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.keywordResearch.errors.unavailable);
  });
});

describe('POST /api/keyword-research/ideas', () => {
  it('returns ideas for a verified account', async () => {
    const user = await seedUser('ideas-pro@x.co');
    const res = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.seed).toBe('seo audit');
    expect(Array.isArray(res.body.ideas)).toBe(true);
    expect(res.body.ideas.length).toBeGreaterThan(0);
    // cpc serializes as a decimal string (money convention).
    const withCpc = res.body.ideas.find((r: { cpc: string | null }) => r.cpc !== null);
    expect(withCpc.cpc).toMatch(/^\d+\.\d{6}$/);
  });

  it('validates the body with zod (empty seed → 400)', async () => {
    const user = await seedUser('ideas-bad@x.co');
    const res = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: '', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(400);
  });

  it('identical repeat is served cached', async () => {
    const fake = createFakeKeywordProvider();
    const getIdeasSpy = vi.fn(fake.getIdeas.bind(fake));
    setKeywordProvider({ ...fake, getIdeas: getIdeasSpy });
    const user = await seedUser('ideas-meter@x.co');
    const first = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    expect(first.body.cached).toBe(false);
    const second = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    expect(second.body.cached).toBe(true);
    expect(getIdeasSpy).toHaveBeenCalledTimes(1);
  });

  it('cross-user hit: user B is served the ideas cache created by user A', async () => {
    const fake = createFakeKeywordProvider();
    const getIdeasSpy = vi.fn(fake.getIdeas.bind(fake));
    setKeywordProvider({ ...fake, getIdeas: getIdeasSpy });
    const a = await seedUser('ideas-a@x.co');
    const b = await seedUser('ideas-b@x.co');
    await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', a.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', b.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    expect(res.body.cached).toBe(true);
    expect(getIdeasSpy).toHaveBeenCalledTimes(1);
  });

  it('a different locationCode is a cache miss (distinct entry)', async () => {
    const fake = createFakeKeywordProvider();
    const getIdeasSpy = vi.fn(fake.getIdeas.bind(fake));
    setKeywordProvider({ ...fake, getIdeas: getIdeasSpy });
    const user = await seedUser('ideas-loc@x.co');
    await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo audit', locationCode: 2826, languageCode: 'en' })
      .expect(200);
    expect(res.body.cached).toBe(false);
    expect(getIdeasSpy).toHaveBeenCalledTimes(2);
  });

  it('a fresh ideas fetch lands one shared (account-less) archive row', async () => {
    const user = await seedUser('ideas-archive@x.co');
    await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const rows = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'ideas'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capability: 'keyword', accountId: null });
  });

  it('surfaces provider failure as 503', async () => {
    const failing: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() {
        throw new VendorUnavailableError('vendor down', { provider: 'x', operation: 'y' });
      },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    setKeywordProvider(failing);
    const user = await seedUser('ideas-503@x.co');
    const res = await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/keyword-research/long-tail', () => {
  it('validates the seed', async () => {
    const pro = await seedUser('long-tail-invalid@x.co');
    await request(app)
      .post('/api/keyword-research/long-tail')
      .set('Cookie', pro.cookie)
      .send({ seed: '', locationCode: 2840, languageCode: 'en' })
      .expect(400);
  });

  it('returns the response contract and caches distinctly', async () => {
    const fake = createFakeKeywordProvider();
    const getLongTailSuggestions = vi.fn(fake.getLongTailSuggestions.bind(fake));
    setKeywordProvider({ ...fake, getLongTailSuggestions });
    const user = await seedUser('long-tail-cache@x.co');
    const body = { seed: '  SEO   Audit Tool ', locationCode: 2840, languageCode: 'EN' };

    const first = await request(app)
      .post('/api/keyword-research/long-tail')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    expect(first.body).toMatchObject({
      seed: 'seo audit tool',
      cached: false,
    });
    expect(first.body.suggestions[0]).toMatchObject({
      keyword: 'how to use an seo audit tool',
      searchVolume: 590,
      difficulty: 27,
    });
    expect(first.body.suggestions[0].cpc).toBe('2.100000');
    expect(getLongTailSuggestions).toHaveBeenCalledWith('seo audit tool', 2840, 'EN', 25);

    const second = await request(app)
      .post('/api/keyword-research/long-tail')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    expect(second.body.cached).toBe(true);
    expect(getLongTailSuggestions).toHaveBeenCalledTimes(1);

    const archive = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'long_tail'));
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({ capability: 'keyword', accountId: null });
  });

  it('maps provider failures to the localized unavailable response', async () => {
    const fake = createFakeKeywordProvider();
    setKeywordProvider({
      ...fake,
      async getLongTailSuggestions() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'long-tail',
        });
      },
    });
    const user = await seedUser('long-tail-failure@x.co');
    const res = await request(app)
      .post('/api/keyword-research/long-tail')
      .set('Cookie', user.cookie)
      .send({ seed: 'seo', locationCode: 2840, languageCode: 'en' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.keywordResearch.errors.unavailable);
  });
});
