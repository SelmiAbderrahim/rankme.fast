/**
 * Local SEO business setup routes: search (one vendor lookup), select (from
 * stored results only), clear, and refresh that requires and uses the
 * selection.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from '../../shared/testing/auth.js';
import { Site } from '../sites/index.js';
import { env } from '../../config/env.js';
import { localListingSnapshots, localReviewsSnapshots } from '../../db/schema/local-seo.js';
import { vendorResponses } from '../../db/schema/vendor-cache.js';
import {
  FAKE_BUSINESS_CANDIDATES,
  VendorUnavailableError,
  createFakeLocalListingsProvider,
  createFakeRankProvider,
  type LocalListingTarget,
  type LocalListingsProvider,
} from '../../shared/providers/index.js';
import { setLocalSeoCooldown, setLocalSeoDb, setLocalSeoProvider, setLocalSeoRankProvider } from './local-seo.holder.js';
import { createInMemoryCooldown } from '../../shared/cooldown/index.js';
import { LocalBusinessProfile } from './local-business.model.js';
import {
  clearLocalBusiness,
  readLocalBusinessSetup,
  searchLocalBusinesses,
  searchLocalPlaces,
  selectLocalBusiness,
} from './local-business.service.js';

const app = createApp();

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, extra: Record<string, unknown> = {}) {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: 'https://example.com',
    domain: 'example.com',
    ...extra,
  });
  return (site._id as mongoose.Types.ObjectId).toString();
}

/** Fake that records every call so tests can prove no lookup happened. */
function recordingProvider(base: LocalListingsProvider = createFakeLocalListingsProvider()) {
  const calls: Array<{ op: string; arg: unknown }> = [];
  const provider: LocalListingsProvider = {
    async searchBusinesses(input) {
      calls.push({ op: 'search', arg: input });
      return base.searchBusinesses(input);
    },
    async getBusinessListings(target) {
      calls.push({ op: 'listings', arg: target });
      return base.getBusinessListings(target);
    },
    async getReviews(target) {
      calls.push({ op: 'reviews', arg: target });
      return base.getReviews(target);
    },
    async getQuestionsAndAnswers(target) {
      calls.push({ op: 'qa', arg: target });
      return base.getQuestionsAndAnswers(target);
    },
  };
  return { provider, calls };
}

function search(user: TestUser, siteId: string, body: unknown) {
  return request(app).post(`/api/sites/${siteId}/local-seo/business/search`).set('Cookie', user.cookie).send(body as object);
}

function placeSearch(user: TestUser, siteId: string, body: unknown) {
  return request(app).post(`/api/sites/${siteId}/local-seo/places/search`).set('Cookie', user.cookie).send(body as object);
}

function select(user: TestUser, siteId: string, body: unknown) {
  return request(app).put(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie).send(body as object);
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setLocalSeoDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setLocalSeoDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setLocalSeoProvider(createFakeLocalListingsProvider());
  setLocalSeoRankProvider(createFakeRankProvider());
  setLocalSeoCooldown(null);
});

