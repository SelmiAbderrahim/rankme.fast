/**
 * White-label reports, schedules, and portal.
 *
 * The journey keeps the production seams intact: a real fake-provider audit,
 * stored engine-tagged rank/GSC rows, the real client-reports BullMQ worker,
 * deterministic no-network email transport, server-normalized logo upload,
 * unauthenticated SSR portal reads, structural caps, and the real flag-off
 * boundary. The finally block restores the gate's inherited feature flag and
 * mail transport for BOTH api and worker, then verifies their runtime parity
 * before the projects that follow.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import {
  readComposeServiceEnvironment,
  recreateComposeServices,
  runComposeApiScript,
  runComposePsql,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const COMPANY_NAME = 'North <img src=x onerror=alert(1)> Studio';
const SITE_LABEL = 'Client <script>window.__clientReportsInjected=1</script>';
const PORTAL_LABEL = 'Quarterly <script>portal</script>';
const RECIPIENT = 'client-report-recipient@example.test';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

interface SessionBody {
  user?: { id?: string };
}

interface SiteBody {
  site: { id: string };
}

interface ScheduleDto {
  id: string;
  name: string;
}

interface PortalDto {
  id: string;
  url: string;
}

interface OverviewBody {
  enabled: boolean;
  schedules: ScheduleDto[];
  portals: Array<{ id: string; clientLabel: string; revokedAt: string | null }>;
  scheduleCap: { used: number; limit: number };
  portalCap: { used: number; limit: number };
}

interface DeliveriesBody {
  deliveries: Array<{
    recipient: string;
    status: 'sent' | 'failed' | 'suppressed';
    snapshotDate: string | null;
  }>;
}

const CLIENT_REPORTS_RUNTIME_KEYS = [
  'CLIENT_REPORTS_ENABLED',
  'EMAIL_TRANSPORT',
  'CLIENT_URL',
  'SERVER_URL',
  'PROVIDER_AI',
  'PROVIDER_AI_VISIBILITY',
  'PROVIDER_AUDIT',
  'PROVIDER_BACKLINK',
  'PROVIDER_COMPETITOR',
  'PROVIDER_CONTENT_ANALYSIS',
  'PROVIDER_CONTENT_SOURCE',
  'PROVIDER_GA4',
  'PROVIDER_GSC',
  'PROVIDER_KEYWORD',
  'PROVIDER_LOCAL_LISTINGS',
  'PROVIDER_PAGESPEED',
  'PROVIDER_RANK',
  'PROVIDER_REVIEWS',
  'PROVIDER_SUMMARY',
  'PROVIDER_TRENDS',
] as const;

function expectedClientReportsRuntimeConfig(): Record<string, string | null> {
  const rawEnabled = process.env.CLIENT_REPORTS_ENABLED;
  if (rawEnabled !== 'true' && rawEnabled !== 'false') {
    throw new Error('The client-reports Playwright project requires CLIENT_REPORTS_ENABLED');
  }
  const rawTransport = process.env.EMAIL_TRANSPORT ?? 'resend';
  if (rawTransport !== 'resend' && rawTransport !== 'fake') {
    throw new Error(`Unsupported EMAIL_TRANSPORT for client-reports E2E: ${rawTransport}`);
  }
  const expected = Object.fromEntries(
    CLIENT_REPORTS_RUNTIME_KEYS.map((name) => [name, process.env[name] ?? null]),
  );
  expected.CLIENT_REPORTS_ENABLED = rawEnabled;
  expected.EMAIL_TRANSPORT = rawTransport;
  for (const name of CLIENT_REPORTS_RUNTIME_KEYS) {
    if (expected[name] === null) {
      throw new Error(`The client-reports Playwright project requires ${name}`);
    }
  }
  return expected;
}

function expectClientReportsRuntimeParity(expected: Record<string, string | null>): void {
  expect(readComposeServiceEnvironment('api', CLIENT_REPORTS_RUNTIME_KEYS)).toEqual(expected);
  expect(readComposeServiceEnvironment('worker', CLIENT_REPORTS_RUNTIME_KEYS)).toEqual(expected);
}

function recreateClientReports(
  enabled: boolean,
  emailTransport: 'resend' | 'fake',
  clientUrl?: string,
): void {
  const overrides: Record<string, string> = {
    CLIENT_REPORTS_ENABLED: String(enabled),
    EMAIL_TRANSPORT: emailTransport,
  };
  if (clientUrl !== undefined) {
    overrides.CLIENT_URL = clientUrl;
    const apiUrl = process.env.PLAYWRIGHT_API_BASE_URL;
    if (apiUrl === undefined) {
      throw new Error('The client-reports Playwright project requires an API base URL');
    }
    overrides.SERVER_URL = new URL(apiUrl).origin;
    Object.assign(overrides, {
      PROVIDER_AI: 'fake',
      PROVIDER_AI_VISIBILITY: 'fake',
      PROVIDER_AUDIT: 'fake',
      PROVIDER_BACKLINK: 'fake',
      PROVIDER_COMPETITOR: 'fake',
      PROVIDER_CONTENT_ANALYSIS: 'fake',
      PROVIDER_CONTENT_SOURCE: 'fake',
      PROVIDER_GA4: 'fake',
      PROVIDER_GSC: 'fake',
      PROVIDER_KEYWORD: 'fake',
      PROVIDER_LOCAL_LISTINGS: 'fake',
      PROVIDER_PAGESPEED: 'fake',
      PROVIDER_RANK: 'fake',
      PROVIDER_REVIEWS: 'fake',
      PROVIDER_SUMMARY: 'fake',
      PROVIDER_TRENDS: 'fake',
    });
  }

  recreateComposeServices(['api', 'worker'], overrides);
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (
            await page.request.get('/api/health', {
              failOnStatusCode: false,
              timeout: 10_000,
            })
          ).status();
        } catch {
          return 0;
        }
      },
      { timeout: 120_000, intervals: [1_000, 2_000] },
    )
    .toBe(200);
}

async function awaitAuthenticatedSession(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get('/api/auth/get-session', {
            failOnStatusCode: false,
            timeout: 10_000,
          });
          if (response.status() !== 200) return 'http-error';
          const body = (await response.json()) as SessionBody;
          return body.user?.id ? 'ready' : 'missing';
        } catch {
          return 'unavailable';
        }
      },
      { timeout: 120_000, intervals: [1_000, 2_000] },
    )
    .toBe('ready');
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

async function createSite(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sites', {
    data: {
      url: 'https://client-report.example',
      displayName: SITE_LABEL,
    },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as SiteBody).site.id;
}

async function runAuditToCompletion(request: APIRequestContext, siteId: string): Promise<void> {
  const started = await request.post(`/api/sites/${siteId}/audits`, {
    data: {},
    headers: await csrfHeaders(request),
  });
  expect([200, 201, 202]).toContain(started.status());
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/sites/${siteId}/audits?limit=1`);
        if (response.status() !== 200) return 'http-error';
        const body = (await response.json()) as { runs: Array<{ status: string }> };
        return body.runs[0]?.status ?? 'missing';
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe('succeeded');
}

function seedDatedRankAndGsc(account: string, site: string): void {
  runComposeApiScript(
    `
    const mongooseModule = await import('mongoose');
    const mongoose = mongooseModule.default;
    await mongoose.connect(process.env.MONGODB_URI);
    const database = mongoose.connection.db;
    if (!database) throw new Error('Mongo database unavailable');
    const result = await database.collection('sites').updateOne(
      {
        _id: new mongoose.Types.ObjectId(process.env.SEED_SITE_ID),
        accountId: new mongoose.Types.ObjectId(process.env.SEED_ACCOUNT_ID),
      },
      {
        $set: {
          gscPropertyUrl: 'sc-domain:client-report.example',
          gscBindingGenerationId: 'legacy',
        },
      },
    );
    if (result.matchedCount !== 1) throw new Error('Client-report GSC site seed missed');
    await mongoose.disconnect();
    `,
    { SEED_ACCOUNT_ID: account, SEED_SITE_ID: site },
  );
  runComposePsql(
    `WITH inserted AS (
       INSERT INTO keywords
         (account_id, site_id, phrase, location_code, language_code, device, engine)
       VALUES
         (:'account_id', :'site_id', 'rank me safely', 2840, 'en', 'desktop', 'bing')
       RETURNING id
     )
     INSERT INTO rankings
       (keyword_id, position, rank_absolute, found_url, checked_at, source, engine)
     SELECT id, 6, 7, 'https://client-report.example/result',
            '2026-08-01T12:00:00Z', 'fresh', 'bing'
     FROM inserted;

     INSERT INTO gsc_search_analytics
       (account_id, site_id, binding_generation_id, snapshot_date, dimension_set, window_days,
        dimension_key, clicks, impressions, ctr, position, fetched_at)
     VALUES
       (:'account_id', :'site_id', 'legacy', '2026-08-01', 'query', 28,
        'seo <script>query</script>', 25, 100, 0.25, 3.2,
        '2026-08-02T00:00:00Z'),
       (:'account_id', :'site_id', 'legacy', '2026-08-01', 'query', 28,
        'safe audit report', 10, 80, 0.125, 5.5,
        '2026-08-02T00:00:00Z');`,
    { variables: { account_id: account, site_id: site } },
  );
}

async function overview(request: APIRequestContext, siteId: string): Promise<OverviewBody> {
  const response = await request.get(`/api/client-reports/sites/${siteId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as OverviewBody;
}

/**
 * `clientReportJobSchema` requires `accountId` and `siteId`: the processor
 * takes the account + site work leases before it touches the run, so a payload
 * without them is rejected as malformed and the delivery never happens.
 */
