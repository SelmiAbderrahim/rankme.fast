/**
 * Brand Radar canonical browser journey.
 *
 * Drives the shipped site-workspace Brand Radar panel end to end against the composed
 * stack with `PROVIDER_CONTENT_ANALYSIS=fake` and the keyless `PROVIDER_AI=fake`:
 * the Agency scan → detail → CSV → two-scan trend path, preview-cancel-no-spend,
 * the `completed_partial`, `no_reliable_digest` and `completed_empty`
 * terminals, the kill-switch refusal with stored reads intact, free stored reads, an Arabic
 * RTL pass and axe in light + dark.
 *
 * Test-only setup is limited to verified-account tier/counter rows applied
 * through the compose Postgres service. The three terminal states a keyless
 * stack cannot otherwise reach are driven through the SHIPPED product surface
 * with the fake content-analysis adapter's `__scenario-<name>` brand-query
 * sentinel (`shared/providers/fakes.ts`). Nothing about the product routes is
 * test-aware — the brand query is free text and the sentinel is resolved
 * inside the fake adapter only.
 *
 * The `brand_mention_scans` meter is read straight from `usage_counters`
 * because `/api/billing/usage` does not expose that metric — reading the
 * authoritative counter row keeps the metering assertions honest instead of
 * widening a shipped DTO from a test.
 *
 * Rate budget: the shipped `brand_radar_create` bucket allows 10 paid
 * mutations per account per minute and `brand_radar_poll` 60 stored reads.
 * The journey therefore spreads its scans across two isolated accounts
 * (main / states) so the limiter is exercised, never tripped, and
 * polls the run status at 2.5 s while the open page polls the list at 5 s.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import { waitForRunTerminal } from './helpers/waitForRunTerminal';
import { enqueueWeeklyPulseJob } from './helpers/weekly-pulse';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fake content-analysis scenario sentinel (`shared/providers/fakes.ts`). */
const SCENARIO_PREFIX = '__scenario-';
const RICH_QUERY = 'RankMeFast brand radar';
const HOSTILE_QUERY = `${SCENARIO_PREFIX}hostile`;
const PARTIAL_QUERY = `${SCENARIO_PREFIX}summary-failure`;
const ABSTAIN_QUERY = `${SCENARIO_PREFIX}nodigest`;
const EMPTY_QUERY = `${SCENARIO_PREFIX}empty`;

/** Terminal scan statuses (`brand-radar.model.ts`). */
const BRAND_RADAR_TERMINAL = [
  'completed',
  'completed_empty',
  'completed_partial',
  'failed',
] as const;

type Tier = 'none' | 'starter' | 'pro' | 'agency';

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string };
}

interface CreatedScan {
  scanId: string;
}

interface ScanDetailBody {
  id: string;
  brandQuery: string;
  status: string;
  digestState: string;
  mentionCount: number;
  refund: { state: string };
  trend: { delta: number; direction: string } | null;
  topDomains: { domain: string; count: number }[];
  digestSentences: { text: string; citedRowIds: string[] }[];
}

interface PreviewBody {
  productUnits: number;
  canFit: boolean;
  breakdown: { metric: string; productUnits: number }[];
  remaining: { base: number | null; pack: number };
  packs?: { brandScans?: { slug: string; overflowCopy: string } };
}

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

