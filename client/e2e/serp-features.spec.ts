/**
 * SERP feature capture composed-stack journey.
 *
 * Proof shape:
 *   - a normal rank check (fake provider, feature-bearing scenario) durably
 *     records a SERP observation — no extra vendor task, no new metric;
 *   - the `?tab=serp-features` workspace lists chips, the ownership badge and
 *     the `observedAt` stamp;
 *   - the per-keyword drill-in shows the feature history and the stored
 *     top-results drawer;
 *   - a keyword that has never been checked renders the honest
 *     "not observed yet" state — never a claim that Google shows nothing;
 *   - with `SERP_FEATURE_TRACKING_ENABLED=false` stored observations remain
 *     readable while new capture is disabled (proved against an API actually
 *     booted with the flag off, then restored);
 *   - Arabic RTL journey plus axe scans in light and dark.
 *
 * The `finally` block restores the inherited flag on api + worker and checks
 * their runtime parity, even when an assertion or health wait fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { freshAccount, grantE2eTier, signUp } from './helpers/account';
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

/**
 * The fake rank provider maps a phrase containing "snippet" to a SERP with a
 * featured snippet + PAA BOTH held by the checked domain (see
 * `shared/providers/fakes.ts → fakeSerpFeaturesFor`). Deterministic, keyless.
 */
const OWNED_PHRASE = 'featured snippet guide';

/** Never checked — seeded straight into Postgres so it can never be raced. */
const UNCHECKED_PHRASE = 'phrase never checked at all';
const CAPTURE_PAUSED_PHRASE = 'fresh rank while capture paused';

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
}

async function switchLocale(page: Page, locale: 'en' | 'ar'): Promise<void> {
  const switcher = page.locator('#language-switcher');
  if ((await switcher.inputValue()) === locale) return;
  const persisted = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/users/preferences/language',
    { timeout: 10_000 },
  );
  await switcher.selectOption(locale);
  const response = await persisted.catch(() => null);
  if (response === null) {
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

function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { SERP_FEATURE_TRACKING_ENABLED: value });
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
  await page.getByLabel(/url|رابط|adresse|site/i).fill(url);
  await page.getByRole('button', { name: /add|save|إضافة|حفظ|ajouter/i }).click();
  const domain = new URL(url).hostname;
  await page.getByRole('link', { name: domain }).first().click();
  await page.waitForURL(/\/sites\/[a-f0-9-]+/i, { timeout: 30_000 });
  const currentUrl = page.url();
  return currentUrl.split('?')[0] ?? currentUrl;
}

/**
 * Add a tracked keyword through the shipped UI. Creating a keyword enqueues
 * its first rank check — the SAME already-metered `serp_checks` unit this
 * prompt piggybacks on. Nothing here asks for extra vendor work.
 */
