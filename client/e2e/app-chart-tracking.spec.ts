import { expect, test } from '@playwright/test';

import {
  awaitAppSeoApiHealthy,
  createAppSeoJourney,
  csrfDelete,
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

interface ChartList {
  items: Array<{
    id: string;
    store: 'google_play' | 'app_store';
    lastCheckedAt: string | null;
  }>;
  limit: number;
}

test('App SEO chart tracking: both stores, limit, history, cap, flag, RTL, and axe', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  const inherited = captureInheritedComposeEnvironment(['APP_CHART_TRACKING_ENABLED']);
  assertComposeRuntimeParity(inherited);
  const journey = await createAppSeoJourney(page, context, 'app-charts');
  const root = `/api/sites/${journey.siteId}/apps/charts`;

  try {
    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=charts&profile=${journey.profileId}`,
    );
    await expect(page.getByTestId('app-seo-view-charts')).toBeVisible();
    await page.getByRole('button', { name: 'Track chart' }).click();

    await page.getByRole('combobox', { name: 'Store' }).click();
    await page.getByRole('option', { name: 'App Store' }).click();
    await page.getByRole('button', { name: 'Track chart' }).click();

    const subscribed = await waitForJson<ChartList>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      (body) => body.items.length === 2,
      'both chart subscriptions are stored',
    );
    for (const item of subscribed.items) {
      await csrfPostJson(
        page.request,
        `${root}/${item.id}/recheck`,
        { confirm: true },
        202,
      );
    }
    const completed = await waitForJson<ChartList>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      (body) => body.items.length === 2 && body.items.every((item) => item.lastCheckedAt !== null),
      'both chart subscriptions receive a stored top-100 observation',
    );
    expect(completed.limit).toBe(2);
    expect(completed.items.map((item) => item.store).sort()).toEqual([
      'app_store',
      'google_play',
    ]);

    await page.reload();
    await expect(page.getByText('2 of 2 chart subscriptions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Track chart' })).toBeDisabled();
    await expect(page.getByText('Chart limit reached')).toBeVisible();

    const third = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      root,
      {
        profileId: journey.profileId,
        store: 'google_play',
        chartId: 'topselling_paid',
        categoryId: 'business',
      },
      409,
    );
    expect(third.error?.message).toBeTruthy();

    await page.getByRole('button', { name: 'View chart history' }).first().click();
    await expect(page.getByTestId('app-chart-history')).toBeVisible();

    await csrfDelete(page.request, `${root}/${completed.items[0]!.id}`, 204);
    const afterDelete = await waitForJson<ChartList>(
      page.request,
      `${root}?profileId=${journey.profileId}`,
      (body) => body.items.length === 1,
      'one chart slot is available for an independent cap check',
    );
    expect(afterDelete.items).toHaveLength(1);

    const fresh = await csrfPostJson<{ subscription: { id: string } }>(
      page.request,
      root,
      {
        profileId: journey.profileId,
        store: 'google_play',
        chartId: 'topselling_paid',
        categoryId: 'business',
      },
      201,
    );
    setAppSeoUsage(journey.accountId, 'app_chart_checks', 80, 80);
    const capped = await csrfPostJson<{ error?: { details?: { metric?: string } } }>(
      page.request,
      `${root}/${fresh.subscription.id}/recheck`,
      { confirm: true },
      402,
    );
    expect(capped.error?.details?.metric).toBe('app_chart_checks');
    await csrfDelete(page.request, `${root}/${fresh.subscription.id}`, 204);

    const remainingResponse = await page.request.get(`${root}?profileId=${journey.profileId}`);
    expect(remainingResponse.status()).toBe(200);
    const remaining = (await remainingResponse.json()) as ChartList;
    expect(remaining.items).toHaveLength(1);

    recreateComposeServices(['api'], { APP_CHART_TRACKING_ENABLED: 'false' });
    await awaitAppSeoApiHealthy(page);
    const disabled = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      `${root}/${remaining.items[0]!.id}/recheck`,
      { confirm: true },
      503,
    );
    expect(disabled.error?.message).toBeTruthy();
    const stored = await page.request.get(`${root}?profileId=${journey.profileId}`);
    expect(stored.status()).toBe(200);
    expect(((await stored.json()) as ChartList).items.length).toBe(1);
  } finally {
    recreateComposeServices(['api'], inherited);
    await awaitAppSeoApiHealthy(page);
    assertComposeRuntimeParity(inherited);
  }

  setAppSeoUsage(journey.accountId, 'app_chart_checks', 2, 80);
  await page.goto(`/sites/${journey.siteId}?tab=apps&view=charts&profile=${journey.profileId}`);
  await switchAppSeoToArabic(page);
  await expect(page.getByTestId('app-seo-view-charts')).toBeVisible();
  await scanAppSeoBothThemes(page, 'App SEO chart tracking Arabic');
  expect(journey.deniedUrls, 'browser egress').toEqual([]);
});
