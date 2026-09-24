import { expect, test } from '@playwright/test';

import {
  awaitAppSeoApiHealthy,
  createAppSeoJourney,
  csrfPostJson,
  reloadAppSeoPage,
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

interface ListingRead {
  report: null | {
    stores: { google_play: unknown | null; app_store: unknown | null };
    findings: Array<{ scope: string }>;
    notObserved: Array<{ store: string; field: string }>;
  };
}

test('App SEO listing report: paired stores, parity, cap, flag, RTL, and axe', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  const inherited = captureInheritedComposeEnvironment(['APP_LISTING_AUDITS_ENABLED']);
  assertComposeRuntimeParity(inherited);
  const journey = await createAppSeoJourney(page, context, 'app-listing');
  const root = `/api/sites/${journey.siteId}/apps/listing`;

  try {
    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=listing&profile=${journey.profileId}`,
    );
    await expect(page.getByTestId('app-seo-view-listing')).toBeVisible();
    await page.getByRole('button', { name: 'Preview run' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm listing health check' });
    await expect(dialog).toContainText('Usage for this run: 1 unit');
    await dialog.getByRole('button', { name: 'Start listing check' }).click();

    const completed = await waitForJson<ListingRead>(
      page.request,
      `${root}/latest?profileId=${journey.profileId}`,
      (body) => body.report !== null,
      'paired listing report becomes readable',
    );
    expect(completed.report?.stores.google_play).not.toBeNull();
    expect(completed.report?.stores.app_store).not.toBeNull();
    expect(completed.report?.findings.some((finding) => finding.scope === 'parity')).toBe(true);
    expect(
      completed.report?.notObserved.some(
        (note) => note.store === 'app_store' && note.field === 'installs',
      ),
    ).toBe(true);

    await reloadAppSeoPage(
      page,
      page.getByRole('heading', { name: 'Latest listing report' }),
    );
    await expect(page.getByRole('heading', { name: 'Paired-store consistency' })).toBeVisible();
    await expect(page.getByText('Evidence not observed').first()).toBeVisible();

    setAppSeoUsage(journey.accountId, 'app_listing_audits', 12, 12);
    const capped = await csrfPostJson<{ error?: { details?: { metric?: string } } }>(
      page.request,
      `${root}/runs`,
      { profileId: journey.profileId, confirm: true },
      402,
    );
    expect(capped.error?.details?.metric).toBe('app_listing_audits');

    recreateComposeServices(['api'], { APP_LISTING_AUDITS_ENABLED: 'false' });
    await awaitAppSeoApiHealthy(page);
    const disabled = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      `${root}/runs`,
      { profileId: journey.profileId, confirm: true },
      503,
    );
    expect(disabled.error?.message).toBeTruthy();
    const stored = await page.request.get(`${root}/latest?profileId=${journey.profileId}`);
    expect(stored.status()).toBe(200);
    expect(((await stored.json()) as ListingRead).report).not.toBeNull();
  } finally {
    recreateComposeServices(['api'], inherited);
    await awaitAppSeoApiHealthy(page);
    assertComposeRuntimeParity(inherited);
  }

  setAppSeoUsage(journey.accountId, 'app_listing_audits', 1, 12);
  await page.goto(`/sites/${journey.siteId}?tab=apps&view=listing&profile=${journey.profileId}`);
  await switchAppSeoToArabic(page);
  await expect(page.getByTestId('app-seo-view-listing')).toBeVisible();
  await scanAppSeoBothThemes(page, 'App SEO listing report Arabic');
  expect(journey.deniedUrls, 'browser egress').toEqual([]);
});
