/**
 * Geogrid processor tests (community-requests spec 09 §4.2, §4.3, §5).
 *
 * Covers the pinned outcome matrix — completed / completed_partial / failed —
 * the bounded fan-out, the durable cell claims, and the per-cell vendor cost
 * rollup.
 */
import { eq } from 'drizzle-orm';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { geogridScans, geogridSnapshots } from '../../db/schema/geogrid.js';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
import { VendorUnavailableError } from '../../shared/providers/errors.js';
import type { LocalPackCheckInput, RankProvider } from '../../shared/providers/types.js';
import { logger } from '../../config/logger.js';
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
  GEOGRID_CELL_BATCH_SIZE,
  GEOGRID_FAILURE_REASONS,
  chunkCells,
  createGeogridProcessor,
  onGeogridJobExhausted,
  runGeogridScan,
  type GeogridProcessorDeps,
} from './geogrid.processor.js';

const ACCOUNT = '6a6fa7c28d75c2fd32d84a63';
const CAPTURED_AT = new Date('2026-08-02T09:00:00.000Z');
/** Vendor-reported USD per Maps `live/advanced` page — dataforseo-pricing.md §CR-5. */
const MAPS_PAGE_USD = 0.002;
/** The same page price in micros USD, as the cost capture records it. */
const MAPS_PAGE_MICROS = 2_000n;

let siteId: string;

interface StubOptions {
  /** Point indexes (in visit order) whose vendor call rejects. */
  failEvery?: (input: LocalPackCheckInput, callIndex: number) => boolean;
  /** Deterministic position per call; `null` = not in the pack. */
  positionFor?: (callIndex: number) => number | null;
  recordCost?: boolean;
}

interface Stub {
  rank: RankProvider;
  calls: LocalPackCheckInput[];
  maxConcurrent: number;
}

function stubRank(options: StubOptions = {}): Stub {
  const calls: LocalPackCheckInput[] = [];
  let inFlight = 0;
  const state = { maxConcurrent: 0 };
  const rank = {
    async checkLocalPackRank(input: LocalPackCheckInput) {
      const callIndex = calls.length;
      calls.push(input);
      inFlight += 1;
      state.maxConcurrent = Math.max(state.maxConcurrent, inFlight);
      // Yield so genuinely-parallel calls overlap and the concurrency ceiling
      // is observable.
      await Promise.resolve();
      try {
        if (options.failEvery?.(input, callIndex)) {
          throw new VendorUnavailableError('stub cell failure', {
            provider: 'stub',
            operation: 'serp-google-maps-live-advanced',
          });
        }
        if (options.recordCost !== false) recordVendorCostUsd(MAPS_PAGE_USD);
        return {
          position: options.positionFor ? options.positionFor(callIndex) : 2,
          totalPackSize: 5,
          checkedAt: CAPTURED_AT,
        };
      } finally {
        inFlight -= 1;
      }
    },
  } as unknown as RankProvider;
  return {
    rank,
    calls,
    get maxConcurrent() {
      return state.maxConcurrent;
    },
  };
}

function deps(stub: Stub, overrides: Partial<GeogridProcessorDeps> = {}): GeogridProcessorDeps {
  return {
    db: getTestDb() as never,
    rank: stub.rank,
    logger,
    now: () => CAPTURED_AT,
    ...overrides,
  };
}

