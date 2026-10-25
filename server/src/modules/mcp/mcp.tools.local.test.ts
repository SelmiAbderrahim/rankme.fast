/**
 * `get_local_seo_summary` and `get_reviews_summary` stored
 * read tools, against real in-memory Mongo + PGlite.
 */
// Entry via the module barrel first: it evaluates the registry before the
// controller, which the barrel/permissions import cycle requires.
import './index.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { subscriptions } from '../../db/schema/subscriptions.js';
import { usageCounters } from '../../db/schema/usage-counters.js';
import { keywords } from '../../db/schema/keywords.js';
import {
  resolveEffectivePermissions,
  type McpPermissionSpec,
} from '../../shared/mcp-permissions/index.js';
import { setApiKeysDb } from '../api-keys/api-keys.holder.js';
import {
  LocalSeoReviewRow,
  LocalSeoReviewSource,
  LocalSeoReviewSyncRun,
  insertLocalPackRankSnapshot,
  persistLocalSeoSnapshot,
  setLocalSeoProvider,
  setLocalSeoRankProvider,
  setReviewSyncQueue,
} from '../local-seo/index.js';
import { Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import { MCP_TOOL_NAMES } from './mcp.registry.js';
import {
  toolGetLocalSeoSummary,
  toolGetReviewsSummary,
} from './mcp.tools.local.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

const providerCalls: string[] = [];
const queueAdd = vi.fn();

function throwingProvider() {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => {
        providerCalls.push(String(property));
        throw new Error('provider must not be called by a stored read');
      },
    },
  ) as never;
}

/** The site lease also takes an account lease, which needs a user document. */
async function newAccount(): Promise<string> {
  const id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: id,
    email: `${id.toHexString()}@example.com`,
    deletionStartedAt: null,
    workLeases: [],
  });
  return id.toHexString();
}

function context(
  accountId: string,
  specs: { account?: McpPermissionSpec | null; key?: McpPermissionSpec | null } = {},
): McpToolContext {
  return {
    accountId,
    locale: 'en',
    permissions: resolveEffectivePermissions(
      specs.account ?? null,
      specs.key ?? null,
      MCP_TOOL_NAMES,
    ),
  };
}

async function seedTier(accountId: string, tier: 'starter' | 'pro') {
  await getTestDb()
    .insert(subscriptions)
    .values({ accountId, tier, status: 'active' })
    .onConflictDoNothing();
}

async function seedSite(accountId: string, domain = 'example.com', paused = false) {
  const site = await Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    paused,
  });
  return String(site._id);
}

async function usageSnapshot() {
  const rows = await getTestDb().select().from(usageCounters);
  return JSON.stringify(rows.map((row) => [row.accountId, row.metric, row.used]).sort());
}

type Structured = Record<string, unknown> & { error?: { code: string } };
const dataOf = (result: McpToolResult) => result.structuredContent as Structured;

beforeAll(async () => {
  await startMemoryMongo();
  setApiKeysDb((await startTestPostgres()) as never);
  setLocalSeoProvider(throwingProvider());
  setLocalSeoRankProvider(throwingProvider());
  setReviewSyncQueue({ add: queueAdd } as never);
});
afterAll(async () => {
  setApiKeysDb(null);
  setLocalSeoProvider(null);
  setLocalSeoRankProvider(null);
  setReviewSyncQueue(null);
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'none';
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  providerCalls.length = 0;
  queueAdd.mockClear();
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'polar';
});

async function seedLocalSnapshot(accountId: string, siteId: string) {
  const db = getTestDb();
  await persistLocalSeoSnapshot(db as never, {
    accountId,
    siteId,
    now: new Date('2026-07-10T12:00:00Z'),
    listings: [
      {
        source: 'google',
        name: 'Acme <b x>Plumbing',
        address: '1 Main St',
        phone: '555-0100',
        consistent: true,
      },
      {
        source: 'bing',
        name: 'Acme Plumbing Co',
        address: null,
        phone: null,
        consistent: false,
      },
    ] as never,
    reviews: { averageRating: 4.5, reviewCount: 12, recentReviewCount: null },
    qa: { questionCount: 3, unansweredCount: 2 },
    business: { ref: 'place_id:ChIJAcme', name: 'Acme Plumbing' },
  });
  const [keyword] = await db
    .insert(keywords)
    .values({
      accountId,
      siteId,
      phrase: 'plumber austin',
      locationCode: 2840,
      languageCode: 'en',
    })
    .returning();
  await insertLocalPackRankSnapshot(db as never, {
    accountId,
    siteId,
    keywordId: keyword!.id,
    position: 2,
    totalPackSize: 3,
    capturedAt: new Date('2026-07-11T12:00:00Z'),
  });
}

