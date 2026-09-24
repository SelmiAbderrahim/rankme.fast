/**
 * Prompt 15 — competitors route + failure-isolation tests.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
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
  competitors as competitorsTable,
  competitorIntersections as intersectionsTable,
} from '../../db/schema/competitors.js';
import { keywords as keywordsTable } from '../../db/schema/keywords.js';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import { listCompetitors } from './competitors.service.js';
import {
  VendorUnavailableError,
  createFakeCompetitorProvider,
  FAKE_DOMAIN_COMPARISON,
  type CompetitorEntry,
  type CompetitorProvider,
} from '../../shared/providers/index.js';
import {
  setCompetitorProvider,
  setCompetitorsCooldown,
  setCompetitorsDb,
} from './competitors.holder.js';
import { createInMemoryCooldown } from '../../shared/cooldown/index.js';
import { translate } from '../../shared/i18n/index.js';
import { setBacklinksDb } from '../backlinks/index.js';
import { setRanksDb } from '../ranks/index.js';
import { setKeywordResearchDb } from '../keyword-research/index.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';

const app = createApp();

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = 'example.com') {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return (site._id as mongoose.Types.ObjectId).toString();
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setCompetitorsDb(db as unknown as never);
  setBacklinksDb(db as unknown as never);
  setRanksDb(db as unknown as never);
  setKeywordResearchDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setCompetitorsDb(null);
  setBacklinksDb(null);
  setRanksDb(null);
  setKeywordResearchDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setCompetitorProvider(createFakeCompetitorProvider());
  // Fresh default cooldown per test — no cross-test 429 bleed.
  setCompetitorsCooldown(null);
});

describe('GET /api/sites/:siteId/competitors', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/sites/anything/competitors');
    expect(res.status).toBe(401);
  });

  it('opens competitors to every verified account', async () => {
    const user = await signupVerifiedUser(app, { email: 'community-c@x.co' });
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
  });

  it('accepts verified accounts and persists snapshot rows', async () => {
    const user = await seedUser('agency@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.competitors.length).toBeGreaterThan(0);
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows.length).toBe(res.body.competitors.length);
  });

  it('daily upsert: second call same day updates row instead of inserting', async () => {
    const user = await seedUser('agency2@x.co');
    const siteId = await seedSite(user.id);
    await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);
    const before = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);
    const after = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(after.length).toBe(before.length);
  });

  it('second same-day call is served from cache without a vendor call', async () => {
    const user = await seedUser('cacheC@x.co');
    const siteId = await seedSite(user.id);
    let calls = 0;
    setCompetitorProvider({
      async getCompetitors() {
        calls += 1;
        return [
          {
            domain: 'rival.example',
            avgPosition: 3,
            intersections: 5,
            estimatedTraffic: null,
          },
          {
            // null avgPosition exercises the cache-hit null branch
            domain: 'rival-two.example',
            avgPosition: null,
            intersections: 2,
            estimatedTraffic: null,
          },
        ];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
    });
    await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);
    const second = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(calls).toBe(1); // second served from the daily cache
    const cachedDomains = second.body.competitors.map(
      (c: { domain: string }) => c.domain,
    );
    expect(cachedDomains).toContain('rival.example');
    expect(cachedDomains).toContain('rival-two.example');
    expect(
      second.body.competitors.find(
        (c: { domain: string }) => c.domain === 'rival-two.example',
      ).avgPosition,
    ).toBeNull();
  });

  it('surfaces provider failure as 503 and does not persist', async () => {
    const user = await seedUser('agencyFail@x.co');
    const siteId = await seedSite(user.id);
    const failing: CompetitorProvider = {
      async getCompetitors() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
    };
    setCompetitorProvider(failing);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.competitors.errors.unavailable,
    );
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows).toHaveLength(0);
  });

  it('cross-account access 404', async () => {
    const a = await seedUser('aC@x.co');
    const b = await seedUser('bC@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('rethrows non-Provider errors (surfaces as 500)', async () => {
    const user = await seedUser('agencyPlain@x.co');
    const siteId = await seedSite(user.id);
    setCompetitorProvider({
      async getCompetitors() {
        throw new Error('plain');
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        throw new Error('plain');
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(500);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('malC@x.co');
    const res = await request(app)
      .get('/api/sites/not-an-object-id/competitors')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/sites/:siteId/competitors — concurrent same-day fetches', () => {
  it('two concurrent misses yield no duplicate (siteId, domain, day) rows', async () => {
    const user = await seedUser('conc-comp@x.co');
    const siteId = await seedSite(user.id, 'conc-comp.example');
    // Fake provider returns three entries so we can assert against the count.
    const fake: CompetitorProvider = {
      async getCompetitors() {
        return [
          { domain: 'r-0.example', avgPosition: 1.5, intersections: 3, estimatedTraffic: null },
          { domain: 'r-1.example', avgPosition: 2.5, intersections: 2, estimatedTraffic: null },
          { domain: 'r-2.example', avgPosition: 3.5, intersections: 1, estimatedTraffic: null },
        ];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
    };
    setCompetitorProvider(fake);
    const db = getTestDb() as unknown as never;
    await Promise.allSettled([
      listCompetitors({ accountId: user.id, siteId }, { db, provider: fake }),
      listCompetitors({ accountId: user.id, siteId }, { db, provider: fake }),
    ]);
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows).toHaveLength(3);
    // No duplicated (domain, day) pair.
    const seen = new Set(rows.map((r) => `${r.competitorDomain}|${r.snapshotDay}`));
    expect(seen.size).toBe(3);
  });

  it('an empty provider result inserts nothing and still returns 200', async () => {
    const user = await seedUser('empty-comp@x.co');
    const siteId = await seedSite(user.id, 'empty-comp.example');
    setCompetitorProvider({
      async getCompetitors() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.competitors).toEqual([]);
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows).toHaveLength(0);
  });
});

describe('GET /api/sites/:siteId/competitors/intersection', () => {
  it('uses safe provider provenance when an observation omits its public label', async () => {
    const user = await seedUser('provenanceI@x.co');
    const siteId = await seedSite(user.id);
    const template = FAKE_DOMAIN_COMPARISON.competitorOnly[0]!;
    setCompetitorProvider(createFakeCompetitorProvider({
      comparison: {
        shared: [],
        ownedOnly: [],
        competitorOnly: [
          {
            ...template,
            observationMeta: { ...template.observationMeta, sourceLabel: null },
          },
        ],
      },
    }));

    const response = await request(app)
      .get(`/api/sites/${siteId}/competitors/intersection?competitor=rival.example`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(response.body.keywords).toEqual([
      expect.objectContaining({
        provenance: expect.objectContaining({
          provider: 'dataforseo',
          capturedAt: template.observationMeta.observedAt,
        }),
      }),
    ]);
  });

  it('returns gap keywords for verified accounts', async () => {
    const user = await seedUser('agencyI@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors/intersection?competitor=rival.example`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.competitor).toBe('rival.example');
    expect(Array.isArray(res.body.keywords)).toBe(true);
  });

  it('caches gap keywords for the day: second call skips the vendor', async () => {
    const user = await seedUser('cacheI@x.co');
    const siteId = await seedSite(user.id);
    let calls = 0;
    setCompetitorProvider({
      async getCompetitors() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        calls += 1;
        return [
          {
            keyword: 'seo tool',
            target1Position: 4,
            target2Position: 2,
            searchVolume: 900,
          },
        ];
      },
    });
    const url = `/api/sites/${siteId}/competitors/intersection?competitor=rival.example`;
    const first = await request(app).get(url).set('Cookie', user.cookie).expect(200);
    const second = await request(app).get(url).set('Cookie', user.cookie).expect(200);
    expect(calls).toBe(1);
    expect(second.body.keywords).toEqual(
      first.body.keywords.map((row: { provenance?: Record<string, unknown> }) => ({
        ...row,
        provenance: row.provenance ? { ...row.provenance, cache: 'hit' } : undefined,
      })),
    );
    // Persisted exactly one cache row for the pair.
    const rows = await getTestDb()
      .select()
      .from(intersectionsTable)
      .where(eq(intersectionsTable.siteId, siteId));
    expect(rows).toHaveLength(1);
  });

  it('validates empty competitor query with 400', async () => {
    const user = await seedUser('badI@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors/intersection`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('honours locationCode/languageCode overrides', async () => {
    const user = await seedUser('locI@x.co');
    const siteId = await seedSite(user.id);
    const seen: Array<Record<string, unknown>> = [];
    setCompetitorProvider({
      async getCompetitors() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection(_t1, _t2, opts) {
        seen.push(opts as unknown as Record<string, unknown>);
        return [];
      },
    });
    const res = await request(app)
      .get(
        `/api/sites/${siteId}/competitors/intersection?competitor=rival.example&locationCode=2826&languageCode=fr`,
      )
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject({ locationCode: 2826, languageCode: 'fr' });
  });

  it('surfaces provider failure as 503', async () => {
    const user = await seedUser('failI@x.co');
    const siteId = await seedSite(user.id);
    setCompetitorProvider({
      async getCompetitors() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors/intersection?competitor=rival.example`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
  });

  it('cross-account access 404', async () => {
    const a = await seedUser('aI@x.co');
    const b = await seedUser('bI@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors/intersection?competitor=rival.example`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('malI@x.co');
    const res = await request(app)
      .get('/api/sites/not-an-object-id/competitors/intersection?competitor=rival.example')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('cross-user vendor cache (generic vendor layer)', () => {
  function countingProvider(): { provider: CompetitorProvider; calls: () => number } {
    let vendorCalls = 0;
    const provider: CompetitorProvider = {
      async getCompetitors(_domain, _location, _language, limit) {
        vendorCalls += 1;
        return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
          domain: `rival-${i}.example`,
          avgPosition: i + 1.5,
          intersections: 100 - i,
          estimatedTraffic: 1000 * (i + 1),
        }));
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        vendorCalls += 1;
        return [
          { keyword: 'shared keyword', target1Position: 3, target2Position: 7, searchVolume: 900 },
        ];
      },
    };
    return { provider, calls: () => vendorCalls };
  }

  it('list: account B on the same (domain, geo, lang) is served from our DB — one vendor call, B gets own snapshot rows', async () => {
    const counting = countingProvider();
    setCompetitorProvider(counting.provider);
    const userA = await seedUser('xcomp-a@x.co');
    const userB = await seedUser('xcomp-b@x.co');
    const siteA = await seedSite(userA.id, 'sharedcomp.example');
    const siteB = await seedSite(userB.id, 'sharedcomp.example');

    const first = await request(app)
      .get(`/api/sites/${siteA}/competitors`)
      .set('Cookie', userA.cookie);
    expect(first.status).toBe(200);
    expect(first.body.competitors).toHaveLength(3);
    expect(counting.calls()).toBe(1);

    const second = await request(app)
      .get(`/api/sites/${siteB}/competitors`)
      .set('Cookie', userB.cookie);
    expect(second.status).toBe(200);
    expect(second.body.competitors).toHaveLength(3);
    expect(second.body.competitors[0].domain).toBe('rival-0.example');
    // Served from the shared vendor cache — no second Labs call.
    expect(counting.calls()).toBe(1);

    // B gets its OWN per-site snapshot rows.
    const bRows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteB));
    expect(bRows).toHaveLength(3);
    expect(bRows.every((r) => r.accountId === userB.id)).toBe(true);

    // Exactly one archive row for the single vendor fetch.
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'list'));
    expect(archived).toHaveLength(1);
    expect(archived[0]?.capability).toBe('competitor');
    expect(archived[0]?.accountId).toBeNull();
  });

  it('intersection: second account on the same pair is served from our DB', async () => {
    const counting = countingProvider();
    setCompetitorProvider(counting.provider);
    const userA = await seedUser('xint-a@x.co');
    const userB = await seedUser('xint-b@x.co');
    const siteA = await seedSite(userA.id, 'sharedint.example');
    const siteB = await seedSite(userB.id, 'sharedint.example');

    const first = await request(app)
      .get(`/api/sites/${siteA}/competitors/intersection?competitor=rival-0.example`)
      .set('Cookie', userA.cookie);
    expect(first.status).toBe(200);
    expect(counting.calls()).toBe(1);

    const second = await request(app)
      .get(`/api/sites/${siteB}/competitors/intersection?competitor=rival-0.example`)
      .set('Cookie', userB.cookie);
    expect(second.status).toBe(200);
    expect(second.body.keywords).toHaveLength(1);
    expect(counting.calls()).toBe(1);

    // B still gets its own per-account intersection snapshot row.
    const bRows = await getTestDb()
      .select()
      .from(intersectionsTable)
      .where(eq(intersectionsTable.siteId, siteB));
    expect(bRows).toHaveLength(1);

    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'intersection'));
    expect(archived).toHaveLength(1);
  });

  it('the shared cache expires at UTC midnight — next day refetches (service-level)', async () => {
    const counting = countingProvider();
    const db = getTestDb() as unknown as never;
    const userA = await seedUser('xmid-a@x.co');
    const userB = await seedUser('xmid-b@x.co');
    const siteA = await seedSite(userA.id, 'midnight.example');
    const siteB = await seedSite(userB.id, 'midnight.example');

    // A fetches at 23:59:59 UTC.
    await listCompetitors(
      { accountId: userA.id, siteId: siteA },
      { db, provider: counting.provider, now: () => new Date('2026-07-05T23:59:59.000Z') },
    );
    expect(counting.calls()).toBe(1);

    // B asks one minute past midnight — the shared row is expired.
    await listCompetitors(
      { accountId: userB.id, siteId: siteB },
      { db, provider: counting.provider, now: () => new Date('2026-07-06T00:01:00.000Z') },
    );
    expect(counting.calls()).toBe(2);
  });

  it('provider failure writes neither cache nor archive', async () => {
    setCompetitorProvider({
      async getCompetitors() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    });
    const user = await seedUser('xcompfail@x.co');
    const siteId = await seedSite(user.id, 'compfail.example');
    await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(503);
    await expect(getTestDb().select().from(vendorResponses)).resolves.toHaveLength(0);
    await expect(getTestDb().select().from(vendorCache)).resolves.toHaveLength(0);
  });
});

describe('POST /api/sites/:siteId/competitors/refresh', () => {
  async function seedTodayRows(siteId: string, accountId: string, domain = 'stale-rival.example') {
    const now = new Date();
    await getTestDb().insert(competitorsTable).values({
      siteId,
      accountId,
      competitorDomain: domain,
      avgPosition: '9.9',
      intersections: 1,
      estimatedTraffic: '10',
      fetchedAt: now,
      snapshotDay: now.toISOString().slice(0, 10),
    });
  }

  async function readTodayRows(siteId: string) {
    return getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
  }

  function stubCompetitorProvider(entries?: Array<{ domain: string }>) {
    let calls = 0;
    const provider: CompetitorProvider = {
      async getCompetitors() {
        calls += 1;
        return (entries ?? [{ domain: 'fresh-rival.example' }]).map((e) => ({
          domain: e.domain,
          avgPosition: 3.5,
          intersections: 12,
          estimatedTraffic: 987,
        }));
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
    };
    return { provider, getCalls: () => calls };
  }

  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post('/api/sites/anything/competitors/refresh');
    expect(res.status).toBe(401);
  });

  it('cross-account refresh 404s and never reaches the provider', async () => {
    const owner = await seedUser('crf-owner@x.co');
    const stranger = await seedUser('crf-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const { provider, getCalls } = stubCompetitorProvider();
    setCompetitorProvider(provider);
    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(getCalls()).toBe(0);
  });

  it('deletes today\'s rows BEFORE the vendor call and inserts fresh rows after', async () => {
    const user = await seedUser('crf-agency@x.co');
    const siteId = await seedSite(user.id, 'refresh-me.example');
    await seedTodayRows(siteId, user.id);

    // The provider observes the table mid-flight: today's rows must already
    // be gone when the vendor call happens (delete → vendor → insert order).
    let rowsSeenByProvider: number | null = null;
    let calls = 0;
    const provider: CompetitorProvider = {
      async getCompetitors() {
        calls += 1;
        rowsSeenByProvider = (await readTodayRows(siteId)).length;
        return [
          { domain: 'fresh-rival.example', avgPosition: 3.5, intersections: 12, estimatedTraffic: 987 },
        ];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
    };
    setCompetitorProvider(provider);

    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect(rowsSeenByProvider).toBe(0);
    expect(res.body.competitors).toHaveLength(1);
    expect(res.body.competitors[0].domain).toBe('fresh-rival.example');

    // Table replaced: only the fresh row remains for today.
    const after = await readTodayRows(siteId);
    expect(after).toHaveLength(1);
    expect(after[0]?.competitorDomain).toBe('fresh-rival.example');

    // Archive row landed for the forced fetch.
    const archived = await getTestDb().select().from(vendorResponses);
    expect(archived.some((r) => r.capability === 'competitor' && r.operation === 'list')).toBe(true);
  });

  it('cooldown: second rapid refresh 429s with localized countdown; clears after the window', async () => {
    let clock = 1_000_000;
    setCompetitorsCooldown(createInMemoryCooldown({ defaultMs: 60_000, now: () => clock }));
    const user = await seedUser('crf-cool@x.co');
    const siteId = await seedSite(user.id);
    const { provider, getCalls } = stubCompetitorProvider();
    setCompetitorProvider(provider);

    await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(getCalls()).toBe(1);

    clock += 45_000; // 15s of the 60s window remain
    const second = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe(
      translate('en', 'competitors.errors.refreshCooldown', { seconds: 15 }),
    );
    expect(second.body.error.details.retryAfterMs).toBe(15_000);
    expect(getCalls()).toBe(1);

    clock += 15_000;
    await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(getCalls()).toBe(2);
  });

  it('vendor failure → 503, today\'s rows restored intact, cooldown engaged', async () => {
    let clock = 2_000_000;
    setCompetitorsCooldown(createInMemoryCooldown({ defaultMs: 60_000, now: () => clock }));
    const user = await seedUser('crf-fail@x.co');
    const siteId = await seedSite(user.id, 'rollback.example');
    await seedTodayRows(siteId, user.id);
    setCompetitorProvider({
      async getCompetitors() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    });

    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.competitors.errors.unavailable,
    );
    // The compensating restore re-inserted the saved rows — last good data survives.
    const rows = await readTodayRows(siteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.competitorDomain).toBe('stale-rival.example');
    // The attempted fetch engaged the cooldown — an immediate retry throttles.
    clock += 1_000;
    const retry = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(retry.status).toBe(429);
  });

  it('404s on a malformed site id without touching the provider', async () => {
    const user = await seedUser('crf-badid@x.co');
    const { provider, getCalls } = stubCompetitorProvider();
    setCompetitorProvider(provider);
    const res = await request(app)
      .post('/api/sites/not-an-object-id/competitors/refresh')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(getCalls()).toBe(0);
  });
});

describe('GET /api/sites/:siteId/competitors/:domain/tech-stack', () => {
  const techStackUrl = (siteId: string, domain = 'rival.example') =>
    `/api/sites/${siteId}/competitors/${domain}/tech-stack`;

  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get(techStackUrl('anything'));
    expect(res.status).toBe(401);
  });

  it('returns the normalized tech stack for verified accounts', async () => {
    const user = await seedUser('ts-agency@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(techStackUrl(siteId))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.competitor).toBe('rival.example');
    expect(res.body.techStack).toEqual([
      { category: 'cms', name: 'WordPress' },
      { category: 'analytics', name: 'Google Analytics' },
      { category: 'hosting', name: 'Cloudflare' },
      { category: 'ecommerce', name: 'WooCommerce' },
      { category: 'other', name: 'Intercom' },
    ]);
  });

  it('second lookup within the TTL is cache-served — one vendor call', async () => {
    const user = await seedUser('ts-cache@x.co');
    const siteId = await seedSite(user.id);
    let calls = 0;
    setCompetitorProvider({
      async getCompetitors() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        calls += 1;
        return [{ category: 'cms' as const, name: 'Ghost' }];
      },
    });
    const url = techStackUrl(siteId);
    const first = await request(app).get(url).set('Cookie', user.cookie).expect(200);
    const second = await request(app).get(url).set('Cookie', user.cookie).expect(200);
    // Second served from the cross-user vendor cache — no second vendor call.
    expect(calls).toBe(1);
    expect(second.body.techStack).toEqual(first.body.techStack);
    // Archived under the competitor capability, tech-stack operation.
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'tech-stack'));
    expect(archived).toHaveLength(1);
    expect(archived[0]?.capability).toBe('competitor');
  });

  it('surfaces provider failure as 503', async () => {
    const user = await seedUser('ts-fail@x.co');
    const siteId = await seedSite(user.id);
    setCompetitorProvider({
      async getCompetitors() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getTechnologies() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
    });
    const res = await request(app)
      .get(techStackUrl(siteId))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.competitors.errors.unavailable,
    );
  });

  it('cross-account access 404 (site ownership scoped)', async () => {
    const a = await seedUser('ts-a@x.co');
    const b = await seedUser('ts-b@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(techStackUrl(siteId))
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('ts-mal@x.co');
    const res = await request(app)
      .get(techStackUrl('not-an-object-id'))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('tracked-keyword fallback (serp_competitors)', () => {
  const SERP_RIVALS: CompetitorEntry[] = [
    { domain: 'serp-rival.example', avgPosition: 1, intersections: 3, estimatedTraffic: 231.04 },
    { domain: 'serp-other.example', avgPosition: 8, intersections: 1, estimatedTraffic: null },
  ];

  async function seedKeywords(
    accountId: string,
    siteId: string,
    phrases: string[],
    active = true,
  ) {
    await getTestDb()
      .insert(keywordsTable)
      .values(
        phrases.map((phrase) => ({
          accountId,
          siteId,
          phrase,
          locationCode: 2840,
          languageCode: 'en',
          active,
        })),
      );
  }

  function fallbackProvider(opts: {
    primary?: CompetitorEntry[];
    serp?: CompetitorEntry[];
    serpError?: Error;
  } = {}) {
    let primaryCalls = 0;
    let serpCalls = 0;
    let serpKeywords: string[] | null = null;
    const provider: CompetitorProvider = {
      async getCompetitors() {
        primaryCalls += 1;
        return opts.primary ?? [];
      },
      async getSerpCompetitors(kw) {
        serpCalls += 1;
        serpKeywords = kw;
        if (opts.serpError) throw opts.serpError;
        return opts.serp ?? SERP_RIVALS;
      },
      async getTechnologies() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
    };
    return {
      provider,
      primaryCalls: () => primaryCalls,
      serpCalls: () => serpCalls,
      serpKeywords: () => serpKeywords,
    };
  }

  it('GET falls back to the tracked keywords when the domain list is empty — source flagged, both cache ops written', async () => {
    const user = await seedUser('kwfb-a@x.co');
    const siteId = await seedSite(user.id, 'kwfb.example');
    // Duplicate + padded phrases prove the canonical (trim/de-dupe/sort) set
    // reaches the provider — the same set that keys the serp-list cache row.
    await seedKeywords(user.id, siteId, ['uptime monitor', '  Uptime Monitor ', 'uptime kuma']);
    const fb = fallbackProvider();
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('tracked_keywords');
    expect(res.body.competitors.map((c: { domain: string }) => c.domain)).toEqual([
      'serp-rival.example',
      'serp-other.example',
    ]);
    expect(fb.primaryCalls()).toBe(1);
    expect(fb.serpCalls()).toBe(1);
    expect(fb.serpKeywords()).toEqual(['uptime kuma', 'uptime monitor']);


    // Snapshot rows persisted and flagged with the fallback source.
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'tracked_keywords')).toBe(true);

    // Both vendor operations cached + archived.
    const cacheRows = await getTestDb().select().from(vendorCache);
    expect(cacheRows.map((r) => r.operation).sort()).toEqual(['list', 'serp-list']);
    const archived = await getTestDb().select().from(vendorResponses);
    expect(archived.map((r) => r.operation).sort()).toEqual(['list', 'serp-list']);
  });

  it('no active tracked keywords → no fallback call, empty result', async () => {
    const user = await seedUser('kwfb-none@x.co');
    const siteId = await seedSite(user.id, 'kwfb-none.example');
    // An INACTIVE keyword must not trigger the fallback.
    await seedKeywords(user.id, siteId, ['uptime monitor'], false);
    const fb = fallbackProvider();
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('domain');
    expect(res.body.competitors).toEqual([]);
    expect(fb.serpCalls()).toBe(0);
    const cacheRows = await getTestDb().select().from(vendorCache);
    expect(cacheRows.some((r) => r.operation === 'serp-list')).toBe(false);
  });

  it('non-empty domain list → fallback never consulted, source stays domain', async () => {
    const user = await seedUser('kwfb-prim@x.co');
    const siteId = await seedSite(user.id, 'kwfb-prim.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const fb = fallbackProvider({
      primary: [
        { domain: 'rival.example', avgPosition: 3, intersections: 5, estimatedTraffic: null },
      ],
    });
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('domain');
    expect(fb.serpCalls()).toBe(0);
  });

  it("filters the site's own domain (www variant included) from the fallback rows", async () => {
    const user = await seedUser('kwfb-own@x.co');
    // The site's stored domain carries a www prefix; the filter must still
    // match the provider-normalized bare host.
    const siteId = await seedSite(user.id, 'www.kwfb-own.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const fb = fallbackProvider({
      serp: [
        { domain: 'kwfb-own.example', avgPosition: 1, intersections: 2, estimatedTraffic: null },
        { domain: 'serp-rival.example', avgPosition: 2, intersections: 1, estimatedTraffic: null },
      ],
    });
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('tracked_keywords');
    expect(res.body.competitors.map((c: { domain: string }) => c.domain)).toEqual([
      'serp-rival.example',
    ]);
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.competitorDomain).toBe('serp-rival.example');
  });

  it('same-day second GET is served from the snapshot with the source preserved', async () => {
    const user = await seedUser('kwfb-snap@x.co');
    const siteId = await seedSite(user.id, 'kwfb-snap.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const fb = fallbackProvider();
    setCompetitorProvider(fb.provider);

    await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);
    const second = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(second.body.source).toBe('tracked_keywords');
    // No further vendor calls; the snapshot read is served from our DB.
    expect(fb.primaryCalls()).toBe(1);
    expect(fb.serpCalls()).toBe(1);
  });

  it('refresh replaces the snapshot via the fallback and flags the source', async () => {
    const user = await seedUser('kwfb-rf@x.co');
    const siteId = await seedSite(user.id, 'kwfb-rf.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const now = new Date();
    await getTestDb().insert(competitorsTable).values({
      siteId,
      accountId: user.id,
      competitorDomain: 'stale-rival.example',
      avgPosition: '9.9',
      intersections: 1,
      estimatedTraffic: '10',
      fetchedAt: now,
      snapshotDay: now.toISOString().slice(0, 10),
    });
    const fb = fallbackProvider();
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('tracked_keywords');
    expect(fb.serpCalls()).toBe(1);
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows.map((r) => r.competitorDomain).sort()).toEqual([
      'serp-other.example',
      'serp-rival.example',
    ]);
    expect(rows.every((r) => r.source === 'tracked_keywords')).toBe(true);
  });

  it('refresh fallback vendor failure → 503 with the compensating restore intact', async () => {
    const user = await seedUser('kwfb-rffail@x.co');
    const siteId = await seedSite(user.id, 'kwfb-rffail.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const now = new Date();
    await getTestDb().insert(competitorsTable).values({
      siteId,
      accountId: user.id,
      competitorDomain: 'stale-rival.example',
      avgPosition: '9.9',
      intersections: 1,
      estimatedTraffic: '10',
      fetchedAt: now,
      snapshotDay: now.toISOString().slice(0, 10),
    });
    const fb = fallbackProvider({
      serpError: new VendorUnavailableError('serp down', { provider: 'x', operation: 'y' }),
    });
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.competitors.errors.unavailable);
    // The saved rows were re-inserted — last good data (and its source) survive.
    const rows = await getTestDb()
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.siteId, siteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.competitorDomain).toBe('stale-rival.example');
    expect(rows[0]?.source).toBe('domain');
  });

  it('fallback returning an empty SERP list keeps the honest empty domain result', async () => {
    const user = await seedUser('kwfb-serpempty@x.co');
    const siteId = await seedSite(user.id, 'kwfb-serpempty.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const fb = fallbackProvider({ serp: [] });
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .get(`/api/sites/${siteId}/competitors`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('domain');
    expect(res.body.competitors).toEqual([]);
    expect(fb.serpCalls()).toBe(1);
  });

  it('refresh without tracked keywords skips the fallback and returns the empty primary result', async () => {
    const user = await seedUser('kwfb-rfnone@x.co');
    const siteId = await seedSite(user.id, 'kwfb-rfnone.example');
    const fb = fallbackProvider();
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('domain');
    expect(res.body.competitors).toEqual([]);
    expect(fb.serpCalls()).toBe(0);
  });

  it('refresh whose fallback is also empty returns the honest empty result', async () => {
    const user = await seedUser('kwfb-rfempty@x.co');
    const siteId = await seedSite(user.id, 'kwfb-rfempty.example');
    await seedKeywords(user.id, siteId, ['uptime monitor']);
    const fb = fallbackProvider({ serp: [] });
    setCompetitorProvider(fb.provider);

    const res = await request(app)
      .post(`/api/sites/${siteId}/competitors/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('domain');
    expect(res.body.competitors).toEqual([]);
    expect(fb.serpCalls()).toBe(1);
  });

  it('serp-list cache is keyed by the keyword set — no cross-account bleed on the same domain', async () => {
    const userA = await seedUser('kwfb-x1@x.co');
    const userB = await seedUser('kwfb-x2@x.co');
    const siteA = await seedSite(userA.id, 'kwfb-shared.example');
    const siteB = await seedSite(userB.id, 'kwfb-shared.example');
    await seedKeywords(userA.id, siteA, ['alpha keyword']);
    await seedKeywords(userB.id, siteB, ['beta keyword']);
    const fb = fallbackProvider();
    setCompetitorProvider(fb.provider);

    await request(app)
      .get(`/api/sites/${siteA}/competitors`)
      .set('Cookie', userA.cookie)
      .expect(200);
    await request(app)
      .get(`/api/sites/${siteB}/competitors`)
      .set('Cookie', userB.cookie)
      .expect(200);
    // B's primary is served from the shared domain-keyed 'list' cache, but the
    // keyword-keyed 'serp-list' row cannot be shared — a second vendor call.
    expect(fb.serpCalls()).toBe(2);
    expect(fb.primaryCalls()).toBe(1);
    const serpRows = (await getTestDb().select().from(vendorCache)).filter(
      (r) => r.operation === 'serp-list',
    );
    expect(serpRows).toHaveLength(2);
    expect(new Set(serpRows.map((r) => r.cacheKey)).size).toBe(2);
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('competitors service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';
  it('refuses a well-formed site id this account does not own', async () => {
    await expect(listCompetitors({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99' }, { db: getTestDb() } as unknown as Parameters<typeof listCompetitors>[1])).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(listCompetitors({ accountId: GUARD_ACCOUNT, siteId: 'not-an-id' }, { db: getTestDb() } as unknown as Parameters<typeof listCompetitors>[1])).rejects.toMatchObject({ status: 404 });
  });
});
