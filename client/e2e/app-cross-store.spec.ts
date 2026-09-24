import { expect, test } from '@playwright/test';

import {
  appSeoUsage,
  createAppSeoJourney,
  csrfPostJson,
  scanAppSeoBothThemes,
  switchAppSeoToArabic,
  waitForJson,
} from './helpers/app-seo';
import { runComposeApiScriptOutput } from './helpers/compose';

interface Comparison {
  profile: { id: string; paired: boolean };
  pairingProvenance: 'user-paired' | null;
  listings: { google_play: unknown | null; app_store: unknown | null };
  ratingDelta: number | null;
  reviewCountDelta: number | null;
  ranks: {
    shared: Array<{ phrase: string; googlePlay: { checkedAt: string | null }; appStore: { checkedAt: string | null } }>;
    onlyGooglePlay: unknown[];
    onlyAppStore: unknown[];
  };
  listingParity: { rawFields: Array<{ field: string; matches: boolean | null }> };
  charts: Array<{ googlePlay: { checkedAt: string | null }; appStore: { checkedAt: string | null } }>;
}

function seedProfile(
  accountId: string,
  siteId: string,
  profile: {
    playPackageId: string;
    appStoreId?: string;
    paired: boolean;
  },
): string {
  const id = runComposeApiScriptOutput(
    `
      const mongooseModule = await import('mongoose');
      const mongoose = mongooseModule.default;
      await mongoose.connect(process.env.MONGODB_URI);
      const database = mongoose.connection.db;
      if (!database) throw new Error('Mongo database unavailable');
      const now = new Date();
      const result = await database.collection('appprofiles').insertOne({
        accountId: new mongoose.Types.ObjectId(process.env.SEED_ACCOUNT_ID),
        siteId: new mongoose.Types.ObjectId(process.env.SEED_SITE_ID),
        playPackageId: process.env.SEED_PLAY_PACKAGE_ID,
        appStoreId: process.env.SEED_APP_STORE_ID || null,
        paired: process.env.SEED_PAIRED === 'true',
        createdAt: now,
        updatedAt: now,
      });
      process.stdout.write(String(result.insertedId));
      await mongoose.disconnect();
    `,
    {
      SEED_ACCOUNT_ID: accountId,
      SEED_SITE_ID: siteId,
      SEED_PLAY_PACKAGE_ID: profile.playPackageId,
      SEED_APP_STORE_ID: profile.appStoreId ?? '',
      SEED_PAIRED: String(profile.paired),
    },
  );
  expect(id).toMatch(/^[0-9a-f]{24}$/u);
  return id;
}

