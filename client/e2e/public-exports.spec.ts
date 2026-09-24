/**
 * Public CSV exports and Looker docs.
 *
 * One serial composed-stack journey creates a real Agency API key through the
 * cookie-authenticated management route, then uses that bearer against the
 * production `/api/v1` mount. Stored rows are deterministic Postgres fixtures;
 * no provider, queue, or vendor endpoint is called. The flag-off step always
 * restores the API service in `finally`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const EXPORT_UNAVAILABLE = 'Public exports are currently unavailable. Try again later.';

interface SessionBody {
  user?: { id?: string };
}

interface SiteBody {
  site: { id: string };
}

interface ApiKeyBody {
  apiKey: { key: string };
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionBody).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

function bumpToAgency(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'agency', 'active')
       ON CONFLICT (account_id)
       DO UPDATE SET tier = 'agency', status = 'active', updated_at = now();`,
    { variables: { account_id: id } },
  );
}

async function createSite(request: APIRequestContext, url: string, label: string): Promise<string> {
  const response = await request.post('/api/sites', {
    data: { url, label },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as SiteBody).site.id;
}

async function createApiKey(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/api-keys', {
    data: { name: 'Looker Studio E2E' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const key = ((await response.json()) as ApiKeyBody).apiKey.key;
  expect(key).toMatch(/^rmf_[A-Za-z0-9_-]{40}$/);
  return key;
}

function seedPublicExportRows(account: string, site: string): void {
  const googleKeyword = runComposePsqlOutput(
    `WITH inserted AS (
       INSERT INTO keywords
         (account_id, site_id, phrase, location_code, language_code, device, engine)
       VALUES
         (:'account_id', :'site_id', :'phrase', 2840, 'en', 'desktop', 'google')
       RETURNING id
     )
     SELECT id FROM inserted;`,
    {
      variables: {
        account_id: account,
        site_id: site,
        phrase: '=formula export phrase',
      },
    },
  );
  const bingKeyword = runComposePsqlOutput(
    `WITH inserted AS (
       INSERT INTO keywords
         (account_id, site_id, phrase, location_code, language_code, device, engine)
       VALUES
         (:'account_id', :'site_id', 'bing export phrase', 2840, 'en', 'desktop', 'bing')
       RETURNING id
     )
     SELECT id FROM inserted;`,
    { variables: { account_id: account, site_id: site } },
  );

  runComposePsql(
    `INSERT INTO rankings
       (keyword_id, engine, position, rank_absolute, found_url,
        ai_overview_present, ai_cited, checked_at, source)
     VALUES
       (:'google_keyword', 'google', 4, 5, 'https://export-primary.example/result',
        true, false, '2026-07-03T00:00:00Z', 'fresh'),
       (:'bing_keyword', 'bing', 7, 8, 'https://export-primary.example/bing',
        false, false, '2026-07-02T00:00:00Z', 'fresh');`,
    { variables: { google_keyword: googleKeyword, bing_keyword: bingKeyword } },
  );

  runComposePsql(
    `INSERT INTO serp_observations
       (account_id, site_id, keyword_id, engine, checked_at, source,
        features, top_results, created_at)
     VALUES
       (:'account_id', :'site_id', :'keyword_id', 'google',
        '2026-07-03T00:00:00Z', 'fresh',
        '{"features":[{"type":"featured_snippet","rankAbsolute":1}],"featuredSnippet":null,"paa":[]}'::jsonb,
        '[]'::jsonb, '2026-07-03T00:00:01Z'),
       (:'account_id', :'site_id', :'keyword_id', 'google',
        '2026-07-02T00:00:00Z', 'cache',
        '{"features":[],"featuredSnippet":null,"paa":[]}'::jsonb,
        '[]'::jsonb, '2026-07-02T00:00:01Z');`,
    {
      variables: {
        account_id: account,
        site_id: site,
        keyword_id: googleKeyword,
      },
    },
  );

  runComposePsql(
    `INSERT INTO backlink_row_snapshots
       (review_id, account_id, site_id, url, domain, spam_score,
        rubric_band, rubric_version, first_seen, last_seen, dofollow,
        is_broken, rationale, rationale_status, captured_at)
     VALUES
       (:'review_new', :'account_id', :'site_id',
        'https://links.example/new', 'links.example', 61, 'toxic',
        'toxicity-rubric-v1', '2026-06-01T00:00:00Z',
        '2026-07-03T00:00:00Z', true, false, '=review this link',
        'annotated', '2026-07-03T00:00:00Z'),
       (:'review_old', :'account_id', :'site_id',
        'https://links.example/old', 'links.example', 12, 'clean',
        'toxicity-rubric-v1', null, null, false, true, null,
        'not_requested', '2026-07-02T00:00:00Z');`,
    {
      variables: {
        review_new: `e2e-new-${account}`,
        review_old: `e2e-old-${account}`,
        account_id: account,
        site_id: site,
      },
    },
  );
}

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

function recreateApi(enabled: string): void {
  recreateComposeServices(['api', 'worker'], { PUBLIC_EXPORTS_ENABLED: enabled });
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
      { timeout: 90_000, intervals: [1_000, 2_000] },
    )
    .toBe(200);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function scanBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(result.violations, `${label} (${theme})`).toEqual([]);
  }
  await setTheme(page, 'light');
}

test('public exports: bearer CSV, stored pagination, ownership, flag, localized docs, RTL, and axe', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(420_000);
  const inheritedRuntime = captureInheritedComposeEnvironment(['PUBLIC_EXPORTS_ENABLED']);
  assertComposeRuntimeParity(inheritedRuntime);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const primary = freshAccount('public-exports-primary');
  await signUp(page, primary);
  const primaryAccount = await accountId(page.request);
  bumpToAgency(primaryAccount);
  const primarySite = await createSite(
    page.request,
    'https://export-primary.example',
    'Public exports',
  );
  const apiKey = await createApiKey(page.request);
  seedPublicExportRows(primaryAccount, primarySite);

  try {
    await test.step('rank history negotiates CSV both ways with BOM, engine, and neutralized text', async () => {
      const byQuery = await page.request.get(
        `/api/v1/sites/${primarySite}/rank-history?format=csv`,
        { headers: bearer(apiKey) },
      );
      const byAccept = await page.request.get(`/api/v1/sites/${primarySite}/rank-history`, {
        headers: { ...bearer(apiKey), Accept: 'text/csv' },
      });
      for (const response of [byQuery, byAccept]) {
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('text/csv');
        const text = (await response.body()).toString('utf8');
        expect(text.charCodeAt(0)).toBe(0xfeff);
        expect(text).toContain('keyword_id,phrase,engine,checked_at');
        expect(text).toContain("'=formula export phrase");
        expect(text).toContain('google');
        expect(text).toContain('bing');
      }

      const bing = await page.request.get(`/api/v1/sites/${primarySite}/rank-history?engine=bing`, {
        headers: bearer(apiKey),
      });
      expect(bing.status()).toBe(200);
      const bingBody = (await bing.json()) as { keywords: Array<{ phrase: string }> };
      expect(bingBody.keywords.map(({ phrase }) => phrase)).toEqual(['bing export phrase']);

      const unknown = await page.request.get(
        `/api/v1/sites/${primarySite}/rank-history?engine=unknown`,
        { headers: bearer(apiKey) },
      );
      expect(unknown.status()).toBe(400);
    });

    await test.step('both stored endpoints paginate and retain observation labels', async () => {
      for (const endpoint of ['serp-features', 'backlink-rows'] as const) {
        const first = await page.request.get(`/api/v1/${endpoint}?siteId=${primarySite}&limit=1`, {
          headers: bearer(apiKey),
        });
        expect(first.status()).toBe(200);
        const firstBody = (await first.json()) as {
          serpFeatures?: Array<{ id: string; sourceKind: string }>;
          backlinkRows?: Array<{ id: string; sourceKind: string }>;
          nextCursor: string;
        };
        const firstRows = firstBody.serpFeatures ?? firstBody.backlinkRows ?? [];
        expect(firstRows).toHaveLength(1);
        expect(firstRows[0]?.sourceKind).toBe('provider_observation');
        expect(firstBody.nextCursor).toBeTruthy();

        const second = await page.request.get(
          `/api/v1/${endpoint}?siteId=${primarySite}&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
          { headers: bearer(apiKey) },
        );
        expect(second.status()).toBe(200);
        const secondBody = (await second.json()) as {
          serpFeatures?: Array<{ id: string; sourceKind: string }>;
          backlinkRows?: Array<{ id: string; sourceKind: string }>;
          nextCursor: null;
        };
        const secondRows = secondBody.serpFeatures ?? secondBody.backlinkRows ?? [];
        expect(secondRows).toHaveLength(1);
        expect(secondRows[0]?.id).not.toBe(firstRows[0]?.id);
        expect(secondRows[0]?.sourceKind).toBe('provider_observation');
        expect(secondBody.nextCursor).toBeNull();
      }
    });

    await test.step('a foreign site is a 404 through the primary bearer', async () => {
      const foreignContext = await browser.newContext({
        baseURL: page.url().split('/').slice(0, 3).join('/'),
      });
      await denyNonLoopback(foreignContext, { onDeny: denials.onDeny });
      const foreignPage = await foreignContext.newPage();
      try {
        const foreign = freshAccount('public-exports-foreign');
        await signUp(foreignPage, foreign);
        const foreignAccount = await accountId(foreignPage.request);
        bumpToAgency(foreignAccount);
        const foreignSite = await createSite(
          foreignPage.request,
          'https://export-foreign.example',
          'Foreign exports',
        );
        for (const endpoint of ['serp-features', 'backlink-rows']) {
          const response = await page.request.get(`/api/v1/${endpoint}?siteId=${foreignSite}`, {
            headers: bearer(apiKey),
          });
          expect(response.status()).toBe(404);
        }
      } finally {
        await foreignContext.close();
      }
    });

    await test.step('English and Arabic Looker docs render accessibly in light/dark with RTL', async () => {
      const english = await page.goto('/docs/looker-studio');
      expect(english?.status()).toBe(200);
      await expect(
        page.getByRole('heading', { name: 'Connect Looker Studio' }).first(),
      ).toBeVisible();
      await expect(page.getByText('provider_observation').first()).toBeVisible();
      await scanBothThemes(page, 'Looker docs English');

      const arabic = await page.goto('/ar/docs/looker-studio');
      expect(arabic?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { name: 'ربط Looker Studio' }).first()).toBeVisible();
      await scanBothThemes(page, 'Looker docs Arabic RTL');
    });

    await test.step('flag-off blocks only new endpoints and CSV, then restores the API', async () => {
      recreateApi('false');
      await awaitApiHealthy(page);

      for (const path of [
        `/api/v1/sites/${primarySite}/rank-history?format=csv`,
        `/api/v1/serp-features?siteId=${primarySite}`,
        `/api/v1/backlink-rows?siteId=${primarySite}`,
      ]) {
        const response = await page.request.get(path, {
          headers: { ...bearer(apiKey), 'x-lang': 'en' },
        });
        expect(response.status(), path).toBe(503);
        const body = (await response.json()) as { error?: { message?: string } };
        expect(body.error?.message).toBe(EXPORT_UNAVAILABLE);
      }
      const shipped = await page.request.get('/api/v1/sites', {
        headers: bearer(apiKey),
      });
      expect(shipped.status()).toBe(200);
    });

    expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
  } finally {
    recreateApi(inheritedRuntime.PUBLIC_EXPORTS_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
