import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { freshAccount, signUp } from './account';
import { runComposePsql, runComposePsqlOutput } from './compose';
import { csrfHeaders } from './csrf';
import { collectDenials, denyNonLoopback } from './denyNonLoopback';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export type AppSeoMetric =
  | 'app_keyword_checks'
  | 'app_listing_audits'
  | 'app_chart_checks'
  | 'app_keyword_lookups'
  | 'app_competitor_lookups'
  | 'app_review_runs';

export interface AppSeoJourney {
  accountId: string;
  siteId: string;
  profileId: string;
  deniedUrls: string[];
}

interface ProfileResponse {
  profile?: { id?: string };
}

/**
 * Build one isolated Agency + App SEO add-on workspace through the shipped
 * auth, site, and profile APIs. Only entitlement prerequisites are seeded;
 * every feature operation remains a real API/queue/worker interaction.
 */
export async function createAppSeoJourney(
  page: Page,
  context: BrowserContext,
  prefix: string,
  options: { appSeoAddon?: boolean } = {},
): Promise<AppSeoJourney> {
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const account = freshAccount(prefix);
  await signUp(page, account);
  const session = await page.request.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  const accountId = ((await session.json()) as { user?: { id?: string } }).user?.id;
  expect(accountId).toMatch(/^[0-9a-f]{24}$/u);

  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status, app_seo_addon)
       VALUES (:'account_id', 'agency', 'active', true)
       ON CONFLICT (account_id)
       DO UPDATE SET tier = 'agency', status = 'active', app_seo_addon = true,
                     updated_at = now();`,
    { variables: { account_id: accountId! } },
  );

  const siteResponse = await page.request.post('/api/sites', {
    data: {
      url: `https://${prefix}.example`,
      label: `App SEO ${prefix}`,
    },
    headers: await csrfHeaders(page.request),
  });
  expect(siteResponse.status()).toBe(201);
  const siteId = ((await siteResponse.json()) as { site?: { id?: string } }).site?.id;
  expect(siteId).toMatch(/^[0-9a-f]{24}$/u);

  const profileResponse = await page.request.post(`/api/sites/${siteId}/apps/profiles`, {
    data: {
      playPackageId: `com.rankme.${prefix.replaceAll('-', '')}`,
      appStoreId: String(7_000_000_000 + Number.parseInt(accountId!.slice(0, 7), 16)),
      paired: true,
    },
    headers: await csrfHeaders(page.request),
  });
  expect(profileResponse.status()).toBe(201);
  const profileId = ((await profileResponse.json()) as ProfileResponse).profile?.id;
  expect(profileId).toMatch(/^[0-9a-f]{24}$/u);

  // Billing journeys need an already-owned profile to prove the entitlement
  // transition from inactive to active. Create it while access is present,
  // then put only the add-on flag into the requested starting state.
  if (options.appSeoAddon === false) {
    runComposePsql(
      `UPDATE subscriptions
          SET app_seo_addon = false, updated_at = now()
        WHERE account_id = :'account_id';`,
      { variables: { account_id: accountId! } },
    );
  }

  return {
    accountId: accountId!,
    siteId: siteId!,
    profileId: profileId!,
    deniedUrls: denials.urls,
  };
}

export function setAppSeoUsage(
  accountId: string,
  metric: AppSeoMetric,
  used: number,
  limit: number,
): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
               :'metric', :'used'::bigint, :'limit'::bigint)
       ON CONFLICT (account_id, period, metric)
       DO UPDATE SET used = EXCLUDED.used, "limit" = EXCLUDED."limit",
                     updated_at = now();`,
    {
      variables: {
        account_id: accountId,
        metric,
        used: String(used),
        limit: String(limit),
      },
    },
  );
}

export function appSeoUsage(accountId: string, metric: AppSeoMetric): number {
  const raw = runComposePsqlOutput(
    `SELECT coalesce(max(used), 0)
       FROM usage_counters
      WHERE account_id = :'account_id'
        AND period = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
        AND metric = :'metric';`,
    { variables: { account_id: accountId, metric } },
  );
  return Number(raw);
}

export async function csrfPostJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  expectedStatus: number,
): Promise<T> {
  const response = await request.post(url, {
    data,
    headers: await csrfHeaders(request),
    failOnStatusCode: false,
  });
  expect(response.status(), `${url} response`).toBe(expectedStatus);
  return (await response.json()) as T;
}

export async function csrfDelete(
  request: APIRequestContext,
  url: string,
  expectedStatus: number,
): Promise<void> {
  const response = await request.delete(url, {
    headers: await csrfHeaders(request),
    failOnStatusCode: false,
  });
  expect(response.status(), `${url} response`).toBe(expectedStatus);
}

export async function waitForJson<T>(
  request: APIRequestContext,
  url: string,
  predicate: (body: T) => boolean,
  label: string,
): Promise<T> {
  let latest: T | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(url, { failOnStatusCode: false });
        if (response.status() !== 200) return false;
        latest = (await response.json()) as T;
        return predicate(latest);
      },
      { timeout: 120_000, intervals: [500, 1_000, 2_000, 4_000], message: label },
    )
    .toBe(true);
  return latest!;
}

export async function reloadAppSeoPage(page: Page, target: Locator): Promise<void> {
  await page.reload();
  try {
    await expect(target).toBeVisible();
  } catch (error) {
    const blankDocument = await page.evaluate(() => {
      const root = document.querySelector('#root');
      return (root?.childElementCount ?? 0) === 0 && (document.body.textContent ?? '').trim() === '';
    });
    if (!blankDocument) throw error;
    // A host Docker network update can make Chromium lose the application
    // chunks after receiving HTML. Retry only that empty-document transport
    // state; a rendered product assertion is never retried.
    await page.reload();
    await expect(target).toBeVisible();
  }
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    let stabilizer = document.querySelector<HTMLStyleElement>('#e2e-motion-stabilizer');
    if (!stabilizer) {
      stabilizer = document.createElement('style');
      stabilizer.id = 'e2e-motion-stabilizer';
      stabilizer.textContent =
        '*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important;animation-delay:0s!important}';
      document.head.append(stabilizer);
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }, theme);
}

export async function scanAppSeoBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(result.violations, `${label} (${theme}) axe violations`).toEqual([]);
  }
  await setTheme(page, 'light');
}

export async function switchAppSeoToArabic(page: Page): Promise<void> {
  const switcher = page.locator('#language-switcher').first();
  try {
    await expect(switcher).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    const blankDocument = await page.evaluate(() => {
      const root = document.querySelector('#root');
      return (root?.childElementCount ?? 0) === 0 && (document.body.textContent ?? '').trim() === '';
    });
    if (!blankDocument) throw error;
    await page.reload();
    await expect(switcher).toBeVisible({ timeout: 30_000 });
  }
  await switcher.selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

export async function awaitAppSeoApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get('/api/health')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [1_000, 2_000] },
    )
    .toBe(200);
}
