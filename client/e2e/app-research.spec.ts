import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import {
  awaitAppSeoApiHealthy,
  createAppSeoJourney,
  csrfPostJson,
  scanAppSeoBothThemes,
  setAppSeoUsage,
  switchAppSeoToArabic,
} from './helpers/app-seo';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const keywordInput = (profileId: string) => ({
  profileId,
  store: 'google_play' as const,
  locationCode: 2840,
  languageCode: 'en',
  cursor: 0,
  pageSize: 25,
});

test('App SEO research: keywords, gap, competitors, CSV, caps, flag, RTL, and axe', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(360_000);
  const inherited = captureInheritedComposeEnvironment(['APP_RESEARCH_ENABLED']);
  assertComposeRuntimeParity(inherited);
  const journey = await createAppSeoJourney(page, context, 'app-research');
  const root = `/api/sites/${journey.siteId}/apps/research`;

  try {
    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=research&profile=${journey.profileId}&store=google_play&panel=keywords`,
    );
    await expect(page.getByTestId('app-seo-view-research')).toBeVisible();
    await page.getByRole('button', { name: 'Preview keyword lookup' }).click();
    const keywordDialog = page.getByRole('dialog', { name: 'Confirm this lookup' });
    await expect(keywordDialog).toContainText('lookup unit');
    await keywordDialog.getByRole('button', { name: 'Run lookup' }).click();
    await expect(page.getByRole('heading', { name: 'Ranked keywords' })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('keyword');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('app-keywords.csv');
    const csvPath = testInfo.outputPath('app-keywords.csv');
    await download.saveAs(csvPath);
    const csv = await readFile(csvPath, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const csvWithoutBom = csv.slice(1);
    expect(csvWithoutBom).toMatch(/^rank,keyword,app_id,updated_at\r?\n/u);
    for (const line of csvWithoutBom.split(/\r?\n/u).slice(1).filter(Boolean)) {
      expect(line, 'CSV row must not begin with a spreadsheet formula').not.toMatch(/^[=+@-]/u);
    }

    await page.getByRole('tab', { name: 'Keyword gap' }).click();
    await page.getByLabel('Competitor app IDs').fill('com.rankme.competitor');
    await page.getByRole('button', { name: 'Preview keyword gap' }).click();
    await page.getByRole('dialog', { name: 'Confirm this lookup' })
      .getByRole('button', { name: 'Run lookup' })
      .click();
    await expect(page.getByRole('heading', { name: 'Keyword gap' }).last()).toBeVisible();

    const invalidMarket = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      `${root}/gap`,
      {
        profileId: journey.profileId,
        store: 'google_play',
        locationCode: 2276,
        languageCode: 'de',
        appIds: ['com.rankme.appresearch', 'com.rankme.competitor'],
      },
      400,
    );
    expect(invalidMarket.error?.message).toBeTruthy();

    await page.getByTestId('app-seo-view-research')
      .getByRole('tab', { name: 'Competitors' })
      .click();
    await page.getByRole('button', { name: 'Preview competitor lookup' }).click();
    await page.getByRole('dialog', { name: 'Confirm this lookup' })
      .getByRole('button', { name: 'Run lookup' })
      .click();
    await expect(page.getByRole('heading', { name: 'Discovered competitors' })).toBeVisible();

    setAppSeoUsage(journey.accountId, 'app_keyword_lookups', 42, 42);
    const keywordCap = await csrfPostJson<{ error?: { details?: { metric?: string } } }>(
      page.request,
      `${root}/keywords`,
      keywordInput(journey.profileId),
      402,
    );
    expect(keywordCap.error?.details?.metric).toBe('app_keyword_lookups');

    setAppSeoUsage(journey.accountId, 'app_competitor_lookups', 10, 10);
    const competitorCap = await csrfPostJson<{ error?: { details?: { metric?: string } } }>(
      page.request,
      `${root}/competitors`,
      {
        profileId: journey.profileId,
        store: 'google_play',
        locationCode: 2840,
        languageCode: 'en',
      },
      402,
    );
    expect(competitorCap.error?.details?.metric).toBe('app_competitor_lookups');

    recreateComposeServices(['api'], { APP_RESEARCH_ENABLED: 'false' });
    await awaitAppSeoApiHealthy(page);
    const disabled = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      `${root}/keywords`,
      keywordInput(journey.profileId),
      503,
    );
    expect(disabled.error?.message).toBeTruthy();
    const stored = await page.request.get(
      `${root}/keywords?profileId=${journey.profileId}&store=google_play`,
    );
    expect(stored.status()).toBe(200);
    expect(((await stored.json()) as { result?: unknown }).result).toBeTruthy();
  } finally {
    recreateComposeServices(['api'], inherited);
    await awaitAppSeoApiHealthy(page);
    assertComposeRuntimeParity(inherited);
  }

  setAppSeoUsage(journey.accountId, 'app_keyword_lookups', 2, 42);
  setAppSeoUsage(journey.accountId, 'app_competitor_lookups', 1, 10);
  await page.goto(
    `/sites/${journey.siteId}?tab=apps&view=research&profile=${journey.profileId}&store=google_play&panel=competitors`,
  );
  await switchAppSeoToArabic(page);
  await expect(page.getByTestId('app-seo-view-research')).toBeVisible();
  await scanAppSeoBothThemes(page, 'App SEO research Arabic');
  expect(journey.deniedUrls, 'browser egress').toEqual([]);
});
