/**
 * Review Intelligence canonical browser journey.
 *
 * Drives the shipped `/sites/:siteId?tab=reviews` workspace end to end
 * against the composed stack with `PROVIDER_REVIEWS=fake` and the keyless
 * `PROVIDER_AI=fake`: source setup, non-reserving preview, paid sync, stats +
 * trend + cited themes, rerun dedupe, partial-source failure, the honest
 * no-reliable-themes terminal, the free CSV export, the cap disclosure, the
 * kill-switch refusal, an Arabic RTL pass, and axe in light + dark.
 *
 * Test-only setup is limited to verified-account tier/counter rows applied
 * through the compose Postgres service. Two paths that a keyless stack cannot
 * otherwise reach are driven through the SHIPPED product surface using the
 * fake provider's `__scenario-<name>` target sentinel
 * (`shared/providers/fakes.ts`): a per-source terminal vendor failure and a
 * hostile (formula / markup / RTL-override) review payload. Nothing about the
 * product routes is test-aware.
 *
 * The `review_syncs` meter is read straight from `usage_counters` because
 * `/api/billing/usage` does not expose that metric — reading the
 * authoritative counter row keeps the metering assertions honest instead of
 * widening a shipped DTO from a test.
 *
 * Rate budget: the shipped `review_sync` bucket allows 20 mutations per
 * account per minute. This journey issues ~15 mutations spread across
 * terminal polling and axe scans, so it exercises the limiter rather than
 * tripping it.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import { waitForRunTerminal } from './helpers/waitForRunTerminal';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fake-provider scenario sentinel (see `shared/providers/fakes.ts`). */
const SCENARIO_PREFIX = '__scenario-';
const GOOGLE_TARGET = 'ChIJe2eReviewsAlpha';
const TRUSTPILOT_TARGET = 'reviews-alpha.example';
const TRIPADVISOR_TARGET = 'g-99001';

type Tier = 'none' | 'starter' | 'pro' | 'agency';
type ReviewSource = 'google' | 'trustpilot' | 'tripadvisor';

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string };
}

interface SubmittedSync {
  runId: string;
}

interface PerSourceOutcome {
  source: ReviewSource;
  outcome: 'ok' | 'failed' | 'zeroNew';
  retained: number;
  errorCode: string | null;
}

interface ReviewRunBody {
  id: string;
  status: string;
  perSourceOutcomes: PerSourceOutcome[];
  retainedCount: number;
  refunded: boolean;
  aiTerminalState: string;
  aiThemeCount: number;
}

interface PreviewBody {
  units: number;
  packOverflow?: string;
  cost: { canFit: boolean; remainingPackUnits: number };
}

/**
 * Structural shape shared by an `APIRequestContext` response and a browser
 * network `Response`, so the same assertion helper reads both.
 */
interface JsonResponse {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

async function json<T>(response: JsonResponse, expectedStatus = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(expectedStatus);
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

function setReviewUsage(id: string, used: number, limit: number): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'review_syncs', :'used', :'limit')
       ON CONFLICT (account_id, period, metric)
         DO UPDATE SET used = EXCLUDED.used, "limit" = EXCLUDED."limit", updated_at = now();`,
    { variables: { account_id: id, used: String(used), limit: String(limit) } },
  );
}

/** Authoritative `review_syncs` consumption for the current period. */
function reviewUsage(id: string): number {
  const raw = runComposePsqlOutput(
    `SELECT used
       FROM usage_counters
      WHERE account_id = :'account_id'
        AND period = to_char(now(), 'YYYY-MM')
        AND metric = 'review_syncs';`,
    { variables: { account_id: id } },
  );
  return raw.length === 0 ? 0 : Number(raw);
}

async function createSite(
  request: APIRequestContext,
  url: string,
  label: string,
): Promise<string> {
  const created = await json<SiteResponse>(
    await request.post('/api/sites', {
      data: { url, label },
      headers: await csrfHeaders(request),
    }),
    201,
  );
  return created.site.id;
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
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function logout(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL('/login');
  await expect(page.locator('#login-email')).toBeVisible();
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

/** Open the shipped workspace tab and wait for the panel to settle. */
async function openReviews(page: Page, siteId: string, locale: 'en' | 'ar' = 'en'): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=reviews&lng=${locale}`);
  await expect(page).toHaveURL(/\?tab=reviews/);
  await expect(page.getByTestId('reviews-panel')).toBeVisible();
}

