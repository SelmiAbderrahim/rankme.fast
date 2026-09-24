import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pagePerformanceKeywords,
  pagePerformanceSnapshots,
} from '../../db/schema/page-performance.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  createPagesRepository,
  PAGE_PERFORMANCE_MAX_SNAPSHOTS,
  type WriteSuccessfulPagePerformanceSnapshotInput,
} from './pages.repository.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const PAGE_HASH = 'DxFdsGK3wN0DCxaHjJnepcNUtJ3DezjriEYXnHeD6dc';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

function fingerprint(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function writeInput(
  sequence = 1,
  overrides: Partial<WriteSuccessfulPagePerformanceSnapshotInput> = {},
): WriteSuccessfulPagePerformanceSnapshotInput {
  const observedAt = new Date(`2026-08-${String(sequence).padStart(2, '0')}T00:00:00.000Z`);
  return {
    accountId: 'account-a',
    siteId: 'site-a',
    source: 'dataforseo',
    locationCode: 2840,
    languageCode: 'en',
    observedAt,
    cacheFetchedAt: observedAt,
    cacheStatus: 'miss',
    payloadFingerprint: fingerprint(sequence),
    sourceRowsFetched: 1,
    acceptedCount: 1,
    droppedCount: 0,
    malformedUrlCount: 0,
    offsiteUrlCount: 0,
    duplicateUrlCount: 0,
    invalidMetricCount: 0,
    sourceTruncated: false,
    keywords: [
      {
        pageHash: PAGE_HASH,
        canonicalUrl: 'https://example.com/',
        displayUrl: 'example.com/',
        keyword: `keyword-${sequence}`,
        position: sequence,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
      },
    ],
    ...overrides,
  };
}

describe('Pages repository', () => {
  it('fails closed when a conflict cannot be resolved inside the transaction', async () => {
    const insertQuery = {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    const selectQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const tx = {
      insert: vi.fn().mockReturnValue(insertQuery),
      select: vi.fn().mockReturnValue(selectQuery),
    };
    const db = {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const repository = createPagesRepository(db as never, { now: () => NOW });
    await expect(repository.writeSuccessfulSnapshot(writeInput())).rejects.toThrow(
      'Pages snapshot conflict could not be resolved',
    );
  });

  it('writes atomically, preserves nullable metrics, and makes duplicate payloads idempotent', async () => {
    const repository = createPagesRepository(getTestDb() as never, { now: () => NOW });
    const input = writeInput();
    const first = await repository.writeSuccessfulSnapshot(input);
    const second = await repository.writeSuccessfulSnapshot(input);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.keywords).toHaveLength(1);
    expect(second.keywords[0]).toMatchObject({
      searchVolume: null,
      difficulty: null,
      estimatedTraffic: null,
    });
    expect(await getTestDb().select().from(pagePerformanceSnapshots)).toHaveLength(1);
    expect(await getTestDb().select().from(pagePerformanceKeywords)).toHaveLength(1);
  });

  it('rolls back the parent when a child constraint fails', async () => {
    const repository = createPagesRepository(getTestDb() as never, { now: () => NOW });
    const duplicate = writeInput(2).keywords[0]!;
    await expect(
      repository.writeSuccessfulSnapshot(
        writeInput(2, {
          sourceRowsFetched: 2,
          acceptedCount: 2,
          keywords: [duplicate, duplicate],
        }),
      ),
    ).rejects.toThrow();
    expect(await getTestDb().select().from(pagePerformanceSnapshots)).toEqual([]);
    expect(await getTestDb().select().from(pagePerformanceKeywords)).toEqual([]);
  });

  it('persists a successful empty snapshot and validates coverage before opening a transaction', async () => {
    const repository = createPagesRepository(getTestDb() as never, { now: () => NOW });
    const empty = await repository.writeSuccessfulSnapshot(
      writeInput(3, {
        sourceRowsFetched: 0,
        acceptedCount: 0,
        keywords: [],
      }),
    );
    expect(empty.snapshot.successfulEmpty).toBe(true);
    expect(empty.keywords).toEqual([]);

    await expect(
      repository.writeSuccessfulSnapshot(writeInput(4, { acceptedCount: 0 })),
    ).rejects.toThrow(/coverage/);
    await expect(
      repository.readLatest({
        accountId: '', siteId: 'site', source: 'demo', locationCode: 2840, languageCode: 'en',
      }),
    ).rejects.toThrow(/requires accountId and siteId/);
  });

  it('reads latest, previous, bounded ranges, and details in deterministic tenant scope', async () => {
    const repository = createPagesRepository(getTestDb() as never, { now: () => NOW });
    const first = await repository.writeSuccessfulSnapshot(writeInput(5));
    const second = await repository.writeSuccessfulSnapshot(
      writeInput(6, {
        keywords: [
          {
            ...writeInput(6).keywords[0]!, keyword: 'null-traffic', estimatedTraffic: null,
          },
          {
            ...writeInput(6).keywords[0]!, keyword: 'high-traffic', estimatedTraffic: 20,
            searchVolume: 10,
          },
        ],
        sourceRowsFetched: 2,
        acceptedCount: 2,
      }),
    );
    await repository.writeSuccessfulSnapshot(
      writeInput(7, { accountId: 'account-b', siteId: 'site-a', source: 'demo' }),
    );

    const context = {
      accountId: 'account-a', siteId: 'site-a', source: 'dataforseo' as const,
      locationCode: 2840, languageCode: 'en',
    };
    await expect(repository.readLatest(context)).resolves.toMatchObject({ id: second.snapshot.id });
    await expect(
      repository.readPrevious({
        ...context,
        beforeObservedAt: second.snapshot.observedAt,
        beforeSnapshotId: second.snapshot.id,
      }),
    ).resolves.toMatchObject({ id: first.snapshot.id });
    await expect(
      repository.readRange({
        ...context,
        from: first.snapshot.observedAt,
        to: second.snapshot.observedAt,
        limit: 0,
      }),
    ).resolves.toHaveLength(1);
    const detail = await repository.readKeywords({
      accountId: 'account-a', siteId: 'site-a', snapshotId: second.snapshot.id,
      pageHash: PAGE_HASH, limit: 500,
    });
    expect(detail.map((row) => row.keyword)).toEqual(['high-traffic', 'null-traffic']);
    await expect(repository.readRange({
      ...context,
      from: first.snapshot.observedAt,
      to: second.snapshot.observedAt,
    })).resolves.toHaveLength(2);
    await expect(repository.readKeywords({
      accountId: 'account-a', siteId: 'site-a', snapshotId: second.snapshot.id,
    })).resolves.toHaveLength(2);
    await expect(
      repository.readKeywords({
        accountId: 'account-b', siteId: 'site-a', snapshotId: second.snapshot.id, limit: 0,
      }),
    ).resolves.toEqual([]);
  });

  it('enforces the composite snapshot/account/site foreign key and metric constraints', async () => {
    const db = getTestDb();
    const [snapshot] = await db
      .insert(pagePerformanceSnapshots)
      .values({
        accountId: 'account-a', siteId: 'site-a', source: 'demo', locationCode: 2840,
        languageCode: 'en', observedAt: NOW, cacheFetchedAt: NOW, cacheStatus: 'hit',
        successfulEmpty: true, payloadFingerprint: fingerprint(20), sourceRowsFetched: 0,
        acceptedCount: 0, droppedCount: 0,
      })
      .returning();
    await expect(
      db.insert(pagePerformanceKeywords).values({
        snapshotId: snapshot!.id, accountId: 'account-b', siteId: 'site-a',
        pageHash: PAGE_HASH, canonicalUrl: 'https://example.com/', displayUrl: 'example.com/',
        keyword: 'foreign', position: 1,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(pagePerformanceKeywords).values({
        snapshotId: snapshot!.id, accountId: 'account-a', siteId: 'site-a',
        pageHash: PAGE_HASH, canonicalUrl: 'https://example.com/', displayUrl: 'example.com/',
        keyword: 'invalid', position: Number.NaN,
      }),
    ).rejects.toThrow();
  });

  it('keeps only 180 newest unique snapshots and removes data older than 400 days', async () => {
    const db = getTestDb();
    const repository = createPagesRepository(db as never, { now: () => NOW });
    const seeded = Array.from({ length: 181 }, (_, index) => ({
      accountId: 'account-a',
      siteId: 'site-a',
      source: 'dataforseo' as const,
      locationCode: 2840,
      languageCode: 'en',
      observedAt: new Date(NOW.getTime() - (500 - index) * 24 * 60 * 60 * 1_000),
      cacheFetchedAt: new Date(NOW.getTime() - (500 - index) * 24 * 60 * 60 * 1_000),
      cacheStatus: 'miss' as const,
      successfulEmpty: true,
      payloadFingerprint: fingerprint(1000 + index),
      sourceRowsFetched: 0,
      acceptedCount: 0,
      droppedCount: 0,
    }));
    await db.insert(pagePerformanceSnapshots).values(seeded);
    await repository.writeSuccessfulSnapshot(
      writeInput(8, {
        observedAt: NOW,
        cacheFetchedAt: NOW,
        payloadFingerprint: fingerprint(9999),
      }),
    );
    const [total] = await db
      .select({ value: count() })
      .from(pagePerformanceSnapshots)
      .where(eq(pagePerformanceSnapshots.accountId, 'account-a'));
    expect(Number(total!.value)).toBeLessThanOrEqual(PAGE_PERFORMANCE_MAX_SNAPSHOTS);
    const remaining = await db.select().from(pagePerformanceSnapshots);
    expect(remaining.some((row) => row.observedAt < new Date('2025-07-04T12:00:00.000Z'))).toBe(false);
    expect(remaining.some((row) => row.observedAt.getTime() === NOW.getTime())).toBe(true);
  });
});
