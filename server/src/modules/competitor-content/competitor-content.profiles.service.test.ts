/**
 * Competitor profile management tests (spec §2). Suggestions read the
 * competitors snapshot; confirm/add validates the URL (SEC-URL), dedups by
 * registrable domain, enforces the portfolio ceiling, and cross-account ids
 * return 404. Management makes no vendor call.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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
import { COMPETITOR_PORTFOLIO_MAX_COMPETITORS } from '../../shared/safety/feature-limits.js';
import { Site } from '../sites/index.js';
import { competitors, competitorProfiles } from '../../db/schema/index.js';
import {
  addCompetitor,
  archiveCompetitor,
  canonicalOrigin,
  listCompetitors,
  loadActiveCompetitorProfiles,
  registrableDomainKey,
  restoreCompetitor,
  suggestCompetitors,
} from './competitor-content.profiles.service.js';

const ACCOUNT = '000000000000000000000abc';
const OTHER = '000000000000000000000fff';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;

async function ownedSite(accountId = ACCOUNT, origin = 'https://example.com'): Promise<string> {
  const site = await Site.create({ accountId, url: origin, domain: new URL(origin).hostname, label: 's' });
  return String(site._id);
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('helpers', () => {
  it('canonicalizes origins + registrable domains', () => {
    expect(canonicalOrigin(new URL('https://WWW.Example.com/path?q=1'))).toBe('https://www.example.com');
    expect(registrableDomainKey('WWW.Example.com')).toBe('example.com');
    expect(registrableDomainKey('WWW.Example.co.uk')).toBe('example.co.uk');
  });
});

describe('suggestCompetitors', () => {
  it('404s for a site owned by another account, and for an invalid site id', async () => {
    const siteId = await ownedSite(OTHER);
    await expect(suggestCompetitors(db(), { accountId: ACCOUNT, siteId })).rejects.toMatchObject({ status: 404 });
    await expect(suggestCompetitors(db(), { accountId: ACCOUNT, siteId: 'not-an-id' })).rejects.toMatchObject({ status: 404 });
  });

  it('dedups by registrable domain, flags confirmed, and sorts by intersections', async () => {
    const siteId = await ownedSite();
    // Query order is (competitorDomain ASC, fetchedAt ASC). `apex.com` rows
    // ASCEND (2 → 9) so the second REPLACES (the `<` dedupe branch); `rival.com`
    // rows DESCEND (9 → 2) so the second SKIPS (the `>=` branch). `www.` collapses
    // onto `rival.com`; the empty domain is dropped. Both branches, deterministic.
    await db().insert(competitors).values([
      { siteId, accountId: ACCOUNT, competitorDomain: 'apex.com', intersections: 2, source: 'domain', fetchedAt: new Date('2026-07-18'), snapshotDay: '2026-07-18' },
      { siteId, accountId: ACCOUNT, competitorDomain: 'apex.com', intersections: 9, avgPosition: '4.2', source: 'domain', fetchedAt: new Date('2026-07-19'), snapshotDay: '2026-07-19' },
      { siteId, accountId: ACCOUNT, competitorDomain: 'rival.com', intersections: 9, source: 'domain', fetchedAt: new Date('2026-07-18'), snapshotDay: '2026-07-18' },
      { siteId, accountId: ACCOUNT, competitorDomain: 'rival.com', intersections: 2, source: 'domain', fetchedAt: new Date('2026-07-19'), snapshotDay: '2026-07-19' },
      { siteId, accountId: ACCOUNT, competitorDomain: 'www.rival.com', intersections: 3, source: 'domain', fetchedAt: new Date('2026-07-20'), snapshotDay: '2026-07-20' },
      { siteId, accountId: ACCOUNT, competitorDomain: 'other.com', intersections: 5, source: 'domain', fetchedAt: new Date(), snapshotDay: '2026-07-20' },
      { siteId, accountId: ACCOUNT, competitorDomain: '', intersections: 1, source: 'domain', fetchedAt: new Date(), snapshotDay: '2026-07-20' },
    ]);
    await db().insert(competitorProfiles).values({ accountId: ACCOUNT, siteId, origin: 'https://other.com', registrableDomain: 'other.com', source: 'suggested', status: 'active' });

    const suggestions = await suggestCompetitors(db(), { accountId: ACCOUNT, siteId });
    // apex 9, rival 9 (tie → alpha), other 5.
    expect(suggestions.map((s) => s.registrableDomain)).toEqual(['apex.com', 'rival.com', 'other.com']);
    expect(suggestions.find((s) => s.registrableDomain === 'rival.com')!.intersections).toBe(9);
    expect(suggestions.find((s) => s.registrableDomain === 'other.com')!.alreadyConfirmed).toBe(true);
  });
});

describe('addCompetitor', () => {
  it('404s for a site owned by another account', async () => {
    const siteId = await ownedSite(OTHER);
    await expect(
      addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.org', source: 'manual' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('400s for an unsafe (private) URL, and never inserts', async () => {
    const siteId = await ownedSite();
    await expect(
      addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://127.0.0.1/', source: 'manual' }),
    ).rejects.toMatchObject({ status: 400 });
    const rows = await db().select().from(competitorProfiles).where(eq(competitorProfiles.siteId, siteId));
    expect(rows).toHaveLength(0);
  });

  it('adds a public competitor and returns duplicate on a resend (registrable dedupe)', async () => {
    const siteId = await ownedSite();
    const first = await addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.org/path', source: 'manual' });
    expect(first.duplicate).toBe(false);
    expect(first.profile.registrableDomain).toBe('example.org');
    // Same registrable domain (www + different path) → idempotent duplicate.
    const second = await addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://www.example.org/other', source: 'manual' });
    expect(second.duplicate).toBe(true);
    expect(second.profile.id).toBe(first.profile.id);
  });

  it('resolves a concurrent add of the same domain to a single row (dedupe race)', async () => {
    const siteId = await ownedSite();
    let arrivals = 0;
    let release!: () => void;
    const bothChecked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const add = () => addCompetitor(
      db(),
      { accountId: ACCOUNT, siteId, url: 'https://example.org', source: 'manual' },
      {
        afterDuplicateCheck: async () => {
          arrivals += 1;
          if (arrivals === 2) release();
          await bothChecked;
        },
      },
    );
    const [a, b] = await Promise.all([add(), add()]);
    expect(a.profile.id).toBe(b.profile.id);
    expect(a.duplicate !== b.duplicate).toBe(true);
    const rows = await db().select().from(competitorProfiles).where(eq(competitorProfiles.siteId, siteId));
    expect(rows).toHaveLength(1);
  });

  it('400s once the active portfolio is full', async () => {
    const siteId = await ownedSite();
    await db().insert(competitorProfiles).values(
      Array.from({ length: COMPETITOR_PORTFOLIO_MAX_COMPETITORS }, (_, i) => ({
        accountId: ACCOUNT, siteId, origin: `https://c${i}.example`, registrableDomain: `c${i}.example`, source: 'manual' as const, status: 'active' as const,
      })),
    );
    await expect(
      addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.org', source: 'manual' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('list / archive / restore', () => {
  it('lists by status and toggles archive/restore; cross-account id 404s', async () => {
    const siteId = await ownedSite();
    const added = await addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.org', source: 'manual' });
    // A second competitor so the list sort comparator actually runs.
    await addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.net', source: 'manual' });

    const active = await listCompetitors(db(), { accountId: ACCOUNT, siteId, status: 'active' });
    expect(active).toHaveLength(2);
    expect(active.map((c) => c.registrableDomain)).toEqual(['example.net', 'example.org']);
    expect((await listCompetitors(db(), { accountId: ACCOUNT, siteId, status: 'archived' }))).toHaveLength(0);

    const archived = await archiveCompetitor(db(), { accountId: ACCOUNT, siteId, competitorId: added.profile.id });
    expect(archived.status).toBe('archived');
    expect((await listCompetitors(db(), { accountId: ACCOUNT, siteId, status: 'all' }))).toHaveLength(2);

    const restored = await restoreCompetitor(db(), { accountId: ACCOUNT, siteId, competitorId: added.profile.id });
    expect(restored.status).toBe('active');

    // A different account cannot mutate this competitor.
    const otherSite = await ownedSite(OTHER);
    await expect(
      archiveCompetitor(db(), { accountId: OTHER, siteId: otherSite, competitorId: added.profile.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a missing restore target before mutation', async () => {
    const siteId = await ownedSite();
    await expect(
      restoreCompetitor(db(), {
        accountId: ACCOUNT,
        siteId,
        competitorId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects restoring an archived profile when the active portfolio is full', async () => {
    const siteId = await ownedSite();
    const archived = await addCompetitor(db(), {
      accountId: ACCOUNT,
      siteId,
      url: 'https://archived.org',
      source: 'manual',
    });
    await archiveCompetitor(db(), {
      accountId: ACCOUNT,
      siteId,
      competitorId: archived.profile.id,
    });
    await db().insert(competitorProfiles).values(
      Array.from({ length: COMPETITOR_PORTFOLIO_MAX_COMPETITORS }, (_, index) => ({
        accountId: ACCOUNT,
        siteId,
        origin: `https://active-${index}.example`,
        registrableDomain: `active-${index}.example`,
        source: 'manual' as const,
        status: 'active' as const,
      })),
    );
    await expect(
      restoreCompetitor(db(), {
        accountId: ACCOUNT,
        siteId,
        competitorId: archived.profile.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('loadActiveCompetitorProfiles', () => {
  it('returns [] for no ids and filters to active, wanted, owned rows', async () => {
    const siteId = await ownedSite();
    expect(await loadActiveCompetitorProfiles(db(), { accountId: ACCOUNT, siteId, competitorIds: [] })).toEqual([]);
    const a = await addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.org', source: 'manual' });
    const b = await addCompetitor(db(), { accountId: ACCOUNT, siteId, url: 'https://example.net', source: 'manual' });
    await archiveCompetitor(db(), { accountId: ACCOUNT, siteId, competitorId: b.profile.id });
    const active = await loadActiveCompetitorProfiles(db(), {
      accountId: ACCOUNT, siteId, competitorIds: [a.profile.id, b.profile.id, 'ghost'],
    });
    expect(active.map((p) => p.id)).toEqual([a.profile.id]);
  });
});
