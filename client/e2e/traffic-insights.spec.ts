/**
 * Traffic Insights canonical browser journey.
 *
 * The test uses only production routes and the shipped fake competitor
 * provider. Test-only setup is limited to verified-account tier/counter rows
 * through the isolated compose Postgres service. There are no axe rule
 * exemptions: every scan runs the full WCAG 2 A/AA + 2.1 A/AA tag set.
 */
import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  gotoWithStaticAssetNetworkRecovery,
  reloadWithStaticAssetNetworkRecovery,
} from './helpers/navigation';
import { waitForRunTerminal } from './helpers/waitForRunTerminal';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string; domain: string };
}

interface StartedSnapshot {
  runId: string;
  status: 'queued';
  cached: boolean;
}

interface SnapshotRun {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  refunded: boolean;
  snapshot: unknown | null;
}

interface UsageResponse {
  trafficSnapshots: { used: number; cap: number | null };
}

async function json<T>(response: APIResponse, expectedStatus = 200): Promise<T> {
  expect(response.status()).toBe(expectedStatus);
  return (await response.json()) as T;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const session = await json<SessionResponse>(await request.get('/api/auth/get-session'));
  expect(session.user?.id).toBeTruthy();
  return session.user!.id!;
}

function setTier(id: string, tier: 'none' | 'starter' | 'agency'): void {
  runComposePsql(
    `UPDATE "user"
        SET email_verified = true, updated_at = now()
      WHERE id = :'account_id';

     INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', :'tier', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = EXCLUDED.tier, status = 'active', updated_at = now();`,
    { variables: { account_id: id, tier } },
  );
}

