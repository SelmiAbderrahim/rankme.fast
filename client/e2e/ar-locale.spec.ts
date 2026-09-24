/**
 * Locale smoke. Repeats the report-screen step under `ar` and
 * asserts the RTL direction attribute + tab order. Detection happens client
 * side (i18next language detector, browser locale `ar`) — no query param.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { freshAccount, logIn, signUp } from './helpers/account';
import { runComposeApiScript, runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import {
  E2E_RECOMMENDATION_ANALYSIS_ID,
  mockRecommendationAnalysis,
} from './helpers/content-intelligence';

interface SessionResponse {
  user?: { id?: string };
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionResponse).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

function promoteForSweep(id: string): void {
  runComposePsql(
    `UPDATE "user"
        SET role = 'SuperAdmin',
            two_factor_enabled = true,
            email_verified = true,
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

function localeSideEffectFingerprint(id: string): string {
  return runComposePsqlOutput(
    `SELECT concat(
       coalesce((SELECT sum(used) FROM usage_counters WHERE account_id = :'account_id'), 0),
       '|',
       (SELECT count(*) FROM vendor_responses WHERE account_id = :'account_id')
     );`,
    { variables: { account_id: id } },
  );
}

function grantContentIntelligence(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'starter', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'starter',
                       status = 'active',
                       updated_at = now();`,
    { variables: { account_id: id } },
  );
}

async function createSite(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sites', {
    data: {
      url: 'https://rtl-usability.example',
      label: 'Arabic usability sweep',
    },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { site: { id: string } }).site.id;
}

test('ar (RTL) report screen renders with dir=rtl', async ({ page }) => {
  const account = freshAccount('ar');
  await signUp(page, account);
  grantContentIntelligence(await accountId(page.request));

  await page.goto('/sites');
  await page.getByLabel(/url|رابط/i).fill('https://example.com');
  await page.getByRole('button', { name: /add site|إضافة/i }).click();

  // Navigation lives in the per-row ⋯ menu. Select the action by its
  // accessible name in either test locale; menu order is not an API.
  const dataRow = page.getByRole('row').nth(1);
  await dataRow.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /view report|عرض التقرير/i }).click();
  // Fresh site → no run yet → "Run your first audit" CTA opens the
  // spend-preview confirmation dialog (locked contract): unit price, fresh-
  // crawl disclosure, and allowance line render before one confirm click
  // starts exactly one run. The preview surfaces must render under `ar` too.
  await page.getByTestId('report-retest').click();
  await expect(page.getByTestId('report-retest-dialog')).toBeVisible();
  await expect(page.getByTestId('retest-preview')).toBeVisible();
  await expect(page.getByTestId('retest-preview-units')).toBeVisible();
  await expect(page.getByTestId('retest-preview-remaining')).toBeVisible();
  await page.getByTestId('report-retest-confirm').click();
  await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 60_000 });

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', /ar/);

  const siteUrl = page.url().split('?')[0];
  await page.goto(`${siteUrl}?tab=content&view=analyses`);
  await expect(page.getByTestId('content-intelligence-panel')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const siteId = siteUrl.split('/').at(-1) ?? '';
  await mockRecommendationAnalysis(page, siteId, 'ar');
  await page.goto(
    `${siteUrl}?tab=content&view=analyses&analysis=${E2E_RECOMMENDATION_ANALYSIS_ID}`,
  );
  await expect(page.getByTestId('recommendation-workflow')).toBeVisible();
  await expect(page.getByRole('button', { name: /تحديد كمطبقة|mark applied/i })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Audience-research workspace loads under `ar` with the same
  // RTL guarantees the rest of the shell honors. Deep-linking directly into
  // `?tab=audience-research` should render the panel without an English
  // fallback string.
  await page.goto(`${siteUrl}?tab=audience-research`);
  await expect(page.getByTestId('audience-research-panel')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('Arabic public beta chrome mirrors the layout and keeps Get started above the fold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/ar/docs');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('release-stage-banner')).toBeVisible();
  await expect(page.getByTestId('release-stage-badge').first()).toBeVisible();
  const getStarted = page.getByRole('link', { name: /ابدأ الآن/i }).first();
  await expect(getStarted).toBeInViewport();
  await expect(getStarted).toHaveAttribute('href', /[?&]lng=ar(&|$)/);

  const directions = await page.locator('#public-main').evaluate((main) => ({
    page: document.documentElement.dir,
    main: getComputedStyle(main).direction,
  }));
  expect(directions).toEqual({ page: 'rtl', main: 'rtl' });
});

test('the Arabic locale root redirects to Arabic sign-in', async ({ page }) => {
  await page.goto('/ar');
  await expect(page).toHaveURL(/\/login\?(.*&)?lng=ar(&|$)/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('authenticated locale persists in RTL without vendor or metered work', async ({ page }) => {
  const account = freshAccount('ar-preference');
  await signUp(page, account);
  const id = await accountId(page.request);

  await page.goto('/dashboard');
  const switcher = page.locator('#language-switcher').first();
  await expect(switcher).toBeVisible();

  // Establish a non-RTL stored value so this journey proves an authenticated
  // overwrite, not merely detector initialization from Playwright's locale.
  if ((await switcher.inputValue()) !== 'fr') {
    const establishRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === '/api/users/preferences/language',
    );
    const establishResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === '/api/users/preferences/language',
    );
    await switcher.selectOption('fr');
    expect((await establishRequestPromise).headers()['x-lang']).toBe('fr');
    expect((await establishResponsePromise).ok()).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  }

  const before = localeSideEffectFingerprint(id);
  const patchRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === '/api/users/preferences/language',
  );
  await switcher.selectOption('ar');
  const patchRequest = await patchRequestPromise;

  expect(patchRequest.headers()['x-lang']).toBe('ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const preference = await page.request.get('/api/users/preferences/language');
  expect(preference.status()).toBe(200);
  await expect(preference.json()).resolves.toEqual({ language: 'ar' });

  const localizedMissing = await page.request.get('/api/users/000000000000000000000000', {
    headers: { 'x-lang': 'ar' },
  });
  expect(localizedMissing.status()).toBe(404);
  await expect(localizedMissing.json()).resolves.toMatchObject({
    error: { message: 'المستخدم غير موجود.' },
  });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#language-switcher').first()).toHaveValue('ar');

  // Locale persistence is first-party control-plane work: it cannot enqueue
  // or spend. The account's aggregate counters and normalized vendor archive
  // remain byte-for-byte unchanged across the switch and reload.
  expect(localeSideEffectFingerprint(id)).toBe(before);
});

test('public docs surfaces render in Arabic RTL', async ({ page }) => {
  const surfaces = [
    { path: '/ar/docs', marker: 'main' },
    { path: '/ar/docs/getting-started', marker: '#public-main h1' },
  ] as const;

  for (const surface of surfaces) {
    await test.step(surface.path, async () => {
      await page.goto(surface.path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator(surface.marker).first()).toBeVisible({
        timeout: 30_000,
      });
    });
  }
});

test('paid workspaces and operator panels honor Arabic RTL', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const account = freshAccount('ar-usability-sweep');
  await signUp(page, account);
  const id = await accountId(page.request);
  await page.goto('/logout');
  await page.waitForURL('/login');
  await logIn(page, account);
  promoteForSweep(id);
  const siteId = await createSite(page.request);

  const workspaces = [
    {
      path: `/sites/${siteId}/backlinks?tab=history&lng=ar`,
      marker: '[data-testid="link-intelligence-workspace"]',
    },
    {
      path: `/sites/${siteId}?tab=traffic&lng=ar`,
      marker: '[data-testid="traffic-insights-panel"]',
    },
    {
      path: '/keyword-research/live-trends?lng=ar',
      marker: '[data-testid="keyword-live-trends-page"]',
    },
    {
      path: `/sites/${siteId}?tab=reviews&lng=ar`,
      marker: '[data-testid="reviews-panel"]',
    },
    {
      path: `/sites/${siteId}?tab=brand-radar&view=new&lng=ar`,
      marker: '[data-testid="brand-radar-page"]',
    },
  ] as const;

  for (const workspace of workspaces) {
    await test.step(workspace.path, async () => {
      await page.goto(workspace.path);
      if ((await page.locator('html').getAttribute('lang')) !== 'ar') {
        await page.locator('#language-switcher').selectOption('ar');
      }
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator(workspace.marker).first()).toBeVisible({
        timeout: 30_000,
      });
    });
  }

  for (const section of ['overview', 'providers', 'costs', 'quality', 'queues', 'monitors']) {
    await test.step(`superadmin ${section}`, async () => {
      await page.goto(`/superadmin?tab=intelligence&intel=${section}&lng=ar`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId(`intelligence-section-${section}`)).toHaveAttribute(
        'data-state',
        'active',
      );
    });
  }
});
