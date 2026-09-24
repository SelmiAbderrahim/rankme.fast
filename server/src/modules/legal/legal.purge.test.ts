import { Writable } from 'node:stream';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { eq, isNull, or } from 'drizzle-orm';
import { Types } from 'mongoose';
import pino, { type Logger } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationDb } from '../../shared/types/application-db.js';
import type { Queues } from '../../shared/queue/index.js';
import { createFakeGscProvider } from '../../shared/providers/index.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  account as authAccount,
  apiKeys,
  backlinkSnapshots,
  competitorIntersections,
  competitors,
  contentAnalysisEvents,
  contentInventoryEvents,
  contentRecommendationEvents,
  contentRecommendationOutcomes,
  domainStates,
  keywords,
  rankings,
  session,
  teamMembers,
  twoFactor,
  user as authUser,
  vendorCache,
  vendorResponses,
  verification,
} from '../../db/schema/index.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { AuditedPage } from '../audits/audited-page.model.js';
import { ReportSnapshot } from '../audits/report-snapshot.model.js';
import {
  GoogleConnection,
  setGoogleConnectionsDb,
  setGoogleGscProvider,
  upsertConnection,
} from '../google-connections/index.js';
import { setRanksQueue } from '../ranks/index.js';
import {
  Site,
  deleteSite,
  setSiteLifecycleQueues,
} from '../sites/index.js';
import { setSitesDb } from '../sites/sites.holder.js';
import { User } from '../users/index.js';
import { AuditLog } from '../audit/index.js';
import {
  ContentAnalysis,
  ContentSnapshot,
  ContentInventoryRun,
  ContentInventoryPage,
  ContentInventorySnapshot,
} from '../content-intelligence/index.js';
import {
  CompetitorContentRun,
  CompetitorPageFacts,
  CompetitorContentSnapshot,
} from '../competitor-content/index.js';
import {
  ContentMonitor,
  MonitorWebhookReceipt,
  MonitorEvidence,
} from '../content-monitoring/index.js';
import {
  AccountPurgeBusyError,
  createAccountPurgeProcessor,
  purgeAccount,
} from './legal.purge.js';
import {
  acquireAccountWorkLease,
  releaseAccountWorkLease,
} from './account-lifecycle.js';
import {
  deletedMongoActorId,
  deletedMongoReference,
} from './account-retained-mongo.js';

interface RecordingLogger {
  logger: Logger;
  lines: string[];
}

interface SeededAccount {
  userId: string;
  email: string;
  siteId: string;
  contentAnalysisId: string;
  runId: string;
  keywordId: string;
  inventoryRunId: string;
}

function createRecordingLogger(): RecordingLogger {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: pino(stream), lines };
}

function job(data: unknown): Job {
  return { data } as Job;
}

function objectIdHex(): string {
  return new Types.ObjectId().toString();
}

function emptyQueues(): Queues {
  const queue = {
    getJobs: vi.fn(async () => []),
    getJobSchedulers: vi.fn(async () => []),
    removeJobScheduler: vi.fn(async () => false),
  };
  return {
    audits: queue,
    ranks: queue,
    accountPurge: queue,
    gscSync: queue,
    ga4Sync: queue,
    contentAnalysis: queue,
    contentInventory: queue,
    internalLinks: queue,
    keywordClusters: queue,
    competitorContent: queue,
    competitorLandscapes: queue,
    contentMonitor: queue,
    audienceResearch: queue,
    weeklyPulse: queue,
    clientReports: queue,
    backlinkDeep: queue,
    trafficSnapshots: queue,
    reviewSync: queue,
    brandRadar: queue,
    contentBrief: queue,
    geogrid: queue,
    alertDispatch: queue,
    deadLetter: queue,
    close: vi.fn(async () => undefined),
  } as unknown as Queues;
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  setSitesDb(db as unknown as ApplicationDb);
  setGoogleConnectionsDb(db as never);
});

