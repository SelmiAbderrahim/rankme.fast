/**
 * SERP content briefs + editor composed proof.
 *
 * All paid stages use the shipped fake rank, content-source, and AI providers.
 * The test drives preview/cancel, a complete evidence-backed brief, immutable
 * editor history, an actual low-ceiling halt, free stored reads, the rollout
 * flag, RTL, and axe.
 */
import { randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp, type TestAccount } from './helpers/account';
import {
  readComposeServiceEnvironment,
  recreateComposeServices,
  runComposeCommand,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FULL_KEYWORD = 'featured snippet content brief';
const HALT_KEYWORD = 'ceiling boundary content brief';

interface CreatedBrief {
  briefId: string;
  status: string;
}

interface BriefDetail {
  id: string;
  creationEnabled: boolean;
  status: string;
  halt: { stage: string; reason: string } | null;
  documents: Array<{ id: string }>;
  outline: Array<{ citations: string[] }>;
  scoreHistory: Array<{ version: number; aiScore: number | null }>;
}

type Tier = 'pro' | 'agency';

const CONTENT_BRIEF_RUNTIME_KEYS = [
  'CLIENT_URL',
  'SERVER_URL',
  'CONTENT_BRIEFS_ENABLED',
  'CONTENT_BRIEF_COST_CEILING_MICROS',
  'PROVIDER_RANK',
  'PROVIDER_CONTENT_SOURCE',
  'PROVIDER_SUMMARY',
  'PROVIDER_AI',
] as const;

function expectedContentBriefRuntime(): Record<string, string | null> {
  const expected = Object.fromEntries(
    CONTENT_BRIEF_RUNTIME_KEYS.map((name) => [name, process.env[name] ?? null]),
  );
  for (const name of CONTENT_BRIEF_RUNTIME_KEYS) {
    if (expected[name] === null) {
      throw new Error(`The content-briefs Playwright project requires ${name}`);
    }
  }
  return expected;
}

function expectContentBriefRuntimeParity(expected: Record<string, string | null>): void {
  expect(readComposeServiceEnvironment('api', CONTENT_BRIEF_RUNTIME_KEYS)).toEqual(expected);
  expect(readComposeServiceEnvironment('worker', CONTENT_BRIEF_RUNTIME_KEYS)).toEqual(expected);
}

function recreateContentBriefServices(enabled: boolean, ceilingMicros = 120_000): void {
  const clientUrl = process.env.CLIENT_URL;
  const serverUrl = process.env.SERVER_URL;
  if (clientUrl === undefined || serverUrl === undefined) {
    throw new Error('content-briefs e2e requires CLIENT_URL and SERVER_URL');
  }
  recreateComposeServices(['api', 'worker'], {
    CLIENT_URL: clientUrl,
    SERVER_URL: serverUrl,
    CONTENT_BRIEFS_ENABLED: enabled ? 'true' : 'false',
    CONTENT_BRIEF_COST_CEILING_MICROS: String(ceilingMicros),
    PROVIDER_RANK: 'fake',
    PROVIDER_CONTENT_SOURCE: 'fake',
    PROVIDER_SUMMARY: 'fake',
    PROVIDER_AI: 'fake',
  });
}

async function awaitServicesHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get('/api/health')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe(200);

  await expect
    .poll(
      () => {
        try {
          runComposeCommand(
            [
              'exec',
              '-T',
              'worker',
              'node',
              '--eval',
              "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ],
          );
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe(true);
}

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem('theme', value);
    document.documentElement.classList.toggle('dark', value === 'dark');
  }, theme);
}

async function setLocale(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page.locator('#language-switcher').selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

async function accountId(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/get-session');
  const body = (await response.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('content-briefs e2e: missing session user');
  return body.user.id;
}

function setTier(id: string, tier: Tier): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', :'tier', 'active')
     ON CONFLICT (account_id)
     DO UPDATE SET tier = :'tier', status = 'active';`,
    { variables: { accountId: id, tier } },
  );
}

async function logout(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL('/login');
}

async function signUpAtTier(
  page: Page,
  prefix: string,
  tier: Tier,
): Promise<{ account: TestAccount; id: string }> {
  const account = freshAccount(prefix);
  await signUp(page, account);
  const id = await accountId(page);
  await logout(page);
  // Let all post-registration writes settle before the tier fixture becomes
  // authoritative, then establish a fresh authenticated billing session.
  setTier(id, tier);
  await logIn(page, account);
  return { account, id };
}

async function csrfPost(
  page: Page,
  url: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return page.request.post(url, {
    data,
    headers: await csrfHeaders(page.request),
    failOnStatusCode: false,
  });
}

async function createSite(page: Page, label: string): Promise<string> {
  const response = await csrfPost(page, '/api/sites', {
    url: 'https://example.com',
    label,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { site: { id: string } };
  return body.site.id;
}

function seedKeyword(id: string, siteId: string, phrase: string): void {
  runComposePsql(
    `INSERT INTO keywords
       (account_id, site_id, phrase, location_code, language_code, device, engine, active)
     VALUES (:'accountId', :'siteId', :'phrase', 2840, 'en', 'desktop', 'google', true)
     ON CONFLICT DO NOTHING;`,
    { variables: { accountId: id, siteId, phrase } },
  );
}

function setAgencyUsage(id: string, used: number): void {
  runComposePsql(
    `INSERT INTO usage_counters
       (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'content_briefs', :'used'::bigint, 8)
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint, "limit" = 8;`,
    { variables: { accountId: id, used: String(used) } },
  );
}

function usedBriefs(id: string): number {
  const value = runComposePsqlOutput(
    `SELECT coalesce(max(used), 0)
     FROM usage_counters
     WHERE account_id = :'accountId' AND metric = 'content_briefs';`,
    { variables: { accountId: id } },
  );
  return Number(value.trim() || '0');
}

async function createBrief(
  page: Page,
  siteId: string,
  keyword: string,
): Promise<{ response: APIResponse; body: CreatedBrief | null }> {
  const response = await csrfPost(page, `/api/sites/${siteId}/content-briefs`, {
    keyword,
    locale: 'en',
    clientKey: randomUUID(),
  });
  const body = response.status() === 202 ? ((await response.json()) as CreatedBrief) : null;
  return { response, body };
}

async function waitForBrief(page: Page, siteId: string, briefId: string): Promise<BriefDetail> {
  let last: BriefDetail | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/sites/${siteId}/content-briefs/${briefId}`);
        if (response.status() !== 200) return `http-${response.status()}`;
        last = (await response.json()) as BriefDetail;
        return last.status;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toMatch(/^(?:completed|completed_empty|completed_partial|failed)$/u);
  if (!last) throw new Error(`content-briefs e2e: brief ${briefId} had no body`);
  return last;
}

async function openBriefs(page: Page, siteId: string): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=content&view=briefs`);
  await expect(page.getByTestId('content-briefs-panel')).toBeVisible({
    timeout: 30_000,
  });
}

test('content briefs: metering, evidence, editor, halt, flag, RTL, and axe', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const inheritedRuntime = expectedContentBriefRuntime();
  expectContentBriefRuntimeParity(inheritedRuntime);

  try {
    recreateContentBriefServices(true);
    await awaitServicesHealthy(page);

    const agency = await signUpAtTier(page, 'content-brief-agency', 'agency');
    const agencySiteId = await createSite(page, 'Content brief journey');
    for (const phrase of [FULL_KEYWORD, HALT_KEYWORD]) {
      seedKeyword(agency.id, agencySiteId, phrase);
    }
    setAgencyUsage(agency.id, 0);

    let fullBriefId = '';

    await test.step('preview cancellation reserves nothing', async () => {
      await openBriefs(page, agencySiteId);
      await page.locator('#content-brief-keyword').fill(FULL_KEYWORD);
      await page.getByRole('button', { name: 'Review estimate' }).click();
      const preview = page.getByTestId('content-brief-preview');
      await expect(preview).toBeVisible();
      await expect(preview).toContainText('1 content-brief unit');
      await expect(preview).toContainText('metered SERP fetch');
      await expect(preview).toContainText('Up to 10 public result pages');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(preview).toBeHidden();
      expect(usedBriefs(agency.id)).toBe(0);
    });

    await test.step('the confirmed fake-provider run persists cited corpus evidence', async () => {
      await page.getByRole('button', { name: 'Review estimate' }).click();
      await expect(page.getByTestId('content-brief-preview')).toBeVisible();
      await page.getByRole('button', { name: 'Create brief' }).click();
      await expect(page).toHaveURL(/brief=[0-9a-f]{24}/u);
      fullBriefId = new URL(page.url()).searchParams.get('brief') ?? '';
      expect(fullBriefId).toMatch(/^[0-9a-f]{24}$/u);

      const detail = await waitForBrief(page, agencySiteId, fullBriefId);
      expect(['completed', 'completed_partial']).toContain(detail.status);
      expect(detail.documents.length).toBeGreaterThan(0);
      expect(detail.outline.length).toBeGreaterThan(0);
      const storedIds = new Set(detail.documents.map((document) => document.id));
      for (const node of detail.outline) {
        expect(node.citations.length).toBeGreaterThan(0);
        expect(node.citations.every((citation) => storedIds.has(citation))).toBe(true);
      }
      expect(usedBriefs(agency.id)).toBe(1);

      await page.reload();
      await expect(page.getByTestId('content-brief-detail')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('content-brief-corpus')).toContainText(
        'Top-10 average from pages scraped on',
      );
      await expect(page.getByTestId('content-brief-evidence')).toContainText('Owned example 1');
      await expect(page.locator('[data-testid^="brief-citation-doc-"]').first()).toBeVisible();
      await expect(page.getByText('How do I win a featured snippet?').first()).toBeVisible();
    });

    await test.step('editor re-score adds immutable history without a new unit', async () => {
      const before = usedBriefs(agency.id);
      await page.getByRole('link', { name: 'Open editor' }).click();
      await expect(page.getByTestId('content-brief-editor')).toBeVisible();
      await page
        .locator('#content-brief-draft')
        .fill(
          '# Evidence-led brief\n\nA deterministic draft about a featured snippet.\n\n## Questions\n\nHow should the answer cite evidence?',
        );
      await page.getByRole('button', { name: 'Score this version' }).click();
      const version = page.getByTestId('content-brief-score-1');
      await expect(version).toBeVisible({ timeout: 60_000 });
      await expect(version).toContainText('Deterministic guidance');
      await expect(version).toContainText('AI guidance');
      expect(usedBriefs(agency.id)).toBe(before);

      const stored = await page.request.get(
        `/api/sites/${agencySiteId}/content-briefs/${fullBriefId}`,
      );
      const detail = (await stored.json()) as BriefDetail;
      expect(detail.scoreHistory.map((entry) => entry.version)).toEqual([1]);
    });

    await test.step('stored brief reopening stays free', async () => {
      const before = usedBriefs(agency.id);
      await page.getByRole('link', { name: 'Back to briefs' }).click();
      await page.getByRole('button', { name: 'Back to briefs' }).click();
      await expect(page.getByTestId(`content-brief-row-${fullBriefId}`)).toBeVisible();
      await page
        .getByTestId(`content-brief-row-${fullBriefId}`)
        .getByRole('button', { name: 'Open' })
        .click();
      await expect(page.getByTestId('content-brief-detail')).toBeVisible();
      expect(usedBriefs(agency.id)).toBe(before);
    });

    await test.step('Arabic logical layout passes axe in light and dark', async () => {
      await setLocale(page, 'ar');
      await expect(page.getByText('إحصاءات مجموعة أفضل عشر نتائج')).toBeVisible();
      await setTheme(page, 'light');
      await scan(page, 'content-brief-detail-ar(light)');
      await setTheme(page, 'dark');
      await scan(page, 'content-brief-detail-ar(dark)');
      await setTheme(page, 'light');
      await setLocale(page, 'en');
    });

    await test.step('a real low-ceiling run names the halted stage', async () => {
      recreateContentBriefServices(true, 1_000);
      await awaitServicesHealthy(page);
      const created = await createBrief(page, agencySiteId, HALT_KEYWORD);
      expect(created.response.status()).toBe(202);
      const detail = await waitForBrief(page, agencySiteId, created.body!.briefId);
      expect(detail.status).toBe('completed_partial');
      expect(detail.halt).toEqual({ stage: 'serp_fetch', reason: 'cost_ceiling' });

      await page.goto(
        `/sites/${agencySiteId}?tab=content&view=briefs&brief=${created.body!.briefId}`,
      );
      await expect(page.getByTestId('content-brief-halt-serp_fetch')).toContainText('SERP fetch');
      await expect(page.getByTestId('content-brief-halt-serp_fetch')).toContainText(
        'rolling cost ceiling',
      );
    });

    await test.step('the rollout flag pauses new work while stored list/detail/editor stay live', async () => {
      recreateContentBriefServices(false);
      await awaitServicesHealthy(page);

      const listResponse = await page.request.get(
        `/api/sites/${agencySiteId}/content-briefs`,
      );
      expect(listResponse.status()).toBe(200);
      const listBody = (await listResponse.json()) as {
        creationEnabled?: boolean;
        items?: Array<{ id: string }>;
      };
      expect(listBody.creationEnabled).toBe(false);
      expect(listBody.items?.map((item) => item.id)).toContain(fullBriefId);

      const detailResponse = await page.request.get(
        `/api/sites/${agencySiteId}/content-briefs/${fullBriefId}`,
      );
      expect(detailResponse.status()).toBe(200);
      const storedDetail = (await detailResponse.json()) as BriefDetail;
      expect(storedDetail.creationEnabled).toBe(false);
      expect(storedDetail.id).toBe(fullBriefId);

      await page.goto(`/sites/${agencySiteId}?tab=content&view=briefs`);
      await expect(page.getByTestId('brief-state-disabled')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId(`content-brief-row-${fullBriefId}`)).toBeVisible();
      await expect(page.locator('#content-brief-keyword')).toBeDisabled();

      await page.goto(
        `/sites/${agencySiteId}?tab=content&view=briefs&brief=${fullBriefId}`,
      );
      await expect(page.getByTestId('content-brief-detail')).toBeVisible();
      await expect(page.getByTestId('brief-state-disabled')).toBeVisible();

      await page.getByRole('link', { name: 'Open editor' }).click();
      await expect(page.getByTestId('content-brief-editor')).toBeVisible();
      await expect(page.getByTestId('brief-state-disabled')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Score this version' })).toBeDisabled();

      const refused = await csrfPost(page, `/api/sites/${agencySiteId}/content-briefs/preview`, {
        keyword: FULL_KEYWORD,
        locale: 'en',
      });
      expect(refused.status()).toBe(503);
      expect((await createBrief(page, agencySiteId, FULL_KEYWORD)).response.status()).toBe(503);
      const rescore = await csrfPost(
        page,
        `/api/sites/${agencySiteId}/content-briefs/${fullBriefId}/drafts`,
        { draft: '# Paused rescore', locale: 'en' },
      );
      expect(rescore.status()).toBe(503);
    });
  } finally {
    recreateContentBriefServices(
      inheritedRuntime.CONTENT_BRIEFS_ENABLED === 'true',
      Number(inheritedRuntime.CONTENT_BRIEF_COST_CEILING_MICROS),
    );
    await awaitServicesHealthy(page);
    expectContentBriefRuntimeParity(inheritedRuntime);
  }
});
