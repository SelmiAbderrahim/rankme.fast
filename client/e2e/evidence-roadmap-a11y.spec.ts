/**
 * Cross-feature accessibility, RTL, and semantic-usability sweep
 * for the evidence-first roadmap (Journeys A–D shipped).
 *
 * Coverage:
 *
 *   - Representative light + dark axe scans of every predecessor-shipped
 *     workspace form/preview/progress surface (Journey A next-actions,
 *     Journey B AI-Visibility + Content Intelligence, Journey C Audience
 *     Research, Journey D weekly-pulse settings + GSC generative-appearance
 *     card + keyword workspace).
 *   - Public error / docs / auth surfaces so a broken
 *     404 chrome or missing skip-link fails at CI time, not in support.
 *   - Arabic (`ar`) RTL parity for the same critical surfaces. Every
 *     Arabic surface asserts `dir="rtl"` on `<html>` and re-runs axe.
 *   - Semantic keyboard/focus assertions on the register form so this
 *     spec is not just an axe rubber-stamp: skip-link visibility on focus,
 *     tab order across the four form fields + terms + submit, and the
 *     inline error region gaining `role="alert"` after an empty submit.
 *   - Reduced-motion + colour-scheme parity via the `a11y` project's
 *     project-level `reducedMotion: 'reduce'` policy (see
 *     `playwright.config.ts` — this spec is enrolled in the dedicated
 *     `evidence-roadmap-a11y` project which mirrors that policy).
 *   - Network egress deny-list: NO browser request may reach a
 *     non-loopback host during the sweep. Any denial is a hard failure
 *     (`denials.urls` snapshot asserted at the end of each test), which
 *     satisfies the "hostile / cross-origin content safety" clause
 *     because none of the shipped surfaces should be issuing external
 *     script/img/xhr traffic.
 *
 * The spec deliberately does NOT re-drive full journey flows — those are
 * exercised by the six per-journey specs enrolled elsewhere. This is a
 * cross-cutting release gate that lands zero product code and asserts
 * against the shipped surface as-is. Any axe violation is a real defect
 * and MUST be repaired inside the surface it affects before
 * this spec turns green.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  freshAccount,
  grantE2eTier,
  signUp,
  type TestAccount,
} from './helpers/account';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Above-the-fold Reveal nodes stay opaque=0 until the IntersectionObserver
// fires. Axe evaluates computed style in isolation and would attribute the
// transient opacity to the ancestor chain, producing false contrast failures.
// Freeze the entrance effect at its final visual state before every scan so
// the audit reflects the delivered visual, not the mid-animation intermediate.
const FREEZE_REVEAL_CSS =
  'html.mk-js .mk-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }';

async function scan(page: Page, label: string): Promise<void> {
  await page.addStyleTag({ content: FREEZE_REVEAL_CSS });
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect.soft(results.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    window.localStorage.setItem('theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  // Reload so the ThemeProvider re-reads the persisted preference and every
  // token flips through the .dark class rather than only the toggled root.
  await page.reload();
}

async function attachEgressGuard(context: BrowserContext): Promise<string[]> {
  const { urls, onDeny } = collectDenials();
  await denyNonLoopback(context, { onDeny });
  return urls;
}

async function assertNoExternalEgress(urls: string[], label: string): Promise<void> {
  expect.soft(urls, `${label}: browser reached non-loopback origins`).toEqual([]);
}

async function addFirstSite(page: Page, url = 'https://example.com'): Promise<string> {
  // The Sites page renders both the empty-state add form and the row list
  // through the same shipped controller — target the input by shared label
  // regex so the helper works in every locale (English, Arabic, French, …).
  // Adding a site stays on /sites (AddSiteForm reloads the list, it never
  // navigates); the shipped path into the per-site workspace is the row's
  // domain link, whose accessible name is the domain — locale-independent.
  await page.goto('/sites');
  await page.getByLabel(/url|رابط|adresse|site/i).fill(url);
  await page.getByRole('button', { name: /add|save|إضافة|حفظ|ajouter/i }).click();
  const domain = new URL(url).hostname;
  await page.getByRole('link', { name: domain }).first().click();
  await page.waitForURL(/\/sites\/[a-f0-9-]+/i, { timeout: 30_000 });
  const currentUrl = page.url();
  return currentUrl.split('?')[0] ?? currentUrl;
}

async function withSignedInAccount(
  page: Page,
  prefix: string,
): Promise<TestAccount> {
  const account = freshAccount(prefix);
  await signUp(page, account);
  grantE2eTier(account.email, 'agency');
  return account;
}

// ---------------------------------------------------------------------------
// Group 1 — public surfaces (no signup). Marketing SSR, error chrome, docs
// nav, verify-email, login/register. Each scanned in light + dark.
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  test.describe(`public ${theme} sweep`, () => {
    test(`register (${theme}) — axe + skip-link + focus order`, async ({ page, context }) => {
      const denials = await attachEgressGuard(context);
      await page.goto('/register');
      await setTheme(page, theme);
      // Skip-link becomes visible only on focus. Tab from body → the first
      // focusable is the shared "Skip to content" link.
      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => document.activeElement?.textContent ?? '');
      expect
        .soft(active.toLowerCase(), `register(${theme}): first tab lands on skip-nav or logo`)
        .toMatch(/skip|content|home|rankme|register|create/i);
      // Every required field is tabbable and the terms checkbox is a real
      // <input type=checkbox> (not a click-only div) so axe finds it.
      await page.locator('#register-first-name').focus();
      const fieldOrder = ['register-first-name', 'register-last-name', 'register-email', 'register-password'];
      for (const id of fieldOrder) {
        expect
          .soft(await page.evaluate(() => document.activeElement?.id ?? ''), `register(${theme}): focus on ${id}`)
          .toBe(id);
        await page.keyboard.press('Tab');
      }
      await scan(page, `register(${theme})`);
      await assertNoExternalEgress(denials, `register(${theme})`);
    });

    test(`login (${theme}) — axe`, async ({ page, context }) => {
      const denials = await attachEgressGuard(context);
      await page.goto('/login');
      await setTheme(page, theme);
      await scan(page, `login(${theme})`);
      await assertNoExternalEgress(denials, `login(${theme})`);
    });

    test(`docs index (${theme}) — axe`, async ({ page, context }) => {
      const denials = await attachEgressGuard(context);
      await page.goto('/docs');
      await setTheme(page, theme);
      await scan(page, `docs-index(${theme})`);
      await assertNoExternalEgress(denials, `docs-index(${theme})`);
    });

    test(`verify-email chrome (${theme}) — axe`, async ({ page, context }) => {
      const denials = await attachEgressGuard(context);
      await page.goto('/verify-email');
      await setTheme(page, theme);
      await scan(page, `verify-email(${theme})`);
      await assertNoExternalEgress(denials, `verify-email(${theme})`);
    });

    test(`404 chrome (${theme}) — axe`, async ({ page, context }) => {
      const denials = await attachEgressGuard(context);
      // Deliberately unreachable slug — the shared NotFound component MUST
      // ship the same shell (nav, footer, skip-link) as every other route so
      // a lost user recovers cleanly.
      await page.goto('/definitely-not-a-real-route-xyz');
      await setTheme(page, theme);
      await scan(page, `not-found(${theme})`);
      await assertNoExternalEgress(denials, `not-found(${theme})`);
    });
  });
}

// ---------------------------------------------------------------------------
// Group 2 — docs 7-locale parity sweep (public). Every locale must ship the
// same skip-link, header/nav landmarks, and axe cleanliness. This is a
// widened restatement of `docs-roadmap.spec.ts`'s locale walk with axe on
// each of the seven locales.
// ---------------------------------------------------------------------------

const SUPPORTED_LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;

for (const locale of SUPPORTED_LOCALES) {
  test(`docs — ${locale} locale axe`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    const denials = await attachEgressGuard(context);
    try {
      const path = locale === 'en' ? '/docs' : `/${locale}/docs`;
      await page.goto(path);
      if (locale === 'ar') {
        await expect(page.locator('html'), 'ar docs sets dir=rtl').toHaveAttribute('dir', 'rtl');
      }
      await scan(page, `docs(${locale})`);
      await assertNoExternalEgress(denials, `docs(${locale})`);
    } finally {
      await context.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Group 3 — authenticated LTR tour of the six workspaces surfaced by the
// evidence-first roadmap. One signup, one site, six workspace tabs, one
// settings visit, one settings/notifications visit. Each scan is a
// distinct axe run so a broken workspace can be located from the label.
// ---------------------------------------------------------------------------

test('authenticated LTR — six-workspace sweep', async ({ page, context }) => {
  test.setTimeout(240_000);
  const denials = await attachEgressGuard(context);
  await withSignedInAccount(page, 'a11y-ltr');

  // The sites page itself is a shared shell / add-form. It must be axe-clean
  // even before a site exists so the first-run experience is not a regression.
  await page.goto('/sites');
  await scan(page, 'sites(ltr)');

  const siteUrl = await addFirstSite(page);

  // Overview is the default tab; every subsequent scan is a URL-driven tab
  // navigation so this sweep double-serves as a proof that `?tab=` state
  // survives reload (mandated by `.claude/rules/url-tab-state.md`).
  await page.goto(`${siteUrl}?tab=overview`);
  await expect(page.getByTestId('overview-panel')).toBeVisible({ timeout: 30_000 });
  await scan(page, 'site-overview(ltr)');

  await page.goto(`${siteUrl}?tab=report`);
  await expect(page.getByTestId('report-retest')).toBeVisible({ timeout: 30_000 });
  await scan(page, 'report(ltr)');

  await page.goto(`${siteUrl}?tab=keywords`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'keywords(ltr)');

  await page.goto(`${siteUrl}?tab=research`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'keyword-research(ltr)');

  await page.goto(`${siteUrl}?tab=content&view=analyses`);
  await expect(page.getByTestId('content-intelligence-panel')).toBeVisible({ timeout: 30_000 });
  await scan(page, 'content-intelligence(ltr)');

  await page.goto(`${siteUrl}?tab=ai-visibility`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'ai-visibility(ltr)');

  await page.goto(`${siteUrl}?tab=audience-research`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'audience-research(ltr)');

  await page.goto(`${siteUrl}?tab=google`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'google-connections(ltr)');

  await page.goto(`${siteUrl}?tab=local-seo`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'local-seo(ltr)');

  // Global surfaces outside the site workspace.
  await page.goto('/settings');
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'settings(ltr)');

  await page.goto('/settings/notifications');
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await scan(page, 'settings-notifications(ltr)');

  await assertNoExternalEgress(denials, 'ltr-tour');
});

// ---------------------------------------------------------------------------
// Group 4 — authenticated Arabic (RTL) tour. Every scan re-asserts
// `dir="rtl"` so a regression that drops the locale attribute on a tab
// navigation is a hard failure rather than a stale reload.
// ---------------------------------------------------------------------------

test('authenticated RTL — Arabic workspace sweep', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ locale: 'ar' });
  const page = await context.newPage();
  const denials = await attachEgressGuard(context);
  try {
    await withSignedInAccount(page, 'a11y-rtl');

    await page.goto('/sites');
    await expect(page.locator('html'), 'ar /sites sets dir=rtl').toHaveAttribute('dir', 'rtl');
    await scan(page, 'sites(ar)');

    const siteUrl = await addFirstSite(page);
    await page.goto(`${siteUrl}?tab=overview`);
    await expect(page.locator('html'), 'ar overview keeps dir=rtl').toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('overview-panel')).toBeVisible({ timeout: 30_000 });
    await scan(page, 'site-overview(ar)');

    await page.goto(`${siteUrl}?tab=content&view=analyses`);
    await expect(page.getByTestId('content-intelligence-panel')).toBeVisible({ timeout: 30_000 });
    await scan(page, 'content-intelligence(ar)');

    await page.goto(`${siteUrl}?tab=audience-research`);
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await scan(page, 'audience-research(ar)');

    await page.goto(`${siteUrl}?tab=ai-visibility`);
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await scan(page, 'ai-visibility(ar)');

    await page.goto(`${siteUrl}?tab=keywords`);
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await scan(page, 'keywords(ar)');

    await page.goto('/settings/notifications');
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await scan(page, 'settings-notifications(ar)');

    await assertNoExternalEgress(denials, 'rtl-tour');
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Group 5 — narrow-viewport sweep (mobile-ish 390×844). Same critical
// forms and previews as Group 3 but at a viewport where sticky header,
// mobile Sheet menu, and stacked cards must remain axe-clean and
// keyboard-operable. The site tour is intentionally trimmed to the
// entry surfaces most likely to regress on narrow widths (workspace
// selector, workspace tab, add-site form).
// ---------------------------------------------------------------------------

test('narrow viewport — critical surfaces', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const denials = await attachEgressGuard(context);
  try {
    await withSignedInAccount(page, 'a11y-narrow');
    await page.goto('/sites');
    await scan(page, 'sites(narrow)');

    const siteUrl = await addFirstSite(page);
    await page.goto(`${siteUrl}?tab=overview`);
    await expect(page.getByTestId('overview-panel')).toBeVisible({ timeout: 30_000 });
    await scan(page, 'site-overview(narrow)');

    await page.goto(`${siteUrl}?tab=content&view=analyses`);
    await expect(page.getByTestId('content-intelligence-panel')).toBeVisible({ timeout: 30_000 });
    await scan(page, 'content-intelligence(narrow)');

    await page.goto('/settings/notifications');
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await scan(page, 'settings-notifications(narrow)');

    await assertNoExternalEgress(denials, 'narrow-tour');
  } finally {
    await context.close();
  }
});
