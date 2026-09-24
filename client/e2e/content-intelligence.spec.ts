import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import type { UsageResponse } from '../src/features/billing';
import type { ContentAnalysis } from '../src/features/content-intelligence';
import { freshAccount, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string; url: string };
}

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as SessionResponse;
  expect(body.user?.id).toBeTruthy();
  return body.user!.id!;
}

function setTier(id: string, tier: 'none' | 'starter'): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'accountId', :'tier', 'active')
       ON CONFLICT (account_id)
       DO UPDATE SET tier = :'tier', status = 'active', updated_at = now();`,
    { variables: { accountId: id, tier } },
  );
}

function setContentUsage(id: string, used: number, limit: number): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
               'content_analyses', :'used'::bigint, :'limit'::bigint)
       ON CONFLICT (account_id, period, metric)
       DO UPDATE SET used = :'used'::bigint, "limit" = :'limit'::bigint;`,
    {
      variables: {
        accountId: id,
        used: String(used),
        limit: String(limit),
      },
    },
  );
}

async function createSite(request: APIRequestContext): Promise<{ id: string; url: string }> {
  const response = await request.post('/api/sites', {
    data: { url: 'https://example.com', label: 'Content Intelligence Journey' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as SiteResponse).site;
}

async function contentUsage(request: APIRequestContext): Promise<{ used: number; cap: number }> {
  const response = await request.get('/api/billing/usage');
  expect(response.status()).toBe(200);
  const usage = (await response.json()) as UsageResponse;
  expect(usage.contentAnalyses?.cap).toBeGreaterThan(0);
  return {
    used: usage.contentAnalyses?.used ?? 0,
    cap: usage.contentAnalyses!.cap!,
  };
}

async function waitForCompleted(
  request: APIRequestContext,
  siteId: string,
  analysisId: string,
): Promise<void> {
  await expect.poll(
    async () => {
      const response = await request.get(
        `/api/content-analyses/${encodeURIComponent(analysisId)}?siteId=${encodeURIComponent(siteId)}`,
      );
      if (response.status() !== 200) return `http-${response.status()}`;
      return ((await response.json()) as ContentAnalysis).status;
    },
    { timeout: 120_000, intervals: [1_000, 2_000, 4_000] },
  ).toBe('completed');
}

function partialAnalysis(
  siteId: string,
  analysisId: string,
  warningCode: 'brief_failed' | 'competitors_partial',
): ContentAnalysis {
  const malicious = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  return {
    analysisId,
    siteId,
    ownedUrl: 'https://example.com/guide',
    keyword: 'content audit',
    locale: 'en',
    status: 'partial',
    stages: [],
    warnings: [{ code: warningCode, messageKey: `contentIntelligence.${warningCode}` }],
    scorecard: null,
    schemaVersion: '2026-07-15.1',
    scorecardV2: {
      version: '2026-07-15.1',
      total: 64,
      sections: [
        { key: 'readability', score: 72, weight: 40, confidence: 0.9, reason: malicious },
        { key: 'coverage', score: 58, weight: 35, confidence: 0.7, reason: malicious },
        { key: 'structure', score: 60, weight: 25, confidence: 0.8, reason: malicious },
      ],
    },
    owned: { url: 'https://example.com/guide', contentHash: 'safe-hash' },
    recommendations: [],
    recommendationStates: [],
    brief: warningCode === 'brief_failed'
      ? null
      : {
          versionId: 'brief-v1',
          sections: [{ heading: malicious, body: malicious }],
          citations: [],
        },
    draft: {
      versionId: 'draft-v1',
      markdown: malicious,
      wordCount: 4,
      citations: [],
    },
    draftVersions: [],
    citations: [
      { sourceId: 'unsafe', url: 'javascript:alert(1)', title: 'Unsafe source' },
      { sourceId: 'comparison', url: 'https://comparison.example/article', title: 'Public comparison' },
    ],
    error: null,
    reservation: { key: 'e2e-partial', reservedUnits: 1, refundedAt: null, refundReason: null },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: '2026-07-15T10:00:00.000Z',
    startedAt: '2026-07-15T10:00:01.000Z',
    completedAt: '2026-07-15T10:00:02.000Z',
    cancelledAt: null,
  };
}

async function mockPartialDetail(
  page: Page,
  siteId: string,
  analysisId: string,
  warningCode: 'brief_failed' | 'competitors_partial',
): Promise<void> {
  await page.route(`**/api/content-analyses/${analysisId}*`, async (route) => {
    const responseLocale = route.request().headers()['x-lang'] ?? 'en';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Content-Language': responseLocale,
        Vary: 'Accept-Language, x-lang',
      },
      body: JSON.stringify(partialAnalysis(siteId, analysisId, warningCode)),
    });
  });
}

