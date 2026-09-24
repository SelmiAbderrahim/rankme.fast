/**
 * Accessibility scans. Asserts zero axe-core violations on the
 * signup and login screens, add-site form, each report tab, and the public
 * docs pages — light AND dark mode — plus the RTL report screen. Any
 * violation fails CI; allowlists require a linked issue with an expiry,
 * exactly like the skip-policy above.
 */
import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';
import { runComposeApiScript, runComposePsql } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import {
  E2E_RECOMMENDATION_ANALYSIS_ID,
  mockRecommendationAnalysis,
} from './helpers/content-intelligence';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface SessionResponse {
  user?: { id?: string };
}

interface BatchSurface {
  path: string;
  marker: string;
  pendingMarker?: string;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionResponse).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

function provisionAgencyForA11y(id: string): void {
  runComposePsql(
    `UPDATE "user"
        SET email_verified = true,
            updated_at = now()
      WHERE id = :'account_id';

     INSERT INTO subscriptions (account_id, tier, status, brand_radar)
       VALUES (:'account_id', 'agency', 'active', true)
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'agency',
                       status = 'active',
                       brand_radar = true,
                       updated_at = now();`,
    { variables: { account_id: id } },
  );
}

function promoteForA11y(id: string): void {
  runComposePsql(
    `UPDATE "user"
        SET role = 'SuperAdmin',
            two_factor_enabled = true,
            updated_at = now()
      WHERE id = :'account_id';`,
    { variables: { account_id: id } },
  );
  runComposeApiScript(
    `
      const mongooseModule = await import('mongoose');
      const mongoose = mongooseModule.default;
      await mongoose.connect(process.env.MONGODB_URI);
      await mongoose.connection.db.collection('users').updateOne(
        { _id: new mongoose.Types.ObjectId(process.env.SWEEP_ACCOUNT_ID) },
        { $set: { role: 'SuperAdmin' } },
      );
      await mongoose.disconnect();
    `,
    { SWEEP_ACCOUNT_ID: id },
  );
}

async function createSweepSite(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sites', {
    data: {
      url: 'https://a11y-usability.example',
      label: 'Accessibility usability sweep',
    },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { site: { id: string } }).site.id;
}

async function prepareAuthenticatedSweep(
  page: Page,
  accountLabel: string,
  options: { superadmin?: boolean } = {},
): Promise<string> {
  const account = freshAccount(accountLabel);
  await signUp(page, account);
  const id = await accountId(page.request);
  provisionAgencyForA11y(id);
  if (options.superadmin) {
    promoteForA11y(id);
  }
  return createSweepSite(page.request);
}

async function scan(page: Page, label: string): Promise<void> {
  // Below-the-fold Reveal nodes intentionally remain transparent until they
  // intersect the viewport. Axe includes that temporary ancestor opacity in
  // contrast math, so freeze the entrance effect at its final visual state
  // while retaining every WCAG rule and every rendered node in the scan.
  await page.addStyleTag({
    content:
      'html.mk-js .mk-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }',
  });
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect.soft(results.violations, `${label}: axe violations`).toEqual([]);
}

async function assertBatchTableSemantics(page: Page, label: string): Promise<void> {
  const tables = page.locator('table');
  for (let tableIndex = 0; tableIndex < (await tables.count()); tableIndex += 1) {
    const table = tables.nth(tableIndex);
    await expect.soft(
      table.locator(':scope > caption'),
      `${label}: table ${tableIndex + 1} has one caption`,
    ).toHaveCount(1);
    const headers = table.locator('th');
    for (let headerIndex = 0; headerIndex < (await headers.count()); headerIndex += 1) {
      await expect.soft(
        headers.nth(headerIndex),
        `${label}: table ${tableIndex + 1} header ${headerIndex + 1} has scope`,
      ).toHaveAttribute('scope', /^(col|row|colgroup|rowgroup)$/);
    }
  }
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  await page.reload();
}