async function trackKeyword(page: Page, siteUrl: string, phrase: string): Promise<void> {
  await page.goto(`${siteUrl}?tab=keywords`);
  await page.locator('#keyword-phrase').fill(phrase);
  await page.locator('[data-testid="keyword-add"] button[type="submit"]').click();
  await expect(page.getByText(phrase).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Seed a keyword row with NO rank check, so the "not observed yet" state is
 * deterministic instead of a race against the worker. Test-only seam, same
 * shape as `verifyAccountEmail` in `helpers/account.ts`.
 */
function seedUncheckedKeyword(accountId: string, siteId: string, phrase: string): void {
  runComposePsql(
    `INSERT INTO keywords (account_id, site_id, phrase, location_code, language_code, device)
     VALUES (:'accountId', :'siteId', :'phrase', 2840, 'en', 'desktop')
     ON CONFLICT DO NOTHING;`,
    { variables: { accountId, siteId, phrase } },
  );
}

async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('serp-features spec: no session user id');
  return body.user.id;
}

test('SERP feature capture: observation, ownership, history, honest states, flag-off, RTL, axe', async ({
  browser,
  page,
}) => {
  // Multi-step composed-stack journey (signup, site, two keywords, a worker
  // round-trip, one api recreate pair) on a shared gate host — align with the
  // sibling journeys' explicit budgets. Retries stay 0.
  test.setTimeout(420_000);
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'SERP_FEATURE_TRACKING_ENABLED',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('serp-features');
  await signUp(page, account);
  grantE2eTier(account.email, 'agency');
  const siteUrl = await addFirstSite(page);
  const siteId = siteUrl.split('/').pop() ?? '';
  const accountId = await sessionUserId(page);

  await test.step('a normal rank check durably records the SERP observation', async () => {
    await trackKeyword(page, siteUrl, OWNED_PHRASE);
    // The worker writes `serp_observations` only after the check completes.
    await expect
      .poll(
        () =>
          runComposePsqlOutput(
            `SELECT count(*) FROM serp_observations WHERE site_id = :'siteId';`,
            { variables: { siteId } },
          ).trim(),
        { timeout: 120_000, intervals: [2_000] },
      )
      .not.toBe('0');
  });

  await test.step('the workspace lists chips, ownership, and the observed stamp', async () => {
    await page.goto(`${siteUrl}?tab=serp-features`);
    const table = page.getByTestId('serp-features-table');
    await expect(table).toBeVisible({ timeout: 30_000 });
    const row = page.locator('[data-testid^="serp-features-row-"]', {
      hasText: OWNED_PHRASE,
    });
    await expect(row.getByTestId('serp-feature-chip-featured_snippet')).toBeVisible();
    await expect(row.getByTestId('serp-feature-chip-people_also_ask')).toBeVisible();
    await expect(row.getByTestId('serp-feature-owned-snippet')).toContainText(
      'You hold the featured snippet',
    );
    await expect(row.getByTestId('serp-feature-owned-paa')).toBeVisible();
    await expect(
      row.getByRole('link', { name: 'https://example.com/guides/snippet' }).first(),
    ).toHaveAttribute('href', 'https://example.com/guides/snippet');
    // `observedAt` renders a real date, never a placeholder.
    await expect(row).not.toContainText('Not observed yet');
    await scan(page, 'serp-features-list(light)');
    await setTheme(page, 'dark');
    await scan(page, 'serp-features-list(dark)');
    await setTheme(page, 'light');
  });

  await test.step('the drill-in shows feature history and the stored top results', async () => {
    const row = page.locator('[data-testid^="serp-features-row-"]', {
      hasText: OWNED_PHRASE,
    });
    await row.getByRole('button', { name: 'View history' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/keyword=/);
    await expect(page.getByTestId('serp-features-history')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('serp-features-history-chart')).toBeVisible();
    await expect(page.getByTestId('serp-features-history-table')).toBeVisible();
    const topResultsTrigger = page.getByRole('button', {
      name: /View stored top results/,
    });
    await topResultsTrigger.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByTestId('serp-features-top-results');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Your page').first()).toBeVisible();
    await scan(page, 'serp-features-detail(light)');
    await page.keyboard.press('Escape');
    await expect(topResultsTrigger).toBeFocused();
    await setTheme(page, 'dark');
    await scan(page, 'serp-features-detail(dark)');
    await setTheme(page, 'light');
    // Keyboard-only return to the list.
    await page.getByRole('button', { name: /Back to all keywords/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('serp-features-table')).toBeVisible();
    await expect(page).not.toHaveURL(/keyword=/);
  });

  await test.step('a never-checked keyword renders the honest not-observed state', async () => {
    seedUncheckedKeyword(accountId, siteId, UNCHECKED_PHRASE);
    await page.goto(`${siteUrl}?tab=serp-features`);
    const row = page.locator('[data-testid^="serp-features-row-"]', {
      hasText: UNCHECKED_PHRASE,
    });
    await expect(row.getByTestId('serp-feature-not-observed')).toContainText('Not observed yet');
    // Honesty invariant — the surface never claims Google shows nothing.
    await expect(row).not.toContainText(/not present|absent/i);
  });

  await test.step('Arabic RTL journey', async () => {
    await page.goto(`${siteUrl}?tab=serp-features&lng=ar`);
    // Settle the source/machine read before changing presentation so the
    // locale switch does not race the initial site and observation fetches.
    await expect(page.getByTestId('serp-features-table')).toBeVisible({
      timeout: 30_000,
    });
    await switchLocale(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('serp-features-table')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('لم يُرصد بعد').first()).toBeVisible();
    await scan(page, 'serp-features-list(ar)');
    await setTheme(page, 'dark');
    await scan(page, 'serp-features-list(ar-dark)');
    await setTheme(page, 'light');
    // Restore English through the SHELL SWITCHER, not a `?lng=` reload: the
    // shipped `languageChanged` hook (which writes the `lang` cookie the
    // server's language middleware reads) is registered after `init`, so a
    // `?lng=en` load renders English while leaving the cookie on `ar` — and
    // the next step's `page.request` API assertion would then compare the
    // English constant against an Arabic response body.
    await page.goto(`${siteUrl}?tab=serp-features`);
    await expect(page.getByTestId('serp-features-table')).toBeVisible({
      timeout: 30_000,
    });
    await switchLocale(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', {
      timeout: 30_000,
    });
  });

  await test.step('the kill switch preserves stored reads', async () => {
    let capturePausedContext: BrowserContext | null = null;
    try {
      recreateApiWithFlag('false');
      await awaitApiHealthy(page);

      const listRes = await page.request.get(`/api/sites/${siteId}/serp-features`);
      expect(listRes.status()).toBe(200);
      const body = (await listRes.json()) as {
        captureEnabled?: boolean;
        captureStatus?: string;
        rows?: Array<{ phrase?: string; observedAt?: string | null }>;
      };
      expect(body.captureEnabled).toBe(false);
      expect(body.captureStatus).toBe('paused');
      expect(body.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phrase: OWNED_PHRASE, observedAt: expect.any(String) }),
        ]),
      );

      await page.goto(`${siteUrl}?tab=serp-features`);
      const storedRow = page.locator('[data-testid^="serp-features-row-"]', {
        hasText: OWNED_PHRASE,
      });
      await expect(storedRow.getByTestId('serp-feature-chip-featured_snippet')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('serp-features-capture-paused')).toContainText(
        'New SERP feature capture is paused',
      );
      await expect(page.getByTestId('serp-features-error')).toHaveCount(0);
      await scan(page, 'serp-features-stored-flag-off(light)');

      // A completed manual rank job retains its 15-minute BullMQ dedupe key.
      // Use a fresh account/site so this proof exercises a genuinely new job
      // while both API and worker are booted with capture disabled.
      capturePausedContext = await browser.newContext();
      const capturePausedPage = await capturePausedContext.newPage();
      const capturePausedAccount = freshAccount('serp-features-paused');
      await signUp(capturePausedPage, capturePausedAccount);
      grantE2eTier(capturePausedAccount.email, 'agency');
      const capturePausedSiteUrl = await addFirstSite(
        capturePausedPage,
        'https://capture-paused.example',
      );
      const capturePausedSiteId = capturePausedSiteUrl.split('/').pop() ?? '';
      await trackKeyword(capturePausedPage, capturePausedSiteUrl, CAPTURE_PAUSED_PHRASE);
      await expect
        .poll(
          () =>
            runComposePsqlOutput(
              `SELECT count(*)
                 FROM rankings r
                 JOIN keywords k ON k.id = r.keyword_id
                WHERE k.site_id = :'siteId' AND k.phrase = :'phrase';`,
              { variables: { siteId: capturePausedSiteId, phrase: CAPTURE_PAUSED_PHRASE } },
            ),
          { timeout: 120_000, intervals: [2_000] },
        )
        .not.toBe('0');
      expect(
        runComposePsqlOutput(
          `SELECT count(*)
             FROM serp_observations o
             JOIN keywords k ON k.id = o.keyword_id
            WHERE k.site_id = :'siteId' AND k.phrase = :'phrase';`,
          { variables: { siteId: capturePausedSiteId, phrase: CAPTURE_PAUSED_PHRASE } },
        ),
      ).toBe('0');
    } finally {
      try {
        await capturePausedContext?.close();
      } finally {
        recreateApiWithFlag(inheritedRuntime.SERP_FEATURE_TRACKING_ENABLED!);
        await awaitApiHealthy(page);
        assertComposeRuntimeParity(inheritedRuntime);
      }
    }

    // Stored observations survived the flip untouched.
    await page.goto(`${siteUrl}?tab=serp-features`);
    const row = page.locator('[data-testid^="serp-features-row-"]', {
      hasText: OWNED_PHRASE,
    });
    await expect(row.getByTestId('serp-feature-chip-featured_snippet')).toBeVisible({
      timeout: 30_000,
    });
  });
});
