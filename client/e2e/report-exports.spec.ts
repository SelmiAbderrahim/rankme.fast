import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import {
  runComposeApiScript,
  runComposePsql,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

interface Snapshot {
  id: string;
  kind: string;
  format: 'pdf' | 'csv' | 'json';
  locale: string;
  schemaVersion: number;
  kindVersion: number;
  completeness: { state: 'complete'; selectedItems: number; representedItems: number };
  sourceDates: Array<{ label: string; kind: string; observedAt?: string }>;
}

interface CreatedShare {
  id: string;
  snapshotId: string;
  url: string;
  formats: string[];
  revokedAt: string | null;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as { user?: { id?: string } }).user?.id;
  expect(id).toBeTruthy();
  return id!;
}

function setAgency(id: string): void {
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
    data: { url: 'https://export-proof.example', label: 'Unified export proof' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const id = ((await response.json()) as { site?: { id?: string } }).site?.id;
  expect(id).toMatch(/^[0-9a-f]{24}$/u);
  return id!;
}

async function runAudit(request: APIRequestContext, siteId: string): Promise<string> {
  const started = await request.post(`/api/sites/${siteId}/audits`, {
    data: {},
    headers: await csrfHeaders(request),
  });
  expect(started.status()).toBe(202);
  const runId = ((await started.json()) as { run?: { id?: string } }).run?.id;
  expect(runId).toMatch(/^[0-9a-f]{24}$/u);
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/sites/${siteId}/audits?limit=1`);
        if (response.status() !== 200) return `http-${response.status()}`;
        const body = (await response.json()) as { runs: Array<{ id: string; status: string }> };
        return body.runs.find((run) => run.id === runId)?.status ?? 'missing';
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
    )
    .toBe('succeeded');
  return runId!;
}

async function createSnapshot(
  request: APIRequestContext,
  input: {
    kind: string;
    format: string;
    target: Record<string, string>;
    selection: Record<string, unknown>;
    locale: 'en' | 'ar';
  },
  expected = 201,
): Promise<{ response: APIResponse; snapshot?: Snapshot }> {
  const response = await request.post('/api/report-exports', {
    data: { ...input, brandingMode: 'rankmefast' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(expected);
  if (expected !== 201) return { response };
  const snapshot = ((await response.json()) as { snapshot: Snapshot }).snapshot;
  expect(snapshot).toMatchObject({
    kind: input.kind,
    format: input.format,
    locale: input.locale,
    completeness: { state: 'complete' },
  });
  return { response, snapshot };
}

async function createShare(
  request: APIRequestContext,
  snapshotId: string,
  formats: Array<'view' | 'pdf' | 'csv'>,
): Promise<CreatedShare> {
  const response = await request.post(`/api/report-exports/${snapshotId}/shares`, {
    data: { expiresInDays: 7, formats },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const share = ((await response.json()) as { share: CreatedShare }).share;
  expect(share).toMatchObject({ snapshotId, formats, revokedAt: null });
  expect(new URL(share.url).pathname).toMatch(/^\/(?:[a-z]{2}\/)?share\/[A-Za-z0-9_-]{43}$/u);
  return share;
}

async function revokeShare(
  request: APIRequestContext,
  snapshotId: string,
  shareId: string,
): Promise<void> {
  const response = await request.post(
    `/api/report-exports/${snapshotId}/shares/${shareId}/revoke`,
    { data: {}, headers: await csrfHeaders(request) },
  );
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { share: { revokedAt: string | null } }).share.revokedAt)
    .toBeTruthy();
}

function expireMongoRecord(collection: string, id: string): void {
  if (!/^[a-z]+$/u.test(collection)) throw new Error('Unsafe Mongo collection');
  runComposeApiScript(
    `
      const mongooseModule = await import('mongoose');
      const mongoose = mongooseModule.default;
      await mongoose.connect(process.env.MONGODB_URI);
      const database = mongoose.connection.db;
      if (!database) throw new Error('Mongo database unavailable');
      const result = await database.collection(process.env.SEED_COLLECTION).updateOne(
        { _id: new mongoose.Types.ObjectId(process.env.SEED_ID) },
        { $set: { expiresAt: new Date('2000-01-01T00:00:00.000Z') } },
      );
      if (result.matchedCount !== 1) throw new Error('Expiry fixture did not match');
      await mongoose.disconnect();
    `,
    { SEED_COLLECTION: collection, SEED_ID: id },
  );
}

function seedOverBoundClientRows(account: string, site: string): void {
  runComposePsql(
    `WITH inserted AS (
       INSERT INTO keywords
         (account_id, site_id, phrase, location_code, language_code, device, engine)
       SELECT :'account_id', :'site_id',
              CASE WHEN n = 1 THEN '=2+3' ELSE 'export bound ' || n END,
              2840, 'en', 'desktop', 'google'
       FROM generate_series(1, 26) AS n
       RETURNING id
     )
     INSERT INTO rankings
       (keyword_id, position, rank_absolute, found_url, checked_at, source, engine)
     SELECT id, 4, 5, 'https://export-proof.example/rank',
            '2026-08-01T12:00:00Z', 'fresh', 'google'
     FROM inserted;`,
    { variables: { account_id: account, site_id: site } },
  );
}

async function scanBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((next) => {
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    }, theme);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations, `${label} (${theme})`).toEqual([]);
  }
}

test('unified report exports: formats, immutable bytes, public lifecycle, ownership, bounds, RTL, mobile, and axe', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(600_000);
  const ownerDenials = collectDenials();
  await denyNonLoopback(context, { onDeny: ownerDenials.onDeny });
  await signUp(page, freshAccount('report-exports'));
  const owner = await accountId(page.request);
  setAgency(owner);
  const siteId = await createSite(page.request);
  const runId = await runAudit(page.request, siteId);
  const target = { scope: 'site_resource', siteId, resourceId: runId };
  const fullSelection = {
    buckets: ['fixNow', 'watch', 'passed'],
    sections: ['findings', 'pagespeed', 'gsc', 'aiVisibility', 'localSeo', 'summary'],
  };

  const pdf = (
    await createSnapshot(page.request, {
      kind: 'audit.run',
      format: 'pdf',
      target,
      selection: fullSelection,
      locale: 'en',
    })
  ).snapshot!;
  const pdfDownload = await page.request.get(`/api/report-exports/${pdf.id}/download`);
  expect(pdfDownload.status()).toBe(200);
  expect(pdfDownload.headers()['content-type']).toContain('application/pdf');
  expect(pdfDownload.headers()['content-disposition']).toMatch(
    /^attachment; filename="rankmefast-audit-/u,
  );
  const pdfBytes = await pdfDownload.body();
  expect(pdfBytes.byteLength).toBeGreaterThan(1_000);
  expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  const repeatedPdf = await page.request.get(`/api/report-exports/${pdf.id}/download`);
  expect(repeatedPdf.status()).toBe(200);
  expect(createHash('sha256').update(await repeatedPdf.body()).digest('hex')).toBe(
    createHash('sha256').update(pdfBytes).digest('hex'),
  );

  const csv = (
    await createSnapshot(page.request, {
      kind: 'audit.run',
      format: 'csv',
      target,
      selection: { buckets: ['fixNow'], sections: ['findings'] },
      locale: 'en',
    })
  ).snapshot!;
  const csvDownload = await page.request.get(`/api/report-exports/${csv.id}/download`);
  expect(csvDownload.status()).toBe(200);
  expect(csvDownload.headers()['content-type']).toContain('text/csv');
  expect(csvDownload.headers()['content-disposition']).toMatch(/\.csv"/u);
  const csvText = (await csvDownload.body()).toString('utf8');
  expect(csvText.charCodeAt(0)).toBe(0xfeff);
  expect(csvText).toContain('Rule,URL,Change');
  expect(csvText).not.toMatch(/accountId|costMicros|providerBinding|tokenHash/u);

  const json = (
    await createSnapshot(page.request, {
      kind: 'audit.run',
      format: 'json',
      target,
      selection: fullSelection,
      locale: 'en',
    })
  ).snapshot!;
  expect(json).toMatchObject({ schemaVersion: 1, kindVersion: 1 });
  expect(json.sourceDates.length).toBeGreaterThan(0);
  const jsonDownload = await page.request.get(`/api/report-exports/${json.id}/download`);
  expect(jsonDownload.status()).toBe(200);
  expect(jsonDownload.headers()['content-type']).toContain('application/json');
  const document = (await jsonDownload.json()) as {
    schema: string;
    schemaVersion: number;
    kindVersion: number;
    kind: string;
    sourceDates: Array<{ label: string; kind: string }>;
  };
  expect(document).toMatchObject({
    schema: 'rankme.report',
    schemaVersion: 1,
    kindVersion: 1,
    kind: 'audit.run',
  });
  expect(document.sourceDates.some((source) => source.label.length > 0)).toBe(true);
  expect(JSON.stringify(document)).not.toMatch(/accountId|costMicros|providerBinding|tokenHash/u);

  const revoked = await createShare(page.request, json.id, ['view', 'pdf']);
  const publicOrigin = new URL(page.url()).origin;
  const revokedContext = await browser.newContext({ baseURL: publicOrigin });
  const revokedDenials = collectDenials();
  await denyNonLoopback(revokedContext, { onDeny: revokedDenials.onDeny });
  const revokedPage = await revokedContext.newPage();
  try {
    const firstView = await revokedPage.goto(revoked.url);
    expect(firstView?.status()).toBe(200);
    await expect(revokedPage.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(revokedPage.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow, noarchive',
    );
    await expect(revokedPage.getByRole('heading', { name: 'Sources and dates' })).toBeVisible();
    expect(revokedDenials.urls, 'public report egress').toEqual([]);
  } finally {
    await revokedContext.close();
  }
  await revokeShare(page.request, json.id, revoked.id);
  const revokedToken = new URL(revoked.url).pathname.split('/').at(-1)!;
  expect((await page.request.get(`/api/report-shares/${revokedToken}`)).status()).toBe(404);

  const expired = await createShare(page.request, json.id, ['view']);
  expireMongoRecord('reportexportshares', expired.id);
  const expiredToken = new URL(expired.url).pathname.split('/').at(-1)!;
  expect((await page.request.get(`/api/report-shares/${expiredToken}`)).status()).toBe(404);

  const arabic = (
    await createSnapshot(page.request, {
      kind: 'audit.run',
      format: 'json',
      target,
      selection: fullSelection,
      locale: 'ar',
    })
  ).snapshot!;
  const deletionShare = await createShare(page.request, arabic.id, ['view', 'pdf']);
  const publicContext = await browser.newContext({ baseURL: publicOrigin, viewport: { width: 390, height: 844 } });
  const publicDenials = collectDenials();
  await denyNonLoopback(publicContext, { onDeny: publicDenials.onDeny });
  const publicPage = await publicContext.newPage();
  try {
    const response = await publicPage.goto(deletionShare.url);
    expect(response?.status()).toBe(200);
    await expect(publicPage.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(publicPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(publicPage.getByRole('link', { name: /PDF/u })).toBeVisible();
    await scanBothThemes(publicPage, 'Arabic public report mobile');
    expect(publicDenials.urls, 'Arabic public report egress').toEqual([]);
  } finally {
    await publicContext.close();
  }

  const foreignContext = await browser.newContext({ baseURL: publicOrigin });
  const foreignDenials = collectDenials();
  await denyNonLoopback(foreignContext, { onDeny: foreignDenials.onDeny });
  const foreignPage = await foreignContext.newPage();
  try {
    await signUp(foreignPage, freshAccount('report-export-foreign'));
    expect((await foreignPage.request.get(`/api/report-exports/${json.id}`)).status()).toBe(404);
    expect((await foreignPage.request.get(`/api/report-exports/${json.id}/download`)).status())
      .toBe(404);
    expect(foreignDenials.urls, 'foreign account egress').toEqual([]);
  } finally {
    await foreignContext.close();
  }

  seedOverBoundClientRows(owner, siteId);
  const sharedCsv = (
    await createSnapshot(page.request, {
      kind: 'ranks.current',
      format: 'csv',
      target: { scope: 'site', siteId },
      selection: {},
      locale: 'en',
    })
  ).snapshot!;
  expect(sharedCsv.completeness).toMatchObject({
    selectedItems: 26,
    representedItems: 26,
  });
  const csvShare = await createShare(page.request, sharedCsv.id, ['view', 'csv']);
  const csvContext = await browser.newContext({ baseURL: publicOrigin });
  const csvDenials = collectDenials();
  await denyNonLoopback(csvContext, { onDeny: csvDenials.onDeny });
  const csvPage = await csvContext.newPage();
  try {
    expect((await csvPage.goto(csvShare.url))?.status()).toBe(200);
    await expect(csvPage.getByRole('link', { name: /CSV/u })).toBeVisible();
    const csvToken = new URL(csvShare.url).pathname.split('/').at(-1)!;
    const publicCsv = await csvPage.request.get(
      `/api/report-shares/${csvToken}/files/csv`,
    );
    expect(publicCsv.status()).toBe(200);
    expect(publicCsv.headers()['content-type']).toContain('text/csv');
    const publicCsvText = (await publicCsv.body()).toString('utf8');
    expect(publicCsvText.charCodeAt(0)).toBe(0xfeff);
    expect(publicCsvText).toContain("'=2+3");
    for (const line of publicCsvText.slice(1).split(/\r?\n/u).slice(1).filter(Boolean)) {
      expect(line, 'public CSV rows must not begin with a spreadsheet formula')
        .not.toMatch(/^[=+@-]/u);
    }
    expect(csvDenials.urls, 'public CSV report egress').toEqual([]);
  } finally {
    await csvContext.close();
  }

  const refused = await createSnapshot(
    page.request,
    {
      kind: 'client.composite',
      format: 'json',
      target: { scope: 'site', siteId },
      selection: { sections: { audit: false, ranks: true, gsc: false } },
      locale: 'en',
    },
    422,
  );
  expect((await refused.response.json()) as { error?: { details?: { code?: string } } })
    .toMatchObject({ error: { details: { code: 'scope_too_large' } } });

  expireMongoRecord('reportexportsnapshots', csv.id);
  expect((await page.request.get(`/api/report-exports/${csv.id}/download`)).status()).toBe(404);

  await page.goto('/exports?tab=downloads');
  await expect(page).toHaveURL(/[?&]tab=downloads/u);
  await expect(page.getByRole('heading', { name: 'Exports and shares' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator('[data-slot="card"]:visible').getByText('audit.run', { exact: true }).first(),
  ).toBeVisible();

  const deleted = await page.request.delete(`/api/sites/${siteId}`, {
    headers: await csrfHeaders(page.request),
  });
  expect(deleted.status()).toBe(200);
  expect((await page.request.get(`/api/report-exports/${arabic.id}/download`)).status()).toBe(404);
  const deletionToken = new URL(deletionShare.url).pathname.split('/').at(-1)!;
  expect((await page.request.get(`/api/report-shares/${deletionToken}`)).status()).toBe(404);
  expect(ownerDenials.urls, 'owner browser egress').toEqual([]);
});
