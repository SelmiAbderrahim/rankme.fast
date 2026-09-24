/**
 * Evidence loader tests (spec §3) against real PGlite Postgres. Reads the
 * competitors module's snapshot + intersection rows READ-ONLY; a shape drift or
 * missing rows degrade to "no evidence" rather than throwing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { competitors, competitorIntersections } from '../../db/schema/competitors.js';
import { loadCompetitorEvidence } from './competitor-content.evidence.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = 'site-1';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
afterEach(async () => {
  await truncateAllTables();
});

async function seedSnapshot(domain: string) {
  await db().insert(competitors).values({
    siteId: SITE,
    accountId: ACCOUNT,
    competitorDomain: domain,
    intersections: 5,
    source: 'domain',
    fetchedAt: new Date(),
    snapshotDay: '2026-07-20',
  });
}

async function seedIntersection(domain: string, keywords: unknown, at: Date) {
  await db().insert(competitorIntersections).values({
    siteId: SITE,
    accountId: ACCOUNT,
    competitorDomain: domain,
    keywords: keywords as never,
    fetchedAt: at,
  });
}

describe('loadCompetitorEvidence', () => {
  it('returns an empty map for no domains', async () => {
    const map = await loadCompetitorEvidence(db(), { siteId: SITE, domains: [] });
    expect(map.size).toBe(0);
  });

  it('marks snapshot presence and extracts shared + demand queries from the latest row', async () => {
    await seedSnapshot('rival.com');
    await seedIntersection('rival.com', [
      { keyword: 'running shoes', searchVolume: 5000 },
      { keyword: 'Running Shoes', searchVolume: 100 }, // dedup by lowercase
      { keyword: 'trail shoes', searchVolume: null },
    ], new Date('2026-07-19'));
    // A newer row supersedes the older one.
    await seedIntersection('rival.com', [
      { keyword: 'marathon gear', searchVolume: 900 },
    ], new Date('2026-07-20'));

    const map = await loadCompetitorEvidence(db(), { siteId: SITE, domains: ['rival.com'] });
    const entry = map.get('rival.com')!;
    expect(entry.hasSnapshot).toBe(true);
    expect(entry.sharedQueries).toEqual(['marathon gear']);
    expect(entry.demandQueries).toEqual([{ query: 'marathon gear', searchVolume: 900 }]);
  });

  it('caps shared queries per domain at the bound', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ keyword: `query ${i}`, searchVolume: i }));
    await seedIntersection('big.com', many, new Date());
    const map = await loadCompetitorEvidence(db(), { siteId: SITE, domains: ['big.com'] });
    expect(map.get('big.com')!.sharedQueries.length).toBe(50);
  });

  it('degrades to empty evidence for a malformed / non-array keywords payload', async () => {
    await seedIntersection('bad.com', { not: 'an array' }, new Date());
    await seedIntersection('mixed.com', [
      { notAKeyword: true },
      { keyword: '   ' }, // trims to empty → skipped (no searchVolume field)
      { keyword: 'lone query' }, // no searchVolume field → `?? null`
      { keyword: 'ok query', searchVolume: 10 },
    ], new Date());

    const map = await loadCompetitorEvidence(db(), { siteId: SITE, domains: ['bad.com', 'mixed.com', 'absent.com'] });
    expect(map.get('bad.com')!.sharedQueries).toEqual([]);
    expect(map.get('mixed.com')!.sharedQueries).toEqual(['lone query', 'ok query']);
    expect(map.get('mixed.com')!.demandQueries[0]).toEqual({ query: 'lone query', searchVolume: null });
    expect(map.get('absent.com')!.hasSnapshot).toBe(false);
  });
});
