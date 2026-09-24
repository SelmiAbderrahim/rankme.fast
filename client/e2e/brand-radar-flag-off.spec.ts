/**
 * Brand Radar kill switch proven against a composed API that is ACTUALLY
 * booted with `BRAND_RADAR_ENABLED=false`, not a route interception.
 *
 * The project is ordered LAST in `playwright.config.ts` and the suite is
 * strictly sequential (`fullyParallel: false`, `workers: 1`), so recreating
 * the runtime services here cannot race any other project. The `finally`
 * block restores the inherited flag on api + worker, verifies their parity,
 * and re-proves the entry point is no longer governed by the forced-off state.
 *
 * Proof shape:
 *   - new-run entry points (`POST /preview`, `POST /scans`) → the shipped 503
 *     `brandRadar.errors.productUnavailable` envelope;
 *   - stored reads (`GET /scans`, `GET /scans/:id`, `GET /scans/:id/mentions`)
 *     → 200 with the seeded terminal scan intact;
 *   - the workspace renders the honest unavailable card from the REAL 503.
 *
 * The Better Auth session lives in Postgres, so the browser cookie survives
 * the api container recreate.
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { freshAccount, grantE2eTier, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposeApiScript,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

// Two api recreates (~30 s each incl. health) + one signup.
test.setTimeout(300_000);

/** Localized (en) message of `brandRadar.errors.productUnavailable`. */
const UNAVAILABLE_MESSAGE = 'Brand Radar is temporarily unavailable. Please try again later.';

/**
 * Recreate ONLY the api service with the flag forced. `process.env` carries
 * the full sourced gate environment (COMPOSE_PROJECT_NAME, ports, providers),
 * so compose interpolation resolves every other variable exactly as the
 * original boot did.
 */
function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { BRAND_RADAR_ENABLED: value });
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

/** Brand Radar scans are site-scoped, so the seeded scan needs a real site. */
async function createSite(page: Page): Promise<string> {
  const res = await page.request.post('/api/sites', {
    data: { url: 'https://radar-flag-off.example', label: 'Radar flag-off' },
    headers: await csrfHeaders(page.request),
  });
  const body = (await res.json()) as { site?: { id?: string } };
  if (!body.site?.id) throw new Error('flag-off spec: site was not created');
  return body.site.id;
}

async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('flag-off spec: no session user id');
  return body.user.id;
}

// Per-run seeded scan id (24-hex ObjectId), shared between seeding and
// assertions. Random so a rerun on a preserved volume never collides on _id.
const seedScanId = randomUUID().replace(/-/g, '').slice(0, 24);

/**
 * Seed one fully-terminal completed scan + two mention rows straight through
 * the API image (superadmin-market.spec.ts precedent) so the stored-read
 * proof has real rows to serve while new runs are refused.
 */
function seedTerminalScan(accountId: string, siteId: string): void {
  runComposeApiScript(
    `
    const mongooseModule = await import('mongoose');
    const mongoose = mongooseModule.default;
    await mongoose.connect(process.env.MONGODB_URI);
    const database = mongoose.connection.db;
    if (!database) throw new Error('Mongo database unavailable');
    const accountObjectId = new mongoose.Types.ObjectId(process.env.SEED_ACCOUNT_ID);
    const scanId = new mongoose.Types.ObjectId(process.env.SEED_SCAN_ID);
    const mentionA = new mongoose.Types.ObjectId();
    const mentionB = new mongoose.Types.ObjectId();
    const now = new Date();
    await database.collection('brandradarmentions').insertMany([
      {
        _id: mentionA,
        accountId: accountObjectId,
        scanId,
        url: 'https://news.example/flag-off-a',
        domain: 'news.example',
        title: 'Seeded mention A',
        snippet: 'Stored read must survive the kill switch.',
        polarity: 'positive',
        confidence: 0.9,
        language: 'en',
        observedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: mentionB,
        accountId: accountObjectId,
        scanId,
        url: 'https://blog.example/flag-off-b',
        domain: 'blog.example',
        title: 'Seeded mention B',
        snippet: 'Second retained row.',
        polarity: 'neutral',
        confidence: null,
        language: 'en',
        observedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await database.collection('brandradarscans').insertOne({
      _id: scanId,
      accountId: accountObjectId,
      siteId: new mongoose.Types.ObjectId(process.env.SEED_SITE_ID),
      brandQuery: 'Flag-off stored scan',
      language: null,
      locationCode: null,
      status: 'completed',
      digestState: 'digest_absent',
      queryHash: 'b'.repeat(64),
      priorScanId: null,
      retainedRowCount: 2,
      retainedRowIds: [String(mentionA), String(mentionB)],
      mentionSummaryId: null,
      mentionCount: 2,
      sentimentDistribution: { positive: 50, neutral: 50, negative: 0, unknown: 0 },
      topDomains: [
        { domain: 'news.example', count: 1 },
        { domain: 'blog.example', count: 1 },
      ],
      trendVsPrevious: null,
      digestSentences: [],
      refund: { issued: false, unit: 1 },
      halt: null,
      terminalAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await mongoose.disconnect();
    `,
    {
      SEED_ACCOUNT_ID: accountId,
      SEED_SCAN_ID: seedScanId,
      SEED_SITE_ID: siteId,
    },
  );
}