function enqueueClientReport(
  scheduleId: string,
  accountId: string,
  siteId: string,
): void {
  runComposeApiScript(
    `
    const { Queue } = await import('bullmq');
    const queue = new Queue('client-reports', {
      connection: { url: process.env.REDIS_URL },
    });
    const scheduleId = process.env.SEED_SCHEDULE_ID;
    const runKey = process.env.SEED_RUN_KEY;
    await queue.add(
      'client-report',
      {
        accountId: process.env.SEED_ACCOUNT_ID,
        siteId: process.env.SEED_SITE_ID,
        scheduleId,
        runKey,
        scheduledFor: new Date().toISOString(),
      },
      { jobId: 'client-report-' + scheduleId + '-' + runKey },
    );
    await queue.close();
    `,
    {
      SEED_SCHEDULE_ID: scheduleId,
      SEED_ACCOUNT_ID: accountId,
      SEED_SITE_ID: siteId,
      SEED_RUN_KEY: `e2e-${randomUUID()}`,
    },
  );
}

async function waitForSentDelivery(request: APIRequestContext, siteId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/client-reports/sites/${siteId}/deliveries?limit=20`,
        );
        if (response.status() !== 200) return 'http-error';
        const body = (await response.json()) as DeliveriesBody;
        const delivery = body.deliveries.find((row) => row.recipient === RECIPIENT);
        if (!delivery) return 'missing';
        if (!delivery.snapshotDate) return 'undated';
        return delivery.status;
      },
      { timeout: 120_000, intervals: [1_000, 2_000] },
    )
    .toBe('sent');
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
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

async function assertDatedPortalFigures(page: Page): Promise<void> {
  const figures = page.locator('[data-snapshot-date]');
  expect(await figures.count()).toBeGreaterThanOrEqual(10);
  const dates = await figures.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-snapshot-date')),
  );
  expect(dates.every((date) => typeof date === 'string' && date.length >= 10)).toBe(true);
}

async function createPortalViaApi(
  request: APIRequestContext,
  siteId: string,
  clientLabel: string,
): Promise<PortalDto> {
  const response = await request.post(`/api/client-reports/sites/${siteId}/portals`, {
    data: {
      clientLabel,
      locale: 'en',
      sections: { audit: true, ranks: true, gsc: true },
      expiresInDays: 90,
    },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as PortalDto;
}

function seedScheduleCap(account: string, site: string): void {
  runComposePsql(
    `INSERT INTO scheduled_reports
       (account_id, site_id, name, frequency, weekday_utc, monthday_utc,
        hour_utc, minute_utc, locale, recipients, sections, enabled,
        next_run_at, last_run_at, created_at, updated_at)
     SELECT
       :'account_id', :'site_id', 'Cap fixture ' || n, 'weekly', 1, null,
       9, n, 'en', '["cap@example.test"]'::jsonb,
       '{"audit":true,"ranks":true,"gsc":true}'::jsonb, false,
       null, null, now(), now()
     FROM generate_series(1, 19) AS n;`,
    { variables: { account_id: account, site_id: site } },
  );
}

function seedPortalCap(account: string, site: string): void {
  runComposeApiScript(
    `
    const crypto = await import('node:crypto');
    const mongooseModule = await import('mongoose');
    const mongoose = mongooseModule.default;
    await mongoose.connect(process.env.MONGODB_URI);
    const database = mongoose.connection.db;
    if (!database) throw new Error('Mongo database unavailable');
    const accountId = new mongoose.Types.ObjectId(process.env.SEED_ACCOUNT_ID);
    const siteId = new mongoose.Types.ObjectId(process.env.SEED_SITE_ID);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000 * 90);
    const rows = Array.from({ length: 24 }, (_, index) => ({
      accountId,
      siteId,
      clientLabel: 'Cap portal ' + (index + 1),
      tokenHash: crypto.createHash('sha256')
        .update('client-report-cap-' + process.env.SEED_ACCOUNT_ID + '-' + index)
        .digest('hex'),
      locale: 'en',
      sections: { audit: true, ranks: true, gsc: true },
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
    await database.collection('clientportaltokens').insertMany(rows);
    await mongoose.disconnect();
    `,
    { SEED_ACCOUNT_ID: account, SEED_SITE_ID: site },
  );
}

async function assertFlagOffCreateRefusals(
  request: APIRequestContext,
  siteId: string,
): Promise<void> {
  const schedule = await request.post(`/api/client-reports/sites/${siteId}/schedules`, {
    data: {
      name: 'Disabled schedule',
      frequency: 'weekly',
      weekdayUtc: 1,
      monthdayUtc: null,
      hourUtc: 9,
      locale: 'en',
      recipients: ['disabled@example.test'],
      sections: { audit: true, ranks: true, gsc: true },
      enabled: true,
    },
    headers: await csrfHeaders(request),
    failOnStatusCode: false,
  });
  const portal = await request.post(`/api/client-reports/sites/${siteId}/portals`, {
    data: {
      clientLabel: 'Disabled portal',
      locale: 'en',
      sections: { audit: true, ranks: true, gsc: true },
      expiresInDays: 90,
    },
    headers: await csrfHeaders(request),
    failOnStatusCode: false,
  });
  expect(schedule.status()).toBe(404);
  expect(portal.status()).toBe(404);
}

async function openPortal(browser: Browser, url: string) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  const page = await context.newPage();
  return { context, denials, page, response: await page.goto(url) };
}

test('client reports: branded PDF, worker delivery, portal, caps, flag, RTL, and axe', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  // This single zero-retry journey deliberately performs two composed service
  // recreations plus a real audit, PDF, delivery, portal, and axe checks.
  test.setTimeout(1_800_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  if (baseURL === undefined) {
    throw new Error('The client-reports Playwright project requires a baseURL');
  }
  const inheritedRuntimeConfig = expectedClientReportsRuntimeConfig();
  expectClientReportsRuntimeParity(inheritedRuntimeConfig);
  const browserOrigin = new URL(baseURL).origin;

  try {
    recreateClientReports(true, 'fake', browserOrigin);
    await awaitApiHealthy(page);

    const credentials = freshAccount('client-reports');
    await signUp(page, credentials);
    const account = await accountId(page.request);
    bumpToAgency(account);
    const siteId = await createSite(page.request);
    await runAuditToCompletion(page.request, siteId);
    seedDatedRankAndGsc(account, siteId);

    await test.step('logo upload is previewed, normalized, and stored with hostile text inert', async () => {
      await page.goto('/profile?tab=branding');
      await expect(page.locator('#branding-company-name')).toBeVisible({ timeout: 30_000 });
      await page.locator('#branding-company-name').fill(COMPANY_NAME);
      await page.locator('#branding-accent-color').fill('#3366ff');
      await page.locator('#branding-logo').setInputFiles({
        name: 'agency-logo.png',
        mimeType: 'image/png',
        buffer: PNG_1X1,
      });
      await expect(page.getByAltText('Company logo preview')).toBeVisible();
      await page.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByRole('status')).toContainText('Branding saved.');
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    });

    await test.step('composer downloads a branded deterministic PDF with every stored section', async () => {
      await page.goto(`/sites/${siteId}?tab=client-reports`);
      const panel = page.getByTestId('client-reports-panel');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#report-composer-section-audit')).toBeChecked();
      await expect(page.locator('#report-composer-section-ranks')).toBeChecked();
      await expect(page.locator('#report-composer-section-gsc')).toBeChecked();

      await panel.getByRole('button', { name: 'Export or share' }).click();
      const pdfFormat = page.getByRole('menuitem', { name: 'PDF' });
      await expect(pdfFormat).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await pdfFormat.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(
        /^rankmefast-client-report-\d{4}-\d{2}-\d{2}\.pdf$/u,
      );
      expect(await download.failure()).toBeNull();
      const path = testInfo.outputPath('client-report-export.pdf');
      await download.saveAs(path);
      expect(readFileSync(path).subarray(0, 5)).toEqual(Buffer.from('%PDF-'));

      await page.getByRole('button', { name: 'Create schedule' }).focus();
      await expect(page.getByRole('button', { name: 'Create schedule' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await scanBothThemes(page, 'client reports dashboard');
    });

    await test.step('a schedule delivers through the real worker and deterministic fake transport', async () => {
      await page.getByRole('button', { name: 'Create schedule' }).click();
      await page.locator('#report-schedule-name').fill('Weekly client report');
      await page.locator('#report-schedule-recipients').fill(RECIPIENT);
      await page.getByRole('button', { name: 'Save schedule' }).click();
      await expect(page.getByText('Weekly client report')).toBeVisible();

      const state = await overview(page.request, siteId);
      const schedule = state.schedules.find((row) => row.name === 'Weekly client report');
      expect(schedule).toBeTruthy();
      enqueueClientReport((schedule as ScheduleDto).id, account, siteId);
      await waitForSentDelivery(page.request, siteId);

      await page.reload();
      await expect(page.getByTestId('client-reports-panel')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(RECIPIENT).last()).toBeVisible();
      await expect(page.getByText('Sent')).toBeVisible();
    });

    let portalUrl = '';
    await test.step('an Arabic portal stays pinned after the owner preference changes', async () => {
      await page.getByRole('button', { name: 'Create portal link' }).click();
      await page.locator('#portal-client-label').fill(PORTAL_LABEL);
      await page.locator('#portal-locale').click();
      await page.getByRole('option', { name: 'العربية' }).click();
      await page.getByRole('button', { name: 'Create link' }).click();
      const showOnce = page.getByLabel('Copy this link now. It will not be shown again.');
      await expect(showOnce).toBeVisible();
      portalUrl = await showOnce.inputValue();
      expect(portalUrl).toMatch(/\/portal\/[A-Za-z0-9_-]{32,128}$/);

      const opened = await openPortal(browser, portalUrl);
      try {
        expect(opened.response?.status()).toBe(200);
        expect(opened.response?.headers()['x-robots-tag']).toContain('noindex');
        await expect(opened.page.locator('meta[name="robots"]')).toHaveAttribute(
          'content',
          'noindex, nofollow',
        );
        await expect(opened.page.getByText(COMPANY_NAME)).toBeVisible();
        await expect(opened.page.getByRole('heading', { name: SITE_LABEL })).toBeVisible();
        await expect(opened.page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(opened.page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(
          opened.page.getByRole('heading', { name: 'تدقيق تحسين محركات البحث' }),
        ).toBeVisible();
        await expect(opened.page.getByRole('heading', { name: 'ملخص الترتيب' })).toBeVisible();
        await expect(
          opened.page.getByRole('heading', { name: 'ملخص Search Console' }),
        ).toBeVisible();
        await expect(opened.page.getByText('bing', { exact: true })).toBeVisible();
        await expect(opened.page.getByText('seo <script>query</script>')).toBeVisible();
        await expect(opened.page.locator('img[src="x"]')).toHaveCount(0);
        expect(
          await opened.page.evaluate(
            () => (window as Window & { __clientReportsInjected?: number }).__clientReportsInjected,
          ),
        ).toBeUndefined();
        await assertDatedPortalFigures(opened.page);
        await scanBothThemes(opened.page, 'client portal Arabic RTL');

        await opened.page.locator('#portal-language').click();
        await opened.page.getByRole('option', { name: 'English' }).click();
        await expect(opened.page).toHaveURL(/\/portal\//);
        await expect(opened.page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(opened.page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(
          opened.page.getByRole('heading', { name: 'تدقيق تحسين محركات البحث' }),
        ).toBeVisible();
        await assertDatedPortalFigures(opened.page);
        await scanBothThemes(opened.page, 'client portal pinned Arabic after English request');
        expect(opened.denials.urls, 'anonymous portal made no external request').toEqual([]);
      } finally {
        await opened.context.close();
      }
      await page.keyboard.press('Escape');

      const changed = await page.request.patch('/api/users/preferences/language', {
        data: { language: 'de' },
        headers: await csrfHeaders(page.request),
      });
      expect(changed.status()).toBe(200);

      const pinnedAfterPreferenceChange = await openPortal(browser, portalUrl);
      try {
        expect(pinnedAfterPreferenceChange.response?.status()).toBe(200);
        await expect(pinnedAfterPreferenceChange.page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(pinnedAfterPreferenceChange.page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(
          pinnedAfterPreferenceChange.page.getByRole('heading', {
            name: 'تدقيق تحسين محركات البحث',
          }),
        ).toBeVisible();
      } finally {
        await pinnedAfterPreferenceChange.context.close();
      }
    });

    await test.step('revocation is immediate and the next public request is a hard 404', async () => {
      const row = page
        .getByRole('list', { name: 'Client portal links' })
        .getByRole('listitem')
        .filter({ hasText: PORTAL_LABEL });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Revoke' }).click();
      await page.getByRole('button', { name: 'Revoke link' }).click();
      await expect(row.getByText('Revoked')).toBeVisible();

      const revokedUrl = new URL(portalUrl);
      revokedUrl.pathname = `/de${revokedUrl.pathname.replace(/^\/ar/u, '')}`;
      const revoked = await openPortal(browser, revokedUrl.toString());
      try {
        expect(revoked.response?.status()).toBe(404);
        await expect(
          revoked.page.getByRole('heading', { name: 'Berichtslink nicht verfügbar' }),
        ).toBeVisible();
        await expect(revoked.page.locator('meta[name="robots"]')).toHaveAttribute(
          'content',
          'noindex, nofollow',
        );
        expect(revoked.denials.urls, 'revoked portal made no external request').toEqual([]);
      } finally {
        await revoked.context.close();
      }
    });

    const retainedPortal = await createPortalViaApi(
      page.request,
      siteId,
      'Stored link remains readable',
    );

    await test.step('both structural caps surface honestly and reject N+1 with localized 402s', async () => {
      seedScheduleCap(account, siteId);
      seedPortalCap(account, siteId);
      await page.reload();
      await expect(page.getByTestId('schedule-cap-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('portal-cap-state')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Zeitplan erstellen' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Portallink erstellen' })).toBeDisabled();

      const cappedSchedule = await page.request.post(
        `/api/client-reports/sites/${siteId}/schedules`,
        {
          data: {
            name: 'N plus one',
            frequency: 'weekly',
            weekdayUtc: 1,
            monthdayUtc: null,
            hourUtc: 9,
            locale: 'en',
            recipients: ['cap@example.test'],
            sections: { audit: true, ranks: true, gsc: true },
            enabled: true,
          },
          headers: await csrfHeaders(page.request),
          failOnStatusCode: false,
        },
      );
      const cappedPortal = await page.request.post(`/api/client-reports/sites/${siteId}/portals`, {
        data: {
          clientLabel: 'N plus one',
          locale: 'en',
          sections: { audit: true, ranks: true, gsc: true },
          expiresInDays: 90,
        },
        headers: await csrfHeaders(page.request),
        failOnStatusCode: false,
      });
      expect(cappedSchedule.status()).toBe(402);
      expect(JSON.stringify(await cappedSchedule.json())).toContain('20');
      expect(cappedPortal.status()).toBe(402);
      expect(JSON.stringify(await cappedPortal.json())).toContain('25');
    });

    await test.step('flag off blocks new writes while stored management and portal reads remain open', async () => {
      recreateClientReports(false, 'resend', browserOrigin);
      await awaitApiHealthy(page);
      await awaitAuthenticatedSession(page);

      await page.goto(`/sites/${siteId}?tab=client-reports`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('client-reports-disabled')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Weekly client report')).toBeVisible();
      const stored = await overview(page.request, siteId);
      expect(stored.enabled).toBe(false);
      expect(stored.scheduleCap).toEqual({ used: 20, limit: 20 });
      expect(stored.portalCap).toEqual({ used: 25, limit: 25 });
      await assertFlagOffCreateRefusals(page.request, siteId);

      const opened = await openPortal(browser, retainedPortal.url);
      try {
        expect(opened.response?.status()).toBe(200);
        await expect(opened.page.getByRole('heading', { name: SITE_LABEL })).toBeVisible();
        await assertDatedPortalFigures(opened.page);
        expect(opened.denials.urls, 'flag-off stored portal made no external request').toEqual([]);
      } finally {
        await opened.context.close();
      }
    });

    expect(denials.urls, 'dashboard made no external request').toEqual([]);
  } finally {
    recreateClientReports(
      inheritedRuntimeConfig.CLIENT_REPORTS_ENABLED === 'true',
      inheritedRuntimeConfig.EMAIL_TRANSPORT as 'resend' | 'fake',
    );
    await awaitApiHealthy(page);
    expectClientReportsRuntimeParity(inheritedRuntimeConfig);
  }
});
