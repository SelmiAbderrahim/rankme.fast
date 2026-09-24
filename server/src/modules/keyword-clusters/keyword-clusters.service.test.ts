/**
 * DTO projection and default-dependency behaviour for the clustering service.
 *
 * The router suite drives the HTTP lifecycle; this suite covers the read
 * projections over a STORED completed run (which a queued create never has)
 * and the production default arms the router tests always inject over.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { keywords as keywordsTable } from '../../db/schema/keywords.js';
import { serpObservations } from '../../db/schema/serp-observations.js';
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
import { Site } from '../sites/sites.model.js';
import { SerpClusterRun } from './keyword-clusters.model.js';
import {
  findLatestCompletedKeywordCluster,
  getKeywordClusterRun,
  listKeywordClusterRuns,
  previewKeywordClusterRun,
  startKeywordClusterRun,
} from './keyword-clusters.service.js';
import {
  KEYWORD_CLUSTER_MIN_SHARED_URLS,
  KEYWORD_CLUSTER_RULES_VERSION,
  KEYWORD_CLUSTER_TOP_URLS,
} from './keyword-clusters.schemas.js';

const OBSERVED = new Date('2026-08-04T09:00:00.000Z');
const kwId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let accountId: string;
let siteId: string;

const fakeQueue = () =>
  ({ add: vi.fn(async () => ({ id: 'queued' })) }) as unknown as Queue;

async function seedOwnedSite(): Promise<void> {
  accountId = new Types.ObjectId().toString();
  const site = await Site.create({
    accountId: new Types.ObjectId(accountId),
    url: 'https://clusters.test',
    domain: 'clusters.test',
    displayName: 'Clusters',
  });
  siteId = String(site._id);
}

async function seedGroupablePair(): Promise<void> {
  const db = getTestDb();
  for (const [phrase, urls] of [
    ['aaa shoes', [1, 2, 3, 4]],
    ['bbb shoes', [1, 2, 3, 9]],
  ] as const) {
    const [row] = await db
      .insert(keywordsTable)
      .values({
        accountId,
        siteId,
        phrase,
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        engine: 'google',
        active: true,
      })
      .returning({ id: keywordsTable.id });
    await db.insert(serpObservations).values({
      accountId,
      siteId,
      keywordId: row!.id,
      engine: 'google',
      checkedAt: new Date(),
      source: 'fresh',
      features: { features: [], featuredSnippet: null, paa: [] },
      topResults: urls.map((n, index) => ({
        domain: `serp-${n}.example`,
        url: `https://serp-${n}.example/page`,
        rankGroup: index + 1,
        rankAbsolute: index + 1,
      })),
    });
  }
}

/** A terminal run carrying real clusters — the shape only a worker produces. */
async function seedCompletedRun(options: { omitLabelFields?: boolean } = {}) {
  const run = await SerpClusterRun.create({
    accountId: new Types.ObjectId(accountId),
    siteId: new Types.ObjectId(siteId),
    locale: 'en',
    status: 'completed',
    aiStatus: 'applied',
    rulesVersion: KEYWORD_CLUSTER_RULES_VERSION,
    minSharedUrls: KEYWORD_CLUSTER_MIN_SHARED_URLS,
    topUrlWindow: KEYWORD_CLUSTER_TOP_URLS,
    keywordCount: 3,
    blockedCount: 1,
    keywordIds: [kwId(1), kwId(2), kwId(3)],
    blocked: [
      {
        keywordId: kwId(9),
        phrase: 'never checked',
        reason: 'missing',
        observedAt: null,
      },
      {
        keywordId: kwId(8),
        phrase: 'stale check',
        reason: 'stale',
        observedAt: OBSERVED,
      },
    ],
    clusters: [],
    requestedAt: OBSERVED,
    startedAt: OBSERVED,
    completedAt: OBSERVED,
  });

  const grouped: Record<string, unknown> = {
    id: 'cluster-1',
    size: 2,
    pivotKeywordId: kwId(1),
    sharedUrls: ['https://a.example/x'],
    members: [
      {
        keywordId: kwId(1),
        phrase: 'aaa shoes',
        observedAt: OBSERVED,
        isPivot: true,
        sharedUrls: ['https://a.example/x'],
        sharedUrlCount: 4,
      },
      {
        keywordId: kwId(2),
        phrase: 'bbb shoes',
        observedAt: OBSERVED,
        isPivot: false,
        sharedUrls: ['https://a.example/x'],
        sharedUrlCount: 3,
      },
    ],
  };
  const singleton: Record<string, unknown> = {
    id: 'cluster-2',
    size: 1,
    pivotKeywordId: kwId(3),
    sharedUrls: [],
    members: [
      {
        keywordId: kwId(3),
        phrase: 'ccc boots',
        observedAt: OBSERVED,
        isPivot: true,
        sharedUrls: [],
        sharedUrlCount: 0,
      },
    ],
  };
  if (!options.omitLabelFields) {
    grouped.label = 'Shoes';
    grouped.labelSource = 'ai';
    singleton.label = null;
    singleton.labelSource = null;
  }

  // Written through the raw driver so the omit case really stores a document
  // WITHOUT the label keys — a Mongoose default would otherwise fill them and
  // the projection's legacy-shape fallback would never be exercised.
  await SerpClusterRun.collection.updateOne(
    { _id: run._id },
    { $set: { clusters: [grouped, singleton] } },
  );
  return String(run._id);
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  (env as { KEYWORD_CLUSTERING_ENABLED: boolean }).KEYWORD_CLUSTERING_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { KEYWORD_CLUSTERING_ENABLED: boolean }).KEYWORD_CLUSTERING_ENABLED = true;
  await seedOwnedSite();
});

