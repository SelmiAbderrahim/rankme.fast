import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import {
  keywords as keywordsTable,
  rankings as rankingsTable,
} from '../../db/schema/keywords.js';
import {
  createFakeRankProvider,
  type RankProvider,
} from '../../shared/providers/index.js';
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
import { Site } from '../sites/index.js';
import {
  createPostgresRankTargetsResolver,
  createRankProcessor,
} from './rank.processor.js';
import { createSerpCacheRepo } from './serp-cache.service.js';

const logger = pino({ level: 'silent' });

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

async function seedProcessorSite(): Promise<{ accountId: string; siteId: string }> {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
  });
  return { accountId: accountId.toHexString(), siteId: site.id as string };
}

async function seedKeyword(
  ids: { accountId: string; siteId: string },
  engine: 'bing' | 'google' = 'bing',
) {
  const rows = await getTestDb()
    .insert(keywordsTable)
    .values({
      accountId: ids.accountId,
      siteId: ids.siteId,
      phrase: 'processor coverage phrase',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine,
    })
    .returning();
  return rows[0]!;
}

function payloadFor(ids: { accountId: string; siteId: string }) {
  return { ...ids, keywordIds: [], schedulerKey: 'manual', manual: true };
}

function makeProcessor(provider: RankProvider = createFakeRankProvider()) {
  const db = getTestDb() as unknown as never;
  return createRankProcessor({
    provider,
    db,
    cache: createSerpCacheRepo({ db, ttlHours: 24 }),
    resolveTargets: createPostgresRankTargetsResolver(db),
    logger,
  });
}

function wrapReturningWithoutId(builder: object): object {
  return new Proxy(builder, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (property === 'returning') {
        return async (...args: unknown[]) => {
          await Reflect.apply(value, target, args);
          return [{}];
        };
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return typeof result === 'object' && result !== null
          ? wrapReturningWithoutId(result)
          : result;
      };
    },
  });
}

/** Simulates a broken repository RETURNING projection after a successful insert. */
function dbWithMissingReturnedRankingId(): Db {
  const db = getTestDb();
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'insert') {
        return (table: unknown) => {
          const builder = target.insert(table as never);
          return table === rankingsTable ? wrapReturningWithoutId(builder) : builder;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as Db;
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
  (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = true;
  vi.restoreAllMocks();
});

describe('rank processor alt-engine rollout coverage', () => {
  it('finishes an alt-engine job accepted before the feature is disabled', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids);
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkAltEngineRank');
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = false;

    const outcome = await makeProcessor(provider)(
      jobFor({ ...payloadFor(ids), altEnginesEnabledAtEnqueue: true }),
    );

    expect(outcome).toMatchObject({ checked: 1, skipped: 0, errors: 0 });
    expect(check).toHaveBeenCalledTimes(1);
    const rows = await getTestDb().select().from(rankingsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keywordId).toBe(keyword.id);
  });

  it('excludes alt-engine targets from a job enqueued while the feature was off', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids);
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkAltEngineRank');

    const outcome = await makeProcessor(provider)(
      jobFor({ ...payloadFor(ids), altEnginesEnabledAtEnqueue: false }),
    );

    expect(outcome).toMatchObject({ checked: 0, skipped: 0, errors: 0 });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('rank processor defensive rank-drop coverage', () => {
  it('fails closed when an inserted ranking is returned without its identifier', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    await getTestDb().insert(rankingsTable).values({
      keywordId: keyword.id,
      position: 3,
      rankAbsolute: 3,
      foundUrl: 'https://example.com/previous',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      source: 'fresh',
    });
    const db = dbWithMissingReturnedRankingId();
    const confirmRankDrop = vi.fn(async () => undefined);
    const processor = createRankProcessor({
      provider: createFakeRankProvider({
        result: {
          position: 12,
          foundUrl: 'https://example.com/current',
          checkedAt: new Date('2026-01-08T12:00:00.000Z'),
        },
      }),
      db,
      resolveTargets: async ({ domain }) => [
        {
          keywordId: keyword.id,
          input: {
            keyword: keyword.phrase,
            domain,
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
            device: keyword.device,
          },
          engine: 'google',
          engineTarget: null,
        },
      ],
      logger,
      clock: () => new Date('2026-01-08T12:00:00.000Z'),
      confirmRankDrop,
    });

    await expect(processor(jobFor(payloadFor(ids)))).resolves.toMatchObject({ checked: 1 });
    expect(confirmRankDrop).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(rankingsTable)).toHaveLength(2);
  });
});
