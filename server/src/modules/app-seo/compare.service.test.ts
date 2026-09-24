import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import {
  appChartSnapshots,
  appKeywords,
  appListingSnapshots,
  appRankSnapshots,
} from '../../db/schema/index.js';
import type { AppInfo } from '../../shared/providers/app-data.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/sites.model.js';
import { AppProfile } from './app-profile.model.js';
import { readAppSeoComparison } from './compare.service.js';

const observedAt = '2026-08-11T00:00:00.000Z';
const observation: AppInfo['observationMeta'] = {
  sourceKind: 'provider_observation',
  sourceLabel: 'dataforseo',
  observedAt,
  freshUntil: null,
  freshness: 'fresh',
  market: null,
  sampleCount: 1,
  coverageNoteKey: null,
};

function listing(store: AppInfo['store']): AppInfo {
  return {
    store,
    appId: store === 'google_play' ? 'fast.rankme.compare' : '123456789',
    title: store === 'google_play' ? 'RankMe Play' : 'RankMe Apple',
    url: null,
    iconUrl: null,
    description: 'Stored comparison evidence.',
    rating: store === 'google_play' ? 4.5 : 4.2,
    reviewCount: store === 'google_play' ? 20 : 15,
    isFree: true,
    price: null,
    mainCategory: 'Business',
    categories: ['Business'],
    installs: store === 'google_play' ? { raw: '1,000+', lowerBound: 1_000 } : null,
    developerName: 'RankMe',
    developerUrl: null,
    developerWebsite: null,
    version: '1.0.0',
    minimumOsVersion: null,
    size: null,
    releasedAt: null,
    updatedAt: observedAt,
    updateNotes: null,
    imageUrls: [],
    videoUrls: store === 'google_play' ? [] : null,
    languages: store === 'app_store' ? ['en'] : null,
    advisories: store === 'app_store' ? [] : null,
    tags: store === 'google_play' ? [] : null,
    similarApps: [],
    moreByDeveloper: [],
    locationCode: 2840,
    languageCode: 'en',
    observationMeta: observation,
  };
}

let appSeoEnabled: boolean;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  appSeoEnabled = env.APP_SEO_ENABLED;
  env.APP_SEO_ENABLED = true;
});
afterEach(() => {
  env.APP_SEO_ENABLED = appSeoEnabled;
});

async function ownedSite(accountId: string, suffix: string) {
  const site = await Site.create({
    accountId,
    url: `https://${suffix}.example.test`,
    domain: `${suffix}.example.test`,
  });
  return String(site._id);
}

describe('readAppSeoComparison', () => {
  it('fails closed for rollout-off, malformed, and missing profiles', async () => {
    const accountId = new Types.ObjectId().toHexString();
    env.APP_SEO_ENABLED = false;
    await expect(readAppSeoComparison({
      accountId,
      siteId: new Types.ObjectId().toHexString(),
      profileId: 'malformed',
    }, getTestDb())).rejects.toMatchObject({ status: 503 });

    env.APP_SEO_ENABLED = true;
    const siteId = await ownedSite(accountId, 'compare-guards');
    await expect(readAppSeoComparison({ accountId, siteId, profileId: 'malformed' }, getTestDb()))
      .rejects.toMatchObject({ status: 404 });
    await expect(readAppSeoComparison({
      accountId,
      siteId,
      profileId: new Types.ObjectId().toHexString(),
    }, getTestDb())).rejects.toMatchObject({ status: 404 });
  });

  it('returns an honest stored-only projection for unpaired and empty paired profiles', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await ownedSite(accountId, 'compare-empty');
    const unpaired = await AppProfile.create({
      accountId,
      siteId,
      playPackageId: 'fast.rankme.unpaired',
    });
    await expect(readAppSeoComparison({
      accountId,
      siteId,
      profileId: String(unpaired._id),
    }, getTestDb())).resolves.toMatchObject({
      profile: { paired: false },
      pairingProvenance: null,
      ranks: { shared: [] },
    });

    const appleOnly = await AppProfile.create({
      accountId,
      siteId,
      appStoreId: '111222333',
    });
    await expect(readAppSeoComparison({
      accountId,
      siteId,
      profileId: String(appleOnly._id),
    }, getTestDb())).resolves.toMatchObject({
      profile: { paired: false, playPackageId: null, appStoreId: '111222333' },
    });

    const paired = await AppProfile.create({
      accountId,
      siteId,
      playPackageId: 'fast.rankme.paired',
      appStoreId: '123456789',
      paired: true,
    });
    await expect(readAppSeoComparison({
      accountId,
      siteId,
      profileId: String(paired._id),
    }, getTestDb())).resolves.toMatchObject({
      profile: { paired: true },
      pairingProvenance: 'user-paired',
      listings: { google_play: null, app_store: null },
      charts: [],
    });
  });

  it('loads only latest active keyword, listing, and chart evidence', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await ownedSite(accountId, 'compare-stored');
    const profile = await AppProfile.create({
      accountId,
      siteId,
      playPackageId: 'fast.rankme.stored',
      appStoreId: '987654321',
      paired: true,
    });
    const profileId = String(profile._id);
    const keywords = await getTestDb().insert(appKeywords).values([
      {
        accountId,
        siteId,
        profileId,
        store: 'google_play',
        phrase: 'rank fast',
        locationCode: 2840,
        languageCode: 'en',
      },
      {
        accountId,
        siteId,
        profileId,
        store: 'app_store',
        phrase: 'rank fast',
        locationCode: 2840,
        languageCode: 'en',
      },
    ]).returning({ id: appKeywords.id });
    await getTestDb().insert(appRankSnapshots).values([
      {
        accountId,
        siteId,
        keywordId: keywords[0]!.id,
        position: 3,
        checkedAt: new Date(observedAt),
        observationMeta: observation,
      },
      {
        accountId,
        siteId,
        keywordId: keywords[1]!.id,
        position: 7,
        checkedAt: new Date(observedAt),
        observationMeta: observation,
      },
    ]);
    await getTestDb().insert(appListingSnapshots).values([
      {
        accountId,
        siteId,
        profileId,
        store: 'google_play',
        capturedAt: new Date(observedAt),
        listing: listing('google_play'),
        findings: { findings: [] },
        observationMeta: observation,
      },
      {
        accountId,
        siteId,
        profileId,
        store: 'app_store',
        capturedAt: new Date(observedAt),
        listing: listing('app_store'),
        findings: { findings: [] },
        observationMeta: observation,
      },
    ]);
    await getTestDb().insert(appChartSnapshots).values([
      {
        accountId,
        siteId,
        profileId,
        store: 'google_play',
        chartId: 'topselling_free',
        categoryId: 'business',
        position: 2,
        checkedAt: new Date(observedAt),
        observationMeta: observation,
      },
      {
        accountId,
        siteId,
        profileId,
        store: 'app_store',
        chartId: 'top_free_ios',
        categoryId: 'business',
        position: 5,
        checkedAt: new Date(observedAt),
        observationMeta: observation,
      },
    ]);

    const comparison = await readAppSeoComparison({ accountId, siteId, profileId }, getTestDb());
    expect(comparison.ranks.shared).toEqual([
      expect.objectContaining({ phrase: 'rank fast', delta: 4 }),
    ]);
    expect(comparison.ratingDelta).toBe(0.3);
    expect(comparison.reviewCountDelta).toBe(5);
    expect(comparison.charts).toEqual([
      expect.objectContaining({ chartId: 'topselling_free', delta: 3 }),
    ]);
  });
});
