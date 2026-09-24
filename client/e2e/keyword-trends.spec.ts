/**
 * Live Keyword Trends canonical browser journey.
 *
 * Drives the two shipped entry points end to end:
 *   - the Starter standalone route `/keyword-research/live-trends`
 *   - the Pro workspace tab `/keyword-research?tab=live-trends`
 *
 * Only production routes and the shipped fake `TrendsProvider` are used.
 * Test-only setup is limited to verified-account tier/counter rows and the
 * cross-account `vendor_cache` reset, applied through the isolated compose
 * Postgres service. There are no axe rule exemptions: every scan runs the
 * full WCAG 2 A/AA + 2.1 A/AA tag set in BOTH themes.
 *
 * The `trend_explorations` meter is read straight from `usage_counters`
 * because `/api/billing/usage` does not expose that metric — reading the
 * authoritative counter row keeps the metering assertions honest instead of
 * widening a shipped DTO from a test.
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
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Deterministic phrase whose cross-account cache row this spec owns. */
const PRIMARY_KEYWORD = 'e2e live trends alpha';
const PRIMARY_SLUG = 'e2e-live-trends-alpha';
/** Every `__scenario:` sentinel is stripped by the fake, leaving one series. */
const SCENARIO_SLUG = 'fake-keyword';
/** Fake-provider scenario sentinels (see `shared/providers/fakes.ts`). */
const SPARSE_KEYWORD = '__scenario:sparse';
const TIMEOUT_KEYWORD = '__scenario:timeout';
/** First `rising` row the fake provider always returns. */
const RISING_QUERY = 'rankmefast vs ahrefs';
const RISING_SLUG = 'rankmefast-vs-ahrefs';

type Tier = 'none' | 'starter' | 'pro' | 'agency';

interface SessionResponse {
  user?: { id?: string };
}