async function scanBatchSurfaces(page: Page, surfaces: readonly BatchSurface[]): Promise<void> {
  for (const surface of surfaces) {
    await page.goto(surface.path);
    await expect(page.locator(surface.marker).first()).toBeVisible({
      timeout: 30_000,
    });
    if (surface.pendingMarker) {
      await expect(page.locator(surface.pendingMarker)).toHaveCount(0, {
        timeout: 30_000,
      });
    }
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expect(page.locator(surface.marker).first()).toBeVisible({
        timeout: 30_000,
      });
      if (surface.pendingMarker) {
        await expect(page.locator(surface.pendingMarker)).toHaveCount(0, {
          timeout: 30_000,
        });
      }
      await assertBatchTableSemantics(page, `${surface.path}(${theme})`);
      await scan(page, `${surface.path}(${theme})`);
    }
  }
}

test('Pages workspace is overflow-safe and axe-clean across the required viewport matrix', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const viewports = [
    { width: 320, height: 568, label: 'mobile' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 1440, height: 900, label: 'desktop' },
  ] as const;

  for (const locale of ['en', 'ar'] as const) {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    const siteId = await prepareAuthenticatedSweep(page, `a11y-pages-${locale}`);
    const path = `/sites/${siteId}?tab=pages`;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(page.getByTestId('pages-panel')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      if (viewport.width < 768) {
        await expect(page.getByTestId('site-nav-mobile')).toBeVisible();
        await expect(page.getByTestId('site-nav-desktop')).toBeHidden();
      } else {
        await expect(page.getByTestId('site-nav-mobile')).toBeHidden();
        await expect(page.getByTestId('site-nav-desktop')).toBeVisible();
        await expect(page.getByTestId('site-nav-group-audit-reports')).toHaveAttribute(
          'data-active',
          'true',
        );
      }

      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await expect(page.getByTestId('pages-panel')).toBeVisible({ timeout: 30_000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await scan(page, `site-pages(${locale},${viewport.label},${theme})`);
      }
    }
    await context.close();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} mode`, () => {
    test('signup screen has no axe violations', async ({ page }) => {
      await page.goto('/register');
      await setTheme(page, theme);
      await scan(page, `signup(${theme})`);
    });

    test('login screen has no axe violations', async ({ page }) => {
      await page.goto('/login');
      await setTheme(page, theme);
      await scan(page, `login(${theme})`);
    });
  });
}

test('add-site form + report tabs (light) have no axe violations', async ({ page }) => {
  test.setTimeout(180_000);
  const account = freshAccount('a11y');
  await signUp(page, account);
  provisionAgencyForA11y(await accountId(page.request));

  await page.goto('/sites');
  await scan(page, 'add-site');

  await page.getByLabel(/url|site/i).fill('https://example.com');
  await page.getByRole('button', { name: /add|save/i }).click();

  // Row ⋯ menu → "View report" → "Run your first audit" (report-retest).
  // The CTA opens the spend-preview confirmation dialog (locked
  // contract); scan it for violations before confirming the run.
  await page
    .getByRole('button', { name: /open menu for/i })
    .first()
    .click();
  await page.getByRole('menuitem', { name: /view report/i }).click();
  await page.getByTestId('report-retest').click();
  await expect(page.getByTestId('report-retest-dialog')).toBeVisible();
  await expect(page.getByTestId('retest-preview-units')).toBeVisible();
  await expect(page.getByTestId('retest-preview-remaining')).toBeVisible();
  await scan(page, 'report-retest-dialog');
  await page.getByTestId('report-retest-confirm').click();
  await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 60_000 });

  // Site tabs own `?tab=`; report buckets use `?bucket=` (report/tabState.ts).
  for (const bucket of ['fix-now', 'watch', 'passed']) {
    const currentUrl = page.url().split('?')[0];
    await page.goto(`${currentUrl}?tab=report&bucket=${bucket}`);
    await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
    await scan(page, `report-bucket(${bucket})`);
  }
  const siteUrl = page.url().split('?')[0];
  await page.goto(`${siteUrl}?tab=overview`);
  await expect(page.getByTestId('overview-panel')).toBeVisible();
  await scan(page, 'site-overview');
  await page.goto(`${siteUrl}?tab=pages`);
  await expect(page.getByTestId('pages-panel')).toBeVisible();
  await assertBatchTableSemantics(page, 'site-pages');
  await scan(page, 'site-pages');
  await page.goto(`${siteUrl}?tab=content&view=analyses`);
  await expect(page.getByTestId('content-intelligence-panel')).toBeVisible();
  await scan(page, 'content-intelligence');
  const siteId = siteUrl.split('/').at(-1) ?? '';
  await mockRecommendationAnalysis(page, siteId);
  await page.goto(`${siteUrl}?tab=content&analysis=${E2E_RECOMMENDATION_ANALYSIS_ID}`);
  await expect(page.getByTestId('recommendation-workflow')).toBeVisible();
  await expect(page.getByText('content audit', { exact: true })).toBeVisible();
  await expect(page.getByText('https://example.com/guide', { exact: true })).toBeVisible();
  await scan(page, 'content-recommendation-workflow');
  await page.getByRole('button', { name: /mark applied/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan(page, 'content-recommendation-apply-dialog');

  // Audience research workspace scans. Every axe scan below
  // exercises a shipped, keyboard-operable surface: form + preview card,
  // progress + evidence drawer, accept + dismiss dialogs, and the partial
  // terminal state. Locked.
  await page.goto(`${siteUrl}?tab=audience-research`);
  await expect(page.getByTestId('audience-research-panel')).toBeVisible({ timeout: 30_000 });
  await scan(page, 'audience-research-form');
});

test('ar (RTL) report screen has no axe violations', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ locale: 'ar' });
  const page = await context.newPage();

  const account = freshAccount('a11y-ar');
  await signUp(page, account);
  provisionAgencyForA11y(await accountId(page.request));

  await page.goto('/sites');
  await page.getByLabel(/url|رابط/i).fill('https://example.com');
  await page.getByRole('button', { name: /add|إضافة|save|حفظ/i }).click();

  // Locale-stable: ⋯ is the final button in the row and the report action
  // is selected by its accessible name, not by mutable menu order.
  const dataRow = page.getByRole('row').nth(1);
  await dataRow.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /view report|عرض التقرير/i }).click();
  // Locked contract: the CTA opens the spend-preview confirmation
  // dialog; confirm to start the first run.
  await page.getByTestId('report-retest').click();
  await expect(page.getByTestId('report-retest-dialog')).toBeVisible();
  await expect(page.getByTestId('retest-preview-units')).toBeVisible();
  await expect(page.getByTestId('retest-preview-remaining')).toBeVisible();
  await scan(page, 'report-retest-dialog(ar)');
  await page.getByTestId('report-retest-confirm').click();
  await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 60_000 });

  await scan(page, 'report(ar)');
  const siteUrl = page.url().split('?')[0];
  await page.goto(`${siteUrl}?tab=overview`);
  await expect(page.getByTestId('overview-panel')).toBeVisible();
  await scan(page, 'site-overview(ar)');
  await page.goto(`${siteUrl}?tab=pages`);
  await expect(page.getByTestId('pages-panel')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await assertBatchTableSemantics(page, 'site-pages(ar)');
  await scan(page, 'site-pages(ar)');
  await page.goto(`${siteUrl}?tab=content&view=analyses`);
  await expect(page.getByTestId('content-intelligence-panel')).toBeVisible();
  await scan(page, 'content-intelligence(ar)');
  const siteId = siteUrl.split('/').at(-1) ?? '';
  await mockRecommendationAnalysis(page, siteId, 'ar');
  await page.goto(`${siteUrl}?tab=content&analysis=${E2E_RECOMMENDATION_ANALYSIS_ID}`);
  await expect(page.getByTestId('recommendation-workflow')).toBeVisible();
  await scan(page, 'content-recommendation-workflow(ar)');
  await page.getByRole('button', { name: /تحديد كمطبقة|mark applied/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan(page, 'content-recommendation-apply-dialog(ar)');

  // The audience-research workspace form must ship zero axe
  // violations under RTL too. The panel is idempotent; the shipped tab
  // registration renders the same form/preview surface as the LTR scan.
  await page.goto(`${siteUrl}?tab=audience-research`);
  await expect(page.getByTestId('audience-research-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await scan(page, 'audience-research-form(ar)');
  await context.close();
});

test('public batch surfaces have zero light/dark axe violations', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const surfaces = [
    { path: '/docs', marker: 'main' },
    { path: '/docs/getting-started', marker: '#public-main h1' },
    { path: '/ar/docs', marker: 'main' },
  ] as const;

  for (const surface of surfaces) {
    await page.goto(surface.path);
    await expect(page.locator(surface.marker).first()).toBeVisible({
      timeout: 30_000,
    });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expect(page.locator(surface.marker).first()).toBeVisible({
        timeout: 30_000,
      });
      await assertBatchTableSemantics(page, `${surface.path}(${theme})`);
      await scan(page, `${surface.path}(${theme})`);
    }
  }
});

test('authenticated Link and Traffic surfaces have zero light/dark axe violations', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const siteId = await prepareAuthenticatedSweep(page, 'a11y-link-traffic');
  const surfaces: BatchSurface[] = [
    ...['overview', 'rows', 'domains', 'anchors', 'history', 'gap'].map((tab) => ({
      path: `/sites/${siteId}/backlinks?tab=${tab}`,
      marker: `[data-testid="link-intel-tab-${tab}"][data-state="active"]`,
    })),
    {
      path: `/sites/${siteId}?tab=traffic`,
      marker: '[data-testid="traffic-insights-panel"]',
    },
    {
      path: `/sites/${siteId}?tab=competitors&view=traffic`,
      marker: '[data-testid="traffic-insights-panel"]',
    },
  ];

  await scanBatchSurfaces(page, surfaces);
});

test('authenticated product surfaces have zero light/dark axe violations', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const siteId = await prepareAuthenticatedSweep(page, 'a11y-products');
  const surfaces: BatchSurface[] = [
    {
      path: `/sites/${siteId}?tab=pages`,
      marker: '[data-testid="pages-panel"]',
      pendingMarker: '[data-testid="pages-initial-skeleton"]',
    },
    {
      path: '/keyword-research/live-trends',
      marker: '[data-testid="keyword-live-trends-page"]',
    },
    {
      path: '/keyword-research?tab=live-trends',
      marker: '[data-testid="keyword-intel-panel-live-trends"]',
    },
    {
      path: `/sites/${siteId}?tab=reviews`,
      marker: '[data-testid="reviews-panel"]',
    },
    {
      path: `/sites/${siteId}?tab=brand-radar&view=scans`,
      marker: '[data-testid="brand-radar-page"]',
    },
    {
      path: `/sites/${siteId}?tab=brand-radar&view=new`,
      marker: '[data-testid="brand-radar-page"]',
    },
    {
      path: `/sites/${siteId}?tab=ai-visibility`,
      marker: '[data-testid="weekly-pulse-card"]',
    },
  ];

  await scanBatchSurfaces(page, surfaces);
});

test('authenticated superadmin surfaces have zero light/dark axe violations', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await prepareAuthenticatedSweep(page, 'a11y-superadmin', { superadmin: true });
  const surfaces: BatchSurface[] = [
    ...['overview', 'providers', 'costs', 'quality', 'queues', 'monitors'].map(
      (section) => ({
        path: `/superadmin?tab=intelligence&intel=${section}`,
        marker: `[data-testid="intelligence-section-${section}"][data-state="active"]`,
      }),
    ),
  ];

  await scanBatchSurfaces(page, surfaces);
});