afterAll(async () => {
  setSitesDb(null);
  setRanksQueue(null);
  setSiteLifecycleQueues(null);
  setGoogleGscProvider(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setRanksQueue(null);
  setSiteLifecycleQueues(emptyQueues());
  setGoogleGscProvider(createFakeGscProvider());
});

describe('account purge processor', () => {
  it('names the busy error', () => {
    expect(new AccountPurgeBusyError()).toMatchObject({
      name: 'AccountPurgeBusyError',
      message: 'account purge is waiting for active account work',
    });
  });

  it('processes a valid queued purge payload', async () => {
    const accountA = await seedAccount('processor-a');
    const processor = createAccountPurgeProcessor({
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
    });
    await expect(processor(job({ userId: accountA.userId }))).resolves.toMatchObject({
      userId: accountA.userId,
      sites: 1,
    });
  });

  it('re-delays an early delivery to the exact Mongo schedule and completes a cancelled one', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const purgeAt = new Date('2026-08-01T00:00:30Z');
    const early = await seedAccount('early-delivery', { deletionScheduledAt: purgeAt });
    const moveToDelayed = vi.fn(async () => undefined);
    const processor = createAccountPurgeProcessor({
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
      now: () => now,
    });
    await expect(
      processor({
        data: { userId: early.userId },
        token: 'worker-token',
        moveToDelayed,
      } as unknown as Job),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(purgeAt.getTime(), 'worker-token');

    await User.updateOne(
      { _id: early.userId },
      { $set: { deletionScheduledAt: null } },
    );
    await expect(
      processor({
        data: { userId: early.userId },
        token: 'worker-token',
        moveToDelayed,
      } as unknown as Job),
    ).resolves.toEqual({ userId: early.userId, skipped: 'not-scheduled' });
    expect(moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('does not re-delay when the early schedule disappears after the not-due claim', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const early = await seedAccount('early-disappeared', {
      deletionScheduledAt: new Date(now.getTime() + 30_000),
    });
    const moveToDelayed = vi.fn(async () => undefined);
    const processor = createAccountPurgeProcessor({
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
      now: () => now,
      afterNotDueClaim: async () => {
        await User.collection.updateOne(
          { _id: new Types.ObjectId(early.userId) },
          { $set: { deletionScheduledAt: null } },
        );
      },
    });
    await expect(
      processor({ data: { userId: early.userId }, token: 'worker', moveToDelayed } as never),
    ).resolves.toEqual({ userId: early.userId, skipped: 'not-due' });
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it('rejects a live work lease and handles disappearance after a won claim', async () => {
    const busy = await seedAccount('purge-busy');
    const lease = await acquireAccountWorkLease(busy.userId, 'purge-blocker');
    if (!lease) throw new Error('expected account work lease');
    await expect(
      purgeAccount(busy.userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
      }),
    ).rejects.toBeInstanceOf(AccountPurgeBusyError);
    await releaseAccountWorkLease(lease);

    const disappeared = await seedAccount('purge-claim-disappeared');
    await expect(
      purgeAccount(disappeared.userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
        afterDeletionClaim: async () => {
          await User.collection.deleteOne({ _id: new Types.ObjectId(disappeared.userId) });
        },
      }),
    ).resolves.toEqual({ userId: disappeared.userId, skipped: 'user-missing' });
  });

  it('fails closed when a Mongo Google connection exists without a revocation provider', async () => {
    const account = await seedAccount('mongo-google-outage');
    await expect(
      purgeAccount(account.userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
        queues: emptyQueues(),
        gscProvider: null,
      }),
    ).rejects.toThrow('Google token revocation is unavailable');
    expect(await User.findById(account.userId)).not.toBeNull();
  });

  it('purge completeness — every account store emptied, control account untouched', async () => {
    const db = getTestDb();
    const accountA = await seedAccount('purge-a');
    const accountB = await seedAccount('control-b');
    await seedCrossMembership({ memberUserId: accountA.userId, teamId: accountB.userId });
    await seedSharedVendorRows();

    const rec = createRecordingLogger();
    await purgeAccount(accountA.userId, {
      db: db as unknown as ApplicationDb,
      logger: rec.logger,
    });

    await expectAccountGone(accountA);
    await expectAccountPresent(accountB);
    await expectSharedVendorRowsSurvive();
    expect(await teamMembershipCountFor(accountA.userId)).toBe(0);
    expect(await teamMembershipCountFor(accountB.userId)).toBe(1);
    expect(rec.lines.join('\n')).toContain('account purge complete');
    const completion = await AuditLog.findOne({
      action: 'data.delete.completed',
      targetId: deletedMongoReference(accountA.userId),
    }).lean();
    expect(completion).toMatchObject({
      actorUserId: deletedMongoActorId(accountA.userId),
      ip: '',
      metadata: { redacted: true },
    });
  });

  it('revokes Better Auth social-only and Mongo GSC credentials before local purge', async () => {
    const accountA = await seedAccount('oauth-mixed');
    await getTestDb().insert(authAccount).values({
      id: 'oauth-mixed-google',
      accountId: 'oauth-mixed-provider-account',
      providerId: 'google',
      userId: accountA.userId,
      accessToken: 'social-access-token',
      refreshToken: 'social-refresh-token',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const revokeToken = vi.fn(async (_token: string) => undefined);
    await purgeAccount(accountA.userId, {
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
      queues: emptyQueues(),
      gscProvider: { ...createFakeGscProvider(), revokeToken },
    });
    expect(new Set(revokeToken.mock.calls.map(([token]) => token))).toEqual(
      new Set([
        'oauth-mixed-refresh-token',
        'social-access-token',
        'social-refresh-token',
      ]),
    );
    expect(await User.findById(accountA.userId)).toBeNull();
  });

  it('fails closed on social OAuth tokens when Google revocation is unavailable', async () => {
    const accountA = await seedAccount('oauth-outage', { googleConnection: false });
    await getTestDb().insert(authAccount).values({
      id: 'oauth-outage-google',
      accountId: 'oauth-outage-provider-account',
      providerId: 'google',
      userId: accountA.userId,
      refreshToken: 'must-remain-retryable',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await expect(
      purgeAccount(accountA.userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
        queues: emptyQueues(),
        gscProvider: null,
      }),
    ).rejects.toThrow('Google token revocation is unavailable');
    expect(await User.findById(accountA.userId)).not.toBeNull();
    expect(
      await getTestDb()
        .select()
        .from(authAccount)
        .where(eq(authAccount.userId, accountA.userId)),
    ).toHaveLength(2);
  });

  it('idempotent — second run is a clean no-op', async () => {
    const accountA = await seedAccount('idempotent-a');
    const rec = createRecordingLogger();
    const deps = { db: getTestDb() as unknown as ApplicationDb, logger: rec.logger };
    await purgeAccount(accountA.userId, deps);
    await expect(purgeAccount(accountA.userId, deps)).resolves.toEqual({
      userId: accountA.userId,
      skipped: 'user-missing',
    });
    expect(rec.lines.join('\n')).toContain('account purge skipped');
  });

  it('in-flight audits are force-terminated, not a 409', async () => {
    const accountA = await seedAccount('running-a', { auditStatus: 'running' });
    await expect(
      purgeAccount(accountA.userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
      }),
    ).resolves.toMatchObject({ userId: accountA.userId, sites: 1 });
    expect(await Site.countDocuments({ accountId: accountA.userId })).toBe(0);
  });

  it('cancelled/deferred users are skipped', async () => {
    const legalHold = await seedAccount('held-a', { legalHold: true });
    const cancelled = await seedAccount('cancelled-a', { deletionScheduledAt: null });
    const deps = { db: getTestDb() as unknown as ApplicationDb, logger: createRecordingLogger().logger };

    await expect(purgeAccount(legalHold.userId, deps)).resolves.toEqual({
      userId: legalHold.userId,
      skipped: 'legal-hold',
    });
    await expect(purgeAccount(cancelled.userId, deps)).resolves.toEqual({
      userId: cancelled.userId,
      skipped: 'not-scheduled',
    });
    expect(await User.exists({ _id: legalHold.userId })).not.toBeNull();
    expect(await User.exists({ _id: cancelled.userId })).not.toBeNull();
  });

  it('repairs a crash-pending cancellation before any purge claim', async () => {
    const account = await seedAccount('pending-cancel');
    const requestedAt = new Date('2026-08-05T00:00:00Z');
    await User.updateOne(
      { _id: account.userId },
      {
        $set: {
          deletionCancellationId: 'cancel-pending-crash',
          deletionCancellationRequestedAt: requestedAt,
        },
      },
    );

    await expect(
      purgeAccount(account.userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
      }),
    ).resolves.toEqual({ userId: account.userId, skipped: 'not-scheduled' });
    const user = await User.findById(account.userId).lean();
    expect(user?.deletionScheduledAt ?? null).toBeNull();
    expect(user?.deletionStartedAt ?? null).toBeNull();
    expect(user?.deletionCancellationRequestedAt ?? null).toBeNull();
    expect(
      await AuditLog.countDocuments({
        actorUserId: account.userId,
        action: 'data.delete.cancelled',
      }),
    ).toBe(1);
  });

  it('keeps the User manifest and repairs completion audit failure on retry', async () => {
    const account = await seedAccount('completion-audit-retry');
    const deps = {
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
    };
    const auditWrite = vi
      .spyOn(AuditLog, 'updateOne')
      .mockRejectedValueOnce(new Error('completion audit unavailable'));
    await expect(purgeAccount(account.userId, deps)).rejects.toThrow(
      'completion audit unavailable',
    );
    auditWrite.mockRestore();
    expect(await User.findById(account.userId)).not.toBeNull();

    await expect(purgeAccount(account.userId, deps)).resolves.toMatchObject({
      userId: account.userId,
    });
    expect(await User.findById(account.userId)).toBeNull();
    expect(
      await AuditLog.countDocuments({
        action: 'data.delete.completed',
        targetId: deletedMongoReference(account.userId),
      }),
    ).toBe(1);
  });

  it('revalidates the deletion-attempt lease after completion audit and before User delete', async () => {
    const account = await seedAccount('completion-lease-loss');
    const db = getTestDb() as unknown as ApplicationDb;
    await expect(
      purgeAccount(account.userId, {
        db,
        logger: createRecordingLogger().logger,
        afterCompletionAudit: async () => {
          await User.updateOne(
            { _id: account.userId },
            {
              $set: {
                deletionAttemptLeaseId: 'stolen-after-audit',
                deletionAttemptExpiresAt: new Date(Date.now() + 60_000),
              },
            },
          );
        },
      }),
    ).rejects.toThrow('account deletion attempt lease was lost or expired');
    expect(await User.findById(account.userId)).not.toBeNull();

    await User.updateOne(
      { _id: account.userId },
      { $set: { deletionAttemptExpiresAt: new Date(0) } },
    );
    await expect(
      purgeAccount(account.userId, {
        db,
        logger: createRecordingLogger().logger,
      }),
    ).resolves.toMatchObject({ userId: account.userId });
    expect(await User.findById(account.userId)).toBeNull();
    expect(
      await AuditLog.countDocuments({
        action: 'data.delete.completed',
        targetId: deletedMongoReference(account.userId),
      }),
    ).toBe(1);
  });

  it('malformed payload dead-letters via UnrecoverableError', async () => {
    const processor = createAccountPurgeProcessor({
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
    });
    await expect(processor(job({ userId: 'nope' }))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('purges a scheduled user with zero sites', async () => {
    const userId = objectIdHex();
    await User.create({
      _id: userId,
      email: 'zero-sites@example.com',
      deletionScheduledAt: new Date('2026-01-01T00:00:00Z'),
    });
    await getTestDb().insert(authUser).values({
      id: userId,
      name: 'Zero Sites',
      email: 'zero-sites@example.com',
      emailVerified: true,
    });
    await expect(
      purgeAccount(userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
      }),
    ).resolves.toMatchObject({ userId, sites: 0 });
    expect(await User.exists({ _id: userId })).toBeNull();
  });

  it('partial site-cascade re-run converges', async () => {
    const accountA = await seedAccount('partial-a');
    await deleteSite(accountA.userId, accountA.siteId);

    await purgeAccount(accountA.userId, {
      db: getTestDb() as unknown as ApplicationDb,
      logger: createRecordingLogger().logger,
    });

    await expectAccountGone(accountA);
  });

  // Regression: mongoose@8 sometimes returns a bare acknowledgement without
  // a `deletedCount` (driver-level oddity on collections that never existed).
  // The stats aggregator uses `?? 0` fallbacks; without this test those
  // defensive branches read as uncovered under v8.
  describe('stats aggregator fallbacks', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('falls back to 0 when every deleteMany returns no deletedCount', async () => {
      const userId = objectIdHex();
      await User.create({
        _id: userId,
        email: 'nullish-counts@example.com',
        deletionScheduledAt: new Date('2026-01-01T00:00:00Z'),
      });
      await getTestDb().insert(authUser).values({
        id: userId,
        name: 'Nullish',
        email: 'nullish-counts@example.com',
        emailVerified: true,
      });

      const emptyAck = { acknowledged: true } as {
        acknowledged: true;
        deletedCount?: number;
      };
      vi.spyOn(AuditRun, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(AuditedPage, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ReportSnapshot, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(GoogleConnection, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ContentAnalysis, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ContentSnapshot, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ContentInventorySnapshot, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ContentInventoryPage, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ContentInventoryRun, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(CompetitorContentSnapshot, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(CompetitorPageFacts, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(CompetitorContentRun, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(MonitorEvidence, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(MonitorWebhookReceipt, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(ContentMonitor, 'deleteMany').mockResolvedValueOnce(emptyAck as never);
      vi.spyOn(CompetitorContentRun, 'find').mockReturnValueOnce({
        lean: async () => [{ _id: new Types.ObjectId() }],
      } as never);

      const stats = await purgeAccount(userId, {
        db: getTestDb() as unknown as ApplicationDb,
        logger: createRecordingLogger().logger,
      });
      expect(stats).toMatchObject({
        userId,
        mongoRuns: 0,
        auditedPages: 0,
        reportSnapshots: 0,
        googleConnections: 0,
        contentAnalyses: 0,
        contentSnapshots: 0,
        contentInventoryRuns: 0,
        contentInventoryPages: 0,
        contentInventorySnapshots: 0,
        competitorContentRuns: 0,
        competitorContentPages: 0,
        competitorContentSnapshots: 0,
        contentMonitors: 0,
        monitorWebhookReceipts: 0,
        monitorEvidence: 0,
      });
    });
  });
});

async function seedAccount(
  label: string,
  opts: {
    auditStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'unavailable';
    deletionScheduledAt?: Date | null;
    legalHold?: boolean;
    googleConnection?: boolean;
  } = {},
): Promise<SeededAccount> {
  const userId = objectIdHex();
  const email = `${label}@example.com`;
  const deletionScheduledAt =
    opts.deletionScheduledAt === undefined
      ? new Date('2026-01-01T00:00:00Z')
      : opts.deletionScheduledAt;
  await User.create({
    _id: userId,
    email,
    profile: { firstName: label, lastName: 'User' },
    deletionScheduledAt,
    legalHold: opts.legalHold ?? false,
  });
  await getTestDb().insert(authUser).values({
    id: userId,
    name: label,
    email,
    emailVerified: true,
  });
  await getTestDb().insert(session).values({
    id: `${label}-session`,
    token: `${label}-token`,
    userId,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await getTestDb().insert(authAccount).values({
    id: `${label}-account`,
    accountId: `${label}-provider-account`,
    providerId: 'credential',
    userId,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await getTestDb().insert(twoFactor).values({
    id: `${label}-two-factor`,
    secret: `${label}-secret`,
    backupCodes: `${label}-codes`,
    userId,
  });
  await getTestDb().insert(verification).values({
    id: `${label}-verification`,
    identifier: email,
    value: `${label}-value`,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
  });

  const site = await Site.create({
    accountId: userId,
    url: `https://${label}.example.com`,
    domain: `${label}.example.com`,
  });
  const run = await AuditRun.create({
    accountId: userId,
    siteId: site._id,
    status: opts.auditStatus ?? 'succeeded',
    pageCap: 10,
  });
  await AuditedPage.create({
    runId: run._id,
    url: `https://${label}.example.com/`,
    statusCode: 200,
    onPageScore: 99,
  });
  await ReportSnapshot.create({
    runId: run._id,
    siteId: site._id,
    accountId: userId,
    findings: [],
    counts: { fixNow: 0, watch: 0, passed: 0 },
  });

  const siteId = site._id.toString();
  const contentAnalysis = await ContentAnalysis.create({
    accountId: userId,
    ownerUserId: userId,
    siteId,
    ownedUrl: `https://${label}.example.com/guide`,
    keyword: `${label} content`,
    locale: 'en',
    status: 'completed',
    stages: [],
    inputFingerprint: `${label}-content-fingerprint`,
    idempotencyKey: `${label}-content-idempotency`,
    providerRefs: { snapshotIds: [] },
    recommendations: [],
    recommendationStates: [],
    reservation: {
      key: `${label}-content-reservation`,
      reservedAt: new Date('2026-01-01T00:00:00Z'),
      reservedUnits: 1,
    },
    requestedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-02T00:00:00Z'),
  });
  await ContentSnapshot.create({
    analysisId: contentAnalysis._id,
    role: 'owned',
    sourceUrl: `https://${label}.example.com/guide`,
    excerpt: 'Bounded account-owned excerpt.',
    derivedFacts: {
      headings: ['Guide'],
      links: [],
      wordCount: 3,
      hasSchemaOrgArticle: false,
      canonical: null,
    },
    contentHash: `${label}-hash`,
    retrievedAt: new Date('2026-01-01T00:00:00Z'),
    retrievalCost: { micros: 0, provider: 'fake' },
    expiryAt: new Date('2027-01-01T00:00:00Z'),
  });
  const [keyword] = await getTestDb()
    .insert(keywords)
    .values({
      accountId: userId,
      siteId,
      phrase: `${label} keyword`,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    })
    .returning({ id: keywords.id });
  if (!keyword) throw new Error('keyword seed failed');
  await getTestDb().insert(rankings).values({
    keywordId: keyword.id,
    position: 1,
    rankAbsolute: 1,
    foundUrl: `https://${label}.example.com/`,
    checkedAt: new Date('2026-01-01T00:00:00Z'),
    source: 'fresh',
  });
  await getTestDb().insert(domainStates).values({ siteId, cadence: 'weekly' });
  await getTestDb().insert(backlinkSnapshots).values({
    accountId: userId,
    siteId,
    domainRating: 40,
    backlinks: 100,
    referringDomains: 25,
    brokenBacklinks: 1,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await getTestDb().insert(competitors).values({
    accountId: userId,
    siteId,
    competitorDomain: `${label}-rival.example.com`,
    intersections: 2,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    snapshotDay: '2026-01-01',
  });
  await getTestDb().insert(competitorIntersections).values({
    accountId: userId,
    siteId,
    competitorDomain: `${label}-rival.example.com`,
    keywords: [{ phrase: `${label} keyword` }],
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
  });

  await getTestDb().insert(contentAnalysisEvents).values({
    accountId: userId,
    siteId,
    analysisId: String(contentAnalysis._id),
    reservationKey: `${label}-content-reservation`,
    kind: 'completed',
    units: 0,
    recordedAt: new Date('2026-01-02T00:00:00Z'),
  });

  // Content inventory (prompt 08) — run + derived-facts page + TTL snapshot +
  // an events archive row, all account-scoped for the purge sweep.
  const inventoryRun = await ContentInventoryRun.create({
    accountId: userId,
    ownerUserId: userId,
    siteId,
    origin: `https://${label}.example.com`,
    locale: 'en',
    status: 'completed',
    input: { pageLimit: 4, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    progress: { pagesRequested: 4, pagesProcessed: 2, pagesFailed: 0, blocksReserved: 1 },
    reservation: { key: `${label}-inv-reservation`, reservedAt: new Date('2026-01-01T00:00:00Z'), reservedUnits: 1, refundedUnits: 0 },
    stages: [],
    warnings: [],
    error: null,
    inputFingerprint: `${label}-inv-fingerprint`,
    idempotencyKey: `${label}-inv-idempotency`,
    thresholdsVersion: '1',
    findings: null,
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-02T00:00:00Z'),
  });
  await ContentInventoryPage.create({
    runId: inventoryRun._id,
    accountId: userId,
    siteId,
    url: `https://${label}.example.com/a`,
    contentHash: `${label}-inv-hash`,
    createdAtMs: Date.now(),
    facts: { url: `https://${label}.example.com/a` },
  });
  await ContentInventorySnapshot.create({
    runId: inventoryRun._id,
    sourceUrl: `https://${label}.example.com/a`,
    excerpt: 'Bounded inventory excerpt.',
    contentHash: `${label}-inv-hash`,
    retrievedAt: new Date('2026-01-01T00:00:00Z'),
    expiryAt: new Date('2027-01-01T00:00:00Z'),
  });
  await getTestDb().insert(contentInventoryEvents).values({
    accountId: userId,
    siteId,
    runId: String(inventoryRun._id),
    reservationKey: `${label}-inv-reservation`,
    kind: 'reserved',
    units: 1,
    recordedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const recommendationEvents = await getTestDb()
    .insert(contentRecommendationEvents)
    .values({
      accountId: userId,
      siteId,
      analysisId: String(contentAnalysis._id),
      recommendationId: `${label}-rec`,
      analysisVersion: '2026-07-15.1',
      eventKind: 'applied',
      priorState: 'accepted',
      newState: 'applied',
      stateVersion: 2,
      actorUserId: userId,
      contentHash: `${label}-hash`,
      analysisContentHash: `${label}-hash`,
      appliedAt: new Date('2026-01-03T00:00:00Z'),
      baselineAnchorAt: new Date('2026-01-03T00:00:00Z'),
      idempotencyKey: `${label}-recommendation-event`,
      recordedAt: new Date('2026-01-03T00:00:00Z'),
    })
    .returning();
  await getTestDb().insert(contentRecommendationOutcomes).values({
    accountId: userId,
    siteId,
    analysisId: String(contentAnalysis._id),
    recommendationId: `${label}-rec`,
    appliedEventId: recommendationEvents[0]!.id,
    aggregationVersion: '2026-07-15.1',
    source: 'rank',
    phase: 'following',
    observedDate: new Date('2026-01-04T00:00:00Z'),
    rankPosition: 4,
  });

  await seedAccountScopedPostgres(label, userId);
  if (opts.googleConnection !== false) {
    await upsertConnection({
      accountId: userId,
      googleAccountEmail: `${label}@google.example.com`,
      refreshToken: `${label}-refresh-token`,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
  }

  return {
    userId,
    email,
    siteId,
    contentAnalysisId: contentAnalysis._id.toString(),
    runId: run._id.toString(),
    keywordId: keyword.id,
    inventoryRunId: inventoryRun._id.toString(),
  };
}

async function seedAccountScopedPostgres(label: string, userId: string): Promise<void> {
  const db = getTestDb();
  await db.insert(apiKeys).values({
    accountId: userId,
    name: `${label} key`,
    keyHash: `${label}-hash`,
    prefix: `${label.slice(0, 8)}_`,
  });
  await db.insert(teamMembers).values({
    teamId: userId,
    userId,
    email: `${label}@example.com`,
    role: 'owner',
    inviteTokenHash: `${label}-owner-token`,
    invitedBy: userId,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    acceptedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await db.insert(vendorResponses).values({
    capability: 'audit',
    operation: 'crawl',
    cacheKey: `${label}-private`,
    params: { label },
    payload: { ok: true },
    accountId: userId,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
  });
}

async function seedCrossMembership(input: { memberUserId: string; teamId: string }): Promise<void> {
  await getTestDb().insert(teamMembers).values({
    teamId: input.teamId,
    userId: input.memberUserId,
    email: 'purge-a@example.com',
    role: 'member',
    inviteTokenHash: 'cross-membership-token',
    invitedBy: input.teamId,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    acceptedAt: new Date('2026-01-01T00:00:00Z'),
  });
}

async function seedSharedVendorRows(): Promise<void> {
  const db = getTestDb();
  await db.insert(vendorResponses).values({
    capability: 'rank',
    operation: 'serp',
    cacheKey: 'shared-response',
    params: { q: 'shared' },
    payload: { ok: true },
    accountId: null,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await db.insert(vendorCache).values({
    capability: 'rank',
    operation: 'serp',
    cacheKey: 'shared-cache',
    params: { q: 'shared' },
    payload: { ok: true },
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-02T00:00:00Z'),
  });
}

async function expectAccountGone(accountA: SeededAccount): Promise<void> {
  const db = getTestDb();
  expect(await User.exists({ _id: accountA.userId })).toBeNull();
  expect(await Site.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await AuditRun.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await AuditedPage.countDocuments({ runId: accountA.runId })).toBe(0);
  expect(await ReportSnapshot.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await GoogleConnection.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await ContentAnalysis.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await ContentSnapshot.countDocuments({ analysisId: accountA.contentAnalysisId })).toBe(0);
  expect(await ContentInventoryRun.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await ContentInventoryPage.countDocuments({ accountId: accountA.userId })).toBe(0);
  expect(await ContentInventorySnapshot.countDocuments({ runId: accountA.inventoryRunId })).toBe(0);
  await expect(rowsForAccount(accountA)).resolves.toEqual({
    apiKeys: 0,
    vendorResponses: 0,
    authUsers: 0,
    sessions: 0,
    accounts: 0,
    twoFactors: 0,
    verifications: 0,
    keywords: 0,
    rankings: 0,
    domainStates: 0,
    backlinkSnapshots: 0,
    competitors: 0,
    competitorIntersections: 0,
    contentAnalysisEvents: 0,
    contentInventoryEvents: 0,
    contentRecommendationEvents: 0,
    contentRecommendationOutcomes: 0,
  });
  expect(
    (await db.select().from(teamMembers).where(eq(teamMembers.teamId, accountA.userId))).length,
  ).toBe(0);
  expect(
    (await db.select().from(teamMembers).where(eq(teamMembers.userId, accountA.userId))).length,
  ).toBe(0);
}

async function expectAccountPresent(accountB: SeededAccount): Promise<void> {
  expect(await User.exists({ _id: accountB.userId })).not.toBeNull();
  expect(await Site.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await AuditRun.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await AuditedPage.countDocuments({ runId: accountB.runId })).toBe(1);
  expect(await ReportSnapshot.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await GoogleConnection.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await ContentAnalysis.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await ContentSnapshot.countDocuments({ analysisId: accountB.contentAnalysisId })).toBe(1);
  expect(await ContentInventoryRun.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await ContentInventoryPage.countDocuments({ accountId: accountB.userId })).toBe(1);
  expect(await ContentInventorySnapshot.countDocuments({ runId: accountB.inventoryRunId })).toBe(1);
  await expect(rowsForAccount(accountB)).resolves.toEqual({
    apiKeys: 1,
    vendorResponses: 1,
    authUsers: 1,
    sessions: 1,
    accounts: 1,
    twoFactors: 1,
    verifications: 1,
    keywords: 1,
    rankings: 1,
    domainStates: 1,
    backlinkSnapshots: 1,
    competitors: 1,
    competitorIntersections: 1,
    contentAnalysisEvents: 1,
    contentInventoryEvents: 1,
    contentRecommendationEvents: 1,
    contentRecommendationOutcomes: 1,
  });
}

async function rowsForAccount(account: SeededAccount) {
  const db = getTestDb();
  const keywordRows = await db
    .select({ id: keywords.id })
    .from(keywords)
    .where(eq(keywords.accountId, account.userId));
  const rankingRows = await db
    .select({ id: rankings.id })
    .from(rankings)
    .where(eq(rankings.keywordId, account.keywordId));
  const userRows = await db
    .select({ email: authUser.email })
    .from(authUser)
    .where(eq(authUser.id, account.userId));
  return {
    apiKeys: (await db.select().from(apiKeys).where(eq(apiKeys.accountId, account.userId)))
      .length,
    vendorResponses: (
      await db.select().from(vendorResponses).where(eq(vendorResponses.accountId, account.userId))
    ).length,
    authUsers: userRows.length,
    sessions: (await db.select().from(session).where(eq(session.userId, account.userId))).length,
    accounts: (
      await db.select().from(authAccount).where(eq(authAccount.userId, account.userId))
    ).length,
    twoFactors: (await db.select().from(twoFactor).where(eq(twoFactor.userId, account.userId)))
      .length,
    verifications: (
      await db.select().from(verification).where(eq(verification.identifier, account.email))
    ).length,
    keywords: keywordRows.length,
    rankings: rankingRows.length,
    domainStates: (await db.select().from(domainStates).where(eq(domainStates.siteId, account.siteId)))
      .length,
    backlinkSnapshots: (
      await db.select().from(backlinkSnapshots).where(eq(backlinkSnapshots.accountId, account.userId))
    ).length,
    competitors: (
      await db.select().from(competitors).where(eq(competitors.accountId, account.userId))
    ).length,
    competitorIntersections: (
      await db
        .select()
        .from(competitorIntersections)
        .where(eq(competitorIntersections.accountId, account.userId))
    ).length,
    contentAnalysisEvents: (
      await db
        .select()
        .from(contentAnalysisEvents)
        .where(eq(contentAnalysisEvents.accountId, account.userId))
    ).length,
    contentInventoryEvents: (
      await db
        .select()
        .from(contentInventoryEvents)
        .where(eq(contentInventoryEvents.accountId, account.userId))
    ).length,
    contentRecommendationEvents: (
      await db
        .select()
        .from(contentRecommendationEvents)
        .where(eq(contentRecommendationEvents.accountId, account.userId))
    ).length,
    contentRecommendationOutcomes: (
      await db
        .select()
        .from(contentRecommendationOutcomes)
        .where(eq(contentRecommendationOutcomes.accountId, account.userId))
    ).length,
  };
}

async function teamMembershipCountFor(userId: string): Promise<number> {
  const rows = await getTestDb()
    .select()
    .from(teamMembers)
    .where(or(eq(teamMembers.teamId, userId), eq(teamMembers.userId, userId)));
  return rows.length;
}

async function expectSharedVendorRowsSurvive(): Promise<void> {
  const db = getTestDb();
  expect((await db.select().from(vendorResponses).where(isNull(vendorResponses.accountId))).length).toBe(1);
  expect((await db.select().from(vendorCache).where(eq(vendorCache.cacheKey, 'shared-cache'))).length).toBe(1);
}
