/**
 * Pause-site journey (real browser, composed stack, fake providers):
 * add site → row-menu Pause → confirm dialog (states what stops) → warning
 * chip on the list → workspace banner with relative time → a spend action
 * (keyword add) is refused with the localized paused error → Resume from the
 * banner → banner + chip gone → the same spend action is accepted.
 */
import { expect, test } from '@playwright/test';
import { freshAccount, grantE2eTier, signUp } from './helpers/account';

test.describe.configure({ mode: 'serial' });

test('pause stops new work with clear indication; resume restores it', async ({ page }) => {
  const account = freshAccount('sitepause');

  await signUp(page, account);
  grantE2eTier(account.email);

  // Add a site.
  await page.goto('/sites');
  await page.getByRole('button', { name: /add site/i }).click();
  await page.getByLabel(/url|site/i).fill('https://example.com');
  await page.getByRole('button', { name: /add|create|save/i }).click();

  // Pause from the row ⋯ menu, through the confirm dialog.
  const trigger = page.getByRole('button', { name: /open menu for/i }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: /pause site/i }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/audits, rank checks/i);
  await dialog.getByRole('button', { name: /pause site/i }).click();

  // Paused chip appears on the sites list.
  const chip = page.locator('[data-testid^="site-paused-chip-"]').first();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/paused/i);

  // Workspace shows the banner with the relative pause time.
  await page.getByRole('link', { name: 'example.com' }).first().click();
  await expect(page).toHaveURL(/\/sites\/[^/?]+/);
  const banner = page.getByTestId('site-paused-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/site paused/i);
  await expect(banner).toContainText(/no checks or audits/i);

  // A spend action is refused with the localized paused message.
  const siteUrl = page.url().split('?')[0]!;
  await page.goto(`${siteUrl}?tab=keywords`);
  await page.locator('#keyword-phrase').fill('best coffee beans');
  await page.locator('[data-testid="keyword-add"] button[type="submit"]').click();
  await expect(
    page.getByText(/this site is paused\. resume it to run checks and audits\./i),
  ).toBeVisible();

  // Resume from the banner.
  await page.goto(siteUrl);
  await page.getByTestId('site-paused-banner-resume').click();
  await expect(page.getByTestId('site-paused-banner')).toBeHidden();

  // Chip is gone from the list…
  await page.goto('/sites');
  await expect(page.locator('[data-testid^="site-paused-chip-"]')).toHaveCount(0);

  // …and the same spend action is now accepted (keyword row appears).
  await page.goto(`${siteUrl}?tab=keywords`);
  await page.locator('#keyword-phrase').fill('best coffee beans');
  await page.locator('[data-testid="keyword-add"] button[type="submit"]').click();
  await expect(page.getByText('best coffee beans').first()).toBeVisible();
});
