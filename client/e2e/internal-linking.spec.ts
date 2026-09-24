/**
 * Internal linking composed-stack proof: stored inventory only, paid preview/confirm,
 * evidence, neutralized export, honest stale/cap/flag states, free reopen,
 * Arabic RTL, and axe in light/dark with retries disabled by the gate command.
 */
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposeCommand,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SOURCE_URL = 'https://example.com/blog/technical-seo-guide';
const TARGET_URL = 'https://example.com/services/seo-audit';
const SHARED_QUERY = 'technical seo audit';
const FORMULA_ANCHOR = '=Technical SEO audit checklist';

function objectId(): string {
  return randomBytes(12).toString('hex');
}

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark');
  }, theme);
}

async function addSite(page: Page, url: string): Promise<string> {
  await page.goto('/sites');
  await page.locator('#site-url').fill(url);
  await page.locator('form button[type="submit"]').click();
  const domain = new URL(url).hostname;
  await page.getByRole('link', { name: domain, exact: true }).first().click();
  await page.waitForURL(/\/sites\/[a-f0-9-]+/iu, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
}

async function sessionUserId(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/get-session');
  const body = (await response.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('internal linking e2e: missing session user');
  return body.user.id;
}

function seedProTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'pro', 'active')
     ON CONFLICT (account_id) DO UPDATE SET tier = 'pro', status = 'active';`,
    { variables: { accountId } },
  );
}

function seedUsedRuns(accountId: string, used: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'internal_link_runs', :'used'::bigint, 4)
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint, "limit" = 4;`,
    { variables: { accountId, used } },
  );
}

function usedRuns(accountId: string): string {
  return runComposePsqlOutput(
    `SELECT coalesce(max(used), 0) FROM usage_counters
     WHERE account_id = :'accountId' AND metric = 'internal_link_runs';`,
    { variables: { accountId } },
  ).trim();
}

function seedGscRows(accountId: string, siteId: string): void {
  runComposeMongo(
    `
      db.sites.updateOne(
        { _id: ObjectId(__args.siteId), accountId: ObjectId(__args.accountId) },
        { $set: { gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: 'legacy' } }
      );
    `,
    { accountId, siteId },
  );
  for (const pageUrl of [SOURCE_URL, TARGET_URL]) {
    runComposePsql(
      `INSERT INTO gsc_search_analytics
         (account_id, site_id, snapshot_date, dimension_set, window_days,
          dimension_key, clicks, impressions, ctr, position, binding_generation_id)
       VALUES (:'accountId', :'siteId', CURRENT_DATE, 'query,page', 28,
               :'query' || chr(31) || :'pageUrl', 5, 100, 0.05, 8, 'legacy')
       ON CONFLICT DO NOTHING;`,
      { variables: { accountId, siteId, query: SHARED_QUERY, pageUrl } },
    );
  }
}

function runComposeMongo(js: string, args: Record<string, unknown>): string {
  const wrapped = `const __args = ${JSON.stringify(args)}; ${js}`;
  return runComposeCommand(
    [
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      'mongodb://mongo:27017/rankme',
      '--eval',
      wrapped,
    ],
  )
    .trim();
}