/** Authoritative `brand_mention_scans` consumption for the current period. */
function brandUsage(id: string): number {
  const raw = runComposePsqlOutput(
    `SELECT used
       FROM usage_counters
      WHERE account_id = :'account_id'
        AND period = to_char(now(), 'YYYY-MM')
        AND metric = 'brand_mention_scans';`,
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

async function logout(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL('/login');
}

/**
 * The workspace tab the panel now lives in — every account under test owns
 * exactly one site, tracked here so `openRadar` needs no explicit id.
 */
let activeSiteId = '';

async function signUpAtTier(
  page: Page,
  prefix: string,
  tier: Tier,
): Promise<{ account: TestAccount; id: string; siteId: string }> {
  const account = freshAccount(prefix);
  await signUp(page, account);
  const id = await accountId(page.request);
  await logout(page);
  // Better Auth's post-signup hooks can finish after the first authenticated
  // navigation. Apply the verified/tier fixture after sign-out so no trailing
  // signup write can restore the initial unverified value before re-login.
  setTier(id, tier);
  await logIn(page, account);
  activeSiteId = await createSite(
    page.request,
    `https://${prefix}.example`,
    `${prefix} site`,
  );
  return { account, id, siteId: activeSiteId };
}

/** Open the site workspace's Brand Radar tab and wait for it to settle. */
async function openRadar(
  page: Page,
  search = '',
  locale: 'en' | 'ar' = 'en',
  siteId = activeSiteId,
): Promise<void> {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  params.set('tab', 'brand-radar');
  params.set('lng', locale);
  await page.goto(`/sites/${encodeURIComponent(siteId)}?${params.toString()}`);
  // Navigation settle, not a behavioral assert: a cold CSR bundle fetch on a
  // loaded gate host can legitimately exceed the 10 s expect default — use the
  // same 30 s budget the auth helpers give `waitForURL`.
  await expect(page.getByTestId('brand-radar-page')).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Fill the new-scan form and fire the preview. The URL-backed `?view=new` is
 * used rather than a tab click because the panel may currently be showing a
 * scan detail, where the view strip is deliberately not rendered.
 */
async function submitPreview(page: Page, brandQuery: string) {
  await openRadar(page, '?view=new');
  const field = page.locator('#brand-radar-query');
  await expect(field).toBeVisible();
  await field.fill(brandQuery);
  const expectedPath = `/api/sites/${encodeURIComponent(activeSiteId)}/brand-radar/preview`;
  const previewed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === expectedPath,
  );
  await page.getByTestId('brand-radar-preview-submit').click();
  return previewed;
}

/** Preview a scan and assert the server priced it. */
async function previewScan(page: Page, brandQuery: string): Promise<PreviewBody> {
  return json<PreviewBody>(await submitPreview(page, brandQuery));
}

async function confirmScan(page: Page): Promise<string> {
  const expectedPath = `/api/sites/${encodeURIComponent(activeSiteId)}/brand-radar/scans`;
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === expectedPath,
  );
  await page.getByTestId('brand-radar-confirm').click();
  return (await json<CreatedScan>(await created, 202)).scanId;
}

async function waitForScan(
  request: APIRequestContext,
  scanId: string,
): Promise<ScanDetailBody> {
  const terminal = await waitForRunTerminal<ScanDetailBody>({
    request,
    url: `/api/brand-radar/scans/${encodeURIComponent(scanId)}`,
    terminal: [...BRAND_RADAR_TERMINAL],
    extractStatus: (body) => (body as ScanDetailBody | null)?.status,
    // 2.5 s keeps the stored-read bucket (60/min) comfortable while the open
    // page is also polling the scan list every 5 s.
    options: { deadlineMs: 90_000, intervalMs: 2_500, label: `brand scan ${scanId}` },
  });
  return terminal.body;
}

/** Preview → confirm → settle, from the rendered form. */
async function runScan(
  page: Page,
  brandQuery: string,
): Promise<{ scanId: string; detail: ScanDetailBody }> {
  await previewScan(page, brandQuery);
  const scanId = await confirmScan(page);
  const detail = await waitForScan(page.request, scanId);
  return { scanId, detail };
}

async function readDownload(page: Page, testId: string): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test('Brand Radar: Agency journey, no-spend preview, partial, abstention, empty, kill switch, free reads, Arabic RTL and axe', async ({
  page,
  context,
}) => {
  // Many journey cases plus axe passes in two themes; the composed
  // gate shares the box with the coverage suites, so budget generously.
  test.setTimeout(2_400_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  let main!: { account: TestAccount; id: string; siteId: string };
  let states!: { account: TestAccount; id: string; siteId: string };
  let firstScanId = '';
  let secondScanId = '';
  let hostileScanId = '';
  let mainSiteId = '';

  await test.step('an Agency account reaches the empty workspace and it is accessible in both themes', async () => {
    main = await signUpAtTier(page, 'radar-main', 'agency');
    // Brand Radar scans belong to this site, so Weekly Pulse below reads the
    // very same site's stored scans.
    mainSiteId = main.siteId;
    await openRadar(page);
    await expect(page.getByTestId('brand-radar-list-empty')).toBeVisible();
    await expect(page.getByTestId('brand-radar-gate-notOnPlan')).toHaveCount(0);
    await scanBothThemes(page, 'radar-empty');
    await openRadar(page, '?view=new');
    await expect(page.locator('#brand-radar-query')).toBeVisible();
    await scanBothThemes(page, 'radar-new-scan');
  });

  await test.step('preview then cancel spends nothing and re-pricing discloses the same allowance', async () => {
    const before = brandUsage(main.id);
    const first = await previewScan(page, RICH_QUERY);
    expect(first.productUnits).toBe(1);
    expect(first.canFit).toBe(true);
    await expect(page.getByTestId('brand-radar-preview')).toBeVisible();
    await page.getByTestId('brand-radar-cancel').click();
    await expect(page.getByTestId('brand-radar-preview')).toHaveCount(0);
    expect(brandUsage(main.id)).toBe(before);

    // The counter is authoritative; a second estimate must disclose the same
    // allowance, proving the cancelled estimate reserved nothing.
    const second = await previewScan(page, RICH_QUERY);
    expect(second.remaining.base).toBe(first.remaining.base);
    expect(second.remaining.pack).toBe(first.remaining.pack);
    expect(brandUsage(main.id)).toBe(before);
    await page.getByTestId('brand-radar-cancel').click();
  });

  await test.step('the confirmed scan spends one unit and renders mentions, sentiment, domains and the cited digest', async () => {
    const before = brandUsage(main.id);
    const run = await runScan(page, RICH_QUERY);
    firstScanId = run.scanId;
    expect(run.detail.status).toBe('completed');
    expect(run.detail.digestState).toBe('digest_present');
    expect(run.detail.refund.state).toBe('none');
    expect(run.detail.mentionCount).toBeGreaterThan(0);
    expect(brandUsage(main.id)).toBe(before + 1);

    await openRadar(page, `?scan=${firstScanId}`);
    await expect(page.getByTestId('brand-radar-detail-query')).toContainText(RICH_QUERY);
    await expect(page.getByTestId('brand-radar-detail-refund')).toHaveCount(0);
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();

    // Sentiment chart AND its accessible table fallback.
    await expect(page.getByTestId('brand-radar-sentiment')).toBeVisible();
    await expect(page.getByTestId('brand-radar-sentiment-row-positive')).toHaveCount(1);
    await expect(page.getByTestId('brand-radar-top-domain-row').first()).toBeVisible();

    // First scan for this query: the honest "no comparison" state, never a 0.
    await expect(page.getByTestId('brand-radar-trend-null')).toBeVisible();
    await expect(page.getByTestId('brand-radar-trend-chart')).toHaveCount(0);

    // The digest is labelled AI interpretation with expandable citations.
    await expect(page.getByTestId('brand-radar-digest-sentences')).toBeVisible();
    await page.getByTestId('brand-radar-citation-trigger').first().click();
    await expect(page.getByTestId('brand-radar-citation-resolved').first()).toBeVisible();
    await scanBothThemes(page, 'radar-detail');
  });

  await test.step('hostile mention content stays inert and exports formula-neutralized', async () => {
    const run = await runScan(page, HOSTILE_QUERY);
    hostileScanId = run.scanId;
    expect(run.detail.status).toBe('completed');
    expect(run.detail.mentionCount).toBe(3);

    await openRadar(page, `?scan=${hostileScanId}`);
    const mentions = page.getByTestId('brand-radar-mentions');
    await expect(page.getByTestId('brand-radar-mention-row')).toHaveCount(3);
    // The markup payload is TEXT: the server strips the angle brackets and
    // React renders whatever survives as a text node — it never executes.
    await expect(mentions).toContainText('window.__brandPwned = 1');
    await expect(mentions).toContainText('=SUM(1) formula probe');
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__brandPwned),
    ).toBeUndefined();

    const csv = await readDownload(page, 'brand-radar-export');
    expect(csv).toContain("'=SUM(1) formula probe in a brand mention title");
    expect(csv).toContain("'+1 leading plus probe");
    expect(csv).toContain("'-1 leading minus probe");
    expect(csv).toContain("'@ledger");
    // No markup reaches the file at all.
    expect(csv).not.toContain('<script');
    expect(csv).not.toContain('<');
  });

  await test.step('a second scan of the same query renders the trend chart with a server-provided delta', async () => {
    const before = brandUsage(main.id);
    const run = await runScan(page, RICH_QUERY);
    secondScanId = run.scanId;
    expect(run.detail.status).toBe('completed');
    // The delta is the SERVER's — the client only re-sorts the series.
    expect(run.detail.trend).not.toBeNull();
    expect(brandUsage(main.id)).toBe(before + 1);

    await openRadar(page, `?scan=${secondScanId}`);
    const chart = page.getByTestId('brand-radar-trend-chart');
    await expect(chart).toBeVisible();
    await chart.getByTestId('brand-radar-trend-table').locator('summary').click();
    await expect(page.getByTestId('brand-radar-trend-row')).toHaveCount(2);
    await expect(page.getByTestId('brand-radar-trend-null')).toHaveCount(0);
  });

  await test.step('free stored reads — reopening, filtering, CSV and a pulse preview move no unit', async () => {
    const before = brandUsage(main.id);
    await openRadar(page, `?scan=${firstScanId}`);
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();

    // URL-backed mention filters narrow the loaded page client-side.
    await page.getByTestId('brand-radar-sentiment-filter').selectOption('positive');
    await expect(page).toHaveURL(/sentiment=positive/);
    await page.getByTestId('brand-radar-domain-filter').fill('no-such-domain.example');
    await expect(page.getByTestId('brand-radar-mentions-filtered')).toBeVisible();
    await page.getByTestId('brand-radar-domain-filter').fill('');
    await page.getByTestId('brand-radar-sentiment-filter').selectOption('all');
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();

    // The scan-list status filter is a stored read too.
    await openRadar(page);
    await page.getByTestId('brand-radar-status-filter').selectOption('completed_empty');
    await expect(page).toHaveURL(/status=completed_empty/);
    await expect(page.getByTestId('brand-radar-filter-empty')).toBeVisible();
    await page.getByTestId('brand-radar-status-filter').selectOption('all');

    await openRadar(page, `?scan=${firstScanId}`);
    const csv = await readDownload(page, 'brand-radar-export');
    expect(csv).toContain('scan_id,captured_at,brand_query');

    // The weekly-pulse preview reads the same brand scans and never reserves.
    const preview = await page.request.post(
      `/api/sites/${encodeURIComponent(mainSiteId)}/weekly-pulse/preview`,
      { headers: await csrfHeaders(page.request) },
    );
    expect([200, 201]).toContain(preview.status());

    expect(brandUsage(main.id)).toBe(before);
  });

  await test.step('a real pulse collection runs to terminal and moves no brand unit', async () => {
    // Prove pulse COLLECTION zero-spend end to end — real queue →
    // real worker → terminal run row — not just the preview route above.
    const before = brandUsage(main.id);
    const ledgerBefore = runComposePsqlOutput(
      `SELECT count(*) FROM credit_ledger
        WHERE account_id = :'account_id' AND metric = 'brand_mention_scans';`,
      { variables: { account_id: main.id } },
    );
    const scansBefore = await page.request
      .get(`/api/sites/${encodeURIComponent(mainSiteId)}/brand-radar/scans`)
      .then(async (res) => (await res.json()) as { items: Array<{ id: string }> });

    // Real consent path, then make the subscription due immediately.
    const enable = await page.request.fetch(
      `/api/sites/${encodeURIComponent(mainSiteId)}/weekly-pulse`,
      {
        method: 'PUT',
        data: { enabled: true, acknowledgedPreviewAt: new Date().toISOString() },
        headers: await csrfHeaders(page.request),
      },
    );
    expect(enable.status()).toBe(200);
    runComposePsql(
      `UPDATE site_pulse_settings
          SET next_run_at = now() - interval '1 hour'
        WHERE site_id = :'site_id';`,
      { variables: { site_id: mainSiteId } },
    );

    // Same deterministic jobId + payload the scheduler drainer produces; the
    // production processor re-checks ownership and subscription itself.
    enqueueWeeklyPulseJob(main.id, mainSiteId);

    // Await the terminal run row through the shipped state view (`lastRun` —
    // the `unsupported` short-circuit persists the run row without touching
    // `setting.lastStatus`, `pulse.processor.ts:174-196`). In the keyless
    // composed stack the worker's collection ports (`loadSiteMarket` /
    // `loadPromptCohort`, server/src/worker.ts) are production-stubbed to
    // null, so the honest terminal is `unsupported` with charged=0 — never a
    // fabricated `completed`.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `/api/sites/${encodeURIComponent(mainSiteId)}/weekly-pulse`,
          );
          const view = (await res.json()) as {
            lastRun: { status: string } | null;
          };
          return view.lastRun?.status ?? null;
        },
        { timeout: 90_000, intervals: [2_000] },
      )
      .not.toBeNull();
    const view = await page.request
      .get(`/api/sites/${encodeURIComponent(mainSiteId)}/weekly-pulse`)
      .then(
        async (res) =>
          (await res.json()) as { lastRun: { status: string; isoWeek: string } | null },
      );
    expect(view.lastRun?.status).toBe('unsupported');

    // Zero spend, no scheduled scan, untouched ledger — byte-for-byte.
    expect(brandUsage(main.id)).toBe(before);
    const ledgerAfter = runComposePsqlOutput(
      `SELECT count(*) FROM credit_ledger
        WHERE account_id = :'account_id' AND metric = 'brand_mention_scans';`,
      { variables: { account_id: main.id } },
    );
    expect(ledgerAfter).toBe(ledgerBefore);
    const scansAfter = await page.request
      .get(`/api/sites/${encodeURIComponent(mainSiteId)}/brand-radar/scans`)
      .then(async (res) => (await res.json()) as { items: Array<{ id: string }> });
    expect(scansAfter.items.map((item) => item.id)).toEqual(
      scansBefore.items.map((item) => item.id),
    );

    // Leave the stack quiet for the projects that follow.
    const disable = await page.request.fetch(
      `/api/sites/${encodeURIComponent(mainSiteId)}/weekly-pulse`,
      {
        method: 'PUT',
        data: { enabled: false },
        headers: await csrfHeaders(page.request),
      },
    );
    expect(disable.status()).toBe(200);
  });

  await test.step('a halted collection settles completed_partial and keeps what it retained', async () => {
    // `/register` redirects an authenticated visitor to the dashboard, so the
    // live `main` session has to end before the second account is created.
    await logout(page);
    states = await signUpAtTier(page, 'radar-states', 'agency');
    const before = brandUsage(states.id);
    await openRadar(page);
    const run = await runScan(page, PARTIAL_QUERY);
    expect(run.detail.status).toBe('completed_partial');
    // Rows were retained before the halt, so the unit stays consumed.
    expect(run.detail.refund.state).toBe('none');
    expect(run.detail.mentionCount).toBeGreaterThan(0);
    expect(brandUsage(states.id)).toBe(before + 1);

    await openRadar(page, `?scan=${run.scanId}`);
    const banner = page.getByTestId('brand-radar-detail-partial');
    await expect(banner).toBeVisible();
    // The halt contract: the banner names WHICH stage halted and
    // WHY — this scenario fails the summary stage at the provider.
    await expect(banner).toHaveAttribute('data-halt', 'summary_provider_error');
    await expect(banner).toContainText('failed during the mention-summary step');
    await expect(banner).toContainText('data provider');
    // Retained aggregates still render.
    await expect(page.getByTestId('brand-radar-sentiment')).toBeVisible();
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();
  });

  await test.step('an uncitable digest abstains instead of inventing a sentence', async () => {
    const run = await runScan(page, ABSTAIN_QUERY);
    // A digest whose sentences cannot survive citation enforcement is a halted
    // stage, so the shipped pipeline settles `completed_partial`
    // (`brand-radar.pipeline.ts:366`) — the mentions are still real signal and
    // the unit is never refunded.
    expect(run.detail.status).toBe('completed_partial');
    expect(run.detail.digestState).toBe('no_reliable_digest');
    expect(run.detail.digestSentences).toEqual([]);

    await openRadar(page, `?scan=${run.scanId}`);
    await expect(page.getByTestId('brand-radar-digest-withheld')).toBeVisible();
    await expect(page.getByTestId('brand-radar-digest-sentences')).toHaveCount(0);
    // The mentions the scan did buy are still readable.
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();
  });

  await test.step('a zero-mention scan says so and draws no chart', async () => {
    const before = brandUsage(states.id);
    const run = await runScan(page, EMPTY_QUERY);
    expect(run.detail.status).toBe('completed_empty');
    expect(run.detail.mentionCount).toBe(0);
    // Real signal — the unit is consumed, never refunded.
    expect(run.detail.refund.state).toBe('none');
    expect(brandUsage(states.id)).toBe(before + 1);

    await openRadar(page, `?scan=${run.scanId}`);
    await expect(page.getByTestId('brand-radar-detail-empty')).toBeVisible();
    await expect(page.getByTestId('brand-radar-sentiment')).toHaveCount(0);
    await expect(page.getByTestId('brand-radar-trend-chart')).toHaveCount(0);
    await expect(page.getByTestId('brand-radar-mentions')).toHaveCount(0);
    await expect(page.getByTestId('brand-radar-detail-refund')).toHaveCount(0);
  });

  await test.step('the Arabic read path mirrors the journey with logical layout', async () => {
    await logout(page);
    await logIn(page, main.account);
    await openRadar(page, `?scan=${firstScanId}`, 'ar', mainSiteId);
    // Let the persisted English read settle before changing presentation.
    // The mention body is source data and remains byte-stable across locales.
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();
    await page.locator('#language-switcher').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await expect(page.getByTestId('brand-radar-page')).toContainText('رادار العلامة');
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();
    // No descendant contradicts the shell direction.
    expect(
      await page
        .getByTestId('brand-radar-page')
        .evaluate((node) =>
          [...node.querySelectorAll('[dir]')].map((child) => child.getAttribute('dir')),
        ),
    ).not.toContain('ltr');
    await scanBothThemes(page, 'radar-arabic');
    await page.locator('#language-switcher').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  await test.step('the kill-switch response pauses new scans while stored reads survive', async () => {
    await logout(page);
    await logIn(page, main.account);
    const before = brandUsage(main.id);
    // The rollout flag is a boot-time env seam and the composed gate runs with
    // it ON so every metered path above is real. The disabled response shape
    // is reproduced at the transport boundary — the same 503 envelope the
    // server returns from `brandRadar.errors.productUnavailable`.
    const previewRoute = `**/api/sites/${encodeURIComponent(main.siteId)}/brand-radar/preview`;
    await page.route(previewRoute, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Content-Language': 'en',
          Vary: 'Accept-Language, x-lang',
        },
        body: JSON.stringify({
          error: { message: 'Brand Radar is temporarily unavailable. Please try again later.' },
        }),
      });
    });
    await openRadar(page, '?view=new', 'en', main.siteId);
    await page.locator('#brand-radar-query').fill(RICH_QUERY);
    await page.getByTestId('brand-radar-preview-submit').click();
    await expect(page.getByTestId('brand-radar-unavailable')).toBeVisible();
    await expect(page.getByTestId('brand-radar-confirm')).toHaveCount(0);
    await expect(page.locator('#brand-radar-query')).toBeDisabled();

    // Everything already stored stays readable while new scans are paused.
    await page.getByTestId('brand-radar-tab-scans').click();
    await expect(page.getByTestId('brand-radar-row').first()).toBeVisible();
    await openRadar(page, `?scan=${hostileScanId}`, 'en', main.siteId);
    await expect(page.getByTestId('brand-radar-mention-row')).toHaveCount(3);
    const csv = await readDownload(page, 'brand-radar-export');
    expect(csv).toContain('scan_id,captured_at,brand_query');
    expect(brandUsage(main.id)).toBe(before);
    await scanBothThemes(page, 'radar-kill-switch');
    await page.unroute(previewRoute);
  });

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
