import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema/index.js';
import {
  appChartSnapshots,
  appKeywords,
  appListingSnapshots,
  appRankSnapshots,
  audienceResearchEvents,
  brandRadarEvents,
  domainStates,
  pagePerformanceKeywords,
  pagePerformanceSnapshots,
  siteDeletionTombstones,
  teamMembers,
  teamMemberSiteGrants,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  SITE_INDIRECT_POSTGRES_TABLE_NAMES,
  SITE_SCOPED_POSTGRES_TABLE_NAMES,
  installSiteDeletionBarrier,
  purgeSitePostgresData,
} from './site-postgres-cascade.js';

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('site Postgres lifecycle barrier', () => {
  it('ratchets the workflow-id-only Postgres descendants', () => {
    expect(SITE_INDIRECT_POSTGRES_TABLE_NAMES).toEqual([
      'audience_research_events',
      'brand_radar_events',
    ]);
  });

  it('ratchets every schema table that directly owns site_id', () => {
    const names: string[] = [];
    for (const value of Object.values(schema)) {
      if (!value || typeof value !== 'object') continue;
      try {
        const columns = getTableColumns(value as never) as Record<
          string,
          { name: string }
        >;
        if (columns.siteId?.name === 'site_id') names.push(getTableName(value as never));
      } catch {
        // Non-table schema exports (enums/types/constants) are irrelevant.
      }
    }
    expect([...new Set(names)].filter((name) => name !== 'site_deletion_tombstones').sort())
      .toEqual([...SITE_SCOPED_POSTGRES_TABLE_NAMES].sort());
  });

  it('installs one trigger per inventory table', async () => {
    const result = await getTestDb().execute(sql`
      select c.relname as table_name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal
        and t.tgname like '%_site_deletion_guard'
      order by c.relname
    `);
    expect(result.rows.map((row) => String(row.table_name))).toEqual(
      [...SITE_SCOPED_POSTGRES_TABLE_NAMES].sort(),
    );
  });

  it('keeps the tombstone permanent and rejects insert/update rematerialization', async () => {
    const db = getTestDb();
    const siteId = 'site-lifecycle-trigger';
    await db.insert(domainStates).values({ siteId });
    const startedAt = new Date('2026-08-06T12:00:00.000Z');
    await installSiteDeletionBarrier(db as never, siteId, startedAt);
    await installSiteDeletionBarrier(db as never, siteId, new Date());

    const expectDeletionRejected = async (operation: Promise<unknown>) => {
      try {
        await operation;
        throw new Error('expected site deletion trigger rejection');
      } catch (error) {
        const messages: string[] = [];
        let current: unknown = error;
        while (current && typeof current === 'object') {
          const record = current as { message?: unknown; cause?: unknown };
          if (typeof record.message === 'string') messages.push(record.message);
          current = record.cause;
        }
        expect(messages.join('\n')).toContain('site deletion has started');
      }
    };
    await expectDeletionRejected(
      db.update(domainStates).set({ cadence: 'daily' }).where(sql`${domainStates.siteId} = ${siteId}`),
    );
    await expectDeletionRejected(db.insert(domainStates).values({ siteId }));

    await purgeSitePostgresData(db as never, 'site-lifecycle-owner', siteId);
    expect(await db.select().from(domainStates)).toEqual([]);
    expect(await db.select().from(siteDeletionTombstones)).toEqual([
      { siteId, deletionStartedAt: startedAt },
    ]);
  });

  it('purges selected membership grants and blocks them from rematerializing', async () => {
    const db = getTestDb();
    const siteId = 'selected-site-to-delete';
    const [membership] = await db.insert(teamMembers).values({
      teamId: 'owner',
      email: 'member@example.com',
      role: 'member',
      siteAccessMode: 'selected',
      inviteTokenHash: 'f'.repeat(64),
      invitedBy: 'owner',
      acceptedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }).returning({ id: teamMembers.id });
    await db.insert(teamMemberSiteGrants).values({
      teamMemberId: membership!.id,
      siteId,
    });
    await installSiteDeletionBarrier(db as never, siteId, new Date());
    await purgeSitePostgresData(db as never, 'owner', siteId);
    expect(await db.select().from(teamMemberSiteGrants)).toEqual([]);
    try {
      await db.insert(teamMemberSiteGrants).values({
        teamMemberId: membership!.id,
        siteId,
      });
      throw new Error('expected site deletion trigger rejection');
    } catch (error) {
      const messages: string[] = [];
      let current: unknown = error;
      while (current && typeof current === 'object') {
        const record = current as { message?: unknown; cause?: unknown };
        if (typeof record.message === 'string') messages.push(record.message);
        current = record.cause;
      }
      expect(messages.join('\n')).toContain('site deletion has started');
    }
  });

  it('deletes event rows linked through frozen Mongo run and scan ids', async () => {
    const db = getTestDb();
    await db.insert(audienceResearchEvents).values([
      {
        accountId: 'owner',
        runId: 'audience-target',
        reservationKey: 'audience-target-key',
        kind: 'reserved',
      },
      {
        accountId: 'owner',
        runId: 'audience-other',
        reservationKey: 'audience-other-key',
        kind: 'reserved',
      },
    ]);
    await db.insert(brandRadarEvents).values([
      {
        accountId: 'owner',
        scanId: 'brand-target',
        stage: 'scan',
        event: 'reserved',
      },
      {
        accountId: 'owner',
        scanId: 'brand-other',
        stage: 'scan',
        event: 'reserved',
      },
    ]);

    await purgeSitePostgresData(db as never, 'owner', 'site-indirect', {
      idsByModel: new Map([
        ['AudienceResearchRun', new Set(['audience-target'])],
        ['BrandRadarScan', new Set(['brand-target'])],
      ]),
      documents: 2,
    });

    expect((await db.select().from(audienceResearchEvents)).map((row) => row.runId))
      .toEqual(['audience-other']);
    expect((await db.select().from(brandRadarEvents)).map((row) => row.scanId))
      .toEqual(['brand-other']);
  });

  it('deletes Pages children and parents by account/site while preserving a colliding tenant', async () => {
    const db = getTestDb();
    const observedAt = new Date('2026-08-08T00:00:00.000Z');
    const parents = await db
      .insert(pagePerformanceSnapshots)
      .values([
        {
          accountId: 'target-account', siteId: 'shared-site', source: 'demo',
          locationCode: 2840, languageCode: 'en', observedAt, cacheFetchedAt: observedAt,
          cacheStatus: 'miss', successfulEmpty: false, payloadFingerprint: 'a'.repeat(64),
          sourceRowsFetched: 1, acceptedCount: 1, droppedCount: 0,
        },
        {
          accountId: 'control-account', siteId: 'shared-site', source: 'demo',
          locationCode: 2840, languageCode: 'en', observedAt, cacheFetchedAt: observedAt,
          cacheStatus: 'miss', successfulEmpty: false, payloadFingerprint: 'b'.repeat(64),
          sourceRowsFetched: 1, acceptedCount: 1, droppedCount: 0,
        },
      ])
      .returning();
    await db.insert(pagePerformanceKeywords).values(
      parents.map((parent) => ({
        snapshotId: parent.id,
        accountId: parent.accountId,
        siteId: parent.siteId,
        pageHash: 'DxFdsGK3wN0DCxaHjJnepcNUtJ3DezjriEYXnHeD6dc',
        canonicalUrl: 'https://example.com/',
        displayUrl: 'example.com/',
        keyword: parent.accountId,
        position: 1,
      })),
    );

    await purgeSitePostgresData(db as never, 'target-account', 'shared-site');
    expect((await db.select().from(pagePerformanceSnapshots)).map((row) => row.accountId))
      .toEqual(['control-account']);
    expect((await db.select().from(pagePerformanceKeywords)).map((row) => row.accountId))
      .toEqual(['control-account']);
  });

  it('deletes all App SEO rows by account/site while preserving a colliding tenant', async () => {
    const db = getTestDb();
    const siteId = 'shared-app-site';
    const observedAt = new Date('2026-08-09T12:00:00.000Z');
    const observation = {
      sourceKind: 'provider_observation' as const,
      sourceLabel: 'dataforseo' as const,
      observedAt: observedAt.toISOString(),
      freshUntil: null,
      freshness: 'fresh' as const,
      market: null,
      sampleCount: 1,
      coverageNoteKey: null,
    };
    const keywords = await db
      .insert(appKeywords)
      .values([
        {
          accountId: 'target-account', siteId, profileId: 'target-profile',
          store: 'google_play', phrase: 'target phrase', locationCode: 2840,
          languageCode: 'en',
        },
        {
          accountId: 'control-account', siteId, profileId: 'control-profile',
          store: 'google_play', phrase: 'control phrase', locationCode: 2840,
          languageCode: 'en',
        },
      ])
      .returning({ id: appKeywords.id, accountId: appKeywords.accountId });
    await db.insert(appRankSnapshots).values(
      keywords.map((keyword) => ({
        accountId: keyword.accountId,
        siteId,
        keywordId: keyword.id,
        checkedAt: observedAt,
        observationMeta: observation,
      })),
    );
    for (const accountId of ['target-account', 'control-account']) {
      const profileId = accountId.startsWith('target') ? 'target-profile' : 'control-profile';
      await db.insert(appChartSnapshots).values({
        accountId,
        siteId,
        profileId,
        store: 'google_play',
        chartId: 'top_free',
        checkedAt: observedAt,
        observationMeta: observation,
      });
      await db.insert(appListingSnapshots).values({
        accountId,
        siteId,
        profileId,
        store: 'google_play',
        capturedAt: observedAt,
        listing: {},
        findings: {},
        observationMeta: observation,
      } as never);
    }

    await purgeSitePostgresData(db as never, 'target-account', siteId);
    expect((await db.select().from(appKeywords)).map((row) => row.accountId))
      .toEqual(['control-account']);
    expect((await db.select().from(appRankSnapshots)).map((row) => row.accountId))
      .toEqual(['control-account']);
    expect((await db.select().from(appChartSnapshots)).map((row) => row.accountId))
      .toEqual(['control-account']);
    expect((await db.select().from(appListingSnapshots)).map((row) => row.accountId))
      .toEqual(['control-account']);
  });
});
