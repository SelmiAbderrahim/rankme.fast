import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  gotoWithStaticAssetNetworkRecovery,
  reloadWithStaticAssetNetworkRecovery,
  traverseHistoryWithStaticAssetNetworkRecovery,
} from './helpers/navigation';
import {
  accountIdForEmail,
  bindSiteToGsc,
  clearGoogleConnection,
  keywordUsage,
  seedAuditInventory,
  seedFallbackSnapshots,
  seedGoogleConnection,
  seedGscSnapshots,
  seedGscSyncState,
  setKeywordUsage,
  setProTier,
  type SeedFallbackKeyword,
  type SeedGscPage,
} from './helpers/pages';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PROPERTY = 'sc-domain:pages-gsc.test';

interface Site {
  id: string;
  url: string;
  domain: string;
}

async function createSite(request: APIRequestContext, url: string): Promise<Site> {
  const response = await request.post('/api/sites', {
    data: { url },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { site: Site }).site;
}

async function axe(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
}

async function openSelect(page: Page, label: string, option: string): Promise<void> {
  const trigger = page.getByLabel(label, { exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.press('Enter');
  const choice = page.getByRole('option', { name: option, exact: true });
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(choice).toBeHidden();
}

async function expectNoOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

test('Pages uses stored sources honestly and preserves URL, metering, access, and responsive behavior', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const account = freshAccount('pages');
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  await signUp(page, account);
  const accountId = accountIdForEmail(account.email);
  setProTier(accountId);
  setKeywordUsage(accountId, 0, 100);

  const ready = await createSite(page.request, 'https://ready.pages-gsc.test');
  const empty = await createSite(page.request, 'https://empty.pages-gsc.test');
  const fallback = await createSite(page.request, 'https://fallback.pages-gsc.test');
  const none = await createSite(page.request, 'https://none.pages-gsc.test');

  const hostile = '<img src="https://outside.invalid/pixel" onerror="window.__pagesXss=1">';
  const gscRows: SeedGscPage[] = Array.from({ length: 30 }, (_, index) => ({
    url: `https://ready.pages-gsc.test/guides/${String(index).padStart(2, '0')}-${'long-path-'.repeat(index === 0 ? 16 : 1)}`,
    clicks: index === 0 ? 0 : 20 + index,
    impressions: 200 + index * 10,
    ctr: index === 0 ? 0 : 0.08,
    position: index === 0 ? 5 : 8 + index,
    query: index === 0 ? `${hostile} synthetic query ${'wide '.repeat(30)}` : `synthetic query ${index}`,
  }));
  seedGoogleConnection({ accountId, propertyUrl: PROPERTY });
  bindSiteToGsc({ accountId, siteId: ready.id, propertyUrl: PROPERTY });
  bindSiteToGsc({ accountId, siteId: empty.id, propertyUrl: PROPERTY });
  for (const rangeDays of [7, 28, 90] as const) {
    seedGscSnapshots({ accountId, siteId: ready.id, pages: gscRows, rangeDays });
  }
  seedAuditInventory({
    accountId,
    siteId: ready.id,
    pages: [
      ...gscRows.slice(0, 3).map((row, index) => ({
        url: row.url,
        title: index === 0 ? `${hostile} ${'A very long audit title '.repeat(15)}` : `Measured title ${index}`,
        isIndexable: index !== 1,
        nonIndexableReason: index === 1 ? 'noindex from the latest crawl' : null,
      })),
      { url: 'https://ready.pages-gsc.test/audit-only-indexable', title: 'Audit only page', isIndexable: true },
      { url: 'https://ready.pages-gsc.test/audit-only-hidden', title: 'Excluded audit page', isIndexable: false },
    ],
  });
  const fallbackRows: SeedFallbackKeyword[] = Array.from({ length: 30 }, (_, index) => ({
    url: `https://fallback.pages-gsc.test/library/page-${String(index).padStart(2, '0')}`,
    keyword: index === 0 ? `${hostile} estimated keyword` : `estimated keyword ${index}`,
    position: 4 + index,
    searchVolume: index === 2 ? null : 100 + index * 10,
    difficulty: index === 2 ? null : 30 + index,
    estimatedTraffic: index === 2 ? null : 12 + index,
  }));
  seedFallbackSnapshots({ accountId, siteId: ready.id, rows: fallbackRows.slice(0, 2) });
  seedFallbackSnapshots({ accountId, siteId: fallback.id, rows: fallbackRows, stale: true });
  seedAuditInventory({
    accountId,
    siteId: fallback.id,
    pages: [
      { url: fallbackRows[0]!.url, title: 'Fallback measured page', isIndexable: true },
      { url: 'https://fallback.pages-gsc.test/audit-only', title: 'Fallback audit only', isIndexable: true },
    ],
  });

  await test.step('GSC wins over fallback and direct navigation survives reload', async () => {
    const before = keywordUsage(accountId);
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${ready.id}?tab=pages&limit=50`);
    await expect(page.getByTestId('pages-panel')).toBeVisible();
    await expect(page.getByText('Google Search Console').first()).toBeVisible();
    await expect(page.getByText('Search Console reporting lag: 3 days.')).toBeVisible();
    await expect(page.getByText('Since previous sync').first()).toBeVisible();
    await expect(page.getByTestId('pages-summary')).toContainText('0');
    await expect(page.getByText('Low CTR').first()).toBeVisible();
    await expect(page.getByText('Audit only page').first()).toBeVisible();
    await expect(page.getByText('Excluded audit page')).toHaveCount(0);
    await expect(page.getByText(hostile, { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pagesXss?: number }).__pagesXss)).toBeUndefined();
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page).toHaveURL(new RegExp(`/sites/${ready.id}.*tab=pages`));
    await expect(page.getByText('Google Search Console').first()).toBeVisible();
    expect(keywordUsage(accountId)).toBe(before);
    expect(denials.urls).toEqual([]);
    await axe(page, 'GSC list');
  });

  await test.step('range, search, every filter family, sorting, reset, cursor, and history are URL backed', async () => {
    const before = keywordUsage(accountId);
    await openSelect(page, 'Date range', '7 days');
    await expect(page).toHaveURL(/range=7d/);
    await openSelect(page, 'Date range', '28 days');
    await expect(page).not.toHaveURL(/range=/);
    await openSelect(page, 'Insight', 'Visible but not crawl-indexable');
    await expect(page.getByText('Visible but not crawl-indexable').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.getByLabel('Search pages and queries').fill('Audit only page');
    await expect(page).toHaveURL(/q=Audit(?:%20|\+)only(?:%20|\+)page/);
    await expect(page.getByText('Audit only page').first()).toBeVisible();
    await openSelect(page, 'Insight', 'Unmeasured');
    await expect(page).toHaveURL(/insight=unmeasured/);
    await openSelect(page, 'Crawl indexability', 'Crawl-indexable');
    await expect(page).toHaveURL(/indexability=indexable/);
    await openSelect(page, 'Search visibility', 'Unmeasured');
    await expect(page).toHaveURL(/visibility=unmeasured/);
    await openSelect(page, 'Sort by', 'URL');
    await openSelect(page, 'Direction', 'Descending');
    await openSelect(page, 'Page size', '25 per page');
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page).not.toHaveURL(/(?:q|insight|indexability|visibility)=/);
    const next = page.getByRole('button', { name: 'Next' });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/cursor=/);
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'back', /[?&]tab=pages\b/);
    await expect(page).not.toHaveURL(/cursor=/);
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'forward', /[?&]tab=pages\b/);
    await expect(page).toHaveURL(/cursor=/);
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${ready.id}?tab=pages&cursor=malformed`);
    await expect(page).not.toHaveURL(/cursor=/);
    expect(keywordUsage(accountId)).toBe(before);
  });

  await test.step('detail exposes observed queries, trend, safe strings, and restores keyboard focus', async () => {
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${ready.id}?tab=pages&q=long-path`);
    const inspect = page.getByRole('button', { name: 'Inspect page' }).first();
    await inspect.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pages-detail-sheet')).toBeVisible();
    await expect(page).toHaveURL(/pageId=/);
    await expect(page.getByText('Observed queries')).toBeVisible();
    await expect(page.getByText(hostile, { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('pages-trend-table')).toBeAttached();
    await axe(page, 'GSC detail');
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/pageId=/);
    await expect(inspect).toBeFocused();
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'back', /[?&]tab=pages\b/);
    await expect(page).toHaveURL(/pageId=/);
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'forward', /[?&]tab=pages\b/);
    await expect(page).not.toHaveURL(/pageId=/);
  });

  await test.step('usable empty, syncing, and failed GSC never switch to seeded fallback', async () => {
    seedGscSyncState({ accountId, siteId: empty.id, propertyUrl: PROPERTY, status: 'running' });
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${empty.id}?tab=pages`);
    await expect(page.getByText('Search Console is syncing')).toBeVisible();
    await expect(page.getByText('Demo ranking snapshot')).toHaveCount(0);
    seedGscSyncState({ accountId, siteId: empty.id, propertyUrl: PROPERTY, status: 'empty', snapshotDate: '2026-08-07' });
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByText('No matching pages').first()).toBeVisible();
    await axe(page, 'GSC empty');
    seedGscSyncState({ accountId, siteId: empty.id, propertyUrl: PROPERTY, status: 'failed' });
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByText('Page data is unavailable')).toBeVisible();
    await axe(page, 'GSC unavailable');
  });

  await test.step('fallback discloses estimates, null observed metrics, market, stale data, and metered cache hits', async () => {
    clearGoogleConnection(accountId);
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${fallback.id}?tab=pages`);
    await expect(page.getByText('Demo ranking snapshot').first()).toBeVisible();
    await expect(page.getByText('Showing the last good data')).toBeVisible();
    await expect(page.getByText('Location United States, language English')).toBeVisible();
    await expect(page.getByTestId('pages-summary')).toContainText('Not available');
    await expect(page.getByText('Ranking keywords').first()).toBeVisible();
    await expect(page.getByText('Search volume').first()).toBeVisible();
    await expect(page.getByText('Estimated traffic').first()).toBeVisible();
    await page.getByRole('button', { name: 'Inspect page' }).first().click();
    await expect(
      page
        .getByTestId('pages-detail-sheet')
        .getByRole('term')
        .filter({ hasText: /^Ranking keywords$/u }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await axe(page, 'fallback list');

    const before = keywordUsage(accountId);
    for (const expectedUsed of [before + 1, before + 2]) {
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST' && response.url().endsWith(`/api/sites/${fallback.id}/pages/refresh`),
      );
      await page.getByRole('button', { name: 'Refresh' }).first().click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { refresh: { cache: string; meteredUnits: number } };
      expect(body.refresh.meteredUnits).toBe(1);
      if (expectedUsed === before + 2) expect(body.refresh.cache).toBe('hit');
      await expect.poll(() => keywordUsage(accountId)).toBe(expectedUsed);
    }
  });

  await test.step('reconnect, unmatched-property, no-provider, failed refresh, localized cap, and retry states stay honest', async () => {
    seedGoogleConnection({ accountId, propertyUrl: PROPERTY, status: 'needs_reconnect' });
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${fallback.id}?tab=pages`);
    await expect(page.getByText('The Google connection needs to be reconnected.')).toBeVisible();
    seedGoogleConnection({ accountId, propertyUrl: 'sc-domain:other.test' });
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByText('The selected Search Console property does not cover this site.')).toBeVisible();
    clearGoogleConnection(accountId);
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${none.id}?tab=pages`);
    await expect(page.getByText('No stored source').first()).toBeVisible();
    await axe(page, 'no-provider empty');

    await page.route(`**/api/sites/${fallback.id}/pages/refresh`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'content-language': 'en', vary: 'x-lang, Accept-Language' },
        body: JSON.stringify({ error: { code: 'PAGES_PROVIDER_UNAVAILABLE', message: 'Synthetic retry state.' } }),
      });
    });
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${fallback.id}?tab=pages`);
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(page.getByRole('alert')).toContainText('Synthetic retry state.');
    await expect(page.getByText('Fallback measured page').first()).toBeVisible();
    await axe(page, 'failed refresh with retained data');
    await page.unroute(`**/api/sites/${fallback.id}/pages/refresh`);

    setKeywordUsage(accountId, 100, 100);
    await page.locator('#language-switcher').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${none.id}?tab=pages`);
    await page.getByRole('button', { name: /بيانات|احتياطية/ }).first().click();
    await expect(page.getByRole('alert')).toBeVisible();
    await axe(page, 'Arabic localized cap');
  });

  await test.step('desktop, 320px mobile, dark theme, and Arabic cards preserve information without overflow', async () => {
    setKeywordUsage(accountId, 0, 100);
    await page.locator('#language-switcher').selectOption('en');
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${fallback.id}?tab=pages`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('pages-desktop-table')).toBeVisible();
    await expect(page.getByTestId('pages-mobile-cards')).toBeHidden();
    const desktopRows = await page.getByTestId('pages-desktop-row').count();
    await expectNoOverflow(page);
    await setTheme(page, 'dark');
    await axe(page, 'desktop dark');
    await page.locator('#language-switcher').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByTestId('pages-mobile-cards')).toBeVisible();
    await expect(page.getByTestId('pages-desktop-table')).toBeHidden();
    expect(await page.getByTestId('pages-mobile-card').count()).toBe(desktopRows);
    await expect(page.getByTestId('pages-mobile-cards')).toContainText('غير متاح');
    await expectNoOverflow(page);
    await axe(page, 'mobile Arabic dark');
    expect(denials.urls).toEqual([]);
  });
});
