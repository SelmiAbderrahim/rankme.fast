/**
 * Per-spec isolated account seeder (hardened).
 * Each spec mints a fresh `smoke+<uuid>@rankme.test` account so runs never
 * share state; the fake provider tier makes results deterministic
 * without a network hop to any vendor. Compose interaction goes through
 * `runComposePsql` so no spec string-concatenates SQL for prerequisites.
 */
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

import { runComposePsql } from './compose';

export interface TestAccount {
  email: string;
  password: string;
}

/** Grant a bounded paid tier to a freshly registered E2E account. */
export function grantE2eTier(
  email: string,
  tier: 'starter' | 'pro' | 'agency' = 'starter',
): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       SELECT id, :'tier', 'active' FROM "user" WHERE email = :'email'
       ON CONFLICT (account_id)
         DO UPDATE SET tier = EXCLUDED.tier, status = 'active', updated_at = now();`,
    { variables: { email, tier } },
  );
}

// The registration flow leaves an account unverified, and the client
// `RequireVerified` guard bounces unverified users to /verify-email. There is
// no in-product way to verify without the emailed link, so E2E marks the fresh
// account verified straight in Postgres via the compose stack. Test-only seam:
// it never runs in the app. Requires the composed stack to be up.
function verifyAccountEmail(email: string): void {
  runComposePsql(
    `UPDATE "user" SET email_verified = true WHERE email = :'email';`,
    { variables: { email } },
  );
}

export function freshAccount(prefix = 'smoke'): TestAccount {
  return {
    email: `${prefix}+${randomUUID()}@rankme.test`,
    password: 'Passw0rd!' + randomUUID().slice(0, 8),
  };
}

async function waitForAuthField(page: Page, selector: string) {
  const field = page.locator(selector);
  try {
    await field.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    // Docker activity elsewhere on the shared CI host can make Chromium emit
    // ERR_NETWORK_CHANGED after the HTML arrives but before its JS chunks do.
    // Reload the same document once; the test itself still has zero retries.
    await page.reload();
    await field.waitFor({ state: 'visible', timeout: 30_000 });
  }
  return field;
}

function assertLocalAppOrigin(page: Page): void {
  if (new URL(page.url()).origin !== new URL(process.env.CLIENT_URL!).origin) {
    throw new Error('E2E authentication refused a redirect outside the isolated app origin');
  }
}

// Target the form by stable field ids + the submit button, not localized
// label/button text, so the helper works under every locale (incl. ar RTL).
// The register form requires first and last name.
export async function signUp(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/register');
  assertLocalAppOrigin(page);
  await (await waitForAuthField(page, '#register-first-name')).fill('Test');
  await page.locator('#register-last-name').fill('User');
  await page.locator('#register-email').fill(account.email);
  await page.locator('#register-password').fill(account.password);
  const submit = page.locator('form button[type="submit"]');
  // Better Auth deliberately allows only three credential attempts per IP in
  // ten seconds. The composed browser suite uses one loopback address, so a
  // later isolated project can legitimately receive 429 even though its
  // account is unique. Respect the server-provided cooldown once; this is an
  // HTTP-flow assertion, not a Playwright test retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/auth/sign-up/email'),
    );
    await submit.click();
    const response = await responsePromise;
    if (response.status() !== 429) break;
    const retryAfter = Number(response.headers()['x-retry-after'] ?? '10');
    await page.waitForTimeout((Number.isFinite(retryAfter) ? retryAfter + 1 : 11) * 1_000);
  }
  // Signup auto-signs-in; an unverified account lands on /verify-email.
  await page.waitForURL(/\/(verify-email|sites|dashboard|add-site)/, {
    timeout: 30_000,
  });
  // Verify in the DB, then reload so the client re-reads the session and the
  // RequireVerified guard lets us into the app shell.
  verifyAccountEmail(account.email);
  await page.goto('/dashboard');
  await page.waitForURL(/\/(sites|dashboard|add-site)/, { timeout: 30_000 });
}

export async function logIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  assertLocalAppOrigin(page);
  const email = await waitForAuthField(page, '#login-email');
  await email.fill(account.email);
  await page.locator('#login-password').fill(account.password);
  const submit = page.locator('form button[type="submit"]');
  // Better Auth's 3-per-10s credential burst limiter is keyed per loopback
  // IP, which the whole composed suite shares. A later serial sign-in can
  // legitimately catch the cooldown even with correct credentials, so honour
  // the server-provided window once — same contract as `signUp`, not a
  // Playwright retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/auth/sign-in/email'),
    );
    await submit.click();
    const response = await responsePromise;
    if (response.status() !== 429) break;
    const retryAfter = Number(response.headers()['x-retry-after'] ?? '10');
    await page.waitForTimeout((Number.isFinite(retryAfter) ? retryAfter + 1 : 11) * 1_000);
  }
  await page.waitForURL(/\/(sites|dashboard|add-site)/, { timeout: 30_000 });
}
