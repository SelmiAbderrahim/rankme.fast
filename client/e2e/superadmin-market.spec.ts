/**
 * Superadmin market-observability composed-stack journey.
 *
 * All provider/run/commerce fixtures are persisted aggregates. The journey
 * performs no vendor request: Mongo/Postgres/BullMQ are seeded through the
 * composed services, then the shipped API and client are exercised normally.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { freshAccount, logIn, signUp } from './helpers/account';
import {
  runComposeApiScript,
  runComposePsql,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function assertAxeBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(result.violations, `${label} (${theme}) axe violations`).toEqual([]);
  }
  await setTheme(page, 'light');
}

function promoteAndSeedPostgres(accountId: string): void {
  runComposePsql(
    `UPDATE "user"
        SET role = 'SuperAdmin',
            two_factor_enabled = true,
            email_verified = true,
            updated_at = now()
      WHERE id = :'account_id';

     INSERT INTO subscriptions (account_id, tier, status, brand_radar)
       VALUES (:'account_id', 'agency', 'active', true)
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'agency',
                       status = 'active',
                       brand_radar = true,
                       updated_at = now();

     INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'brand_mention_scans', 25, 80)
       ON CONFLICT (account_id, period, metric)
         DO UPDATE SET used = 25, "limit" = 80, updated_at = now();

     INSERT INTO credit_ledger (account_id, metric, delta, polar_order_id, reason)
       VALUES
         (:'account_id', 'brand_mention_scans', 40, :'sale_order', 'purchase'),
         (:'account_id', 'brand_mention_scans', -40, :'refund_order', 'refund'),
         (:'account_id', 'brand_mention_scans', -3, null, 'consumption');

     INSERT INTO brand_radar_events
       (account_id, scan_id, stage, event, cost_micros, metadata, occurred_at)
       VALUES
         (:'account_id', :'brand_search', 'search', 'succeeded', 10000, '{}', now()),
         (:'account_id', :'brand_summary', 'summary', 'failed', 20000,
          '{"reason":"VendorAuthError"}', now()),
         (:'account_id', :'brand_digest', 'brand_digest', 'succeeded', 30000, '{}', now()),
         (:'account_id', :'brand_halt', 'scan', 'halted', 0, '{}', now());

     INSERT INTO vendor_responses
       (capability, operation, cache_key, params, payload, account_id, cost_micros, fetched_at)
       VALUES
         ('backlink', 'backlinks-referring-domains', :'link_key', '{}', '{}',
          :'account_id', 40000, now()),
         ('local-listings', 'reviews-sync-google', :'review_key', '{}', '{}',
          :'account_id', 50000, now()),
         ('competitor', 'traffic', :'traffic_key', '{"subOperation":"traffic"}', '{}',
          :'account_id', 70000, now()),
         ('keyword', 'trends_live', :'trends_key', '{}', '{}',
          :'account_id', 80000, now());

     INSERT INTO volatility_runs
       (observation_date, status, spent_micros, budget_micros, halt_reason)
       VALUES (current_date, 'partial', 123000, 456000, 'mid_run_actual')
       ON CONFLICT (observation_date)
         DO UPDATE SET status = 'partial',
                       spent_micros = 123000,
                       budget_micros = 456000,
                       halt_reason = 'mid_run_actual',
                       updated_at = now();

     INSERT INTO volatility_indices
       (observation_date, category, value_tenths, state, spent_micros, observed_at)
       VALUES
         (current_date, 'finance', 42, 'published', 12000, now()),
         (current_date, 'composite', 40, 'partial', 123000, now())
       ON CONFLICT (observation_date, category)
         DO UPDATE SET value_tenths = EXCLUDED.value_tenths,
                       state = EXCLUDED.state,
                       spent_micros = EXCLUDED.spent_micros,
                       observed_at = EXCLUDED.observed_at;`,
    {
      variables: {
        account_id: accountId,
        sale_order: `market-sale-${accountId}`,
        refund_order: `market-refund-${accountId}`,
        brand_search: `market-search-${accountId}`,
        brand_summary: `market-summary-${accountId}`,
        brand_digest: `market-digest-${accountId}`,
        brand_halt: `market-halt-${accountId}`,
        link_key: `market-link-${accountId}`,
        review_key: `market-review-${accountId}`,
        traffic_key: `market-traffic-${accountId}`,
        trends_key: `market-trends-${accountId}`,
      },
    },
  );
}

function seedMongoAndDlq(accountId: string): void {
  runComposeApiScript(
    `
      const mongooseModule = await import('mongoose');
      const mongoose = mongooseModule.default;
      await mongoose.connect(process.env.MONGODB_URI);
      const database = mongoose.connection.db;
      if (!database) throw new Error('Mongo database unavailable');
      const accountId = process.env.SEED_ACCOUNT_ID;
      const accountObjectId = new mongoose.Types.ObjectId(accountId);
      const siteId = new mongoose.Types.ObjectId();
      const scanId = new mongoose.Types.ObjectId();
      const now = new Date();
      await database.collection('users').updateOne(
        { _id: accountObjectId },
        { $set: { role: 'SuperAdmin' } },
      );
      await database.collection('brandradarscans').insertOne({
        _id: scanId,
        accountId: accountObjectId,
        siteId,
        brandQuery: 'Seeded operator-only brand',
        queryHash: 'a'.repeat(64),
        status: 'failed',
        refund: { issued: true, unit: 1 },
        createdAt: now,
        updatedAt: now,
      });
      await database.collection('backlinkpullruns').insertOne({
        accountId: accountObjectId,
        siteId,
        status: 'failed',
        refunded: true,
        createdAt: now,
      });
      await database.collection('linkgapruns').insertOne({
        accountId: accountObjectId,
        siteId,
        status: 'failed',
        totalRefunded: 1,
        createdAt: now,
      });
      await database.collection('trafficsnapshotruns').insertOne({
        accountId: accountObjectId,
        siteId,
        status: 'succeeded',
        refunded: false,
        createdAt: now,
      });
      await database.collection('localseoreviewsyncruns').insertOne({
        accountId: accountObjectId,
        profileId: siteId,
        status: 'partial',
        refunded: true,
        aiCostMicros: 60000,
        perSourceOutcomes: [{
          source: 'google',
          outcome: 'failed',
          retained: 0,
          errorCode: 'VendorTimeoutError',
        }],
        createdAt: now,
        completedAt: now,
      });
      await database.collection('trends_exploration_runs').insertOne({
        accountId,
        status: 'failed',
        refunded: true,
        errorCode: 'VendorQuotaError',
        createdAt: now,
        completedAt: now,
      });
      await mongoose.disconnect();

      const { Queue } = await import('bullmq');
      const RedisModule = await import('ioredis');
      const Redis = RedisModule.default;
      const connection = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
      });
      const deadLetter = new Queue('dead-letter', { connection });
      await deadLetter.add(
        'dead-letter',
        {
          original: { scanId: scanId.toHexString(), accountId },
          queue: 'brand-radar',
          err: 'VendorTimeoutError',
          failedAt: now.toISOString(),
        },
        { jobId: 'market-dlq-' + accountId },
      );
      await deadLetter.close();
      await connection.quit();
    `,
    { SEED_ACCOUNT_ID: accountId },
  );
}

test('Superadmin observes market health, spend, queues, sensor and commerce with guarded requeue', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const account = freshAccount('superadmin-market');

  const signupContext = await browser.newContext();
  const signupPage = await signupContext.newPage();
  await signUp(signupPage, account);
  const memberResponse = await signupPage.request.get(
    '/api/superadmin/intelligence/market-costs',
  );
  expect(memberResponse.status()).toBe(404);
  await signupContext.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, account);
  const sessionResponse = await page.request.get('/api/auth/get-session');
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const accountId = session.user?.id;
  expect(accountId).toBeTruthy();

  promoteAndSeedPostgres(accountId!);
  seedMongoAndDlq(accountId!);

  const sections = [
    {
      name: 'overview',
      expected: 'Market feature switches',
    },
    {
      name: 'providers',
      expected: 'content_analysis',
    },
    {
      name: 'costs',
      expected: 'Market feature costs',
    },
    {
      name: 'queues',
      expected: 'Market queues',
    },
    {
      name: 'monitors',
      expected: 'Volatility sensor',
    },
  ] as const;

  for (const section of sections) {
    await page.goto(`/superadmin?tab=intelligence&intel=${section.name}`);
    await expect(page.getByText(section.expected, { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`tab=intelligence.*intel=${section.name}`),
    );
    await page.reload();
    await expect(page.getByText(section.expected, { exact: true }).first()).toBeVisible();
    await assertAxeBothThemes(page, section.name);
  }

  await page.goto('/superadmin?tab=intelligence&intel=providers');
  await expect(page.getByText('reviews', { exact: true })).toBeVisible();
  await expect(page.getByText('trends', { exact: true })).toBeVisible();

  await page.goto('/superadmin?tab=intelligence&intel=costs');
  await expect(page.getByText('brand_mention_scans', { exact: true })).toBeVisible();
  await expect(page.getByText('brand-scans-40', { exact: true })).toBeVisible();

  await page.goto('/superadmin?tab=intelligence&intel=queues');
  const requeue = page.getByRole('button', { name: 'Requeue' }).first();
  await expect(requeue).toBeVisible();
  await requeue.click();
  await expect(page.getByRole('button', { name: 'Requeued' })).toBeVisible();

  await context.close();
});
