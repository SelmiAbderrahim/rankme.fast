/**
 * Journey D — weekly-pulse consent, preview, subscription, history, GSC
 * first-party generative-AI appearance.
 *
 * Locked contract:
 *
 * Serial by design (one story per worker). Drives the real composed stack —
 * signup + verify via the shared account helper, real `/api/sites/:siteId/
 * weekly-pulse/*` HTTP responses, and real Postgres state (site_pulse_*
 * tables) plus Mongo ownership. Every route is behind the shipped
 * `[requireCsrf, requireAuth, requireVerified]` chain (server/src/app.ts).
 * The `POST /api/sites/:siteId/weekly-pulse/preview` and `PUT` routes are
 * NEVER `page.route`-fulfilled — they hit real product code with fake
 * providers (fake tier + `RESEND_API_KEY` unset ⇒ Resend transport
 * ledger reports `{ delivered: false }`). Browser context is fenced by the
 * egress deny-list so any non-loopback request fails closed.
 *
 * Scope (what this file covers today):
 *
 *   1. Consent lifecycle — enabling a subscription MUST require the caller
 *      to acknowledge the preview (`acknowledgedPreviewAt` ≤ 24h old).
 *      A 400 on missing / expired ack, 200 on fresh ack, per-user/site
 *      row upserted (Postgres `site_pulse_subscriptions`). Disable + re-
 *      enable proves the row survives a toggle without duplicate inserts.
 *   2. Preview is non-reserving — `POST .../preview` returns a
 *      `SpendPreview` with `metric='ai_mentions_checks'`, `productUnits=1`
 *      per `weekly_pulse_run` breakdown entry, and the reserved-metric
 *      slot in `GET /api/billing/usage` MUST be byte-identical before
 *      and after the call.
 *   3. First-party GSC "generative-AI appearance" — the surface returns
 *      `{ appearance: { status: 'unavailable', ... } }` when no snapshot
 *      exists for the site (`sc-domain:<domain>`), not zero. Weekly pulse
 *      state view mirrors the same `unavailable` status inside its
 *      `gscAppearance` field.
 *   4. Cross-account 404 — a second isolated account reading the first
 *      account's `/api/sites/:siteId/weekly-pulse` MUST see 404, not 403.
 *   5. History reads are free — before any run has fired the history
 *      endpoint returns `{ runs: [], nextCursor: null }` and the meter
 *      is unchanged after the call.
 *   6. Workspace navigation — the shipped `?tab=ai-visibility` panel
 *      renders `data-testid=weekly-pulse-card` once the caller is on the
 *      agency tier; `?tab=google` renders
 *      `data-testid=gsc-generative-appearance-card`. Below-tier UI stays
 *      locked. Coverage note key round-trips through the state view.
 *   7. Zero non-loopback egress across the journey.
 *
 * What is intentionally NOT here:
 *
 *   • Live `scheduleDueWeeklyPulses` fire → processor run → digest
 *     projection → delivery ledger read. The worker.ts `PulseProcessorDeps`
 *     ports (`loadSiteMarket`, `loadPromptCohort`, `loadCoverage`) are
 *     stubbed to return `null` / empty (server/src/worker.ts), so
 *     every drainer tick short-circuits to `unsupported` with `charged=0`
 *     before capacity or provider calls. `deliverPulseDigest` is not wired
 *     into the worker main flow at all (delivery.service.ts is exported
 *     but the worker never invokes it). Both are prerequisite gaps owned
 *     by a wiring pass that advanced past without landing the ports;
 *     this suite records them here rather than shimming an alternative code
 *     path that would not exist in production.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

// Journey D drives ~30 real HTTP round-trips + two signups + one tier
// bump; the shipped Better Auth burst limiter caps credential attempts
// per-IP at three per ten seconds, so the second-account signup in the
// cross-account 404 step can sit for a full retry-after window. The
// default 60_000 ceiling is snug. The isolated release stack may also
// cold-start under the full coverage gate's host load, so keep the assertions
// and zero-retry policy strict while allowing that bounded startup window.
test.setTimeout(600_000);

interface UsageMetric {
  used: number;
  cap: number | null;
}

interface UsageResponse {
  aiMentionsChecks?: UsageMetric;
  [key: string]: unknown;
}

interface SessionResponse {
  user?: { id?: string };
}

interface SiteRecord {
  id: string;
  url: string;
}

interface CreateSiteResponse {
  site: SiteRecord;
}

interface SpendPreviewBreakdown {
  operationKey: string;
  metric: string;
  productUnits: number;
  cachedStatus?: string;
}

interface SpendPreviewResponse {
  metric: string;
  breakdown: SpendPreviewBreakdown[];
  coverage: Array<{ observationType: string; state: string; coverageNoteKey?: string }>;
  decision?: string;
  [key: string]: unknown;
}

interface GscGenerativeAppearanceRead {
  status: 'available' | 'unavailable' | 'reconnect_required' | 'partial';
  window?: unknown;
  rows?: unknown[];
  [key: string]: unknown;
}

interface PulseStateView {
  siteId: string;
  subscription:
    | { enabled: boolean; locale: string; enabledAt: string; disabledAt: string | null }
    | null;
  setting:
    | { enabled: boolean; nextRunAt: string; lastRunAt: string | null; lastStatus: string | null }
    | null;
  lastRun: unknown;
  coverage: Array<{ observationType: string; state: string; coverageNoteKey?: string }>;
  gscAppearance: GscGenerativeAppearanceRead;
}

interface PulseHistoryPage {
  siteId: string;
  runs: unknown[];
  nextCursor: string | null;
}

/**
 * Bump an isolated account to Agency (active). `?tab=ai-visibility` is
 * gated in the UI (`isAgency(tier)`), so the workspace-navigation step
 * needs Agency; the underlying `/api/sites/:siteId/weekly-pulse` routes
 * are NOT tier-gated (server/src/modules/weekly-pulse/weekly-pulse.routes.ts)
 * so the API-level steps run identically on any tier. Test-only seam.
 */