test('App cross-store comparison reads saved observations without spend and covers empty/unpaired states', async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  const journey = await createAppSeoJourney(page, context, 'app-compare');
  const compareUrl = `/api/sites/${journey.siteId}/apps/compare?profileId=${journey.profileId}`;

  const initialUsage = {
    keywords: appSeoUsage(journey.accountId, 'app_keyword_checks'),
    listings: appSeoUsage(journey.accountId, 'app_listing_audits'),
    charts: appSeoUsage(journey.accountId, 'app_chart_checks'),
    research: appSeoUsage(journey.accountId, 'app_keyword_lookups'),
  };
  const emptyResponse = await page.request.get(compareUrl);
  expect(emptyResponse.status()).toBe(200);
  const empty = (await emptyResponse.json()) as Comparison;
  expect(empty).toMatchObject({
    pairingProvenance: 'user-paired',
    listings: { google_play: null, app_store: null },
    ranks: { shared: [], onlyGooglePlay: [], onlyAppStore: [] },
    charts: [],
  });
  expect({
    keywords: appSeoUsage(journey.accountId, 'app_keyword_checks'),
    listings: appSeoUsage(journey.accountId, 'app_listing_audits'),
    charts: appSeoUsage(journey.accountId, 'app_chart_checks'),
    research: appSeoUsage(journey.accountId, 'app_keyword_lookups'),
  }).toEqual(initialUsage);

  await csrfPostJson(
    page.request,
    `/api/sites/${journey.siteId}/apps/listing/runs`,
    { profileId: journey.profileId, confirm: true },
    202,
  );
  const keywordRoot = `/api/sites/${journey.siteId}/apps/keywords?profileId=${journey.profileId}`;
  const keywordIds: string[] = [];
  for (const store of ['google_play', 'app_store'] as const) {
    const created = await csrfPostJson<{ keyword: { id: string } }>(
      page.request,
      keywordRoot,
      { phrase: 'shared safe phrase', store, locationCode: 2840, languageCode: 'en' },
      201,
    );
    keywordIds.push(created.keyword.id);
  }
  for (const keywordId of keywordIds) {
    await csrfPostJson(
      page.request,
      `/api/sites/${journey.siteId}/apps/keywords/${keywordId}/recheck`,
      { confirm: true },
      202,
    );
  }
  const chartRoot = `/api/sites/${journey.siteId}/apps/charts`;
  const subscriptions: string[] = [];
  for (const store of ['google_play', 'app_store'] as const) {
    const created = await csrfPostJson<{ subscription: { id: string } }>(
      page.request,
      chartRoot,
      {
        profileId: journey.profileId,
        store,
        chartId: store === 'google_play' ? 'topselling_free' : 'top_free_ios',
        categoryId: 'business',
        locationCode: 2840,
        languageCode: 'en',
      },
      201,
    );
    subscriptions.push(created.subscription.id);
  }
  for (const subscriptionId of subscriptions) {
    await csrfPostJson(
      page.request,
      `${chartRoot}/${subscriptionId}/recheck`,
      { confirm: true },
      202,
    );
  }

  const populated = await waitForJson<Comparison>(
    page.request,
    compareUrl,
    (body) =>
      body.listings.google_play !== null &&
      body.listings.app_store !== null &&
      body.ranks.shared.some(
        (row) => row.googlePlay.checkedAt !== null && row.appStore.checkedAt !== null,
      ) &&
      body.charts.some(
        (row) => row.googlePlay.checkedAt !== null && row.appStore.checkedAt !== null,
      ),
    'comparison projects the latest saved observations for both stores',
  );
  expect(populated.profile.paired).toBe(true);
  expect(populated.ranks.shared.map((row) => row.phrase)).toContain('shared safe phrase');
  expect(populated.listingParity.rawFields.map((row) => row.field)).toEqual([
    'title',
    'developerName',
    'mainCategory',
    'version',
    'categories',
  ]);
  expect(populated.ratingDelta).not.toBeNull();
  expect(populated.reviewCountDelta).not.toBeNull();

  const beforeRead = {
    keywords: appSeoUsage(journey.accountId, 'app_keyword_checks'),
    listings: appSeoUsage(journey.accountId, 'app_listing_audits'),
    charts: appSeoUsage(journey.accountId, 'app_chart_checks'),
  };
  expect((await page.request.get(compareUrl)).status()).toBe(200);
  expect({
    keywords: appSeoUsage(journey.accountId, 'app_keyword_checks'),
    listings: appSeoUsage(journey.accountId, 'app_listing_audits'),
    charts: appSeoUsage(journey.accountId, 'app_chart_checks'),
  }).toEqual(beforeRead);

  await page.goto(
    `/sites/${journey.siteId}?tab=apps&view=compare&profile=${journey.profileId}`,
  );
  await expect(page.getByTestId('app-seo-view-compare')).toBeVisible();
  for (const heading of ['Store listings', 'Keyword ranks', 'Listing parity', 'Chart positions']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.getByText('User-paired', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Google Play \+|App Store \+|Even/u).first()).toBeVisible();

  // These display-only fixtures intentionally bypass the create-profile API:
  // the journey has already exercised its bounded create/recheck rate limit.
  const emptyProfileId = seedProfile(journey.accountId, journey.siteId, {
    playPackageId: 'com.rankme.empty.compare',
    appStoreId: '7100000001',
    paired: true,
  });
  await page.goto(
    `/sites/${journey.siteId}?tab=apps&view=compare&profile=${emptyProfileId}`,
  );
  await expect(page.getByText('Keyword ranks not observed')).toBeVisible();
  await expect(page.getByText('One or both listings not observed')).toBeVisible();
  await expect(page.getByText('Chart positions not observed')).toBeVisible();

  const unpairedProfileId = seedProfile(journey.accountId, journey.siteId, {
    playPackageId: 'com.rankme.unpaired.compare',
    paired: false,
  });
  await page.goto(
    `/sites/${journey.siteId}?tab=apps&view=compare&profile=${unpairedProfileId}`,
  );
  await expect(page.getByText('Pair the store listings to compare them')).toBeVisible();

  await page.goto(
    `/sites/${journey.siteId}?tab=apps&view=compare&profile=${journey.profileId}`,
  );
  await switchAppSeoToArabic(page);
  await expect(page.getByTestId('app-seo-view-compare')).toBeVisible();
  await scanAppSeoBothThemes(page, 'App cross-store comparison Arabic');
  expect(journey.deniedUrls, 'browser egress').toEqual([]);
});
