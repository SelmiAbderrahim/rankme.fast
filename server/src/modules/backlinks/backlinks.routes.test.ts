/**
 * Backlinks route + failure-isolation tests.
 *
 * Real Better-Auth + PGlite + Mongo-memory harness (matches the ranks +
 * keyword-research suites).
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
import { backlinkSnapshots } from '../../db/schema/backlinks.js';
import {
  VendorUnavailableError,
  createFakeBacklinkProvider,
  recordVendorCostUsd,
  type BacklinkProvider,
} from '../../shared/providers/index.js';
import {
  setBacklinkProvider,
  setBacklinksCooldown,
  setBacklinksDb,
} from './backlinks.holder.js';
import { createInMemoryCooldown } from '../../shared/cooldown/index.js';
import { computeVendorCacheKey } from '../../shared/vendor-cache/index.js';
import { translate } from '../../shared/i18n/index.js';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import { setRanksDb } from '../ranks/index.js';
import { setKeywordResearchDb } from '../keyword-research/index.js';
import { setCompetitorsDb } from '../competitors/index.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { eq } from 'drizzle-orm';
import { getBacklinkSummary } from './backlinks.service.js';

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
  setBacklinksDb(db as unknown as never);
  setRanksDb(db as unknown as never);
  setKeywordResearchDb(db as unknown as never);
  setCompetitorsDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setBacklinksDb(null);
  setRanksDb(null);
  setKeywordResearchDb(null);
  setCompetitorsDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setBacklinkProvider(createFakeBacklinkProvider());
  // Fresh default cooldown per test — no cross-test 429 bleed.
  setBacklinksCooldown(null);
});

describe('GET /api/sites/:siteId/backlinks/summary', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/sites/anything/backlinks/summary');
    expect(res.status).toBe(401);
  });

  it('returns null for a never-fetched domain — GET is cache-only, zero vendor calls', async () => {
    const user = await seedUser('pro@x.co');
    const siteId = await seedSite(user.id);
    let vendorCalls = 0;
    setBacklinkProvider({
      async getSummary() {
        vendorCalls += 1;
        throw new Error('GET must never reach the vendor');
      },
      async listBacklinks() {
        throw new Error('unused');
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks/summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(vendorCalls).toBe(0);
    const rows = await getTestDb().select().from(backlinkSnapshots).where(
      eq(backlinkSnapshots.siteId, siteId),
    );
    expect(rows).toHaveLength(0);
  });

  it('serves the summary after a refresh seeds it (no new snapshot row on GET)', async () => {
    const user = await seedUser('procache@x.co');
    const siteId = await seedSite(user.id);
    await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks/summary`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.backlinks).toBeGreaterThan(0);
    const rows = await getTestDb().select().from(backlinkSnapshots).where(
      eq(backlinkSnapshots.siteId, siteId),
    );
    expect(rows).toHaveLength(1);
  });

  it('delta.domainRating is null when either side missing (prev has null rating) — refresh path', async () => {
    const user = await seedUser('prodrnull@x.co');
    const siteId = await seedSite(user.id);
    await getTestDb().insert(backlinkSnapshots).values({
      siteId,
      accountId: user.id,
      domainRating: null,
      backlinks: 10,
      referringDomains: 5,
      brokenBacklinks: 0,
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.delta).not.toBeNull();
    expect(res.body.delta.domainRating).toBeNull();
    expect(res.body.delta.backlinks).toBeGreaterThanOrEqual(0);
  });

  it('GET after TTL serves the STALE snapshot without spending; refresh reports the delta', async () => {
    const user = await seedUser('prodelta@x.co');
    const siteId = await seedSite(user.id);
    // First snapshot with lower counts, 48h old (past the 24h TTL).
    await getTestDb().insert(backlinkSnapshots).values({
      siteId,
      accountId: user.id,
      domainRating: 30,
      backlinks: 100,
      referringDomains: 10,
      brokenBacklinks: 1,
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    let vendorCalls = 0;
    const counting = createFakeBacklinkProvider();
    setBacklinkProvider({
      async getSummary(domain) {
        vendorCalls += 1;
        return counting.getSummary(domain);
      },
      listBacklinks: counting.listBacklinks.bind(counting),
    });
    // Cache-only GET: stale data served as-is, zero vendor calls.
    const stale = await request(app)
      .get(`/api/sites/${siteId}/backlinks/summary`)
      .set('Cookie', user.cookie);
    expect(stale.status).toBe(200);
    expect(stale.body.cached).toBe(true);
    expect(stale.body.backlinks).toBe(100);
    expect(stale.body.delta).toBeNull();
    expect(vendorCalls).toBe(0);
    // The refresh is the path to fresh data + the delta.
    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.delta).not.toBeNull();
    expect(res.body.delta.backlinks).toBe(res.body.backlinks - 100);
    expect(vendorCalls).toBe(1);
  });

  it('provider failure: GET stays 200 (cache-only), refresh surfaces localized 503 (no snapshot persisted)', async () => {
    const user = await seedUser('fail@x.co');
    const siteId = await seedSite(user.id);
    const failing: BacklinkProvider = {
      async getSummary() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
      async listBacklinks() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
    };
    setBacklinkProvider(failing);
    // GET never touches the provider — a vendor outage cannot break the read.
    const read = await request(app)
      .get(`/api/sites/${siteId}/backlinks/summary`)
      .set('Cookie', user.cookie);
    expect(read.status).toBe(200);
    expect(read.body).toBeNull();
    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.backlinks.errors.unavailable,
    );
    const rows = await getTestDb().select().from(backlinkSnapshots).where(
      eq(backlinkSnapshots.siteId, siteId),
    );
    expect(rows).toHaveLength(0);
  });

  it('cross-account access returns 404, not 403 (no existence leak)', async () => {
    const a = await seedUser('a@x.co');
    const b = await seedUser('b@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks/summary`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('mal@x.co');
    const res = await request(app)
      .get('/api/sites/not-an-object-id/backlinks/summary')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

});

describe('GET /api/sites/:siteId/backlinks', () => {
  it('returns rows for an owned site', async () => {
    const user = await seedUser('proL@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body).not.toHaveProperty('meteredRows');
    expect(res.body).not.toHaveProperty('rowBudget');
  });

  it('honours the cursor query param and passes it to the provider', async () => {
    const user = await seedUser('proC@x.co');
    const siteId = await seedSite(user.id);
    const seenOpts: unknown[] = [];
    setBacklinkProvider({
      async getSummary() {
        return {
          domainRank: 1,
          backlinks: 1,
          referringDomains: 1,
          brokenBacklinks: 0,
          firstSeen: null,
        };
      },
      async listBacklinks(_domain, opts) {
        seenOpts.push(opts);
        return {
          rows: [
            {
              urlFrom: 'https://x.example/a',
              urlTo: 'https://example.com/',
              anchor: 'a',
              dofollow: true,
              isBroken: false,
              firstSeen: null,
              lastSeen: null,
            },
          ],
        };
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks?cursor=abc&limit=25`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(seenOpts).toEqual([{ limit: 25, cursor: 'abc' }]);
    expect(res.body.rows).toHaveLength(1);
  });

  it('handles null timestamps end-to-end (cache write + read)', async () => {
    const user = await seedUser('proTs@x.co');
    const siteId = await seedSite(user.id);
    setBacklinkProvider({
      async getSummary() {
        return {
          domainRank: 1,
          backlinks: 1,
          referringDomains: 1,
          brokenBacklinks: 0,
          firstSeen: null,
        };
      },
      async listBacklinks() {
        return {
          rows: [
            {
              urlFrom: 'https://x.example/a',
              urlTo: 'https://example.com/',
              anchor: null,
              dofollow: false,
              isBroken: false,
              firstSeen: null,
              lastSeen: null,
            },
          ],
        };
      },
    });
    // Also refresh the summary — vendor returns firstSeen: null → exercises
    // the null-serialization branch on the summary payload (GET is cache-only
    // and would return null here).
    const sumRes = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(sumRes.body.firstSeen).toBeNull();
    // First fetch — writes cache with null timestamps.
    const first = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(first.body.rows[0].firstSeen).toBeNull();
    // Second — reads cache back, exercising the null branch of cachedToRows.
    const second = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.rows[0].firstSeen).toBeNull();
  });

  it('list caches on top of an existing summary snapshot (update path)', async () => {
    const user = await seedUser('proUpd@x.co');
    const siteId = await seedSite(user.id);
    // Refresh the summary to persist a snapshot row (GET is cache-only and
    // would persist nothing here).
    await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    // Now call list — cache is written on the existing snapshot row.
    const first = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(first.body.cached).toBe(false);
    // Second list call within TTL — serves from cache.
    const second = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(second.body.cached).toBe(true);
  });

  it('wrapProviderError rethrows non-Provider errors as-is', async () => {
    const user = await seedUser('proWrap@x.co');
    const siteId = await seedSite(user.id);
    setBacklinkProvider({
      async getSummary() {
        throw new Error('plain error');
      },
      async listBacklinks() {
        throw new Error('plain error');
      },
    });
    // Both vendor-touching endpoints surface as 500 (unhandled) —
    // errorHandler catches plain Errors and returns a localized generic
    // message. Summary GET is cache-only, so the refresh POST carries the
    // summary-path coverage.
    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(500);
    const res2 = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie);
    expect(res2.status).toBe(500);
  });

  it('second first-page read within TTL is served from the cache', async () => {
    const user = await seedUser('proCache@x.co');
    const siteId = await seedSite(user.id);
    const first = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(first.body.cached).toBe(false);
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.rows).toEqual(first.body.rows);
  });

  it('surfaces provider failure as 503', async () => {
    const user = await seedUser('failL@x.co');
    const siteId = await seedSite(user.id);
    setBacklinkProvider({
      async getSummary() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
      async listBacklinks() {
        throw new VendorUnavailableError('vendor down', {
          provider: 'x',
          operation: 'y',
        });
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
  });

  it('cross-account access returns 404', async () => {
    const a = await seedUser('aL@x.co');
    const b = await seedUser('bL@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('malL@x.co');
    const res = await request(app)
      .get('/api/sites/not-an-object-id/backlinks')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('validates malformed limit param with 400', async () => {
    const user = await seedUser('badL@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks?limit=abc`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });
});

describe('cross-user vendor cache (generic vendor layer)', () => {
  function countingProvider(): { provider: BacklinkProvider; calls: () => number } {
    let vendorCalls = 0;
    const provider: BacklinkProvider = {
      async getSummary() {
        vendorCalls += 1;
        return {
          domainRank: 55,
          backlinks: 1234,
          referringDomains: 99,
          brokenBacklinks: 3,
          firstSeen: new Date('2024-01-01T00:00:00.000Z'),
        };
      },
      async listBacklinks(_domain, opts) {
        vendorCalls += 1;
        return {
          rows: Array.from({ length: Math.min(opts.limit, 5) }, (_, i) => ({
            urlFrom: `https://ref-${i}.example/`,
            urlTo: 'https://shared.example/',
            anchor: i % 2 === 0 ? `anchor ${i}` : null,
            dofollow: i % 2 === 0,
            isBroken: false,
            firstSeen: new Date('2025-06-01T00:00:00.000Z'),
            lastSeen: null,
          })),
          ...(opts.cursor ? {} : { nextCursor: 'page-2' }),
        };
      },
    };
    return { provider, calls: () => vendorCalls };
  }

  it("summary: A's refresh seeds the shared cache; B's GET is served from our DB — one vendor call total, B still gets its own snapshot row", async () => {
    const counting = countingProvider();
    setBacklinkProvider(counting.provider);
    const userA = await seedUser('xuser-a@x.co');
    const userB = await seedUser('xuser-b@x.co');
    const siteA = await seedSite(userA.id, 'shared.example');
    const siteB = await seedSite(userB.id, 'shared.example');

    // A pays for the fetch via the manual refresh (GETs never spend).
    const first = await request(app)
      .post(`/api/sites/${siteA}/backlinks/refresh`)
      .set('Cookie', userA.cookie);
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(counting.calls()).toBe(1);

    const second = await request(app)
      .get(`/api/sites/${siteB}/backlinks/summary`)
      .set('Cookie', userB.cookie);
    expect(second.status).toBe(200);
    // Served from the shared vendor cache — no second vendor call.
    expect(second.body.cached).toBe(true);
    expect(second.body.backlinks).toBe(1234);
    expect(counting.calls()).toBe(1);

    // B gets its OWN per-site snapshot row (history feature preserved).
    const bRows = await getTestDb()
      .select()
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.siteId, siteB));
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.accountId).toBe(userB.id);
    expect(bRows[0]?.backlinks).toBe(1234);

    // Exactly one archive row — the single vendor fetch.
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.capability, 'backlink'));
    expect(archived).toHaveLength(1);
    expect(archived[0]?.operation).toBe('summary');
    expect(archived[0]?.accountId).toBeNull();
  });

  it('list first page: B served from cache with zero vendor calls', async () => {
    const counting = countingProvider();
    setBacklinkProvider(counting.provider);
    const userA = await seedUser('xlist-a@x.co');
    const userB = await seedUser('xlist-b@x.co');
    const siteA = await seedSite(userA.id, 'sharedlist.example');
    const siteB = await seedSite(userB.id, 'sharedlist.example');

    const first = await request(app)
      .get(`/api/sites/${siteA}/backlinks?limit=5`)
      .set('Cookie', userA.cookie);
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(first.body.rows).toHaveLength(5);
    expect(counting.calls()).toBe(1);

    const second = await request(app)
      .get(`/api/sites/${siteB}/backlinks?limit=5`)
      .set('Cookie', userB.cookie);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.rows).toHaveLength(5);
    expect(second.body.rows[0].urlFrom).toBe('https://ref-0.example/');
    expect(counting.calls()).toBe(1);
  });

  it('cursor pages are archived (save-everything) but never served from the cache', async () => {
    const counting = countingProvider();
    setBacklinkProvider(counting.provider);
    const user = await seedUser('xcursor@x.co');
    const siteId = await seedSite(user.id, 'cursor.example');

    const first = await request(app)
      .get(`/api/sites/${siteId}/backlinks?limit=5&cursor=page-2`)
      .set('Cookie', user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);

    const second = await request(app)
      .get(`/api/sites/${siteId}/backlinks?limit=5&cursor=page-2`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(false);
    // Both cursor fetches hit the vendor…
    expect(counting.calls()).toBe(2);
    // …and both landed in the append-only archive.
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'list-page'));
    expect(archived).toHaveLength(2);
    // No read-through cache rows exist for cursor pages.
    const cacheRows = await getTestDb()
      .select()
      .from(vendorCache)
      .where(eq(vendorCache.operation, 'list-page'));
    expect(cacheRows).toHaveLength(0);
  });

  it('cursor pages persist the captured vendor cost on the archive row', async () => {
    const counting = countingProvider();
    setBacklinkProvider({
      ...counting.provider,
      async listBacklinks(domain, opts) {
        // Stands in for the DataForSEO choke point recording the envelope cost.
        recordVendorCostUsd(0.0201);
        return counting.provider.listBacklinks(domain, opts);
      },
    });
    const user = await seedUser('xcursorcost@x.co');
    const siteId = await seedSite(user.id, 'cursorcost.example');
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks?limit=5&cursor=page-2`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'list-page'));
    expect(archived).toHaveLength(1);
    expect(archived[0]!.costMicros).toBe(20_100n);
  });

  it('provider failure on a cursor page surfaces the localized 503 and archives nothing', async () => {
    setBacklinkProvider({
      async getSummary() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
      async listBacklinks() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    });
    const user = await seedUser('xcursorfail@x.co');
    const siteId = await seedSite(user.id, 'cursorfail.example');
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks?limit=5&cursor=page-2`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.backlinks.errors.unavailable);
    await expect(getTestDb().select().from(vendorResponses)).resolves.toHaveLength(0);
  });

  it('a corrupt shared-cache payload is ignored — GET still returns null, zero vendor calls', async () => {
    const user = await seedUser('xcorrupt@x.co');
    const siteId = await seedSite(user.id, 'corrupt.example');
    const now = new Date();
    await getTestDb().insert(vendorCache).values({
      capability: 'backlink',
      operation: 'summary',
      cacheKey: computeVendorCacheKey({
        capability: 'backlink',
        operation: 'summary',
        params: { domain: 'corrupt.example' },
      }),
      params: { domain: 'corrupt.example' },
      payload: { wrong: 'shape' },
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    let vendorCalls = 0;
    setBacklinkProvider({
      async getSummary() {
        vendorCalls += 1;
        throw new Error('unreachable');
      },
      async listBacklinks() {
        throw new Error('unused');
      },
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/backlinks/summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(vendorCalls).toBe(0);
  });

  it('provider failure on the shared path writes neither cache nor archive (refresh path)', async () => {
    const failing: BacklinkProvider = {
      async getSummary() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
      async listBacklinks() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    };
    setBacklinkProvider(failing);
    const user = await seedUser('xfail@x.co');
    const siteId = await seedSite(user.id, 'failing.example');
    await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie)
      .expect(503);
    await expect(getTestDb().select().from(vendorResponses)).resolves.toHaveLength(0);
    await expect(getTestDb().select().from(vendorCache)).resolves.toHaveLength(0);
  });
});

describe('POST /api/sites/:siteId/backlinks/refresh', () => {
  /** Deterministic stub so the response provably reflects the FRESH fetch. */
  function stubSummaryProvider(backlinks = 4321) {
    let calls = 0;
    const provider: BacklinkProvider = {
      async getSummary() {
        calls += 1;
        return {
          domainRank: 55,
          backlinks,
          referringDomains: 77,
          brokenBacklinks: 3,
          firstSeen: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      async listBacklinks() {
        return { rows: [], nextCursor: undefined };
      },
    };
    return { provider, getCalls: () => calls };
  }

  async function seedFreshSnapshot(siteId: string, accountId: string) {
    await getTestDb().insert(backlinkSnapshots).values({
      siteId,
      accountId,
      domainRating: 10,
      backlinks: 100,
      referringDomains: 20,
      brokenBacklinks: 1,
      fetchedAt: new Date(), // well inside the 24h per-site TTL
    });
  }

  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post('/api/sites/anything/backlinks/refresh');
    expect(res.status).toBe(401);
  });

  it('cross-account refresh 404s and never reaches the provider', async () => {
    const owner = await seedUser('rf-owner@x.co');
    const stranger = await seedUser('rf-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const { provider, getCalls } = stubSummaryProvider();
    setBacklinkProvider(provider);
    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(getCalls()).toBe(0);
  });

  it('forces a vendor call past a fresh cache, snapshots, invalidates the list cache', async () => {
    const user = await seedUser('rf-pro@x.co');
    const siteId = await seedSite(user.id, 'fresh.example');
    await seedFreshSnapshot(siteId, user.id);
    // A cached list first page for the same domain must be dropped.
    const listKey = computeVendorCacheKey({
      capability: 'backlink',
      operation: 'list-first-page',
      params: { domain: 'fresh.example', limit: 100 },
    });
    await getTestDb().insert(vendorCache).values({
      capability: 'backlink',
      operation: 'list-first-page',
      cacheKey: listKey,
      params: { domain: 'fresh.example', limit: 100 },
      payload: { rows: [], nextCursor: null },
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const { provider, getCalls } = stubSummaryProvider(4321);
    setBacklinkProvider(provider);

    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    // Response is the FRESH vendor data, not the seeded snapshot.
    expect(getCalls()).toBe(1);
    expect(res.body.cached).toBe(false);
    expect(res.body.backlinks).toBe(4321);
    expect(res.body.delta).toMatchObject({ backlinks: 4321 - 100 });

    // History grew: seeded row + refreshed row.
    const rows = await getTestDb()
      .select()
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.siteId, siteId));
    expect(rows).toHaveLength(2);

    // Archive row landed; list first-page cache entry is gone.
    const archived = await getTestDb().select().from(vendorResponses);
    expect(archived.some((r) => r.operation === 'summary')).toBe(true);
    const listRows = await getTestDb()
      .select()
      .from(vendorCache)
      .where(eq(vendorCache.cacheKey, listKey));
    expect(listRows).toHaveLength(0);
  });

  it('cooldown: second rapid refresh 429s with localized countdown; clears after the window', async () => {
    let clock = 1_000_000;
    setBacklinksCooldown(createInMemoryCooldown({ defaultMs: 60_000, now: () => clock }));
    const user = await seedUser('rf-cool@x.co');
    const siteId = await seedSite(user.id);
    const { provider, getCalls } = stubSummaryProvider();
    setBacklinkProvider(provider);

    await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(getCalls()).toBe(1);

    clock += 10_000; // 50s of the 60s window remain
    const second = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe(
      translate('en', 'backlinks.errors.refreshCooldown', { seconds: 50 }),
    );
    expect(second.body.error.details.retryAfterMs).toBe(50_000);
    expect(getCalls()).toBe(1);

    clock += 50_000; // past the window
    await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(getCalls()).toBe(2);
  });

  it('vendor failure → 503, prior snapshot preserved, cooldown still engaged', async () => {
    let clock = 2_000_000;
    setBacklinksCooldown(createInMemoryCooldown({ defaultMs: 60_000, now: () => clock }));
    const user = await seedUser('rf-fail@x.co');
    const siteId = await seedSite(user.id, 'failing.example');
    await seedFreshSnapshot(siteId, user.id);
    const failing: BacklinkProvider = {
      async getSummary() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
      async listBacklinks() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    };
    setBacklinkProvider(failing);

    const res = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.backlinks.errors.unavailable,
    );
    // Last good data survives.
    const rows = await getTestDb()
      .select()
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.siteId, siteId));
    expect(rows).toHaveLength(1);
    // The attempted fetch engaged the cooldown — an immediate retry throttles.
    clock += 1_000;
    const retry = await request(app)
      .post(`/api/sites/${siteId}/backlinks/refresh`)
      .set('Cookie', user.cookie);
    expect(retry.status).toBe(429);
  });

  it('404s on a malformed site id without touching the provider', async () => {
    const user = await seedUser('rf-badid@x.co');
    const { provider, getCalls } = stubSummaryProvider();
    setBacklinkProvider(provider);
    const res = await request(app)
      .post('/api/sites/not-an-object-id/backlinks/refresh')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(getCalls()).toBe(0);
  });
});

describe('backlinks service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';
  it('refuses a well-formed site id this account does not own', async () => {
    await expect(getBacklinkSummary({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99' }, { db: getTestDb() } as unknown as Parameters<typeof getBacklinkSummary>[1])).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(getBacklinkSummary({ accountId: GUARD_ACCOUNT, siteId: 'not-an-id' }, { db: getTestDb() } as unknown as Parameters<typeof getBacklinkSummary>[1])).rejects.toMatchObject({ status: 404 });
  });
});