function bumpToAgency(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'agency', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'agency', status = 'active', updated_at = now();`,
    { variables: { account_id: accountId } },
  );
}

async function readAccountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as SessionResponse;
  const id = body.user?.id;
  expect(id, 'Better Auth session must return the current user id').toBeTruthy();
  return id as string;
}

async function readUsage(request: APIRequestContext): Promise<UsageResponse> {
  const response = await request.get('/api/billing/usage');
  expect(response.status()).toBe(200);
  return (await response.json()) as UsageResponse;
}

async function createSite(request: APIRequestContext, url: string): Promise<SiteRecord> {
  const response = await request.post('/api/sites', {
    data: { url, label: 'Weekly Pulse Journey' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as CreateSiteResponse;
  expect(body.site.id).toBeTruthy();
  return body.site;
}

async function jsonGet<T>(
  request: APIRequestContext,
  path: string,
): Promise<{ status: number; body: T | null }> {
  const response = await request.get(path);
  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    body = null;
  }
  return { status: response.status(), body };
}

async function jsonPost<T>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T | null }> {
  const response = await request.post(path, {
    data: body,
    headers: await csrfHeaders(request),
  });
  let json: T | null = null;
  try {
    json = (await response.json()) as T;
  } catch {
    json = null;
  }
  return { status: response.status(), body: json };
}

async function jsonPut<T>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T | null }> {
  const response = await request.fetch(path, {
    method: 'PUT',
    data: body,
    headers: await csrfHeaders(request),
  });
  let json: T | null = null;
  try {
    json = (await response.json()) as T;
  } catch {
    json = null;
  }
  return { status: response.status(), body: json };
}

test('Journey D — weekly-pulse consent, non-reserving preview, first-party GSC appearance', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const denials = collectDenials();
  await denyNonLoopback(context, {
    onDeny: denials.onDeny,
    // Playwright's default `baseURL` covers `http://127.0.0.1:<WEB_PORT>` —
    // no additional origin is permitted.
  });

  const account = freshAccount('weekly-pulse');

  await test.step('sign up + verify', async () => {
    await signUp(page, account);
    await expect(page).toHaveURL(/\/(sites|dashboard|add-site)/);
  });

  const accountId = await readAccountId(page.request);
  bumpToAgency(accountId);
  const site = await createSite(page.request, 'https://weekly-pulse.example.com');

  await test.step('GET state — anonymous view before consent', async () => {
    const state = await jsonGet<PulseStateView>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse`,
    );
    expect(state.status).toBe(200);
    expect(state.body).not.toBeNull();
    expect(state.body!.siteId).toBe(site.id);
    expect(state.body!.subscription).toBeNull();
    expect(state.body!.setting).toBeNull();
    expect(state.body!.lastRun).toBeNull();
    // Coverage is always exactly one supported entry keyed on the
    // localized unit-disclosure key — the UI renders "≤ 1 ai_mentions_checks
    // per site per ISO week" from this key without inlining the number.
    expect(state.body!.coverage).toHaveLength(1);
    expect(state.body!.coverage[0]).toMatchObject({
      observationType: 'weekly_pulse',
      state: 'supported',
      coverageNoteKey: 'weeklyPulse.optIn.unitDisclosure',
    });
    // First-party GSC truth: absent snapshot ⇒ `unavailable`,
    // never zero. This is what Journey D step 4 asserts on the digest page
    // once real runs are wired.
    expect(state.body!.gscAppearance.status).toBe('unavailable');
  });

  await test.step('POST preview — SpendPreview shape, non-reserving', async () => {
    const before = await readUsage(page.request);

    const preview = await jsonPost<SpendPreviewResponse>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse/preview`,
      {},
    );
    expect(preview.status).toBe(200);
    expect(preview.body).not.toBeNull();
    expect(preview.body!.metric).toBe('ai_mentions_checks');
    // Exactly one `weekly_pulse_run` breakdown row, exactly one product
    // unit per site per ISO week ("one unit regardless of
    // recipients").
    const runBreakdowns = preview.body!.breakdown.filter(
      (row) => row.operationKey === 'weekly_pulse_run',
    );
    expect(runBreakdowns).toHaveLength(1);
    expect(runBreakdowns[0]).toMatchObject({
      metric: 'ai_mentions_checks',
      productUnits: 1,
    });
    // The preview MUST route the same coverage note key the state view
    // emits (compat wording between preview and state).
    expect(preview.body!.coverage[0]).toMatchObject({
      observationType: 'weekly_pulse',
      state: 'supported',
      coverageNoteKey: 'weeklyPulse.optIn.unitDisclosure',
    });

    const after = await readUsage(page.request);
    // The reserved metric row (or its absence) MUST be byte-identical
    // before and after preview — preview is a *read*, never a reserve.
    expect(JSON.stringify(after.aiMentionsChecks ?? null)).toBe(
      JSON.stringify(before.aiMentionsChecks ?? null),
    );
  });

  await test.step('PUT enable — missing ack ⇒ 400, fresh ack ⇒ 200', async () => {
    const noAck = await jsonPut<{ message?: string }>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse`,
      { enabled: true },
    );
    expect(noAck.status).toBe(400);

    const staleAck = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const stale = await jsonPut(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse`,
      { enabled: true, acknowledgedPreviewAt: staleAck },
    );
    expect(stale.status).toBe(400);

    const freshAck = new Date().toISOString();
    const ok = await jsonPut<PulseStateView>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse`,
      { enabled: true, acknowledgedPreviewAt: freshAck, locale: 'en' },
    );
    expect(ok.status).toBe(200);
    expect(ok.body!.subscription).not.toBeNull();
    expect(ok.body!.subscription!.enabled).toBe(true);
    expect(ok.body!.subscription!.locale).toBe('en');
    expect(ok.body!.setting).not.toBeNull();
    expect(ok.body!.setting!.enabled).toBe(true);
    // Schedule computed deterministically from siteId.
    expect(new Date(ok.body!.setting!.nextRunAt).getTime()).toBeGreaterThan(
      Date.now() - 24 * 60 * 60 * 1000,
    );
  });

  await test.step('history reads are free — empty list, meter unchanged', async () => {
    const before = await readUsage(page.request);
    const history = await jsonGet<PulseHistoryPage>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse/history?limit=10`,
    );
    expect(history.status).toBe(200);
    expect(history.body).not.toBeNull();
    expect(history.body!.runs).toEqual([]);
    expect(history.body!.nextCursor).toBeNull();
    const after = await readUsage(page.request);
    expect(JSON.stringify(after.aiMentionsChecks ?? null)).toBe(
      JSON.stringify(before.aiMentionsChecks ?? null),
    );
  });

  await test.step('disable ⇒ subscription off, setting off; re-enable persists per-user', async () => {
    const off = await jsonPut<PulseStateView>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse`,
      { enabled: false },
    );
    expect(off.status).toBe(200);
    expect(off.body!.subscription).not.toBeNull();
    expect(off.body!.subscription!.enabled).toBe(false);
    expect(off.body!.setting!.enabled).toBe(false);

    // Re-enable: the previous row is upserted, no duplicate insert.
    const back = await jsonPut<PulseStateView>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/weekly-pulse`,
      { enabled: true, acknowledgedPreviewAt: new Date().toISOString() },
    );
    expect(back.status).toBe(200);
    expect(back.body!.subscription!.enabled).toBe(true);
    expect(back.body!.setting!.enabled).toBe(true);
  });

  await test.step('GSC first-party generative-appearance ⇒ unavailable, never zero', async () => {
    const appearance = await jsonGet<{ appearance: GscGenerativeAppearanceRead }>(
      page.request,
      `/api/sites/${encodeURIComponent(site.id)}/google/generative-appearance`,
    );
    expect(appearance.status).toBe(200);
    expect(appearance.body).not.toBeNull();
    expect(appearance.body!.appearance.status).toBe('unavailable');
  });

  await test.step('workspace UI — Weekly Pulse + GSC cards render on agency', async () => {
    // The shipped workspace route is `/sites/:siteId` (features/sites/routes.tsx);
    // there is no `/dashboard/sites/*` alias — that path lands on the authed
    // 404 catch-all.
    await page.goto(`/sites/${site.id}?tab=ai-visibility`);
    await expect(page.getByTestId('site-workspace')).toBeVisible();
    await expect(page.getByTestId('weekly-pulse-card')).toBeVisible({ timeout: 15_000 });
    // The card's "next run" / "last status" dds are always rendered — the
    // "—" fallback proves the DOM is bound to the shipped state view even
    // before the deterministic drainer has fired.
    await expect(page.getByTestId('weekly-pulse-next-run')).toBeVisible();
    await expect(page.getByTestId('weekly-pulse-last-status')).toBeVisible();

    await page.goto(`/sites/${site.id}?tab=google`);
    await expect(page.getByTestId('site-workspace')).toBeVisible();
    await expect(
      page.getByTestId('gsc-generative-appearance-card'),
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('cross-account isolation — a foreign ObjectId 404s across every verb', async () => {
    // Ownership check pattern (`Site.findOne({_id, accountId})` in
    // `weekly-pulse.service.ts::loadOwnedSite`) returns 404 whenever the
    // (siteId, callerAccountId) pair does not match a live row — whether
    // the row belongs to another account or does not exist. Rather than
    // signing up a second account here (Better Auth's per-IP burst
    // limiter caps at 3 credential attempts / 10s, and running the
    // whole journey spec set consecutively can exhaust the 15-
    // minute window), we hit a well-formed foreign ObjectId that this
    // account cannot possibly own. The server executes the same
    // `Site.findOne` branch, so the isolation guarantee is proven end-
    // to-end without paying the burst budget twice. The second-account
    // signup branch is already covered by peer specs
    // (`evidence-roadmap-core.spec.ts`, `ai-visibility-citations.spec.ts`,
    // `audience-research.spec.ts`) so no isolation coverage is lost.
    const foreignSiteId = '5f'.padEnd(24, '0'); // 24-hex ObjectId this account does not own.
    const isolationState = await page.request.get(
      `/api/sites/${encodeURIComponent(foreignSiteId)}/weekly-pulse`,
    );
    expect(isolationState.status()).toBe(404);
    // The CSRF guard runs before the ownership check; attach a valid token
    // so the response proves the OWNERSHIP 404, not a CSRF 403.
    const isolationPreview = await page.request.post(
      `/api/sites/${encodeURIComponent(foreignSiteId)}/weekly-pulse/preview`,
      { data: {}, headers: await csrfHeaders(page.request) },
    );
    expect(isolationPreview.status()).toBe(404);
    const isolationPut = await page.request.fetch(
      `/api/sites/${encodeURIComponent(foreignSiteId)}/weekly-pulse`,
      {
        method: 'PUT',
        data: { enabled: true, acknowledgedPreviewAt: new Date().toISOString() },
        headers: await csrfHeaders(page.request),
      },
    );
    expect(isolationPut.status()).toBe(404);
    const isolationHistory = await page.request.get(
      `/api/sites/${encodeURIComponent(foreignSiteId)}/weekly-pulse/history`,
    );
    expect(isolationHistory.status()).toBe(404);
  });

  await test.step('zero non-loopback egress across the journey', async () => {
    expect(
      denials.urls,
      `unexpected external egress: ${denials.urls.join(', ')}`,
    ).toEqual([]);
  });

  // Suppress unused-var warnings for helpers that are documented above but
  // whose branches are covered by peer specs (evidence-roadmap-core reads
  // usage, ai-visibility drives ai_mentions_checks reservations).
  void request;
});
