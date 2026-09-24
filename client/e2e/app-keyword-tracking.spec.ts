import { expect, test } from '@playwright/test';

import {
  appSeoUsage,
  awaitAppSeoApiHealthy,
  createAppSeoJourney,
  csrfPostJson,
  scanAppSeoBothThemes,
  setAppSeoUsage,
  switchAppSeoToArabic,
  waitForJson,
} from './helpers/app-seo';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

interface KeywordList {
  items: Array<{ id: string; phrase: string; lastCheckedAt: string | null }>;
}

test('App SEO keyword tracking: mint, worker history, cap, flag, RTL, and axe', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  const inherited = captureInheritedComposeEnvironment(['APP_KEYWORD_TRACKING_ENABLED']);
  assertComposeRuntimeParity(inherited);
  const journey = await createAppSeoJourney(page, context, 'app-keywords');
  const root = `/api/sites/${journey.siteId}/apps/keywords`;

  try {
    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=keywords&profile=${journey.profileId}`,
    );
    await expect(page.getByTestId('app-seo-view-keywords')).toBeVisible();

    await page.getByRole('textbox', { name: 'Keyword', exact: true }).fill('safe growth');
    await page.getByRole('button', { name: 'Add keyword' }).click();
    const mintDialog = page.getByRole('dialog', { name: 'Add this tracked keyword?' });
    await expect(mintDialog).toContainText('This check uses 1 app keyword check.');
    await mintDialog.getByRole('button', { name: 'Add keyword' }).click();

    const minted = await waitForJson<KeywordList>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      (body) => body.items.some((item) => item.phrase === 'safe growth'),
      'tracked app keyword is stored without spending a check',
    );
    const keyword = minted.items.find((item) => item.phrase === 'safe growth')!;
    expect(keyword.lastCheckedAt).toBeNull();
    expect(appSeoUsage(journey.accountId, 'app_keyword_checks')).toBe(0);

    await page.reload();
    await page.getByRole('button', { name: 'Check safe growth now' }).click();
    const initialCheck = page.getByRole('dialog', { name: 'Check this keyword now?' });
    await initialCheck.getByRole('button', { name: 'Run check' }).click();
    await waitForJson<KeywordList>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      (body) => body.items.some((item) => item.id === keyword.id && item.lastCheckedAt !== null),
      'manual app keyword check reaches stored history',
    );
    expect(appSeoUsage(journey.accountId, 'app_keyword_checks')).toBe(1);

    await page.reload();
    await expect(page.getByText('safe growth', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View history for safe growth' }).click();
    await expect(page.getByTestId('app-keyword-history')).toBeVisible();

    await page.getByRole('button', { name: 'Check safe growth now' }).click();
    const recheck = page.getByRole('dialog', { name: 'Check this keyword now?' });
    await expect(recheck).toContainText('This check uses 1 app keyword check.');
    await recheck.getByRole('button', { name: 'Run check' }).click();
    await expect(page.getByRole('dialog', { name: 'Check this keyword now?' })).toHaveCount(0);
    expect(appSeoUsage(journey.accountId, 'app_keyword_checks')).toBe(1);

    setAppSeoUsage(journey.accountId, 'app_keyword_checks', 650, 650);
    const blockedKeyword = await csrfPostJson<{ keyword: { id: string } }>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      {
        phrase: 'blocked keyword',
        store: 'google_play',
        locationCode: 2840,
        languageCode: 'en',
      },
      201,
    );
    const capped = await csrfPostJson<{ error?: { details?: { metric?: string } } }>(
      page.request,
      `${root}/${blockedKeyword.keyword.id}/recheck`,
      { confirm: true },
      402,
    );
    expect(capped.error?.details?.metric).toBe('app_keyword_checks');

    recreateComposeServices(['api'], { APP_KEYWORD_TRACKING_ENABLED: 'false' });
    await awaitAppSeoApiHealthy(page);
    const disabled = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      {
        phrase: 'disabled keyword',
        store: 'google_play',
        locationCode: 2840,
        languageCode: 'en',
      },
      503,
    );
    expect(disabled.error?.message).toBeTruthy();
    const stored = await page.request.get(`${root}?profileId=${journey.profileId}`);
    expect(stored.status()).toBe(200);
    expect(((await stored.json()) as KeywordList).items.map((item) => item.id)).toContain(keyword.id);
  } finally {
    recreateComposeServices(['api'], inherited);
    await awaitAppSeoApiHealthy(page);
    assertComposeRuntimeParity(inherited);
  }

  setAppSeoUsage(journey.accountId, 'app_keyword_checks', 1, 650);
  await page.goto(`/sites/${journey.siteId}?tab=apps&view=keywords&profile=${journey.profileId}`);
  await switchAppSeoToArabic(page);
  await expect(page.getByTestId('app-seo-view-keywords')).toBeVisible();
  await scanAppSeoBothThemes(page, 'App SEO keyword tracking Arabic');
  expect(journey.deniedUrls, 'browser egress').toEqual([]);
});
