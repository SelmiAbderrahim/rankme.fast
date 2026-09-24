/**
 * SERP-overlap keyword clustering composed-stack
 * journey.
 *
 * Proof shape:
 *   - stored `serp_observations` rows (seeded here exactly as the rank
 *     processor persists them) drive a run whose groups carry their evidence:
 *     member phrases, the observation date of each member, and the shared
 *     result URLs that formed the group;
 *   - a keyword with no stored observation, and one whose observation has aged
 *     past the seven-day window, are BLOCKED and named with their reason —
 *     never silently dropped and never fetched live;
 *   - the previewed unit is disclosed BEFORE the paid confirm, cancelling
 *     spends nothing, and the N+1 request lands on the localized cap state;
 *   - re-opening a stored run is free (the meter does not move);
 *   - with `KEYWORD_CLUSTERING_ENABLED=false` the new-run entry point answers
 *     the shipped localized 503 while stored reads stay open (proved against
 *     an api ACTUALLY booted with the flag off, then restored);
 *   - Arabic RTL journey, keyboard operation, plus axe scans in light and dark.
 *
 * The `finally` block restores the inherited flag on api + worker and checks
 * their runtime parity, even when an assertion or health wait fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { csrfHeaders } from './helpers/csrf';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Localized (en) `keywordClusters.errors.productUnavailable`. */
const UNAVAILABLE_MESSAGE =
  'Keyword clustering is temporarily unavailable. Please try again later.';

/** Pro base cap for `keyword_cluster_runs`. */
const PRO_CAP = 4;

/** Three of these ten are shared by the two groupable phrases. */
const SHARED = [
  'https://shared-one.example/a',
  'https://shared-two.example/b',
  'https://shared-three.example/c',
];
const BLOCKED_SCOPE = ['zzz never checked', 'zzz stale check'] as const;

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
}

function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { KEYWORD_CLUSTERING_ENABLED: value });
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get('/api/health');
          return res.status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(200);
}

async function addSite(page: Page, url: string): Promise<string> {
  await page.goto('/sites');
  await page.locator('#site-url').fill(url);
  await page.locator('form button[type="submit"]').click();
  const domain = new URL(url).hostname;
  await page.getByRole('link', { name: domain, exact: true }).first().click();
  await page.waitForURL(/\/sites\/[a-f0-9-]+/i, { timeout: 30_000 });
  const current = page.url().split('?')[0] ?? page.url();
  return current.split('/').pop() ?? '';
}

async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('keyword-clustering spec: no session user id');
  return body.user.id;
}

/** Pro tier: `keyword_cluster_runs` cap 4 and the surface is Pro+. */
function seedProTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'pro', 'active')
     ON CONFLICT (account_id) DO UPDATE SET tier = 'pro', status = 'active';`,
    { variables: { accountId } },
  );
}

/** One active tracked Google keyword. Returns its uuid. */
function seedKeyword(args: { accountId: string; siteId: string; phrase: string }): string {
  return runComposePsqlOutput(
    `INSERT INTO keywords
       (account_id, site_id, phrase, location_code, language_code, device,
        engine, active)
     VALUES (:'accountId', :'siteId', :'phrase', 2840, 'en', 'desktop',
             'google', true)
     RETURNING id;`,
    { variables: args },
  ).trim();
}

/**
 * One stored observation, exactly as `recordObservation` persists it. `ageDays`
 * moves `checked_at` back so the seven-day freshness window can be exercised
 * without a clock stub.
 */
function seedObservation(args: {
  accountId: string;
  siteId: string;
  keywordId: string;
  urls: readonly string[];
  ageDays: number;
}): void {
  const topResults = JSON.stringify(
    args.urls.map((url, index) => ({
      domain: new URL(url).hostname,
      url,
      rankGroup: index + 1,
      rankAbsolute: index + 1,
    })),
  );
  runComposePsql(
    `INSERT INTO serp_observations
       (account_id, site_id, keyword_id, engine, checked_at, source, features,
        top_results)
     VALUES (:'accountId', :'siteId', :'keywordId'::uuid, 'google',
             now() - (:'ageDays'::int * interval '1 day'), 'fresh',
             '{"features":[],"featuredSnippet":null,"paa":[]}'::jsonb,
             :'topResults'::jsonb)
     ON CONFLICT DO NOTHING;`,
    {
      variables: {
        accountId: args.accountId,
        siteId: args.siteId,
        keywordId: args.keywordId,
        topResults,
        ageDays: String(args.ageDays),
      },
    },
  );
}

/**
 * Pre-spend the account down to its last run so the N+1 refusal is reached in
 * two starts rather than five. The named per-account `keyword_clusters` bucket
 * (10 mutations/min) would otherwise 429 first, and a 429 is not the state
 * under test — the router-level N+1 -> 402 invariant is separately pinned by
 * `server/src/modules/keyword-clusters/keyword-clusters.routes.test.ts`.
 */
function seedUsedRuns(accountId: string, used: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'keyword_cluster_runs', :'used'::bigint, ${PRO_CAP})
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint;`,
    { variables: { accountId, used } },
  );
}

