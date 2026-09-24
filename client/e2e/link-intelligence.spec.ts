/**
 * Link Intelligence canonical browser journey.
 *
 * Test-only injection contract (all production boundaries remain active):
 * - tier override: the isolated Better Auth account gets a Pro subscription
 *   row through compose Postgres, matching the established E2E account seam;
 * - provider scenario: DNS-valid `scenario-<name>.test` inputs are interpreted
 *   only by the fake BacklinkProvider (`scenario-timeout.test` here);
 * - cap override: the isolated account's current-month usage row is set to its
 *   Pro limit. No app endpoint or live-provider adapter accepts these knobs.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  gotoWithStaticAssetNetworkRecovery,
  reloadWithStaticAssetNetworkRecovery,
} from './helpers/navigation';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string; domain: string };
}

interface StartedRun {
  runId: string;
}

interface DeepRun {
  runId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  refunded: boolean;
  retainedCount: number;
}

interface GapRun {
  runId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  totalRefunded: number;
  legs: Array<{
    competitor: string;
    status: string;
    refunded: boolean;
    retainedCount: number;
  }>;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionResponse).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

function bumpToPro(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'pro', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
    { variables: { account_id: id } },
  );
}

function readLinkIntelUsage(id: string): number {
  const output = runComposePsqlOutput(
    `SELECT COALESCE((
       SELECT used FROM usage_counters
        WHERE account_id = :'account_id'
          AND period = to_char(now(), 'YYYY-MM')
          AND metric = 'link_intel_checks'
     ), 0);`,
    { variables: { account_id: id } },
  );
  return Number(output);
}

function exhaustLinkIntelUsage(id: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'link_intel_checks', 25, 25)
       ON CONFLICT (account_id, period, metric)
         DO UPDATE SET used = 25, "limit" = 25, updated_at = now();`,
    { variables: { account_id: id } },
  );
}

async function createSite(
  request: APIRequestContext,
  url: string,
  label: string,
): Promise<SiteResponse['site']> {
  const response = await request.post('/api/sites', {
    data: { url, label },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as SiteResponse).site;
}

async function waitForTerminal<T extends DeepRun | GapRun>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  let latest: T | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(path);
        expect(response.status()).toBe(200);
        latest = (await response.json()) as T;
        return latest.status;
      },
      { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
    )
    .toMatch(/^(succeeded|failed)$/);
  return latest as T;
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    // Flipping the token set starts a CSS colour transition on every shadcn
    // primitive (`transition-[background-color,border-color,color,…]`). axe
    // samples `getComputedStyle`, so scanning before those settle reads blended
    // intermediate colours and reports phantom contrast failures. Transitions
    // are REGISTERED on the next style recalc, so on a loaded host an
    // immediate `getAnimations()` can return before they exist and resolve
    // instantly — wait two rAF ticks first, then await the live animations.
    // Deterministic at `--retries=0` without masking a real violation the way
    // a blanket `transition: none` would.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  }, theme);
}

async function axe(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, `${label}: axe violations`).toEqual([]);
}

async function scanBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await axe(page, `${label}(${theme})`);
  }
  await setTheme(page, 'light');
}

async function startDeepPull(page: Page, type: string): Promise<string> {
  await page.getByTestId(`link-intel-preview-${type}`).click();
  await expect(page.getByTestId('link-intel-preview')).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/backlinks/deep/') &&
      !response.url().endsWith('/preview'),
  );
  await page.getByTestId(`link-intel-confirm-${type}`).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  return ((await response.json()) as StartedRun).runId;
}

async function startGap(page: Page, competitors: string): Promise<string> {
  await page.getByTestId('link-gap-competitors').fill(competitors);
  await page.getByTestId('link-gap-preview').click();
  await expect(page.getByTestId('link-intel-preview')).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/backlinks/gap'),
  );
  await page.getByTestId('link-gap-confirm').click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  return ((await response.json()) as StartedRun).runId;
}

test('Pro Link Intelligence: URL tabs, metering/refunds, stored reads, cap, timeout, Arabic RTL, and axe', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  const account = freshAccount('link-intelligence');
  let id = '';
  let primarySiteId = '';
  let timeoutSiteId = '';

  await test.step('create, verify, upgrade, then perform a Pro sign-in', async () => {
    await signUp(page, account);
    id = await accountId(page.request);
    bumpToPro(id);
    await gotoWithStaticAssetNetworkRecovery(page, '/logout');
    await page.waitForURL('/login');
    await logIn(page, account);
    const primary = await createSite(
      page.request,
      'https://link-intelligence.example',
      'Link Intelligence Journey',
    );
    const timeout = await createSite(
      page.request,
      'https://scenario-timeout.test',
      'Link Intelligence Timeout',
    );
    primarySiteId = primary.id;
    timeoutSiteId = timeout.id;
  });

  await test.step('all six URL tabs survive reload and pass axe in light and dark', async () => {
    for (const tab of ['overview', 'rows', 'domains', 'anchors', 'history', 'gap']) {
      await gotoWithStaticAssetNetworkRecovery(
        page,
        `/sites/${primarySiteId}/backlinks?tab=${tab}`,
      );
      await reloadWithStaticAssetNetworkRecovery(page);
      await expect(page.getByTestId(`link-intel-tab-${tab}`)).toHaveAttribute(
        'data-state',
        'active',
      );
      await scanBothThemes(page, `link-intelligence-${tab}`);
    }
  });

  await test.step('preview then cancel leaves the usage counter unchanged', async () => {
    const before = readLinkIntelUsage(id);
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?tab=domains`,
    );
    await page.getByTestId('link-intel-preview-refDomains').click();
    await expect(page.getByTestId('link-intel-preview-units')).toContainText('1');
    await page.getByTestId('link-intel-cancel-refDomains').click();
    await expect(page.getByTestId('link-intel-preview')).toHaveCount(0);
    expect(readLinkIntelUsage(id)).toBe(before);
  });

  await test.step('one referring-domains deep pull completes end to end', async () => {
    const before = readLinkIntelUsage(id);
    const runId = await startDeepPull(page, 'refDomains');
    const run = await waitForTerminal<DeepRun>(page.request, `/api/backlinks/runs/${runId}`);
    expect(run.status).toBe('succeeded');
    expect(run.refunded).toBe(false);
    expect(run.retainedCount).toBeGreaterThan(0);
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByTestId('referring-domains-table')).toBeVisible();
    await expect(page.getByText('blog.example.net')).toBeVisible();
    expect(readLinkIntelUsage(id)).toBe(before + 1);
    await scanBothThemes(page, 'referring-domains-result');
  });

  await test.step('reopening stored deep results is free', async () => {
    const before = readLinkIntelUsage(id);
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?tab=domains`,
    );
    await expect(page.getByTestId('referring-domains-table')).toBeVisible();
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByTestId('referring-domains-table')).toBeVisible();
    expect(readLinkIntelUsage(id)).toBe(before);
  });

  await test.step('two-competitor gap settles each leg and refunds only the timeout leg', async () => {
    const before = readLinkIntelUsage(id);
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${primarySiteId}/backlinks?tab=gap`);
    const runId = await startGap(page, 'rival-one.example\nscenario-timeout.test');
    const run = await waitForTerminal<GapRun>(page.request, `/api/backlinks/gap/${runId}`);
    expect(run.status).toBe('failed');
    expect(run.totalRefunded).toBe(1);
    expect(run.legs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          competitor: 'rival-one.example',
          status: 'ok',
          refunded: false,
        }),
        expect.objectContaining({
          competitor: 'scenario-timeout.test',
          status: 'failed',
          refunded: true,
        }),
      ]),
    );
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?tab=gap&runId=${runId}`,
    );
    await expect(page.getByTestId('gap-leg-status-ok')).toBeVisible();
    await expect(page.getByTestId('gap-leg-status-provider_failed_refunded')).toBeVisible();
    await expect(page.getByTestId('gap-linking-domain-table')).toBeVisible();
    expect(readLinkIntelUsage(id)).toBe(before + 1);
    await scanBothThemes(page, 'mixed-gap-result');
  });

  await test.step('stored gap result reopens without spend', async () => {
    const before = readLinkIntelUsage(id);
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByTestId('link-gap-results')).toBeVisible();
    expect(readLinkIntelUsage(id)).toBe(before);
  });

  await test.step('DNS-valid fake provider timeout refunds the deep-pull unit', async () => {
    const before = readLinkIntelUsage(id);
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${timeoutSiteId}/backlinks?tab=domains`,
    );
    const runId = await startDeepPull(page, 'refDomains');
    const run = await waitForTerminal<DeepRun>(page.request, `/api/backlinks/runs/${runId}`);
    expect(run.status).toBe('failed');
    expect(run.refunded).toBe(true);
    expect(run.retainedCount).toBe(0);
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByTestId('refDomains-provider-failed')).toBeVisible();
    expect(readLinkIntelUsage(id)).toBe(before);
    await scanBothThemes(page, 'provider-timeout');
  });

  await test.step('Arabic switch drives a paid deep pull and gap flow in RTL', async () => {
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?tab=anchors`,
    );
    const preferenceSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === '/api/users/preferences/language',
    );
    await page.locator('#language-switcher').selectOption('ar');
    expect((await preferenceSaved).status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('link-intelligence-workspace')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('link-intel-view-anchors')).toHaveAttribute('dir', 'rtl');
    const deepRunId = await startDeepPull(page, 'anchors');
    const deepRun = await waitForTerminal<DeepRun>(
      page.request,
      `/api/backlinks/runs/${deepRunId}`,
    );
    expect(deepRun.status).toBe('succeeded');
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByTestId('anchors-table')).toBeVisible();

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?lng=ar&tab=gap`,
    );
    await expect(page.getByTestId('link-gap-workspace')).toHaveAttribute('dir', 'rtl');
    const gapRunId = await startGap(page, 'rival-two.example');
    const gapRun = await waitForTerminal<GapRun>(page.request, `/api/backlinks/gap/${gapRunId}`);
    expect(gapRun.status).toBe('succeeded');
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?lng=ar&tab=gap&runId=${gapRunId}`,
    );
    await expect(page.getByTestId('link-gap-results')).toHaveAttribute('dir', 'rtl');
    await scanBothThemes(page, 'arabic-link-intelligence');
    await page.locator('#language-switcher').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  await test.step('fake cap override renders the cap-reached path without a paid POST', async () => {
    exhaustLinkIntelUsage(id);
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${primarySiteId}/backlinks?lng=en&tab=history`,
    );
    let paidPosts = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/backlinks/deep/') &&
        !request.url().endsWith('/preview')
      )
        paidPosts += 1;
    });
    await page.getByTestId('link-intel-preview-history').click();
    await expect(page.getByTestId('history-cap')).toBeVisible();
    await expect(page.getByTestId('link-intel-preview')).toBeVisible();
    expect(paidPosts).toBe(0);
    await scanBothThemes(page, 'cap-reached');
  });

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
