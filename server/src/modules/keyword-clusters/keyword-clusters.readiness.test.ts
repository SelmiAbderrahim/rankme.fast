/**
 * `evaluateClusterEligibility` boundaries and reason
 * codes. Stored rows only (PGlite); no provider is constructed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keywords as keywordsTable, rankings } from '../../db/schema/keywords.js';
import { serpObservations } from '../../db/schema/serp-observations.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { evaluateClusterEligibility } from './keyword-clusters.readiness.js';

const ACCOUNT = 'a'.repeat(24);
const SITE = 'c'.repeat(24);
const NOW = new Date('2026-10-16T00:30:00.000Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const db = () => getTestDb() as unknown as never;

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

interface Seed {
  phrase: string;
  /** Rank check (rankings row) time. */
  checkedAt?: Date;
  /** SERP snapshot time and its result count. */
  snapshotAt?: Date;
  results?: number;
  failedAt?: Date;
  engine?: 'google' | 'bing';
}

async function seed(row: Seed): Promise<string> {
  const [inserted] = await getTestDb()
    .insert(keywordsTable)
    .values({
      accountId: ACCOUNT,
      siteId: SITE,
      phrase: row.phrase,
      locationCode: 2682,
      languageCode: 'ar',
      device: 'desktop',
      engine: row.engine ?? 'google',
      lastFailedCheckAt: row.failedAt ?? null,
      lastFailedReason: row.failedAt ? 'vendor_unavailable' : null,
    })
    .returning({ id: keywordsTable.id });
  const keywordId = inserted!.id;
  if (row.checkedAt) {
    await getTestDb().insert(rankings).values({ keywordId, position: 12, checkedAt: row.checkedAt, source: 'fresh' });
  }
  if (row.snapshotAt) {
    await getTestDb().insert(serpObservations).values({
      accountId: ACCOUNT,
      siteId: SITE,
      keywordId,
      engine: 'google',
      checkedAt: row.snapshotAt,
      source: 'fresh',
      features: { features: [], featuredSnippet: null, paa: [] },
      topResults: Array.from({ length: row.results ?? 3 }, (_, index) => ({
        domain: `r${index}.example`,
        url: `https://r${index}.example/${row.phrase.replace(/\s/g, '-')}`,
        rankGroup: 3 - index,
        rankAbsolute: 3 - index,
      })),
    });
  }
  return keywordId;
}

const checked = (phrase: string, at: Date): Seed => ({ phrase, checkedAt: at, snapshotAt: at });

describe('evaluateClusterEligibility', () => {
  it('8 ready and 2 too old: the run can proceed and the two are named', async () => {
    for (let index = 0; index < 8; index += 1) await seed(checked(`ready ${index}`, ago(4 * DAY)));
    await seed(checked('zz old one', ago(11 * DAY)));
    await seed(checked('zz old two', ago(11 * DAY)));
    const result = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW });
    expect(result.canRun).toBe(true);
    expect(result.blockingReasonCode).toBeNull();
    expect(result.eligible).toHaveLength(8);
    expect(result.ineligible.map((row) => [row.phrase, row.reasonCode])).toEqual([
      ['zz old one', 'check_too_old'],
      ['zz old two', 'check_too_old'],
    ]);
    // Top URLs come back in rank order.
    expect(result.eligible[0]!.topUrls[0]).toBe('https://r2.example/ready-0');
  });

  it('exactly seven days old is fresh; seven days and one second is too old', async () => {
    await seed(checked('edge fresh', ago(7 * DAY)));
    await seed(checked('edge stale', ago(7 * DAY + 1_000)));
    const result = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW });
    expect(result.eligible.map((row) => row.phrase)).toEqual(['edge fresh']);
    expect(result.ineligible).toEqual([
      expect.objectContaining({
        phrase: 'edge stale',
        reasonCode: 'check_too_old',
        observedAt: ago(7 * DAY + 1_000).toISOString(),
      }),
    ]);
    // A wider window takes it back in.
    const wide = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW, windowDays: 8 });
    expect(wide.eligible).toHaveLength(2);
  });

  it.each([
    [0, false, 'no_tracked_keywords'],
    [1, false, 'not_enough_eligible'],
    [2, true, null],
    [3, true, null],
  ] as const)('%i eligible keywords → canRun %s', async (count, canRun, blocking) => {
    for (let index = 0; index < count; index += 1) await seed(checked(`kw ${index}`, ago(DAY)));
    if (count === 1) await seed({ phrase: 'never' });
    const result = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW });
    expect(result.eligible).toHaveLength(count);
    expect(result.canRun).toBe(canRun);
    expect(result.blockingReasonCode).toBe(blocking);
  });

  it('assigns every reason code from the shared rank state', async () => {
    await seed({ phrase: 'a never' });
    await seed({ phrase: 'b failed only', failedAt: ago(DAY) });
    await seed({ phrase: 'c failed after check', checkedAt: ago(9 * DAY), snapshotAt: ago(9 * DAY), failedAt: ago(DAY) });
    await seed({ phrase: 'd position only', checkedAt: ago(DAY) });
    await seed({ phrase: 'e stale snapshot, fresh check', checkedAt: ago(DAY), snapshotAt: ago(20 * DAY) });
    await seed({ phrase: 'f empty snapshot', checkedAt: ago(DAY), snapshotAt: ago(DAY), results: 0 });
    await seed({ phrase: 'g snapshot only, stale', snapshotAt: ago(10 * DAY) });
    await seed({ phrase: 'h failure older than snapshot', checkedAt: ago(20 * DAY), snapshotAt: ago(12 * DAY), failedAt: ago(15 * DAY) });
    // A failure newer than a fresh snapshot does not throw the snapshot away.
    await seed({ phrase: 'i failed, fresh snapshot', checkedAt: ago(2 * DAY), snapshotAt: ago(2 * DAY), failedAt: ago(DAY) });
    await seed({ phrase: 'j bing', engine: 'bing', checkedAt: ago(DAY) });

    const result = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW });
    expect(result.eligible.map((row) => row.phrase)).toEqual(['i failed, fresh snapshot']);
    expect(result.ineligible.map((row) => [row.phrase, row.reasonCode, row.observedAt])).toEqual([
      ['a never', 'never_checked', null],
      ['b failed only', 'failed_last_check', ago(DAY).toISOString()],
      ['c failed after check', 'failed_last_check', ago(DAY).toISOString()],
      ['d position only', 'no_serp_snapshot', ago(DAY).toISOString()],
      ['e stale snapshot, fresh check', 'no_serp_snapshot', ago(DAY).toISOString()],
      ['f empty snapshot', 'no_serp_snapshot', ago(DAY).toISOString()],
      ['g snapshot only, stale', 'check_too_old', ago(10 * DAY).toISOString()],
      ['h failure older than snapshot', 'check_too_old', ago(12 * DAY).toISOString()],
    ]);
    expect(result).toMatchObject({ canRun: false, blockingReasonCode: 'not_enough_eligible' });
  });

  it('a future-dated snapshot is never fresh', async () => {
    await seed(checked('future', new Date(NOW.getTime() + DAY)));
    const result = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW });
    expect(result.ineligible[0]).toMatchObject({ reasonCode: 'check_too_old' });
  });

  it('narrows to the requested keyword ids', async () => {
    const first = await seed(checked('first', ago(DAY)));
    await seed(checked('second', ago(DAY)));
    const result = await evaluateClusterEligibility(db(), { siteId: SITE, now: NOW, keywordIds: [first] });
    expect(result.eligible.map((row) => row.keywordId)).toEqual([first]);
  });
});
