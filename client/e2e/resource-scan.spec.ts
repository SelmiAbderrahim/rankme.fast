/**
 * The resource scan (images, scripts and stylesheets), end to end on the
 * fake providers.
 *
 *  - the audit start dialog offers "Scan images, scripts and styles", ticked
 *    by default, and says when the chosen page limit will be cut to 1,000;
 *  - an audit started with the defaults is stored with the scan on and a
 *    crawl limited to 1,000 pages, and its three resource checks are
 *    evaluated (not "Not evaluated");
 *  - unticking the option starts a run without the scan that may crawl the
 *    full page ceiling, and the resource checks are listed under
 *    "Not evaluated" with the neutral no-scan note;
 *  - 390px x light/dark x en/ar: the dialog option fits and passes axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const RESOURCE_RULES = ['broken-resources', 'oversized-images', 'uncached-static-resources'] as const;
/** Crawl limit of a scanning audit, and the ceiling of one without the scan. */
const SCAN_PAGE_LIMIT = 1_000;
const STRUCTURAL_PAGE_CEILING = 10_000;
const SCAN_LABEL = 'Scan images, scripts and styles';
const CUT_NOTE = 'This audit will crawl at most 1,000 pages. Untick the scan to crawl more.';

interface RunSummary {
  id: string;
  status: string;
  pageCap: number;
  resourceScan: boolean;
}

interface ReportFinding {
  ruleId: string;
  bucket: 'fix-now' | 'watch' | 'passed';
  notEvaluated?: true;
  meta?: Record<string, unknown>;
}

let account: TestAccount | null = null;
let siteId = '';

test.beforeEach(async ({ page }, info) => {
  if (account && !info.title.startsWith('setup:')) await logIn(page, account);
});

async function latestRun(request: APIRequestContext): Promise<RunSummary> {
  const response = await request.get(`/api/sites/${siteId}/audits?limit=1`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { runs: RunSummary[] };
  expect(body.runs.length).toBeGreaterThan(0);
  return body.runs[0]!;
}

async function awaitSucceeded(request: APIRequestContext, runId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/sites/${siteId}/audits?limit=1`);
        if (response.status() !== 200) return `http-${response.status()}`;
        const body = (await response.json()) as { runs: Array<{ id: string; status: string }> };
        return body.runs.find((run) => run.id === runId)?.status ?? 'missing';
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 4_000] },
    )
    .toBe('succeeded');
}

async function findingsOf(request: APIRequestContext, runId: string): Promise<ReportFinding[]> {
  const response = await request.get(`/api/audits/${runId}/report`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { findings: ReportFinding[] }).findings;
}

async function openReport(page: Page, query = 'bucket=fix-now'): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=report&${query}`);
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
}

/** Opens the start dialog of a site that has no audit yet, or the retest dialog. */
async function openStartDialog(page: Page): Promise<void> {
  await page.getByTestId('report-retest').click();
  await expect(page.getByTestId('report-retest-dialog')).toBeVisible();
}