function dbWithoutProgressScanRow(): GeogridProcessorDeps['db'] {
  const realDb = getTestDb() as unknown as Record<string, unknown>;
  return new Proxy(realDb, {
    get(target, property, receiver) {
      if (property === 'select') {
        return (...args: unknown[]) => {
          const fields = args[0] as Record<string, unknown> | undefined;
          if (fields && 'attemptedPointIndexes' in fields && 'costMicros' in fields) {
            return {
              from: () => ({
                where: () => ({
                  limit: async () => [],
                }),
              }),
            };
          }
          return (target.select as (...selectArgs: unknown[]) => unknown).apply(target, args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as GeogridProcessorDeps['db'];
}

async function seedScan(
  overrides: Partial<typeof geogridScans.$inferInsert> = {},
): Promise<string> {
  const gridSize = (overrides.gridSize as number | undefined) ?? 3;
  const rows = await getTestDb()
    .insert(geogridScans)
    .values({
      accountId: ACCOUNT,
      siteId,
      keywordId: '11111111-1111-4111-8111-111111111111',
      keyword: 'dentist austin',
      languageCode: 'en',
      centerLat: 30.2672,
      centerLng: -97.7431,
      spacingMeters: 1_000,
      gridSize,
      zoom: 17,
      status: 'queued',
      totalCells: gridSize * gridSize,
      ...overrides,
    })
    .returning({ id: geogridScans.id });
  return rows[0]!.id;
}

async function readScan(scanId: string) {
  const rows = await getTestDb()
    .select()
    .from(geogridScans)
    .where(eq(geogridScans.id, scanId));
  return rows[0]!;
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
  const site = await Site.create({
    accountId: ACCOUNT,
    url: 'https://geogrid.example',
    domain: 'geogrid.example',
  });
  siteId = String(site._id);
});

describe('chunkCells', () => {
  it('splits into bounded batches with a short tail', () => {
    const cells = Array.from({ length: 7 }, (_, index) => ({
      pointIndex: index,
      row: 0,
      col: index,
      lat: 0,
      lng: 0,
    }));
    expect(chunkCells(cells, 3).map((batch) => batch.length)).toEqual([3, 3, 1]);
    expect(chunkCells([], 3)).toEqual([]);
  });
});

describe('geogrid processor — completed', () => {
  it('persists one snapshot per cell and sums the per-cell vendor cost', async () => {
    const scanId = await seedScan();
    const stub = stubRank();
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));

    const scan = await readScan(scanId);
    expect(scan).toMatchObject({
      status: 'completed',
      observedCells: 9,
      notInPackCells: 0,
      failedCells: 0,
      failedPointIndexes: [],
    });
    expect(scan.startedAt).not.toBeNull();
    expect(scan.finishedAt).not.toBeNull();
    // The pinned §5 identity: 9 cells × the Maps page price.
    expect(scan.costMicros).toBe(9n * MAPS_PAGE_MICROS);
    const snapshots = await getTestDb()
      .select()
      .from(geogridSnapshots)
      .where(eq(geogridSnapshots.scanId, scanId));
    expect(snapshots).toHaveLength(9);
    expect(new Set(snapshots.map((row) => row.pointIndex)).size).toBe(9);
  });

  it('uses the server clock when processor wiring does not inject one', async () => {
    const scanId = await seedScan();
    const before = Date.now();

    await runGeogridScan(
      { accountId: ACCOUNT, siteId, scanId },
      deps(stubRank(), { now: undefined }),
    );

    const scan = await readScan(scanId);
    expect(scan.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(scan.finishedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('a 7×7 scan sums exactly 49 Maps page prices', async () => {
    const scanId = await seedScan({ gridSize: 7, totalCells: 49 });
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stubRank()));
    const scan = await readScan(scanId);
    expect(scan.costMicros).toBe(49n * MAPS_PAGE_MICROS);
    expect(scan.costMicros).toBe(98_000n);
    expect(scan.status).toBe('completed');
  });

  it('posts a coordinate target for every cell and never a location code', async () => {
    const scanId = await seedScan();
    const stub = stubRank();
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));
    expect(stub.calls).toHaveLength(9);
    for (const call of stub.calls) {
      expect(call.locationCode).toBeUndefined();
      expect(call.coordinate).toMatchObject({ zoom: 17 });
      expect(call.domain).toBe('geogrid.example');
      expect(call.languageCode).toBe('en');
    }
  });

  it('never runs more than the batch size concurrently', async () => {
    const scanId = await seedScan({ gridSize: 7, totalCells: 49 });
    const stub = stubRank();
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));
    expect(stub.maxConcurrent).toBeLessThanOrEqual(GEOGRID_CELL_BATCH_SIZE);
    expect(stub.maxConcurrent).toBeGreaterThan(1);
  });

  it('honours an injected smaller batch size', async () => {
    const scanId = await seedScan();
    const stub = stubRank();
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub, { batchSize: 2 }));
    expect(stub.maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('counts a vendor answer without the domain as not-in-pack, not as a failure', async () => {
    const scanId = await seedScan();
    const stub = stubRank({ positionFor: (index) => (index % 2 === 0 ? 3 : null) });
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));
    const scan = await readScan(scanId);
    expect(scan.status).toBe('completed');
    expect(scan.observedCells + scan.notInPackCells).toBe(9);
    expect(scan.failedCells).toBe(0);
  });

  it('records nothing extra when the provider reports no vendor cost', async () => {
    const scanId = await seedScan();
    await runGeogridScan(
      { accountId: ACCOUNT, siteId, scanId },
      deps(stubRank({ recordCost: false })),
    );
    expect((await readScan(scanId)).costMicros).toBe(0n);
  });

  it('resumes from durable cell claims without repeating a paid request', async () => {
    const scanId = await seedScan({
      status: 'running',
      attemptedPointIndexes: [0],
      startedAt: CAPTURED_AT,
    });
    await getTestDb().insert(geogridSnapshots).values({
      scanId,
      accountId: ACCOUNT,
      siteId,
      keywordId: '11111111-1111-4111-8111-111111111111',
      pointIndex: 0,
      lat: 30.2672,
      lng: -97.7431,
      position: 1,
      totalPackSize: 5,
      capturedAt: CAPTURED_AT,
    });
    const stub = stubRank();

    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));

    expect(stub.calls).toHaveLength(8);
    expect(await readScan(scanId)).toMatchObject({
      status: 'completed',
      observedCells: 9,
      failedCells: 0,
    });
  });

  it('coordinates overlapping deliveries through atomic cell claims', async () => {
    const scanId = await seedScan();
    const calls: LocalPackCheckInput[] = [];
    let releaseChecks = (): void => undefined;
    const checksMayFinish = new Promise<void>((resolve) => {
      releaseChecks = resolve;
    });
    const rank = {
      async checkLocalPackRank(input: LocalPackCheckInput) {
        calls.push(input);
        await checksMayFinish;
        return { position: 2, totalPackSize: 5, checkedAt: CAPTURED_AT };
      },
    } as unknown as RankProvider;
    const processorDeps: GeogridProcessorDeps = {
      db: getTestDb() as never,
      rank,
      logger,
      now: () => CAPTURED_AT,
      batchSize: 5,
    };

    const first = runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, processorDeps);
    let second: Promise<void> | null = null;
    try {
      await vi.waitFor(() => expect(calls).toHaveLength(5), { timeout: 5_000 });
      second = runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, processorDeps);
      await vi.waitFor(() => expect(calls).toHaveLength(9), { timeout: 5_000 });
    } finally {
      releaseChecks();
    }
    await Promise.all([first, ...(second ? [second] : [])]);

    expect(calls).toHaveLength(9);
    const snapshots = await getTestDb()
      .select()
      .from(geogridSnapshots)
      .where(eq(geogridSnapshots.scanId, scanId));
    expect(snapshots).toHaveLength(9);
    expect(new Set(snapshots.map((row) => row.pointIndex)).size).toBe(9);
  });
});

