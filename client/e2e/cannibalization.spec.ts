/**
 * GSC keyword cannibalization composed-stack
 * journey.
 *
 * Proof shape:
 *   - the account links the composed stack's fake GSC adapter through the
 *     shipped connection endpoint, then the shipped refresh endpoint runs the
 *     real GSC collector + Postgres writer; those persisted `query,page` rows
 *     drive a report with candidates, confidence, per-page split metrics, and
 *     the deterministic primary-page recommendation;
 *   - a site with no stored `query,page` rows renders the honest
 *     "waiting for the next sync" state — never a live Google fetch;
 *   - the previewed unit is disclosed BEFORE the paid confirm, and the N+1
 *     request lands on the localized cap state;
 *   - re-opening a stored report is free (the meter does not move);
 *   - with `CANNIBALIZATION_ENABLED=false` the new-report entry point answers
 *     the shipped localized 503 while stored reads stay open (proved against
 *     an api ACTUALLY booted with the flag off, then restored);
 *   - Arabic RTL journey plus axe scans in light and dark.
 *
 * The `finally` block restores the inherited flag on api + worker and checks
 * their runtime parity, even when an assertion or health wait fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { csrfHeaders } from './helpers/csrf';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Localized (en) `cannibalization.errors.productUnavailable`. */
const UNAVAILABLE_MESSAGE =
  'Cannibalization reports are temporarily unavailable. Please try again later.';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SPLIT_QUERY = 'seo audit tool';
const PRIMARY_PAGE = 'https://example.com/seo-audit';
const SECOND_PAGE = 'https://example.com/blog/seo-audit-guide';
/** Starter base cap for `cannibalization_reports`. */
const STARTER_CAP = 4;

async function scan(page: Page, label: string): Promise<void> {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important;animation-delay:0s!important}',
  });
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
}

function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { CANNIBALIZATION_ENABLED: value });
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get('/api/health');
          return res.status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(200);
}

/**
 * Add one site through the shipped form. Targets the stable field id and the
 * form's own submit button rather than localized text — the second call runs
 * with a populated sites table, where a text-matched button locator would be
 * ambiguous.
 */
async function addSite(page: Page, url: string): Promise<string> {
  await page.goto('/sites');
  await page.locator('#site-url').fill(url);
  await page.locator('form button[type="submit"]').click();
  const domain = new URL(url).hostname;
  await page.getByRole('link', { name: domain, exact: true }).first().click();
  await page.waitForURL(/\/sites\/[a-f0-9-]+/i, { timeout: 30_000 });
  const current = page.url().split('?')[0] ?? page.url();
  return current.split('/').pop() ?? '';
}

async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('cannibalization spec: no session user id');
  return body.user.id;
}

/** Starter tier: `cannibalization_reports` cap 4, so the N+1 lands quickly. */
function seedStarterTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'starter', 'active')
     ON CONFLICT (account_id) DO UPDATE SET tier = 'starter', status = 'active';`,
    { variables: { accountId } },
  );
}

/**
 * Link the deterministic fake GSC adapter through the same completion route
 * used after OAuth. Body credentials are accepted only when PROVIDER_GSC=fake
 * (or NODE_ENV=test); a live-provider boot ignores them and this journey fails
 * closed because no Better Auth Google row exists.
 */
async function linkFakeGsc(
  page: Page,
  email: string,
  siteId: string,
): Promise<void> {
  const response = await page.request.post(
    `/api/sites/${encodeURIComponent(siteId)}/google/connect/complete`,
    {
    data: {
      refreshToken: 'fake-gsc-refresh-token',
      googleAccountEmail: email,
      scopes: [GSC_SCOPE],
    },
    headers: await csrfHeaders(page.request),
    failOnStatusCode: false,
    },
  );
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    configuration?: { connection?: { status?: string } };
  };
  expect(body.configuration?.connection).toMatchObject({ status: 'connected' });

  const binding = await page.request.patch(
    `/api/sites/${encodeURIComponent(siteId)}/google/bindings`,
    {
      data: { gscPropertyUrl: 'sc-domain:example.com' },
      headers: await csrfHeaders(page.request),
      failOnStatusCode: false,
    },
  );
  expect(binding.status()).toBe(200);
  expect(await binding.json()).toMatchObject({
    configuration: { gsc: { propertyUrl: 'sc-domain:example.com' } },
  });
}

/** Run the shipped fake-provider collector and return its actual snapshot date. */
async function syncFakeGsc(page: Page, siteId: string): Promise<string> {
  const response = await page.request.post(
    `/api/sites/${encodeURIComponent(siteId)}/google/search-refresh`,
    {
      data: { range: '28d' },
      headers: await csrfHeaders(page.request),
      failOnStatusCode: false,
    },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { summary?: { asOf?: string } };
  const snapshotDate = body.summary?.asOf ?? '';
  expect(snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  return snapshotDate;
}

/**
 * Pre-spend the account down to its last report so the N+1 refusal is reached
 * in two generations instead of five. The shipped named per-account rate
 * bucket (`cannibalization`, 10 mutations/min) would otherwise 429 before the
 * cap could answer, and a 429 is not the state under test. The router-level
 * N+1 -> 402 invariant is additionally covered by
 * `server/src/modules/cannibalization/cannibalization.routes.test.ts`.
 */
function seedUsedReports(accountId: string, used: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'cannibalization_reports', :'used'::bigint, 4)
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint;`,
    { variables: { accountId, used } },
  );
}

