/**
 * `GET /api/keyword-research/stored-keywords` — every phrase the account has
 * already stored for one market (searched seeds plus the related / ideas /
 * long-tail rows cached under them). The load-bearing guarantee is that the
 * read never reaches a provider and never writes a history row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from '../../shared/testing/auth.js';
import { keywordResearchHistory, vendorCache } from '../../db/schema/index.js';
import { createFakeKeywordProvider, type KeywordProvider } from '../../shared/providers/index.js';
import { setKeywordProvider, setKeywordResearchDb } from './keyword-research.holder.js';
import { setRanksDb } from '../ranks/index.js';
import { collectStoredKeywordCandidates } from './keyword-research.stored.js';

const app = createApp();
const MARKET = { locationCode: 2840, languageCode: 'en' };
const PROVIDER_METHODS = ['getMetrics', 'getRelated', 'classifyIntent', 'getIdeas', 'getLongTailSuggestions'] as const;

function spiedProvider(base: KeywordProvider = createFakeKeywordProvider()) {
  const spies = Object.fromEntries(PROVIDER_METHODS.map((method) => [method, vi.spyOn(base, method)])) as Record<
    (typeof PROVIDER_METHODS)[number],
    ReturnType<typeof vi.spyOn>
  >;
  return {
    provider: base,
    callCount: () => PROVIDER_METHODS.reduce((sum, method) => sum + spies[method].mock.calls.length, 0),
    reset: () => PROVIDER_METHODS.forEach((method) => spies[method].mockClear()),
  };
}

let spy = spiedProvider();

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function post(user: TestUser, path: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/keyword-research/${path}`)
    .set('Cookie', user.cookie)
    .send({ ...MARKET, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

async function getStored(user: TestUser, query: Record<string, unknown>) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]));
  return request(app).get(`/api/keyword-research/stored-keywords?${params.toString()}`).set('Cookie', user.cookie);
}

async function historyRows(accountId: string) {
  return getTestDb().select().from(keywordResearchHistory).where(eq(keywordResearchHistory.accountId, accountId));
}

async function seedStoredResearch(user: TestUser) {
  await post(user, 'metrics', { keywords: ['seo audit tool'] });
  await post(user, 'related', { keyword: 'seo audit tool' });
  await post(user, 'ideas', { seed: 'alpha seed' });
  await post(user, 'long-tail', { seed: 'alpha seed' });
  // The same expansion looked up twice yields two history rows but one set of candidates.
  await post(user, 'ideas', { seed: 'alpha seed' });
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
  spy = spiedProvider();
  setKeywordProvider(spy.provider);
});

describe('GET /api/keyword-research/stored-keywords', () => {
  it('offers seeds plus every stored related / idea / long-tail phrase, deduped, without a provider call', async () => {
    const user = await seedUser('stored-all@x.co');
    await seedStoredResearch(user);
    const historyBefore = (await historyRows(user.id)).length;
    spy.reset();

    const res = await getStored(user, MARKET);
    expect(res.status).toBe(200);
    const byPhrase = new Map<string, { source: string; searchVolume: number | null }>(
      res.body.candidates.map((c: { phrase: string; source: string; searchVolume: number | null }) => [c.phrase, c]),
    );
    // Seeds: newest lookup first.
    expect(res.body.candidates.slice(0, 2).map((c: { phrase: string }) => c.phrase)).toEqual([
      'alpha seed',
      'seo audit tool',
    ]);
    expect(byPhrase.get('alpha seed')?.source).toBe('seed');
    // 'seo audit tool' is both a searched seed AND in its own related list: it stays a seed.
    expect(byPhrase.get('seo audit tool')?.source).toBe('seed');
    expect(byPhrase.get('rank tracker')).toMatchObject({ source: 'related', searchVolume: null });
    expect(byPhrase.get('website audit checklist')).toMatchObject({ source: 'idea', searchVolume: 2900 });
    expect(byPhrase.get('how to use an seo audit tool')).toMatchObject({ source: 'long_tail', searchVolume: 590 });
    expect(res.body.total).toBe(res.body.candidates.length);
    expect(new Set(res.body.candidates.map((c: { phrase: string }) => c.phrase)).size).toBe(
      res.body.candidates.length,
    );
    expect(res.body.truncated).toBe(false);
    expect(typeof res.body.candidates[0].observedAt).toBe('string');

    expect(spy.callCount()).toBe(0);
    expect(await historyRows(user.id)).toHaveLength(historyBefore);
  });

  it('orders expansions by volume (nulls last, ties by phrase) and skips over-long or blank phrases', async () => {
    const user = await seedUser('stored-sort@x.co');
    const row = (keyword: string, searchVolume: number | null) => ({
      keyword,
      searchVolume,
      difficulty: null,
      cpc: null,
      monthlySearches: [],
    });
    setKeywordProvider(
      createFakeKeywordProvider({
        ideas: [
          row('mid b', 100),
          row('null y', null),
          row('top', 500),
          row('mid a', 100),
          row('null x', null),
          row('x'.repeat(81), 9_999),
          row('low', 5),
          row('  ', 77),
        ],
      }),
    );
    await post(user, 'ideas', { seed: 'sorted seed' });
    const res = await getStored(user, MARKET);
    expect(res.body.candidates.map((c: { phrase: string }) => c.phrase)).toEqual([
      'sorted seed',
      'top',
      'mid a',
      'mid b',
      'low',
      'null x',
      'null y',
    ]);
  });

  it('filters by q, truncates at limit, and reports the full match total', async () => {
    const user = await seedUser('stored-q@x.co');
    await seedStoredResearch(user);
    const all = await getStored(user, MARKET);
    const filtered = await getStored(user, { ...MARKET, q: '  AUDIT ' });
    expect(filtered.body.candidates.length).toBeGreaterThan(0);
    for (const candidate of filtered.body.candidates) {
      expect(candidate.phrase).toContain('audit');
    }
    const limited = await getStored(user, { ...MARKET, limit: 3 });
    expect(limited.body.candidates).toHaveLength(3);
    expect(limited.body.total).toBe(all.body.total);
    expect(limited.body.truncated).toBe(true);
    const none = await getStored(user, { ...MARKET, q: 'zzzz-no-match' });
    expect(none.body).toMatchObject({ candidates: [], total: 0, truncated: false });
  });

  it('is market-scoped, expiry-aware and account-scoped', async () => {
    const user = await seedUser('stored-scope@x.co');
    const other = await seedUser('stored-scope-other@x.co');
    await seedStoredResearch(user);

    const otherMarket = await getStored(user, { locationCode: 2826, languageCode: 'en' });
    expect(otherMarket.body.candidates).toEqual([]);
    const otherLang = await getStored(user, { locationCode: 2840, languageCode: 'de' });
    expect(otherLang.body.candidates).toEqual([]);

    // Another account never sees these seeds or the expansions cached under them.
    const foreign = await getStored(other, MARKET);
    expect(foreign.body.candidates).toEqual([]);

    // Expired cache rows drop the expansions; the searched seeds remain.
    await getTestDb().execute(sql`update vendor_cache set expires_at = now() - interval '1 day'`);
    const expired = await getStored(user, MARKET);
    expect(expired.body.candidates.map((c: { phrase: string }) => c.phrase)).toEqual([
      'alpha seed',
      'seo audit tool',
    ]);
  });

  it('is authenticated and validated', async () => {
    const user = await seedUser('stored-validate@x.co');
    expect(
      (await request(app).get('/api/keyword-research/stored-keywords?locationCode=2840&languageCode=en')).status,
    ).toBe(401);
    expect((await getStored(user, { languageCode: 'en' })).status).toBe(400);
    expect((await getStored(user, { locationCode: 2840 })).status).toBe(400);
    expect((await getStored(user, { ...MARKET, limit: 0 })).status).toBe(400);
    expect((await getStored(user, { ...MARKET, limit: 1001 })).status).toBe(400);
    expect((await getStored(user, { ...MARKET, q: 'q'.repeat(81) })).status).toBe(400);
  });

  it('skips non-seed history kinds and over-long seeds', async () => {
    const user = await seedUser('stored-kinds@x.co');
    const db = getTestDb();
    const base = { accountId: user.id, locationCode: 2840, languageCode: 'en', resultCount: 1, cached: false };
    await db.insert(keywordResearchHistory).values([
      { ...base, kind: 'gap', phrases: ['competitor.com'] },
      { ...base, kind: 'clusters', phrases: ['clustered phrase'] },
      { ...base, kind: 'metrics', phrases: ['s'.repeat(81), '', 'kept seed'] },
    ]);
    const stored = await collectStoredKeywordCandidates(db as never, {
      accountId: user.id,
      locationCode: 2840,
      languageCode: 'EN',
      now: new Date(),
    });
    expect(stored.map((c) => c.phrase)).toEqual(['kept seed']);
  });

  it('never uses a vendor_cache row from another market as an expansion', async () => {
    const user = await seedUser('stored-market@x.co');
    await post(user, 'ideas', { seed: 'alpha seed' });
    const rows = await getTestDb()
      .select()
      .from(vendorCache)
      .where(and(eq(vendorCache.capability, 'keyword'), eq(vendorCache.operation, 'ideas')));
    expect(rows).toHaveLength(1);
    const uk = await getStored(user, { locationCode: 2826, languageCode: 'en' });
    expect(uk.body.candidates).toEqual([]);
  });
});

describe('market validation on the lookup routes', () => {
  it('rejects a non-numeric location code and accepts a missing one only as a required-field error', async () => {
    const user = await seedUser('market-validate@x.co');
    const send = (body: Record<string, unknown>) =>
      request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie).send({ keywords: ['seo'], ...body });
    const invalid = await send({ locationCode: 'abc', languageCode: 'en' });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).toContain('locationCode');
    const missing = await send({ languageCode: 'en' });
    expect(missing.status).toBe(400);
  });
});