describe('geogrid processor — partial failure', () => {
  it('settles a claimed cell without a snapshot as failed instead of dispatching it twice', async () => {
    const scanId = await seedScan({
      status: 'running',
      attemptedPointIndexes: [0],
      startedAt: CAPTURED_AT,
    });
    const stub = stubRank();

    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));

    expect(stub.calls).toHaveLength(8);
    expect(await readScan(scanId)).toMatchObject({
      status: 'completed_partial',
      observedCells: 8,
      failedCells: 1,
      failedPointIndexes: [0],
    });
  });

  it('marks failed points and never writes a snapshot for them', async () => {
    const scanId = await seedScan();
    const stub = stubRank({ failEvery: (_input, index) => index % 3 === 0 });
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));

    const scan = await readScan(scanId);
    expect(scan.status).toBe('completed_partial');
    expect(scan.failedCells).toBe(3);
    expect(scan.failedPointIndexes).toHaveLength(3);
    expect(scan.observedCells + scan.notInPackCells).toBe(6);
    expect(scan.failureReason).toBeNull();

    const snapshots = await getTestDb()
      .select()
      .from(geogridSnapshots)
      .where(eq(geogridSnapshots.scanId, scanId));
    expect(snapshots).toHaveLength(6);
    const snapshotIndexes = new Set(snapshots.map((row) => row.pointIndex));
    for (const failedIndex of scan.failedPointIndexes) {
      expect(snapshotIndexes.has(failedIndex)).toBe(false);
    }
    // The observed and failed sets partition every cell of the grid.
    expect(snapshotIndexes.size + scan.failedPointIndexes.length).toBe(scan.totalCells);
  });
});

