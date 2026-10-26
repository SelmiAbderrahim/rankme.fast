/**
 * Site-scoped research history + stored results.
 *
 * - a lookup run from a site's Research tab is attributed to that site (404 for
 *   a site the caller does not own, paused sites stay allowed);
 * - the metrics + intent calls of one press share a client-minted lookup id;
 * - `GET /history?siteId=` lists only that site's rows and counts the scope;
 * - `GET /history/:id/results` re-opens a row from the shared cache without a
 *   provider call or a new history row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from '../../shared/testing/auth.js';
import { keywordResearchHistory, vendorCache } from '../../db/schema/index.js';
import { createFakeKeywordProvider, type KeywordMetrics, type KeywordProvider } from '../../shared/providers/index.js';
import { setKeywordProvider, setKeywordResearchDb } from './keyword-research.holder.js';
import { setRanksDb } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import { createKeywordCacheRepo, computeKeywordCacheKey, expansionMapKey } from './keyword-research.cache.js';
import { readStoredResearchResult } from './keyword-research.stored.js';
import { listResearchHistory } from './keyword-research.history.js';

const app = createApp();

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain: string, extra: Record<string, unknown> = {}): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
    ...extra,
  });
  return (site._id as mongoose.Types.ObjectId).toString();
}

async function rows(accountId: string) {
  return getTestDb()
    .select()
    .from(keywordResearchHistory)
    .where(eq(keywordResearchHistory.accountId, accountId));
}

const LOOKUP_ID = '3f2b8c1e-5d4a-4c6b-9e7f-1a2b3c4d5e6f';

/** A vendor that echoes the seed as its own first suggestion. */
function seedEchoingProvider(): KeywordProvider {
  const base = createFakeKeywordProvider();
  const echo = async (seed: string, ...rest: [number, string, number]): Promise<KeywordMetrics[]> => [
    { keyword: seed, searchVolume: 900, difficulty: 10, cpc: 1, monthlySearches: [] },
    ...(await base.getRelated(seed, ...rest)),
  ];
  return {
    ...base,
    getRelated: (seed, location, language, limit) => echo(seed, location, language, limit),
    getIdeas: (seed, location, language, limit) => echo(seed, location, language, limit),
  };
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

describe('site attribution on a lookup', () => {
  it('records the site and the shared lookup id for metrics and intent', async () => {
    const user = await seedUser('site-attr@x.co');
    const siteId = await seedSite(user.id, 'attr.example');
    const body = { keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en', siteId, lookupId: LOOKUP_ID };
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie).send(body).expect(200);
    await request(app).post('/api/keyword-research/intent').set('Cookie', user.cookie).send(body).expect(200);
    const stored = await rows(user.id);
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.siteId === siteId && row.lookupId === LOOKUP_ID)).toBe(true);
  });

  it('attributes related, ideas and long-tail lookups to the site', async () => {
    const user = await seedUser('site-expansions@x.co');
    const siteId = await seedSite(user.id, 'expansions.example');
    const base = { locationCode: 2840, languageCode: 'en', siteId };
    await request(app).post('/api/keyword-research/related').set('Cookie', user.cookie).send({ keyword: 'seo', ...base }).expect(200);
    await request(app).post('/api/keyword-research/ideas').set('Cookie', user.cookie).send({ seed: 'seo', ...base }).expect(200);
    await request(app).post('/api/keyword-research/long-tail').set('Cookie', user.cookie).send({ seed: 'seo', ...base }).expect(200);
    const stored = await rows(user.id);
    expect(stored.map((row) => row.kind).sort()).toEqual(['ideas', 'long_tail', 'related']);
    expect(stored.every((row) => row.siteId === siteId && row.lookupId === null)).toBe(true);
  });

  it('keeps account-level lookups without a site', async () => {
    const user = await seedUser('site-none@x.co');
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' }).expect(200);
    const [row] = await rows(user.id);
    expect(row).toMatchObject({ siteId: null, lookupId: null });
  });

  it('allows a paused site', async () => {
    const user = await seedUser('site-paused@x.co');
    const siteId = await seedSite(user.id, 'paused.example', { paused: true });
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en', siteId }).expect(200);
    expect((await rows(user.id))[0]!.siteId).toBe(siteId);
  });

  it("404s on another account's site without recording a row", async () => {
    const owner = await seedUser('site-owner@x.co');
    const other = await seedUser('site-other@x.co');
    const siteId = await seedSite(owner.id, 'owner.example');
    const res = await request(app).post('/api/keyword-research/metrics').set('Cookie', other.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en', siteId });
    expect(res.status).toBe(404);
    expect(await rows(other.id)).toHaveLength(0);
  });

  it('400s on a malformed site or lookup id', async () => {
    const user = await seedUser('site-bad@x.co');
    const base = { keywords: ['seo'], locationCode: 2840, languageCode: 'en' };
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie).send({ ...base, siteId: 'nope' }).expect(400);
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie).send({ ...base, lookupId: 'nope' }).expect(400);
  });
});