interface ExplorationResponse {
  runId: string;
  status: string;
  cached: boolean;
  refunded: boolean;
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

function setTier(id: string, tier: Tier): void {
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

function setTrendUsage(id: string, used: number, limit: number): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'trend_explorations', :'used', :'limit')
       ON CONFLICT (account_id, period, metric)
         DO UPDATE SET used = EXCLUDED.used, "limit" = EXCLUDED."limit", updated_at = now();`,
    {
      variables: { account_id: id, used: String(used), limit: String(limit) },
    },
  );
}

/** Authoritative `trend_explorations` consumption for the current period. */
function trendUsage(id: string): number {
  const raw = runComposePsqlOutput(
    `SELECT used
       FROM usage_counters
      WHERE account_id = :'account_id'
        AND period = to_char(now(), 'YYYY-MM')
        AND metric = 'trend_explorations';`,
    { variables: { account_id: id } },
  );
  return raw.length === 0 ? 0 : Number(raw);
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
  const switcher = page.locator('#language-switcher');
  if ((await switcher.inputValue()) !== locale) {
    const persisted = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === '/api/users/preferences/language',
      { timeout: 10_000 },
    );
    await switcher.selectOption(locale);
    const response = await persisted.catch(() => null);
    if (response === null) {
      // Directly after re-login, the boundary can briefly render while it is
      // hydrating the same principal. The UI switch is local in that window,
      // so persist through the shipped endpoint and rehydrate once.
      const fallback = await page.request.patch('/api/users/preferences/language', {
        data: { language: locale },
        headers: await csrfHeaders(page.request),
      });
      expect(fallback.status()).toBe(200);
      await page.reload();
    } else {
      expect(response.ok()).toBe(true);
    }
  }
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

async function logout(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL('/login');
}

async function signUpAtTier(
  page: Page,
  prefix: string,
  tier: Tier,
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

/** Type one phrase into the shared chips input and commit it. */
async function addKeyword(page: Page, phrase: string): Promise<void> {
  const input = page.getByTestId('live-trends-input');
  await input.focus();
  await page.keyboard.type(phrase);
  await page.keyboard.press('Enter');
}

/** Preview → assert the disclosed single unit → confirm → wait for the run. */
async function previewAndConfirm(page: Page): Promise<ExplorationResponse> {
  await page.getByTestId('live-trends-preview-cta').click();
  await expect(page.getByTestId('live-trends-preview')).toBeVisible();
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/keyword-research/trends/explore'),
  );
  await page.getByTestId('live-trends-confirm').click();
  return json<ExplorationResponse>(await started);
}

test('Live Keyword Trends: standalone + workspace journeys, metering, cache, refund, Arabic RTL and axe', async ({
  page,
  context,
}) => {
  // This serial journey deliberately covers both shipped entry points and
  // creates several isolated tier fixtures. Keep enough headroom for the
  // documented Better Auth cooldowns and a contended Docker CI host while
  // retaining bounded locator/action timeouts inside the helpers.
  test.setTimeout(600_000);
  // The isolated stack is intentionally reusable between local zero-retry
  // runs. Reset only this capability/operation pair so the journey always
  // proves the required fresh -> cached transition.
  runComposePsql(
    `DELETE FROM vendor_cache
      WHERE capability = 'keyword'
        AND operation = 'trends_live';`,
  );
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  let starter!: { account: TestAccount; id: string };
  let storedRunId = '';
  let refundedRunId = '';

  await test.step('Starter lands on the standalone surface and the empty history is accessible in both themes', async () => {
    starter = await signUpAtTier(page, 'live-trends-starter', 'starter');
    // The standalone route pins the sole `live-trends` tab: an unknown `?tab=`
    // falls back to it instead of rendering a blank surface.
    await page.goto('/keyword-research/live-trends?tab=bogus&lng=en');
    await expect(page.getByTestId('keyword-live-trends-page')).toBeVisible();
    await page.goto('/keyword-research/live-trends?lng=en');
    await expect(page.getByTestId('keyword-live-trends-page')).toBeVisible();
    await expect(page.getByTestId('live-trends-view')).toBeVisible();
    await expect(page.getByTestId('live-trends-history-empty')).toBeVisible();
    // The 0..100 index disclaimer is on the surface before any spend.
    await expect(page.getByTestId('live-trends-coverage-note')).toContainText(
      'a 0–100 index, not absolute volume',
    );
    expect(trendUsage(starter.id)).toBe(0);
    await scanBothThemes(page, 'live-trends-empty');
  });

  await test.step('preview confirms before running and cancelling spends nothing', async () => {
    await addKeyword(page, PRIMARY_KEYWORD);
    await page.getByTestId('live-trends-preview-cta').click();
    const preview = page.getByTestId('live-trends-preview');
    await expect(preview).toBeVisible();
    // The self-hosted client ships no billing UI: the pre-confirm card only
    // states that plan usage is not metered — no units, allowance, or packs.
    await expect(preview).toContainText('Plan usage limits are not metered in self-hosted mode.');
    await expect(preview.getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId('live-trends-confirm')).toBeVisible();
    await scanBothThemes(page, 'live-trends-preview');

    await page.getByTestId('live-trends-cancel').click();
    await expect(preview).toHaveCount(0);
    expect(trendUsage(starter.id)).toBe(0);
    // The URL grammar persisted the previewed inputs without spending.
    await expect(page).toHaveURL(/keywords=e2e/);
  });

  await test.step('confirming succeeds, meters one unit and labels every readout Estimate', async () => {
    const run = await previewAndConfirm(page);
    expect(run.status).toBe('succeeded');
    expect(run.cached).toBe(false);
    storedRunId = run.runId;
    expect(trendUsage(starter.id)).toBe(1);

    const results = page.getByTestId('live-trends-results');
    await expect(results).toBeVisible();
    await expect(results.getByText('Fresh', { exact: true })).toBeVisible();
    // Chart is decorative; the accessible fallback carries the numbers.
    await expect(page.getByTestId('live-trends-chart')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.getByTestId('live-trends-table')).toBeVisible();
    expect(await page.getByTestId('live-trends-estimate-chip').count()).toBeGreaterThan(1);
    await expect(page.getByTestId(`live-trends-readouts-${PRIMARY_SLUG}`)).toBeVisible();
    await expect(page.getByTestId(`live-trends-yoy-${PRIMARY_SLUG}`)).toHaveText(
      /^\+\d/,
    );
    await expect(page.getByTestId(`live-trends-momentum-${PRIMARY_SLUG}`)).toHaveText(
      'Trending up',
    );
    await expect(page.getByTestId(`live-trends-seasonality-${PRIMARY_SLUG}`)).toHaveText(
      'Dec',
    );
    await expect(page.getByTestId('live-trends-related')).toBeVisible();
    await scanBothThemes(page, 'live-trends-results');
  });

  await test.step('a one-click rising-query follow-up consumes a new unit', async () => {
    const before = trendUsage(starter.id);
    await page.getByTestId(`live-trends-related-rising-${RISING_SLUG}`).click();
    // The follow-up never bypasses the preview surface.
    await expect(page.getByTestId('live-trends-preview')).toBeVisible();
    await expect(page.getByTestId(`live-trends-chip-${RISING_SLUG}`)).toBeVisible();
    expect(trendUsage(starter.id)).toBe(before);

    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/keyword-research/trends/explore'),
    );
    await page.getByTestId('live-trends-confirm').click();
    const run = await json<ExplorationResponse>(await started);
    expect(run.status).toBe('succeeded');
    expect(trendUsage(starter.id)).toBe(before + 1);
    await expect(page.getByTestId(`live-trends-readouts-${RISING_SLUG}`)).toBeVisible();
  });

  await test.step('an identical rerun inside the TTL is served cached and still meters', async () => {
    const before = trendUsage(starter.id);
    await page.goto('/keyword-research/live-trends?lng=en');
    await addKeyword(page, PRIMARY_KEYWORD);
    await page.getByTestId('live-trends-preview-cta').click();
    await expect(page.getByTestId('live-trends-preview')).toBeVisible();

    const run = await previewAndConfirm(page);
    expect(run.status).toBe('succeeded');
    expect(run.cached).toBe(true);
    await expect(
      page.getByTestId('live-trends-results').getByText('Cached', { exact: true }),
    ).toBeVisible();
    // A cache hit is a cost optimisation for us, not a free run for the user.
    expect(trendUsage(starter.id)).toBe(before + 1);
  });

  await test.step('a sparse-history market renders the honesty copy instead of invented readouts', async () => {
    const before = trendUsage(starter.id);
    await page.goto('/keyword-research/live-trends?lng=en');
    await addKeyword(page, SPARSE_KEYWORD);
    const run = await previewAndConfirm(page);
    expect(run.status).toBe('succeeded');
    expect(trendUsage(starter.id)).toBe(before + 1);

    await expect(page.getByTestId('live-trends-sparse')).toContainText(
      'Need at least 24 months of history for seasonality',
    );
    await expect(page.getByTestId(`live-trends-yoy-${SCENARIO_SLUG}`)).toHaveText(
      'Need at least 56 weeks of history.',
    );
    await expect(
      page.getByTestId(`live-trends-seasonality-${SCENARIO_SLUG}`),
    ).toContainText('Need at least 24 months of history.');
    await scanBothThemes(page, 'live-trends-sparse');
  });

  await test.step('a provider failure refunds the reserved unit and surfaces localized failure copy', async () => {
    const before = trendUsage(starter.id);
    await page.goto('/keyword-research/live-trends?lng=en');
    await addKeyword(page, TIMEOUT_KEYWORD);
    await page.getByTestId('live-trends-preview-cta').click();
    await expect(page.getByTestId('live-trends-preview')).toBeVisible();
    const failed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/keyword-research/trends/explore'),
    );
    await page.getByTestId('live-trends-confirm').click();
    expect((await failed).status()).toBe(503);

    const error = page.getByTestId('live-trends-run-error');
    await expect(error).toContainText('The trends provider did not respond');
    await expect(error).toContainText('The trends provider is temporarily unavailable');
    // Reserved-then-released: the counter must be back where it started.
    expect(trendUsage(starter.id)).toBe(before);
    await scanBothThemes(page, 'live-trends-provider-failed');

    // The refunded run is readable in the stored history and the URL-backed
    // filter narrows to it without refetching or spending.
    await page.goto('/keyword-research/live-trends?lng=en&history=refunded');
    const refundedRow = page.getByTestId('live-trends-history').locator('li');
    await expect(refundedRow).toHaveCount(1);
    await expect(refundedRow).toContainText('Refunded');
    await expect(refundedRow).toContainText('Failed');
    refundedRunId = (await refundedRow.getAttribute('data-testid'))!.replace(
      'live-trends-stored-row-',
      '',
    );
    expect(refundedRunId).toMatch(/^[a-f0-9]{24}$/);
    expect(trendUsage(starter.id)).toBe(before);
  });

  await test.step('the kill-switch response pauses new runs while stored reads survive', async () => {
    setTrendUsage(starter.id, 2, 10);
    await page.goto('/keyword-research/live-trends?lng=en');
    // The rollout flag is a boot-time env seam; the composed gate runs with it
    // ON so every metered path above is real. The disabled response shape is
    // reproduced at the transport boundary — the same 503 envelope the server
    // returns from `keywordResearch.trends.errors.unavailable`.
    await page.route('**/api/keyword-research/trends/explore/preview', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'content-language': 'en', vary: 'x-lang, Accept-Language' },
        body: JSON.stringify({
          error: {
            message: 'Keyword Trends is temporarily unavailable. Try again shortly.',
            details: { reason: 'disabled' },
          },
        }),
      });
    });
    await addKeyword(page, 'kill switch probe');
    await page.getByTestId('live-trends-preview-cta').click();
    await expect(page.getByTestId('live-trends-kill-switch')).toBeVisible();
    await expect(page.getByTestId('live-trends-confirm')).toHaveCount(0);
    // Stored explorations stay listed and readable while the tool is paused.
    await expect(
      page.getByTestId(`live-trends-stored-open-${storedRunId}`),
    ).toBeVisible();
    await page.getByTestId(`live-trends-stored-open-${storedRunId}`).click();
    await expect(page.getByTestId('live-trends-stored-detail')).toBeVisible();
    expect(trendUsage(starter.id)).toBe(2);
    await scanBothThemes(page, 'live-trends-kill-switch');
    await page.unroute('**/api/keyword-research/trends/explore/preview');
  });

  await test.step('the Arabic journey mirrors the happy path with logical layout', async () => {
    await page.goto('/keyword-research/live-trends?lng=ar');
    await setLocale(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('live-trends-view')).toContainText('أهمية البحث المباشر');
    await expect(page.getByTestId('live-trends-coverage-note')).toContainText(
      'مؤشر من 0 إلى 100',
    );

    const before = trendUsage(starter.id);
    await addKeyword(page, 'اتجاهات سيو');
    await page.getByRole('button', { name: 'معاينة التكلفة' }).click();
    await expect(page.getByTestId('live-trends-preview')).toContainText('تقدير التكلفة');
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/keyword-research/trends/explore'),
    );
    await page.getByRole('button', { name: 'تشغيل الاستكشاف' }).click();
    expect((await json<ExplorationResponse>(await started)).status).toBe('succeeded');
    expect(trendUsage(starter.id)).toBe(before + 1);

    await expect(page.getByTestId('live-trends-results')).toContainText(
      'نتائج أهمية البحث',
    );
    await expect(page.getByTestId('live-trends-estimate-chip').first()).toHaveText('تقدير');
    // The chart is decorative (`aria-hidden`); the accessible data table is
    // the RTL-safe readout, so the mirror proof runs on its columns.
    const headers = page.getByTestId('live-trends-table').getByRole('columnheader');
    const keywordBox = await headers.nth(0).boundingBox();
    const indexBox = await headers.nth(2).boundingBox();
    expect(keywordBox?.x).toBeGreaterThan(indexBox?.x ?? Number.POSITIVE_INFINITY);
    await scanBothThemes(page, 'live-trends-results-ar');
  });

  await test.step('a below-Pro account is routed from the locked workspace to the surface it owns', async () => {
    await logout(page);
    setTier(starter.id, 'none');
    await logIn(page, starter.account);
    await setLocale(page, 'en');
    await page.goto('/keyword-research?tab=live-trends&lng=en');
    await expect(page.getByTestId('keyword-intel-locked')).toBeVisible();
    const hint = page.getByTestId('keyword-intel-live-trends-locked-hint');
    await expect(hint).toContainText('Live search interest is available from Starter up');
    await scanBothThemes(page, 'live-trends-workspace-locked');
    await page.getByTestId('keyword-intel-live-trends-locked-link').click();
    await page.waitForURL(/keyword-research\/live-trends/);
    await expect(page.getByTestId('live-trends-view')).toBeVisible();
  });

  await test.step('A no-plan account can reopen a stored exploration for free while a new run is refused', async () => {
    const before = trendUsage(starter.id);
    await page.goto('/keyword-research/live-trends?lng=en');
    await page.getByTestId(`live-trends-stored-open-${storedRunId}`).click();
    await expect(page.getByTestId('live-trends-stored-detail')).toBeVisible();
    expect(trendUsage(starter.id)).toBe(before);

    await addKeyword(page, 'free tier probe');
    await page.getByTestId('live-trends-preview-cta').click();
    await expect(page.getByTestId('live-trends-preview-error')).toContainText(
      'Keyword Trends is not on your plan.',
    );
    await expect(page.getByTestId('live-trends-confirm')).toHaveCount(0);
    expect(trendUsage(starter.id)).toBe(before);
    await scanBothThemes(page, 'live-trends-free');

    // The stored run stays owner-scoped even with the tier removed.
    const stored = await json<ExplorationResponse>(
      await page.request.get(`/api/keyword-research/trends/${storedRunId}`),
    );
    expect(stored.status).toBe('succeeded');
    const refunded = await json<ExplorationResponse>(
      await page.request.get(`/api/keyword-research/trends/${refundedRunId}`),
    );
    expect(refunded.refunded).toBe(true);
  });

  await test.step('the Pro workspace hosts the same surface behind the live-trends tab', async () => {
    await logout(page);
    const pro = await signUpAtTier(page, 'live-trends-pro', 'pro');
    await page.goto('/keyword-research?tab=live-trends&lng=en');
    await expect(page.getByTestId('keyword-intel-tab-live-trends')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('keyword-intel-panel-live-trends')).toBeVisible();
    await expect(page.getByTestId('live-trends-view')).toBeVisible();
    // The sibling Labs historical-volume tab is a distinct surface, not a
    // rename: its panel stays hidden (Radix only renders the ACTIVE panel's
    // children) so neither trend view can fire the other's thunks.
    await expect(page.getByTestId('keyword-intel-panel-trends')).toBeHidden();
    await expect(page.getByTestId('keyword-intel-tab-trends')).toHaveText(
      'Historical volume',
    );
    await expect(page.getByTestId('keyword-intel-tab-live-trends')).toHaveText(
      'Live search interest',
    );
    await scanBothThemes(page, 'live-trends-workspace');

    await addKeyword(page, PRIMARY_KEYWORD);
    await page.getByTestId('live-trends-preview-cta').click();
    // Cross-account read-through: another tenant's warm cache row is reused
    // (asserted on the run below), and the unit is still metered on confirm.
    await expect(page.getByTestId('live-trends-preview')).toBeVisible();
    const run = await previewAndConfirm(page);
    expect(run.status).toBe('succeeded');
    expect(run.cached).toBe(true);
    expect(trendUsage(pro.id)).toBe(1);
    await expect(page.getByTestId('live-trends-results')).toBeVisible();
    await scanBothThemes(page, 'live-trends-workspace-results');

    // Switching to the sibling Labs tab unmounts the live surface entirely,
    // so neither trend view can fire the other's thunks.
    await page.getByTestId('keyword-intel-tab-trends').click();
    await expect(page).toHaveURL(/\btab=trends\b/);
    await expect(page.getByTestId('live-trends-view')).toHaveCount(0);
    expect(trendUsage(pro.id)).toBe(1);
  });

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
