import { sql } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import {
  BACKLINK_BULK_RANK_LIMIT,
  BACKLINK_DEEP_ROW_LIMIT,
  BACKLINK_DEEP_SNAPSHOT_TYPES,
  BACKLINK_HISTORY_POINT_LIMIT,
  backlinkDeepSnapshots,
  linkGapSnapshots,
  parseBacklinkDeepSnapshotPayload,
  parseLinkGapSnapshotPayload,
  type BacklinkDeepSnapshotRow,
  type BacklinkDeepSnapshotType,
  type LinkGapSnapshotRow,
  type NewBacklinkDeepSnapshotRow,
  type NewLinkGapSnapshotRow,
} from './index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';

const RETAINED_AT = new Date('2026-07-22T12:00:00.000Z');

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('link intelligence Drizzle schemas', () => {
  it('preserves 0057 and registers the monotonic 0058 traffic snapshot migration', () => {
    const metadataUrl = new URL('../../../drizzle/meta/', import.meta.url);
    const journal = JSON.parse(
      readFileSync(new URL('_journal.json', metadataUrl), 'utf8'),
    ) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    // Positional lookups would break every time a later change appends a
    // migration (0059 was one such addition); pin by idx instead.
    const linkIntelligence = journal.entries.find((entry) => entry.idx === 57);
    const current = journal.entries.find((entry) => entry.idx === 58);
    expect(linkIntelligence).toEqual({
      idx: 57,
      version: '7',
      when: 1786400000018,
      tag: '0057_link_intelligence_deep',
      breakpoints: true,
    });
    expect(current).toEqual({
      idx: 58,
      version: '7',
      when: 1786400000019,
      tag: '0058_amusing_magdalene',
      breakpoints: true,
    });
    expect(current?.when).toBeGreaterThan(linkIntelligence?.when ?? 0);
    expect(
      journal.entries.every(
        (entry, index, entries) =>
          index === 0 || entry.when > (entries[index - 1]?.when ?? 0),
      ),
    ).toBe(true);

    const previousSnapshot = JSON.parse(
      readFileSync(new URL('0056_snapshot.json', metadataUrl), 'utf8'),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(new URL('0057_snapshot.json', metadataUrl), 'utf8'),
    ) as { prevId: string };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    const trafficSnapshot = JSON.parse(
      readFileSync(new URL('0058_snapshot.json', metadataUrl), 'utf8'),
    ) as { prevId: string };
    const linkSnapshot = JSON.parse(
      readFileSync(new URL('0057_snapshot.json', metadataUrl), 'utf8'),
    ) as { id: string };
    expect(trafficSnapshot.prevId).toBe(linkSnapshot.id);

    const migrationFiles = readdirSync(new URL('../../../drizzle/', import.meta.url)).filter(
      (name) => name.startsWith('0057_') && name.endsWith('.sql'),
    );
    expect(migrationFiles).toEqual(['0057_link_intelligence_deep.sql']);
    const trafficMigrationFiles = readdirSync(
      new URL('../../../drizzle/', import.meta.url),
    ).filter((name) => name.startsWith('0058_') && name.endsWith('.sql'));
    expect(trafficMigrationFiles).toEqual(['0058_amusing_magdalene.sql']);
  });

  it('locks exported row types, operation values, and timezone-aware reads', async () => {
    expect(BACKLINK_DEEP_SNAPSHOT_TYPES).toEqual([
      'refDomains',
      'anchors',
      'history',
      'bulkRanks',
    ]);
    expectTypeOf<BacklinkDeepSnapshotRow['type']>().toEqualTypeOf<
      BacklinkDeepSnapshotType
    >();
    expectTypeOf<BacklinkDeepSnapshotRow['retainedAt']>().toEqualTypeOf<Date>();
    expectTypeOf<LinkGapSnapshotRow['retainedAt']>().toEqualTypeOf<Date>();
    expectTypeOf<NewBacklinkDeepSnapshotRow['accountId']>().toEqualTypeOf<string>();
    expectTypeOf<NewLinkGapSnapshotRow['competitor']>().toEqualTypeOf<string>();

    const db = getTestDb();
    await db.insert(backlinkDeepSnapshots).values({
      accountId: 'account-a',
      siteId: 'site-a',
      runId: 'run-a',
      type: 'anchors',
      domain: 'example.com',
      payload: [{ anchor: 'safe text', backlinks: 2, referringDomains: 1 }],
      retainedCount: 1,
      retainedAt: RETAINED_AT,
    });
    await db.insert(linkGapSnapshots).values({
      accountId: 'account-a',
      siteId: 'site-a',
      runId: 'gap-a',
      ownDomain: 'example.com',
      competitor: 'competitor.test',
      payload: [
        {
          domain: 'referrer.test',
          intersections: 3,
          rank: 42,
          firstSeen: null,
        },
      ],
      retainedCount: 1,
      retainedAt: RETAINED_AT,
    });

    const [deepRow] = await db.select().from(backlinkDeepSnapshots);
    const [gapRow] = await db.select().from(linkGapSnapshots);
    expect(deepRow?.retainedAt).toEqual(RETAINED_AT);
    expect(gapRow?.retainedAt).toEqual(RETAINED_AT);

    const columns = await db.execute(sql`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_name in ('backlink_deep_snapshots', 'link_gap_snapshots')
        and column_name in ('retained_at', 'created_at')
    `);
    expect(columns.rows).toHaveLength(4);
    expect(columns.rows.every((row) => row.data_type === 'timestamp with time zone')).toBe(
      true,
    );
  });

  it('exposes tenant-first account/run keys and account/site/time indexes', async () => {
    const indexes = await getTestDb().execute(sql`
      select tablename, indexname, indexdef
      from pg_indexes
      where tablename in ('backlink_deep_snapshots', 'link_gap_snapshots')
    `);
    const definitions = indexes.rows.map((row) => String(row.indexdef));

    expect(
      definitions.some(
        (definition) =>
          definition.includes('backlink_deep_snapshots_account_run_type_uq') &&
          definition.includes('(account_id, run_id, type)'),
      ),
    ).toBe(true);
    expect(
      definitions.some(
        (definition) =>
          definition.includes('link_gap_snapshots_account_run_competitor_uq') &&
          definition.includes('(account_id, run_id, competitor)'),
      ),
    ).toBe(true);
    expect(
      definitions.filter((definition) =>
        definition.includes('(account_id, site_id, retained_at)'),
      ),
    ).toHaveLength(2);
  });

  it('keeps append-only keys isolated by account', async () => {
    const db = getTestDb();
    const deepValue: NewBacklinkDeepSnapshotRow = {
      accountId: 'account-a',
      siteId: 'site-a',
      runId: 'shared-run',
      type: 'history',
      domain: 'example.com',
      payload: [],
      retainedCount: 0,
      retainedAt: RETAINED_AT,
    };
    await db.insert(backlinkDeepSnapshots).values(deepValue);
    await expect(db.insert(backlinkDeepSnapshots).values(deepValue)).rejects.toThrow();
    await expect(
      db.insert(backlinkDeepSnapshots).values({
        ...deepValue,
        accountId: 'account-b',
      }),
    ).resolves.toBeDefined();

    const gapValue: NewLinkGapSnapshotRow = {
      accountId: 'account-a',
      siteId: 'site-a',
      runId: 'shared-gap-run',
      ownDomain: 'example.com',
      competitor: 'competitor.test',
      payload: [],
      retainedCount: 0,
      retainedAt: RETAINED_AT,
    };
    await db.insert(linkGapSnapshots).values(gapValue);
    await expect(db.insert(linkGapSnapshots).values(gapValue)).rejects.toThrow();
    await expect(
      db.insert(linkGapSnapshots).values({
        ...gapValue,
        accountId: 'account-b',
      }),
    ).resolves.toBeDefined();
  });

  it('zod-parses each bounded deep payload shape and gap rows on read', () => {
    expect(
      parseBacklinkDeepSnapshotPayload('refDomains', [
        {
          domain: 'referrer.test',
          backlinks: 4,
          domainRank: null,
          firstSeen: '2026-01-01T00:00:00.000Z',
          lastSeen: null,
        },
      ]),
    ).toHaveLength(1);
    expect(
      parseBacklinkDeepSnapshotPayload('anchors', [
        { anchor: 'anchor', backlinks: 2, referringDomains: 1 },
      ]),
    ).toHaveLength(1);
    expect(
      parseBacklinkDeepSnapshotPayload('history', [
        { year: 2026, month: 7, backlinks: 9, referringDomains: 3 },
      ]),
    ).toHaveLength(1);
    expect(
      parseBacklinkDeepSnapshotPayload('bulkRanks', [
        { domain: 'ranked.test', rank: 90 },
      ]),
    ).toHaveLength(1);
    expect(
      parseLinkGapSnapshotPayload([
        { domain: 'gap.test', intersections: 5, rank: null },
      ]),
    ).toHaveLength(1);

    expect(() =>
      parseBacklinkDeepSnapshotPayload(
        'refDomains',
        Array.from({ length: BACKLINK_DEEP_ROW_LIMIT + 1 }, (_, index) => ({
          domain: `referrer-${index}.test`,
          backlinks: 1,
          domainRank: null,
          firstSeen: null,
          lastSeen: null,
        })),
      ),
    ).toThrow();
    expect(() =>
      parseBacklinkDeepSnapshotPayload('anchors', [
        {
          anchor: 'x'.repeat(201),
          backlinks: 1,
          referringDomains: 1,
        },
      ]),
    ).toThrow();
    expect(() =>
      parseBacklinkDeepSnapshotPayload(
        'history',
        Array.from({ length: BACKLINK_HISTORY_POINT_LIMIT + 1 }, () => ({
          year: 2026,
          month: 1,
          backlinks: 1,
          referringDomains: 1,
        })),
      ),
    ).toThrow();
    expect(() =>
      parseBacklinkDeepSnapshotPayload(
        'bulkRanks',
        Array.from({ length: BACKLINK_BULK_RANK_LIMIT + 1 }, (_, index) => ({
          domain: `domain-${index}.test`,
          rank: null,
        })),
      ),
    ).toThrow();
    expect(() =>
      parseLinkGapSnapshotPayload(
        Array.from({ length: BACKLINK_DEEP_ROW_LIMIT + 1 }, (_, index) => ({
          domain: `domain-${index}.test`,
          intersections: 0,
          rank: null,
        })),
      ),
    ).toThrow();
  });

  it('enforces operation-specific payload, retained-count, and domain bounds in SQL', async () => {
    const db = getTestDb();
    const historyRows = Array.from(
      { length: BACKLINK_HISTORY_POINT_LIMIT + 1 },
      () => ({ year: 2026, month: 1, backlinks: 0, referringDomains: 0 }),
    );
    await expect(
      db.insert(backlinkDeepSnapshots).values({
        accountId: 'account-a',
        siteId: 'site-a',
        runId: 'too-many-history',
        type: 'history',
        domain: 'example.com',
        payload: historyRows,
        retainedCount: historyRows.length,
        retainedAt: RETAINED_AT,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(linkGapSnapshots).values({
        accountId: 'account-a',
        siteId: 'site-a',
        runId: 'bad-count',
        ownDomain: 'example.com',
        competitor: 'competitor.test',
        payload: [],
        retainedCount: 1,
        retainedAt: RETAINED_AT,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(backlinkDeepSnapshots).values({
        accountId: 'account-a',
        siteId: 'site-a',
        runId: 'long-domain',
        type: 'anchors',
        domain: 'x'.repeat(254),
        payload: [],
        retainedCount: 0,
        retainedAt: RETAINED_AT,
      }),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`
        insert into backlink_deep_snapshots
          (account_id, site_id, run_id, type, domain, payload, retained_count, retained_at)
        values
          ('account-a', 'site-a', 'invalid-operation', 'invalid', 'example.com', '[]'::jsonb, 0, ${RETAINED_AT})
      `),
    ).rejects.toThrow();
  });
});