function usedRuns(accountId: string): string {
  return runComposePsqlOutput(
    `SELECT coalesce(max(used), 0) FROM usage_counters
     WHERE account_id = :'accountId' AND metric = 'keyword_cluster_runs';`,
    { variables: { accountId } },
  ).trim();
}

async function previewAndStart(page: Page, siteId: string): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=keyword-clusters&view=new`);
  await uncheckBlockedScope(page);
  await page.getByTestId('keyword-clusters-preview-button').click();
  await expect(page.getByTestId('keyword-clusters-preview')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('keyword-clusters-confirm').click();
}

async function uncheckBlockedScope(page: Page): Promise<void> {
  for (const phrase of BLOCKED_SCOPE) {
    await page.getByRole('checkbox', { name: phrase, exact: true }).uncheck();
  }
}

test('keyword clustering: stored-only grouping, evidence, blocked keywords, cap, free reopen, flag-off, RTL, axe', async ({
  page,
}) => {
  // Multi-step composed-stack journey (signup, two sites, worker round-trip,
  // one api recreate pair) on a shared gate host. Retries stay 0.
  test.setTimeout(420_000);
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'KEYWORD_CLUSTERING_ENABLED',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('keyword-clustering');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  seedProTier(accountId);

  const siteId = await addSite(page, 'https://clusters.example.com');
  const barrenSiteId = await addSite(page, 'https://barren.example.com');

  // Two phrases share exactly three of ten results — the pinned threshold.
  const alpha = seedKeyword({ accountId, siteId, phrase: 'aaa running shoes' });
  const beta = seedKeyword({ accountId, siteId, phrase: 'bbb running shoes' });
  // A third phrase shares nothing: it must survive as an honest singleton.
  const gamma = seedKeyword({ accountId, siteId, phrase: 'ccc hiking poles' });
  // Blocked: never checked.
  seedKeyword({ accountId, siteId, phrase: 'zzz never checked' });
  // Blocked: checked, but outside the seven-day window.
  const stale = seedKeyword({ accountId, siteId, phrase: 'zzz stale check' });
  // The barren site needs a selectable scope so its missing-observation
  // preflight is exercised instead of leaving the preview button disabled.
  seedKeyword({ accountId, siteId: barrenSiteId, phrase: 'missing alpha' });
  seedKeyword({ accountId, siteId: barrenSiteId, phrase: 'missing beta' });

  seedObservation({
    accountId,
    siteId,
    keywordId: alpha,
    urls: [...SHARED, 'https://only-alpha.example/d'],
    ageDays: 0,
  });
  seedObservation({
    accountId,
    siteId,
    keywordId: beta,
    urls: [...SHARED, 'https://only-beta.example/e'],
    ageDays: 1,
  });
  seedObservation({
    accountId,
    siteId,
    keywordId: gamma,
    urls: [
      'https://poles-one.example/x',
      'https://poles-two.example/y',
      'https://poles-three.example/z',
    ],
    ageDays: 2,
  });
  seedObservation({
    accountId,
    siteId,
    keywordId: stale,
    urls: SHARED,
    ageDays: 30,
  });

  try {
    // ---- an included stale/missing keyword blocks the whole selected scope.
    await page.goto(`/sites/${siteId}?tab=keyword-clusters&view=new`);
    await page.getByTestId('keyword-clusters-preview-button').click();
    await expect(page.getByTestId('keyword-clusters-state-notEnoughKeywords')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('keyword-clusters-blocked')).toBeVisible();
    await page.getByRole('button', { name: /could not take part/i }).click();
    await expect(page.getByTestId('keyword-clusters-blocked-missing')).toContainText(
      'zzz never checked',
    );
    await expect(page.getByTestId('keyword-clusters-blocked-stale')).toContainText(
      'zzz stale check',
    );
    expect(usedRuns(accountId), 'a blocked preflight must not spend').toBe('0');

    // Excluding the two blocked inputs yields an honest three-keyword preview.
    await uncheckBlockedScope(page);
    await page.getByTestId('keyword-clusters-preview-button').click();
    await expect(page.getByTestId('keyword-clusters-preview')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('keyword-clusters-preview-scope')).toContainText('3');
    await expect(page.getByTestId('keyword-clusters-blocked')).toHaveCount(0);

    // Cancel: nothing is reserved.
    await page.getByTestId('keyword-clusters-cancel').click();
    await expect(page.getByTestId('keyword-clusters-preview')).toBeHidden();
    expect(usedRuns(accountId), 'preview + cancel must not spend').toBe('0');

    await scan(page, 'new-run light');

    // ---- a real run through the worker.
    await previewAndStart(page, siteId);
    await page.waitForURL(
      (url) =>
        /^[a-f0-9]{24}$/i.test(url.searchParams.get('run') ?? '') &&
        url.searchParams.get('tab') === 'keyword-clusters' &&
        !url.searchParams.has('view'),
      { timeout: 30_000 },
    );
    const runUrl = page.url();

    await expect(page.getByTestId('keyword-cluster-cluster-1')).toBeVisible({
      timeout: 120_000,
    });
    expect(usedRuns(accountId), 'one completed run consumes one unit').toBe('1');

    // The grouped cluster carries its members AND its evidence.
    const grouped = page.getByTestId('keyword-cluster-cluster-1');
    await expect(grouped).toContainText('aaa running shoes');
    await expect(grouped).toContainText('bbb running shoes');
    await expect(grouped).toContainText('3 shared with the reference keyword');

    await page.getByTestId('keyword-cluster-toggle-cluster-1').click();
    const evidence = page.getByTestId('keyword-cluster-evidence-cluster-1');
    await expect(evidence).toBeVisible();
    for (const url of SHARED) await expect(evidence).toContainText(url);
    // A stored SERP URL is evidence, never a destination this product endorses.
    expect(await evidence.locator('a').count()).toBe(0);

    // The unshared phrase survives as an honest singleton, not a forced group.
    await expect(page.getByTestId('keyword-cluster-cluster-2')).toContainText('ccc hiking poles');
    await expect(page.getByTestId('keyword-cluster-cluster-2')).toContainText(/not grouped/i);

    // The successful run contains exactly the clean scope the user confirmed.
    await expect(page.getByTestId('keyword-clusters-blocked')).toHaveCount(0);

    await scan(page, 'results light');
    await setTheme(page, 'dark');
    await scan(page, 'results dark');
    await setTheme(page, 'light');

    // ---- URL-backed size filter, driven from the keyboard only.
    await page.getByRole('combobox', { name: 'Group size' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'Grouped keywords only', exact: true }).click();
    await page.waitForURL(/size=grouped/, { timeout: 15_000 });
    await expect(page.getByTestId('keyword-cluster-cluster-2')).toBeHidden();

    // ---- re-opening a stored run is free.
    const usedBeforeReopen = usedRuns(accountId);
    await page.goto(runUrl);
    await expect(page.getByTestId('keyword-cluster-cluster-1')).toBeVisible({
      timeout: 30_000,
    });
    expect(usedRuns(accountId), 'a stored re-open must be free').toBe(usedBeforeReopen);

    // ---- a site with no stored observation refuses BEFORE reserving.
    await page.goto(`/sites/${barrenSiteId}?tab=keyword-clusters&view=new`);
    await page.getByTestId('keyword-clusters-preview-button').click();
    await expect(page.getByTestId('keyword-clusters-state-notEnoughKeywords')).toBeVisible({
      timeout: 30_000,
    });
    expect(usedRuns(accountId), 'a refused site must not spend').toBe(usedBeforeReopen);

    // ---- N+1 lands on the localized cap state.
    seedUsedRuns(accountId, String(PRO_CAP));
    await page.goto(`/sites/${siteId}?tab=keyword-clusters&view=new`);
    await uncheckBlockedScope(page);
    await page.getByTestId('keyword-clusters-preview-button').click();
    await expect(page.getByTestId('keyword-clusters-state-cap')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('keyword-clusters-confirm')).toBeDisabled();
    const cappedStart = await page.request.post(`/api/sites/${siteId}/keyword-cluster-runs`, {
      data: { locale: 'en', keywordIds: [alpha, beta, gamma] },
      headers: await csrfHeaders(page.request),
    });
    expect(cappedStart.status(), 'the API must enforce the N+1 cap').toBe(402);
    expect(usedRuns(accountId), 'a refused start must not spend').toBe(String(PRO_CAP));
    await scan(page, 'cap state');

    // ---- Arabic RTL journey over the stored run.
    await page.goto(runUrl);
    await page.locator('#language-switcher').first().selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('keyword-clusters-page')).toBeVisible();
    await scan(page, 'arabic results');
    await page.locator('#language-switcher').first().selectOption('en');

    // ---- flag off: new runs refuse, stored reads stay open.
    recreateApiWithFlag('false');
    await awaitApiHealthy(page);

    const refused = await page.request.post(`/api/sites/${siteId}/keyword-cluster-runs/preview`, {
      data: {},
      headers: await csrfHeaders(page.request),
    });
    expect(refused.status(), 'flag-off preview must be a localized 503').toBe(503);
    expect(await refused.text()).toContain(UNAVAILABLE_MESSAGE);

    await page.goto(runUrl);
    await expect(page.getByTestId('keyword-cluster-cluster-1')).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    recreateApiWithFlag(inheritedRuntime.KEYWORD_CLUSTERING_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