/** Configure one review source through the rendered form. */
async function addSource(page: Page, source: ReviewSource, target: string): Promise<void> {
  const input = page.getByTestId(`reviews-source-input-${source}`);
  await expect(input).toHaveAttribute('maxlength', '200');
  await input.fill(target);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/local-seo/reviews/sources'),
  );
  await page.getByTestId(`reviews-source-save-${source}`).focus();
  await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(201);
  await expect(page.getByTestId(`reviews-source-configured-${source}`)).toBeVisible();
}

async function selectSources(page: Page, sources: readonly ReviewSource[]): Promise<void> {
  for (const source of sources) {
    const checkbox = page.getByTestId(`reviews-sync-source-${source}`);
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
  }
}

/** Estimate → assert the single disclosed unit → return the preview body. */
async function estimate(page: Page): Promise<PreviewBody> {
  const previewed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/local-seo/reviews/preview'),
  );
  await page.getByTestId('reviews-sync-estimate').focus();
  await page.keyboard.press('Enter');
  const body = await json<PreviewBody>(await previewed);
  expect(body.units).toBe(1);
  return body;
}

async function confirmSync(page: Page): Promise<string> {
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/local-seo/reviews/sync'),
  );
  await page.getByTestId('reviews-sync-confirm').focus();
  await page.keyboard.press('Enter');
  return (await json<SubmittedSync>(await started, 202)).runId;
}

/**
 * A run is only readable when the vendor fan-out settled AND the bundled
 * theme pass reached a terminal state — polling on `status` alone would race
 * the themes surface.
 */
async function waitForReviewRun(
  request: APIRequestContext,
  runId: string,
): Promise<ReviewRunBody> {
  const terminal = await waitForRunTerminal<ReviewRunBody>({
    request,
    url: `/api/local-seo/reviews/runs/${encodeURIComponent(runId)}`,
    terminal: ['succeeded', 'partial', 'failed'],
    extractStatus: (body) => {
      const run = body as ReviewRunBody | null;
      if (run === null) return undefined;
      return run.aiTerminalState === 'pending' ? 'running' : run.status;
    },
    options: { deadlineMs: 60_000, intervalMs: 250, label: `review sync ${runId}` },
  });
  return terminal.body;
}