function seedInventory(input: {
  accountId: string;
  siteId: string;
  completedAt: string;
  origin: string;
}): void {
  const runId = objectId();
  const pages = [
    {
      url: SOURCE_URL,
      title: 'Technical SEO audit guide',
      headings: ['Technical SEO audit guide'],
      contentHash: 'e2e-source-hash',
    },
    {
      url: TARGET_URL,
      title: FORMULA_ANCHOR,
      headings: [FORMULA_ANCHOR],
      contentHash: 'e2e-target-hash',
    },
  ];
  runComposeMongo(
    `
      const runId = ObjectId(__args.runId);
      const accountId = ObjectId(__args.accountId);
      const siteId = ObjectId(__args.siteId);
      const completedAt = new Date(__args.completedAt);
      db.contentinventoryruns.insertOne({
        _id: runId,
        accountId,
        ownerUserId: accountId,
        siteId,
        origin: __args.origin,
        locale: 'en',
        status: 'completed',
        input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
        progress: { pagesRequested: 2, pagesProcessed: 2, pagesFailed: 0, blocksReserved: 1, blocksRefunded: 0 },
        reservation: { key: 'e2e-inventory-' + __args.runId, reservedAt: completedAt, reservedUnits: 1, refundedUnits: 0, refundedAt: null, refundReason: null },
        stages: [], warnings: [], error: null,
        inputFingerprint: 'e2e-' + __args.runId,
        idempotencyKey: 'e2e-' + __args.runId,
        requestedAt: completedAt,
        startedAt: completedAt,
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt
      });
      db.contentinventorypages.insertMany(__args.pages.map((page) => ({
        _id: ObjectId(),
        runId,
        accountId,
        siteId,
        url: page.url,
        contentHash: page.contentHash,
        createdAtMs: completedAt.getTime(),
        createdAt: completedAt,
        facts: {
          url: page.url,
          canonical: null,
          statusCode: 200,
          robots: [],
          language: 'en',
          title: page.title,
          description: null,
          headings: page.headings,
          wordCount: 700,
          schemaTypes: [],
          hasSchemaOrgArticle: false,
          internalLinkCount: 0,
          externalLinkCount: 0,
          internalOutLinks: [],
          contentHash: page.contentHash,
          primaryTopics: [],
          secondaryTopics: [],
          targetQueries: [],
          qualityFlags: []
        }
      })));
    `,
    { ...input, runId, pages },
  );
}

function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { INTERNAL_LINKING_ENABLED: value });
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get('/api/health')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(200);
}

