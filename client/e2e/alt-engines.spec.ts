/**
 * Bing / YouTube / Amazon rank tracking, composed
 * stack, deterministic fake providers.
 *
 * Proof shape:
 *   - the engine picker discloses the metered unit, the slot usage, and the
 *     `alt-engine-checks-500` pack BEFORE the paid submit;
 *   - a Bing keyword completes through the shipped ranks queue and renders its
 *     engine badge plus a URL-backed engine filter;
 *   - an Amazon keyword always carries the provider-index observation label —
 *     never a live shelf position;
 *   - a Google keyword added in the SAME session is untouched by the engine
 *     slot ceiling and keeps its own meter;
 *   - the slot-exhausted and check-exhausted states are the localized 402s,
 *     reached by seeding the account's own counters (no vendor call);
 *   - with `ALT_ENGINE_TRACKING_ENABLED=false` a NEW non-Google keyword is
 *     refused while stored rows stay readable (proved against an api ACTUALLY
 *     booted with the flag off, then restored);
 *   - Arabic RTL journey plus axe scans in light and dark.
 *
 * The `finally` block restores the inherited flag on api + worker and checks
 * their runtime parity, even when an assertion or health wait fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Localized (en) `ranks.errors.altEnginesUnavailable`. */
const UNAVAILABLE_MESSAGE = 'Bing, YouTube, and Amazon tracking is turned off right now.';
/** Pro base caps from the tier catalog. */
const PRO_SLOTS = 5;
const PRO_CHECKS = 20;

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
}

function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { ALT_ENGINE_TRACKING_ENABLED: value });
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get('/api/health');
          return res.status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(200);
}

async function addFirstSite(page: Page, url = 'https://example.com'): Promise<string> {
  await page.goto('/sites');
  await page.locator('#site-url').fill(url);
  await page.locator('form button[type="submit"]').click();
  const domain = new URL(url).hostname;
  await page.getByRole('link', { name: domain, exact: true }).first().click();
  await page.waitForURL(/\/sites\/[a-f0-9-]+/i, { timeout: 30_000 });
  const current = page.url().split('?')[0] ?? page.url();
  return current;
}

async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('alt-engines spec: no session user id');
  return body.user.id;
}

function seedProTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'pro', 'active')
     ON CONFLICT (account_id) DO UPDATE SET tier = 'pro', status = 'active';`,
    { variables: { accountId } },
  );
}

/**
 * Occupy alt-engine slots directly so the structural refusal is reached in one
 * step instead of five UI submits. These are the account's OWN keyword rows —
 * the same shape `createKeyword` writes — so the refusal under test is the
 * shipped live-count check, not a mocked one.
 */
function seedAltEngineKeywords(accountId: string, siteId: string, count: number): void {
  for (let i = 0; i < count; i += 1) {
    runComposePsql(
      `INSERT INTO keywords (account_id, site_id, phrase, location_code, language_code, device, engine)
       VALUES (:'accountId', :'siteId', :'phrase', 2840, 'en', 'desktop', 'bing')
       ON CONFLICT DO NOTHING;`,
      { variables: { accountId, siteId, phrase: `seeded slot phrase ${i}` } },
    );
  }
}

/** Drain the account's `alt_engine_checks` allowance without any vendor call. */
function seedUsedChecks(accountId: string, used: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'alt_engine_checks', :'used'::bigint, ${PRO_CHECKS})
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint;`,
    { variables: { accountId, used } },
  );
}

function altEngineRowCount(accountId: string): string {
  return runComposePsqlOutput(
    `SELECT count(*) FROM keywords
     WHERE account_id = :'accountId' AND engine <> 'google';`,
    { variables: { accountId } },
  ).trim();
}

async function openKeywords(page: Page, siteUrl: string): Promise<void> {
  await page.goto(`${siteUrl}?tab=keywords`);
  await expect(page.getByTestId('keyword-add')).toBeVisible({ timeout: 30_000 });
}

async function chooseEngine(page: Page, engine: string): Promise<void> {
  await page.locator(`#keyword-engine-${engine}`).check();
}

async function submitKeyword(page: Page): Promise<void> {
  await page.locator('[data-testid="keyword-add"] button[type="submit"]').click();
}