describe('geogrid processor — total failure', () => {
  it('fails the scan when every cell fails', async () => {
    const scanId = await seedScan();
    const stub = stubRank({ failEvery: () => true });
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));

    const scan = await readScan(scanId);
    expect(scan).toMatchObject({
      status: 'failed',
      failedCells: 9,
      observedCells: 0,
      notInPackCells: 0,
      failureReason: GEOGRID_FAILURE_REASONS.allCellsFailed,
    });
  });

  it('a replay after an all-fail scan never re-dispatches a cell', async () => {
    const scanId = await seedScan();
    const stub = stubRank({ failEvery: () => true });
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));
    // Second delivery of the same job: the scan is terminal, so it short-circuits.
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));
    expect(stub.calls).toHaveLength(9);
  });

  it('a vanished site fails the scan before any cell', async () => {
    const scanId = await seedScan();
    await Site.deleteMany({});
    const stub = stubRank();
    await runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stub));
    const scan = await readScan(scanId);
    expect(scan).toMatchObject({
      status: 'failed',
      failureReason: GEOGRID_FAILURE_REASONS.siteMissing,
    });
    expect(stub.calls).toHaveLength(0);
  });

  it('a persistence failure on the first batch fails the scan, because nothing was retained', async () => {
    const scanId = await seedScan();
    const failingInsert = vi
      .spyOn(getTestDb() as unknown as { insert: (table: unknown) => unknown }, 'insert')
      .mockImplementationOnce(() => {
        throw new Error('insert exploded');
      });
    await expect(
      runGeogridScan({ accountId: ACCOUNT, siteId, scanId }, deps(stubRank())),
    ).rejects.toThrow('insert exploded');
    failingInsert.mockRestore();
    const scan = await readScan(scanId);
    expect(scan.status).toBe('failed');
    expect(scan.failureReason).toBe(GEOGRID_FAILURE_REASONS.processing);
  });

  it('a persistence failure after a retained batch settles completed_partial', async () => {
    const scanId = await seedScan();
    // Drive the second-batch failure through a db proxy that forwards
    // everything except the second `insert` call.
    const realDb = getTestDb() as unknown as Record<string, unknown>;
    let seen = 0;
    const proxyDb = new Proxy(realDb, {
      get(target, property, receiver) {
        if (property === 'insert') {
          return (table: unknown) => {
            seen += 1;
            if (seen === 2) throw new Error('second insert exploded');
            return (target.insert as (t: unknown) => unknown).call(target, table);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as GeogridProcessorDeps['db'];

    await expect(
      runGeogridScan(
        { accountId: ACCOUNT, siteId, scanId },
        { ...deps(stubRank()), db: proxyDb, batchSize: 3 },
      ),
    ).rejects.toThrow('second insert exploded');
    const scan = await readScan(scanId);
    expect(scan.status).toBe('completed_partial');
    expect(scan.failureReason).toBe(GEOGRID_FAILURE_REASONS.processing);
    expect(scan.observedCells).toBe(3);
  });
});

describe('geogrid processor — job plumbing', () => {
  it('an unknown or foreign scan id is a no-op', async () => {
    const stub = stubRank();
    await runGeogridScan(
      {
        accountId: ACCOUNT,
        siteId,
        scanId: '00000000-0000-4000-8000-0000000000aa',
      },
      deps(stub),
    );
    expect(stub.calls).toHaveLength(0);
    const foreignScanId = await seedScan();
    await runGeogridScan(
      { accountId: new mongoose.Types.ObjectId().toString(), siteId, scanId: foreignScanId },
      deps(stub),
    );
    expect(stub.calls).toHaveLength(0);
  });

  it('the processor factory parses the payload before running', async () => {
    const scanId = await seedScan();
    const stub = stubRank();
    const processor = createGeogridProcessor(deps(stub));
    await processor({ data: { accountId: ACCOUNT, siteId, scanId } } as never, 'token' as never);
    expect(stub.calls).toHaveLength(9);
    await expect(
      processor({ data: { accountId: ACCOUNT, siteId, scanId: 'nope' } } as never, 'token' as never),
    ).rejects.toThrow();
  });
});

describe('geogrid processor — dead letter', () => {
  it('ignores a malformed payload', async () => {
    await expect(
      onGeogridJobExhausted({ data: { nope: true } } as never, { db: getTestDb() as never }),
    ).resolves.toBeUndefined();
  });

  it('ignores an already-terminal scan', async () => {
    const scanId = await seedScan({ status: 'completed', observedCells: 9 });
    await onGeogridJobExhausted(
      { data: { accountId: ACCOUNT, siteId, scanId } } as never,
      { db: getTestDb() as never },
    );
    expect((await readScan(scanId)).status).toBe('completed');
  });

  it('ignores a scan that no longer exists', async () => {
    await expect(
      onGeogridJobExhausted(
        {
          data: {
            accountId: ACCOUNT,
            siteId,
            scanId: '00000000-0000-4000-8000-0000000000bb',
          },
        } as never,
        { db: getTestDb() as never },
      ),
    ).resolves.toBeUndefined();
    expect(await getTestDb().select().from(geogridScans)).toHaveLength(0);
  });

  it('fails a stuck scan that retained nothing', async () => {
    const scanId = await seedScan({ status: 'running' });
    await onGeogridJobExhausted(
      { data: { accountId: ACCOUNT, siteId, scanId } } as never,
      { db: getTestDb() as never },
    );
    const scan = await readScan(scanId);
    expect(scan.status).toBe('failed');
  });

  it('settles a stuck scan that already retained a cell as partial', async () => {
    const scanId = await seedScan({
      status: 'running',
      observedCells: 1,
      attemptedPointIndexes: [0],
    });
    await getTestDb().insert(geogridSnapshots).values({
      scanId,
      accountId: ACCOUNT,
      siteId,
      keywordId: '11111111-1111-4111-8111-111111111111',
      pointIndex: 0,
      lat: 30.2672,
      lng: -97.7431,
      position: 1,
      totalPackSize: 5,
      capturedAt: CAPTURED_AT,
    });
    await onGeogridJobExhausted(
      { data: { accountId: ACCOUNT, siteId, scanId } } as never,
      { db: getTestDb() as never },
    );
    const scan = await readScan(scanId);
    expect(scan.status).toBe('completed_partial');
  });

  it('falls back to the loaded scan when the progress-row refresh disappears', async () => {
    const scanId = await seedScan({
      status: 'running',
      attemptedPointIndexes: [0],
      costMicros: 777n,
    });
    await getTestDb().insert(geogridSnapshots).values({
      scanId,
      accountId: ACCOUNT,
      siteId,
      keywordId: '11111111-1111-4111-8111-111111111111',
      pointIndex: 0,
      lat: 30.2672,
      lng: -97.7431,
      position: 1,
      totalPackSize: 5,
      capturedAt: CAPTURED_AT,
    });

    await onGeogridJobExhausted(
      { data: { accountId: ACCOUNT, siteId, scanId } } as never,
      { db: dbWithoutProgressScanRow() },
    );

    expect(await readScan(scanId)).toMatchObject({
      status: 'completed_partial',
      observedCells: 1,
      failedCells: 0,
      failedPointIndexes: [],
      costMicros: 777n,
    });
  });
});
