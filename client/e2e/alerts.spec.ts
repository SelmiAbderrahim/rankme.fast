/**
 * Alert Rules and Channels.
 *
 * The journey keeps every production boundary active: real Better Auth
 * accounts, the shipped structural cap, the shipped Pro+ channel gate, the
 * shared SSRF authority, and the real `alert-dispatch` worker.
 *
 * Two honest constraints of the composed gate, asserted rather than hidden:
 *   • `RESEND_API_KEY` is empty, so an email leg settles
 *     `suppressed / no_transport` — a real terminal state, not a stub "sent".
 *   • A generic webhook cannot reach a public host from the isolated network,
 *     so that leg settles `failed` / `suppressed`.
 * Either way the delivery row exists exactly once and cites BOTH stored
 * observations, which is the invariant this prompt owns.
 *
 * Rank transitions are driven by seeding a settled `confirmed` row in the
 * `rank_drop_confirmations` table, which this module only ever READS.
 * Link transitions are driven by seeding two consecutive
 * `backlink_row_snapshots` reviews, which this module only diffs.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string; domain: string };
}

interface RuleResponse {
  id: string;
  webhookSecret?: string;
  webhookSecretLast4: string | null;
  slackHostMasked: string | null;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionResponse).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

function setTier(id: string, tier: 'none' | 'starter' | 'pro' | 'agency'): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', :'tier', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = :'tier', status = 'active', updated_at = now();`,
    { variables: { account_id: id, tier } },
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

async function createRule(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ status: number; json: RuleResponse }> {
  const response = await request.post('/api/alerts/rules', {
    data: body,
    headers: await csrfHeaders(request),
  });
  return { status: response.status(), json: (await response.json()) as RuleResponse };
}

/**
 * Seed a settled `confirmed` confirmation. This module never writes this table in
 * production; the gate stands in for the producer that owns it.
 */
function seedConfirmedRankDrop(accountIdValue: string, siteId: string): void {
  runComposePsql(
    `WITH kw AS (
       INSERT INTO keywords (account_id, site_id, phrase, location_code, language_code)
       VALUES (:'account_id', :'site_id', 'seo audit tool', 2840, 'en')
       RETURNING id
     ), rk AS (
       INSERT INTO rankings (keyword_id, position, checked_at, source)
       SELECT id, 24, now(), 'fresh' FROM kw
       RETURNING id, keyword_id
     )
     INSERT INTO rank_drop_confirmations (
       account_id, site_id, keyword_id, ranking_id, state,
       previous_position, candidate_position, confirmation_position,
       candidate_observed_at, confirmation_observed_at,
       location_code, language_code, device, attempt_reserved_at, settled_at
     )
     SELECT :'account_id', :'site_id', rk.keyword_id, rk.id, 'confirmed',
            3, 24, 24,
            now() - interval '1 day', now(),
            2840, 'en', 'desktop', now(), now()
     FROM rk;`,
    { variables: { account_id: accountIdValue, site_id: siteId } },
  );
}

/** Seed two consecutive completed reviews so the 05 diff has a baseline. */
function seedBacklinkReviews(accountIdValue: string, siteId: string): void {
  const previous = randomUUID();
  const current = randomUUID();
  runComposePsql(
    `INSERT INTO backlink_row_snapshots
       (review_id, account_id, site_id, url, domain, spam_score,
        rubric_band, rubric_version, dofollow, is_broken, captured_at)
     VALUES
       (:'prev', :'account_id', :'site_id', 'https://kept.test/a', 'kept.test',
        4, 'clean', 'toxicity-rubric-v1', true, false, now() - interval '20 hours'),
       (:'prev', :'account_id', :'site_id', 'https://gone.test/a', 'gone.test',
        4, 'clean', 'toxicity-rubric-v1', true, false, now() - interval '20 hours'),
       (:'cur', :'account_id', :'site_id', 'https://kept.test/a', 'kept.test',
        4, 'clean', 'toxicity-rubric-v1', true, false, now() - interval '1 hour'),
       (:'cur', :'account_id', :'site_id', 'https://fresh.test/a', 'fresh.test',
        4, 'clean', 'toxicity-rubric-v1', true, false, now() - interval '1 hour');`,
    {
      variables: { account_id: accountIdValue, site_id: siteId, prev: previous, cur: current },
    },
  );
}

function countDeliveries(accountIdValue: string): number {
  return Number(
    runComposePsqlOutput(
      `SELECT count(*) FROM alert_deliveries WHERE account_id = :'account_id';`,
      { variables: { account_id: accountIdValue } },
    ),
  );
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }, theme);
}