describe('GET /api/sites/:siteId/local-seo/business', () => {
  it('starts with nothing selected and no results', async () => {
    const user = await seedUser('setup-empty@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ selected: null, candidates: [], query: null, candidatesExpireAt: null });
  });

  it('is scoped to the owning account', async () => {
    const owner = await seedUser('setup-owner@x.co');
    const stranger = await seedUser('setup-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const foreign = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', stranger.cookie);
    expect(foreign.status).toBe(404);
  });
});

describe('POST /api/sites/:siteId/local-seo/business/search', () => {
  it('returns distinguishable candidates and archives the lookup', async () => {
    const user = await seedUser('search-ok@x.co');
    const siteId = await seedSite(user.id, {
      defaultMarket: { locationCode: 2682, languageCode: 'ar', device: 'desktop', source: 'owner' },
    });
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await search(user, siteId, { query: '  Example Dental  ' });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ op: 'search', arg: { query: 'Example Dental', locationCode: 2682, languageCode: 'ar' } }]);
    // Same name, different addresses: nothing is picked for the owner.
    expect(res.body.selected).toBeNull();
    expect(res.body.query).toBe('Example Dental');
    expect(res.body.candidates.map((c: { name: string; address: string }) => [c.name, c.address])).toEqual(
      FAKE_BUSINESS_CANDIDATES.map((c) => [c.name, c.address]),
    );
    expect(res.body.candidates[0]).toMatchObject({ placeId: 'ChIJFakeDentalDowntown01', latitude: 30.2672 });
    expect(typeof res.body.candidates[0].candidateId).toBe('string');
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'business-search'));
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ capability: 'local-listings', accountId: user.id });
  });

  it('reports no results when nothing matches', async () => {
    const user = await seedUser('search-none@x.co');
    const siteId = await seedSite(user.id);
    const res = await search(user, siteId, { query: 'Nowhere Bakery' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });

  it.each([
    ['too short', { query: 'a' }],
    ['too long', { query: 'x'.repeat(201) }],
    ['blank', { query: '    ' }],
    ['a control character', { query: 'Example\u0007Dental' }],
    ['not a string', { query: 42 }],
    ['an unknown field', { query: 'Example', placeId: 'ChIJ' }],
  ])('refuses a query that is %s before any lookup', async (_label, body) => {
    const user = await seedUser(`search-bad-${_label.replace(/\W/g, '')}@x.co`);
    const siteId = await seedSite(user.id);
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await search(user, siteId, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LOCAL_SEO_ERRORS_QUERY_INVALID');
    expect(calls).toEqual([]);
  });

  it('404s for another account and never reaches the provider', async () => {
    const owner = await seedUser('search-owner@x.co');
    const stranger = await seedUser('search-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await search(stranger, siteId, { query: 'Example Dental' });
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('refuses a paused site before any lookup', async () => {
    const user = await seedUser('search-paused@x.co');
    const siteId = await seedSite(user.id, { paused: true, pausedAt: new Date() });
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await search(user, siteId, { query: 'Example Dental' });
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it('maps a vendor outage to a localized 503 and stores no results', async () => {
    const user = await seedUser('search-down@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoProvider(
      createFakeLocalListingsProvider({ failure: new VendorUnavailableError('down', { provider: 'fake', operation: 'search' }) }),
    );
    const res = await search(user, siteId, { query: 'Example Dental' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LOCAL_SEO_ERRORS_UNAVAILABLE');
    expect(await LocalBusinessProfile.countDocuments({ siteId })).toBe(0);
  });

  it('surfaces a non-vendor failure as 500', async () => {
    const user = await seedUser('search-bug@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoProvider({
      ...createFakeLocalListingsProvider(),
      async searchBusinesses() {
        throw new Error('bug');
      },
    });
    const res = await search(user, siteId, { query: 'Example Dental' });
    expect(res.status).toBe(500);
  });

  it('a double submit inside the short window is refused without a second lookup', async () => {
    const user = await seedUser('search-double@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoCooldown(createInMemoryCooldown({ defaultMs: 60_000 }));
    expect((await search(user, siteId, { query: 'Example Dental' })).status).toBe(200);
    const second = await search(user, siteId, { query: 'Example Dental' });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('LOCAL_SEO_SEARCH_COOLDOWN');
  });

  it('drops coordinates outside the valid range and rows whose identifiers do not fit', async () => {
    const user = await seedUser('search-bounds@x.co');
    const siteId = await seedSite(user.id);
    const base = FAKE_BUSINESS_CANDIDATES[0]!;
    setLocalSeoProvider(
      createFakeLocalListingsProvider({
        businessCandidates: [
          { ...base, name: 'Example Far', latitude: 91, longitude: 10 },
          { ...base, name: 'Example Huge', placeId: 'x'.repeat(201), cid: null },
          { ...base, name: 'Example Blank', placeId: ' ', cid: null },
          { ...base, name: '   ', placeId: 'ChIJnameless' },
          { ...base, name: 'Example Long', placeId: 'ChIJlong', address: 'a'.repeat(400), latitude: 10, longitude: 181 },
        ],
      }),
    );
    const res = await search(user, siteId, { query: 'Example' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(2);
    expect(res.body.candidates[0]).toMatchObject({ name: 'Example Far', latitude: null, longitude: null });
    expect(res.body.candidates[1].address).toHaveLength(300);
    expect(res.body.candidates[1].longitude).toBeNull();
  });
});

describe('POST /api/sites/:siteId/local-seo/places/search', () => {
  let previousGeogrid: boolean;
  beforeEach(() => {
    previousGeogrid = env.GEOGRID_ENABLED;
    (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = true;
  });
  afterEach(() => {
    (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = previousGeogrid;
  });

  it('is closed with the geogrid kill switch: localized 503 before any lookup', async () => {
    (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = false;
    const user = await seedUser('place-flag-off@x.co');
    const siteId = await seedSite(user.id);
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await placeSearch(user, siteId, { query: 'Example Dental' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'GEOGRID_UNAVAILABLE',
      message: 'Geogrid scans are temporarily unavailable. Please try again later.',
    });
    expect(calls).toEqual([]);
    // Ownership is still checked first: a stranger learns nothing about the site.
    const stranger = await seedUser('place-flag-stranger@x.co');
    expect((await placeSearch(stranger, siteId, { query: 'Example Dental' })).status).toBe(404);
    // The business setup search is not part of the geogrid switch.
    expect((await search(user, siteId, { query: 'Example Dental' })).status).toBe(200);
  });

  it('returns places that have coordinates and stores nothing', async () => {
    const user = await seedUser('place-ok@x.co');
    const siteId = await seedSite(user.id, {
      defaultMarket: { locationCode: 2682, languageCode: 'ar', device: 'desktop', source: 'owner' },
    });
    // A saved business and its earlier results must not change.
    expect((await search(user, siteId, { query: 'Example Dental' })).status).toBe(200);
    const before = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect((await select(user, siteId, { candidateId: before.body.candidates[1].candidateId })).status).toBe(200);
    const saved = (await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie)).body;

    const base = FAKE_BUSINESS_CANDIDATES[0]!;
    const { provider, calls } = recordingProvider(
      createFakeLocalListingsProvider({
        businessCandidates: [
          { ...base, name: 'Main Street Clinic', address: '1 Main St', latitude: 24.7136, longitude: 46.6753 },
          { ...base, name: 'No Pin Clinic', placeId: 'ChIJnopin', latitude: null, longitude: null },
          { ...base, name: 'Bad Pin Clinic', placeId: 'ChIJbadpin', latitude: 95, longitude: 46 },
        ],
      }),
    );
    setLocalSeoProvider(provider);
    const res = await placeSearch(user, siteId, { query: '  1 Main St  ' });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ op: 'search', arg: { query: '1 Main St', locationCode: 2682, languageCode: 'ar' } }]);
    expect(res.body).toEqual({
      query: '1 Main St',
      places: [
        {
          placeId: base.placeId,
          cid: base.cid,
          name: 'Main Street Clinic',
          address: '1 Main St',
          phone: base.phone,
          domain: base.domain,
          category: base.category,
          latitude: 24.7136,
          longitude: 46.6753,
        },
      ],
    });
    const after = (await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie)).body;
    expect(after).toEqual(saved);
    const archived = await getTestDb().select().from(vendorResponses).where(eq(vendorResponses.operation, 'business-search'));
    expect(archived).toHaveLength(2);
  });

  it('404s for another account, refuses a paused site and a bad query, all before any lookup', async () => {
    const owner = await seedUser('place-owner@x.co');
    const stranger = await seedUser('place-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const pausedId = await seedSite(owner.id, {
      url: 'https://paused.example.com',
      domain: 'paused.example.com',
      paused: true,
      pausedAt: new Date(),
    });
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    expect((await placeSearch(stranger, siteId, { query: 'Example Dental' })).status).toBe(404);
    expect((await placeSearch(owner, pausedId, { query: 'Example Dental' })).status).toBe(409);
    const bad = await placeSearch(owner, siteId, { query: 'a' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('LOCAL_SEO_ERRORS_QUERY_INVALID');
    expect(calls).toEqual([]);
  });

  it('maps a vendor outage to a localized 503', async () => {
    const user = await seedUser('place-down@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoProvider(
      createFakeLocalListingsProvider({ failure: new VendorUnavailableError('down', { provider: 'fake', operation: 'search' }) }),
    );
    const res = await placeSearch(user, siteId, { query: 'Example Dental' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LOCAL_SEO_ERRORS_UNAVAILABLE');
  });

  it('has its own double-submit window, separate from the setup search', async () => {
    const user = await seedUser('place-double@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoCooldown(createInMemoryCooldown({ defaultMs: 60_000 }));
    expect((await search(user, siteId, { query: 'Example Dental' })).status).toBe(200);
    expect((await placeSearch(user, siteId, { query: 'Example Dental' })).status).toBe(200);
    const second = await placeSearch(user, siteId, { query: 'Example Dental' });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('LOCAL_SEO_SEARCH_COOLDOWN');
  });
});

describe('PUT/DELETE /api/sites/:siteId/local-seo/business', () => {
  async function searched(email: string) {
    const user = await seedUser(email);
    const siteId = await seedSite(user.id);
    const res = await search(user, siteId, { query: 'Example Dental' });
    return { user, siteId, candidates: res.body.candidates as Array<{ candidateId: string; name: string }> };
  }

  it('saves the chosen result without a lookup, and it survives a reload', async () => {
    const { user, siteId, candidates } = await searched('select-ok@x.co');
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await select(user, siteId, { candidateId: candidates[1]!.candidateId });
    expect(res.status).toBe(200);
    expect(res.body.selected).toMatchObject({
      name: 'Example Dental Studio North',
      placeId: 'ChIJFakeDentalNorth00002',
      address: '9000 Research Blvd, Austin, TX 78758',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(calls).toEqual([]);
    const reload = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(reload.body.selected.name).toBe('Example Dental Studio North');
  });

  it('refuses an unknown, malformed or expired candidate and keeps the prior selection', async () => {
    const { user, siteId, candidates } = await searched('select-stale@x.co');
    await select(user, siteId, { candidateId: candidates[0]!.candidateId });
    for (const body of [
      { candidateId: '00000000-0000-4000-8000-000000000000' },
      { candidateId: 'not-a-uuid' },
      { placeId: 'ChIJFakeDentalNorth00002', name: 'Forged' },
    ]) {
      const res = await select(user, siteId, body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LOCAL_SEO_ERRORS_SELECTION_STALE');
    }
    await LocalBusinessProfile.updateOne({ siteId }, { $set: { candidatesExpireAt: new Date(Date.now() - 1000) } });
    const expired = await select(user, siteId, { candidateId: candidates[1]!.candidateId });
    expect(expired.status).toBe(409);
    const reload = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(reload.body.selected.name).toBe('Example Dental Studio');
    // Expired results are no longer offered.
    expect(reload.body.candidates).toEqual([]);
    expect(reload.body.query).toBeNull();
  });

  it('refuses selection before any search', async () => {
    const user = await seedUser('select-first@x.co');
    const siteId = await seedSite(user.id);
    const res = await select(user, siteId, { candidateId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(409);
  });

  it('404s for another account and leaves the owner setup untouched', async () => {
    const { user, siteId, candidates } = await searched('select-owner@x.co');
    const stranger = await seedUser('select-stranger@x.co');
    const res = await select(stranger, siteId, { candidateId: candidates[0]!.candidateId });
    expect(res.status).toBe(404);
    const cleared = await request(app).delete(`/api/sites/${siteId}/local-seo/business`).set('Cookie', stranger.cookie);
    expect(cleared.status).toBe(404);
    const reload = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(reload.body.candidates).toHaveLength(2);
  });

  it('clears the selection; stored snapshots stay readable', async () => {
    const { user, siteId, candidates } = await searched('select-clear@x.co');
    await select(user, siteId, { candidateId: candidates[0]!.candidateId });
    expect((await request(app).post(`/api/sites/${siteId}/local-seo/refresh`).set('Cookie', user.cookie)).status).toBe(200);
    const res = await request(app).delete(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.selected).toBeNull();
    const snapshot = await request(app).get(`/api/sites/${siteId}/local-seo`).set('Cookie', user.cookie);
    expect(snapshot.body.provenance).toEqual({
      kind: 'business',
      name: 'Example Dental Studio',
      ref: 'place_id:ChIJFakeDentalDowntown01',
    });
  });

  it('clearing a site that was never set up is a no-op', async () => {
    const user = await seedUser('select-clear-none@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app).delete(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ selected: null, candidates: [], query: null, candidatesExpireAt: null });
  });
});

describe('refresh uses the selected business', () => {
  it('refuses refresh until a business is chosen — no lookup', async () => {
    const user = await seedUser('refresh-setup@x.co');
    const siteId = await seedSite(user.id);
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await request(app).post(`/api/sites/${siteId}/local-seo/refresh`).set('Cookie', user.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOCAL_SEO_ERRORS_SETUP_REQUIRED');
    expect(calls).toEqual([]);
  });

  it('sends the chosen identity and its market to all three calls and records provenance', async () => {
    const user = await seedUser('refresh-identity@x.co');
    const siteId = await seedSite(user.id);
    const found = await search(user, siteId, { query: 'Research Blvd' });
    await select(user, siteId, { candidateId: found.body.candidates[0].candidateId });
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await request(app).post(`/api/sites/${siteId}/local-seo/refresh`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const target: LocalListingTarget = {
      domain: 'example.com',
      business: { placeId: 'ChIJFakeDentalNorth00002', cid: '1000000000000000002', name: 'Example Dental Studio North' },
      locationCode: 2840,
      languageCode: 'en',
    };
    expect(calls).toEqual([
      { op: 'listings', arg: target },
      { op: 'reviews', arg: target },
      { op: 'qa', arg: target },
    ]);
    expect(res.body.provenance).toEqual({
      kind: 'business',
      name: 'Example Dental Studio North',
      ref: 'place_id:ChIJFakeDentalNorth00002',
    });
    const [row] = await getTestDb().select().from(localReviewsSnapshots).where(eq(localReviewsSnapshots.siteId, siteId));
    expect(row).toMatchObject({ businessRef: 'place_id:ChIJFakeDentalNorth00002', businessName: 'Example Dental Studio North' });
  });

  it('labels a domain-only snapshot from before setup with its real provenance', async () => {
    const user = await seedUser('refresh-legacy@x.co');
    const siteId = await seedSite(user.id);
    await getTestDb().insert(localReviewsSnapshots).values({
      accountId: user.id,
      siteId,
      snapshotDate: '2026-07-01',
      averageRating: 4,
      reviewCount: 3,
      unansweredQuestionCount: 0,
      fetchedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    await getTestDb().insert(localListingSnapshots).values([
      { accountId: user.id, siteId, snapshotDate: '2026-07-01', source: 'google', name: 'Old', address: null, phone: null, consistent: true },
      { accountId: user.id, siteId, snapshotDate: '2026-06-30', source: 'yelp', name: 'Older', address: null, phone: null, consistent: true },
    ]);
    const res = await request(app).get(`/api/sites/${siteId}/local-seo`).set('Cookie', user.cookie);
    expect(res.body.provenance).toEqual({ kind: 'domain', domain: 'example.com' });
    expect(res.body.listings.map((l: { name: string }) => l.name)).toEqual(['Old']);
  });

  it('listings older than the latest reviews row are not mixed into it; listings alone still read', async () => {
    const user = await seedUser('refresh-mix@x.co');
    const siteId = await seedSite(user.id);
    await getTestDb().insert(localListingSnapshots).values({
      accountId: user.id, siteId, snapshotDate: '2026-06-30', source: 'yelp', name: 'Older', address: null, phone: null, consistent: true,
    });
    const listingsOnly = await request(app).get(`/api/sites/${siteId}/local-seo`).set('Cookie', user.cookie);
    expect(listingsOnly.body.provenance).toEqual({ kind: 'domain', domain: 'example.com' });
    expect(listingsOnly.body.listings).toHaveLength(1);
    await getTestDb().insert(localReviewsSnapshots).values({
      accountId: user.id, siteId, snapshotDate: '2026-07-01', averageRating: 4, reviewCount: 3, unansweredQuestionCount: 0,
      businessRef: 'cid:1', businessName: 'Chosen',
    });
    const mixed = await request(app).get(`/api/sites/${siteId}/local-seo`).set('Cookie', user.cookie);
    expect(mixed.body.provenance).toEqual({ kind: 'business', name: 'Chosen', ref: 'cid:1' });
    expect(mixed.body.listings).toEqual([]);
  });

  it('a same-day refresh replaces that day listings instead of keeping stale sources', async () => {
    const user = await seedUser('refresh-replace@x.co');
    const siteId = await seedSite(user.id);
    const found = await search(user, siteId, { query: 'Example Dental' });
    await select(user, siteId, { candidateId: found.body.candidates[0].candidateId });
    const today = new Date().toISOString().slice(0, 10);
    await getTestDb().insert(localListingSnapshots).values({
      accountId: user.id, siteId, snapshotDate: today, source: 'stale-source', name: 'Stale', address: null, phone: null, consistent: false,
    });
    expect((await request(app).post(`/api/sites/${siteId}/local-seo/refresh`).set('Cookie', user.cookie)).status).toBe(200);
    const rows = await getTestDb().select().from(localListingSnapshots).where(eq(localListingSnapshots.siteId, siteId));
    expect(rows.map((r) => r.source)).not.toContain('stale-source');
  });
});

describe('stored setup written before every optional field existed', () => {
  it('reads missing fields as null and refreshes a CID-only business by its CID', async () => {
    const user = await seedUser('raw-doc@x.co');
    const siteId = await seedSite(user.id);
    await LocalBusinessProfile.collection.insertOne({
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      selected: { name: 'Raw Business', cid: '77', locationCode: 2840, languageCode: 'en', selectedAt: new Date() },
      candidates: [{ candidateId: '11111111-1111-4111-8111-111111111111', name: 'Raw Candidate', placeId: 'ChIJraw' }],
      candidatesLocationCode: 2840,
      candidatesLanguageCode: 'en',
      candidatesExpireAt: new Date(Date.now() + 60_000),
    });
    const setup = await request(app).get(`/api/sites/${siteId}/local-seo/business`).set('Cookie', user.cookie);
    expect(setup.body.selected).toMatchObject({ name: 'Raw Business', placeId: null, cid: '77', address: null, latitude: null });
    expect(setup.body.candidates).toEqual([
      {
        candidateId: '11111111-1111-4111-8111-111111111111',
        placeId: 'ChIJraw',
        cid: null,
        name: 'Raw Candidate',
        address: null,
        phone: null,
        domain: null,
        category: null,
        latitude: null,
        longitude: null,
      },
    ]);
    expect(setup.body.query).toBeNull();
    const { provider, calls } = recordingProvider();
    setLocalSeoProvider(provider);
    const res = await request(app).post(`/api/sites/${siteId}/local-seo/refresh`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(calls[0]!.arg).toMatchObject({ business: { placeId: null, cid: '77', name: 'Raw Business' } });
    expect(res.body.provenance).toEqual({ kind: 'business', name: 'Raw Business', ref: 'cid:77' });
  });
});

// Route tests stop at the site lease for foreign sites; the service guard is
// what every non-HTTP caller hits.
describe('local business service ownership guard', () => {
  const ACCOUNT = '6a6fa7c28d75c2fd32d84a63';
  const SITE = '6a6fa7c28d75c2fd32d84a99';

  it('every entry point refuses a site the account does not own', async () => {
    const deps = { db: getTestDb() as never, provider: createFakeLocalListingsProvider() };
    await expect(readLocalBusinessSetup({ accountId: ACCOUNT, siteId: SITE }, {})).rejects.toMatchObject({ status: 404 });
    await expect(searchLocalBusinesses({ accountId: ACCOUNT, siteId: SITE, query: 'x' }, deps)).rejects.toMatchObject({ status: 404 });
    await expect(searchLocalPlaces({ accountId: ACCOUNT, siteId: SITE, query: 'x' }, deps)).rejects.toMatchObject({ status: 404 });
    await expect(
      selectLocalBusiness({ accountId: ACCOUNT, siteId: SITE, candidateId: '00000000-0000-4000-8000-000000000000' }, {}),
    ).rejects.toMatchObject({ status: 404 });
    await expect(clearLocalBusiness({ accountId: ACCOUNT, siteId: SITE }, {})).rejects.toMatchObject({ status: 404 });
  });
});
