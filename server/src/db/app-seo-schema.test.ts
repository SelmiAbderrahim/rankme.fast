import { readFileSync, readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';
import {
  appChartSnapshots,
  appKeywords,
  appListingSnapshots,
  appRankSnapshots,
  type AppKeywordRow,
  type AppSeoStore,
  type NewAppListingSnapshotRow,
} from './schema/app-seo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  type TestDb,
} from '../shared/testing/postgres.js';
import type { AppInfo } from '../shared/providers/app-data.js';

const ACCOUNT_ID = 'a'.repeat(24);
const SITE_ID = 'b'.repeat(24);
const PROFILE_ID = 'c'.repeat(24);
const OBSERVATION = {
  sourceKind: 'provider_observation' as const,
  sourceLabel: 'dataforseo' as const,
  observedAt: '2026-08-09T12:00:00.000Z',
  freshUntil: null,
  freshness: 'fresh' as const,
  market: null,
  coverageNoteKey: null,
  sampleCount: 1,
};

const LISTING: AppInfo = {
  store: 'app_store',
  appId: '123456789',
  title: 'RankMeFast',
  url: null,
  iconUrl: null,
  description: null,
  rating: null,
  reviewCount: null,
  isFree: null,
  price: null,
  mainCategory: null,
  categories: [],
  installs: null,
  developerName: null,
  developerUrl: null,
  developerWebsite: null,
  version: null,
  minimumOsVersion: null,
  size: null,
  releasedAt: null,
  updatedAt: null,
  updateNotes: null,
  imageUrls: [],
  videoUrls: null,
  languages: [],
  advisories: [],
  tags: null,
  similarApps: [],
  moreByDeveloper: [],
  locationCode: 2840,
  languageCode: 'en',
  observationMeta: OBSERVATION,
};

let db: TestDb;

beforeAll(async () => {
  db = await startTestPostgres();
});
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('app-seo Drizzle schema and migration', () => {
  it('registers exactly one 0097 migration with a chained snapshot and monotonic journal time', () => {
    const drizzleUrl = new URL('../../drizzle/', import.meta.url);
    const metadataUrl = new URL('meta/', drizzleUrl);
    const journal = JSON.parse(
      readFileSync(new URL('_journal.json', metadataUrl), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const previous = journal.entries.find((entry) => entry.idx === 96);
    const current = journal.entries.find((entry) => entry.idx === 97);
    expect(current?.when).toBeGreaterThan(previous?.when ?? 0);

    const files = readdirSync(drizzleUrl).filter(
      (name) => name.startsWith('0097_') && name.endsWith('.sql'),
    );
    expect(files).toEqual([`${current?.tag}.sql`]);

    const previousSnapshot = JSON.parse(
      readFileSync(new URL('0096_snapshot.json', metadataUrl), 'utf8'),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(new URL('0097_snapshot.json', metadataUrl), 'utf8'),
    ) as { prevId: string };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
  });

  it('keeps all four tables account/site scoped and timestamps timezone-aware', async () => {
    const result = await db.execute(sql`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (
          'app_keywords',
          'app_rank_snapshots',
          'app_chart_snapshots',
          'app_listing_snapshots'
        )
        and column_name in (
          'account_id',
          'site_id',
          'created_at',
          'updated_at',
          'checked_at',
          'captured_at'
        )
    `);
    const rows = result.rows as Array<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>;
    for (const table of [
      'app_keywords',
      'app_rank_snapshots',
      'app_chart_snapshots',
      'app_listing_snapshots',
    ]) {
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table_name: table, column_name: 'account_id' }),
          expect.objectContaining({ table_name: table, column_name: 'site_id' }),
        ]),
      );
    }
    expect(
      rows.filter((row) =>
        ['created_at', 'updated_at', 'checked_at', 'captured_at'].includes(
          row.column_name,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data_type: 'timestamp with time zone' }),
      ]),
    );
  });

  it('declares and migrates the keyword-to-rank cascade', async () => {
    const foreignKeys = getTableConfig(appRankSnapshots).foreignKeys;
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]?.onDelete).toBe('cascade');
    const reference = foreignKeys[0]?.reference();
    expect(reference?.columns.map((column) => column.name)).toEqual(['keyword_id']);
    expect(getTableConfig(reference!.foreignTable).name).toBe('app_keywords');
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(['id']);

    const [keyword] = await db
      .insert(appKeywords)
      .values({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        profileId: PROFILE_ID,
        store: 'google_play',
        phrase: 'rank tracker',
        locationCode: 2840,
        languageCode: 'en',
      })
      .returning({ id: appKeywords.id });
    await db.insert(appRankSnapshots).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      keywordId: keyword!.id,
      position: null,
      rankAbsolute: null,
      foundAppId: null,
      checkedAt: new Date('2026-08-09T12:00:00.000Z'),
      observationMeta: OBSERVATION,
    });

    await db.delete(appKeywords);
    expect(await db.select().from(appRankSnapshots)).toEqual([]);
  });

  it('enforces store checks and keyword observation uniqueness', async () => {
    await expect(
      db.insert(appKeywords).values({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        profileId: PROFILE_ID,
        store: 'windows_store' as AppSeoStore,
        phrase: 'rank tracker',
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toThrow();

    const row = {
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      profileId: PROFILE_ID,
      store: 'app_store' as const,
      phrase: 'rank tracker',
      locationCode: 2840,
      languageCode: 'en',
    };
    await db.insert(appKeywords).values(row);
    await expect(db.insert(appKeywords).values(row)).rejects.toThrow();
  });

  it('stores chart and listing JSON observations and exposes history indexes', async () => {
    await db.insert(appChartSnapshots).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      profileId: PROFILE_ID,
      store: 'google_play',
      chartId: 'top_free',
      categoryId: null,
      position: 4,
      checkedAt: new Date('2026-08-09T12:00:00.000Z'),
      observationMeta: OBSERVATION,
    });
    await db.insert(appListingSnapshots).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      profileId: PROFILE_ID,
      store: 'app_store',
      capturedAt: new Date('2026-08-09T12:00:00.000Z'),
      listing: LISTING,
      findings: { passed: 3 },
      observationMeta: OBSERVATION,
    });

    expect(await db.select().from(appChartSnapshots)).toHaveLength(1);
    expect(await db.select().from(appListingSnapshots)).toHaveLength(1);

    const indexes = await db.execute(sql`
      select indexname
      from pg_indexes
      where tablename in (
        'app_keywords',
        'app_rank_snapshots',
        'app_chart_snapshots',
        'app_listing_snapshots'
      )
    `);
    const names = indexes.rows.map((row) => String(row.indexname));
    expect(names).toEqual(
      expect.arrayContaining([
        'app_keywords_profile_store_phrase_location_language_idx',
        'app_rank_snapshots_keyword_checked_at_idx',
        'app_chart_snapshots_profile_history_idx',
        'app_listing_snapshots_profile_history_idx',
      ]),
    );
  });

  it('keeps inferred store and insert types narrow', () => {
    expectTypeOf<AppKeywordRow['store']>().toEqualTypeOf<AppSeoStore>();
    expectTypeOf<NewAppListingSnapshotRow['accountId']>().toEqualTypeOf<string>();
  });
});
