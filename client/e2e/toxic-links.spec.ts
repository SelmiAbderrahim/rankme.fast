/**
 * Toxic-Link Review and Disavow Generator.
 *
 * The journey keeps every production boundary active. It upgrades isolated
 * Better Auth accounts through compose Postgres, primes the shipped backlink
 * vendor archive through the authenticated list endpoint, and selects fake
 * provider failures only with the DNS-valid `scenario-timeout.test` input.
 * No live provider or Google endpoint is reachable from this spec.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string; domain: string };
}

interface StartedRun {
  runId: string;
}

interface ToxicityRun {
  runId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  refunded: boolean;
  retainedCount: number;
  rubricVersion: 'toxicity-rubric-v1';
  sourceKind: 'provider_observation';
  rows: Array<{
    id: string;
    domain: string;
    url: string;
    band: 'clean' | 'watch' | 'toxic';
    rubricVersion: 'toxicity-rubric-v1';
    sourceKind: 'provider_observation';
    rationale: { status: string; text: string | null };
  }>;
}

function recreateToxicityServices(enabled: string): void {
  recreateComposeServices(['api', 'worker'], { TOXIC_LINKS_ENABLED: enabled });
}

async function awaitServicesHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get('/api/health')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [1_000, 2_000] },
    )
    .toBe(200);
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionResponse).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

function bumpToPro(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'pro', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
    { variables: { account_id: id } },
  );
}

function readToxicityUsage(id: string): number {
  return Number(
    runComposePsqlOutput(
      `SELECT COALESCE((
         SELECT used FROM usage_counters
          WHERE account_id = :'account_id'
            AND period = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
            AND metric = 'toxicity_reviews'
       ), 0);`,
      { variables: { account_id: id } },
    ),
  );
}

async function createSite(
  request: APIRequestContext,
  url: string,
  label: string,
): Promise<SiteResponse['site']> {
  const response = await request.post('/api/sites', {
    data: { url, label },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as SiteResponse).site;
}

async function primeBacklinkArchive(request: APIRequestContext, siteId: string): Promise<void> {
  const response = await request.get(`/api/sites/${siteId}/backlinks?limit=100`);
  expect(response.status()).toBe(200);
}

async function waitForTerminal(
  request: APIRequestContext,
  runId: string,
  requireRefund = false,
): Promise<ToxicityRun> {
  let latest: ToxicityRun | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/backlinks/toxicity/${runId}`);
        expect(response.status()).toBe(200);
        latest = (await response.json()) as ToxicityRun;
        const terminal = latest.status === 'succeeded' || latest.status === 'failed';
        return terminal && (!requireRefund || latest.refunded);
      },
      { timeout: 45_000, intervals: [100, 250, 500, 1_000] },
    )
    .toBe(true);
  return latest as ToxicityRun;
}

async function startReview(page: Page, assertEnglishDisclosure = true): Promise<string> {
  await page.getByTestId('toxicity-preview-button').click();
  if (assertEnglishDisclosure) {
    await expect(page.getByTestId('toxicity-preview')).toContainText('1 link-review unit');
    await expect(page.getByTestId('toxicity-preview')).toContainText('1,000 rows');
  }
  await expect(page.getByTestId('toxicity-preview')).toContainText('toxicity-reviews-10');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/backlinks/toxicity'),
  );
  await page.getByTestId('toxicity-confirm').click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  return ((await response.json()) as StartedRun).runId;
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  }, theme);
}

async function scanBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(result.violations, `${label}(${theme}): axe violations`).toEqual([]);
  }
  await setTheme(page, 'light');
}

test('toxic links: metering, rubric, rationale, download-only builder, refund, cap, flag, RTL, and axe', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(420_000);
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'TOXIC_LINKS_ENABLED',
    'PROVIDER_AI',
    'PROVIDER_BACKLINK',
    'PROVIDER_SUMMARY',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);
  expect(inheritedRuntime.TOXIC_LINKS_ENABLED).toBe('true');
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  const primary = freshAccount('toxic-links-primary');
  const failure = freshAccount('toxic-links-refund');
  let primaryAccountId = '';
  let primarySiteId = '';
  let primaryRunId = '';

  await awaitServicesHealthy(page);

  try {
    await test.step('preview-cancel is free and keyboard navigation opens the URL-backed tab', async () => {
      await signUp(page, primary);
      primaryAccountId = await accountId(page.request);
      bumpToPro(primaryAccountId);
      await page.goto('/logout');
      await page.waitForURL('/login');
      await logIn(page, primary);
      primarySiteId = (
        await createSite(page.request, 'https://toxic-link-review.example', 'Toxic Link Review')
      ).id;
      await primeBacklinkArchive(page.request, primarySiteId);

      await page.goto(`/sites/${primarySiteId}/backlinks?tab=overview`);
      await page.getByTestId('link-intel-tab-toxicity').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`backlinks\\?tab=toxicity`));

      const before = readToxicityUsage(primaryAccountId);
      await page.getByTestId('toxicity-preview-button').click();
      await expect(page.getByTestId('toxicity-preview')).toContainText('1 link-review unit');
      await expect(page.getByTestId('toxicity-preview')).toContainText('1,000 rows');
      await expect(page.getByTestId('toxicity-preview')).toContainText('toxicity-reviews-10');
      await page.getByTestId('toxicity-cancel').click();
      await expect(page.getByTestId('toxicity-preview')).toHaveCount(0);
      expect(readToxicityUsage(primaryAccountId)).toBe(before);
    });

    await test.step('one review retains clean/watch/toxic bands and a bounded rationale', async () => {
      primaryRunId = await startReview(page);
      const run = await waitForTerminal(page.request, primaryRunId);
      expect(run).toMatchObject({
        status: 'succeeded',
        refunded: false,
        retainedCount: 3,
        rubricVersion: 'toxicity-rubric-v1',
        sourceKind: 'provider_observation',
      });
      expect(
        run.rows.map(({ domain, band, rubricVersion, sourceKind }) => ({
          domain,
          band,
          rubricVersion,
          sourceKind,
        })),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ domain: 'blog.example.net', band: 'toxic' }),
          expect.objectContaining({ domain: 'watch.example.org', band: 'watch' }),
          expect.objectContaining({ domain: 'clean.example.co', band: 'clean' }),
        ]),
      );
      const annotated = run.rows.filter((row) => row.rationale.status === 'annotated');
      expect(annotated).toHaveLength(1);
      expect(annotated[0]?.rationale.text).toContain('stored rubric observations');
      expect(readToxicityUsage(primaryAccountId)).toBe(1);

      await expect(page).toHaveURL(
        new RegExp(`/sites/${primarySiteId}/backlinks\\?tab=toxicity&toxRun=${primaryRunId}`),
      );
      await expect(page.getByTestId('toxicity-table')).toContainText('blog.example.net');
      await expect(page.getByTestId('toxicity-table')).toContainText('watch.example.org');
      await expect(page.getByTestId('toxicity-table')).toContainText('clean.example.co');
      const annotatedRow = page.getByTestId(`toxicity-row-${annotated[0]!.id}`);
      await annotatedRow.getByRole('button', { name: 'Rationale' }).click();
      await expect(annotatedRow).toContainText(annotated[0]!.rationale.text!);
      await scanBothThemes(page, 'toxicity-results');
    });

    await test.step('builder remains download-only and the file matches the pinned grammar', async () => {
      const builder = page.getByTestId('disavow-builder');
      const banner = builder.getByTestId('disavow-review-banner');
      await expect(banner).toContainText('RankMeFast never submits this file');
      await expect(builder.getByTestId('disavow-preview')).toContainText('domain:blog.example.net');
      await expect(builder.getByTestId('disavow-preview')).not.toContainText('watch.example.org');

      await builder
        .getByRole('checkbox', { name: 'Include watch.example.org in the file' })
        .check();
      await builder.getByRole('combobox', { name: 'Scope for watch.example.org' }).click();
      await page.getByRole('option', { name: 'Exact URL' }).click();
      await expect(builder.getByTestId('disavow-preview')).toContainText(
        'https://watch.example.org/resources/rankme',
      );

      await banner.getByRole('button', { name: 'Export or share' }).click();
      const textFormat = page.getByRole('menuitem', { name: 'Text' });
      await expect(textFormat).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await textFormat.click();
      const download = await downloadPromise;
      const path = testInfo.outputPath('backlink-disavow-export.txt');
      await download.saveAs(path);
      const text = readFileSync(path, 'utf8');
      expect(download.suggestedFilename()).toMatch(
        /^rankmefast-backlink-disavow-\d{4}-\d{2}-\d{2}\.txt$/u,
      );
      expect(text).toMatch(
        /^# RankMeFast link review export\n# rubric: toxicity-rubric-v1\n# generated: \d{4}-\d{2}-\d{2}\ndomain:blog\.example\.net\nhttps:\/\/watch\.example\.org\/resources\/rankme\n$/u,
      );
      expect(denials.urls).toEqual([]);
    });

    await test.step('stored reopen is free and the N+1 preview discloses the cap', async () => {
      const before = readToxicityUsage(primaryAccountId);
      await page.reload();
      await expect(page.getByTestId('toxicity-results')).toBeVisible();
      expect(readToxicityUsage(primaryAccountId)).toBe(before);

      await page.getByRole('button', { name: 'Back to new review' }).click();
      await page.getByTestId('toxicity-preview-button').click();
      // The composed gate blanks every outbound credential, so no pack is
      // purchasable even though its product id is configured. The cap must
      // then say so plainly instead of naming a pack slug it cannot sell; the
      // purchasable variant is covered by the client unit suite.
      await expect(page.getByTestId('toxicity-cap')).toContainText(
        'Link-review allowance reached',
      );
      await expect(page.getByTestId('toxicity-cap')).toContainText(
        'This credit pack is not configured for purchase right now.',
      );
      await expect(page.getByTestId('toxicity-confirm')).toBeDisabled();
      expect(readToxicityUsage(primaryAccountId)).toBe(before);
    });

    await test.step('Arabic RTL preserves the stored review and passes axe in both themes', async () => {
      await page.locator('#language-switcher').selectOption('ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.goto(
        `/sites/${primarySiteId}/backlinks?lng=ar&tab=toxicity&toxRun=${primaryRunId}`,
      );
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('toxicity-workspace')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('toxicity-results')).toBeVisible();
      await expect(page.getByTestId('disavow-review-banner')).toBeVisible();
      await scanBothThemes(page, 'toxicity-arabic-rtl');
    });

    await test.step('a provider failure with zero retained rows refunds exactly once', async () => {
      await page.goto('/logout');
      await page.waitForURL('/login');
      await signUp(page, failure);
      const failureAccountId = await accountId(page.request);
      bumpToPro(failureAccountId);
      await page.goto('/logout');
      await page.waitForURL('/login');
      await logIn(page, failure);
      const timeoutSite = await createSite(
        page.request,
        'https://scenario-timeout.test',
        'Provider Refund',
      );
      await primeBacklinkArchive(page.request, timeoutSite.id);
      await page.goto(`/sites/${timeoutSite.id}/backlinks?lng=en&tab=toxicity`);
      const runId = await startReview(page, false);
      const run = await waitForTerminal(page.request, runId, true);
      expect(run).toMatchObject({
        status: 'failed',
        refunded: true,
        retainedCount: 0,
        rubricVersion: 'toxicity-rubric-v1',
        sourceKind: 'provider_observation',
      });
      await page.goto(`/sites/${timeoutSite.id}/backlinks?tab=toxicity&toxRun=${runId}`);
      await expect(page.getByTestId('toxicity-failed')).toContainText(
        /unit was refunded|تمت إعادة الوحدة المحجوزة/u,
      );
      expect(readToxicityUsage(failureAccountId)).toBe(0);
      await scanBothThemes(page, 'toxicity-provider-refund');

      recreateToxicityServices('false');
      await awaitServicesHealthy(page);
      const stored = await page.request.get(`/api/backlinks/toxicity/${runId}`);
      expect(stored.status()).toBe(200);
      await page.goto(`/sites/${timeoutSite.id}/backlinks?tab=toxicity`);
      await page.getByTestId('toxicity-preview-button').click();
      await expect(page.getByTestId('toxicity-disabled')).toBeVisible();
    });
  } finally {
    recreateToxicityServices(inheritedRuntime.TOXIC_LINKS_ENABLED!);
    await awaitServicesHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
