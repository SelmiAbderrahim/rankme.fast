/**
 * Rank job processor tests. Exercises the
 * cross-user cache, per-keyword failure isolation, idempotent inserts and
 * scheduler wiring against a real PGlite + Mongo-memory pair.
 */
import { UnrecoverableError, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
  createFakeRankProvider,
  recordVendorCostUsd,
  type RankCheckInput,
  type RankCheckResult,
  type RankProvider,
} from '../../shared/providers/index.js';
import type { SerpItem } from '../../shared/providers/dataforseo/serp.js';
import {
  rankings as rankingsTable,
  keywords as keywordsTable,
  domainStates,
} from '../../db/schema/keywords.js';
import { localPackRankSnapshots as localPackRankSnapshotsTable } from '../../db/schema/local-seo.js';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  getTestDb,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';
import {
  createPostgresRankTargetsResolver,
  altEngineWeeklyStamp,
  createRankProcessor,
  type ResolveRankTargets,
} from './rank.processor.js';
import {
  computeSerpCacheKey,
  createSerpCacheRepo,
  type CachedSerp,
  type SerpCacheRepo,
} from './serp-cache.service.js';
import {
  createVendorArchiver,
  createVendorCacheRepo,
  createSingleFlight,
} from '../../shared/vendor-cache/index.js';

const logger = pino({ level: 'silent' });

/** Empty explicit resolver — matches the pre-refactor default stub. */
const emptyResolver: ResolveRankTargets = async () => [];

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

async function seedSite(domain = 'example.com') {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
  });
  return { accountId: accountId.toHexString(), siteId: site.id as string };
}

function payloadFor(ids: { accountId: string; siteId: string }) {
  return { ...ids, keywordIds: [], schedulerKey: 'manual' };
}

interface SerpTaskProvider extends RankProvider {
  postSerpTask(input: RankCheckInput): Promise<{ vendorTaskId: string }>;
  fetchSerpResult(taskId: string): Promise<{ items: SerpItem[]; costUsd: number | null }>;
}