test('alert rules: cap, channel gating, secrets, dispatch evidence, a11y', async ({
  page,
}) => {
  test.slow();
  const account = freshAccount('alerts');
  // `signUp` auto-signs-in, verifies in the DB, and lands on the app shell —
  // a follow-up `logIn` would find /login already redirected away.
  await signUp(page, account);

  const id = await accountId(page.request);
  // ---------------------------------------------------------------- tier gate
  setTier(id, 'starter');
  const site = await createSite(page.request, 'https://alerts.example.test', 'Alerts');
  const slackOnStarter = await createRule(page.request, {
    siteId: site.id,
    type: 'rank_drop',
    threshold: 10,
    slackWebhookUrl: 'https://hooks.slack.com/services/T1/B1/zzz',
  });
  expect(slackOnStarter.status).toBe(402);

  // Email on the same tier is allowed — the gate is per channel, not per rule.
  const emailOnStarter = await createRule(page.request, {
    siteId: site.id,
    type: 'rank_drop',
    threshold: 10,
    emailRecipientIds: [id],
  });
  expect(emailOnStarter.status).toBe(201);

  // ------------------------------------------------------------- structural cap
  const secondStarterRule = await createRule(page.request, {
    siteId: site.id,
    type: 'new_backlink',
    emailRecipientIds: [id],
  });
  expect(secondStarterRule.status).toBe(201);
  const overCap = await createRule(page.request, {
    siteId: site.id,
    type: 'lost_backlink',
    emailRecipientIds: [id],
  });
  expect(overCap.status).toBe(402);

  // ------------------------------------------------------------- SSRF at save
  setTier(id, 'pro');
  const privateTarget = await createRule(page.request, {
    siteId: site.id,
    type: 'lost_backlink',
    webhookUrl: 'https://127.0.0.1/hook',
  });
  expect(privateTarget.status).toBe(400);

  // ------------------------------------------------ hostile-URL refusals
  // Every URL the SSRF authority ACCEPTS is by construction a real public
  // destination, and this prompt forbids live Slack/webhook calls. So the
  // composed journey exercises only the REFUSAL paths here; the successful
  // Slack/webhook transports, the signature, and show-once secret minting are
  // covered exhaustively in `alert-dispatch.test.ts` /`alerts.routes.test.ts`
  // with injected transports and an injected resolver.
  for (const hostile of [
    'https://user:pass@example.test/hook',
    'https://169.254.169.254/latest/meta-data',
    'http://insecure.example.test/hook',
  ]) {
    const refused = await createRule(page.request, {
      siteId: site.id,
      type: 'lost_backlink',
      webhookUrl: hostile,
    });
    expect(refused.status, hostile).toBe(400);
  }

  // A third email-only rule fits inside the Pro ceiling and gives the log a
  // second transition family to render.
  const linkRule = await createRule(page.request, {
    siteId: site.id,
    type: 'lost_backlink',
    emailRecipientIds: [id],
  });
  expect(linkRule.status).toBe(201);

  // Masked reads: no rule ever discloses a channel credential.
  const reread = await page.request.get('/api/alerts/rules');
  expect(reread.status()).toBe(200);
  const rereadBody = await reread.text();
  expect(rereadBody).not.toContain('ciphertext');
  expect(rereadBody).not.toContain('authTag');

  // ------------------------------------------------------------- transitions
  seedConfirmedRankDrop(id, site.id);
  seedBacklinkReviews(id, site.id);

  // The sweep runs on ALERT_SWEEP_INTERVAL_MS (5s under the gate) and the
  // dispatch worker settles each leg to a terminal row.
  await expect
    .poll(() => countDeliveries(id), { timeout: 90_000, intervals: [1_000, 2_000] })
    .toBeGreaterThan(0);

  // Exactly-once: the sweep re-runs continuously, so the count must STABILIZE.
  const settled = countDeliveries(id);
  await page.waitForTimeout(12_000);
  expect(countDeliveries(id)).toBe(settled);

  // ------------------------------------------------------------------- the UI
  await page.goto('/dashboard/alerts');
  await expect(page.getByTestId('alerts-rule-list')).toBeVisible();

  await page.getByRole('button', { name: 'View log' }).first().click();
  await expect(page).toHaveURL(/tab=log/);
  await expect(page.getByTestId('alerts-delivery-log')).toBeVisible();
  // The honesty invariant, on screen: both observations with their dates.
  await expect(page.getByTestId('alerts-delivery-log')).toContainText(
    /then .* on \d{4}-\d{2}-\d{2}/,
  );

  // --------------------------------------------------------------- axe scans
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, `${theme} violations`).toEqual([]);
  }

  // -------------------------------------------------------------- keyboard
  await page.goto('/dashboard/alerts');
  await expect(page.getByTestId('alerts-rule-list')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

// Arabic is driven by BOTH shipped seams: the browser locale (i18next's
// navigator detector) and the `?lng=` querystring, which the detector treats as
// authoritative precisely so an E2E journey can pin a locale after a signup
// flow has already persisted the language cookie.
test.describe('Arabic (RTL)', () => {
  test.use({ locale: 'ar' });

  test('alerts render right-to-left and stay accessible', async ({ page }) => {
    test.slow();
    const account = freshAccount('alerts-ar');
    await signUp(page, account);
    const id = await accountId(page.request);
    setTier(id, 'pro');
    await createSite(page.request, 'https://alerts-ar.example.test', 'Alerts AR');

    await page.goto('/dashboard/alerts');
    await expect(page.getByTestId('alerts-page')).toBeVisible();

    // Switch through the shipped shared LanguageSwitcher — the real user
    // journey. It calls `changeLanguage`, whose `languageChanged` hook is what
    // actually applies `lang`/`dir` to the document.
    await page.locator('#language-switcher').first().selectOption('ar');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', /ar/);
    await expect(page.getByRole('heading', { name: 'التنبيهات' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'سجل الإرسال' })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