describe('GET /history scoped to a site', () => {
  it('lists only that site, counts the whole scope and pages with a cursor', async () => {
    const user = await seedUser('hist-site@x.co');
    const siteA = await seedSite(user.id, 'a.example');
    const siteB = await seedSite(user.id, 'b.example');
    const common = { locationCode: 2840, languageCode: 'en' };
    for (const [index, siteId] of [siteA, siteA, siteA, siteB, undefined].entries()) {
      await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
        .send({ keywords: [`phrase ${index}`], ...common, ...(siteId ? { siteId } : {}) }).expect(200);
    }
    const first = await request(app).get(`/api/keyword-research/history?siteId=${siteA}&limit=2`).set('Cookie', user.cookie).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.total).toBe(3);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await request(app)
      .get(`/api/keyword-research/history?siteId=${siteA}&limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', user.cookie).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.total).toBe(3);
    const everything = await request(app).get('/api/keyword-research/history').set('Cookie', user.cookie).expect(200);
    expect(everything.body.total).toBe(5);
    expect(everything.body.items[0]).toHaveProperty('lookupId');
  });

  it("404s on another account's site", async () => {
    const owner = await seedUser('hist-owner@x.co');
    const other = await seedUser('hist-other@x.co');
    const siteId = await seedSite(owner.id, 'private.example');
    await request(app).get(`/api/keyword-research/history?siteId=${siteId}`).set('Cookie', other.cookie).expect(404);
  });
});

describe('listResearchHistory restricted to a list of sites', () => {
  it('keeps only rows of the listed sites, hides account-level rows and treats an empty list as no sites', async () => {
    const user = await seedUser('hist-sites-list@x.co');
    const siteA = await seedSite(user.id, 'a.example');
    const siteB = await seedSite(user.id, 'b.example');
    const common = { locationCode: 2840, languageCode: 'en' };
    for (const [index, siteId] of [siteA, siteB, undefined].entries()) {
      await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
        .send({ keywords: [`phrase ${index}`], ...common, ...(siteId ? { siteId } : {}) }).expect(200);
    }
    const db = getTestDb();
    const onlyA = await listResearchHistory(db as never, { accountId: user.id, siteIds: [siteA], limit: 10 });
    expect(onlyA.items.map((item) => item.phrases)).toEqual([['phrase 0']]);
    expect(onlyA.total).toBe(1);
    const both = await listResearchHistory(db as never, { accountId: user.id, siteIds: [siteA, siteB], limit: 10 });
    expect(both.items).toHaveLength(2);
    const none = await listResearchHistory(db as never, { accountId: user.id, siteIds: [], limit: 10 });
    expect(none).toMatchObject({ items: [], total: 0, nextCursor: null });
  });
});

describe('GET /history/:id/results', () => {
  async function lastRowId(accountId: string): Promise<string> {
    const stored = await rows(accountId);
    return stored[stored.length - 1]!.id;
  }

  it('merges stored volume and intent for a metrics + intent pair, with no new history row', async () => {
    const user = await seedUser('stored-pair@x.co');
    const body = { keywords: ['seo audit tool', 'what is an seo audit'], locationCode: 2840, languageCode: 'en', lookupId: LOOKUP_ID };
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie).send(body).expect(200);
    await request(app).post('/api/keyword-research/intent').set('Cookie', user.cookie).send(body).expect(200);
    const before = (await rows(user.id)).length;
    // The intent entries were fetched earlier: the row reports the oldest time.
    const older = new Date(Date.now() - 3_600_000);
    await getTestDb().update(vendorCache).set({ fetchedAt: older }).where(eq(vendorCache.operation, 'intent'));
    const provider = createFakeKeywordProvider();
    const spy = vi.spyOn(provider, 'getMetrics');
    setKeywordProvider(provider);
    const id = (await rows(user.id)).find((row) => row.kind === 'metrics')!.id;
    const res = await request(app).get(`/api/keyword-research/history/${id}/results`).set('Cookie', user.cookie).expect(200);
    expect(res.body).toMatchObject({ id, kind: 'metrics', lookupId: LOOKUP_ID, status: 'available', requestedCount: 2, storedCount: 2 });
    expect(res.body.keywords).toHaveLength(2);
    expect(res.body.keywords[0]).toMatchObject({ keyword: 'seo audit tool', cached: true });
    expect(res.body.keywords[0].intent).not.toBeUndefined();
    expect(res.body.fetchedAt).toBe(older.toISOString());
    expect(spy).not.toHaveBeenCalled();
    expect(await rows(user.id)).toHaveLength(before);
  });

  it('reports a partial result when only some phrases are still stored', async () => {
    const user = await seedUser('stored-partial@x.co');
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
      .send({ keywords: ['alpha one', 'beta two'], locationCode: 2840, languageCode: 'en' }).expect(200);
    const key = computeKeywordCacheKey({ phrase: 'beta two', locationCode: 2840, languageCode: 'en' });
    await getTestDb().delete(vendorCache).where(eq(vendorCache.cacheKey, key));
    const res = await request(app).get(`/api/keyword-research/history/${await lastRowId(user.id)}/results`)
      .set('Cookie', user.cookie).expect(200);
    expect(res.body).toMatchObject({ status: 'partial', requestedCount: 2, storedCount: 1 });
  });

  it('reports expired when nothing is stored any more', async () => {
    const user = await seedUser('stored-expired@x.co');
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
      .send({ keywords: ['gone phrase'], locationCode: 2840, languageCode: 'en' }).expect(200);
    await getTestDb().delete(vendorCache);
    const res = await request(app).get(`/api/keyword-research/history/${await lastRowId(user.id)}/results`)
      .set('Cookie', user.cookie).expect(200);
    expect(res.body).toMatchObject({ status: 'expired', storedCount: 0, fetchedAt: null, expiresAt: null, keywords: [] });
  });

  it('re-opens related, ideas and long-tail expansions without the seed echo', async () => {
    setKeywordProvider(seedEchoingProvider());
    const user = await seedUser('stored-expansions@x.co');
    const base = { locationCode: 2840, languageCode: 'en' };
    const live = await request(app).post('/api/keyword-research/related').set('Cookie', user.cookie)
      .send({ keyword: 'Seo', ...base }).expect(200);
    expect(live.body.related.map((r: { keyword: string }) => r.keyword)).not.toContain('seo');
    await request(app).post('/api/keyword-research/ideas').set('Cookie', user.cookie).send({ seed: 'seo', ...base }).expect(200);
    await request(app).post('/api/keyword-research/long-tail').set('Cookie', user.cookie).send({ seed: 'seo', ...base }).expect(200);
    for (const row of await rows(user.id)) {
      const res = await request(app).get(`/api/keyword-research/history/${row.id}/results`).set('Cookie', user.cookie).expect(200);
      expect(res.body).toMatchObject({ kind: row.kind, seed: 'seo', status: 'available', storedCount: 1 });
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.map((i: { keyword: string }) => i.keyword)).not.toContain('seo');
    }
    // A cached read keeps hiding the echoed seed too.
    const again = await request(app).post('/api/keyword-research/related').set('Cookie', user.cookie)
      .send({ keyword: 'seo', ...base }).expect(200);
    expect(again.body.cached).toBe(true);
    expect(again.body.related.map((r: { keyword: string }) => r.keyword)).not.toContain('seo');
    await getTestDb().delete(vendorCache);
    const expired = await request(app).get(`/api/keyword-research/history/${(await rows(user.id))[0]!.id}/results`)
      .set('Cookie', user.cookie).expect(200);
    expect(expired.body).toMatchObject({ status: 'expired', items: [] });
  });

  it('answers unsupported for kinds without a stored snapshot', async () => {
    const user = await seedUser('stored-unsupported@x.co');
    const [row] = await getTestDb().insert(keywordResearchHistory).values({
      accountId: user.id, kind: 'gap', phrases: ['rival.example'], locationCode: 2840,
      languageCode: 'en', resultCount: 3, cached: false,
    }).returning();
    const res = await request(app).get(`/api/keyword-research/history/${row!.id}/results`).set('Cookie', user.cookie).expect(200);
    expect(res.body).toMatchObject({ status: 'unsupported', requestedCount: 1, storedCount: 0, keywords: [], items: [] });
  });

  it('reads a site-attributed row for its owner and an intent-only entry', async () => {
    const user = await seedUser('stored-intent-only@x.co');
    const siteId = await seedSite(user.id, 'intent-only.example');
    const body = { keywords: ['intent only'], locationCode: 2840, languageCode: 'en', siteId };
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie).send(body).expect(200);
    await request(app).post('/api/keyword-research/intent').set('Cookie', user.cookie).send(body).expect(200);
    const key = computeKeywordCacheKey({ phrase: 'intent only', locationCode: 2840, languageCode: 'en' });
    await getTestDb().delete(vendorCache).where(and(eq(vendorCache.cacheKey, key), eq(vendorCache.operation, 'metrics')));
    const res = await request(app).get(`/api/keyword-research/history/${await lastRowId(user.id)}/results`)
      .set('Cookie', user.cookie).expect(200);
    expect(res.body.status).toBe('available');
    expect(res.body.keywords[0]).toMatchObject({ searchVolume: null, difficulty: null, cpc: null, monthlySearches: [] });
  });

  it('404s for an unknown id and for another account, 400s on a malformed id', async () => {
    const owner = await seedUser('stored-owner@x.co');
    const other = await seedUser('stored-other@x.co');
    const siteId = await seedSite(owner.id, 'stored.example');
    await request(app).post('/api/keyword-research/metrics').set('Cookie', owner.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en', siteId }).expect(200);
    const id = await lastRowId(owner.id);
    await request(app).get(`/api/keyword-research/history/${id}/results`).set('Cookie', other.cookie).expect(404);
    await request(app).get('/api/keyword-research/history/00000000-0000-4000-8000-000000000000/results')
      .set('Cookie', owner.cookie).expect(404);
    await request(app).get('/api/keyword-research/history/not-a-uuid/results').set('Cookie', owner.cookie).expect(400);
    await request(app).get(`/api/keyword-research/history/${id}/results`).expect(401);
  });
});

describe('readExpansionsMany', () => {
  it('returns an empty map without a query and skips stale-shaped entries', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    expect((await repo.readExpansionsMany([], new Date())).size).toBe(0);
    const key = computeKeywordCacheKey({ phrase: 'stale', locationCode: 2840, languageCode: 'en' });
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);
    for (const operation of ['related', 'ideas', 'long_tail'] as const) {
      await getTestDb().insert(vendorCache).values({
        capability: 'keyword', operation, cacheKey: key, params: {}, payload: { phrase: 'stale', wrong: [] },
        fetchedAt: now, expiresAt: later,
      });
    }
    expect((await repo.readExpansionsMany([key], now)).has(expansionMapKey('related', key))).toBe(false);
    expect((await repo.readExpansionsMany([key], now)).size).toBe(0);
  });
});

describe('readStoredResearchResult', () => {
  it('uses the oldest fetch time of a metrics-only entry', async () => {
    const user = await seedUser('stored-direct@x.co');
    await request(app).post('/api/keyword-research/metrics').set('Cookie', user.cookie)
      .send({ keywords: ['direct'], locationCode: 2840, languageCode: 'en' }).expect(200);
    const [row] = await rows(user.id);
    const result = await readStoredResearchResult(getTestDb() as never, row!, new Date());
    expect(result.keywords[0]!.intent).toBeNull();
    expect(result.status).toBe('available');
  });
});