test('Review Intelligence: source setup, metering, dedupe, themes, export, cap, kill switch, Arabic RTL and axe', async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  let pro!: { account: TestAccount; id: string };
  let siteA = '';
  let siteB = '';
  let siteC = '';
  let firstRunId = '';

  await test.step('Pro reaches ?tab=reviews and the empty workspace is accessible in both themes', async () => {
    pro = await signUpAtTier(page, 'reviews-pro', 'pro');
    siteA = await createSite(page.request, 'https://reviews-alpha.example', 'Reviews alpha');
    await openReviews(page, siteA);
    await expect(page.getByTestId('reviews-sources')).toBeVisible();
    await expect(page.getByTestId('reviews-sources-empty')).toBeVisible();
    await expect(page.getByTestId('reviews-sync-needs-sources')).toBeVisible();
    await expect(page.getByTestId('reviews-runs-empty')).toBeVisible();
    await scanBothThemes(page, 'reviews-empty');
  });

  await test.step('all three sources are configured with bounded targets', async () => {
    await addSource(page, 'google', GOOGLE_TARGET);
    await addSource(page, 'trustpilot', TRUSTPILOT_TARGET);
    await addSource(page, 'tripadvisor', TRIPADVISOR_TARGET);
    await expect(page.getByTestId('reviews-never-synced')).toBeVisible();
    await expect(page.getByTestId('reviews-sync-form')).toBeVisible();
    await scanBothThemes(page, 'reviews-sources-configured');
  });

  await test.step('preview then cancel spends nothing', async () => {
    const before = reviewUsage(pro.id);
    await selectSources(page, ['google', 'trustpilot', 'tripadvisor']);
    const preview = await estimate(page);
    await expect(page.getByTestId('reviews-preview-units')).toContainText('Uses 1 review sync');
    await expect(page.getByTestId('reviews-preview-sources')).toContainText('Covers 3 sources');
    await expect(page.getByTestId('reviews-preview-depth')).toContainText(
      'Pulls up to 100 reviews per source',
    );
    expect(preview.cost.canFit).toBe(true);
    await page.getByTestId('reviews-sync-cancel').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reviews-preview')).toHaveCount(0);
    // The counter is authoritative; a second estimate must disclose the same
    // allowance, proving the cancelled estimate reserved nothing.
    expect(reviewUsage(pro.id)).toBe(before);
    const second = await estimate(page);
    expect(second.cost.canFit).toBe(true);
    expect(reviewUsage(pro.id)).toBe(before);
    await page.getByTestId('reviews-sync-cancel').focus();
    await page.keyboard.press('Enter');
  });

  await test.step('the confirmed sync spends exactly one unit and renders stats, trend and cited themes', async () => {
    const before = reviewUsage(pro.id);
    await estimate(page);
    firstRunId = await confirmSync(page);
    const run = await waitForReviewRun(page.request, firstRunId);
    expect(run.status).toBe('succeeded');
    expect(run.refunded).toBe(false);
    expect(run.retainedCount).toBe(4);
    expect(run.aiTerminalState).toBe('themes-ok');
    expect(reviewUsage(pro.id)).toBe(before + 1);

    await openReviews(page, siteA);
    for (const source of ['google', 'trustpilot', 'tripadvisor'] as const) {
      await expect(
        page.getByTestId(`reviews-run-outcome-${firstRunId}-${source}`),
      ).toContainText('new reviews');
    }
    await expect(page.getByTestId(`reviews-run-refunded-${firstRunId}`)).toHaveCount(0);
    await expect(page.getByTestId(`reviews-run-ai-${firstRunId}`)).toContainText('Themes ready');

    // Inventory: four stored rows, newest first.
    await expect(page.getByTestId('reviews-inventory')).toBeVisible();
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(4);
    await expect(page.getByTestId('reviews-inventory-page')).toContainText('4 reviews');

    // Stats cards.
    await expect(page.getByTestId('reviews-stats')).toBeVisible();
    await expect(page.getByTestId('reviews-histogram-5')).toBeVisible();
    await expect(page.getByTestId('reviews-velocity')).toBeVisible();
    await expect(page.getByTestId('reviews-source-mix-google')).toContainText('2');

    // Average-rating trend: chart AND the accessible data-table fallback.
    await expect(page.getByTestId('reviews-trend-chart')).toBeVisible();
    const fallback = page.getByTestId('reviews-trend-table-fallback');
    await fallback.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(fallback.locator('tbody tr').first()).toBeVisible();

    // At least one cited theme, with its citations expandable.
    await expect(page.getByTestId('reviews-themes')).toBeVisible();
    const theme = page.getByTestId('reviews-theme-praise-0');
    await expect(theme).toBeVisible();
    await expect(theme.getByText('AI interpretation')).toBeVisible();
    await theme.getByRole('button', { name: 'Show the reviews behind this' }).focus();
    await page.keyboard.press('Enter');
    await expect(theme.getByText('Great support, quick fix turnaround.')).toBeVisible();
    await expect(page.getByTestId('reviews-provenance-provider_observation').first()).toBeVisible();
    await expect(page.getByTestId('reviews-provenance-ai_interpretation')).toBeVisible();
    await scanBothThemes(page, 'reviews-synced');
  });

  await test.step('keyboard-operated URL filters and sorting do not spend', async () => {
    const before = reviewUsage(pro.id);
    await page.getByTestId('reviews-filter-source').focus();
    await page.keyboard.press('Enter');
    const allSourcesOption = page.getByRole('option', { name: 'All' });
    const googleOption = page.getByRole('option', { name: 'Google' });
    await expect(googleOption).toBeVisible();
    await expect(allSourcesOption).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(googleOption).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(googleOption).toBeHidden();
    await expect(page).toHaveURL(/src=google/);
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(2);
    await page.getByTestId('reviews-sort').focus();
    await page.keyboard.press('Enter');
    const newestFirstOption = page.getByRole('option', { name: 'Newest first' });
    const highestRatingOption = page.getByRole('option', { name: 'Highest rating' });
    await expect(highestRatingOption).toBeVisible();
    await expect(newestFirstOption).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(highestRatingOption).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(highestRatingOption).toBeHidden();
    await expect(page).toHaveURL(/sort=rating-high/);
    await expect(
      page.getByRole('columnheader', { name: 'Rating' }),
    ).toHaveAttribute('aria-sort', 'descending');
    await page.getByTestId('reviews-filter-clear').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(4);
    expect(reviewUsage(pro.id)).toBe(before);
  });

  await test.step('a rerun appends nothing and books a consumed zero-retained run', async () => {
    const before = reviewUsage(pro.id);
    await selectSources(page, ['google', 'trustpilot', 'tripadvisor']);
    await estimate(page);
    const rerunId = await confirmSync(page);
    const run = await waitForReviewRun(page.request, rerunId);
    expect(run.retainedCount).toBe(0);
    expect(run.refunded).toBe(false);
    expect(run.status).toBe('succeeded');
    for (const outcome of run.perSourceOutcomes) {
      expect(outcome.outcome).toBe('zeroNew');
    }
    expect(reviewUsage(pro.id)).toBe(before + 1);

    await openReviews(page, siteA);
    await expect(page.getByTestId(`reviews-run-row-${rerunId}`)).toContainText('nothing new');
    await expect(page.getByTestId(`reviews-run-refunded-${rerunId}`)).toHaveCount(0);
    // The stored inventory is unchanged — dedupe appended nothing.
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(4);
  });

  await test.step('hostile review content stays inert and exports formula-neutralized', async () => {
    // Re-point Tripadvisor at the fake's hostile payload through the shipped
    // source form: formula body, script-tag title, `@`-leading author.
    await page.getByTestId('reviews-source-remove-tripadvisor').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reviews-source-input-tripadvisor')).toBeVisible();
    await addSource(page, 'tripadvisor', `${SCENARIO_PREFIX}hostile`);
    await selectSources(page, ['tripadvisor']);
    await estimate(page);
    const hostileRunId = await confirmSync(page);
    const run = await waitForReviewRun(page.request, hostileRunId);
    expect(run.status).toBe('succeeded');
    expect(run.retainedCount).toBe(3);

    await openReviews(page, siteA);
    const inventory = page.getByTestId('reviews-inventory');
    await expect(inventory.locator('tbody tr')).toHaveCount(7);
    // The script tag is TEXT, never markup: it renders verbatim and its
    // payload never executes.
    await expect(inventory).toContainText('<script>window.__reviewPwned = 1</script>');
    await expect(inventory).toContainText('=SUM(1) formula probe from a review body');
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__reviewPwned))
      .toBeUndefined();

    const download = page.waitForEvent('download');
    await page.getByTestId('reviews-export').focus();
    await page.keyboard.press('Enter');
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain("'=SUM(1) formula probe from a review body");
    expect(csv).toContain("'+1 leading plus probe");
    expect(csv).toContain("'@ledger");
    // Markup remains inert CSV text; the title is preserved rather than
    // silently dropped from the full stored-data export.
    expect(csv).toContain('<script>window.__reviewPwned = 1</script>');
    await scanBothThemes(page, 'reviews-hostile-inventory');
  });

  await test.step('a citation-poor profile settles on the honest no-themes state', async () => {
    siteB = await createSite(page.request, 'https://reviews-bravo.example', 'Reviews bravo');
    await openReviews(page, siteB);
    await addSource(page, 'tripadvisor', TRIPADVISOR_TARGET);
    await selectSources(page, ['tripadvisor']);
    await estimate(page);
    const runId = await confirmSync(page);
    const run = await waitForReviewRun(page.request, runId);
    expect(run.status).toBe('succeeded');
    expect(run.retainedCount).toBe(1);
    // One stored review can never back a two-citation theme; the pass drops
    // everything rather than inventing one.
    expect(run.aiTerminalState).toBe('no-reliable-themes');
    expect(run.aiThemeCount).toBe(0);

    await openReviews(page, siteB);
    await expect(page.getByTestId('reviews-themes-none')).toBeVisible();
    await expect(page.getByTestId('reviews-themes')).toHaveCount(0);
    await expect(page.getByTestId('reviews-theme-praise-0')).toHaveCount(0);
    await expect(page.getByTestId(`reviews-run-ai-${runId}`)).toContainText('No solid themes');
    await scanBothThemes(page, 'reviews-no-themes');
  });

  await test.step('one failed source leaves the run partial and consumed', async () => {
    const before = reviewUsage(pro.id);
    siteC = await createSite(page.request, 'https://reviews-charlie.example', 'Reviews charlie');
    await openReviews(page, siteC);
    // The sentinel target makes the fake provider throw a terminal
    // VendorTimeoutError for Google only.
    await addSource(page, 'google', `${SCENARIO_PREFIX}timeout`);
    await addSource(page, 'trustpilot', TRUSTPILOT_TARGET);
    await addSource(page, 'tripadvisor', TRIPADVISOR_TARGET);
    await selectSources(page, ['google', 'trustpilot', 'tripadvisor']);
    await estimate(page);
    const runId = await confirmSync(page);
    const run = await waitForReviewRun(page.request, runId);
    expect(run.status).toBe('partial');
    // Rows were retained, so the unit stays consumed — no refund.
    expect(run.refunded).toBe(false);
    expect(run.retainedCount).toBe(2);
    expect(reviewUsage(pro.id)).toBe(before + 1);

    await openReviews(page, siteC);
    // Two sources settled `ok`, one `failed` — the chips report per source.
    await expect(page.getByTestId(`reviews-run-outcome-${runId}-google`)).toContainText('failed');
    for (const source of ['trustpilot', 'tripadvisor'] as const) {
      await expect(page.getByTestId(`reviews-run-outcome-${runId}-${source}`)).toContainText(
        'new reviews',
      );
    }
    await expect(page.getByTestId(`reviews-run-refunded-${runId}`)).toHaveCount(0);
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(2);
    await scanBothThemes(page, 'reviews-partial');
  });

  await test.step('the Arabic journey mirrors the sync path with logical layout', async () => {
    await openReviews(page, siteA, 'ar');
    await setLocale(page, 'ar');
    const panel = page.getByTestId('reviews-panel');
    await expect(panel).toHaveAttribute('dir', 'rtl');
    await expect(panel).toHaveAttribute('data-direction', 'rtl');
    await expect(panel).toContainText('المراجعات');

    const before = reviewUsage(pro.id);
    await selectSources(page, ['google']);
    await page.getByRole('button', { name: 'اعرض التكلفة' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reviews-preview')).toBeVisible();
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/local-seo/reviews/sync'),
    );
    await page.getByRole('button', { name: 'أكّد وشغّل' }).focus();
    await page.keyboard.press('Enter');
    const arabicRunId = (await json<SubmittedSync>(await started, 202)).runId;
    const run = await waitForReviewRun(page.request, arabicRunId);
    expect(run.status).toBe('succeeded');
    expect(reviewUsage(pro.id)).toBe(before + 1);

    await openReviews(page, siteA, 'ar');
    await expect(page.getByTestId('reviews-panel')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(7);
    await expect(page.getByTestId('reviews-trend-chart')).toHaveAttribute('data-rtl', 'true');
    await scanBothThemes(page, 'reviews-arabic');
    await setLocale(page, 'en');
  });

  await test.step('the drained cap discloses the review-syncs pack instead of spending', async () => {
    setReviewUsage(pro.id, 10, 10);
    await openReviews(page, siteA);
    await selectSources(page, ['google']);
    const preview = await estimate(page);
    // Every outbound credential is blank in the composed gate, so no pack is
    // purchasable: `packOverflow` is correctly omitted rather than offering a
    // pack this deployment cannot sell. The drained cap must still refuse the
    // spend, which is what the rest of this step asserts. The purchasable
    // variant is covered by the client unit suite with availability stubbed.
    expect(preview.packOverflow).toBeUndefined();
    expect(preview.cost.canFit).toBe(false);
    await expect(page.getByTestId('reviews-preview-pack-overflow')).toHaveCount(0);
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/local-seo/reviews/sync'),
    );
    await page.getByTestId('reviews-sync-confirm').focus();
    await page.keyboard.press('Enter');
    expect((await refused).status()).toBe(402);
    const cap = page.getByTestId('reviews-cap-reached');
    await expect(cap).toBeVisible();
    // No pack is purchasable in the zero-credential gate, so the cap card
    // refuses honestly instead of linking to a pack it cannot sell. The
    // purchasable "Buy a pack" variant is covered by the client unit suite.
    await expect(cap.getByRole('link', { name: 'Buy a pack' })).toHaveCount(0);
    // A refused submit never moves the counter past the cap.
    expect(reviewUsage(pro.id)).toBe(10);
    await scanBothThemes(page, 'reviews-cap-reached');
  });

  await test.step('the kill-switch response pauses new syncs while stored reads survive', async () => {
    setReviewUsage(pro.id, 2, 10);
    await openReviews(page, siteA);
    // The rollout flag is a boot-time env seam; the composed gate runs with it
    // ON so every metered path above is real. The disabled response shape is
    // reproduced at the transport boundary — the same 503 envelope the server
    // returns from `reviewIntelligence.errors.productUnavailable`.
    await page.route('**/api/local-seo/reviews/preview', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Content-Language': 'en',
          Vary: 'Accept-Language, x-lang',
        },
        body: JSON.stringify({
          error: {
            message: 'Review Intelligence is temporarily unavailable. Please try again later.',
          },
        }),
      });
    });
    await selectSources(page, ['google']);
    await page.getByTestId('reviews-sync-estimate').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reviews-kill-switch')).toBeVisible();
    await expect(page.getByTestId('reviews-sync-disabled')).toBeVisible();
    await expect(page.getByTestId('reviews-sync-confirm')).toHaveCount(0);
    // Everything already stored stays readable while new syncs are paused.
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr')).toHaveCount(7);
    await expect(page.getByTestId('reviews-stats')).toBeVisible();
    expect(reviewUsage(pro.id)).toBe(2);
    await scanBothThemes(page, 'reviews-kill-switch');
    await page.unroute('**/api/local-seo/reviews/preview');
  });

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
