/**
 * Unit tests for keywords.service branches that require the real PGlite
 * harness — kept out of keywords.routes.test.ts because they poke the
 * service directly rather than the HTTP surface.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  keywords as keywordsTable,
  rankings as rankingsTable,
} from '../../db/schema/keywords.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { Site } from '../sites/index.js';
import {
  CLIENT_REPORT_RANK_ROW_LIMIT,
  getKeywordHistoryBatch,
  hasOwnedKeywordRowsForSite,
  HISTORY_MAX_POINTS,
  keywordsServiceTestables,
  readClientReportRankProjection,
  readClientReportRankRows,
  resolveOwnedKeywordSiteId,
} from './keywords.service.js';

describe('isUniqueViolation (shared re-import)', () => {
  it('classifies 23505 as unique-violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('classifies unrelated codes as non-unique-violation', () => {
    expect(isUniqueViolation({ code: '42P01' })).toBe(false);
  });
});

describe('getKeywordHistoryBatch — branch coverage', () => {
  beforeAll(async () => {
    await Promise.all([startTestPostgres(), startMemoryMongo()]);
  });
  afterAll(async () => {
    await Promise.all([stopTestPostgres(), stopMemoryMongo()]);
  });
  beforeEach(async () => {
    await Promise.all([truncateAllTables(), clearCollections()]);
  });

  it('returns scoped not-found errors when a valid site id disappears before either ownership read', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = new mongoose.Types.ObjectId().toHexString();

    await expect(keywordsServiceTestables.assertSiteOwnership(accountId, siteId)).rejects.toMatchObject({
      status: 404,
      message: 'sites.errors.notFound',
    });
    await expect(keywordsServiceTestables.getOwnedSiteDomain(accountId, siteId)).rejects.toMatchObject({
      status: 404,
      message: 'sites.errors.notFound',
    });
  });

  it('blocks keyword spend entry points for a paused owned site', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      url: 'https://paused.example',
      domain: 'paused.example',
      paused: true,
      pausedAt: new Date('2026-08-14T00:00:00.000Z'),
    });

    await expect(
      keywordsServiceTestables.assertSiteNotPausedById(accountId, site.id as string),
    ).rejects.toMatchObject({
      status: 409,
      message: 'sites.errors.paused',
    });
  });

  it('rejects malformed keyword ids before querying and detects stored scoped rows', async () => {
    const db = getTestDb();
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = new mongoose.Types.ObjectId().toHexString();

    await expect(resolveOwnedKeywordSiteId(accountId, 'not-a-uuid', db)).resolves.toBeNull();
    await expect(hasOwnedKeywordRowsForSite(accountId, siteId, db)).resolves.toBe(false);

    await db.insert(keywordsTable).values({
      accountId,
      siteId,
      phrase: 'stored row',
      locationCode: 1,
      languageCode: 'en',
      device: 'desktop',
    });
    await expect(hasOwnedKeywordRowsForSite(accountId, siteId, db)).resolves.toBe(true);
  });

  it('short-circuits on an empty id list without touching the database', async () => {
    // No ownership fan-out is issued at all — a `null` db proves the early
    // return happens before the first query.
    const result = await getKeywordHistoryBatch(
      { accountId: new mongoose.Types.ObjectId().toHexString(), keywordIds: [] },
      { db: null as unknown as never, ranksQueue: null },
    );
    expect(result).toEqual([]);
  });

  it('returns [] when none of the requested ids belong to the caller (ownedIds empty)', async () => {
    const db = getTestDb();
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const foreign = new mongoose.Types.ObjectId().toHexString();
    // Seed a keyword owned by `foreign`; ask as `accountId` — ownership fan-out
    // must drop everything, hitting the `ownedIds.length === 0` early return.
    const [row] = await db
      .insert(keywordsTable)
      .values({
        accountId: foreign,
        siteId: new mongoose.Types.ObjectId().toHexString(),
        phrase: 'not mine',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const result = await getKeywordHistoryBatch(
      { accountId, keywordIds: [row!.id] },
      { db: db as unknown as never, ranksQueue: null },
    );
    expect(result).toEqual([]);
  });

  it('caps per-keyword series length at HISTORY_MAX_POINTS in the batch path', async () => {
    const db = getTestDb();
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = new mongoose.Types.ObjectId().toHexString();
    const [kw] = await db
      .insert(keywordsTable)
      .values({
        accountId,
        siteId,
        phrase: 'cap',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      })
      .returning();
    const anchor = new Date('2026-07-01T00:00:00Z');
    const overCap = HISTORY_MAX_POINTS + 20;
    await db.insert(rankingsTable).values(
      Array.from({ length: overCap }, (_, i) => ({
        keywordId: kw!.id,
        position: (i % 100) + 1,
        source: 'fresh' as const,
        checkedAt: new Date(anchor.getTime() - (overCap - i) * 24 * 60 * 60 * 1000),
      })),
    );
    const result = await getKeywordHistoryBatch(
      { accountId, keywordIds: [kw!.id], from: '2020-01-01T00:00:00.000Z' },
      { db: db as unknown as never, ranksQueue: null },
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.series.length).toBe(HISTORY_MAX_POINTS);
  });

  it('projects the latest stored observation per active keyword for client reports', async () => {
    const db = getTestDb();
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      url: 'https://report.example',
      domain: 'report.example',
    });
    const siteId = site.id as string;
    const phrases = Array.from({ length: CLIENT_REPORT_RANK_ROW_LIMIT + 1 }, (_, i) => `phrase ${i}`);
    const rows = await db
      .insert(keywordsTable)
      .values([
        ...phrases,
        'never observed',
        'inactive keyword',
      ].map((phrase) => ({
        accountId,
        siteId,
        phrase,
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop' as const,
        active: phrase !== 'inactive keyword',
      })))
      .returning();
    const byPhrase = new Map(rows.map((row) => [row.phrase, row.id]));
    await db.insert(rankingsTable).values([
      ...phrases.map((phrase, i) => ({
        keywordId: byPhrase.get(phrase)!,
        position: i + 1,
        source: 'fresh' as const,
        checkedAt: new Date(Date.UTC(2026, 7, 1, 0, i)),
      })),
      {
        keywordId: byPhrase.get('phrase 0')!,
        position: 40,
        source: 'fresh' as const,
        checkedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        keywordId: byPhrase.get('inactive keyword')!,
        position: 1,
        source: 'fresh' as const,
        checkedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    const projection = await readClientReportRankProjection(accountId, siteId, db as never);

    expect(projection.totalRows).toBe(CLIENT_REPORT_RANK_ROW_LIMIT + 1);
    expect(projection.rows).toHaveLength(CLIENT_REPORT_RANK_ROW_LIMIT);
    expect(projection.rows[0]).toEqual({
      keyword: `phrase ${CLIENT_REPORT_RANK_ROW_LIMIT}`,
      engine: 'google',
      position: CLIENT_REPORT_RANK_ROW_LIMIT + 1,
      checkedAt: new Date(Date.UTC(2026, 7, 1, 0, CLIENT_REPORT_RANK_ROW_LIMIT)).toISOString(),
    });
    expect(projection.rows.map((row) => row.keyword)).not.toContain('phrase 0');
    await expect(readClientReportRankRows(accountId, siteId, db as never)).resolves.toEqual(
      projection.rows,
    );
    await expect(
      readClientReportRankRows(new mongoose.Types.ObjectId().toHexString(), siteId, db as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
