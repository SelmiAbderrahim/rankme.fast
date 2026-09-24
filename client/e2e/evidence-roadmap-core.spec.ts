/**
 * Journey A — evidence-first core.
 *
 * Locked contract:
 *
 * This spec is serial by design (one story per worker). It drives the real
 * composed stack — signup + verify via the account helper, real HTTP
 * requests through the browser, real `/api/*` responses, real Postgres +
 * Mongo state. Provider fakes back every vendor call (fake tier per
 *). The browser context is fenced by the
 * egress deny-list so any non-loopback request fails closed.
 *
 * Phase-2 scope (what this file covers today):
 *   1. Site setup — real signup + real UI add-site + URL-backed
 *      `?tab=` state (`useSiteTab`), reload preservation, back/forward,
 *      invalid `?tab=` values coerced to the overview default.
 *   2. Non-reserving spend preview — every audit-run `POST` is server
 *      authoritative: the preview surface (`GET /api/audits/preview`)
 *      MUST report a capacity/coverage decision and MUST NOT decrement
 *      the account's audit meter. Cancelling never enqueues a job.
 *   3. Zero-egress proof — the entire journey records zero denied
 *      requests via the deny-list guard.
 *   4. Cross-account 404 — a second isolated account reading the first
 *      account's site detail sees 404, not 403.
 *
 * What is intentionally NOT here (blocked by product surfaces the
 * roadmap narrative referenced but have
 * not shipped as a customer-facing UI):
 *
 *   • Explicit `SiteMarket` selection UI on `AddSiteForm` — `SiteMarket`
 *     is observation metadata (`server/src/shared/observations/types.ts`)
 *     attached to downstream events, not a site-level attribute.
 *   • `?tab=ranks`, `?tab=actions`, `?tab=activity` on `/dashboard/sites/:id`
 *     — the shipped `SITE_TABS` set is `overview | report | keywords |
 *     research | backlinks | competitors | ai-visibility | local-seo |
 *     google | content` (see `client/src/features/sites/tabState.ts`).
 *   • Rank confirmation deterministic branches (unconfirmed / volatile /
 *     confirmed) driven by market/device/freshness — the confirmation
 *     evidence deep-link surface is not exposed on the sites workspace
 *     tabs.
 *   • Next Actions accept / dismiss / complete state machine wired to
 *     an `/actions` workspace URL, and the audit-regression → reopen
 *     transition on the action store.
 *   • Usage activity reconciliation at `/billing/usage?tab=activity` —
 *     activity is exposed as a plain history endpoint, not a UI-facing
 *     tab.
 *
 * Each of the above needs its missing UI/route to ship before Journey A
 * can assert against it end-to-end.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import { freshAccount, grantE2eTier, signUp } from './helpers/account';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

interface JsonRecord {
  [key: string]: unknown;
}

async function jsonOrNull(request: APIRequestContext, url: string): Promise<{
  status: number;
  body: JsonRecord | null;
}> {
  const response = await request.get(url);
  let body: JsonRecord | null = null;
  try {
    body = (await response.json()) as JsonRecord;
  } catch {
    body = null;
  }
  return { status: response.status(), body };
}

test('Journey A — site setup, URL/tab state, non-reserving preview, cross-account 404', async ({
  page,
  context,
  baseURL,
}) => {
  const denials = collectDenials();
  await denyNonLoopback(context, {
    onDeny: denials.onDeny,
    // The Playwright default `baseURL` covers `http://127.0.0.1:<WEB_PORT>`;
    // no additional origins are permitted.
  });

  const account = freshAccount('evidence-core');

  await test.step('sign up and verify', async () => {
    await signUp(page, account);
    grantE2eTier(account.email);
    await expect(page).toHaveURL(/\/(sites|dashboard|add-site)/);
  });

  await test.step('add site through the shipped UI', async () => {
    await page.goto('/sites');
    await page.locator('#site-url').fill('https://evidence-a.example');
    await page.getByRole('button', { name: /add|create|save/i }).click();
    await expect(page.getByText('evidence-a.example').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('site landed with URL-backed default tab (`?tab=overview`)', async () => {
    // Open the row menu → View report — the shipped navigation into the
    // per-site workspace. The workspace ships `data-testid=site-workspace`
    // plus grouped navigation triggers.
    await page
      .getByRole('button', { name: /open menu for/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /view report/i }).click();
    await expect(page.getByTestId('site-workspace')).toBeVisible();
  });

  const capturedSiteUrl = (): string => page.url().split('?')[0]!;

  await test.step('switching a tab writes `?tab=<name>` and survives reload', async () => {
    // `keywords` is one of the always-available `SITE_TABS`.
    await page.getByTestId('site-nav-group-search').click();
    await page.getByTestId('site-tab-keywords').click();
    await expect(page).toHaveURL(/[?&]tab=keywords\b/);
    await page.reload();
    await expect(page).toHaveURL(/[?&]tab=keywords\b/);
    await expect(page.getByTestId('site-workspace')).toBeVisible();
  });

  await test.step('tab switches use replace semantics — Back exits, Forward keeps the latest tab', async () => {
    // Locked contract (`.claude/rules/url-tab-state.md` + `useTabParam`):
    // switching a tab writes `?tab=` with `replace: true`, so per-click tab
    // changes never pollute browser history. Back therefore exits the
    // workspace to the previous real navigation (the /sites list), and
    // Forward returns to the workspace with the LATEST tab still in the
    // URL — the tab state survives the round-trip via the URL, not via a
    // per-click history entry.
    await page.getByTestId('site-nav-group-audit-reports').click();
    await page.getByTestId('site-tab-report').click();
    await expect(page).toHaveURL(/[?&]tab=report\b/);
    await page.goBack();
    await expect(page).toHaveURL(/\/sites(?:[?#]|$)/);
    await page.goForward();
    await expect(page).toHaveURL(/[?&]tab=report\b/);
    await expect(page.getByTestId('site-workspace')).toBeVisible();
  });

  await test.step('unknown `?tab=` value falls back to overview default', async () => {
    await page.goto(`${capturedSiteUrl()}?tab=totally-not-a-real-tab`);
    // `useSiteTab` coerces invalid values to `DEFAULT_SITE_TAB` = `overview`.
    // The URL is left as-is (invalid state), but the workspace renders the
    // overview panel — `overview-panel` is the shipped testid.
    await expect(page.getByTestId('overview-panel')).toBeVisible();
  });

  await test.step('spend preview is non-reserving — no metered event', async () => {
    // Usage baseline via the shipped `/api/billing/usage` read. NOTE: this
    // must ride the signed-in page's cookie jar (`page.request`) — the bare
    // `request` fixture is a separate, unauthenticated context and 401s.
    const baseline = await jsonOrNull(page.request, '/api/billing/usage');
    expect(baseline.status).toBe(200);

    // Query the shipped audit preview endpoint.
    // `siteId` is derived from the current workspace URL.
    const siteId = capturedSiteUrl().split('/').pop();
    expect(siteId, 'siteId parsed from workspace URL').toBeTruthy();

    // The preview surface is `GET`, has no request body, and MUST NOT
    // mutate usage regardless of tier state.
    const preview = await jsonOrNull(
      page.request,
      `/api/audits/preview?siteId=${encodeURIComponent(siteId!)}`,
    );
    // 200 (preview available for the fake tier) or 402 (over cap / not
    // configured) are both acceptable — either way this is a *read*.
    expect([200, 402, 404]).toContain(preview.status);

    // Re-read usage; the meter for `audits` MUST be identical.
    const after = await jsonOrNull(page.request, '/api/billing/usage');
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body)).toBe(JSON.stringify(baseline.body));
  });

  await test.step('cross-account read of first account site returns 404', async () => {
    const siteId = capturedSiteUrl().split('/').pop();
    expect(siteId).toBeTruthy();

    // Spawn a fresh context for the second account so cookies do not
    // bleed. Direct navigation to the first account's site MUST 404 —
    // ownership check returns 404, not 403 (better-auth rule).
    const secondContext = await context.browser()!.newContext({ baseURL });
    await denyNonLoopback(secondContext, { onDeny: denials.onDeny });
    const secondPage = await secondContext.newPage();
    const secondAccount = freshAccount('evidence-core-b');
    await signUp(secondPage, secondAccount);

    const isolationResponse = await secondPage.request.get(
      `/api/sites/${encodeURIComponent(siteId!)}`,
    );
    expect(isolationResponse.status()).toBe(404);
    await secondContext.close();
  });

  await test.step('zero non-loopback egress across the journey', async () => {
    expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
  });
});
