import { expect, test } from '@playwright/test';

const hydrationPattern =
  /hydration|hydration failed|did not match|server html|text content does not match|minified react error #(418|423|425)|invariant=(418|423|425)/i;

test('hydration locale matches SSR output for public routes', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && hydrationPattern.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (hydrationPattern.test(error.message)) {
      hydrationErrors.push(error.message);
    }
  });

  // The root has no landing page: it redirects to sign-in before any HTML.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(\?|$)/);

  await page.goto('/docs');
  await expect(page.locator('#public-main h1').first()).toBeVisible();
  await page.context().addCookies([{ name: 'lang', value: 'fr', url: page.url() }]);
  await page.goto('/docs/getting-started');
  await expect(page.locator('#public-main h1').first()).toBeVisible();
  expect(hydrationErrors).toEqual([]);

  await page.goto('/fr/docs');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#public-main h1').first()).toBeVisible();
  expect(hydrationErrors).toEqual([]);

  await page.goto('/ar/docs');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(hydrationErrors).toEqual([]);

  // An unknown docs slug is server-rendered as a real 404 and must hydrate
  // cleanly.
  const missingDoc = await page.goto('/docs/nope');
  expect(missingDoc?.status()).toBe(404);
  await expect(page.locator('#public-main h1').first()).toHaveText('Guide not found');
  expect(hydrationErrors).toEqual([]);

  // Every non-docs path is the CSR shell (HTTP 200, nothing to hydrate); the
  // client router paints the shared NotFound without hydration noise.
  const missing = await page.goto('/pricing');
  expect(missing?.status()).toBe(200);
  await expect(page.locator('[data-slot="empty-title"]')).toHaveText('Page not found');
  expect(hydrationErrors).toEqual([]);
});

test('CSP allows same-origin API fetches and exposes connect-src', async ({ page }) => {
  const response = await page.goto('/docs');
  expect(response?.headers()['content-security-policy']).toContain('connect-src');

  const apiOk = await page.evaluate(async () => {
    const health = await fetch('/api/health');
    return health.ok;
  });
  expect(apiOk).toBe(true);
});

test('proxied JSON compresses when gzip is accepted', async ({ page }) => {
  const response = await page.request.get('/api/health', {
    headers: { 'accept-encoding': 'gzip' },
  });

  expect(response.ok()).toBe(true);
  expect(response.headers()['content-encoding']).toContain('gzip');
});

test('captures the public docs shell in light and dark mode', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'light');
  });
  await page.goto('/docs');
  const main = page.locator('#public-main');
  await expect(main).toBeVisible();
  await main.screenshot({
    path: testInfo.outputPath('ssr-docs-light.png'),
  });

  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.reload();
  await expect(main).toBeVisible();
  await main.screenshot({
    path: testInfo.outputPath('ssr-docs-dark.png'),
  });
});
