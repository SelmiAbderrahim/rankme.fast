/**
 * local-seo route + all-or-nothing-refresh tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { keywords } from '../../db/schema/keywords.js';
import {
  localListingSnapshots,
  localPackRankSnapshots,
  localReviewsSnapshots,
} from '../../db/schema/local-seo.js';
import { vendorResponses } from '../../db/schema/vendor-cache.js';
import {
  VendorUnavailableError,
  createFakeLocalListingsProvider,
  createFakeRankProvider,
  recordVendorCostUsd,
  FAKE_BUSINESS_LISTINGS,
  FAKE_LOCAL_PACK_RESULT,
  FAKE_QA_SUMMARY,
  FAKE_REVIEWS_SUMMARY,
  type LocalListingsProvider,
  type RankProvider,
} from '../../shared/providers/index.js';
import {
  setLocalSeoCooldown,
  setLocalSeoDb,
  setLocalSeoProvider,
  setLocalSeoRankProvider,
} from './local-seo.holder.js';
import { createInMemoryCooldown } from '../../shared/cooldown/index.js';
import { translate } from '../../shared/i18n/index.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { loadOwnedSite } from './local-seo.service.js';

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

async function seedKeyword(accountId: string, siteId: string, phrase = 'plumber austin') {
  const rows = await getTestDb()
    .insert(keywords)
    .values({
      accountId,
      siteId,
      phrase,
      locationCode: 2840,
      languageCode: 'en',
    })
    .returning();
  return rows[0]!.id;
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
  // Fresh default cooldown per test — no cross-test 429 bleed.
  setLocalSeoCooldown(null);
});

describe('GET /api/sites/:siteId/local-seo', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/sites/anything/local-seo');
    expect(res.status).toBe(401);
  });

  it('returns an empty snapshot before any refresh', async () => {
    const user = await seedUser('pro-empty@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/local-seo`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      listings: [],
      fetchedAt: null,
      reviews: null,
      reviewsFetchedAt: null,
      localPack: [],
    });
  });

  it('reads back the latest listings + reviews + local-pack snapshot after a refresh + rank check', async () => {
    const user = await seedUser('pro-read@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);

    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie)
      .expect(200);

    const res = await request(app)
      .get(`/api/sites/${siteId}/local-seo`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(FAKE_BUSINESS_LISTINGS.length);
    expect(res.body.fetchedAt).not.toBeNull();
    expect(res.body.reviews).toEqual({
      averageRating: FAKE_REVIEWS_SUMMARY.averageRating,
      reviewCount: FAKE_REVIEWS_SUMMARY.reviewCount,
      unansweredQuestionCount: FAKE_QA_SUMMARY.unansweredCount,
    });
    expect(res.body.localPack).toEqual([
      {
        keywordId,
        phrase: 'plumber austin',
        position: FAKE_LOCAL_PACK_RESULT.position,
        totalPackSize: FAKE_LOCAL_PACK_RESULT.totalPackSize,
        checkedAt: FAKE_LOCAL_PACK_RESULT.checkedAt.toISOString(),
      },
    ]);
  });

  it('falls back to an empty phrase when a local-pack row references a since-deleted keyword', async () => {
    const user = await seedUser('pro-orphan@x.co');
    const siteId = await seedSite(user.id);
    await getTestDb().insert(localPackRankSnapshots).values({
      accountId: user.id,
      siteId,
      keywordId: '00000000-0000-4000-8000-000000000000',
      position: 4,
      totalPackSize: 3,
      capturedAt: new Date(),
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/local-seo`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.localPack).toEqual([
      expect.objectContaining({ phrase: '', position: 4 }),
    ]);
  });

  it('cross-account access 404', async () => {
    const a = await seedUser('aL@x.co');
    const b = await seedUser('bL@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/local-seo`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('malL@x.co');
    const res = await request(app)
      .get('/api/sites/not-an-object-id/local-seo')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sites/:siteId/local-seo/refresh', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post('/api/sites/anything/local-seo/refresh');
    expect(res.status).toBe(401);
  });

  it('cross-account refresh 404s and never reaches the provider', async () => {
    const owner = await seedUser('rf-owner@x.co');
    const stranger = await seedUser('rf-stranger@x.co');
    const siteId = await seedSite(owner.id);
    let calls = 0;
    setLocalSeoProvider({
      async getBusinessListings() {
        calls += 1;
        return [];
      },
      async getReviews() {
        return FAKE_REVIEWS_SUMMARY;
      },
      async getQuestionsAndAnswers() {
        return FAKE_QA_SUMMARY;
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(calls).toBe(0);
  });

  it('persists listings + reviews + Q&A in one combined snapshot', async () => {
    const user = await seedUser('rf-ok@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(FAKE_BUSINESS_LISTINGS.length);
    expect(res.body.reviews).toEqual({
      averageRating: FAKE_REVIEWS_SUMMARY.averageRating,
      reviewCount: FAKE_REVIEWS_SUMMARY.reviewCount,
    });
    expect(res.body.qa).toEqual({ unansweredCount: FAKE_QA_SUMMARY.unansweredCount });

    const listingRows = await getTestDb()
      .select()
      .from(localListingSnapshots)
      .where(eq(localListingSnapshots.siteId, siteId));
    expect(listingRows).toHaveLength(FAKE_BUSINESS_LISTINGS.length);
    const reviewRows = await getTestDb()
      .select()
      .from(localReviewsSnapshots)
      .where(eq(localReviewsSnapshots.siteId, siteId));
    expect(reviewRows).toHaveLength(1);
  });

  it('same-day repeat refresh upserts instead of duplicating rows', async () => {
    // Zero-length cooldown — this test is about the upsert, not the cooldown.
    setLocalSeoCooldown(createInMemoryCooldown({ defaultMs: 0 }));
    const user = await seedUser('rf-upsert@x.co');
    const siteId = await seedSite(user.id);
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    // Second refresh returns DIFFERENT listing data — same source set, so the
    // unique (site, day, source) index must upsert, not append.
    setLocalSeoProvider(
      createFakeLocalListingsProvider({
        businessListings: FAKE_BUSINESS_LISTINGS.map((l) => ({ ...l, name: `${l.name} Updated` })),
      }),
    );
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    const rows = await getTestDb()
      .select()
      .from(localListingSnapshots)
      .where(eq(localListingSnapshots.siteId, siteId));
    expect(rows).toHaveLength(FAKE_BUSINESS_LISTINGS.length);
    expect(rows.every((r) => r.name.endsWith('Updated'))).toBe(true);
  });

  it('cooldown: second rapid refresh 429s with localized countdown; clears after the window', async () => {
    let clock = 1_000_000;
    setLocalSeoCooldown(createInMemoryCooldown({ defaultMs: 60_000, now: () => clock }));
    const user = await seedUser('rf-cool@x.co');
    const siteId = await seedSite(user.id);

    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);

    clock += 45_000; // 15s of the 60s window remain
    const second = await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe(
      translate('en', 'localSeo.errors.refreshCooldown', { seconds: 15 }),
    );
    expect(second.body.error.details.retryAfterMs).toBe(15_000);

    clock += 15_000;
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
  });

  it('all-or-nothing: a failure in ANY of the three vendor calls persists NOTHING', async () => {
    const user = await seedUser('rf-fail@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoProvider({
      async getBusinessListings() {
        return FAKE_BUSINESS_LISTINGS;
      },
      async getReviews() {
        return FAKE_REVIEWS_SUMMARY;
      },
      async getQuestionsAndAnswers() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'qa' });
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.localSeo.errors.unavailable);
    const listingRows = await getTestDb()
      .select()
      .from(localListingSnapshots)
      .where(eq(localListingSnapshots.siteId, siteId));
    expect(listingRows).toHaveLength(0);
    const reviewRows = await getTestDb()
      .select()
      .from(localReviewsSnapshots)
      .where(eq(localReviewsSnapshots.siteId, siteId));
    expect(reviewRows).toHaveLength(0);
  });

  it('rethrows non-Provider errors (surfaces as 500)', async () => {
    const user = await seedUser('rf-plain@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoProvider({
      async getBusinessListings() {
        throw new Error('plain');
      },
      async getReviews() {
        return FAKE_REVIEWS_SUMMARY;
      },
      async getQuestionsAndAnswers() {
        return FAKE_QA_SUMMARY;
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(500);
  });

  it('404s on a malformed site id without touching the provider', async () => {
    const user = await seedUser('rf-badid@x.co');
    let calls = 0;
    setLocalSeoProvider({
      async getBusinessListings() {
        calls += 1;
        return [];
      },
      async getReviews() {
        return FAKE_REVIEWS_SUMMARY;
      },
      async getQuestionsAndAnswers() {
        return FAKE_QA_SUMMARY;
      },
    });
    const res = await request(app)
      .post('/api/sites/not-an-object-id/local-seo/refresh')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(calls).toBe(0);
  });
});

describe('POST /api/sites/:siteId/local-seo/keywords/:keywordId/rank', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post(
      '/api/sites/anything/local-seo/keywords/anything/rank',
    );
    expect(res.status).toBe(401);
  });

  it('cross-account site access 404s and never reaches the provider', async () => {
    const owner = await seedUser('lp-owner@x.co');
    const stranger = await seedUser('lp-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const keywordId = await seedKeyword(owner.id, siteId);
    let calls = 0;
    setLocalSeoRankProvider({
      async checkRank() {
        throw new Error('unused');
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        calls += 1;
        return FAKE_LOCAL_PACK_RESULT;
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(calls).toBe(0);
  });

  it('unknown keyword id 404s', async () => {
    const user = await seedUser('lp-nokw@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/00000000-0000-4000-8000-000000000000/rank`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('a keyword belonging to another account 404s (cross-account keyword)', async () => {
    const owner = await seedUser('lp-kwowner@x.co');
    const other = await seedUser('lp-kwother@x.co');
    const siteId = await seedSite(owner.id);
    const otherSiteId = await seedSite(other.id, 'other.example');
    const keywordId = await seedKeyword(other.id, otherSiteId);
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(404);
  });

  it('checks local-pack rank and persists a snapshot row', async () => {
    const user = await seedUser('lp-ok@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keywordId,
      position: FAKE_LOCAL_PACK_RESULT.position,
      totalPackSize: FAKE_LOCAL_PACK_RESULT.totalPackSize,
      checkedAt: FAKE_LOCAL_PACK_RESULT.checkedAt.toISOString(),
    });
    const rows = await getTestDb()
      .select()
      .from(localPackRankSnapshots)
      .where(eq(localPackRankSnapshots.siteId, siteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keywordId).toBe(keywordId);
  });

  it('surfaces a provider failure as 503 and persists nothing', async () => {
    const user = await seedUser('lp-fail@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);
    const failing: RankProvider = {
      async checkRank() {
        throw new Error('unused');
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    };
    setLocalSeoRankProvider(failing);
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.localSeo.errors.unavailable);
    const rows = await getTestDb()
      .select()
      .from(localPackRankSnapshots)
      .where(eq(localPackRankSnapshots.siteId, siteId));
    expect(rows).toHaveLength(0);
  });

  it('rethrows non-Provider errors (surfaces as 500)', async () => {
    const user = await seedUser('lp-plain@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);
    setLocalSeoRankProvider({
      async checkRank() {
        throw new Error('unused');
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        throw new Error('plain');
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(500);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('lp-malid@x.co');
    const res = await request(app)
      .post('/api/sites/not-an-object-id/local-seo/keywords/anything/rank')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('vendor archive rows (cost capture)', () => {
  it('a combined refresh archives one local-listings/refresh row; nothing recorded → null cost', async () => {
    const user = await seedUser('lp-arch@x.co');
    const siteId = await seedSite(user.id);
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    const rows = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.capability, 'local-listings'));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.operation).toBe('refresh');
    expect(row.accountId).toBe(user.id);
    expect(row.params).toMatchObject({ domain: 'example.com' });
    expect(row.costMicros).toBeNull();
  });

  it('sums the vendor cost recorded across the three refresh calls onto the archive row', async () => {
    const user = await seedUser('lp-arch-cost@x.co');
    const siteId = await seedSite(user.id);
    const fake = createFakeLocalListingsProvider();
    setLocalSeoProvider({
      async getBusinessListings(domain) {
        recordVendorCostUsd(0.012);
        return fake.getBusinessListings(domain);
      },
      async getReviews(domain) {
        recordVendorCostUsd(0.0054);
        return fake.getReviews(domain);
      },
      async getQuestionsAndAnswers(domain) {
        recordVendorCostUsd(0.0125);
        return fake.getQuestionsAndAnswers(domain);
      },
    });
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(200);
    const rows = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.capability, 'local-listings'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costMicros).toBe(29_900n);
  });

  it('a failed refresh archives nothing', async () => {
    const user = await seedUser('lp-arch-fail@x.co');
    const siteId = await seedSite(user.id);
    setLocalSeoProvider({
      async getBusinessListings() {
        return FAKE_BUSINESS_LISTINGS;
      },
      async getReviews() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
      async getQuestionsAndAnswers() {
        return FAKE_QA_SUMMARY;
      },
    });
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/refresh`)
      .set('Cookie', user.cookie)
      .expect(503);
    expect(await getTestDb().select().from(vendorResponses)).toHaveLength(0);
  });

  it('a local-pack check archives one rank/local-pack row with the recorded cost', async () => {
    const user = await seedUser('lp-arch-pack@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);
    setLocalSeoRankProvider({
      async checkRank() {
        throw new Error('unused');
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        recordVendorCostUsd(0.002);
        return FAKE_LOCAL_PACK_RESULT;
      },
    });
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie)
      .expect(200);
    const rows = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.capability, 'rank'));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.operation).toBe('local-pack');
    expect(row.accountId).toBe(user.id);
    expect(row.params).toMatchObject({
      keyword: 'plumber austin',
      domain: 'example.com',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(row.costMicros).toBe(2_000n);
  });

  it('a failed local-pack check archives nothing', async () => {
    const user = await seedUser('lp-arch-packfail@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);
    setLocalSeoRankProvider({
      async checkRank() {
        throw new Error('unused');
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    });
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie)
      .expect(503);
    expect(await getTestDb().select().from(vendorResponses)).toHaveLength(0);
  });
});

describe('unused local-listings provider methods are not called by local-pack checks', () => {
  it('a LocalListingsProvider fake never receives calls during a local-pack-only flow', async () => {
    const user = await seedUser('lp-isolated@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId);
    let listingCalls = 0;
    const listingsProvider: LocalListingsProvider = {
      async getBusinessListings() {
        listingCalls += 1;
        return [];
      },
      async getReviews() {
        listingCalls += 1;
        return FAKE_REVIEWS_SUMMARY;
      },
      async getQuestionsAndAnswers() {
        listingCalls += 1;
        return FAKE_QA_SUMMARY;
      },
    };
    setLocalSeoProvider(listingsProvider);
    await request(app)
      .post(`/api/sites/${siteId}/local-seo/keywords/${keywordId}/rank`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(listingCalls).toBe(0);
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('local-seo service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(loadOwnedSite({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99' })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(loadOwnedSite({ accountId: GUARD_ACCOUNT, siteId: 'not-an-id' })).rejects.toMatchObject({ status: 404 });
  });
});
