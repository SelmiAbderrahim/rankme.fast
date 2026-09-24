/** Security settings acceptance journey, collected by the smoke project. */
import { test, expect } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';

test('security page renders all five cards and arms account deletion', async ({ page }) => {
  const account = freshAccount('sec');
  await signUp(page, account);

  await page.goto('/settings/security');

  // Page header.
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();

  // All five card titles.
  for (const title of [
    'Change password',
    'Change email',
    'Two-factor authentication',
    'Active sessions',
    'Delete account',
  ]) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }

  // ActiveSessions: current device shows as a badge (this session, not revocable).
  await expect(page.getByText('This device', { exact: true })).toBeVisible();

  // DeleteAccount: reveal confirm, type the account email, destructive button arms.
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const confirm = page.getByLabel('Confirm your email address');
  await expect(confirm).toBeVisible();
  const deleteBtn = page.getByRole('button', { name: 'Delete my account' });
  await expect(deleteBtn).toBeDisabled();
  await confirm.fill(account.email);
  await expect(deleteBtn).toBeEnabled();
});

test('Arabic credential denial uses the stable code and never renders Better Auth prose', async ({
  page,
}) => {
  let upstreamCode = '';
  await page.route('**/api/auth/sign-in/email', async (route) => {
    const upstream = await route.fetch();
    const body = (await upstream.json()) as Record<string, unknown>;
    upstreamCode = String(body.code ?? '');
    const headers = { ...upstream.headers() };
    delete headers['content-length'];
    await route.fulfill({
      response: upstream,
      headers,
      json: { ...body, message: 'RAW_BETTER_AUTH_SENTINEL' },
    });
  });

  await page.goto('/login?lng=ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.locator('#login-email').fill('missing-arabic-user@rankme.test');
  await page.locator('#login-password').fill('wrong-password-123');
  await page.locator('form button[type="submit"]').click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  await expect(alert).not.toContainText('RAW_BETTER_AUTH_SENTINEL');
  await expect(page.locator('body')).not.toContainText('Invalid email or password');
  expect(upstreamCode).toBe('INVALID_EMAIL_OR_PASSWORD');
});
