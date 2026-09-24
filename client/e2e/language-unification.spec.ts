import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

interface Finding {
  bucket: 'fix-now' | 'watch' | 'passed';
  affectedUrls: string[];
  copy: { title: string; why: string; fix: string };
}

interface AuditReportBody {
  findings: Finding[];
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as { user?: { id?: string } }).user?.id;
  expect(id).toBeTruthy();
  return id!;
}

function grantPro(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'pro', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
    { variables: { account_id: id } },
  );
}

function sideEffectFingerprint(id: string): string {
  return runComposePsqlOutput(
    `SELECT concat(
       coalesce((SELECT sum(used) FROM usage_counters WHERE account_id = :'account_id'), 0),
       '|',
       (SELECT count(*) FROM vendor_responses WHERE account_id = :'account_id')
     );`,
    { variables: { account_id: id } },
  );
}

async function createSite(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sites', {
    data: {
      url: 'https://language-coherence.example',
      label: 'Language coherence',
    },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { site: { id: string } }).site.id;
}

async function runAudit(request: APIRequestContext, siteId: string): Promise<string> {
  const response = await request.post(`/api/sites/${siteId}/audits`, {
    data: {},
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(202);
  const runId = ((await response.json()) as { run: { id: string } }).run.id;
  await expect.poll(async () => {
    const latest = await request.get(`/api/sites/${siteId}/audits?limit=1`);
    if (latest.status() !== 200) return `http-${latest.status()}`;
    const body = (await latest.json()) as { runs: Array<{ id: string; status: string }> };
    return body.runs.find((run) => run.id === runId)?.status ?? 'missing';
  }, { timeout: 180_000, intervals: [1_000, 2_000, 4_000] }).toBe('succeeded');
  return runId;
}

async function localizedReport(
  request: APIRequestContext,
  runId: string,
  locale: 'en' | 'ar',
): Promise<AuditReportBody> {
  const response = await request.get(`/api/audits/${runId}/report`, {
    headers: { 'x-lang': locale },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-language']).toBe(locale);
  return (await response.json()) as AuditReportBody;
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, 'Arabic report axe violations').toEqual([]);
}

test('language switch is atomic across reads, errors, report copy, and downloads', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const account = freshAccount('language-unification');
  await signUp(page, account);
  const id = await accountId(page.request);
  grantPro(id);
  const siteId = await createSite(page.request);
  const runId = await runAudit(page.request, siteId);
  const englishReport = await localizedReport(page.request, runId, 'en');
  const arabicReport = await localizedReport(page.request, runId, 'ar');
  const arabicFinding = arabicReport.findings.find((finding) => finding.bucket !== 'passed');
  expect(arabicFinding, 'fake audit must expose a deterministic warning/fix').toBeTruthy();

  const beforeSwitch = sideEffectFingerprint(id);
  const spendingRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() !== 'GET' &&
      request.method() !== 'HEAD' &&
      path !== '/api/users/preferences/language'
    ) {
      spendingRequests.push(`${request.method()} ${path}`);
    }
  });

  let markEnglishStarted!: () => void;
  const englishStarted = new Promise<void>((resolve) => {
    markEnglishStarted = resolve;
  });
  let releaseEnglish!: () => void;
  const englishRelease = new Promise<void>((resolve) => {
    releaseEnglish = resolve;
  });
  let markEnglishSettled!: () => void;
  const englishSettled = new Promise<void>((resolve) => {
    markEnglishSettled = resolve;
  });

  await page.route(`**/api/audits/${runId}/report`, async (route) => {
    const locale = route.request().headers()['x-lang'];
    if (locale === 'en') {
      markEnglishStarted();
      await englishRelease;
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Content-Language': 'en' },
          body: JSON.stringify(englishReport),
        });
      } catch {
        // Chromium may discard the intercepted request after AbortController
        // cancels it; either outcome proves the old generation was rejected.
      } finally {
        markEnglishSettled();
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Content-Language': 'ar' },
      body: JSON.stringify(arabicReport),
    });
  });

  await page.goto(`/sites/${siteId}/report/${runId}`);
  await englishStarted;
  const switcher = page.locator('#language-switcher').first();
  await expect(switcher).toHaveValue('en');
  const preferenceRequest = page.waitForRequest((request) =>
    request.method() === 'PATCH' &&
    new URL(request.url()).pathname === '/api/users/preferences/language');
  const arabicRead = page.waitForRequest((request) =>
    request.method() === 'GET' &&
    new URL(request.url()).pathname === `/api/audits/${runId}/report` &&
    request.headers()['x-lang'] === 'ar');
  await switcher.selectOption('ar');
  expect((await preferenceRequest).headers()['x-lang']).toBe('ar');
  await arabicRead;

  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/site.ar.webmanifest',
  );
  await expect(page.getByText(arabicFinding!.copy.title)).toBeVisible();
  releaseEnglish();
  await englishSettled;
  await expect(page.getByText(arabicFinding!.copy.title)).toBeVisible();
  for (const finding of englishReport.findings) {
    if (finding.copy.title !== arabicFinding!.copy.title) {
      await expect(page.getByText(finding.copy.title, { exact: true })).toHaveCount(0);
    }
  }

  await page.getByText(arabicFinding!.copy.title).click();
  await expect(page.getByText(arabicFinding!.copy.fix)).toBeVisible();

  const backendError = await page.evaluate(async () => {
    const response = await fetch('/api/users/000000000000000000000000', {
      headers: { 'x-lang': 'ar' },
    });
    return {
      status: response.status,
      language: response.headers.get('Content-Language'),
      body: await response.text(),
    };
  });
  expect(backendError.status).toBeGreaterThanOrEqual(400);
  expect(backendError.status).toBeLessThan(600);
  expect(backendError.language).toBe('ar');
  expect(backendError.body).toMatch(/[\u0600-\u06ff]/u);

  const pdf = await page.evaluate(async (idToDownload) => {
    const response = await fetch(`/api/audits/${idToDownload}/report.pdf`, {
      headers: { 'x-lang': 'ar', Accept: 'application/pdf' },
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      language: response.headers.get('Content-Language'),
      size: bytes.byteLength,
      prefix: new TextDecoder().decode(bytes.slice(0, 5)),
    };
  }, runId);
  expect(pdf).toMatchObject({ status: 200, language: 'ar', prefix: '%PDF-' });
  expect(pdf.size).toBeGreaterThan(100);

  await expectNoAxeViolations(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#language-switcher').first()).toHaveValue('ar');

  expect(sideEffectFingerprint(id)).toBe(beforeSwitch);
  expect(spendingRequests, 'the switch must not enqueue or reserve work').toEqual([]);
  expect(denials.urls, 'no external browser egress').toEqual([]);
});