describe('get_local_seo_summary', () => {
  it('returns the stored listing, reviews and local-pack snapshot with consistency counts', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'pro');
    const siteId = await seedSite(accountId, 'acme.example.com', true);
    await seedLocalSnapshot(accountId, siteId);

    const result = await toolGetLocalSeoSummary({ siteId }, context(accountId));
    const data = dataOf(result);

    expect(result.isError).toBeUndefined();
    expect(data.status).toBe('ok');
    expect(data.sitePaused).toBe(true);
    expect(data.source).toBe('stored_local_listing_snapshot');
    expect(data.listingConsistency).toEqual({ total: 2, consistent: 1, inconsistent: 1 });
    expect((data.listings as unknown[]).length).toBe(2);
    expect(JSON.stringify(data)).not.toContain('<b x>');
    expect(data.reviews).toEqual({
      averageRating: 4.5,
      reviewCount: 12,
      unansweredQuestionCount: 2,
    });
    expect(data.localPack).toEqual([
      expect.objectContaining({ phrase: 'plumber austin', position: 2, totalPackSize: 3 }),
    ]);
    expect(data.truncated).toBe(false);
  });

  it('is empty/notConfigured before the first listing refresh', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'pro');
    const siteId = await seedSite(accountId);

    const data = dataOf(await toolGetLocalSeoSummary({ siteId }, context(accountId)));

    expect(data).toMatchObject({ status: 'empty', reason: 'notConfigured' });
  });

  it('returns locked below the localSeo feature tier', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'starter');
    const siteId = await seedSite(accountId);
    await seedLocalSnapshot(accountId, siteId);

    const data = dataOf(await toolGetLocalSeoSummary({ siteId }, context(accountId)));

    expect(data).toMatchObject({ status: 'locked', reason: 'featureLocked', feature: 'localSeo' });
    expect(data.listings).toBeUndefined();
  });

  it('hides another account\'s site and honors allowed-site + key-scope intersection', async () => {
    const owner = await newAccount();
    const stranger = await newAccount();
    await seedTier(owner, 'pro');
    await seedTier(stranger, 'pro');
    const siteA = await seedSite(owner, 'a.example.com');
    const siteB = await seedSite(owner, 'b.example.com');

    const cross = await toolGetLocalSeoSummary({ siteId: siteA }, context(stranger));
    expect(cross.isError).toBe(true);
    expect(dataOf(cross).error?.code).toBe('sites.errors.notFound');

    const narrowed = context(owner, {
      account: { allowedSiteIds: [siteA, siteB] },
      key: { allowedSiteIds: [siteB] },
    });
    const denied = await toolGetLocalSeoSummary({ siteId: siteA }, narrowed);
    expect(denied.isError).toBe(true);
    expect(dataOf(denied).error?.code).toBe('sites.errors.notFound');
    expect(dataOf(await toolGetLocalSeoSummary({ siteId: siteB }, narrowed)).status).toBe(
      'empty',
    );
  });

  it('bounds the local-pack list to 100 rows and flags truncation', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'pro');
    const siteId = await seedSite(accountId);
    const db = getTestDb();
    const inserted = await db
      .insert(keywords)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          accountId,
          siteId,
          phrase: `plumber ${index}`,
          locationCode: 2840,
          languageCode: 'en',
        })),
      )
      .returning();
    for (const keyword of inserted) {
      await insertLocalPackRankSnapshot(db as never, {
        accountId,
        siteId,
        keywordId: keyword.id,
        position: 1,
        totalPackSize: 3,
        capturedAt: new Date('2026-07-11T12:00:00Z'),
      });
    }

    const data = dataOf(await toolGetLocalSeoSummary({ siteId }, context(accountId)));

    expect(data.status).toBe('ok');
    expect(data.truncated).toBe(true);
    expect((data.localPack as unknown[]).length).toBeLessThanOrEqual(100);
  });

  it('never spends, enqueues, or calls a provider', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'pro');
    const siteId = await seedSite(accountId);
    await seedLocalSnapshot(accountId, siteId);
    const before = await usageSnapshot();

    await toolGetLocalSeoSummary({ siteId }, context(accountId));
    await toolGetLocalSeoSummary({ siteId: 'bad' }, context(accountId));

    expect(await usageSnapshot()).toBe(before);
    expect(providerCalls).toEqual([]);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