describe('stored-run projections', () => {
  it('returns the newest completed account-and-site cluster by id or normalized phrase', async () => {
    const olderRunId = await seedCompletedRun();
    const newerRunId = await seedCompletedRun();

    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: kwId(1),
        phrase: 'aaa shoes',
      }),
    ).resolves.toMatchObject({
      runId: newerRunId,
      clusterId: 'cluster-1',
      members: [
        { keywordId: kwId(1), phrase: 'aaa shoes' },
        { keywordId: kwId(2), phrase: 'bbb shoes' },
      ],
    });
    expect(newerRunId).not.toBe(olderRunId);

    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: kwId(99),
        phrase: '  AAA SHOES  ',
      }),
    ).resolves.toMatchObject({ runId: newerRunId, clusterId: 'cluster-1' });

    const authoritativeRunId = await seedCompletedRun();
    await SerpClusterRun.collection.updateOne(
      { _id: new Types.ObjectId(authoritativeRunId) },
      {
        $set: {
          clusters: [
            {
              id: 'phrase-only',
              size: 1,
              pivotKeywordId: kwId(77),
              sharedUrls: [],
              members: [
                {
                  keywordId: kwId(77),
                  phrase: 'aaa shoes',
                  observedAt: OBSERVED,
                  isPivot: true,
                  sharedUrls: [],
                  sharedUrlCount: 0,
                },
              ],
              label: null,
              labelSource: null,
            },
            {
              id: 'id-authoritative',
              size: 1,
              pivotKeywordId: kwId(1),
              sharedUrls: [],
              members: [
                {
                  keywordId: kwId(1),
                  phrase: 'renamed shoes',
                  observedAt: OBSERVED,
                  isPivot: true,
                  sharedUrls: [],
                  sharedUrlCount: 0,
                },
              ],
              label: null,
              labelSource: null,
            },
          ],
        },
      },
    );
    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: kwId(1),
        phrase: 'aaa shoes',
      }),
    ).resolves.toMatchObject({
      runId: authoritativeRunId,
      clusterId: 'id-authoritative',
      members: [{ keywordId: kwId(1), phrase: 'renamed shoes' }],
    });
  });

  it('returns no downstream cluster for invalid, empty, or foreign scope', async () => {
    await seedCompletedRun();
    const otherAccountId = new Types.ObjectId().toString();
    const otherSiteId = new Types.ObjectId().toString();

    await expect(
      findLatestCompletedKeywordCluster({
        accountId: 'invalid',
        siteId,
        keywordId: kwId(1),
        phrase: 'aaa shoes',
      }),
    ).resolves.toBeNull();
    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: kwId(1),
        phrase: '   ',
      }),
    ).resolves.toBeNull();
    await expect(
      findLatestCompletedKeywordCluster({
        accountId: otherAccountId,
        siteId,
        keywordId: kwId(1),
        phrase: 'aaa shoes',
      }),
    ).resolves.toBeNull();
    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId: otherSiteId,
        keywordId: kwId(1),
        phrase: 'aaa shoes',
      }),
    ).resolves.toBeNull();
  });

  it('projects clusters, members, evidence, and blocked rows on the detail read', async () => {
    const runId = await seedCompletedRun();
    const detail = await getKeywordClusterRun({ accountId, runId });

    expect(detail).toMatchObject({
      status: 'completed',
      aiStatus: 'applied',
      clusterCount: 2,
      groupedClusterCount: 1,
      startedAt: OBSERVED.toISOString(),
      completedAt: OBSERVED.toISOString(),
      error: null,
    });
    expect(detail.clusters[0]).toMatchObject({
      id: 'cluster-1',
      size: 2,
      label: 'Shoes',
      labelSource: 'ai',
    });
    expect(detail.clusters[0]!.members[1]).toMatchObject({
      phrase: 'bbb shoes',
      isPivot: false,
      sharedUrlCount: 3,
      observedAt: OBSERVED.toISOString(),
    });
    expect(detail.clusters[1]).toMatchObject({ size: 1, label: null, labelSource: null });
    expect(detail.blocked).toEqual([
      {
        keywordId: kwId(9),
        phrase: 'never checked',
        reason: 'missing',
        observedAt: null,
      },
      {
        keywordId: kwId(8),
        phrase: 'stale check',
        reason: 'stale',
        observedAt: OBSERVED.toISOString(),
      },
    ]);
  });

  it('reads a legacy cluster document that predates the label fields', async () => {
    const runId = await seedCompletedRun({ omitLabelFields: true });
    const detail = await getKeywordClusterRun({ accountId, runId });
    expect(detail.clusters.map((cluster) => cluster.label)).toEqual([null, null]);
    expect(detail.clusters.map((cluster) => cluster.labelSource)).toEqual([null, null]);
  });

  it('summarizes the same run in the list read', async () => {
    await seedCompletedRun();
    const { items } = await listKeywordClusterRuns({ accountId, siteId, limit: 20 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ clusterCount: 2, groupedClusterCount: 1 });
  });

  it('projects a failed run with its bounded error category', async () => {
    const run = await SerpClusterRun.create({
      accountId: new Types.ObjectId(accountId),
      siteId: new Types.ObjectId(siteId),
      locale: 'en',
      status: 'failed',
      aiStatus: 'pending',
      rulesVersion: KEYWORD_CLUSTER_RULES_VERSION,
      minSharedUrls: KEYWORD_CLUSTER_MIN_SHARED_URLS,
      topUrlWindow: KEYWORD_CLUSTER_TOP_URLS,
      keywordCount: 2,
      blockedCount: 0,
      keywordIds: [kwId(1), kwId(2)],
      blocked: [],
      clusters: [],
      error: {
        category: 'queue_failed',
        messageKey: 'keywordClusters.errors.queueFailed',
      },
      requestedAt: OBSERVED,
    });
    const detail = await getKeywordClusterRun({
      accountId,
      runId: String(run._id),
    });
    expect(detail.error).toEqual({
      category: 'queue_failed',
      messageKey: 'keywordClusters.errors.queueFailed',
    });
    expect(detail.startedAt).toBeNull();
    expect(detail.completedAt).toBeNull();
  });
});