async function choosePageLimit(page: Page, name: string): Promise<void> {
  await page.getByTestId('report-page-cap').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('setup: an account with a site that has not been audited yet', async ({ page }) => {
  test.setTimeout(120_000);
  account = freshAccount('resource-scan');
  await signUp(page, account);
  const created = await page.request.post('/api/sites', {
    data: { url: 'https://example.com', label: 'Resource scan proof' },
    headers: await csrfHeaders(page.request),
  });
  expect(created.status()).toBe(201);
  siteId = ((await created.json()) as { site: { id: string } }).site.id;
});

test('the start dialog ticks the scan by default and warns when the page limit will be cut', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/sites/${siteId}?tab=report`);
  await expect(page.getByTestId('report-no-run')).toBeVisible({ timeout: 30_000 });
  await openStartDialog(page);
  const option = page.getByTestId('report-resource-scan');
  await expect(option).toBeChecked();
  await expect(page.getByLabel(SCAN_LABEL)).toBeChecked();
  // The default page limit is the maximum, which a scanning audit cuts to 1,000.
  const note = page.getByTestId('report-resource-scan-note');
  await expect(note).toHaveText(CUT_NOTE);
  await choosePageLimit(page, '500 pages');
  await expect(note).toHaveCount(0);
  await choosePageLimit(page, '1000 pages');
  await expect(note).toHaveCount(0);
  await choosePageLimit(page, 'Maximum allowed');
  await expect(note).toHaveText(CUT_NOTE);
  // Unticking removes the warning: without the scan the full limit is crawled.
  await option.click();
  await expect(option).not.toBeChecked();
  await expect(note).toHaveCount(0);
  await option.click();
  await expect(option).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible();
});

test('an audit started with the defaults scans resources and crawls at most 1,000 pages', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(`/sites/${siteId}?tab=report`);
  await expect(page.getByTestId('report-no-run')).toBeVisible({ timeout: 30_000 });
  await openStartDialog(page);
  await page.getByTestId('report-retest-confirm').click();
  await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({ timeout: 30_000 });

  await expect
    .poll(async () => (await latestRun(page.request)).status, {
      timeout: 240_000,
      intervals: [1_000, 2_000, 4_000],
    })
    .toBe('succeeded');
  const run = await latestRun(page.request);
  expect(run).toMatchObject({ resourceScan: true, pageCap: SCAN_PAGE_LIMIT });

  const findings = await findingsOf(page.request, run.id);
  for (const ruleId of RESOURCE_RULES) {
    const finding = findings.find((entry) => entry.ruleId === ruleId);
    expect(finding, ruleId).toBeDefined();
    expect(finding!.notEvaluated, `${ruleId} is evaluated`).toBeUndefined();
    expect(['fix-now', 'watch'], ruleId).toContain(finding!.bucket);
  }
  expect(findings.find((entry) => entry.ruleId === 'broken-resources')!.bucket).toBe('fix-now');

  await openReport(page);
  await expect(
    page.locator('[data-testid="report-issue-row"][data-rule-id="broken-resources"]'),
  ).toBeVisible();
  await expect(page.getByTestId('report-scan-off')).toHaveCount(0);
});

test('a larger page limit is still cut to 1,000 pages while the scan is on', async ({ page }) => {
  test.setTimeout(300_000);
  const started = await page.request.post(`/api/sites/${siteId}/audits`, {
    data: { requestedPageCap: 5_000, resourceScan: true },
    headers: await csrfHeaders(page.request),
  });
  expect(started.status()).toBe(202);
  const run = ((await started.json()) as { run: RunSummary }).run;
  expect(run).toMatchObject({ resourceScan: true, pageCap: SCAN_PAGE_LIMIT });
  await awaitSucceeded(page.request, run.id);
});

test('unticking the scan starts a run without it that may crawl the full ceiling', async ({ page }) => {
  test.setTimeout(300_000);
  await openReport(page);
  const previousRunId = (await latestRun(page.request)).id;
  await openStartDialog(page);
  await page.getByTestId('report-resource-scan').click();
  await expect(page.getByTestId('report-resource-scan')).not.toBeChecked();
  await page.getByTestId('report-retest-confirm').click();
  await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({ timeout: 30_000 });

  await expect
    .poll(
      async () => {
        const latest = await latestRun(page.request);
        return latest.id === previousRunId ? 'previous' : latest.status;
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 4_000] },
    )
    .toBe('succeeded');
  const run = await latestRun(page.request);
  expect(run).toMatchObject({ resourceScan: false, pageCap: STRUCTURAL_PAGE_CEILING });

  const findings = await findingsOf(page.request, run.id);
  for (const ruleId of RESOURCE_RULES) {
    expect(findings.find((entry) => entry.ruleId === ruleId), ruleId).toMatchObject({
      notEvaluated: true,
      meta: { reason: 'scan-off' },
    });
  }
});

test('the report explains that a run without the scan skipped the resource checks', async ({ page }) => {
  test.setTimeout(120_000);
  await openReport(page);
  const note = page.getByTestId('report-scan-off').first();
  await expect(note).toBeVisible();
  await expect(note).toContainText('This audit ran without the image, script and style scan.');
  await expect(
    page.locator('[data-testid="report-issue-row"][data-rule-id="broken-resources"]'),
  ).toHaveCount(0);
});

test('an explicit opt-out through the API stores a run without the scan', async ({ page }) => {
  test.setTimeout(300_000);
  const started = await page.request.post(`/api/sites/${siteId}/audits`, {
    data: { resourceScan: false },
    headers: await csrfHeaders(page.request),
  });
  expect(started.status()).toBe(202);
  const run = ((await started.json()) as { run: RunSummary }).run;
  expect(run).toMatchObject({ resourceScan: false, pageCap: STRUCTURAL_PAGE_CEILING });
  await awaitSucceeded(page.request, run.id);
  const invalid = await page.request.post(`/api/sites/${siteId}/audits`, {
    data: { resourceScan: 'yes' },
    headers: await csrfHeaders(page.request),
  });
  expect(invalid.status()).toBe(400);
});

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

async function matrixContext(browser: Browser, locale: 'en' | 'ar') {
  const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await logIn(page, account!);
  return { context, page };
}

test('390px x light/dark x en/ar: the scan option fits and passes axe', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const locale of ['en', 'ar'] as const) {
    const { context, page } = await matrixContext(browser, locale);
    try {
      await openReport(page);
      await openStartDialog(page);
      await expect(page.getByTestId('report-resource-scan')).toBeChecked();
      await expect(page.getByTestId('report-resource-scan-note')).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await expectNoSidewaysScroll(page);
        const result = await new AxeBuilder({ page })
          .include('[data-testid="report-retest-dialog"]')
          .withTags(WCAG_TAGS)
          .analyze();
        expect(result.violations, `${locale}/${theme}: axe violations`).toEqual([]);
      }
    } finally {
      await context.close();
    }
  }
});
