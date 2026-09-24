import { expect, test } from '@playwright/test';

import {
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
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

interface ReviewRun {
  id: string;
  status: string;
  clusterState: 'pending' | 'available' | 'thin_evidence' | 'unavailable';
  reviewCount: number;
  stats: null | { total: number; histogram: Array<{ star: number; count: number }> };
  clusters: Array<{
    label: string;
    citedReviewIds: string[];
    citations: Array<{ reviewId: string; quote: string }>;
    observationMeta: { sourceKind: string };
  }>;
}

interface ReviewList {
  items: Array<{ id: string; status: string; clusterState: string }>;
}

test('App review intelligence: evidence, clusters, abstention, cap, flag, RTL, and axe', async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  const inherited = captureInheritedComposeEnvironment(['APP_REVIEWS_ENABLED']);
  assertComposeRuntimeParity(inherited);
  const journey = await createAppSeoJourney(page, context, 'app-reviews');
  const root = `/api/sites/${journey.siteId}/apps/reviews`;
  let clusteredId = '';

  try {
    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=reviews&profile=${journey.profileId}`,
    );
    await expect(page.getByTestId('app-seo-view-reviews')).toBeVisible();
    await page.getByRole('button', { name: 'Preview run' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm review analysis' });
    await expect(dialog).toContainText('Usage for this run: 1 unit');
    await dialog.getByRole('button', { name: 'Start review analysis' }).click();

    const listed = await waitForJson<ReviewList>(
      page.request,
      `${root}/runs?profileId=${journey.profileId}&store=google_play`,
      (body) => body.items.some((run) => run.status === 'completed'),
      'review pull and citation-aware cluster pass complete',
    );
    clusteredId = listed.items.find((run) => run.status === 'completed')!.id;
    const clustered = await waitForJson<{ run: ReviewRun }>(
      page.request,
      `${root}/runs/${clusteredId}`,
      (body) => body.run.clusterState === 'available',
      'review clusters become available',
    );
    expect(clustered.run.reviewCount).toBe(12);
    expect(clustered.run.stats?.total).toBe(12);
    expect(clustered.run.stats?.histogram.reduce((sum, row) => sum + row.count, 0)).toBe(12);
    expect(clustered.run.clusters).toHaveLength(1);
    expect(clustered.run.clusters[0]?.citedReviewIds).toHaveLength(2);
    expect(clustered.run.clusters[0]?.citations).toHaveLength(2);
    expect(clustered.run.clusters[0]?.citations.every((row) => row.quote.length > 0)).toBe(true);
    expect(clustered.run.clusters[0]?.observationMeta.sourceKind).toBe('ai_interpretation');

    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=reviews&profile=${journey.profileId}` +
        `&reviewStore=google_play&reviewRun=${clusteredId}`,
    );
    await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review themes' })).toBeVisible();
    await expect(page.getByText(clustered.run.clusters[0]!.label)).toBeVisible();
    await expect(page.locator('blockquote')).toHaveCount(2);

    const thinProfileResponse = await page.request.post(
      `/api/sites/${journey.siteId}/apps/profiles`,
      {
        data: { playPackageId: 'com.rankme.thin.evidence', paired: false },
        headers: await csrfHeaders(page.request),
      },
    );
    expect(thinProfileResponse.status()).toBe(201);
    const thinProfileId = ((await thinProfileResponse.json()) as {
      profile?: { id?: string };
    }).profile?.id;
    expect(thinProfileId).toMatch(/^[0-9a-f]{24}$/u);
    const thinStart = await csrfPostJson<{ run: { id: string } }>(
      page.request,
      `${root}/runs`,
      { profileId: thinProfileId, store: 'google_play', confirm: true },
      202,
    );
    const thin = await waitForJson<{ run: ReviewRun }>(
      page.request,
      `${root}/runs/${thinStart.run.id}`,
      (body) => body.run.status === 'completed',
      'thin-evidence review run completes without an AI cluster',
    );
    expect(thin.run).toMatchObject({ reviewCount: 3, clusterState: 'thin_evidence', clusters: [] });

    await page.goto(
      `/sites/${journey.siteId}?tab=apps&view=reviews&profile=${thinProfileId}` +
        '&reviewStore=google_play',
    );
    const thinRow = page.getByRole('row', { name: /Completed 3 2\.67 View/u });
    await thinRow.getByRole('button', { name: 'View' }).click();
    await expect(page).toHaveURL(new RegExp(`reviewRun=${thinStart.run.id}`, 'u'));
    await expect(page.getByText('Not enough evidence to cluster')).toBeVisible();

    setAppSeoUsage(journey.accountId, 'app_review_runs', 10, 10);
    const capped = await csrfPostJson<{ error?: { details?: { metric?: string } } }>(
      page.request,
      `${root}/runs`,
      { profileId: journey.profileId, store: 'google_play', confirm: true },
      402,
    );
    expect(capped.error?.details?.metric).toBe('app_review_runs');

    recreateComposeServices(['api'], { APP_REVIEWS_ENABLED: 'false' });
    await awaitAppSeoApiHealthy(page);
    const disabled = await csrfPostJson<{ error?: { message?: string } }>(
      page.request,
      `${root}/runs`,
      { profileId: journey.profileId, store: 'google_play', confirm: true },
      404,
    );
    expect(disabled.error?.message).toBeTruthy();
    const stored = await page.request.get(`${root}/runs/${clusteredId}`);
    expect(stored.status()).toBe(200);
    expect(((await stored.json()) as { run: ReviewRun }).run.clusterState).toBe('available');
  } finally {
    recreateComposeServices(['api'], inherited);
    await awaitAppSeoApiHealthy(page);
    assertComposeRuntimeParity(inherited);
  }

  setAppSeoUsage(journey.accountId, 'app_review_runs', 2, 10);
  await page.goto(
    `/sites/${journey.siteId}?tab=apps&view=reviews&profile=${journey.profileId}` +
      `&reviewStore=google_play&reviewRun=${clusteredId}`,
  );
  await switchAppSeoToArabic(page);
  await expect(page.getByTestId('app-seo-view-reviews')).toBeVisible();
  await scanAppSeoBothThemes(page, 'App review intelligence Arabic');
  expect(journey.deniedUrls, 'browser egress').toEqual([]);
});