function makeSerpTaskProvider(items: SerpItem[]): SerpTaskProvider {
  return {
    async postSerpTask() {
      return { vendorTaskId: 'TASK_ID' };
    },
    async fetchSerpResult() {
      return { items, costUsd: 0.00465 };
    },
    async checkRank(): Promise<RankCheckResult> {
      throw new Error('unused when postSerpTask/fetchSerpResult are set');
    },
    async checkLocalPackRank() {
      return {
        position: null,
        totalPackSize: 0,
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
    },
    async checkAltEngineRank() {
      throw new Error('unused: alt-engine rank checks are not exercised in this suite');
    },
    async searchPublicPages() {
      throw new Error('unused: makeSerpTaskProvider does not implement searchPublicPages');
    },
  };
}

function makeSerpLiveProvider(items: SerpItem[]): RankProvider & {
  liveSerp(input: RankCheckInput): Promise<{
    items: SerpItem[];
    costUsd: number | null;
    aiOverview: null;
  }>;
} {
  return {
    async liveSerp() {
      return { items, costUsd: 0.004, aiOverview: null };
    },
    async checkRank(): Promise<RankCheckResult> {
      throw new Error('unused when liveSerp is set');
    },
    async checkLocalPackRank() {
      return {
        position: null,
        totalPackSize: 0,
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
    },
    async checkAltEngineRank() {
      throw new Error('unused: alt-engine rank checks are not exercised in this suite');
    },
    async searchPublicPages() {
      throw new Error('unused: makeSerpLiveProvider does not implement searchPublicPages');
    },
  };
}

function createMemorySerpCache(): SerpCacheRepo {
  const rows = new Map<string, CachedSerp>();
  const flights = createSingleFlight();
  const address = (cacheKey: string, engine?: string) => `${engine ?? 'google'}:${cacheKey}`;
  return {
    async read(cacheKey, now, engine) {
      const row = rows.get(address(cacheKey, engine));
      return row && row.expiresAt > now ? row : null;
    },
    async write(input) {
      rows.set(address(input.cacheKey, input.engine), {
        topResults: input.topResults,
        aiOverview: input.aiOverview,
        features: input.features ?? null,
        ...(input.observationMeta ? { observationMeta: input.observationMeta } : {}),
        fetchedAt: input.fetchedAt,
        expiresAt: input.expiresAt,
      });
    },
    withSingleFlightLock(cacheKey, task) {
      return flights.run(cacheKey, task);
    },
    withSingleFlightLockLeaderAware(cacheKey, task) {
      return flights.runLeaderAware(cacheKey, task);
    },
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
});

describe('createRankProcessor', () => {
  it('malformed payload → UnrecoverableError (trust boundary)', async () => {
    const processor = createRankProcessor({
      provider: createFakeRankProvider(),
      resolveTargets: emptyResolver,
      logger,
    });
    await expect(processor(jobFor({ crafted: true }))).rejects.toThrow(UnrecoverableError);
  });

  it('missing site → UnrecoverableError', async () => {
    const ids = await seedSite();
    const foreign = {
      ...ids,
      accountId: new mongoose.Types.ObjectId().toHexString(),
    };
    const processor = createRankProcessor({
      provider: createFakeRankProvider(),
      resolveTargets: emptyResolver,
      logger,
    });
    await expect(processor(jobFor(payloadFor(foreign)))).rejects.toThrow(
      'site not found for rank job',
    );
  });

  it('paused site → zeroed outcome without resolving targets or vendor calls', async () => {
    const ids = await seedSite();
    await Site.updateOne({ _id: ids.siteId }, { $set: { paused: true, pausedAt: new Date() } });
    const provider = createFakeRankProvider();
    const providerSpy = vi.spyOn(provider, 'checkRank');
    const resolveTargets = vi.fn(emptyResolver);
    const processor = createRankProcessor({
      provider,
      resolveTargets,
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome).toEqual({
      siteId: ids.siteId,
      checked: 0,
      positions: [],
      fromCache: 0,
      fromFresh: 0,
      errors: 0,
      skipped: 0,
    });
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('explicit empty resolver → zero targets, zero vendor calls', async () => {
    const ids = await seedSite();
    const provider = createFakeRankProvider();
    const spy = vi.spyOn(provider, 'checkRank');
    const processor = createRankProcessor({
      provider,
      resolveTargets: emptyResolver,
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome).toEqual({
      siteId: ids.siteId,
      checked: 0,
      positions: [],
      fromCache: 0,
      fromFresh: 0,
      errors: 0,
      skipped: 0,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('selected UUID resolves and checks only that keyword', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const rows = await db
      .insert(keywordsTable)
      .values([
        {
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'selected keyword',
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        },
        {
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'unselected keyword',
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        },
      ])
      .returning();
    const selected = rows[0]!;
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkRank');
    const outcome = await createRankProcessor({
      provider,
      db: db as never,
      cache: createSerpCacheRepo({ db: db as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    })(
      jobFor({
        ...payloadFor(ids),
        keywordIds: [selected.id],
        manual: true,
      }),
    );

    expect(outcome.checked).toBe(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(
      (await db.select().from(rankingsTable)).map(({ keywordId }) => keywordId),
    ).toEqual([selected.id]);
  });

  it('persists a fresh task result when the optional cache layer is absent', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const [keyword] = await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'uncached rank',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const provider = makeSerpTaskProvider([
      {
        domain: 'example.com',
        url: 'https://example.com/uncached',
        rankGroup: 2,
        rankAbsolute: 2,
      },
    ]);
    const postSpy = vi.spyOn(provider, 'postSerpTask');
    const fetchSpy = vi.spyOn(provider, 'fetchSerpResult');

    const outcome = await createRankProcessor({
      provider,
      db: db as unknown as never,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-04T00:00:00.000Z'),
      logger,
    })(jobFor({ ...payloadFor(ids), manual: true }));

    expect(outcome).toMatchObject({ positions: [2], fromCache: 0, fromFresh: 1, errors: 0 });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const rows = await db
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ position: 2, source: 'fresh' });
  });

  it('vendor fresh → row persisted; second run uses cache', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const keyword = await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const kw = keyword[0]!;

    const items: SerpItem[] = [
      {
        domain: 'a.example',
        url: 'https://a.example/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
      {
        domain: 'b.example',
        url: 'https://b.example/',
        rankGroup: 2,
        rankAbsolute: 2,
      },
      {
        domain: 'example.com',
        url: 'https://example.com/pricing',
        rankGroup: 3,
        rankAbsolute: 3,
      },
    ];
    const provider = makeSerpTaskProvider(items);
    const postSpy = vi.spyOn(provider, 'postSerpTask');
    const cache = createSerpCacheRepo({
      db: db as unknown as never,
      ttlHours: 24 * 30,
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
      logger,
    });

    const first = await processor(jobFor(payloadFor(ids)));
    expect(first.positions).toEqual([3]);
    expect(first.fromFresh).toBe(1);
    expect(postSpy).toHaveBeenCalledTimes(1);

    // Bump checkedAt so idempotency doesn't drop the second insert; keep it
    // within the (default 24h) cache TTL so the second run hits cache.
    const second = await createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-12T00:00:00.000Z'),
      cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
      logger,
    })(jobFor(payloadFor(ids)));
    expect(second.positions).toEqual([3]);
    expect(second.fromCache).toBe(1);
    expect(postSpy).toHaveBeenCalledTimes(1); // still one vendor call

    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(['cache', 'fresh']);

    // Archive: exactly one vendor_responses row — the fresh fetch. The
    // cache-served second run appends nothing.
    const archived = await db.select().from(vendorResponses);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.capability).toBe('rank');
    expect(archived[0]?.operation).toBe('serp');
    expect(archived[0]?.params).toEqual({
      phrase: 'seo audit tool',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
  });

  it('a cache row appearing after the outer miss avoids vendor spend and keeps cache provenance', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const [keyword] = await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'late cache fill',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const checkedAt = new Date('2026-07-06T12:00:00.000Z');
    const fetchedAt = new Date('2026-07-06T11:59:00.000Z');
    const cacheKey = computeSerpCacheKey({
      phrase: 'late cache fill',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
    const read = vi
      .fn<SerpCacheRepo['read']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        topResults: [
          {
            domain: 'example.com',
            url: 'https://example.com/cached',
            rankGroup: 4,
            rankAbsolute: 4,
          },
        ],
        aiOverview: null,
        features: null,
        fetchedAt,
        expiresAt: new Date('2026-07-07T11:59:00.000Z'),
      });
    const write = vi.fn<SerpCacheRepo['write']>();
    const cache: SerpCacheRepo = {
      read,
      write,
      async withSingleFlightLock<T>(_key: string, task: () => Promise<T>): Promise<T> {
        return task();
      },
      async withSingleFlightLockLeaderAware<T>(
        _key: string,
        task: () => Promise<T>,
      ): Promise<{ value: T; joined: boolean }> {
        return { value: await task(), joined: false };
      },
    };
    const provider = makeSerpTaskProvider([]);
    const postSpy = vi.spyOn(provider, 'postSerpTask');
    const fetchSpy = vi.spyOn(provider, 'fetchSerpResult');

    const outcome = await createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => checkedAt,
      logger,
    })(jobFor({ ...payloadFor(ids), manual: true }));

    expect(outcome).toMatchObject({
      positions: [4],
      fromCache: 1,
      fromFresh: 0,
      errors: 0,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(1, cacheKey, checkedAt);
    expect(read).toHaveBeenNthCalledWith(2, cacheKey, checkedAt);
    expect(write).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      position: 4,
      foundUrl: 'https://example.com/cached',
      source: 'cache',
    });
  });

  it('concurrent distinct domains share one SERP payload but derive their own positions', async () => {
    const first = await seedSite('first.example');
    const second = await seedSite('second.example');
    const provider = makeSerpTaskProvider([
      {
        domain: 'first.example',
        url: 'https://first.example/ranked',
        rankGroup: 2,
        rankAbsolute: 2,
      },
      {
        domain: 'second.example',
        url: 'https://second.example/ranked',
        rankGroup: 7,
        rankAbsolute: 7,
      },
    ]);
    const originalFetch = provider.fetchSerpResult.bind(provider);
    const fetch = vi.spyOn(provider, 'fetchSerpResult');
    fetch.mockImplementation(async (taskId) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return originalFetch(taskId);
    });
    const cache = createMemorySerpCache();
    const resolveTargets: ResolveRankTargets = async ({ payload, domain }) => [
      {
        keywordId: `keyword-${payload.siteId}`,
        input: {
          keyword: 'shared concurrent phrase',
          domain,
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        },
        engine: 'google',
        engineTarget: null,
      },
    ];
    const processor = createRankProcessor({
      provider,
      cache,
      resolveTargets,
      clock: () => new Date('2026-07-06T00:00:00.000Z'),
      logger,
    });

    const [firstOutcome, secondOutcome] = await Promise.all([
      processor(jobFor(payloadFor(first))),
      processor(jobFor(payloadFor(second))),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect([firstOutcome.fromFresh, secondOutcome.fromFresh].sort()).toEqual([0, 1]);
    expect([firstOutcome.fromCache, secondOutcome.fromCache].sort()).toEqual([0, 1]);
    expect(firstOutcome.positions).toEqual([2]);
    expect(secondOutcome.positions).toEqual([7]);
  });

  it('direct checkRank fallback never shares or seeds a cross-domain cache row', async () => {
    const first = await seedSite('direct-one.example');
    const second = await seedSite('direct-two.example');
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkRank').mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const position = input.domain === 'direct-one.example' ? 3 : 8;
      return {
        position,
        foundUrl: `https://${input.domain}/ranked`,
        serpTopUrls: [`https://${input.domain}/ranked`],
        checkedAt: new Date('2026-07-06T00:00:00.000Z'),
      };
    });
    const cache = createMemorySerpCache();
    const write = vi.spyOn(cache, 'write');
    const resolveTargets: ResolveRankTargets = async ({ payload, domain }) => [
      {
        keywordId: `keyword-${payload.siteId}`,
        input: {
          keyword: 'direct shared phrase',
          domain,
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        },
        engine: 'google',
        engineTarget: null,
      },
    ];
    const processor = createRankProcessor({
      provider,
      cache,
      resolveTargets,
      clock: () => new Date('2026-07-06T00:00:00.000Z'),
      logger,
    });

    const [firstOutcome, secondOutcome] = await Promise.all([
      processor(jobFor(payloadFor(first))),
      processor(jobFor(payloadFor(second))),
    ]);

    expect(check).toHaveBeenCalledTimes(2);
    expect(firstOutcome.positions).toEqual([3]);
    expect(secondOutcome.positions).toEqual([8]);
    expect(write).not.toHaveBeenCalled();
  });

  it('partial failure: per-keyword non-retryable errors skip that row only', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const kws = await db
      .insert(keywordsTable)
      .values([
        {
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k1',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        },
        {
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k2',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        },
        {
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k3',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        },
      ])
      .returning();

    let call = 0;
    class BadPayload extends ProviderError {
      constructor() {
        super('bad', false, { provider: 'test', operation: 'x' });
      }
    }
    const provider: SerpTaskProvider = {
      async postSerpTask() {
        return { vendorTaskId: 'T' };
      },
      async fetchSerpResult() {
        call += 1;
        if (call === 2) throw new BadPayload();
        return {
          items: [
            {
              domain: 'example.com',
              url: 'https://example.com/',
              rankGroup: call,
              rankAbsolute: call,
            },
          ],
          costUsd: 0.00465,
        };
      },
      async checkRank(): Promise<RankCheckResult> {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        return {
          position: null,
          totalPackSize: 0,
          checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
    };
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.errors).toBe(1);
    expect(outcome.positions).toHaveLength(2);
    const ranks = await db
      .select()
      .from(rankingsTable)
      .where(and(eq(rankingsTable.keywordId, kws[0]!.id)));
    expect(ranks).toHaveLength(1);
    const missing = await db
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, kws[1]!.id));
    expect(missing).toHaveLength(0);
    // Failure signal: the errored keyword is stamped so the list endpoint can
    // render "check failed" instead of the never-checked "unavailable" state;
    // the succeeded keyword carries no stamp.
    const [k1Row] = await db.select().from(keywordsTable).where(eq(keywordsTable.id, kws[0]!.id));
    const [k2Row] = await db.select().from(keywordsTable).where(eq(keywordsTable.id, kws[1]!.id));
    expect(k1Row!.lastFailedCheckAt).toBeNull();
    expect(k1Row!.lastFailedReason).toBeNull();
    expect(k2Row!.lastFailedCheckAt).toBeInstanceOf(Date);
    // The cause travels with the stamp so the UI can say why, not just when.
    // `BadPayload` is a bare ProviderError, so it lands on the catch-all key
    // rather than borrowing a class it does not belong to.
    expect(k2Row!.lastFailedReason).toBe('vendor_error');
  });

  it('account-wide ProviderError propagates for BullMQ retry', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'k',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const provider = createFakeRankProvider({
      failure: new VendorAuthError('credentials rejected (HTTP 401)', {
        provider: 'fake',
        operation: 'serp',
      }),
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      logger,
    });
    await expect(processor(jobFor(payloadFor(ids)))).rejects.toThrow(VendorAuthError);
  });

  it('an account-wide failure stamps only the keyword it actually attempted', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(keywordsTable).values([
      {
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'a',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      },
      {
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'b',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      },
    ]);
    const provider = createFakeRankProvider({
      failure: new VendorQuotaError('vendor quota hit (HTTP 429)', {
        provider: 'fake',
        operation: 'serp',
      }),
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    await expect(processor(jobFor(payloadFor(ids)))).rejects.toThrow(VendorQuotaError);
    // Quota is account-wide, so the batch aborts — but the keyword the loop
    // never reached was NOT attempted and must not be reported as failed.
    const rows = await db.select().from(keywordsTable).where(eq(keywordsTable.siteId, ids.siteId));
    expect(rows).toHaveLength(2);
    const stamped = rows.filter((r) => r.lastFailedCheckAt instanceof Date);
    expect(stamped).toHaveLength(1);
    expect(stamped[0]!.lastFailedReason).toBe('vendor_quota');
    expect(rows.filter((r) => r.lastFailedCheckAt === null)[0]!.lastFailedReason).toBeNull();
  });

  it('a keyword-scoped failure keeps the batch running and stamps each attempt', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(keywordsTable).values([
      {
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'a',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      },
      {
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'b',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      },
    ]);
    const provider = createFakeRankProvider({
      failure: new VendorUnavailableError('serp/task_get remained in queue after 60 polls', {
        provider: 'fake',
        operation: 'serp',
      }),
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    // One slow keyword must not blank the site: the job completes and reports
    // both failures rather than aborting after the first.
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.errors).toBe(2);
    expect(outcome.positions).toHaveLength(0);
    const rows = await db.select().from(keywordsTable).where(eq(keywordsTable.siteId, ids.siteId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.lastFailedCheckAt instanceof Date)).toBe(true);
    expect(rows.every((r) => r.lastFailedReason === 'vendor_unavailable')).toBe(true);
  });

  it('records every independent keyword-scoped failure without abandoning the batch', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(keywordsTable).values(
      Array.from({ length: 8 }, (_, i) => ({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: `k${i}`,
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop' as const,
      })),
    );
    const provider = createFakeRankProvider({
      failure: new VendorTimeoutError('vendor timed out', {
        provider: 'fake',
        operation: 'serp',
      }),
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    // A timeout can be keyword-specific. The batch records every attempted
    // keyword and completes; only account-wide auth/quota failures abort.
    await expect(processor(jobFor(payloadFor(ids)))).resolves.toMatchObject({
      checked: 0,
      errors: 8,
      skipped: 0,
    });
    const rows = await db.select().from(keywordsTable).where(eq(keywordsTable.siteId, ids.siteId));
    expect(rows.filter((r) => r.lastFailedCheckAt !== null)).toHaveLength(8);
    expect(rows.every((r) => r.lastFailedReason === 'vendor_timeout')).toBe(true);
  });

  it.each([
    ['vendor_timeout', new VendorTimeoutError('t', { provider: 'fake', operation: 'serp' })],
    ['vendor_malformed', new VendorMalformedError('m', { provider: 'fake', operation: 'serp' })],
    [
      'vendor_error',
      new ProviderError('other', false, { provider: 'fake', operation: 'serp' }),
    ],
  ] as const)('records %s as the stored failure reason', async (reason, failure) => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(keywordsTable).values({
      accountId: ids.accountId,
      siteId: ids.siteId,
      phrase: 'a',
      locationCode: 1,
      languageCode: 'en',
      device: 'desktop',
    });
    const processor = createRankProcessor({
      provider: createFakeRankProvider({ failure }),
      db: db as unknown as never,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.errors).toBe(1);
    const [row] = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.siteId, ids.siteId));
    expect(row!.lastFailedReason).toBe(reason);
  });

  it('idempotent inserts: rerun with same checkedAt does not duplicate rows', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const kw = (
      await db
        .insert(keywordsTable)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        })
        .returning()
    )[0]!;
    const items: SerpItem[] = [
      {
        domain: 'example.com',
        url: 'https://example.com/x',
        rankGroup: 5,
        rankAbsolute: 5,
      },
    ];
    const provider = makeSerpTaskProvider(items);
    const build = () =>
      createRankProcessor({
        provider,
        db: db as unknown as never,
        cache: createSerpCacheRepo({
          db: db as unknown as never,
          ttlHours: 24,
        }),
        resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
        clock: () => new Date('2026-07-05T00:00:00.000Z'),
        logger,
      });
    await build()(jobFor(payloadFor(ids)));
    const secondOutcome = await build()(jobFor(payloadFor(ids)));
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows).toHaveLength(1);
    // Second run detects the existing row as a replay: no vendor call, and
    // the outcome credits it as skipped.
    expect(secondOutcome.skipped).toBe(1);
    expect(secondOutcome.checked).toBe(0);
  });

  it('daily cadence stamps checkedAt at UTC midnight of the day', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(domainStates).values({ siteId: ids.siteId, cadence: 'daily' });
    const kw = (
      await db
        .insert(keywordsTable)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        })
        .returning()
    )[0]!;
    const items: SerpItem[] = [
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ];
    const processor = createRankProcessor({
      provider: makeSerpTaskProvider(items),
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T13:45:00.000Z'),
      logger,
    });
    await processor(jobFor(payloadFor(ids)));
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows[0]!.checkedAt.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });

  it('manual (on-demand) job stamps checkedAt at the exact trigger time, not the period floor', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    // Weekly cadence would normally floor checkedAt to Monday; a manual job
    // must instead stamp the exact clock time so "Check now" writes a fresh row.
    await db.insert(domainStates).values({ siteId: ids.siteId, cadence: 'weekly' });
    const kw = (
      await db
        .insert(keywordsTable)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        })
        .returning()
    )[0]!;
    const items: SerpItem[] = [
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ];
    const processor = createRankProcessor({
      provider: makeSerpTaskProvider(items),
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T13:45:00.000Z'),
      logger,
    });
    await processor(jobFor({ ...payloadFor(ids), manual: true }));
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows[0]!.checkedAt.toISOString()).toBe('2026-07-05T13:45:00.000Z');
  });

  it('falls back to provider.checkRank when postSerpTask/fetchSerpResult are absent', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const kw = (
      await db
        .insert(keywordsTable)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        })
        .returning()
    )[0]!;
    const provider = createFakeRankProvider({
      result: {
        position: 4,
        foundUrl: 'https://example.com/found',
        serpTopUrls: [
          'https://a.example/',
          'https://b.example/',
          'https://c.example/',
          'https://example.com/found',
        ],
        checkedAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T13:45:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.positions).toEqual([4]);
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('fresh');
  });

  it('uses provider.liveSerp when no standard task pair exists', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const kw = (
      await db
        .insert(keywordsTable)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'seo audit tool',
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        })
        .returning()
    )[0]!;
    const items: SerpItem[] = [
      {
        domain: 'a.example',
        url: 'https://a.example/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
      {
        domain: 'example.com',
        url: 'https://example.com/pricing',
        rankGroup: 2,
        rankAbsolute: 2,
      },
    ];
    const provider = makeSerpLiveProvider(items);
    const liveSpy = vi.spyOn(provider, 'liveSerp');
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T13:45:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    // A live-only provider still writes a real rankings row.
    expect(liveSpy).toHaveBeenCalledTimes(1);
    expect(outcome.fromFresh).toBe(1);
    expect(outcome.positions).toEqual([2]);
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.position).toBe(2);
    expect(rows[0]!.source).toBe('fresh');
  });

  it('prefers the budgeted depth-100 task path when production exposes both SERP modes', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(keywordsTable).values({
      accountId: ids.accountId,
      siteId: ids.siteId,
      phrase: 'depth one hundred',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
    const fullItems: SerpItem[] = Array.from({ length: 100 }, (_, index) => ({
      domain: index === 99 ? 'example.com' : `result-${index + 1}.example`,
      url:
        index === 99
          ? 'https://example.com/deep-result'
          : `https://result-${index + 1}.example/`,
      rankGroup: index + 1,
      rankAbsolute: index + 1,
    }));
    const task = makeSerpTaskProvider(fullItems);
    const live = makeSerpLiveProvider(fullItems.slice(0, 20));
    const provider = {
      ...live,
      postSerpTask: task.postSerpTask,
      fetchSerpResult: task.fetchSerpResult,
    };
    const liveSpy = vi.spyOn(provider, 'liveSerp');
    const postSpy = vi.spyOn(provider, 'postSerpTask');
    const fetchSpy = vi.spyOn(provider, 'fetchSerpResult');
    const now = new Date('2026-07-05T13:45:00.000Z');
    const cache = createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => now,
      logger,
    });

    const outcome = await processor(jobFor(payloadFor(ids)));

    expect(outcome.positions).toEqual([100]);
    expect(postSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(liveSpy).not.toHaveBeenCalled();
    const [stored] = await db.select().from(vendorCache);
    expect(
      (stored?.payload as { topResults?: unknown[] } | undefined)?.topResults,
    ).toHaveLength(100);
  });

  it('never observes or stores a result beyond position 100', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db.insert(keywordsTable).values({
      accountId: ids.accountId,
      siteId: ids.siteId,
      phrase: 'outside sold depth',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
    const items: SerpItem[] = Array.from({ length: 101 }, (_, index) => ({
      domain: index === 100 ? 'example.com' : `result-${index + 1}.example`,
      url:
        index === 100
          ? 'https://example.com/out-of-contract-result'
          : `https://result-${index + 1}.example/`,
      rankGroup: index + 1,
      rankAbsolute: index + 1,
    }));
    const provider = makeSerpTaskProvider(items);
    const cache = createSerpCacheRepo({
      db: db as unknown as never,
      ttlHours: 24,
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T13:45:00.000Z'),
      logger,
    });

    const outcome = await processor(jobFor(payloadFor(ids)));

    expect(outcome.positions).toEqual([null]);
    const [stored] = await db.select().from(vendorCache);
    expect(
      (stored?.payload as { topResults?: unknown[] } | undefined)?.topResults,
    ).toHaveLength(100);
  });

  it('persists the captured vendor cost on the serp archive row (task-API branch)', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'k',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const items: SerpItem[] = [
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ];
    const base = makeSerpTaskProvider(items);
    const provider: SerpTaskProvider = {
      ...base,
      async fetchSerpResult(taskId) {
        // Stands in for the DataForSEO choke point recording the envelope cost.
        recordVendorCostUsd(0.00465);
        return base.fetchSerpResult(taskId);
      },
    };
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    await processor(jobFor(payloadFor(ids)));
    const archived = await db
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'serp'));
    expect(archived).toHaveLength(1);
    expect(archived[0]!.costMicros).toBe(4_650n);
  });

  it('archives direct checkRank cost without populating the cross-user SERP cache', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'k',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const provider: RankProvider = {
      async checkRank() {
        recordVendorCostUsd(0.002);
        return {
          position: 1,
          foundUrl: 'https://example.com/',
          serpTopUrls: ['https://example.com/'],
          checkedAt: new Date('2026-07-05T00:00:00.000Z'),
        };
      },
      async checkLocalPackRank() {
        return {
          position: null,
          totalPackSize: 0,
          checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
    };
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      archive: createVendorArchiver(createVendorCacheRepo(db as unknown as never)),
      logger,
    });
    await processor(jobFor(payloadFor(ids)));
    const archived = await db
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, 'serp-direct'));
    expect(archived).toHaveLength(1);
    expect(archived[0]!.costMicros).toBe(2_000n);
    expect(archived[0]!.accountId).toBe(ids.accountId);
    expect(await db.select().from((await import('../../db/schema/vendor-cache.js')).vendorCache))
      .toEqual([]);
  });

  it('direct vendor null position remains an honest fresh not-found result', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    const kw = (
      await db
        .insert(keywordsTable)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: 'k',
          locationCode: 1,
          languageCode: 'en',
          device: 'desktop',
        })
        .returning()
    )[0]!;
    const provider = createFakeRankProvider({
      result: {
        position: null,
        serpTopUrls: [],
        checkedAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.positions).toEqual([null]);
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows[0]!.position).toBeNull();
  });

  it('non-ProviderError inside a check surfaces (bug, not a taxonomy fault)', async () => {
    const ids = await seedSite();
    const db = getTestDb();
    await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'k',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const provider: SerpTaskProvider = {
      async postSerpTask() {
        throw new Error('boom');
      },
      async fetchSerpResult() {
        throw new Error('unused');
      },
      async checkRank(): Promise<RankCheckResult> {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        return {
          position: null,
          totalPackSize: 0,
          checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
    };
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      logger,
    });
    await expect(processor(jobFor(payloadFor(ids)))).rejects.toThrow('boom');
  });
});

