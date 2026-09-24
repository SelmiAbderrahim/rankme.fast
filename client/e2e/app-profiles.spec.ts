/**
 * rankme-app-seo wave 02 — free app-profile registration journey.
 *
 * Registration is format-only: this spec exercises the real Mongo profile
 * lifecycle and structural slot limit without invoking a vendor or spending a
 * metered unit. The app-profiles-flag-off section recreates only the API and
 * always restores APP_SEO_ENABLED in `finally`; stored list reads remain open.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { csrfHeaders } from './helpers/csrf';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const UNAVAILABLE_MESSAGE = 'App SEO is temporarily unavailable.';

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get('/api/health')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(200);
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { user?: { id?: string } };
  expect(body.user?.id).toBeTruthy();
  return body.user!.id!;
}

function seedProTier(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'pro', 'active')
     ON CONFLICT (account_id)
     DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
    { variables: { accountId: id } },
  );
}

async function createSite(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sites', {
    data: { url: 'https://app-profiles.example.com', label: 'App Profiles Journey' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { site?: { id?: string } };
  expect(body.site?.id).toBeTruthy();
  return body.site!.id!;
}

async function register(
  page: Page,
  input: { play?: string; apple?: string; paired?: boolean },
): Promise<void> {
  if (input.play) await page.getByLabel('Google Play package ID').fill(input.play);
  if (input.apple) await page.getByLabel('Apple App Store ID').fill(input.apple);
  if (input.paired) await page.getByLabel('Treat these as the same app').check();
  await page.getByRole('button', { name: 'Register app' }).click();
}

async function deleteProfile(page: Page, id: string): Promise<void> {
  await page.getByRole('button', { name: `Delete ${id}` }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete profile' }).click();
  await expect(page.getByRole('button', { name: `Delete ${id}` })).toHaveCount(0);
}

test('app profiles: registration shapes, slot lifecycle, flag-off stored read, RTL, and axe', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const inheritedRuntime = captureInheritedComposeEnvironment(['APP_SEO_ENABLED']);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('app-profiles');
  await signUp(page, account);
  seedProTier(await accountId(page.request));
  const siteId = await createSite(page.request);

  try {
    await test.step('register Play-only and Apple-only profiles', async () => {
      await page.goto(`/sites/${siteId}?tab=apps&view=profiles`);
      await expect(page.getByTestId('apps-panel')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('app-profile-usage')).toContainText('0 of 2 profiles');

      await register(page, { play: 'com.rankme.playonly' });
      await expect(page.getByText('com.rankme.playonly', { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId('app-profile-usage')).toContainText('1 of 2 profiles');

      await register(page, { apple: '123456789' });
      await expect(page.getByText('123456789', { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId('app-profile-usage')).toContainText('2 of 2 profiles');
    });

    await test.step('delete frees a slot, paired registration succeeds, and N+1 is refused', async () => {
      await deleteProfile(page, 'com.rankme.playonly');
      await expect(page.getByTestId('app-profile-usage')).toContainText('1 of 2 profiles');

      await register(page, {
        play: 'com.rankme.paired',
        apple: '987654321',
        paired: true,
      });
      await expect(page.getByText('com.rankme.paired', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Paired', { exact: true })).toBeVisible();

      // The local catalog disables the button at 2/2. The API assertion below
      // proves the authoritative structural-limit refusal and its discriminator.
      const capped = await page.request.post(`/api/sites/${siteId}/apps/profiles`, {
        data: { playPackageId: 'com.rankme.capped', paired: false },
        headers: await csrfHeaders(page.request),
        failOnStatusCode: false,
      });
      expect(capped.status()).toBe(402);
      const cappedBody = (await capped.json()) as {
        error?: { message?: string; details?: { structuralLimit?: string } };
      };
      expect(cappedBody.error?.details?.structuralLimit).toBe('appProfiles');
      expect(cappedBody.error?.message).toBe(
        'You have reached the app profile limit for this plan.',
      );
      await expect(page.getByTestId('app-profile-limit')).toBeVisible();
      await scan(page, 'profile limit');
    });

    await test.step('unregistering frees the slot for a fresh registration', async () => {
      await deleteProfile(page, '123456789');
      await register(page, { play: 'com.rankme.replacement' });
      await expect(page.getByText('com.rankme.replacement', { exact: true }).first()).toBeVisible();
      await deleteProfile(page, 'com.rankme.replacement');
      await expect(page.getByText('com.rankme.paired', { exact: true }).first()).toBeVisible();
    });

    await test.step('app-profiles-flag-off blocks POST while the stored list survives', async () => {
      recreateComposeServices(['api'], { APP_SEO_ENABLED: 'false' });
      await awaitApiHealthy(page);

      await page.goto(`/sites/${siteId}?tab=apps&view=profiles`);
      await expect(page.getByText('com.rankme.paired', { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await register(page, { play: 'com.rankme.disabled' });
      await expect(page.getByTestId('app-profile-error')).toContainText(UNAVAILABLE_MESSAGE);

      const stored = await page.request.get(`/api/sites/${siteId}/apps/profiles`);
      expect(stored.status()).toBe(200);
      const storedBody = (await stored.json()) as { items?: Array<{ playPackageId?: string }> };
      expect(storedBody.items?.map((item) => item.playPackageId)).toContain('com.rankme.paired');
    });

    await test.step('Arabic is RTL and the panel remains axe-clean', async () => {
      await page.locator('#language-switcher').first().selectOption('ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('apps-panel')).toContainText('تحسين ظهور التطبيقات');
      await expect(page.getByText('com.rankme.paired', { exact: true }).first()).toBeVisible();
      await scan(page, 'app profiles Arabic RTL');
    });
  } finally {
    recreateComposeServices(['api'], {
      APP_SEO_ENABLED: inheritedRuntime.APP_SEO_ENABLED!,
    });
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