test('a composed API booted with BRAND_RADAR_ENABLED=false refuses new runs and serves stored reads', async ({
  page,
  context,
}) => {
  const inheritedRuntime = captureInheritedComposeEnvironment(['BRAND_RADAR_ENABLED']);
  assertComposeRuntimeParity(inheritedRuntime);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const account = freshAccount('radar-flag-off');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  grantE2eTier(account.email, 'agency');
  const siteId = await createSite(page);
  seedTerminalScan(accountId, siteId);

  try {
    await test.step('boot the api with the kill switch OFF-flag and wait healthy', async () => {
      recreateApiWithFlag('false');
      await awaitApiHealthy(page);
    });

    await test.step('new-run entry points return the shipped 503 envelope', async () => {
      const headers = await csrfHeaders(page.request);
      const preview = await page.request.post(
        `/api/sites/${encodeURIComponent(siteId)}/brand-radar/preview`,
        { data: { brandQuery: 'Flag-off preview attempt' }, headers },
      );
      expect(preview.status()).toBe(503);
      const previewBody = (await preview.json()) as {
        error?: { message?: string };
      };
      expect(previewBody.error?.message).toBe(UNAVAILABLE_MESSAGE);

      const create = await page.request.post(
        `/api/sites/${encodeURIComponent(siteId)}/brand-radar/scans`,
        { data: { brandQuery: 'Flag-off create attempt' }, headers },
      );
      expect(create.status()).toBe(503);
      const createBody = (await create.json()) as {
        error?: { message?: string };
      };
      expect(createBody.error?.message).toBe(UNAVAILABLE_MESSAGE);
    });

    await test.step('stored reads survive: list, detail and mentions all 200', async () => {
      const list = await page.request.get(
        `/api/sites/${encodeURIComponent(siteId)}/brand-radar/scans`,
      );
      expect(list.status()).toBe(200);
      const listBody = (await list.json()) as { items: Array<{ id: string }> };
      expect(listBody.items.map((item) => item.id)).toContain(seedScanId);

      const detail = await page.request.get(`/api/brand-radar/scans/${seedScanId}`);
      expect(detail.status()).toBe(200);
      const detailBody = (await detail.json()) as {
        status: string;
        mentionCount: number;
        halt: unknown;
      };
      expect(detailBody.status).toBe('completed');
      expect(detailBody.mentionCount).toBe(2);
      expect(detailBody.halt).toBeNull();

      const mentions = await page.request.get(`/api/brand-radar/scans/${seedScanId}/mentions`);
      expect(mentions.status()).toBe(200);
      const mentionsBody = (await mentions.json()) as {
        items: Array<{ domain: string }>;
      };
      expect(mentionsBody.items.length).toBe(2);
    });

    await test.step('the workspace renders the honest unavailable card from the real 503', async () => {
      await page.goto(`/sites/${encodeURIComponent(siteId)}?tab=brand-radar&view=new`);
      await page.locator('#brand-radar-query').fill('Flag-off browser attempt');
      await page.getByTestId('brand-radar-preview-submit').click();
      await expect(page.getByTestId('brand-radar-unavailable')).toBeVisible();
    });
  } finally {
    await test.step('restore the flag and re-prove the entry point answers', async () => {
      recreateApiWithFlag(inheritedRuntime.BRAND_RADAR_ENABLED!);
      await awaitApiHealthy(page);
      assertComposeRuntimeParity(inheritedRuntime);
      const preview = await page.request.post(
        `/api/sites/${encodeURIComponent(siteId)}/brand-radar/preview`,
        {
          data: { brandQuery: 'Flag-restored preview' },
          headers: await csrfHeaders(page.request),
        },
      );
      // A no-plan account without the add-on is a commercial refusal, never the
      // kill-switch 503 — the flag is provably back on.
      expect(preview.status()).not.toBe(503);
    });
  }

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});
