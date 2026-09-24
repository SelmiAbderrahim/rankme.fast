/**
 * Next Actions workspace end-to-end journey.
 *
 * Serial by design (one story per worker). Drives the real composed stack —
 * signup + verify via the account helper, real `/api/*` responses, fake
 * vendor providers — behind the egress deny-list so
 * any non-loopback request fails closed. Every read on the actions surface
 * is reconciled against `GET /api/billing/usage` to prove reads never
 * reserve units; the single previewed retest is the ONLY spend after the
 * initial audit.
 *
 * Deterministic fixture states (partial-source, unsafe-link) are exercised
 * through browser route interception — the same documented seam the
 * content-intelligence a11y fixtures use — never through live variance.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  gotoWithStaticAssetNetworkRecovery,
  reloadWithStaticAssetNetworkRecovery,
  traverseHistoryWithStaticAssetNetworkRecovery,
} from './helpers/navigation';

test.describe.configure({ mode: 'serial' });

interface UsageMetric {
  used: number;
  cap: number | null;
}

interface UsageResponse {
  audits?: UsageMetric;
  [key: string]: unknown;
}

interface ActionsListBody {
  items: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    sourceLink: string;
    state: string;
    retest: { available: boolean; reason?: string };
    [key: string]: unknown;
  }>;
  sourceStatus: Record<string, { status: string } | undefined>;
  nextCursor: string | null;
}

const account: TestAccount = freshAccount('actions-journey');
let accountId = '';
let siteId = '';

function bumpToPro(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'pro', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
    { variables: { account_id: id } },
  );
}

function exhaustAuditAllowance(id: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'audits', 1000000, 1000000)
       ON CONFLICT (account_id, period, metric)
         DO UPDATE SET used = 1000000, "limit" = 1000000, updated_at = now();`,
    { variables: { account_id: id } },
  );
}

async function readAccountId(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { user?: { id?: string } };
  expect(body.user?.id, 'session user id').toBeTruthy();
  return body.user!.id!;
}

async function readUsage(page: Page): Promise<UsageResponse> {
  const response = await page.request.get('/api/billing/usage');
  expect(response.status()).toBe(200);
  return (await response.json()) as UsageResponse;
}

async function csrfPost(
  page: Page,
  url: string,
  data: Record<string, unknown>,
): Promise<import('@playwright/test').APIResponse> {
  const tokenResponse = await page.request.get('/api/security/csrf-token');
  expect(tokenResponse.status()).toBe(200);
  const { csrfToken } = (await tokenResponse.json()) as { csrfToken: string };
  return page.request.post(url, {
    data,
    headers: { 'x-csrf-token': csrfToken },
  });
}

async function createSite(page: Page, url: string): Promise<string> {
  const response = await csrfPost(page, '/api/sites', {
    url,
    label: 'Actions Journey',
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { site: { id: string } };
  expect(body.site.id).toBeTruthy();
  return body.site.id;
}

async function runAuditToCompletion(page: Page): Promise<void> {
  const start = await csrfPost(page, `/api/sites/${siteId}/audits`, {});
  expect([200, 201, 202]).toContain(start.status());
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/sites/${siteId}/audits?limit=1`,
        );
        if (response.status() !== 200) return 'http-error';
        const body = (await response.json()) as {
          runs: Array<{ status: string }>;
        };
        return body.runs[0]?.status ?? 'missing';
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe('succeeded');
}

async function readActions(page: Page): Promise<ActionsListBody> {
  const response = await page.request.get(`/api/sites/${siteId}/actions`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ActionsListBody;
}

const workspacePath = (): string => `/sites/${siteId}`;

test('journey steps 1-7 — paid user, filters, evidence, transitions, deep link, finding controls, retest, overview', async ({
  page,
  context,
}) => {
  // Multi-step composed-stack journey on a shared gate host: align with the
  // sibling journeys' explicit budgets (brand-radar 2_400_000, weekly-pulse
  // 240_000) instead of the 60 s default. Retries stay 0 and per-assert
  // expect timeouts are untouched — this is wall-clock budget, not leniency.
  test.setTimeout(240_000);

  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  await test.step('1. sign in as a verified paid user', async () => {
    await signUp(page, account);
    accountId = await readAccountId(page);
    bumpToPro(accountId);
    siteId = await createSite(page, 'https://actions-journey.example');
    await runAuditToCompletion(page);
  });

  await test.step('2. deep-link ?tab=actions with filters; URL and back/forward state hold', async () => {
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `${workspacePath()}?tab=actions&source=audit_finding&severity=critical&state=bogus`,
    );
    await expect(page.getByTestId('actions-panel')).toBeVisible();
    await expect(page.getByTestId('site-nav-group-audit-reports')).toHaveAttribute(
      'data-active',
      'true',
    );
    await expect(page.getByTestId('action-card').first()).toBeVisible({
      timeout: 20_000,
    });

    // Change one filter through the UI: URL updates with replace semantics
    // and the unrelated params survive.
    await page.getByTestId('actions-filter-state').click();
    await page.getByRole('option', { name: 'Open' }).click();
    await expect(page).toHaveURL(/[?&]state=open\b/);
    await expect(page).toHaveURL(/[?&]source=audit_finding\b/);
    await expect(page).toHaveURL(/[?&]tab=actions\b/);

    // Reload preserves the full filter grammar.
    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByTestId('actions-panel')).toBeVisible();
    await expect(page).toHaveURL(/[?&]state=open\b/);

    // Browser back/forward walks across real navigations. Let every booted
    // document settle (panel rendered = session guard resolved) before the
    // next history step — a mid-boot history jump aborts the in-flight
    // session read and proves nothing about the shipped navigation UX.
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=overview`);
    await expect(page.getByTestId('overview-panel')).toBeVisible({ timeout: 20_000 });
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'back', /[?&]tab=actions\b/);
    await expect(page.getByTestId('actions-panel')).toBeVisible({ timeout: 20_000 });
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'forward', /[?&]tab=overview\b/);
    await expect(page.getByTestId('overview-panel')).toBeVisible({ timeout: 20_000 });
    await traverseHistoryWithStaticAssetNetworkRecovery(page, 'back', /[?&]tab=actions\b/);
    await expect(page.getByTestId('actions-panel')).toBeVisible({ timeout: 20_000 });

    // Reset the filters for the rest of the journey.
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
    await expect(page.getByTestId('action-card').first()).toBeVisible();
  });

  await test.step('3. evidence + history + plan/dismiss/reopen persist across reload (reads spend nothing)', async () => {
    const usageBefore = await readUsage(page);

    const card = page.getByTestId('action-card').first();
    const actionId = await card.getAttribute('data-action-id');
    expect(actionId).toBeTruthy();

    // History is on-demand stored data.
    await card.getByTestId('action-history-open').click();
    await expect(page.getByTestId('action-history-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('action-history-drawer')).not.toBeVisible();

    // Plan with a bounded note.
    await card.getByTestId('action-transition-planned').click();
    await expect(page.getByTestId('action-state-dialog')).toBeVisible();
    await page.getByTestId('action-state-note').fill('planned via e2e journey');
    await page.getByTestId('action-state-confirm').click();
    await expect(page.getByTestId('action-state-dialog')).not.toBeVisible();
    await expect(card.getByTestId('action-state-chip')).toHaveText('Planned');

    // Dismiss, then reopen.
    await card.getByTestId('action-transition-dismissed').click();
    await page.getByTestId('action-state-confirm').click();
    await expect(card.getByTestId('action-state-chip')).toHaveText('Dismissed');
    await card.getByTestId('action-transition-open').click();
    await page.getByTestId('action-state-confirm').click();
    await expect(card.getByTestId('action-state-chip')).toHaveText('Open');

    // Reload — the server, not local state, is authoritative.
    await reloadWithStaticAssetNetworkRecovery(page);
    const reloaded = page
      .locator(`[data-action-id="${actionId}"]`)
      .first();
    await expect(reloaded.getByTestId('action-state-chip')).toHaveText('Open');

    // History now shows the recorded transitions with the note verbatim.
    await reloaded.getByTestId('action-history-open').click();
    await expect(
      page.getByTestId('action-history-entry').first(),
    ).toBeVisible();
    await expect(page.getByText('planned via e2e journey')).toBeVisible();
    // The raw account id never renders in the history surface.
    await expect(
      page.getByTestId('action-history-drawer').getByText(accountId),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Reads + state changes never touched the audit meter.
    const usageAfter = await readUsage(page);
    expect(usageAfter.audits?.used).toBe(usageBefore.audits?.used);
  });

  await test.step('4. follow a source deep link onto the shipped report surface', async () => {
    const sourceLink = page.getByTestId('action-source-link').first();
    await expect(sourceLink).toBeVisible();
    const href = await sourceLink.getAttribute('href');
    expect(href, 'server sourceLink is a relative path').toMatch(/^\//);
    await sourceLink.click();
    // The audit deep link carries the exact rule; the report selects its
    // bucket and opens that finding instead of showing the default first row.
    await page.waitForURL(/\/report\?finding=/, { timeout: 20_000 });
    await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('report-issue-detail')).toBeVisible();
  });

  await test.step('5. dismiss + reopen an audit finding from the report', async () => {
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=report`);
    await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
    const dismiss = page.getByTestId('report-finding-dismiss').first();
    await expect(dismiss).toBeVisible({ timeout: 20_000 });
    await dismiss.click();
    await expect(page.getByTestId('action-state-dialog')).toBeVisible();
    await page.getByTestId('action-state-confirm').click();
    // The finding stays visible, labeled, with a reopen control — audit
    // evidence and counts are untouched.
    await expect(page.getByTestId('report-finding-dismissed').first()).toBeVisible();
    const reopen = page.getByTestId('report-finding-reopen').first();
    await reopen.click();
    await page.getByTestId('action-state-confirm').click();
    await expect(page.getByTestId('report-finding-dismiss').first()).toBeVisible();
  });

  await test.step('5b. mark an audit finding as fixed, then reopen it', async () => {
    const markFixed = page.getByTestId('report-finding-fix').first();
    await expect(markFixed).toBeVisible({ timeout: 20_000 });
    await markFixed.click();
    await expect(page.getByTestId('action-state-dialog')).toBeVisible();
    await page.getByTestId('action-state-confirm').click();
    await expect(page.getByTestId('report-finding-fixed').first()).toBeVisible();
    await page.getByTestId('report-finding-reopen').first().click();
    await page.getByTestId('action-state-confirm').click();
    await expect(page.getByTestId('report-finding-fix').first()).toBeVisible();
  });

  await test.step('6. previewed retest — cancel spends nothing, one confirm spends exactly one audit', async () => {
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
    await expect(page.getByTestId('action-card').first()).toBeVisible();
    const usageBefore = await readUsage(page);

    const retestable = page
      .locator('[data-testid="action-card"]', {
        has: page.getByTestId('action-retest-open'),
      })
      .first();
    await retestable.getByTestId('action-retest-open').click();
    await expect(page.getByTestId('action-retest-dialog')).toBeVisible();
    await expect(page.getByTestId('retest-preview')).toBeVisible();
    await expect(page.getByTestId('retest-preview-units')).toHaveText('1');

    // Cancel first — no reservation, no enqueue.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('action-retest-dialog')).not.toBeVisible();
    const usageAfterCancel = await readUsage(page);
    expect(usageAfterCancel.audits?.used).toBe(usageBefore.audits?.used);

    // Confirm — exactly one audit unit is reserved and the run reaches a
    // terminal state through the existing report progress surface.
    await retestable.getByTestId('action-retest-open').click();
    await page.getByTestId('action-retest-confirm').click();
    await expect(page.getByTestId('action-retest-queued')).toBeVisible({
      timeout: 20_000,
    });
    const usageAfterConfirm = await readUsage(page);
    expect(usageAfterConfirm.audits?.used).toBe(
      (usageBefore.audits?.used ?? 0) + 1,
    );
    await page.getByTestId('action-retest-progress-link').click();
    await expect(page).toHaveURL(/[?&]tab=report\b/);
    // Queued/running surfaces, then the diff-capable report returns.
    await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 120_000 });
  });

  await test.step('7. overview shows the first five server actions + View all', async () => {
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=overview`);
    await expect(page.getByTestId('overview-next-actions')).toBeVisible();
    await expect(
      page.getByTestId('overview-action-item').first(),
    ).toBeVisible({ timeout: 30_000 });
    const shown = await page.getByTestId('overview-action-item').count();
    expect(shown).toBeLessThanOrEqual(5);
    const serverActions = await readActions(page);
    expect(shown).toBe(Math.min(serverActions.items.length, 5));
    await page.getByTestId('overview-actions-view-all').click();
    await expect(page).toHaveURL(/[?&]tab=actions\b/);
    await expect(page.getByTestId('actions-panel')).toBeVisible();
  });

  await test.step('zero non-loopback egress across the journey', async () => {
    expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
  });
});

test('Arabic RTL — the actions workspace renders right-to-left with localized chrome', async ({
  page,
  context,
}) => {
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  await logIn(page, account);
  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
  await expect(page.getByTestId('actions-panel')).toBeVisible();
  await page.locator('#language-switcher').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('site-nav-group-audit-reports')).toHaveText(/الإجراءات/);
  await expect(page.getByTestId('action-card').first()).toBeVisible({
    timeout: 20_000,
  });
  expect(denials.urls).toEqual([]);
  await page.locator('#language-switcher').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('keyboard-only — filters, dialog focus trap, Escape, and focus return', async ({
  page,
  context,
}) => {
  await denyNonLoopback(context);
  await logIn(page, account);
  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
  await expect(page.getByTestId('action-card').first()).toBeVisible({
    timeout: 20_000,
  });

  // Operate a filter select entirely with the keyboard: open with Enter,
  // highlight the next option with ArrowDown, commit with Enter.
  await page.getByTestId('actions-filter-severity').focus();
  await page.keyboard.press('Enter');
  const criticalOption = page.getByRole('option', { name: 'Critical' });
  await expect(criticalOption).toBeVisible();
  // The listbox mounts before its roving focus settles, and the select
  // re-asserts focus on the checked option once it does. A single ArrowDown
  // fired inside that window is swallowed, so Enter would re-commit the
  // unchanged value and leave the URL untouched. `Home` re-anchors the
  // highlight on the first option ("All") deterministically, so the retry is
  // idempotent and cannot overshoot past "Critical".
  await expect(async () => {
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(criticalOption).toHaveAttribute('data-highlighted', '');
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  const filteredActionsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === `/api/sites/${siteId}/actions` &&
      url.searchParams.getAll('severity').includes('critical')
    );
  });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]severity=critical\b/);
  expect((await filteredActionsResponse).status()).toBe(200);

  // The URL can update before the effect dispatches its filtered GET, leaving
  // the previous "showing" live-region copy in place for one render. Waiting
  // for that stale copy alone allowed the response to reconcile while the
  // dialog was open and made Radix restore focus onto a detached trigger. The
  // response wait above proves the filtered request completed; now wait for
  // React to commit the authoritative rows before touching a card.
  await expect(
    page.getByTestId('actions-panel').locator('p[role="status"]'),
  ).toHaveText(/Showing \d+ actions/);

  // Open the first transition dialog with the keyboard; Escape returns focus.
  const trigger = page
    .getByTestId('action-card')
    .first()
    .locator('[data-testid^="action-transition-"]')
    .first();
  await expect(trigger).toBeEnabled();
  // `press` focuses and keys the element in one actionability-checked step —
  // a separate `focus()` + `page.keyboard.press()` can straddle a re-render
  // and send the Enter to <body>.
  await trigger.press('Enter');
  await expect(page.getByTestId('action-state-dialog')).toBeVisible();
  // Focus is trapped inside the dialog while it is open.
  await page.keyboard.press('Tab');
  const focusInsideDialog = await page.evaluate(() =>
    Boolean(
      document
        .querySelector('[data-testid="action-state-dialog"]')
        ?.contains(document.activeElement),
    ),
  );
  expect(focusInsideDialog).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('action-state-dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('axe — overview, actions, report, and the open dialog are violation-free', async ({
  page,
  context,
}) => {
  await denyNonLoopback(context);
  await logIn(page, account);

  const scan = async (label: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, `${label}: axe violations`).toEqual([]);
  };

  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=overview`);
  await expect(page.getByTestId('overview-next-actions')).toBeVisible();
  await scan('overview');

  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
  await expect(page.getByTestId('action-card').first()).toBeVisible({
    timeout: 20_000,
  });
  await scan('actions');

  await page
    .getByTestId('action-card')
    .first()
    .locator('[data-testid^="action-transition-"]')
    .first()
    .click();
  await expect(page.getByTestId('action-state-dialog')).toBeVisible();
  await scan('actions state dialog');
  await page.keyboard.press('Escape');

  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=report`);
  await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 30_000 });
  await scan('report with finding controls');
});

test('mobile viewport — the actions worklist stays usable at 390px', async ({
  page,
  context,
}) => {
  await denyNonLoopback(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await logIn(page, account);
  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
  await expect(page.getByTestId('actions-panel')).toBeVisible();
  await expect(page.getByTestId('action-card').first()).toBeVisible({
    timeout: 20_000,
  });
  // The filter group and the state controls remain reachable.
  await expect(page.getByTestId('actions-filter-state')).toBeVisible();
  await expect(
    page
      .getByTestId('action-card')
      .first()
      .locator('[data-testid^="action-transition-"]')
      .first(),
  ).toBeVisible();
});

test('deterministic fixtures — partial-source warning, unavailable ≠ all-clear, unsafe links stay inert', async ({
  page,
  context,
}) => {
  await denyNonLoopback(context);
  await logIn(page, account);

  const fixtureItem = {
    id: 'f'.repeat(64),
    siteId,
    sourceType: 'audit_finding',
    sourceId: 'run-x:rule-x',
    sourceLink: 'https://evil.example/escape',
    problem: 'Fixture problem',
    whyItMatters: 'Fixture why',
    nextStep: 'Fixture next step',
    affectedUrls: [],
    evidence: [
      {
        sourceRef: 'fixture-evidence',
        url: 'javascript:alert(1)',
        observation: {
          freshness: 'stale',
          observedAt: '2026-07-01T00:00:00.000Z',
        },
      },
    ],
    severity: 'critical',
    firstPartyImpact: 'high',
    confidence: 'high',
    effort: 'low',
    state: 'open',
    version: 1,
    observedAt: '2026-07-01T00:00:00.000Z',
    lastVerifiedAt: null,
    retest: { available: false, reason: 'Fixture reason.' },
  };

  await test.step('partial sources warn while usable actions stay visible; unsafe links never render', async () => {
    await page.route('**/api/sites/*/actions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Content-Language': 'en',
          Vary: 'Accept-Language, x-lang',
        },
        body: JSON.stringify({
          items: [fixtureItem],
          sourceStatus: {
            audit_finding: { status: 'available' },
            ga4_decline: { status: 'unavailable' },
          },
          nextCursor: null,
        }),
      });
    });
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
    await expect(page.getByTestId('actions-partial-warning')).toBeVisible();
    const card = page.getByTestId('action-card').first();
    await expect(card).toBeVisible();
    // The external sourceLink fails client revalidation → no internal link.
    await expect(card.getByTestId('action-source-link')).toHaveCount(0);
    // The javascript: evidence URL is dropped; the reference stays as text.
    await expect(card.getByTestId('action-evidence-link')).toHaveCount(0);
    await expect(card.getByText('fixture-evidence')).toBeVisible();
    const hostileAnchors = await page
      .locator('a[href^="javascript:"], a[href*="evil.example"]')
      .count();
    expect(hostileAnchors).toBe(0);
    await page.unroute('**/api/sites/*/actions*');
  });

  await test.step('all sources unavailable renders the honest non-all-clear empty state', async () => {
    await page.route('**/api/sites/*/actions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Content-Language': 'en',
          Vary: 'Accept-Language, x-lang',
        },
        body: JSON.stringify({
          items: [],
          sourceStatus: {
            audit_finding: { status: 'unavailable' },
            confirmed_rank_drop: { status: 'unavailable' },
          },
          nextCursor: null,
        }),
      });
    });
    await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
    await expect(page.getByTestId('actions-empty-unavailable')).toBeVisible();
    await expect(page.getByTestId('actions-empty-clear')).toHaveCount(0);
    await page.unroute('**/api/sites/*/actions*');
  });
});

test('cap-exhausted retest — the localized 402 surfaces and no unit is spent', async ({
  page,
  context,
}) => {
  await denyNonLoopback(context);
  await logIn(page, account);
  exhaustAuditAllowance(accountId);

  await gotoWithStaticAssetNetworkRecovery(page, `${workspacePath()}?tab=actions`);
  await expect(page.getByTestId('action-card').first()).toBeVisible({
    timeout: 20_000,
  });
  const retestable = page
    .locator('[data-testid="action-card"]', {
      has: page.getByTestId('action-retest-open'),
    })
    .first();
  await retestable.getByTestId('action-retest-open').click();
  await expect(page.getByTestId('action-retest-dialog')).toBeVisible();
  await page.getByTestId('action-retest-confirm').click();
  // The server rejects with its localized cap message — rendered verbatim.
  await expect(page.getByTestId('action-retest-error')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('action-retest-queued')).toHaveCount(0);
});
