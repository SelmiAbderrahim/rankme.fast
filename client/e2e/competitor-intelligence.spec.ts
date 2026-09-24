import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import type { LandscapeDetail } from '../src/features/competitors/types';
import { freshAccount, signUp } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

const BASE = (siteId: string) =>
  `/api/sites/${encodeURIComponent(siteId)}/competitor-intelligence`;

interface Discovery {
  suggestions: Array<{ origin: string; registrableDomain: string }>;
  cache: 'hit' | 'miss';
}

interface ProfileResponse {
  profile: { id: string; registrableDomain: string };
}

interface StartResponse {
  run: { runId: string; duplicate: boolean; reservedUnits: number };
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as { user?: { id?: string } }).user?.id;
  expect(id).toBeTruthy();
  return id!;
}

function setTier(id: string, tier: 'pro' | 'agency'): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', :'tier', 'active')
       ON CONFLICT (account_id)
       DO UPDATE SET tier = :'tier', status = 'active', updated_at = now();`,
    { variables: { account_id: id, tier } },
  );
}

async function createSite(
  request: APIRequestContext,
  url: string,
  label: string,
): Promise<string> {
  const response = await request.post('/api/sites', {
    data: { url, label },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const id = ((await response.json()) as { site?: { id?: string } }).site?.id;
  expect(id).toMatch(/^[0-9a-f]{24}$/u);
  return id!;
}

async function post<T>(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
  expected: number,
  idempotencyKey?: string,
): Promise<T> {
  const response = await request.post(url, {
    data,
    headers: {
      ...(await csrfHeaders(request)),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  });
  expect(response.status(), `${url} status`).toBe(expected);
  return (await response.json()) as T;
}

async function put<T>(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
  expected: number,
  idempotencyKey: string,
): Promise<T> {
  const response = await request.put(url, {
    data,
    headers: { ...(await csrfHeaders(request)), 'Idempotency-Key': idempotencyKey },
  });
  expect(response.status(), `${url} status`).toBe(expected);
  return (await response.json()) as T;
}

async function addCompetitor(
  request: APIRequestContext,
  siteId: string,
  url: string,
  key: string,
  source: 'suggested' | 'manual' = 'manual',
): Promise<ProfileResponse['profile']> {
  return (
    await post<ProfileResponse>(
      request,
      `${BASE(siteId)}/competitors`,
      { url, source },
      201,
      key,
    )
  ).profile;
}

async function startLandscape(
  request: APIRequestContext,
  siteId: string,
  profileIds: string[],
  key: string,
): Promise<string> {
  const preview = await post<{
    competitorCount: number;
    selected: unknown[];
    unitsRequired: number;
    cacheHitsCount: boolean;
  }>(request, `${BASE(siteId)}/landscapes/preview`, { competitorProfileIds: profileIds }, 200);
  expect(preview).toMatchObject({
    competitorCount: profileIds.length,
    unitsRequired: profileIds.length,
    cacheHitsCount: true,
  });
  expect(preview.selected).toHaveLength(profileIds.length);

  const started = await post<StartResponse>(
    request,
    `${BASE(siteId)}/landscapes`,
    { competitorProfileIds: profileIds, locale: 'en' },
    202,
    key,
  );
  expect(started.run).toMatchObject({ duplicate: false, reservedUnits: profileIds.length });
  return started.run.runId;
}

async function waitForLandscape(
  request: APIRequestContext,
  siteId: string,
  runId: string,
): Promise<LandscapeDetail> {
  let latest: LandscapeDetail | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${BASE(siteId)}/landscapes/${runId}?limit=100`);
        if (response.status() !== 200) return `http-${response.status()}`;
        latest = (await response.json()) as LandscapeDetail;
        return latest.run.state;
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
    )
    .toMatch(/^(completed|partial)$/u);
  return latest!;
}