function setTrafficUsage(id: string, used: number, limit: number): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'traffic_snapshots', :'used', :'limit')
       ON CONFLICT (account_id, period, metric)
         DO UPDATE SET used = EXCLUDED.used, "limit" = EXCLUDED."limit", updated_at = now();`,
    {
      variables: {
        account_id: id,
        used: String(used),
        limit: String(limit),
      },
    },
  );
}

async function createSite(
  request: APIRequestContext,
  url: string,
  label: string,
): Promise<SiteResponse['site']> {
  return (
    await json<SiteResponse>(
      await request.post('/api/sites', {
        data: { url, label },
        headers: await csrfHeaders(request),
      }),
      201,
    )
  ).site;
}

async function usage(request: APIRequestContext): Promise<number> {
  // `/api/billing/usage` is the shipped authenticated usage API; the
  // `trafficSnapshots` meter maps directly to `traffic_snapshots`.
  const value = await json<UsageResponse>(await request.get('/api/billing/usage'));
  return value.trafficSnapshots.used;
}

async function startSnapshot(
  request: APIRequestContext,
  targetDomain: string,
  siteId?: string,
): Promise<StartedSnapshot> {
  return json<StartedSnapshot>(
    await request.post('/api/competitors/traffic-snapshots', {
      data: { targetDomain, ...(siteId ? { siteId } : {}) },
      headers: await csrfHeaders(request),
    }),
    202,
  );
}

async function waitForSnapshot(
  request: APIRequestContext,
  runId: string,
): Promise<SnapshotRun> {
  const terminal = await waitForRunTerminal<SnapshotRun>({
    request,
    url: `/api/competitors/traffic-snapshots/${encodeURIComponent(runId)}`,
    terminal: ['succeeded', 'partial', 'failed'],
    options: { deadlineMs: 45_000, intervalMs: 250, label: `traffic snapshot ${runId}` },
  });
  return terminal.body;
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function axe(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function scanBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await axe(page, `${label}(${theme})`);
  }
  await setTheme(page, 'light');
}

async function setLocale(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page.locator('#language-switcher').selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await reloadWithStaticAssetNetworkRecovery(page);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function fillTrafficDomain(page: Page, domain: string): Promise<void> {
  const field = page.locator('#traffic-domain');
  // Clearing first marks the controlled field as operator-edited. Otherwise
  // the late site-domain bootstrap can append to a value entered immediately
  // after navigation (for example `site.exampleexample.com`).
  await field.fill('');
  await field.fill(domain);
}

async function logout(page: Page): Promise<void> {
  await gotoWithStaticAssetNetworkRecovery(page, '/logout');
  await page.waitForURL('/login');
}

async function signUpAtTier(
  page: Page,
  prefix: string,
  tier: 'starter' | 'agency',
): Promise<{ account: TestAccount; id: string }> {
  const account = freshAccount(prefix);
  await signUp(page, account);
  const id = await accountId(page.request);
  await logout(page);
  // Better Auth's post-signup hooks can finish after the first authenticated
  // navigation. Apply the verified/tier fixture after sign-out so no trailing
  // signup write can restore the initial unverified value before re-login.
  setTier(id, tier);
  await logIn(page, account);
  return { account, id };
}

test('Traffic Insights: metering, cache, refund, Agency compare, Arabic RTL, keyboard, and axe', async ({
  page,
  context,
}) => {
  // This serial journey intentionally includes four two-theme axe sweeps,
  // three account lifecycles, and a 16-second client-timeout assertion. Keep
  // one bounded attempt, but leave enough headroom for a loaded Docker CI host.
  test.setTimeout(360_000);
  // The isolated stack is intentionally reusable between local zero-retry
  // runs. Reset only this cross-account cache key so the journey always
  // proves the required fresh -> cached transition for example.com.
  runComposePsql(
    `DELETE FROM vendor_cache
      WHERE capability = 'competitor'
        AND operation = 'traffic'
        AND cache_key = 'example.com';`,
  );
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  let first!: { account: TestAccount; id: string };
  let firstSiteId = '';
  let firstRunId = '';
  let secondId = '';
  let agency!: { account: TestAccount; id: string };
  let agencySiteId = '';
  let agencyRunIds: string[] = [];

  await test.step('Starter lands on ?tab=traffic and the empty list is accessible in both themes', async () => {
    first = await signUpAtTier(page, 'traffic-starter-a', 'starter');
    const site = await createSite(page.request, 'https://starter-traffic.example', 'Traffic site');
    firstSiteId = site.id;
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${site.id}?tab=traffic&lng=en`);
    await expect(page).toHaveURL(/\?tab=traffic/);
    await expect(page.getByTestId('traffic-insights-panel')).toBeVisible();
    await expect(page.getByTestId('traffic-list-empty')).toBeVisible();
    await scanBothThemes(page, 'traffic-list');
  });

  await test.step('keyboard preview discloses one fresh unit and cancel spends nothing', async () => {
    const before = await usage(page.request);
    const domain = page.locator('#traffic-domain');
    // The form seeds the field with the workspace site's own domain until the
    // operator touches it, so typing straight into a focused input would
    // APPEND and produce `starter-traffic.exampleexample.com`. Clear first —
    // the clear also marks the field touched, which stops a late-arriving
    // `initialDomain` from racing the typed value back out.
    await domain.fill('');
    await domain.focus();
    await page.keyboard.type('example.com');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Preview snapshot' })).toBeFocused();
    await page.keyboard.press('Enter');
    const preview = page.getByTestId('traffic-preview');
    await expect(preview).toContainText('1 traffic snapshot unit');
    await expect(preview).toContainText('Fresh lookup');
    await expect(preview).toContainText('Base allowance remaining');
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(preview).toHaveCount(0);
    expect(await usage(page.request)).toBe(before);
  });

  await test.step('confirm succeeds; every stat says Estimate; Arabic mirrors table/chart and numerals', async () => {
    const before = await usage(page.request);
    await page.getByRole('button', { name: 'Preview snapshot' }).focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('button', { name: 'Confirm snapshot' });
    await confirm.focus();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/competitors/traffic-snapshots'),
    );
    await page.keyboard.press('Enter');
    firstRunId = (await json<StartedSnapshot>(await responsePromise, 202)).runId;
    const run = await waitForSnapshot(page.request, firstRunId);
    expect(run.status).toBe('succeeded');
    expect(await usage(page.request)).toBe(before + 1);

    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${firstSiteId}?tab=traffic&lng=ar`);
    await setLocale(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: 'فتح اللقطة' }).click();
    for (const key of ['monthlyVisits', 'rank', 'keywords']) {
      await expect(
        page.getByTestId(`traffic-stat-${key}`).getByText('تقدير', { exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByText('تمت النمذجة من فهرس المزوّد، وليس من بيانات التحليلات.').first()).toBeVisible();
    await expect(page.getByTestId('traffic-stat-monthlyVisits')).toContainText(
      new Intl.NumberFormat('ar').format(12_400),
    );
    const countryHeaders = page.getByTestId('traffic-country-table').getByRole('columnheader');
    const countryBox = await countryHeaders.filter({ hasText: 'البلد' }).boundingBox();
    const visitsBox = await countryHeaders.filter({ hasText: 'الزيارات التقديرية' }).boundingBox();
    expect(countryBox?.x).toBeGreaterThan(visitsBox?.x ?? Number.POSITIVE_INFINITY);
    const historySvg = page.getByTestId('traffic-history-chart').locator('svg');
    await expect(historySvg).toHaveAttribute('data-rtl', 'true');
    const historyXs = await historySvg.locator('circle').evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('cx'))),
    );
    expect(historyXs[0]).toBeGreaterThan(historyXs.at(-1)!);
    await scanBothThemes(page, 'traffic-detail-ar');
  });

  await test.step('a second Starter sees cached preview and cache hits still meter', async () => {
    await logout(page);
    const second = await signUpAtTier(page, 'traffic-starter-b', 'starter');
    secondId = second.id;
    const site = await createSite(page.request, 'https://starter-two.example', 'Second traffic site');
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${site.id}?tab=traffic&lng=en`);
    await setLocale(page, 'en');
    await fillTrafficDomain(page, 'example.com');
    await page.getByRole('button', { name: 'Preview snapshot' }).click();
    await expect(page.getByTestId('traffic-preview')).toContainText('Cached');
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/competitors/traffic-snapshots'),
    );
    await page.getByRole('button', { name: 'Confirm snapshot' }).click();
    const runId = (await json<StartedSnapshot>(await started, 202)).runId;
    expect((await waitForSnapshot(page.request, runId)).status).toBe('succeeded');
    expect(await usage(page.request)).toBe(1);
    await logout(page);
    await logIn(page, first.account);
    expect(await usage(page.request)).toBe(1);
  });

  await test.step('Agency workspace lists two own snapshots and compares their union with keyboard only', async () => {
    await logout(page);
    agency = await signUpAtTier(page, 'traffic-agency', 'agency');
    agencySiteId = (
      await createSite(page.request, 'https://agency-traffic.example', 'Agency traffic site')
    ).id;
    for (const domain of ['example.com', 'rival-one.example']) {
      const started = await startSnapshot(page.request, domain, agencySiteId);
      expect((await waitForSnapshot(page.request, started.runId)).status).toBe('succeeded');
      agencyRunIds.push(started.runId);
    }

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${agencySiteId}?tab=competitors&view=traffic`,
    );
    await expect(page.getByTestId('competitor-view-traffic')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('traffic-insights-panel')).toBeVisible();
    await expect(page.getByText('example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('rival-one.example', { exact: true })).toBeVisible();
    await scanBothThemes(page, 'traffic-agency-mount');

    const checkboxes = page.getByRole('checkbox');
    for (let index = 0; index < 2; index += 1) {
      await checkboxes.nth(index).focus();
      await page.keyboard.press('Space');
    }
    const compare = page.getByRole('button', { name: 'Compare 2 snapshots' });
    await compare.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('traffic-compare-view')).toBeVisible();
    const countrySplit = page.getByRole('table', { name: 'Aligned estimated country split' });
    await expect(countrySplit.getByRole('cell', { name: 'United States', exact: true })).toBeVisible();
    await expect(countrySplit.getByRole('cell', { name: 'Germany', exact: true })).toBeVisible();
    expect(await page.getByText('Estimate', { exact: true }).count()).toBeGreaterThan(2);
    await scanBothThemes(page, 'traffic-compare');

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${agencySiteId}?tab=competitors&view=traffic&ids=${agencyRunIds.join(',')}&lng=ar`,
    );
    await setLocale(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const compareChart = page.getByTestId('traffic-compare-chart').locator('svg[data-rtl]');
    await expect(compareChart).toHaveAttribute('data-rtl', 'true');
    const points = await compareChart.locator('[data-series-id]').first().getAttribute('points');
    const xCoordinates = (points ?? '').split(' ').map((point) => Number(point.split(',')[0]));
    expect(xCoordinates[0]).toBeGreaterThan(xCoordinates.at(-1)!);
    await scanBothThemes(page, 'traffic-compare-ar');
  });

  await test.step('the fake all-fail scenario refunds the reserved unit', async () => {
    const before = await usage(page.request);
    const started = await startSnapshot(page.request, 'error.example', agencySiteId);
    const run = await waitForSnapshot(page.request, started.runId);
    expect(run.status).toBe('failed');
    expect(run.refunded).toBe(true);
    expect(await usage(page.request)).toBe(before);
  });

  await test.step('the fake timeout scenario refunds, then the timeout UI offers a retry', async () => {
    const before = await usage(page.request);
    const timedOut = await startSnapshot(page.request, 'timeout.example', agencySiteId);
    const timedOutRun = await waitForSnapshot(page.request, timedOut.runId);
    expect(timedOutRun.status).toBe('failed');
    expect(timedOutRun.refunded).toBe(true);
    expect(await usage(page.request)).toBe(before);

    await setLocale(page, 'en');
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${agencySiteId}?tab=traffic`);
    await page.route('**/api/competitors/traffic-snapshots/preview', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 16_000));
      // The app's 15s AbortSignal is expected to win. Playwright marks the
      // route handled at that point, so a late abort must be a no-op.
      await route.abort('timedout').catch(() => undefined);
    });
    await fillTrafficDomain(page, 'timeout.example');
    await page.getByRole('button', { name: 'Preview snapshot' }).click();
    await expect(page.getByText('The request took too long')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.unroute('**/api/competitors/traffic-snapshots/preview');
  });

  await test.step('cap and kill-switch surfaces pass axe in light and dark', async () => {
    setTrafficUsage(agency.id, 80, 80);
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${agencySiteId}?tab=traffic`);
    await fillTrafficDomain(page, 'cap.example');
    await page.getByRole('button', { name: 'Preview snapshot' }).click();
    // The composed gate runs with every outbound credential blank, so no pack
    // is purchasable and `creditPackPurchaseAvailable()` is false. The cap
    // surface must then state the allowance honestly and point at Billing
    // instead of quoting a price for a pack this deployment cannot sell. The
    // priced variant is covered by the client unit suite, where availability
    // is stubbed.
    await expect(page.getByTestId('traffic-cap-reached')).toContainText(
      'Snapshot allowance reached',
    );
    await expect(page.getByTestId('traffic-cap-reached')).toContainText(
      'Check Billing for current pack availability.',
    );
    await expect(page.getByTestId('traffic-cap-reached')).not.toContainText('$19.00');
    await scanBothThemes(page, 'traffic-cap-reached');

    setTrafficUsage(agency.id, 2, 80);
    await reloadWithStaticAssetNetworkRecovery(page);
    await page.route('**/api/competitors/traffic-snapshots/preview', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Content-Language': 'en',
          Vary: 'Accept-Language, x-lang',
        },
        body: JSON.stringify({
          error: { message: 'Traffic Insights is temporarily unavailable. Please try again later.' },
        }),
      });
    });
    await fillTrafficDomain(page, 'locked.example');
    await page.getByRole('button', { name: 'Preview snapshot' }).click();
    await expect(page.getByTestId('traffic-kill-switch')).toBeVisible();
    await scanBothThemes(page, 'traffic-kill-switch');
    await page.unroute('**/api/competitors/traffic-snapshots/preview');
  });

  await test.step('A no-plan account can reopen stored data while paid POST returns localized 402 disclosure', async () => {
    await logout(page);
    setTier(first.id, 'none');
    await logIn(page, first.account);
    const stored = await json<SnapshotRun>(
      await page.request.get(`/api/competitors/traffic-snapshots/${firstRunId}`),
    );
    expect(stored.status).toBe('succeeded');
    expect(stored.snapshot).not.toBeNull();

    const blocked = await page.request.post('/api/competitors/traffic-snapshots', {
      data: { targetDomain: 'free-blocked.example' },
      headers: {
        ...(await csrfHeaders(page.request)),
        // x-lang is the shipped explicit override above the persisted lang
        // cookie; Accept-Language is retained as the normal client fallback.
        'x-lang': 'ar',
        'accept-language': 'ar',
      },
    });
    expect(blocked.status()).toBe(402);
    const body = (await blocked.json()) as {
      error: { message: string; details: { metric: string; overageAvailable: boolean } };
    };
    expect(body.error.message).toContain('لقطات');
    expect(body.error.details).toMatchObject({
      metric: 'traffic_snapshots',
      overageAvailable: false,
    });

    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${firstSiteId}?tab=traffic&lng=ar`);
    await setLocale(page, 'ar');
    await expect(page.getByTestId('traffic-upgrade')).toContainText(
      'رؤى الزيارات غير مشمولة في خطتك',
    );
    await page.getByRole('button', { name: 'فتح اللقطة' }).click();
    await expect(page.getByTestId('traffic-stat-monthlyVisits')).toBeVisible();
  });

  expect(secondId).not.toBe(first.id);
  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