describe('production default dependencies', () => {
  it('previews with the default clock and no injected readiness reader', async () => {
    await seedGroupablePair();
    const preview = await previewKeywordClusterRun(
      { accountId, siteId, locale: 'en' },
      { db: getTestDb() as never, queue: fakeQueue() },
    );
    expect(preview).toMatchObject({
      ready: true,
      readyCount: 2,
      blockedTotal: 0,
      spend: { deploymentMode: 'community', capacityEnforced: false },
    });
    expect(preview).not.toHaveProperty('aiSpend');
  });

  it('starts with the default clock and the default enqueue helper', async () => {
    await seedGroupablePair();
    const queue = fakeQueue();
    const run = await startKeywordClusterRun(
      { accountId, siteId, locale: 'en' },
      { db: getTestDb() as never, queue },
    );
    expect(run.status).toBe('queued');
    expect(run.keywordCount).toBe(2);
    expect(vi.mocked(queue.add)).toHaveBeenCalledTimes(1);
    // The deterministic job id carries no colon (BullMQ forbids it).
    const jobId = vi.mocked(queue.add).mock.calls[0]?.[2]?.jobId;
    expect(jobId).toBe(`keyword-clustering-${run.id}`);
    const stored = await SerpClusterRun.findById(run.id).lean();
    expect(stored?.inputs).toHaveLength(2);
    expect(stored?.blockedCount).toBe(0);
    expect(stored?.blocked).toEqual([]);
    expect(stored?.inputs[0]).toMatchObject({
      phrase: 'aaa shoes',
      observedAt: expect.any(Date),
    });
  });

  it('never previews a separate AI spend and starts from injected readiness', async () => {
    const queue = fakeQueue();
    const observedAt = new Date().toISOString();
    const readReadinessFn = vi.fn(async () => ({
      ready: [
        {
          keywordId: kwId(1),
          phrase: 'alpha',
          observedAt,
          topUrls: ['https://alpha.example/page'],
        },
        {
          keywordId: kwId(2),
          phrase: 'beta',
          observedAt,
          topUrls: ['https://beta.example/page'],
        },
      ],
      blocked: [],
    }));
    const deps = {
      db: getTestDb() as never,
      queue,
      readReadinessFn,
    };

    const preview = await previewKeywordClusterRun(
      { accountId, siteId, locale: 'en' },
      deps,
    );
    expect(preview).not.toHaveProperty('aiSpend');
    const run = await startKeywordClusterRun(
      { accountId, siteId, locale: 'en' },
      deps,
    );
    expect(run.keywordCount).toBe(2);
    expect(readReadinessFn).toHaveBeenCalledTimes(2);
  });

  it('refuses the whole selected scope when any keyword is blocked', async () => {
    const queue = fakeQueue();
    const observedAt = OBSERVED.toISOString();
    const readReadinessFn = vi.fn(async () => ({
      ready: [
        {
          keywordId: kwId(1),
          phrase: 'aaa shoes',
          observedAt,
          topUrls: ['https://one.example/page'],
        },
        {
          keywordId: kwId(2),
          phrase: 'bbb shoes',
          observedAt,
          topUrls: ['https://two.example/page'],
        },
      ],
      blocked: [
        {
          keywordId: kwId(3),
          phrase: 'stale boots',
          reason: 'stale' as const,
          observedAt,
        },
      ],
    }));
    const deps = {
        db: getTestDb() as never,
        queue,
        readReadinessFn,
      };

    const preview = await previewKeywordClusterRun(
      { accountId, siteId, locale: 'en' },
      deps,
    );
    expect(preview).toMatchObject({
      ready: false,
      reason: 'notEnoughKeywords',
      readyCount: 2,
      blockedTotal: 1,
    });
    expect(preview.blocked[0]).toMatchObject({ phrase: 'stale boots', observedAt });

    await expect(startKeywordClusterRun(
      { accountId, siteId, locale: 'en' },
      deps,
    )).rejects.toMatchObject({ status: 409 });
    expect(queue.add).not.toHaveBeenCalled();
    expect(await SerpClusterRun.countDocuments()).toBe(0);
  });
});

describe('keyword-cluster service guards the caller cannot reach over HTTP', () => {
  // `siteMutationLease` answers 404 for an unowned site before the router
  // runs, so the service-level ownership check is only reachable directly.
  it('refuses a well-formed site id this account does not own', async () => {
    await expect(
      listKeywordClusterRuns({
        accountId,
        siteId: '6a6fa7c28d75c2fd32d84a99',
        limit: 10,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns null when the newest completed run has no cluster for the keyword', async () => {
    await seedCompletedRun();
    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: kwId(77),
        phrase: 'a phrase no cluster carries',
      }),
    ).resolves.toBeNull();
  });

  it('returns null for a legacy matched row whose clusters no longer contain the query', async () => {
    vi.spyOn(SerpClusterRun, 'findOne').mockReturnValue({
      sort: () => ({
        lean: async () => ({
          _id: new Types.ObjectId(),
          clusters: [
            {
              id: 'legacy-cluster',
              members: [{ keywordId: kwId(98), phrase: 'different phrase' }],
            },
          ],
        }),
      }),
    } as never);

    await expect(
      findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: kwId(99),
        phrase: 'target phrase',
      }),
    ).resolves.toBeNull();
  });
});