async function seedReviews(accountId: string, siteId: string) {
  await LocalSeoReviewSource.create([
    { accountId, profileId: siteId, source: 'google', target: 'ChIJsecretPlaceTargetValue1234567890abcdef' },
    { accountId, profileId: siteId, source: 'trustpilot', target: 'example.com' },
  ]);
  const run = await LocalSeoReviewSyncRun.create({
    accountId,
    profileId: siteId,
    sources: ['google', 'trustpilot'],
    depth: 10,
    outputLocale: 'en',
    status: 'partial',
    perSourceOutcomes: [
      { source: 'google', outcome: 'ok', retained: 3, errorCode: null },
      { source: 'trustpilot', outcome: 'failed', retained: 0, errorCode: 'VendorQuotaError' },
    ],
    retainedCount: 3,
    aiTerminalState: 'themes-ok',
    aiCompletedAt: new Date('2026-07-10T12:00:00Z'),
    aiInputCount: 3,
    completedAt: new Date('2026-07-10T12:00:00Z'),
  });
  const rows = await LocalSeoReviewRow.create(
    [
      { text: 'Slow <b y>service', rating: 2, source: 'google' },
      { text: 'Long wait for the plumber', rating: 1, source: 'google' },
      { text: 'Great and friendly staff', rating: 5, source: 'google' },
    ].map((row, index) => ({
      accountId,
      profileId: siteId,
      sourceReviewId: `r-${index}`,
      reviewedAt: new Date(`2026-0${index + 1}-15T00:00:00Z`),
      firstSeenRunId: run._id,
      fetchedAt: new Date('2026-07-10T12:00:00Z'),
      ...row,
    })),
  );
  await LocalSeoReviewSyncRun.updateOne(
    { _id: run._id },
    {
      $set: {
        aiThemes: [
          {
            kind: 'complaint',
            label: 'Slow service',
            summary: 'Customers mention long waits.',
            citedReviewIds: [String(rows[0]!._id), String(rows[1]!._id)],
          },
          {
            kind: 'praise',
            label: 'Friendly staff',
            summary: 'Staff are kind.',
            // Only one cited row exists: the theme must drop at read time.
            citedReviewIds: [String(rows[2]!._id), 'f'.repeat(24)],
          },
        ],
      },
    },
  );
}

