/**
 * Real-browser guard for the unified competitor portfolio and keyword
 * landscape handoff. Adding a confirmed competitor is a free stored mutation;
 * this journey deliberately stops before any metered landscape preview.
 */
import { expect, test } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';

/**
 * The competitors workspace is an Agency-tier feature (`competitors` in
 * `shared/billing/tiers.ts`); with billing enforced on the composed stack a
 * no-plan account sees the honest locked panel and the portfolio/landscape
 * handoff this browser guard exercises never renders. Seed Agency through the
 * same sanctioned psql seam the journey specs use.
 */
function bumpToAgency(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'agency', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'agency', status = 'active', updated_at = now();`,
    { variables: { account_id: accountId } },
  );
}

test('a confirmed competitor carries from the unified portfolio into keyword landscape', async ({ page }) => {
  await signUp(page, freshAccount('competitor-gap'));
  const session = await page.request.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  const sessionBody = (await session.json()) as { user?: { id?: string } };
  expect(sessionBody.user?.id, 'session user id').toBeTruthy();
  bumpToAgency(sessionBody.user!.id!);
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
