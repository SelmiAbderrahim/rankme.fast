import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { gotoWithStaticAssetNetworkRecovery } from './helpers/navigation';

/**
 * One canonical route scheme and one breadcrumb rule.
 *
 *   account pages    -> /settings/{profile,team,notifications,security}
 *   workspace tools  -> /dashboard, /assistant, /sites, /keyword-research,
 *                       /exports, /dashboard/alerts
 *
 * Legacy paths (/profile, /settings) keep working as redirects that preserve
 * query and hash. Every authenticated page shows "Dashboard > ..."; the
 * Dashboard is its own only, current crumb. One serial account, one shared
 * signed-in page (Better Auth rate-limits credential bursts per IP).
 */
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  const account = freshAccount('route-scheme');
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await signUp(page, account);
}, 120_000);

test.afterAll(async () => {
  await context.close();
});

const breadcrumb = (target: Page) => target.getByRole('navigation', { name: 'Breadcrumb' });

const REDIRECTS = [
  ['/profile', '/settings/profile'],
  ['/profile?tab=api-keys', '/settings/profile?tab=api-keys'],
  ['/settings', '/settings/profile'],
] as const;

for (const [legacy, canonical] of REDIRECTS) {
  test(`legacy ${legacy} redirects to ${canonical}`, async () => {
    await gotoWithStaticAssetNetworkRecovery(page, legacy);
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(canonical);
    // The destination is the real screen inside the app shell, not a 404.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByText('Page not found')).toHaveCount(0);
  });
}

test('a legacy deep link keeps its hash through the redirect', async () => {
  await gotoWithStaticAssetNetworkRecovery(page, '/profile?tab=branding#logo');
  // Branding moved to the workspace settings page; the hash survives the hop.
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/workspace');
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('#logo');
});

const TRAILS = [
  ['/sites', ['Dashboard', 'Sites']],
  ['/assistant', ['Dashboard', 'AI Assistant']],
  ['/keyword-research', ['Dashboard', 'Keyword research']],
  ['/keyword-research/live-trends', ['Dashboard', 'Keyword research', 'Live search interest']],
  ['/keyword-research/history', ['Dashboard', 'Keyword research', 'Research history']],
  ['/dashboard/alerts', ['Dashboard', 'Alerts']],
  ['/exports', ['Dashboard', 'Exports and shares']],
  ['/settings/profile', ['Dashboard', 'Profile']],
  ['/settings/team', ['Dashboard', 'Team']],
  ['/settings/notifications', ['Dashboard', 'Notifications']],
  ['/settings/security', ['Dashboard', 'Security']],
] as const;

for (const [path, trail] of TRAILS) {
  test(`${path} shows the breadcrumb ${trail.join(' > ')}`, async () => {
    await gotoWithStaticAssetNetworkRecovery(page, path);
    const nav = breadcrumb(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('listitem')).toHaveText([...trail]);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    await expect(nav.locator('[aria-current="page"]')).toHaveText(trail[trail.length - 1]!);
  });
}

test('the Dashboard root shows itself as the only, current crumb', async () => {
  await gotoWithStaticAssetNetworkRecovery(page, '/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const nav = breadcrumb(page);
  await expect(nav.getByRole('listitem')).toHaveText(['Dashboard']);
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Dashboard');
  // The current crumb is not a link anywhere (no href back to itself).
  await expect(nav.locator('a[href]')).toHaveCount(0);
});

test('an unknown site id reads "Unknown site", never the raw id', async () => {
  const missingId = '000000000000000000000000';
  await gotoWithStaticAssetNetworkRecovery(page, `/sites/${missingId}`);
  const nav = breadcrumb(page);
  await expect(nav.getByRole('listitem')).toHaveText(['Dashboard', 'Sites', 'Unknown site']);
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Unknown site');
  await expect(nav).not.toContainText(missingId);
  await expect(page.getByTestId('site-not-found')).toBeVisible();
});

test('the sidebar account group links the canonical /settings/* pages', async () => {
  await gotoWithStaticAssetNetworkRecovery(page, '/dashboard');
  const sidebar = page.locator('[data-slot="sidebar-inner"]');
  for (const [name, href] of [
    ['Profile', '/settings/profile'],
    ['Team', '/settings/team'],
    ['Notifications', '/settings/notifications'],
    ['Security', '/settings/security'],
    ['Alerts', '/dashboard/alerts'],
  ] as const) {
    await expect(sidebar.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
});