describe('get_reviews_summary', () => {
  it('returns source readiness, stats and cited theme samples without targets', async () => {
    const accountId = await newAccount();
    // No subscription: review reads are ungated stored reads.
    const siteId = await seedSite(accountId);
    await seedReviews(accountId, siteId);

    const result = await toolGetReviewsSummary({ siteId }, context(accountId));
    const data = dataOf(result);

    expect(result.isError).toBeUndefined();
    expect(data.status).toBe('ok');
    expect(data.totalReviews).toBe(3);
    expect(data.sources).toEqual([
      { source: 'google', configured: true, lastOutcome: 'ok', lastRetainedCount: 3, lastErrorCode: null },
      {
        source: 'trustpilot',
        configured: true,
        lastOutcome: 'failed',
        lastRetainedCount: 0,
        lastErrorCode: 'VendorQuotaError',
      },
      { source: 'tripadvisor', configured: false, lastOutcome: null, lastRetainedCount: null, lastErrorCode: null },
    ]);
    expect((data.ratingHistogram as Record<string, number>)[5]).toBe(1);
    const themes = data.themes as {
      terminal: string;
      complaints: Array<{ label: string; citationCount: number; samples: unknown[] }>;
      praise: unknown[];
    };
    expect(themes.complaints).toHaveLength(1);
    expect(themes.complaints[0]).toMatchObject({ label: 'Slow service', citationCount: 2 });
    expect(themes.complaints[0]!.samples).toHaveLength(2);
    expect(themes.praise).toHaveLength(0);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('ChIJsecret');
    expect(serialized).not.toContain('<b y>');
    expect(serialized).not.toContain('target');
  });

  it('is empty/notConfigured with no sources or runs and empty/noData with sources only', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);

    expect(dataOf(await toolGetReviewsSummary({ siteId }, context(accountId)))).toMatchObject({
      status: 'empty',
      reason: 'notConfigured',
    });

    await LocalSeoReviewSource.create({
      accountId,
      profileId: siteId,
      source: 'google',
      target: 'place',
    });
    const sourcesOnly = dataOf(await toolGetReviewsSummary({ siteId }, context(accountId)));
    expect(sourcesOnly).toMatchObject({ status: 'empty', reason: 'noData' });
    expect((sourcesOnly.sources as Array<{ configured: boolean }>)[0]!.configured).toBe(true);
  });

  it('is empty/noData when the latest run stored no review rows', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);
    await LocalSeoReviewSyncRun.create({
      accountId,
      profileId: siteId,
      sources: ['google'],
      depth: 5,
      status: 'failed',
    });

    const data = dataOf(await toolGetReviewsSummary({ siteId }, context(accountId)));

    expect(data).toMatchObject({ status: 'empty', reason: 'noData' });
    expect(data.latestRun).toMatchObject({ status: 'failed' });
  });

  it('hides another account\'s site and honors allowed-site + key-scope intersection', async () => {
    const owner = await newAccount();
    const stranger = await newAccount();
    const siteA = await seedSite(owner, 'a.example.com');
    const siteB = await seedSite(owner, 'b.example.com');
    await seedReviews(owner, siteA);

    const cross = await toolGetReviewsSummary({ siteId: siteA }, context(stranger));
    expect(cross.isError).toBe(true);
    expect(dataOf(cross).error?.code).toBe('sites.errors.notFound');

    const narrowed = context(owner, {
      account: { allowedSiteIds: [siteA, siteB] },
      key: { allowedSiteIds: [siteB] },
    });
    const denied = await toolGetReviewsSummary({ siteId: siteA }, narrowed);
    expect(denied.isError).toBe(true);
    expect(dataOf(denied).error?.code).toBe('sites.errors.notFound');
    expect(dataOf(await toolGetReviewsSummary({ siteId: siteB }, narrowed)).status).toBe(
      'empty',
    );
  });

  it('keeps stored reads available after a downgrade and never spends or enqueues', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'starter');
    const siteId = await seedSite(accountId);
    await seedReviews(accountId, siteId);
    const before = await usageSnapshot();

    const data = dataOf(await toolGetReviewsSummary({ siteId }, context(accountId)));

    expect(data.status).toBe('ok');
    expect(await usageSnapshot()).toBe(before);
    expect(providerCalls).toEqual([]);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('trims the monthly series to the latest 24 months', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);
    await seedReviews(accountId, siteId);
    const run = await LocalSeoReviewSyncRun.findOne({ profileId: siteId });
    await LocalSeoReviewRow.create(
      Array.from({ length: 40 }, (_, index) => ({
        accountId,
        profileId: siteId,
        source: 'google',
        sourceReviewId: `old-${index}`,
        rating: 4,
        text: 'ok',
        reviewedAt: new Date(Date.UTC(2023, index, 10)),
        firstSeenRunId: run!._id,
        fetchedAt: new Date('2026-07-10T12:00:00Z'),
      })),
    );

    const data = dataOf(await toolGetReviewsSummary({ siteId }, context(accountId)));

    expect((data.monthlyVelocity as unknown[]).length).toBeLessThanOrEqual(24);
    expect((data.averageRatingTrend as unknown[]).length).toBeLessThanOrEqual(24);
  });
});