describe('createRankProcessor — rank-drop hook', () => {
  async function seedKeyword(
    ids: { accountId: string; siteId: string },
    phrase = 'seo audit tool',
  ) {
    const db = getTestDb();
    const rows = await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase,
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    return rows[0]!;
  }

  async function seedPriorRanking(keywordId: string, position: number | null, checkedAt: Date) {
    await getTestDb()
      .insert(rankingsTable)
      .values({
        keywordId,
        position,
        rankAbsolute: position,
        foundUrl: position === null ? null : 'https://example.com/',
        checkedAt,
        source: 'fresh',
      });
  }

  function itemsWithDomainAt(position: number | null): SerpItem[] {
    const items: SerpItem[] = [
      {
        domain: 'a.example',
        url: 'https://a.example/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
      {
        domain: 'b.example',
        url: 'https://b.example/',
        rankGroup: 2,
        rankAbsolute: 2,
      },
    ];
    if (position !== null) {
      items.push({
        domain: 'example.com',
        url: 'https://example.com/pricing',
        rankGroup: position,
        rankAbsolute: position,
      });
    }
    return items;
  }

  function makeProcessor(
    items: SerpItem[],
    onRankDrop: ((event: never) => Promise<void>) | undefined,
    clockIso: string,
    confirmRankDrop?: (candidate: never) => Promise<void>,
  ) {
    const db = getTestDb();
    return createRankProcessor({
      provider: makeSerpTaskProvider(items),
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date(clockIso),
      ...(onRankDrop ? { onRankDrop: onRankDrop as never } : {}),
      ...(confirmRankDrop ? { confirmRankDrop: confirmRankDrop as never } : {}),
      logger,
    });
  }

  it('fires the hook with the exact event on a drop (3 → 12)', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    await seedPriorRanking(kw.id, 3, new Date('2026-06-22T00:00:00.000Z'));
    const onRankDrop = vi.fn(async () => undefined);

    const outcome = await makeProcessor(
      itemsWithDomainAt(12),
      onRankDrop,
      '2026-06-29T09:00:00.000Z',
    )(jobFor(payloadFor(ids)));
    expect(outcome.positions).toEqual([12]);
    expect(onRankDrop).toHaveBeenCalledTimes(1);
    expect(onRankDrop).toHaveBeenCalledWith({
      accountId: ids.accountId,
      siteId: ids.siteId,
      keywordId: kw.id,
      keyword: 'seo audit tool',
      previousPosition: 3,
      currentPosition: 12,
      siteUrl: 'https://example.com',
    });
  });

  it('routes an inserted drop through durable confirmation instead of the legacy effect', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    await seedPriorRanking(kw.id, 3, new Date('2026-06-22T00:00:00.000Z'));
    const legacy = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => undefined);

    await makeProcessor(
      itemsWithDomainAt(12),
      legacy,
      '2026-06-29T09:00:00.000Z',
      confirm,
    )(jobFor(payloadFor(ids)));

    expect(legacy).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      accountId: ids.accountId,
      siteId: ids.siteId,
      siteUrl: 'https://example.com',
      keywordId: kw.id,
      keyword: 'seo audit tool',
      rankingId: expect.any(String),
      previousPosition: 3,
      candidatePosition: 12,
      candidateObservedAt: new Date('2026-06-29T00:00:00.000Z'),
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      domain: 'example.com',
      engine: 'google',
      engineTarget: null,
    });
  });

  it('fires with a null current position when the domain fell out of the SERP', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    await seedPriorRanking(kw.id, 5, new Date('2026-06-22T00:00:00.000Z'));
    const onRankDrop = vi.fn(async () => undefined);

    await makeProcessor(
      itemsWithDomainAt(null),
      onRankDrop,
      '2026-06-29T09:00:00.000Z',
    )(jobFor(payloadFor(ids)));
    expect(onRankDrop).toHaveBeenCalledWith(
      expect.objectContaining({ previousPosition: 5, currentPosition: null }),
    );
  });

  it('does NOT fire on a rise (5 → 2)', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    await seedPriorRanking(kw.id, 5, new Date('2026-06-22T00:00:00.000Z'));
    const onRankDrop = vi.fn(async () => undefined);

    await makeProcessor(
      itemsWithDomainAt(2),
      onRankDrop,
      '2026-06-29T09:00:00.000Z',
    )(jobFor(payloadFor(ids)));
    expect(onRankDrop).not.toHaveBeenCalled();
  });

  it('does NOT fire on the first check ever (no prior row)', async () => {
    const ids = await seedSite();
    await seedKeyword(ids);
    const onRankDrop = vi.fn(async () => undefined);

    await makeProcessor(
      itemsWithDomainAt(40),
      onRankDrop,
      '2026-06-29T09:00:00.000Z',
    )(jobFor(payloadFor(ids)));
    expect(onRankDrop).not.toHaveBeenCalled();
  });

  it('does NOT fire again when the same period re-runs (insert conflict)', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    await seedPriorRanking(kw.id, 3, new Date('2026-06-22T00:00:00.000Z'));
    const onRankDrop = vi.fn(async () => undefined);

    const run = () =>
      makeProcessor(
        itemsWithDomainAt(12),
        onRankDrop,
        '2026-06-29T09:00:00.000Z',
      )(jobFor(payloadFor(ids)));
    await run();
    await run(); // same weekly period → conflict → inserted:false → no re-fire
    expect(onRankDrop).toHaveBeenCalledTimes(1);
  });

  it('fresh fetch persists the AI Overview signal and caches the block', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    const db = getTestDb();
    const provider: SerpTaskProvider & {
      fetchSerpResult(taskId: string): Promise<{
        items: SerpItem[];
        costUsd: number | null;
        aiOverview: {
          present: boolean;
          references: Array<{
            domain: string;
            url: string | null;
            title: string | null;
          }>;
        };
      }>;
    } = {
      async postSerpTask() {
        return { vendorTaskId: 'TASK_ID' };
      },
      async fetchSerpResult() {
        return {
          items: itemsWithDomainAt(3),
          costUsd: 0.00465,
          aiOverview: {
            present: true,
            references: [
              {
                domain: 'example.com',
                url: 'https://example.com/guide',
                title: 'Guide',
              },
            ],
          },
        };
      },
      async checkRank(): Promise<RankCheckResult> {
        throw new Error('unused');
      },
      async checkAltEngineRank() {
        throw new Error('unused: alt-engine rank checks are not exercised in this suite');
      },
      async searchPublicPages() {
        throw new Error('unused');
      },
      async checkLocalPackRank() {
        return {
          position: null,
          totalPackSize: 0,
          checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
    };
    const cache = createSerpCacheRepo({
      db: db as unknown as never,
      ttlHours: 24,
    });
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-06-29T09:00:00.000Z'),
      logger,
    });
    await processor(jobFor(payloadFor(ids)));

    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aiOverviewPresent: true,
      aiCited: true,
      aiCitedUrl: 'https://example.com/guide',
    });

    // Second site tracking the same phrase is served from cache and derives
    // ITS OWN citation view from the cached block (not-cited here).
    const other = await Site.create({
      accountId: new mongoose.Types.ObjectId(),
      url: 'https://other.example',
      domain: 'other.example',
    });
    const otherIds = {
      accountId: other.accountId.toHexString(),
      siteId: other.id as string,
    };
    const otherKw = await seedKeyword(otherIds);
    const outcome = await createRankProcessor({
      provider,
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-06-29T10:00:00.000Z'),
      logger,
    })(jobFor(payloadFor(otherIds)));
    expect(outcome.fromCache).toBe(1);
    const otherRows = await db
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, otherKw.id));
    expect(otherRows[0]).toMatchObject({
      aiOverviewPresent: true,
      aiCited: false,
      aiCitedUrl: null,
    });
  });

  it('pre-feature cache row (no AI block) persists nulls', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    const db = getTestDb();
    const cache = createSerpCacheRepo({
      db: db as unknown as never,
      ttlHours: 24,
    });
    const now = new Date('2026-06-29T09:00:00.000Z');
    // Simulate a row recorded before the feature: aiOverview null.
    await cache.write({
      cacheKey: computeSerpCacheKey({
        phrase: kw.phrase,
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      }),
      topResults: [
        {
          domain: 'example.com',
          url: 'https://example.com/pricing',
          rankGroup: 3,
          rankAbsolute: 3,
        },
      ],
      aiOverview: null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const processor = createRankProcessor({
      provider: makeSerpTaskProvider([]),
      db: db as unknown as never,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => now,
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.fromCache).toBe(1);
    const rows = await db.select().from(rankingsTable).where(eq(rankingsTable.keywordId, kw.id));
    expect(rows[0]).toMatchObject({
      aiOverviewPresent: null,
      aiCited: null,
      aiCitedUrl: null,
    });
  });

  it('a rejecting hook never fails the job and the row is still persisted', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids);
    await seedPriorRanking(kw.id, 3, new Date('2026-06-22T00:00:00.000Z'));
    const onRankDrop = vi.fn(async () => {
      throw new Error('handler exploded');
    });

    const outcome = await makeProcessor(
      itemsWithDomainAt(12),
      onRankDrop,
      '2026-06-29T09:00:00.000Z',
    )(jobFor(payloadFor(ids)));
    expect(outcome.errors).toBe(0);
    const rows = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, kw.id));
    expect(rows).toHaveLength(2); // prior + fresh
  });
});

