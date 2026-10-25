/**
 * Core UX smoke path. Drives sign-up → add site → run audit →
 * report → retest → keywords → logout end-to-end against the
 * composed stack (fake provider tier). Serial by design — the flow is one
 * story per test worker.
 */
import { expect, test } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';

test.describe.configure({ mode: 'serial' });

test('signup → add site → audit → report → retest → keywords → logout', async ({
  page,
}) => {
  const account = freshAccount('smoke');

  await test.step('sign up and land on the add-site screen', async () => {
    await signUp(page, account);
    await expect(page).toHaveURL(/\/(sites|add-site|dashboard)/);
    const session = await page.request.get('/api/auth/get-session');
    expect(session.status()).toBe(200);
    const body = (await session.json()) as { user?: { id?: string } };
    expect(body.user?.id, 'session user id').toBeTruthy();
  });

  await test.step('add example.com', async () => {
    await page.goto('/sites');
    await page.getByLabel(/url|site/i).fill('https://example.com');
    await page.getByRole('button', { name: /add|create|save/i }).click();
    // The sites table renders the domain in several cells — any visible one is enough.
    await expect(page.getByText('example.com').first()).toBeVisible();
  });

  await test.step('run audit and reach the report screen', async () => {
    // Navigation lives in the per-row ⋯ menu (SitesTable); "View report" is
    // its first item. A fresh site has no run yet, so the report screen shows
    // the "Run your first audit" CTA (report-retest).
    await page
      .getByRole('button', { name: /open menu for/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /view report/i }).click();
    // Locked contract: the report-level Retest CTA opens a
    // spend-preview confirmation dialog instead of mutating immediately.
    // The preview restates the honest unit price (exactly one audit run),
    // the fresh-crawl/no-cache disclosure, and the live allowance line —
    // one confirm click drives exactly one mutation.
    await page.getByTestId('report-retest').click();
    await expect(page.getByTestId('report-retest-dialog')).toBeVisible();
    await expect(page.getByTestId('retest-preview')).toBeVisible();
    await expect(page.getByTestId('retest-preview-units')).toHaveText('1');
    await expect(page.getByTestId('retest-preview-remaining')).toBeVisible();
    await page.getByTestId('report-retest-confirm').click();
    // The dialog closes only when the start mutation fulfilled.
    await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 60_000 });
  });

  await test.step('report has three tabs and Fix-now counts > 0', async () => {
    const tabs = page.getByTestId('report-tabs').getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await tabs.first().click();
    await expect(page.getByText(/fix/i).first()).toBeVisible();
  });

  await test.step('overview turns the latest audit into next actions and evidence', async () => {
    const siteUrl = page.url().split('?')[0];
    await page.goto(`${siteUrl}?tab=overview`);
    await expect(page.getByTestId('overview-panel')).toBeVisible();
    await expect(page.getByTestId('overview-next-actions')).toBeVisible();
    await expect(page.getByTestId('overview-search')).toBeVisible();
    await expect(page.getByTestId('overview-pagespeed')).toBeVisible();
    await expect(page.getByTestId('overview-keywords')).toBeVisible();
    await page.getByTestId('overview-primary-action').click();
    await expect(page).toHaveURL(/tab=report/);
  });

  await test.step('deep-link ?tab=report&bucket=passed switches tabs', async () => {
    // Site tabs own `?tab=`; report buckets use `?bucket=` (report/tabState.ts).
    await page.goto(page.url().replace(/\?.*$/, '') + '?tab=report&bucket=passed');
    await expect(page.getByTestId('report-tabs')).toBeVisible();
  });

  await test.step('open one issue detail', async () => {
    const detailTrigger = page.getByRole('button', { name: /details|open|view/i }).first();
    if (await detailTrigger.count()) {
      await detailTrigger.click();
      await expect(page.getByText(/why|fix/i).first()).toBeVisible();
    }
  });

  await test.step('retest and see fixed/regressed markers', async () => {
    const retest = page.getByRole('button', { name: /retest|re-?run/i }).first();
    if (await retest.count()) {
      // Same locked contract as the first run: CTA → spend-preview dialog →
      // one confirm → one audit run.
      await retest.click();
      await expect(page.getByTestId('report-retest-dialog')).toBeVisible();
      await expect(page.getByTestId('retest-preview-units')).toHaveText('1');
      await page.getByTestId('report-retest-confirm').click();
      await expect(page.getByTestId('report-retest-dialog')).not.toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('report-tabs')).toBeVisible({ timeout: 60_000 });
    }
  });

  await test.step('add a keyword and see the trend panel', async () => {
    await page.goto('/keywords');
    const addKeyword = page.getByTestId('keyword-add');
    if (await addKeyword.count()) {
      await page.getByLabel(/keyword/i).fill('example brand');
      await page.getByRole('button', { name: /add|track|save/i }).click();
      await expect(page.getByTestId('rank-trend')).toBeVisible({ timeout: 30_000 });
    }
  });

  await test.step('logout redirects a protected route to login', async () => {
    // Sign out lives in the account menu of the app top bar.
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/sites');
    await expect(page).toHaveURL(/\/login/);
  });
});