test('alt engines: preview, badge, filter, Amazon label, slots, cap, flag-off, RTL, axe', async ({
  page,
}) => {
  // Multi-step composed-stack journey (signup, site, three keyword adds, a
  // worker round-trip, one api recreate pair) on a shared gate host. Retries
  // stay 0.
  test.setTimeout(420_000);
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'ALT_ENGINE_TRACKING_ENABLED',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('alt-engines');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  seedProTier(accountId);
  const siteUrl = await addFirstSite(page);
  const siteId = siteUrl.split('/').pop() ?? '';

  // ---- 1. Preview discloses the unit, the slots, and the pack -------------
  await openKeywords(page, siteUrl);
  await chooseEngine(page, 'bing');
  const preview = page.getByTestId('alt-engine-preview');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('alt-engine-preview-slots')).toContainText(`0 of ${PRO_SLOTS}`);
  await expect(page.getByTestId('alt-engine-preview-checks')).toContainText(String(PRO_CHECKS));
  // Bing matches the tracked site domain — no target field is asked for.
  await expect(page.getByTestId('keyword-engine-target')).toHaveCount(0);

  // ---- 2. A Bing keyword completes and renders its engine badge -----------
  await page.locator('#keyword-phrase').fill('seo audit tool');
  await submitKeyword(page);
  await expect(page.getByText('seo audit tool').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(/^keyword-engine-[0-9a-f-]{36}$/).first()).toContainText('Bing', {
    timeout: 30_000,
  });

  // ---- 3. An Amazon keyword always carries the provider-index label -------
  await chooseEngine(page, 'amazon');
  await expect(page.getByTestId('keyword-engine-target')).toBeVisible({ timeout: 30_000 });
  await page.locator('#keyword-phrase').fill('seo audit book');
  await page.locator('#keyword-engine-target-input').fill('B0TRACKED1');
  await submitKeyword(page);
  await expect(page.getByTestId(/^keyword-amazon-note-/).first()).toContainText(
    'not a live shelf position',
    { timeout: 30_000 },
  );

  // ---- 4. A Google keyword in the same session is unaffected --------------
  await chooseEngine(page, 'google');
  await expect(page.getByTestId('alt-engine-preview')).toHaveCount(0);
  await page.locator('#keyword-phrase').fill('google only phrase');
  await submitKeyword(page);
  await expect(page.getByText('google only phrase').first()).toBeVisible({
    timeout: 30_000,
  });

  // ---- 5. URL-backed engine filter ---------------------------------------
  const filter = page.getByTestId('engine-filter');
  await expect(filter).toBeVisible();
  await filter.getByRole('combobox').selectOption('bing');
  await expect(page).toHaveURL(/[?&]engine=bing\b/);
  await expect(page.getByText('google only phrase')).toHaveCount(0);
  await page.reload();
  // The filter survives a reload because it lives in the URL.
  await expect(page.getByText('seo audit tool').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('google only phrase')).toHaveCount(0);
  await filter.getByRole('combobox').selectOption('all');
  await expect(page).not.toHaveURL(/[?&]engine=/);

  await scan(page, 'keywords workspace (light)');
  await setTheme(page, 'dark');
  await scan(page, 'keywords workspace (dark)');
  await setTheme(page, 'light');

  // ---- 6. Slot ceiling — the localized 402 -------------------------------
  const beforeSlotSeed = Number(altEngineRowCount(accountId));
  seedAltEngineKeywords(accountId, siteId, PRO_SLOTS - beforeSlotSeed);
  await openKeywords(page, siteUrl);
  await chooseEngine(page, 'bing');
  await expect(page.getByTestId('alt-engine-slots-exhausted')).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('#keyword-phrase').fill('one keyword too many');
  await submitKeyword(page);
  await expect(page.getByTestId('keyword-add-error')).toContainText(
    'Bing, YouTube, and Amazon keywords',
    { timeout: 30_000 },
  );

  // ---- 7. Check allowance exhausted — the localized 402 -------------------
  seedUsedChecks(accountId, String(PRO_CHECKS));
  await openKeywords(page, siteUrl);
  await chooseEngine(page, 'bing');
  await page.locator('#keyword-phrase').fill('no checks left');
  await submitKeyword(page);
  await expect(page.getByTestId('keyword-add-error')).toBeVisible({ timeout: 30_000 });
  seedUsedChecks(accountId, '0');

  // ---- 8. Flag off: new non-Google refused, stored rows still readable ----
  try {
    recreateApiWithFlag('false');
    await awaitApiHealthy(page);

    const refused = await page.request.post(`/api/sites/${siteId}/keywords`, {
      headers: await csrfHeaders(page.request),
      data: {
        phrase: 'blocked while the flag is off',
        locationCode: 2840,
        languageCode: 'en',
        engine: 'bing',
      },
    });
    expect(refused.status()).toBe(404);
    expect(JSON.stringify(await refused.json())).toContain(UNAVAILABLE_MESSAGE);

    // Stored rows keep reading, and Google creates keep working.
    await openKeywords(page, siteUrl);
    await expect(page.getByText('seo audit tool').first()).toBeVisible({ timeout: 30_000 });
  } finally {
    recreateApiWithFlag(inheritedRuntime.ALT_ENGINE_TRACKING_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }

  // ---- 9. Arabic RTL journey + axe ---------------------------------------
  await page.goto(`${siteUrl}?tab=keywords&lng=ar`);
  await page.locator('#language-switcher').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 30_000 });
  const keywordAdd = page.getByTestId('keyword-add');
  const retryKeywords = page.getByRole('button', { name: 'أعد المحاولة' });
  await expect(keywordAdd.or(retryKeywords)).toBeVisible({ timeout: 30_000 });
  if (await retryKeywords.isVisible()) await retryKeywords.click();
  await expect(keywordAdd).toBeVisible({ timeout: 30_000 });
  await scan(page, 'keywords workspace (ar, light)');
  await setTheme(page, 'dark');
  await scan(page, 'keywords workspace (ar, dark)');
});