describe('createRankProcessor — replay suppression', () => {
  async function seedKeywords(ids: { accountId: string; siteId: string }, phrases: string[]) {
    const db = getTestDb();
    return db
      .insert(keywordsTable)
      .values(
        phrases.map((phrase) => ({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase,
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop' as const,
        })),
      )
      .returning();
  }

  it('prior rankings row for (keywordId, checkedAt) skips the vendor call', async () => {
    const ids = await seedSite();
    const [kw] = await seedKeywords(ids, ['k1']);
    const db = getTestDb();
    const checkedAt = new Date('2026-07-06T00:00:00.000Z'); // Monday-floor
    await db.insert(rankingsTable).values({
      keywordId: kw!.id,
      position: 2,
      rankAbsolute: 2,
      foundUrl: 'https://example.com/',
      checkedAt,
      source: 'fresh',
    });
    const provider = makeSerpTaskProvider([]);
    const postSpy = vi.spyOn(provider, 'postSerpTask');
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-06T09:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.skipped).toBe(1);
    expect(outcome.checked).toBe(0);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('all-replayed batch: pending set is empty, no vendor call at all', async () => {
    const ids = await seedSite();
    const [kw1, kw2] = await seedKeywords(ids, ['k1', 'k2']);
    const db = getTestDb();
    const checkedAt = new Date('2026-07-06T00:00:00.000Z');
    await db.insert(rankingsTable).values([
      {
        keywordId: kw1!.id,
        position: 1,
        rankAbsolute: 1,
        foundUrl: null,
        checkedAt,
        source: 'fresh',
      },
      {
        keywordId: kw2!.id,
        position: 2,
        rankAbsolute: 2,
        foundUrl: null,
        checkedAt,
        source: 'fresh',
      },
    ]);
    const provider = makeSerpTaskProvider([]);
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-06T09:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.skipped).toBe(2);
    expect(outcome.checked).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Prompt 31 — opt-in local-pack (map pack) tracking, parallel to organic.
// -----------------------------------------------------------------------------

describe('createRankProcessor — opt-in local-pack tracking (prompt 31)', () => {
  async function seedKeyword(
    ids: { accountId: string; siteId: string },
    overrides: { trackLocalPack?: boolean } = {},
  ) {
    const db = getTestDb();
    const rows = await db
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'plumber austin',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        trackLocalPack: overrides.trackLocalPack ?? false,
      })
      .returning();
    return rows[0]!;
  }

  it('createPostgresRankTargetsResolver carries trackLocalPack through to the resolved target', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids, { trackLocalPack: true });
    const db = getTestDb();
    const targets = await createPostgresRankTargetsResolver(db as unknown as never)({
      payload: payloadFor(ids),
      domain: 'example.com',
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      keywordId: kw.id,
      trackLocalPack: true,
    });
  });

  it('trackLocalPack=false (default): no local-pack check, no localPackRankSnapshots row', async () => {
    const ids = await seedSite();
    await seedKeyword(ids);
    const db = getTestDb();
    const provider = makeSerpTaskProvider([
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ]);
    const localPackSpy = vi.spyOn(provider, 'checkLocalPackRank');
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    await processor(jobFor(payloadFor(ids)));
    expect(localPackSpy).not.toHaveBeenCalled();
    const rows = await db.select().from(localPackRankSnapshotsTable);
    expect(rows).toHaveLength(0);
  });

  it('trackLocalPack=true: issues an ADDITIONAL checkLocalPackRank call and persists a snapshot row', async () => {
    const ids = await seedSite();
    const kw = await seedKeyword(ids, { trackLocalPack: true });
    const db = getTestDb();
    const provider = makeSerpTaskProvider([
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ]);
    const localPackSpy = vi.spyOn(provider, 'checkLocalPackRank');
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    // Organic check still ran normally — local-pack is parallel, not a replacement.
    expect(outcome.positions).toEqual([1]);
    expect(localPackSpy).toHaveBeenCalledTimes(1);
    expect(localPackSpy).toHaveBeenCalledWith({
      keyword: 'plumber austin',
      domain: 'example.com',
      locationCode: 2840,
      languageCode: 'en',
    });
    const rows = await db
      .select()
      .from(localPackRankSnapshotsTable)
      .where(eq(localPackRankSnapshotsTable.keywordId, kw.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: ids.accountId,
      siteId: ids.siteId,
      keywordId: kw.id,
      position: null,
      totalPackSize: 0,
    });
  });

  it("a local-pack failure never fails the organic rank job (hook-can't-fail-the-job contract)", async () => {
    const ids = await seedSite();
    await seedKeyword(ids, { trackLocalPack: true });
    const db = getTestDb();
    const provider = makeSerpTaskProvider([
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ]);
    vi.spyOn(provider, 'checkLocalPackRank').mockRejectedValue(new Error('vendor down'));
    const processor = createRankProcessor({
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    });
    const outcome = await processor(jobFor(payloadFor(ids)));
    // The organic check still completed and persisted despite the local-pack failure.
    expect(outcome.positions).toEqual([1]);
    expect(outcome.errors).toBe(0);
    const rows = await db.select().from(localPackRankSnapshotsTable);
    expect(rows).toHaveLength(0);
    const organicRows = await db.select().from(rankingsTable);
    expect(organicRows).toHaveLength(1);
  });

  function deps(db: ReturnType<typeof getTestDb>, provider: SerpTaskProvider) {
    return {
      provider,
      db: db as unknown as never,
      cache: createSerpCacheRepo({ db: db as unknown as never, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db as unknown as never),
      clock: () => new Date('2026-07-05T00:00:00.000Z'),
      logger,
    };
  }

  it('archives the maps call per account when an archiver is wired (superadmin ledger)', async () => {
    const ids = await seedSite();
    await seedKeyword(ids, { trackLocalPack: true });
    const db = getTestDb();
    const provider = makeSerpTaskProvider([
      {
        domain: 'example.com',
        url: 'https://example.com/',
        rankGroup: 1,
        rankAbsolute: 1,
      },
    ]);
    const archive = vi.fn(async () => {});
    const processor = createRankProcessor({
      ...deps(db, provider),
      archive,
    });
    await processor(jobFor(payloadFor(ids)));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'rank',
        operation: 'local-pack',
        accountId: ids.accountId,
        // Fakes never report an envelope cost → null (estimate fallback).
        costMicros: null,
        params: {
          keyword: 'plumber austin',
          domain: 'example.com',
          locationCode: 2840,
          languageCode: 'en',
        },
      }),
    );
  });
});

describe('altEngineWeeklyStamp', () => {
  it('floors any instant to Monday 00:00 UTC of its ISO week', () => {
    expect(altEngineWeeklyStamp(new Date('2026-07-08T15:30:00.000Z')).toISOString()).toBe(
      '2026-07-06T00:00:00.000Z',
    );
    // Sunday belongs to the week that started six days earlier.
    expect(altEngineWeeklyStamp(new Date('2026-07-12T23:59:59.000Z')).toISOString()).toBe(
      '2026-07-06T00:00:00.000Z',
    );
    expect(altEngineWeeklyStamp(new Date('2026-07-06T00:00:00.000Z')).toISOString()).toBe(
      '2026-07-06T00:00:00.000Z',
    );
  });
});
