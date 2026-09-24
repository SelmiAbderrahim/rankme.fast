/**
 * Direct unit coverage for `buildLocalSeoEvaluationInput`
 * (the audit-rule evaluation-input builder), independent of the HTTP layer
 * already exercised in `local-seo.routes.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { keywords } from '../../db/schema/keywords.js';
import {
  localListingSnapshots,
  localPackRankSnapshots,
  localReviewsSnapshots,
} from '../../db/schema/local-seo.js';
import { persistLocalSeoSnapshot } from './local-seo.repository.js';
import { buildLocalSeoEvaluationInput } from './local-seo.service.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
afterEach(async () => {
  await truncateAllTables();
});

const ACCOUNT = 'acc-1';
const SITE = 'site-1';

describe('buildLocalSeoEvaluationInput', () => {
  it('returns status "not-configured" when nothing has ever been refreshed or tracked', async () => {
    const db = getTestDb();
    const result = await buildLocalSeoEvaluationInput(db as unknown as never, { siteId: SITE, accountId: ACCOUNT });
    expect(result).toEqual({
      status: 'not-configured',
      listings: [],
      reviews: null,
      qa: null,
      localPack: null,
    });
  });

  it('returns status "ok" with listings + reviews + local-pack rollup once refreshed and tracked', async () => {
    const db = getTestDb();
    await db.insert(localListingSnapshots).values([
      {
        accountId: ACCOUNT,
        siteId: SITE,
        snapshotDate: '2026-07-10',
        source: 'google',
        name: 'Example Dental',
        address: '100 Main St',
        phone: '+1 512-555-0100',
        consistent: true,
      },
      {
        accountId: ACCOUNT,
        siteId: SITE,
        snapshotDate: '2026-07-10',
        source: 'bing-places',
        name: 'Example Dental',
        address: '100 Main Street',
        phone: '+1 512-555-9999',
        consistent: false,
      },
    ]);
    await db.insert(localReviewsSnapshots).values({
      accountId: ACCOUNT,
      siteId: SITE,
      snapshotDate: '2026-07-10',
      averageRating: 4.6,
      reviewCount: 128,
      unansweredQuestionCount: 2,
    });
    const [kw] = await db
      .insert(keywords)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        phrase: 'plumber austin',
        locationCode: 2840,
        languageCode: 'en',
      })
      .returning();
    await db.insert(localPackRankSnapshots).values({
      accountId: ACCOUNT,
      siteId: SITE,
      keywordId: kw!.id,
      position: 2,
      totalPackSize: 3,
      capturedAt: new Date('2026-07-10T12:00:00Z'),
    });

    const result = await buildLocalSeoEvaluationInput(db as unknown as never, { siteId: SITE, accountId: ACCOUNT });
    expect(result).toEqual({
      status: 'ok',
      listings: [
        { source: 'bing-places', consistent: false },
        { source: 'google', consistent: true },
      ],
      reviews: { averageRating: 4.6, reviewCount: 128 },
      qa: { unansweredCount: 2 },
      localPack: { keyword: 'plumber austin', position: 2, totalPackSize: 3 },
    });
  });

  it('reviews/qa are both null when only a local-pack keyword is tracked (no refresh yet)', async () => {
    const db = getTestDb();
    const [kw] = await db
      .insert(keywords)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        phrase: 'plumber austin',
        locationCode: 2840,
        languageCode: 'en',
      })
      .returning();
    await db.insert(localPackRankSnapshots).values({
      accountId: ACCOUNT,
      siteId: SITE,
      keywordId: kw!.id,
      position: null,
      totalPackSize: 3,
      capturedAt: new Date('2026-07-10T12:00:00Z'),
    });

    const result = await buildLocalSeoEvaluationInput(db as unknown as never, { siteId: SITE, accountId: ACCOUNT });
    expect(result.status).toBe('ok');
    expect(result.reviews).toBeNull();
    expect(result.qa).toBeNull();
    expect(result.localPack).toEqual({
      keyword: 'plumber austin',
      position: null,
      totalPackSize: 3,
    });
  });

  it('localPack is null and no keyword lookup runs when listings exist but no local-pack keyword is tracked', async () => {
    const db = getTestDb();
    await db.insert(localListingSnapshots).values({
      accountId: ACCOUNT,
      siteId: SITE,
      snapshotDate: '2026-07-10',
      source: 'google',
      name: 'Example Dental',
      address: '100 Main St',
      phone: '+1 512-555-0100',
      consistent: true,
    });

    const result = await buildLocalSeoEvaluationInput(db as unknown as never, { siteId: SITE, accountId: ACCOUNT });
    expect(result.status).toBe('ok');
    expect(result.localPack).toBeNull();
  });

  it('falls back to an empty phrase when the tracked keyword row no longer exists', async () => {
    const db = getTestDb();
    const [kw] = await db
      .insert(keywords)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        phrase: 'temp keyword',
        locationCode: 2840,
        languageCode: 'en',
      })
      .returning();
    await db.insert(localPackRankSnapshots).values({
      accountId: ACCOUNT,
      siteId: SITE,
      keywordId: kw!.id,
      position: 1,
      totalPackSize: 3,
      capturedAt: new Date('2026-07-10T12:00:00Z'),
    });
    // Delete the keyword row after the snapshot was recorded — the join
    // then finds no phrase for it. (Sole keyword row in this test's table.)
    await db.delete(keywords);

    const result = await buildLocalSeoEvaluationInput(db as unknown as never, { siteId: SITE, accountId: ACCOUNT });
    expect(result.localPack).toEqual({ keyword: '', position: 1, totalPackSize: 3 });
  });
});

describe('persistLocalSeoSnapshot', () => {
  it('skips the listings insert when listings array is empty (FALSE branch)', async () => {
    const db = getTestDb();
    await persistLocalSeoSnapshot(db as unknown as never, {
      accountId: ACCOUNT,
      siteId: SITE,
      now: new Date('2026-07-10T12:00:00Z'),
      listings: [],
      reviews: { averageRating: 4.2, reviewCount: 10, recentReviewCount: null },
      qa: { questionCount: 2, unansweredCount: 1 },
    });
    // No listing rows — the insert block was skipped.
    const listingRows = await db.select().from(localListingSnapshots);
    expect(listingRows).toHaveLength(0);
    // Reviews snapshot still written inside the same transaction.
    const reviewRows = await db.select().from(localReviewsSnapshots);
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]!.unansweredQuestionCount).toBe(1);
  });
});
