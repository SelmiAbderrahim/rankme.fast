/**
 * Regression guard for the `/sites` per-row `⋯` action menu (the "Open menu
 * for <domain>" DropdownMenu). It reproduces, in a real browser, a report that
 * clicking the trigger opened nothing. jsdom unit tests can't catch a
 * browser-only pointer/stacking/portal regression because jsdom is CSS- and
 * layout-blind, so this real-Chromium check is the guard that would.
 *
 * Note: an open Radix dropdown is modal — it sets aria-hidden on everything
 * outside the menu, so the trigger leaves the accessibility tree once open.
 * Assert on the menu items (which stay in the tree), not the trigger.
 */
import { expect, test } from '@playwright/test';
import { freshAccount, grantE2eTier, signUp } from './helpers/account';

test.describe.configure({ mode: 'serial' });

test('sites row ⋯ menu opens on click and navigates to a tab', async ({ page }) => {
  const account = freshAccount('rowmenu');

  await signUp(page, account);
  grantE2eTier(account.email);

  await page.goto('/sites');
  await page.getByRole('button', { name: /add site/i }).click();
  await page.getByLabel(/url|site/i).fill('https://example.com');
  await page.getByRole('button', { name: /add|create|save/i }).click();

  const trigger = page.getByRole('button', { name: /open menu for/i }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const viewReport = page.getByRole('menuitem', { name: /view report/i });
  await expect(viewReport).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /delete/i })).toBeVisible();

  await viewReport.click();
  await expect(page).toHaveURL(/\/sites\/[^/]+\?tab=report/);
});
