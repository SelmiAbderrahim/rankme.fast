/**
 * Deep crawl findings in the report and the Pages tab, against the
 * fake-provider audit pipeline.
 *
 *  - the API carries every crawl-check finding with its category, and the
 *    resource checks as not evaluated (`scan-off`) when the audit ran without
 *    the resource scan;
 *  - the report's `?category=` filter narrows the tab and survives a reload;
 *  - a finding shows its evidence (redirect steps, matching pages, page facts);
 *  - the Not-evaluated section shows the neutral no-scan note;
 *  - the Pages inspector lists the issues on one page with its crawl facts;
 *  - 390px x light/dark x en/ar: no sideways scroll and axe passes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface ReportFinding {
  ruleId: string;
  bucket: 'fix-now' | 'watch' | 'passed';
  category?: string | null;
  notEvaluated?: true;
  meta?: Record<string, unknown>;
}

const CRAWL_CHECK_RULES = [
  'http-error-pages',
  'redirect-chains',
  'links-to-redirects',
  'meta-refresh-redirect',
  'canonical-chain-or-conflict',
  'orphan-pages',
  'deep-pages',
  'duplicate-titles',
  'duplicate-content',
  'placeholder-text',
  'mixed-content',
  'images-missing-alt',
  'slow-server-response',
  'large-pages',
  'uncompressed-pages',
  'render-blocking-resources',
  'html-basics-missing',
  'deprecated-html',
  'url-structure',
  'social-tags-missing',
  'favicon-missing',
];
const RESOURCE_RULES = ['broken-resources', 'oversized-images', 'uncached-static-resources'];
const CARE_PAGE = 'https://example.com/guide/care?ref=nav';

let account: TestAccount | null = null;
let siteId = '';
let findings: ReportFinding[] = [];

test.beforeEach(async ({ page }, info) => {
  if (account && !info.title.startsWith('setup:')) await logIn(page, account);
});

async function openReport(page: Page, query: string): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=report&${query}`);
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
}

async function auditWithoutResourceScan(request: APIRequestContext): Promise<string> {
  const started = await request.post(`/api/sites/${siteId}/audits`, {
    data: { resourceScan: false },
    headers: await csrfHeaders(request),
  });
  expect(started.status()).toBe(202);
  const runId = ((await started.json()) as { run?: { id?: string } }).run?.id;
  expect(runId).toMatch(/^[0-9a-f]{24}$/u);
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
  return runId!;
}

test('setup: one finished fake-provider audit without the resource scan', async ({ page }) => {
  test.setTimeout(300_000);
  account = freshAccount('deep-crawl');
  await signUp(page, account);
  const created = await page.request.post('/api/sites', {
    data: { url: 'https://example.com', label: 'Deep crawl proof' },
    headers: await csrfHeaders(page.request),
  });
  expect(created.status()).toBe(201);
  siteId = ((await created.json()) as { site: { id: string } }).site.id;
  const runId = await auditWithoutResourceScan(page.request);
  const res = await page.request.get(`/api/sites/${siteId}/audits/${runId}/report`);
  expect(res.status()).toBe(200);
  findings = ((await res.json()) as { findings: ReportFinding[] }).findings;
});

test('the API carries every crawl-check finding with a category, and the resource checks as scan-off', () => {
  for (const ruleId of CRAWL_CHECK_RULES) {
    const finding = findings.find((entry) => entry.ruleId === ruleId);
    expect(finding, ruleId).toBeDefined();
    expect(['fix-now', 'watch'], ruleId).toContain(finding!.bucket);
    expect(typeof finding!.category, ruleId).toBe('string');
  }
  for (const ruleId of RESOURCE_RULES) {
    expect(findings.find((entry) => entry.ruleId === ruleId)).toMatchObject({
      notEvaluated: true,
      meta: { reason: 'scan-off' },
    });
  }
});

test('the category filter narrows the tab, lives in the URL and survives a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await openReport(page, 'bucket=fix-now');
  await expect(page.locator('[data-testid="report-issue-row"][data-rule-id="placeholder-text"]')).toBeVisible();
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByTestId('report-category-links-redirects').click();
  await expect(page).toHaveURL(/category=links-redirects/);
  await expect(page.locator('[data-testid="report-issue-row"][data-rule-id="http-error-pages"]')).toBeVisible();
  await expect(page.locator('[data-testid="report-issue-row"][data-rule-id="placeholder-text"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('combobox', { name: 'Category' })).toContainText('Links and redirects');
  // Keyboard: the filter is reachable and opens with the keyboard.
  await page.getByRole('combobox', { name: 'Category' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('findings show their evidence: redirect steps, matching pages and page facts', async ({ page }) => {
  test.setTimeout(180_000);
  await openReport(page, 'bucket=fix-now&finding=redirect-chains');
  const chains = page.locator('[data-testid="report-issue-row"][data-rule-id="redirect-chains"]');
  // `?finding=` opens the row.
  await expect(chains.getByTestId('report-evidence-chain').first()).toBeVisible();
  await expect(chains.getByTestId('report-evidence-chain').filter({ hasText: 'Loop' })).toHaveCount(1);

  await openReport(page, 'bucket=watch&finding=duplicate-content');
  const duplicates = page.locator('[data-testid="report-issue-row"][data-rule-id="duplicate-content"]');
  await expect(duplicates.getByTestId('report-evidence-group')).toContainText('Similarity: 8 out of 10');

  await openReport(page, 'bucket=watch&finding=deep-pages');
  const deep = page.locator('[data-testid="report-issue-row"][data-rule-id="deep-pages"]');
  await expect(deep.getByTestId('report-evidence-facts').first()).toContainText('Clicks from home: 6');
});

test('the Not-evaluated section shows the neutral no-scan note', async ({ page }) => {
  test.setTimeout(120_000);
  await openReport(page, 'bucket=fix-now');
  const note = page.getByTestId('report-scan-off').first();
  await expect(note).toBeVisible();
  await expect(note).toContainText('This audit ran without the image, script and style scan.');
});

test('the Pages inspector lists the issues on one page with its crawl facts', async ({ page }) => {
  test.setTimeout(180_000);
  const list = await page.request.get(`/api/sites/${siteId}/pages?range=28d&limit=100`);
  expect(list.status()).toBe(200);
  const items = ((await list.json()) as { items: Array<{ pageId: string; url: string }> }).items;
  const care = items.find((item) => item.url === CARE_PAGE);
  expect(care, 'the care page is in the inventory').toBeDefined();
  await page.goto(`/sites/${siteId}?tab=pages&pageId=${care!.pageId}`);
  const card = page.getByTestId('page-audit-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByTestId('page-audit-facts')).toContainText('Clicks from home');
  await expect(card.getByTestId('page-audit-issue').filter({ hasText: 'Placeholder text on live pages' })).toHaveCount(1);
  await card.getByRole('link', { name: 'Placeholder text on live pages' }).click();
  await expect(page).toHaveURL(/tab=report.*finding=placeholder-text/);
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

test('390px x light/dark x en/ar: the report evidence fits and passes axe', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const locale of ['en', 'ar'] as const) {
    const { context, page } = await matrixContext(browser, locale);
    try {
      await openReport(page, 'bucket=fix-now&category=links-redirects');
      const row = page.locator('[data-testid="report-issue-row"][data-rule-id="redirect-chains"]');
      await row.locator('button[aria-expanded]').first().click();
      await expect(row.getByTestId('report-evidence-chain').first()).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await expectNoSidewaysScroll(page);
        const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(result.violations, `${locale}/${theme}: axe violations`).toEqual([]);
      }
    } finally {
      await context.close();
    }
  }
});
