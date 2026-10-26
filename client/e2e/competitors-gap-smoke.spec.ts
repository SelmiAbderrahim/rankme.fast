/**
 * Real-browser guard for the unified competitor portfolio and keyword
 * landscape handoff. Adding a confirmed competitor is a free stored mutation;
 * this journey deliberately stops before any metered landscape preview.
 */
import { expect, test } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';

test('a confirmed competitor carries from the unified portfolio into keyword landscape', async ({ page }) => {
  await signUp(page, freshAccount('competitor-gap'));
  const session = await page.request.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  const sessionBody = (await session.json()) as { user?: { id?: string } };
  expect(sessionBody.user?.id, 'session user id').toBeTruthy();
  await page.goto('/sites');
  await page.getByLabel(/url|site/i).fill('https://example.com');
  await page.getByRole('button', { name: /add|create|save/i }).click();
  await page
    .getByRole('button', { name: /open menu for/i })
    .first()
    .click();
  await page.getByRole('menuitem', { name: /view report/i }).click();
  const siteUrl = page.url().split('?')[0];

  await page.goto(`${siteUrl}?tab=competitors&view=overview`);
  await expect(page.getByTestId('competitor-workspace')).toBeVisible();
  await page.getByLabel('Add a public competitor URL').fill('https://www.example.org/path');
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await expect(page.getByText('example.org', { exact: true })).toBeVisible();

  await page.getByTestId('competitor-view-keywords').click();
  await expect(page).toHaveURL(/view=keywords/u);
  await expect(page.getByTestId('competitor-keywords')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'example.org' })).toBeVisible();
});