test('internal linking: stored inventory, evidence, CSV, cap, free reopen, flag, RTL and axe', async ({
  page,
}, testInfo) => {
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'INTERNAL_LINKING_ENABLED',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);
  test.setTimeout(420_000);
  const account = freshAccount('internal-links');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  seedProTier(accountId);
  seedUsedRuns(accountId, '3');

  const siteId = await addSite(page, 'https://example.com');
  const staleSiteId = await addSite(page, 'https://stale.example.com');
  const freshCompletedAt = new Date(Date.now() - 60_000).toISOString();
  seedInventory({
    accountId,
    siteId,
    completedAt: freshCompletedAt,
    origin: 'https://example.com',
  });
  seedInventory({
    accountId,
    siteId: staleSiteId,
    completedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    origin: 'https://stale.example.com',
  });
  seedGscRows(accountId, siteId);

  let runId = '';
  try {
    await test.step('preview cancellation and stale inventory spend nothing', async () => {
      await page.goto(`/sites/${siteId}?tab=internal-links&view=new`);
      await page.getByTestId('internal-links-preview-button').click();
      await expect(page.getByTestId('internal-links-preview-date')).toContainText(
        freshCompletedAt,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('internal-links-preview')).toContainText('1 internal-link run');
      await page.getByTestId('internal-links-cancel').click();
      await expect(page.getByTestId('internal-links-preview')).toHaveCount(0);
      expect(usedRuns(accountId)).toBe('3');

      await page.goto(`/sites/${staleSiteId}?tab=internal-links&view=new`);
      await page.getByTestId('internal-links-preview-button').click();
      await expect(page.getByTestId('internal-links-state-stale')).toBeVisible();
      await expect(
        page.getByTestId('internal-links-state-stale').getByRole('link'),
      ).toHaveAttribute('href', `/sites/${staleSiteId}?tab=content&view=inventory`);
      expect(usedRuns(accountId)).toBe('3');
    });

    await test.step('a full run shows source, target, anchor, and stored evidence', async () => {
      await page.goto(`/sites/${siteId}?tab=internal-links&view=new`);
      await page.getByTestId('internal-links-preview-button').click();
      const preview = page.getByTestId('internal-links-preview');
      await expect(preview).toBeVisible({ timeout: 30_000 });
      await expect(preview).toContainText('Inventory snapshot');
      await page.getByTestId('internal-links-confirm').click();

      const target = page
        .locator('[data-testid^="internal-links-target-"]')
        .filter({ hasText: TARGET_URL })
        .first();
      await expect(target).toBeVisible({ timeout: 60_000 });
      const card = target.locator(
        'xpath=ancestor::*[starts-with(@data-testid,"internal-links-suggestion-")]',
      );
      await expect(card.locator('[data-testid^="internal-links-source-"]')).toContainText(
        SOURCE_URL,
      );
      await expect(card.locator('[data-testid^="internal-links-anchor-"]')).toContainText(
        FORMULA_ANCHOR,
      );
      await card.getByRole('button', { name: 'Why this pair was suggested' }).click();
      await expect(card).toContainText(SHARED_QUERY);
      await expect(card).toContainText('Target inbound links');
      await expect(page.getByTestId('internal-links-inventory-date')).toBeVisible();
      runId = new URL(page.url()).searchParams.get('run') ?? '';
      expect(runId).toMatch(/^[0-9a-f]{24}$/u);
      expect(usedRuns(accountId)).toBe('4');
      await scan(page, 'internal-links-result(light)');
      await setTheme(page, 'dark');
      await scan(page, 'internal-links-result(dark)');
      await setTheme(page, 'light');
    });

    await test.step('the server CSV neutralizes the formula-like anchor', async () => {
      await page.getByRole('button', { name: 'Export or share' }).click();
      const csvFormat = page.getByRole('menuitem', { name: 'CSV' });
      await expect(csvFormat).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await csvFormat.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(
        /^rankmefast-internal-links-\d{4}-\d{2}-\d{2}\.csv$/u,
      );
      const path = testInfo.outputPath('internal-links-export.csv');
      await download.saveAs(path);
      const csv = await readFile(path, 'utf8');
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain(`'${FORMULA_ANCHOR}`);
      expect(csv).toContain(SHARED_QUERY);
    });

    await test.step('reopening is free and the N+1 request stays at the cap', async () => {
      const before = usedRuns(accountId);
      await page.goto(`/sites/${siteId}?tab=internal-links`);
      await page.getByTestId(`internal-links-open-${runId}`).click();
      await expect(page.getByTestId('internal-links-suggestions')).toBeVisible({ timeout: 30_000 });
      expect(usedRuns(accountId)).toBe(before);

      await page.goto(`/sites/${siteId}?tab=internal-links&view=new`);
      await page.getByTestId('internal-links-preview-button').click();
      await expect(page.getByTestId('internal-links-state-cap')).toBeVisible();
      const refused = await page.request.post(`/api/sites/${siteId}/internal-link-runs`, {
        data: { locale: 'en' },
        headers: await csrfHeaders(page.request),
        failOnStatusCode: false,
      });
      expect(refused.status()).toBe(402);
      expect(JSON.stringify(await refused.json())).toContain('internal_link_runs');
      expect(usedRuns(accountId)).toBe('4');
    });

    await test.step('Arabic uses RTL and keyboard-accessible saved guidance', async () => {
      await page.goto(`/sites/${siteId}?tab=internal-links&run=${runId}`);
      await page.locator('#language-switcher').selectOption('ar');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar', { timeout: 30_000 });
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { name: 'اقتراحات الروابط الداخلية' })).toBeVisible();
      const evidence = page.getByRole('button', { name: 'سبب اقتراح هذا الزوج' }).first();
      await evidence.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('الروابط الواردة إلى الهدف').first()).toBeVisible();
      await scan(page, 'internal-links-ar(light)');
      await page.locator('#language-switcher').selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    });

    await test.step('flag-off blocks new runs but leaves the stored run readable', async () => {
      recreateApiWithFlag('false');
      await awaitApiHealthy(page);
      await page.goto(`/sites/${siteId}?tab=internal-links&run=${runId}`);
      await expect(page.getByTestId('internal-links-suggestions')).toBeVisible({ timeout: 30_000 });
      await page.goto(`/sites/${siteId}?tab=internal-links&view=new`);
      await page.getByTestId('internal-links-preview-button').click();
      await expect(page.getByTestId('internal-links-state-disabled')).toBeVisible({
        timeout: 30_000,
      });
    });
  } finally {
    recreateApiWithFlag(inheritedRuntime.INTERNAL_LINKING_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