async function waitForAnalysis(
  request: APIRequestContext,
  siteId: string,
  analysisId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/content-analyses/${analysisId}?siteId=${encodeURIComponent(siteId)}`,
        );
        if (response.status() !== 200) return `http-${response.status()}`;
        return ((await response.json()) as { status: string }).status;
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
    )
    .toBe('completed');
}

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

test('competitor intelligence: Pro discovery/report/action/export and Agency partial reviewed-content handoff', async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  await signUp(page, freshAccount('competitor-intelligence'));
  const owner = await accountId(page.request);

  setTier(owner, 'pro');
  const proSite = await createSite(
    page.request,
    'https://example.com',
    'Pro competitor landscape',
  );
  const usageBefore = Number(
    runComposePsqlOutput(
      `SELECT coalesce(sum(used), 0)
         FROM usage_counters
        WHERE account_id = :'account_id' AND metric = 'keyword_lookups';`,
      { variables: { account_id: owner } },
    ),
  );
  const discoveryPreview = await post<{ unitsRequired: number; createsProfiles: boolean }>(
    page.request,
    `${BASE(proSite)}/discovery/preview`,
    {},
    200,
  );
  expect(discoveryPreview).toMatchObject({ unitsRequired: 1, createsProfiles: false });
  expect(
    Number(
      runComposePsqlOutput(
        `SELECT coalesce(sum(used), 0)
           FROM usage_counters
          WHERE account_id = :'account_id' AND metric = 'keyword_lookups';`,
        { variables: { account_id: owner } },
      ),
    ),
  ).toBe(usageBefore);

  const discovery = (
    await post<{ discovery: Discovery }>(
      page.request,
      `${BASE(proSite)}/discovery/refresh`,
      {},
      200,
      'e2e-pro-discovery',
    )
  ).discovery;
  expect(discovery.cache).toBe('miss');
  expect(discovery.suggestions).toHaveLength(2);
  const proProfiles = [] as ProfileResponse['profile'][];
  for (const [index, suggestion] of discovery.suggestions.entries()) {
    proProfiles.push(
      await addCompetitor(
        page.request,
        proSite,
        suggestion.origin,
        `e2e-pro-suggestion-${index}`,
        'suggested',
      ),
    );
  }
  proProfiles.push(
    await addCompetitor(
      page.request,
      proSite,
      'https://w3.org',
      'e2e-pro-manual',
    ),
  );
  const proRun = await startLandscape(
    page.request,
    proSite,
    proProfiles.map((profile) => profile.id),
    'e2e-pro-landscape',
  );
  const proReport = await waitForLandscape(page.request, proSite, proRun);
  expect(proReport.run.state).toBe('completed');
  expect(proReport.manifest?.coverage).toMatchObject({
    requestedCompetitors: 3,
    usableCompetitors: 3,
    failedLegs: 0,
  });
  const opportunity = proReport.manifest?.opportunities[0];
  expect(opportunity).toBeTruthy();
  const accepted = await post<{ acceptance: { replayed: boolean; actionId: string } }>(
    page.request,
    `${BASE(proSite)}/landscapes/${proRun}/opportunities/${opportunity!.id}/accept`,
    {},
    201,
    'e2e-pro-accept',
  );
  expect(accepted.acceptance.replayed).toBe(false);
  expect(accepted.acceptance.actionId).toBeTruthy();

  const exported = await post<{ snapshot: { id: string; completeness: { state: string } } }>(
    page.request,
    '/api/report-exports',
    {
      kind: 'competitors.landscape_run',
      format: 'csv',
      target: { scope: 'site_resource', siteId: proSite, resourceId: proRun },
      selection: { accepted: 'all' },
      locale: 'en',
      brandingMode: 'rankmefast',
    },
    201,
  );
  expect(exported.snapshot.completeness.state).toBe('complete');
  const downloaded = await page.request.get(
    `/api/report-exports/${exported.snapshot.id}/download`,
  );
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()['content-type']).toContain('text/csv');
  expect((await downloaded.body()).toString('utf8')).toContain('keyword');

  await page.goto(`/sites/${proSite}?tab=competitors&view=reports&report=${proRun}`);
  await expect(page.getByTestId('competitor-report-detail')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Export or share' })).toBeVisible();
  await scan(page, 'Pro competitor report');

  setTier(owner, 'agency');
  const agencySite = await createSite(
    page.request,
    'https://example.net',
    'Agency partial landscape',
  );
  const domains = [
    'example.com',
    'example.org',
    'example.edu',
    'w3.org',
    'github.com',
    'npmjs.com',
    'nodejs.org',
    'typescriptlang.org',
    'playwright.dev',
    'iana.org',
  ];
  const agencyProfiles = [] as ProfileResponse['profile'][];
  for (const [index, domain] of domains.entries()) {
    agencyProfiles.push(
      await addCompetitor(
        page.request,
        agencySite,
        `https://${domain}`,
        `e2e-agency-profile-${index}`,
      ),
    );
  }
  const agencyRun = await startLandscape(
    page.request,
    agencySite,
    agencyProfiles.map((profile) => profile.id),
    'e2e-agency-landscape',
  );
  const agencyReport = await waitForLandscape(page.request, agencySite, agencyRun);
  expect(agencyReport.run.state).toBe('partial');
  expect(agencyReport.manifest?.coverage).toMatchObject({
    requestedCompetitors: 10,
    usableCompetitors: 9,
    failedLegs: 3,
  });
  expect(agencyReport.manifest?.warnings.some((warning) => warning.code === 'PARTIAL_COMPETITOR'))
    .toBe(true);

  const rivalOne = agencyProfiles.find(
    (profile) => profile.registrableDomain === 'example.com',
  )!;
  const suggestion = agencyReport.manifest?.pageSuggestions.find(
    (item) => item.competitorProfileId === rivalOne.id,
  );
  expect(suggestion).toBeTruthy();
  const reviewed = await put<{ review: { state: string; version: number } }>(
    page.request,
    `${BASE(agencySite)}/landscapes/${agencyRun}/page-matches/${suggestion!.id}`,
    {
      decision: 'approved',
      ownedUrl: suggestion!.ownedUrl,
      competitorUrl: suggestion!.competitorUrl,
      version: 0,
    },
    201,
    'e2e-agency-review',
  );
  expect(reviewed.review).toMatchObject({ state: 'approved', version: 1 });

  await page.goto(`/sites/${agencySite}?tab=competitors&view=reports&report=${agencyRun}`);
  await expect(page.getByTestId('competitor-report-detail')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Partial data', { exact: true })).toBeVisible();
  const match = page.getByTestId(`page-match-${suggestion!.id}`);
  await expect(match.getByRole('link', { name: 'Start focused analysis' })).toBeVisible();
  await expect(match.getByRole('link', { name: 'Monitor this reviewed page' })).toBeVisible();

  await match.getByRole('link', { name: 'Start focused analysis' }).click();
  await expect(page).toHaveURL(/[?&]tab=content/u);
  await expect(page.getByTestId('content-form-reviewed-sources')).toBeVisible();
  await expect(page.getByTestId('content-form-url')).toHaveValue(suggestion!.ownedUrl);
  await expect(page.getByTestId('content-form-keyword')).not.toHaveValue('');
  await page.getByTestId('content-form-consent').click();
  await page.getByTestId('content-form-submit').click();
  await expect(page).toHaveURL(/[?&]analysis=/u, { timeout: 30_000 });
  const analysisId = new URL(page.url()).searchParams.get('analysis');
  expect(analysisId).toMatch(/^[0-9a-f]{24}$/u);
  await waitForAnalysis(page.request, agencySite, analysisId!);

  await page.goto(`/sites/${agencySite}?tab=competitors&view=reports&report=${agencyRun}`);
  await expect(page.getByTestId(`page-match-${suggestion!.id}`)).toBeVisible();
  await page
    .getByTestId(`page-match-${suggestion!.id}`)
    .getByRole('link', { name: 'Monitor this reviewed page' })
    .click();
  await expect(page).toHaveURL(/[?&]view=monitoring/u);
  await expect(page.getByTestId('monitoring-panel')).toBeVisible();

  await page.locator('#language-switcher:visible').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.setViewportSize({ width: 390, height: 844 });
  await scan(page, 'Agency competitor monitoring Arabic mobile');
  expect(denials.urls, 'browser egress').toEqual([]);
});
