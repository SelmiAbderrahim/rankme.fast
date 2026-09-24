/**
 * Geogrid service unit tests — the seams the HTTP suite cannot reach:
 * the holder guard, the scan-write failure path, and the pure helpers.
 */
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { geogridScans } from '../../db/schema/geogrid.js';
import { keywords } from '../../db/schema/keywords.js';
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
import { runGeogridScan } from './geogrid.processor.js';
import { getGeogridDb, getGeogridQueue, setGeogridDb, setGeogridQueue } from './geogrid.holder.js';
import {
  addCostMicros,
  buildCellDtos,
  createGeogridScan,
  listGeogridScans,
  resolveTerminalStatus,
} from './geogrid.service.js';
import { logger } from '../../config/logger.js';
import type { RankProvider } from '../../shared/providers/types.js';

const ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

describe('geogrid holder', () => {
  afterEach(() => {
    setGeogridDb(null);
    setGeogridQueue(null);
  });

  it('throws a loud error when the db was never injected', () => {
    setGeogridDb(null);
    expect(() => getGeogridDb()).toThrow('geogrid db not configured');
  });

  it('returns null for a queue that was never injected', () => {
    expect(getGeogridQueue()).toBeNull();
  });
});

describe('geogrid pure helpers', () => {
  it('resolveTerminalStatus follows the pinned outcome matrix', () => {
    expect(resolveTerminalStatus(9, 9)).toBe('completed');
    expect(resolveTerminalStatus(9, 5)).toBe('completed_partial');
    expect(resolveTerminalStatus(9, 0)).toBe('failed');
  });

  it('addCostMicros ignores an unreported vendor cost', () => {
    expect(addCostMicros(4_000n, null)).toBe(4_000n);
    expect(addCostMicros(4_000n, 2_000n)).toBe(6_000n);
  });

  it('buildCellDtos omits a cell that has neither an observation nor a failure', () => {
    const cells = buildCellDtos(
      {
        centerLat: 0,
        centerLng: 0,
        spacingMeters: 1_000,
        gridSize: 3,
        zoom: 17,
        failedPointIndexes: [],
      },
      [],
    );
    expect(cells).toEqual([]);
  });
});

describe('geogrid create + reads', () => {
  let siteId: string;
  let keywordId: string;

  beforeAll(async () => {
    await startMemoryMongo();
    await startTestPostgres();
  });

  afterAll(async () => {
    (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = false;
    await stopTestPostgres();
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
    (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = true;
    const site = await Site.create({
      accountId: ACCOUNT,
      url: 'https://geogrid-service.example',
      domain: 'geogrid-service.example',
    });
    siteId = String(site._id);
    const [keyword] = await getTestDb()
      .insert(keywords)
      .values({
        accountId: ACCOUNT,
        siteId,
        phrase: 'dentist austin',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        engine: 'google',
      })
      .returning({ id: keywords.id });
    keywordId = keyword!.id;
  });

  const definition = {
    centerLat: 30.2672,
    centerLng: -97.7431,
    spacingMeters: 1_000,
    gridSize: 3 as const,
    zoom: 17,
  };

  it('propagates a scan row write failure without enqueueing', async () => {
    const realDb = getTestDb() as unknown as Record<string, unknown>;
    const add = vi.fn();
    const proxyDb = new Proxy(realDb, {
      get(target, property, receiver) {
        if (property === 'insert') {
          return (table: unknown) => {
            if (table === geogridScans) throw new Error('scan insert exploded');
            return (target.insert as (t: unknown) => unknown).call(target, table);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as never;

    await expect(
      createGeogridScan(
        ACCOUNT,
        siteId,
        { ...definition, keywordId },
        { db: proxyDb, queue: { add } as unknown as Queue },
      ),
    ).rejects.toThrow('scan insert exploded');
    expect(add).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(geogridScans)).toHaveLength(0);
  });

  it('stamps the scan with an injected clock when one is supplied', async () => {
    const pinned = new Date('2026-08-02T09:00:00.000Z');
    const created = await createGeogridScan(
      ACCOUNT,
      siteId,
      { ...definition, keywordId },
      {
        db: getTestDb() as never,
        queue: { add: vi.fn() } as unknown as Queue,
        now: () => pinned,
      },
    );
    const rows = await getTestDb()
      .select()
      .from(geogridScans)
      .where(eq(geogridScans.id, created.scanId));
    expect(rows[0]!.createdAt.toISOString()).toBe(pinned.toISOString());
  });

  it('the processor uses a real clock when no test clock is injected', async () => {
    const created = await createGeogridScan(
      ACCOUNT,
      siteId,
      { ...definition, keywordId },
      { db: getTestDb() as never, queue: { add: vi.fn() } as unknown as Queue },
    );
    const rank = {
      async checkLocalPackRank() {
        return { position: 1, totalPackSize: 3, checkedAt: new Date() };
      },
    } as unknown as RankProvider;
    await runGeogridScan(
      { accountId: ACCOUNT, siteId, scanId: created.scanId },
      { db: getTestDb() as never, rank, logger },
    );
    const rows = await getTestDb()
      .select()
      .from(geogridScans)
      .where(eq(geogridScans.id, created.scanId));
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.finishedAt).toBeInstanceOf(Date);
  });

  // The HTTP suite can never reach this branch: `siteMutationLease` answers
  // 404 for an unowned or missing site before the router runs. The service
  // guard is the defence-in-depth layer for every non-HTTP caller.
  it('refuses a well-formed site id that this account does not own', async () => {
    await expect(
      listGeogridScans(
        ACCOUNT,
        '6a6fa7c28d75c2fd32d84a99',
        { limit: 10 },
        { db: getTestDb() as never },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id without touching Mongo', async () => {
    await expect(
      listGeogridScans(ACCOUNT, 'not-an-id', { limit: 10 }, { db: getTestDb() as never }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
