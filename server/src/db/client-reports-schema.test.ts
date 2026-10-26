import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  CLIENT_REPORT_LAST_DAY_OF_MONTH,
  scheduledReportDeliveries,
  scheduledReportRuns,
  scheduledReports,
} from './schema/client-reports.js';
import { localReviewsSnapshots } from './schema/local-seo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../shared/testing/postgres.js';

describe('client-reports schema', () => {
  it('cascades run and delivery rows from their scheduled report', () => {
    for (const table of [scheduledReportRuns, scheduledReportDeliveries]) {
      const [foreignKey] = getTableConfig(table).foreignKeys;
      expect(foreignKey).toBeDefined();
      const reference = foreignKey!.reference();
      expect(reference.columns.map((column) => column.name)).toEqual([
        'schedule_id',
      ]);
      expect(getTableConfig(reference.foreignTable).name).toBe(
        'scheduled_reports',
      );
      expect(reference.foreignColumns).toEqual([scheduledReports.id]);
      expect(foreignKey!.onDelete).toBe('cascade');
    }
  });
});

describe('scheduled report time columns', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });
  afterAll(async () => {
    await stopTestPostgres();
  });
  beforeEach(async () => {
    await truncateAllTables();
  });

  const monthly = {
    accountId: 'owner', siteId: 'site', name: 'Monthly', frequency: 'monthly' as const, weekdayUtc: null,
    localHour: 9, minuteUtc: 0, locale: 'en', recipients: ['a@example.com'],
    sections: { audit: true, ranks: true, gsc: false },
  };

  it('stores a time zone with the wall-clock hour, defaulting to UTC', async () => {
    const [row] = await getTestDb().insert(scheduledReports).values({ ...monthly, monthdayUtc: 5 }).returning();
    expect(row).toMatchObject({ timezone: 'UTC', localHour: 9 });
    const columns = await getTestDb().execute(sql`
      select column_name from information_schema.columns
      where table_name = 'scheduled_reports' and column_name = 'hour_utc'
    `);
    expect(columns.rows).toEqual([]);
  });

  it('accepts the last-day-of-month sentinel and rejects other out-of-range days', async () => {
    const db = getTestDb();
    await expect(db.insert(scheduledReports).values({ ...monthly, monthdayUtc: CLIENT_REPORT_LAST_DAY_OF_MONTH })).resolves.toBeDefined();
    await expect(db.insert(scheduledReports).values({ ...monthly, monthdayUtc: 29 })).rejects.toThrow();
    await expect(db.insert(scheduledReports).values({ ...monthly, monthdayUtc: 0 })).rejects.toThrow();
    await expect(db.insert(scheduledReports).values({ ...monthly, monthdayUtc: 5, localHour: 24 })).rejects.toThrow();
  });

  it('keeps the review business reference optional on a snapshot', async () => {
    const db = getTestDb();
    const base = { accountId: 'owner', siteId: 'site', reviewCount: 3, unansweredQuestionCount: 0 };
    const [domainOnly] = await db.insert(localReviewsSnapshots)
      .values({ ...base, snapshotDate: '2026-10-24' }).returning();
    expect(domainOnly).toMatchObject({ businessRef: null, businessName: null });
    const [business] = await db.insert(localReviewsSnapshots)
      .values({ ...base, snapshotDate: '2026-10-25', businessRef: 'place_id:abc', businessName: 'Example Cafe' }).returning();
    expect(business).toMatchObject({ businessRef: 'place_id:abc', businessName: 'Example Cafe' });
  });
});
