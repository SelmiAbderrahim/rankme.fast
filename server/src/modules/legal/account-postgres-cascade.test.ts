import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accountDeletionTombstones,
  actionEvents,
  appChartSnapshots,
  appKeywords,
  appListingSnapshots,
  appRankSnapshots,
  apiKeys,
  contentRecommendationEvents,
  pagePerformanceKeywords,
  pagePerformanceSnapshots,
  teamMembers,
  user as authUser,
  verification,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
import {
  deletedAccountPseudonym,
  installAccountDeletionBarrier,
} from '../../shared/account-deletion/postgres.js';
import {
  ACCOUNT_ERASED_POSTGRES_TABLE_NAMES,
  ACCOUNT_RETAINED_POSTGRES_TABLE_NAMES,
  purgeAccountPostgresData,
  accountPostgresCascadeTestables,
  registeredAccountOwnedPostgresTableNames,
} from './account-postgres-cascade.js';

const accountA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const accountB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

async function seedAccountRows(): Promise<void> {
  const db = getTestDb();
  await db.insert(authUser).values([
    { id: accountA, name: 'Delete', email: 'delete-pg@example.com', emailVerified: true },
    { id: accountB, name: 'Control', email: 'control-pg@example.com', emailVerified: true },
  ]);
  await db.insert(apiKeys).values([
    { accountId: accountA, name: 'delete', keyHash: 'a'.repeat(64), prefix: 'rmf_a' },
    { accountId: accountB, name: 'control', keyHash: 'b'.repeat(64), prefix: 'rmf_b' },
  ]);
  await db.insert(actionEvents).values([
    {
      accountId: accountA,
      siteId: 'site-a',
      actionId: '1'.repeat(64),
      sourceType: 'audit_finding',
      sourceIdRef: '2'.repeat(64),
      newState: 'planned',
      eventKind: 'plan',
      actorUserId: accountA,
      ordinal: 1,
      idempotencyKey: 'action-owned',
    },
    {
      accountId: accountB,
      siteId: 'site-b',
      actionId: '3'.repeat(64),
      sourceType: 'audit_finding',
      sourceIdRef: '4'.repeat(64),
      newState: 'planned',
      eventKind: 'plan',
      actorUserId: accountA,
      ordinal: 1,
      idempotencyKey: 'action-cross',
    },
  ]);
  await db.insert(contentRecommendationEvents).values([
    {
      accountId: accountA,
      siteId: 'site-a',
      analysisId: 'analysis-a',
      recommendationId: 'rec-a',
      analysisVersion: 'v1',
      eventKind: 'accepted',
      priorState: 'suggested',
      newState: 'accepted',
      stateVersion: 1,
      actorUserId: accountA,
      idempotencyKey: 'rec-owned',
    },
    {
      accountId: accountB,
      siteId: 'site-b',
      analysisId: 'analysis-b',
      recommendationId: 'rec-b',
      analysisVersion: 'v1',
      eventKind: 'accepted',
      priorState: 'suggested',
      newState: 'accepted',
      stateVersion: 1,
      actorUserId: accountA,
      idempotencyKey: 'rec-cross',
    },
  ]);
  await db.insert(teamMembers).values([
    {
      teamId: accountB,
      userId: accountB,
      // An accepted membership is not a live invite credential. A matching
      // normalized email alone must not erase another user's membership.
      email: ' DELETE-PG@EXAMPLE.COM ',
      inviteTokenHash: 'c'.repeat(64),
      invitedBy: accountA,
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2027-07-01T00:00:00Z'),
    },
    {
      teamId: accountB,
      email: ' Delete-PG@Example.com ',
      inviteTokenHash: 'd'.repeat(64),
      invitedBy: accountB,
      expiresAt: new Date('2027-07-01T00:00:00Z'),
    },
    {
      teamId: accountB,
      email: 'unrelated-invite@example.com',
      inviteTokenHash: 'e'.repeat(64),
      invitedBy: accountB,
      expiresAt: new Date('2027-07-01T00:00:00Z'),
    },
    {
      teamId: accountB,
      userId: accountA,
      email: 'prebound-delete@example.com',
      inviteTokenHash: 'f'.repeat(64),
      invitedBy: accountB,
      // Pre-binding an existing Better Auth identity must not turn an invite
      // into membership; acceptedAt remains null until bearer redemption.
      expiresAt: new Date('2027-07-01T00:00:00Z'),
    },
    {
      // The `admin` team role (rankme-enterprise-orgs 02) is cascaded by the
      // ordinary `user_id` ownership predicate exactly like `member` — the
      // purge must never leave a privileged membership behind.
      teamId: accountB,
      userId: accountA,
      email: 'admin-membership-delete@example.com',
      role: 'admin',
      inviteTokenHash: 'g'.repeat(64),
      invitedBy: accountB,
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2027-07-01T00:00:00Z'),
    },
  ]);
  await db.insert(verification).values([
    {
      id: 'verification-delete-email',
      identifier: ' DELETE-PG@EXAMPLE.COM ',
      value: 'email-verification-secret',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
    {
      id: 'verification-delete-reset',
      identifier: 'reset-password:real-better-auth-shape',
      value: accountA,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
    {
      id: 'verification-delete-account',
      identifier: 'delete-account-real-better-auth-shape',
      value: accountA,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
    {
      id: 'verification-control',
      identifier: 'reset-password:control',
      value: accountB,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
  ]);
  const observedAt = new Date('2026-08-08T00:00:00.000Z');
  const pageParents = await db
    .insert(pagePerformanceSnapshots)
    .values([
      {
        accountId: accountA, siteId: 'site-pages-a', source: 'demo', locationCode: 2840,
        languageCode: 'en', observedAt, cacheFetchedAt: observedAt, cacheStatus: 'hit',
        successfulEmpty: false, payloadFingerprint: 'a'.repeat(64), sourceRowsFetched: 1,
        acceptedCount: 1, droppedCount: 0,
      },
      {
        accountId: accountB, siteId: 'site-pages-b', source: 'demo', locationCode: 2840,
        languageCode: 'en', observedAt, cacheFetchedAt: observedAt, cacheStatus: 'hit',
        successfulEmpty: false, payloadFingerprint: 'b'.repeat(64), sourceRowsFetched: 1,
        acceptedCount: 1, droppedCount: 0,
      },
    ])
    .returning();
  await db.insert(pagePerformanceKeywords).values(
    pageParents.map((parent) => ({
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
  const observedAtApp = new Date('2026-08-09T12:00:00.000Z');
  const observation = {
    sourceKind: 'provider_observation' as const,
    sourceLabel: 'dataforseo' as const,
    observedAt: observedAtApp.toISOString(),
    freshUntil: null,
    freshness: 'fresh' as const,
    market: null,
    sampleCount: 1,
    coverageNoteKey: null,
  };
  const appKeywordRows = await db
    .insert(appKeywords)
    .values([
      {
        accountId: accountA, siteId: 'app-site-a', profileId: 'app-profile-a',
        store: 'google_play', phrase: 'delete phrase', locationCode: 2840,
        languageCode: 'en',
      },
      {
        accountId: accountB, siteId: 'app-site-b', profileId: 'app-profile-b',
        store: 'app_store', phrase: 'keep phrase', locationCode: 2840,
        languageCode: 'en',
      },
    ])
    .returning({ id: appKeywords.id, accountId: appKeywords.accountId });
  await db.insert(appRankSnapshots).values(
    appKeywordRows.map((row) => ({
      accountId: row.accountId,
      siteId: row.accountId === accountA ? 'app-site-a' : 'app-site-b',
      keywordId: row.id,
      checkedAt: observedAtApp,
      observationMeta: observation,
    })),
  );
  for (const accountId of [accountA, accountB]) {
    const suffix = accountId === accountA ? 'a' : 'b';
    await db.insert(appChartSnapshots).values({
      accountId,
      siteId: `app-site-${suffix}`,
      profileId: `app-profile-${suffix}`,
      store: 'google_play',
      chartId: 'top_free',
      checkedAt: observedAtApp,
      observationMeta: observation,
    });
    await db.insert(appListingSnapshots).values({
      accountId,
      siteId: `app-site-${suffix}`,
      profileId: `app-profile-${suffix}`,
      store: 'google_play',
      capturedAt: observedAtApp,
      listing: {},
      findings: {},
      observationMeta: observation,
    } as never);
  }
}

async function expectDeletionBarrier(promise: Promise<unknown>): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as { cause?: { message?: string } }).cause?.message).toMatch(
    /account deletion has started/,
  );
}

describe('account Postgres lifecycle', () => {
  it('fails explicit schema invariants closed', () => {
    expect(() =>
      accountPostgresCascadeTestables.requiredColumn(
        { name: 'user', columns: {} } as never,
        'id',
      ),
    ).toThrow('account purge column id is missing from user');
    expect(() =>
      accountPostgresCascadeTestables.deletionPredicate(
        { name: 'orphan', columns: {} } as never,
        accountA,
      ),
    ).toThrow('account purge has no ownership predicate for orphan');
    expect(() =>
      accountPostgresCascadeTestables.requiredRegisteredTable(new Map(), 'missing_table'),
    ).toThrow('account purge table is not registered: missing_table');
  });

  it('ratchets every account-owned table into erase or narrow retention and installs every trigger', async () => {
    const owned = registeredAccountOwnedPostgresTableNames();
    expect(
      [...ACCOUNT_ERASED_POSTGRES_TABLE_NAMES, ...ACCOUNT_RETAINED_POSTGRES_TABLE_NAMES].sort(),
    ).toEqual(owned);

    const triggerResult = await getTestDb().execute(sql`
      select distinct event_object_table as table_name
      from information_schema.triggers
      where trigger_name like '%_account_deletion_guard'
      order by event_object_table
    `);
    const triggered = triggerResult.rows.map((row) => String(row.table_name));
    expect(triggered).toEqual(expect.arrayContaining(
      [
        ...owned.filter(
          (name) =>
            name !== 'account_deletion_provider_refs' &&
            name !== 'account_deletion_tombstones',
        ),
        // Better Auth verification ownership is encoded in `value`, so it is
        // deliberately outside the structural accountId/userId table ratchet.
        'verification',
      ],
    ));
    const functionResult = await getTestDb().execute(sql`
      select pg_get_functiondef('reject_deleted_account_write()'::regprocedure) as definition
    `);
    const definition = String(functionResult.rows[0]?.definition ?? '');
    expect(definition).toContain('pg_advisory_xact_lock_shared');
    expect(definition).toContain('rankme.fast:account-deletion-global:v1');
    expect(definition).not.toContain('hashtext(candidate)');
  });

  it('erases product/identity rows, pseudonymizes cross-account actors, and keeps control rows', async () => {
    await seedAccountRows();
    const db = getTestDb();
    await installAccountDeletionBarrier(
      db as unknown as ApplicationDb,
      accountA,
      new Date('2026-08-01T00:00:00Z'),
    );

    await purgeAccountPostgresData(db as unknown as ApplicationDb, {
      accountId: accountA,
      email: 'delete-pg@example.com',
    });
    const pseudonym = deletedAccountPseudonym(accountA);

    expect(await db.select().from(apiKeys).where(eq(apiKeys.accountId, accountA))).toEqual([]);
    expect(await db.select().from(authUser).where(eq(authUser.id, accountA))).toEqual([]);
    expect(await db.select().from(verification).where(eq(verification.value, accountA))).toEqual([]);
    expect(
      await db.select().from(verification).where(eq(verification.id, 'verification-delete-email')),
    ).toEqual([]);
    expect(await db.select().from(verification).where(eq(verification.value, accountB)))
      .toHaveLength(1);
    expect(await db.select().from(apiKeys).where(eq(apiKeys.accountId, accountB))).toHaveLength(1);
    expect(
      await db.select().from(pagePerformanceSnapshots).where(eq(pagePerformanceSnapshots.accountId, accountA)),
    ).toEqual([]);
    expect(
      await db.select().from(pagePerformanceKeywords).where(eq(pagePerformanceKeywords.accountId, accountA)),
    ).toEqual([]);
    expect(
      await db.select().from(pagePerformanceSnapshots).where(eq(pagePerformanceSnapshots.accountId, accountB)),
    ).toHaveLength(1);
    expect(
      await db.select().from(pagePerformanceKeywords).where(eq(pagePerformanceKeywords.accountId, accountB)),
    ).toHaveLength(1);
    expect(await db.select().from(appKeywords).where(eq(appKeywords.accountId, accountA)))
      .toEqual([]);
    expect(await db.select().from(appRankSnapshots).where(eq(appRankSnapshots.accountId, accountA)))
      .toEqual([]);
    expect(await db.select().from(appChartSnapshots).where(eq(appChartSnapshots.accountId, accountA)))
      .toEqual([]);
    expect(await db.select().from(appListingSnapshots).where(eq(appListingSnapshots.accountId, accountA)))
      .toEqual([]);
    expect(await db.select().from(appKeywords).where(eq(appKeywords.accountId, accountB)))
      .toHaveLength(1);
    expect(await db.select().from(appRankSnapshots).where(eq(appRankSnapshots.accountId, accountB)))
      .toHaveLength(1);
    expect(await db.select().from(appChartSnapshots).where(eq(appChartSnapshots.accountId, accountB)))
      .toHaveLength(1);
    expect(await db.select().from(appListingSnapshots).where(eq(appListingSnapshots.accountId, accountB)))
      .toHaveLength(1);

    expect(await db.select().from(actionEvents).where(eq(actionEvents.idempotencyKey, 'action-cross'))).toMatchObject([
      { accountId: accountB, actorUserId: pseudonym },
    ]);
    expect(await db.select().from(contentRecommendationEvents).where(eq(contentRecommendationEvents.idempotencyKey, 'rec-cross'))).toMatchObject([
      { accountId: accountB, actorUserId: pseudonym },
    ]);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.inviteTokenHash, 'd'.repeat(64))),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.inviteTokenHash, 'f'.repeat(64))),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.inviteTokenHash, 'g'.repeat(64))),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.inviteTokenHash, 'c'.repeat(64))),
    ).toMatchObject([
      { teamId: accountB, userId: accountB, invitedBy: pseudonym, acceptedAt: expect.any(Date) },
    ]);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.inviteTokenHash, 'e'.repeat(64))),
    ).toMatchObject([
      { teamId: accountB, userId: null, invitedBy: accountB, acceptedAt: null },
    ]);
    expect(await db.select().from(accountDeletionTombstones)).toMatchObject([
      { accountId: accountA },
    ]);
  });

  it('permanently rejects inserts, updates, and actor links after the tombstone', async () => {
    await seedAccountRows();
    const db = getTestDb();
    await installAccountDeletionBarrier(
      db as unknown as ApplicationDb,
      accountA,
      new Date('2026-08-01T00:00:00Z'),
    );

    await expectDeletionBarrier(
      db.insert(apiKeys).values({
        accountId: accountA,
        name: 'late',
        keyHash: 'd'.repeat(64),
        prefix: 'rmf_late',
      }),
    );
    await expectDeletionBarrier(
      db.update(apiKeys).set({ accountId: accountA }).where(eq(apiKeys.accountId, accountB)),
    );
    await expectDeletionBarrier(
      db.insert(actionEvents).values({
        accountId: accountB,
        siteId: 'site-late',
        actionId: '5'.repeat(64),
        sourceType: 'audit_finding',
        sourceIdRef: '6'.repeat(64),
        newState: 'planned',
        eventKind: 'plan',
        actorUserId: accountA,
        ordinal: 1,
        idempotencyKey: 'late-actor',
      }),
    );
    await expectDeletionBarrier(
      db.insert(pagePerformanceSnapshots).values({
        accountId: accountA,
        siteId: 'late-site',
        source: 'demo',
        locationCode: 2840,
        languageCode: 'en',
        observedAt: new Date(),
        cacheFetchedAt: new Date(),
        cacheStatus: 'miss',
        successfulEmpty: true,
        payloadFingerprint: 'c'.repeat(64),
        sourceRowsFetched: 0,
        acceptedCount: 0,
        droppedCount: 0,
      }),
    );
    // Better Auth password-reset and delete-account verification rows store
    // the principal in `value`, not `identifier`. The forward trigger closes
    // the insert-after-purge race for both real row shapes.
    await expectDeletionBarrier(
      db.insert(verification).values({
        id: 'late-reset-token',
        identifier: 'reset-password:late-token',
        value: accountA,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      }),
    );
    await expectDeletionBarrier(
      db.insert(verification).values({
        id: 'late-delete-token',
        identifier: 'delete-account-late-token',
        value: accountA,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      }),
    );
    await expect(
      db.insert(apiKeys).values({
        accountId: 'cccccccccccccccccccccccc',
        name: 'unrelated',
        keyHash: 'e'.repeat(64),
        prefix: 'rmf_ok',
      }),
    ).resolves.toBeDefined();
  });
});