test('Content Intelligence workspace — paid run, lifecycle, gates, partial safety, responsive and RTL axe', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);

  const account = freshAccount('content-intelligence');
  await signUp(page, account);
  const id = await accountId(page.request);
  setTier(id, 'starter');
  const site = await createSite(page.request);

  await test.step('Starter form and list expose server-authoritative unit preview', async () => {
    await page.goto(`/sites/${site.id}?tab=content&view=analyses`);
    await expect(page.getByTestId('content-new-analysis-form')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('content-analysis-list')).toBeVisible();
    await expect(page.getByTestId('content-form-preview')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('content-form-balance')).toBeVisible();
    await scan(page, 'content form and list, light desktop');
    await page.screenshot({ path: testInfo.outputPath('content-form-list-light-ltr.png'), fullPage: true });
  });

  let analysisId = '';
  await test.step('keyboard-only confirmation runs the deterministic fake-provider pipeline', async () => {
    const url = page.getByTestId('content-form-url');
    await url.focus();
    await page.keyboard.type(site.url);
    const keyword = page.getByTestId('content-form-keyword');
    await keyword.focus();
    await page.keyboard.type('content audit');
    await page.getByTestId('content-form-consent').focus();
    await page.keyboard.press('Space');
    await page.getByTestId('content-form-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]analysis=/, { timeout: 30_000 });
    analysisId = new URL(page.url()).searchParams.get('analysis') ?? '';
    expect(analysisId).not.toBe('');
    await waitForCompleted(page.request, site.id, analysisId);
    await page.reload();
    await expect(page.getByTestId('content-detail-scorecard')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('content-detail-draft')).toBeVisible();
    await scan(page, 'content detail, light desktop');
  });

  await test.step('draft stays editable, blocks accidental exit, saves a version, and exports inert markdown', async () => {
    const draft = page.getByTestId('content-draft-textarea');
    await draft.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nA keyboard-only edit.');

    await page.getByTestId('content-detail-back').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('content-draft-save').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('content-draft-save')).toBeDisabled();

    const draftCard = page.getByTestId('content-detail-draft');
    const exportTrigger = draftCard.getByRole('button', { name: 'Export or share' });
    await exportTrigger.focus();
    await page.keyboard.press('Enter');
    const markdown = page.getByRole('menuitem', { name: 'Markdown' });
    await expect(markdown).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await markdown.focus();
    await page.keyboard.press('Enter');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^rankmefast-content-analysis-\d{4}-\d{2}-\d{2}\.md$/u,
    );
    const path = testInfo.outputPath('content-analysis-export.md');
    await download.saveAs(path);
    const exported = await readFile(path, 'utf8');
    expect(exported).toContain('A keyboard-only edit.');
    expect(exported).not.toContain('<html');

    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await scan(page, 'content detail, dark desktop');
    await page.screenshot({ path: testInfo.outputPath('content-detail-dark-ltr.png'), fullPage: true });
  });

  await test.step('narrow layout uses equivalent cards', async () => {
    await page.getByTestId('content-detail-back').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('content-analysis-list')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('content-analysis-cards')).toBeVisible();
    await scan(page, 'content list and form, narrow');
    await page.screenshot({ path: testInfo.outputPath('content-list-mobile-ltr.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await test.step('Free and exhausted paid states are honest catalog-backed gates', async () => {
    setTier(id, 'none');
    await page.reload();
    await expect(page.getByTestId('content-locked-tier')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('content-new-analysis-form')).toHaveCount(0);

    setTier(id, 'starter');
    const usage = await contentUsage(page.request);
    setContentUsage(id, usage.cap, usage.cap);
    await page.reload();
    await expect(page.getByTestId('content-form-exhausted')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('content-form-submit')).toBeDisabled();
  });

  await test.step('partial AI and competitor data preserve the scorecard and keep hostile output inert', async () => {
    setContentUsage(id, 0, (await contentUsage(page.request)).cap);
    const partialAiId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    await mockPartialDetail(page, site.id, partialAiId, 'brief_failed');
    await page.goto(`/sites/${site.id}?tab=content&view=analyses&analysis=${partialAiId}`);
    await expect(page.getByTestId('content-detail-partial')).toBeVisible();
    await expect(page.getByTestId('content-detail-scorecard')).toBeVisible();
    await expect(page.locator('script').filter({ hasText: 'alert(2)' })).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.getByTestId('content-draft-textarea')).toHaveValue(/<img src=x onerror=/);
    await scan(page, 'partial AI detail');

    const partialCompetitorId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    await mockPartialDetail(page, site.id, partialCompetitorId, 'competitors_partial');
    await page.goto(
      `/sites/${site.id}?tab=content&view=analyses&analysis=${partialCompetitorId}`,
    );
    await expect(page.getByTestId('content-detail-partial')).toBeVisible({ timeout: 30_000 });
    const preferenceSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === '/api/users/preferences/language',
    );
    await page.locator('#language-switcher').selectOption('ar');
    expect((await preferenceSaved).status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('content-detail-partial')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('content-detail-scorecard')).toBeVisible();
    const publicSource = page.getByRole('link', { name: 'Public comparison' });
    await expect(publicSource).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    await scan(page, 'partial competitor detail, Arabic RTL');
    await page.screenshot({ path: testInfo.outputPath('content-partial-light-rtl.png'), fullPage: true });
  });
});