function usedReports(accountId: string): string {
  return runComposePsqlOutput(
    `SELECT coalesce(max(used), 0) FROM usage_counters
     WHERE account_id = :'accountId' AND metric = 'cannibalization_reports';`,
    { variables: { accountId } },
  ).trim();
}

async function previewAndGenerate(page: Page, siteId: string): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=cannibalization&view=new`);
  await page.getByTestId('cannibalization-preview-button').click();
  await expect(page.getByTestId('cannibalization-preview')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('cannibalization-generate-button').click();
}

test('cannibalization: stored-row report, honest states, cap, free reopen, flag-off, RTL, axe', async ({
  page,
}) => {
  // Multi-step composed-stack journey (signup, fake-GSC link + sync, two
  // sites, three generations, one api recreate pair) on a shared gate host.
  // Retries stay 0.
  test.setTimeout(420_000);
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'CANNIBALIZATION_ENABLED',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('cannibalization');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  seedStarterTier(accountId);

  const siteId = await addSite(page, 'https://example.com');
  const emptySiteId = await addSite(page, 'https://empty.example.com');
  await linkFakeGsc(page, account.email, siteId);
  await linkFakeGsc(page, account.email, emptySiteId);
  const syncedSnapshotDate = await syncFakeGsc(page, siteId);

  let firstReportId = '';
  let splitCandidateId = '';

  try {
    await test.step('a site with no stored query,page rows waits for the next sync', async () => {
      await page.goto(`/sites/${emptySiteId}?tab=cannibalization&view=new`);
      await page.getByTestId('cannibalization-preview-button').click();
      await expect(page.getByTestId('cannibalization-preview')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId('cannibalization-generate-button').click();
      await expect(page.getByTestId('cannibalization-state-awaitingSync')).toBeVisible({
        timeout: 30_000,
      });
      // Nothing was charged for a report that cannot exist.
      expect(usedReports(accountId)).toBe('0');
    });

    await test.step('the previewed unit precedes the paid confirm and yields candidates', async () => {
      await previewAndGenerate(page, siteId);
      await expect(page.getByTestId('cannibalization-candidates')).toBeVisible({
        timeout: 60_000,
      });
      const row = page
        .locator('[data-testid^="cannibalization-candidate-"]')
        .filter({ hasText: SPLIT_QUERY });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(SPLIT_QUERY);
      await expect(row.locator('[data-testid^="cannibalization-confidence-"]')).toContainText(
        'High',
      );
      await expect(row.locator('[data-testid^="cannibalization-primary-"]')).toContainText(
        PRIMARY_PAGE,
      );
      splitCandidateId =
        (await row.getAttribute('data-testid'))?.replace('cannibalization-candidate-', '') ?? '';
      expect(splitCandidateId).not.toBe('');
      // The single-page query is NOT a candidate.
      await expect(page.getByTestId('cannibalization-candidates')).not.toContainText(
        'website health check',
      );
      await expect(page.getByTestId('cannibalization-provenance')).toContainText(
        syncedSnapshotDate,
      );
      expect(usedReports(accountId)).toBe('1');

      const reportUrl = new URL(page.url());
      firstReportId = reportUrl.searchParams.get('report') ?? '';
      expect(firstReportId).not.toBe('');
      await scan(page, 'cannibalization-report(light)');
    });

    await test.step('the query drill-down shows the stored rows and the recommendation', async () => {
      await page.getByTestId(`cannibalization-inspect-${splitCandidateId}`).click();
      const drill = page.getByTestId('cannibalization-drilldown');
      await expect(drill).toBeVisible();
      await expect(page.getByTestId('cannibalization-drilldown-query')).toHaveText(SPLIT_QUERY);
      await expect(drill.getByRole('link', { name: PRIMARY_PAGE })).toBeVisible();
      await expect(drill.getByRole('link', { name: SECOND_PAGE })).toBeVisible();
      await expect(page.getByTestId('cannibalization-drilldown-recommendation')).toContainText(
        'It already earns the most clicks',
      );
      await expect(page).toHaveURL(new RegExp(`query=${splitCandidateId}`));
      await setTheme(page, 'dark');
      await scan(page, 'cannibalization-drilldown(dark)');
      await setTheme(page, 'light');
    });

    await test.step('re-opening a stored report is free', async () => {
      const before = usedReports(accountId);
      await page.goto(`/sites/${siteId}?tab=cannibalization`);
      await page.getByTestId(`cannibalization-open-${firstReportId}`).click();
      await expect(page.getByTestId('cannibalization-candidates')).toBeVisible({
        timeout: 30_000,
      });
      expect(usedReports(accountId)).toBe(before);
    });

    await test.step('the N+1 report lands on the localized cap state', async () => {
      seedUsedReports(accountId, String(STARTER_CAP - 1));
      await previewAndGenerate(page, siteId);
      await expect(page.getByTestId('cannibalization-candidates')).toBeVisible({
        timeout: 60_000,
      });
      expect(usedReports(accountId)).toBe(String(STARTER_CAP));

      await previewAndGenerate(page, siteId);
      await expect(page.getByTestId('cannibalization-state-cap')).toBeVisible({
        timeout: 30_000,
      });
      // The refused request consumed nothing.
      expect(usedReports(accountId)).toBe(String(STARTER_CAP));
    });

    await test.step('Arabic RTL renders the workspace under logical layout', async () => {
      // The shared shell's language switcher is the shipped way to change
      // locale (same switch the brand-radar journey uses).
      await page.goto(`/sites/${siteId}?tab=cannibalization`);
      await page.locator('#language-switcher').selectOption('ar');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar', {
        timeout: 30_000,
      });
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', {
        timeout: 30_000,
      });
      await expect(page.getByRole('heading', { name: 'تنافس الكلمات المفتاحية' })).toBeVisible();
      await scan(page, 'cannibalization-ar(light)');
      await page.locator('#language-switcher').selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', {
        timeout: 30_000,
      });
    });

    await test.step('the kill switch closes new reports and leaves stored reads open', async () => {
      recreateApiWithFlag('false');
      await awaitApiHealthy(page);

      const refused = await page.request.post(`/api/sites/${siteId}/cannibalization-reports`, {
        data: { windowDays: 28 },
        headers: await csrfHeaders(page.request),
        failOnStatusCode: false,
      });
      expect(refused.status()).toBe(503);
      expect(JSON.stringify(await refused.json())).toContain(UNAVAILABLE_MESSAGE);

      await page.goto(`/sites/${siteId}?tab=cannibalization&report=${firstReportId}`);
      await expect(page.getByTestId('cannibalization-candidates')).toBeVisible({
        timeout: 30_000,
      });

      await page.goto(`/sites/${siteId}?tab=cannibalization&view=new`);
      await page.getByTestId('cannibalization-preview-button').click();
      await expect(page.getByTestId('cannibalization-state-disabled')).toBeVisible({
        timeout: 30_000,
      });
    });
  } finally {
    recreateApiWithFlag(inheritedRuntime.CANNIBALIZATION_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
