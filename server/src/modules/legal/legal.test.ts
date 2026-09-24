import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { startMemoryMongo, stopMemoryMongo, clearCollections } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupTestUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { __setCsrfBypassForTests } from '../../shared/middleware/csrf.js';
import { User } from '../users/index.js';
import { AuditLog } from '../audit/index.js';
import type { NextFunction, Request, Response } from 'express';
import {
  cancelAccountDeletion,
  exportUserData,
  getAccountDeletionStatus,
  scheduleAccountDeletion,
  type PurgeQueue,
} from './legal.service.js';
import {
  configureLegalController,
  resetLegalController,
  exportMyData,
  deleteMyAccount,
  cancelMyAccountDeletion,
  accountDeletionStatus,
} from './legal.controller.js';
import { setAccountPurgeQueue } from './legal.queue-holder.js';
import { ACCOUNT_PURGE_JOB_NAME } from '../../shared/queue/index.js';
import {
  competitorContentEvents,
  contentAnalysisEvents,
  contentInventoryEvents,
  contentMonitorEvents,
  contentRecommendationEvents,
  contentRecommendationOutcomes,
  landscapeOpportunityAcceptances,
  landscapePageMatchReviews,
} from '../../db/schema/index.js';
import { ContentAnalysis, ContentInventoryRun } from '../content-intelligence/index.js';
import { CompetitorContentRun } from '../competitor-content/index.js';
import { ContentMonitor } from '../content-monitoring/index.js';
import { setContentIntelligenceDb } from '../content-intelligence/content-intelligence.holders.js';

const app = createApp();

/** Drives an asyncHandler-wrapped controller and resolves with the value passed to next(). */
function invokeHandler(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request>,
): Promise<unknown> {
  return new Promise((resolve) => {
    handler(req as Request, {} as unknown as Response, ((err?: unknown) => resolve(err)) as NextFunction);
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setAccountPurgeQueue(null);
  vi.useRealTimers();
});

async function seedUser(): Promise<{ userId: string }> {
  const user = await User.create({
    email: 'gdpr@example.com',
    profile: { firstName: 'Alice', lastName: 'A' },
    role: 'Member',
  });
  return { userId: user._id.toString() };
}

/**
 * Signup through the real Better Auth endpoint (legal routes are auth-gated
 * but NOT verified-gated). The Mongo mirror is created under the same id;
 * set the domain-profile fields the old direct-insert fixture carried.
 */
async function seedAuthedUser(): Promise<{ userId: string; cookie: string }> {
  const u = await signupTestUser(app, { email: 'gdpr@example.com', name: 'Alice A' });
  await User.updateOne(
    { _id: u.id },
    { $set: { profile: { firstName: 'Alice', lastName: 'A' }, role: 'Member' } },
  );
  return { userId: u.id, cookie: u.cookie };
}

/**
 * Cookie-authenticated mutations are no longer CSRF-exempt (the old bearer
 * `Authorization` header was). Fetch a token and double-submit it.
 */
async function csrfFor(sessionCookie: string): Promise<{ cookie: string; token: string }> {
  const res = await request(app).get('/api/security/csrf-token');
  const token = (res.body as { csrfToken: string }).csrfToken;
  return { cookie: `${sessionCookie}; ${env.CSRF_COOKIE_NAME}=${token}`, token };
}

describe('legal / GDPR', () => {
  describe('exportUserData', () => {
    it('returns the user account', async () => {
      const { userId } = await seedUser();
      const data = await exportUserData(userId);
      expect(data.account.email).toBe('gdpr@example.com');
      expect(data.competitorIntelligence.landscapeRuns).toEqual([]);
    });

    it('exports recommendation history and observed outcome metadata without page prose', async () => {
      const { userId } = await seedUser();
      const siteId = new Types.ObjectId().toString();
      const analysis = await ContentAnalysis.create({
        accountId: userId,
        ownerUserId: userId,
        siteId,
        ownedUrl: 'https://example.com/guide',
        keyword: 'content audit',
        locale: 'en',
        status: 'completed',
        stages: [],
        inputFingerprint: 'export-fingerprint',
        idempotencyKey: 'export-idempotency',
        providerRefs: { snapshotIds: [] },
        recommendations: [],
        recommendationStates: [],
        reservation: { key: 'export-reservation', reservedAt: new Date(), reservedUnits: 1 },
        requestedAt: new Date('2026-06-01T00:00:00Z'),
        completedAt: new Date('2026-06-02T00:00:00Z'),
      });
      const events = await getTestDb().insert(contentRecommendationEvents).values({
        accountId: userId,
        siteId,
        analysisId: String(analysis._id),
        recommendationId: 'rec_1',
        analysisVersion: '2026-07-15.1',
        eventKind: 'applied',
        priorState: 'accepted',
        newState: 'applied',
        stateVersion: 2,
        actorUserId: userId,
        note: 'Applied manually',
        contentHash: 'current-hash',
        analysisContentHash: 'analysis-hash',
        appliedAt: new Date('2026-06-15T00:00:00Z'),
        baselineAnchorAt: new Date('2026-06-15T00:00:00Z'),
        idempotencyKey: 'export-event',
        recordedAt: new Date('2026-06-15T00:00:00Z'),
      }).returning();
      await getTestDb().insert(contentRecommendationOutcomes).values({
        accountId: userId,
        siteId,
        analysisId: String(analysis._id),
        recommendationId: 'rec_1',
        appliedEventId: events[0]!.id,
        aggregationVersion: '2026-07-15.1',
        source: 'gsc',
        phase: 'following',
        observedDate: new Date('2026-06-16T00:00:00Z'),
        clicks: 3,
        impressions: 30,
        ctr: 0.1,
        averagePosition: 7,
        laterEdit: 0,
      });

      const data = await exportUserData(userId, { db: getTestDb() as never });
      expect(data.contentIntelligence.recommendationEvents[0]).toMatchObject({
        analysisVersion: '2026-07-15.1',
        stateVersion: 2,
        contentHash: 'current-hash',
      });
      expect(data.contentIntelligence.outcomes[0]).toMatchObject({
        source: 'gsc',
        phase: 'following',
        clicks: 3,
      });
      expect(JSON.stringify(data)).not.toContain('page prose');
    });

    it('404s a missing user', async () => {
      await expect(exportUserData('507f1f77bcf86cd799439011')).rejects.toMatchObject({ status: 404 });
    });

    it('404s deletion status and cancellation for a missing user', async () => {
      const missingUserId = '507f1f77bcf86cd799439011';
      const queue = { enqueuePurge: vi.fn(async () => undefined) };

      await expect(getAccountDeletionStatus(missingUserId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(cancelAccountDeletion(missingUserId, { queue })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('rolls back only its exact schedule when enqueue fails', async () => {
      const { userId } = await seedUser();
      await expect(
        scheduleAccountDeletion(userId, {
          graceHours: 24,
          now: () => new Date('2026-01-01T00:00:00Z'),
          queue: {
            enqueuePurge: async () => {
              throw new Error('redis down');
            },
          },
        }),
      ).rejects.toThrow('redis down');
      expect((await User.findById(userId))?.deletionScheduledAt ?? null).toBeNull();

      const concurrent = new Date('2026-01-03T00:00:00Z');
      await expect(
        scheduleAccountDeletion(userId, {
          graceHours: 24,
          now: () => new Date('2026-01-01T00:00:00Z'),
          queue: {
            enqueuePurge: async () => {
              await User.updateOne(
                { _id: userId },
                { $set: { deletionScheduledAt: concurrent } },
              );
              throw new Error('redis still down');
            },
          },
        }),
      ).rejects.toThrow('redis still down');
      expect((await User.findById(userId))?.deletionScheduledAt).toEqual(concurrent);
    });

    it('cancels during grace, removes the job best-effort, and refuses after claim', async () => {
      const { userId } = await seedUser();
      const queue = {
        enqueuePurge: vi.fn(async () => undefined),
        cancelPurge: vi.fn(async () => undefined),
      };
      await scheduleAccountDeletion(userId, { graceHours: 24, queue });
      await expect(
        cancelAccountDeletion(userId, {
          queue,
          now: () => new Date('2026-01-01T00:00:00Z'),
        }),
      ).resolves.toEqual({ cancelledAt: '2026-01-01T00:00:00.000Z' });
      expect(queue.cancelPurge).toHaveBeenCalledWith({ userId });
      expect((await User.findById(userId))?.deletionScheduledAt ?? null).toBeNull();
      await expect(cancelAccountDeletion(userId, { queue })).rejects.toMatchObject({
        status: 409,
      });
      await User.updateOne(
        { _id: userId },
        { $set: { deletionScheduledAt: new Date(), deletionStartedAt: new Date() } },
      );
      await expect(cancelAccountDeletion(userId, { queue })).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('exportUserData branch coverage', () => {
    it('exports ordered usage and competitor decision event histories', async () => {
      const user = await User.create({ email: 'event-export@example.com' });
      const accountId = String(user._id);
      const siteId = new Types.ObjectId().toString();
      const db = getTestDb();
      await db.insert(contentAnalysisEvents).values({
        accountId,
        siteId,
        analysisId: 'analysis-export',
        reservationKey: 'analysis-export-reservation',
        kind: 'failed',
        units: 1,
        errorCategory: 'provider_timeout',
        recordedAt: new Date('2026-07-01T00:00:04Z'),
      });
      await db.insert(contentInventoryEvents).values({
        accountId,
        siteId,
        runId: 'inventory-export',
        reservationKey: 'inventory-export-reservation',
        kind: 'completed',
        units: 2,
        recordedAt: new Date('2026-07-01T00:00:03Z'),
      });
      await db.insert(competitorContentEvents).values({
        accountId,
        siteId,
        runId: 'competitor-export',
        reservationKey: 'competitor-export-reservation',
        kind: 'refunded',
        units: 1,
        errorCategory: 'partial_failure',
        recordedAt: new Date('2026-07-01T00:00:02Z'),
      });
      await db.insert(contentMonitorEvents).values({
        accountId,
        siteId,
        monitorId: 'monitor-export',
        eventKey: 'monitor-export-event',
        kind: 'check_completed',
        units: 1,
        recordedAt: new Date('2026-07-01T00:00:01Z'),
      });
      await db.insert(landscapeOpportunityAcceptances).values({
        accountId,
        siteId,
        reportId: 'report-export',
        opportunityId: 'opportunity-export',
        actionId: 'action-export',
        acceptedByUserId: accountId,
        idempotencyKey: 'acceptance-export',
        acceptedAt: new Date('2026-07-01T00:00:05Z'),
      });
      await db.insert(landscapePageMatchReviews).values({
        accountId,
        siteId,
        reportId: 'report-export',
        suggestionId: 'suggestion-export',
        competitorProfileId: '11111111-1111-4111-8111-111111111111',
        decision: 'approved',
        ownedUrl: 'https://example.com/owned',
        competitorUrl: 'https://rival.example/competing',
        reviewedByUserId: accountId,
        idempotencyKey: 'review-export',
        version: 2,
        reviewedAt: new Date('2026-07-01T00:00:06Z'),
      });

      const data = await exportUserData(accountId, { db: db as never });
      expect(data.contentIntelligence.usageEvents.map((event) => event.scope)).toEqual([
        'monitor',
        'competitor',
        'inventory',
        'analysis',
      ]);
      expect(data.contentIntelligence.usageEvents[1]).toMatchObject({
        recordId: 'competitor-export',
        errorCategory: 'partial_failure',
      });
      expect(data.competitorIntelligence.opportunityAcceptances).toEqual([
        expect.objectContaining({ opportunityId: 'opportunity-export', actionId: 'action-export' }),
      ]);
      expect(data.competitorIntelligence.pageMatchReviews).toEqual([
        expect.objectContaining({ suggestionId: 'suggestion-export', version: 2 }),
      ]);
    });

    it('defaults missing recommendation projections and nullable event anchors', async () => {
      const user = await User.create({ email: 'content-export-defaults@example.com' });
      const analysisId = new Types.ObjectId().toString();
      const siteId = new Types.ObjectId().toString();
      await getTestDb().insert(contentRecommendationEvents).values({
        accountId: String(user._id), siteId, analysisId, recommendationId: 'rec_default',
        analysisVersion: 'v1', eventKind: 'accepted', priorState: 'suggested',
        newState: 'accepted', stateVersion: 1, actorUserId: String(user._id),
        idempotencyKey: 'export-null-anchors', recordedAt: new Date('2026-07-15T00:00:00Z'),
      });
      vi.spyOn(ContentAnalysis, 'find').mockReturnValueOnce({
        lean: async () => [{
          _id: analysisId,
          siteId,
          requestedAt: new Date('2026-07-14T00:00:00Z'),
        }],
      } as never);
      const data = await exportUserData(String(user._id), { db: getTestDb() as never });
      expect(data.contentIntelligence.analyses[0]?.recommendationStates).toEqual([]);
      expect(data.contentIntelligence.recommendationEvents[0]).toMatchObject({
        appliedAt: null, baselineAnchorAt: null,
      });
    });

    it('exports content inventory runs (completed and in-flight)', async () => {
      const user = await User.create({ email: 'inventory-export@example.com' });
      const siteId = new Types.ObjectId().toString();
      const base = {
        accountId: String(user._id),
        ownerUserId: String(user._id),
        siteId,
        origin: 'https://example.com',
        locale: 'en' as const,
        input: { pageLimit: 4, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
        progress: { pagesRequested: 4, pagesProcessed: 2, pagesFailed: 0, blocksReserved: 1 },
        stages: [],
        warnings: [],
        error: null,
        thresholdsVersion: '1',
        findings: null,
        costMicros: 0,
        aiCostMicros: 0,
        requestedAt: new Date('2026-07-01T00:00:00Z'),
      };
      await ContentInventoryRun.create({
        ...base,
        status: 'completed',
        reservation: { key: 'k-done', reservedAt: new Date('2026-07-01T00:00:00Z'), reservedUnits: 1, refundedUnits: 0 },
        inputFingerprint: 'fp-done',
        idempotencyKey: 'idem-done',
        completedAt: new Date('2026-07-02T00:00:00Z'),
      });
      await ContentInventoryRun.create({
        ...base,
        status: 'queued',
        reservation: { key: 'k-queued', reservedAt: new Date('2026-07-01T00:00:00Z'), reservedUnits: 1, refundedUnits: 0 },
        inputFingerprint: 'fp-queued',
        idempotencyKey: 'idem-queued',
      });
      const data = await exportUserData(String(user._id));
      const runs = data.contentIntelligence.inventoryRuns;
      expect(runs).toHaveLength(2);
      const completed = runs.find((r) => r.status === 'completed');
      const queued = runs.find((r) => r.status === 'queued');
      expect(completed?.completedAt).toBe('2026-07-02T00:00:00.000Z');
      expect(completed?.requestedAt).toBe('2026-07-01T00:00:00.000Z');
      expect(completed?.pagesProcessed).toBe(2);
      expect(queued?.completedAt).toBeNull();
    });

    it('exports competitor content runs (completed and in-flight)', async () => {
      const user = await User.create({ email: 'competitor-export@example.com' });
      const siteId = new Types.ObjectId().toString();
      const base = {
        accountId: String(user._id),
        ownerUserId: String(user._id),
        siteId,
        origin: 'https://example.com',
        ownedUrl: 'https://example.com/page',
        locale: 'en' as const,
        input: { competitorIds: ['a'], competitorDomains: ['rival.com'], pageLimit: 15 },
        progress: { competitorsRequested: 1, competitorsProcessed: 1, competitorsFailed: 0, pagesScraped: 2 },
        stages: [],
        warnings: [],
        error: null,
        thresholdsVersion: '1',
        findings: null,
        costMicros: 0,
        aiCostMicros: 0,
        requestedAt: new Date('2026-07-01T00:00:00Z'),
      };
      await CompetitorContentRun.create({
        ...base,
        status: 'completed',
        reservation: { key: 'cc-done', reservedAt: new Date('2026-07-01T00:00:00Z'), reservedUnits: 1, refundedUnits: 0 },
        inputFingerprint: 'cc-fp-done',
        idempotencyKey: 'cc-idem-done',
        completedAt: new Date('2026-07-02T00:00:00Z'),
      });
      await CompetitorContentRun.create({
        ...base,
        status: 'queued',
        reservation: { key: 'cc-queued', reservedAt: new Date('2026-07-01T00:00:00Z'), reservedUnits: 1, refundedUnits: 0 },
        inputFingerprint: 'cc-fp-queued',
        idempotencyKey: 'cc-idem-queued',
      });
      const data = await exportUserData(String(user._id));
      const runs = data.contentIntelligence.competitorRuns;
      expect(runs).toHaveLength(2);
      const completed = runs.find((r) => r.status === 'completed');
      const queued = runs.find((r) => r.status === 'queued');
      expect(completed?.completedAt).toBe('2026-07-02T00:00:00.000Z');
      expect(completed?.pagesScraped).toBe(2);
      expect(queued?.completedAt).toBeNull();
    });

    it('exports content monitors (checked and never-checked)', async () => {
      const user = await User.create({ email: 'monitor-export@example.com' });
      const siteId = new Types.ObjectId().toString();
      const enc = { ciphertext: 'ct', iv: 'iv', authTag: 't', keyVersion: 1 };
      const base = {
        accountId: String(user._id),
        ownerUserId: String(user._id),
        siteId,
        locale: 'en' as const,
        targetKind: 'owned' as const,
        providerMonitorIdEncrypted: enc,
        createdBy: String(user._id),
      };
      await ContentMonitor.create({
        ...base,
        targetUrl: 'https://example.com/checked',
        providerMonitorRef: 'ref-checked',
        status: 'active',
        lastCheckAt: new Date('2026-07-02T00:00:00Z'),
        lastMaterialChangeAt: new Date('2026-07-02T00:00:00Z'),
      });
      await ContentMonitor.create({
        ...base,
        targetUrl: 'https://example.com/fresh',
        providerMonitorRef: 'ref-fresh',
        status: 'paused',
      });
      const data = await exportUserData(String(user._id));
      const monitors = data.contentIntelligence.monitors;
      expect(monitors).toHaveLength(2);
      const checked = monitors.find((m) => m.targetUrl.endsWith('/checked'))!;
      const fresh = monitors.find((m) => m.targetUrl.endsWith('/fresh'))!;
      expect(checked.lastCheckAt).toBe('2026-07-02T00:00:00.000Z');
      expect(checked.lastMaterialChangeAt).toBe('2026-07-02T00:00:00.000Z');
      expect(checked.createdAt).toBeTypeOf('string');
      expect(fresh.lastCheckAt).toBeNull();
      expect(fresh.lastMaterialChangeAt).toBeNull();
      expect(fresh.status).toBe('paused');
    });

    it('handles a user with no profile / language', async () => {
      const user = await User.create({ email: 'bare@example.com' });
      const data = await exportUserData(user._id.toString());
      expect(data.account.firstName).toBe('');
      expect(data.account.lastName).toBe('');
      expect(data.account.language).toBeNull();
    });

    it('serializes a user language and account timestamps when present', async () => {
      const user = await User.create({
        email: 'lang@example.com',
        profile: { firstName: 'Li', lastName: 'L' },
        language: 'fr',
      });
      const data = await exportUserData(user._id.toString());
      expect(data.account.language).toBe('fr');
      expect(data.account.createdAt).toBeTypeOf('string');
    });
  });

  describe('scheduleAccountDeletion', () => {
    it('marks the user, enqueues a purge, and sends the warning email', async () => {
      const { userId } = await seedUser();
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      const mailer = { sendDeletionWarning: vi.fn(async () => undefined) };
      const result = await scheduleAccountDeletion(userId, {
        graceHours: 24,
        queue,
        mailer,
        now: () => new Date('2026-01-01T00:00:00Z'),
      });
      expect(result.purgeAt).toBe('2026-01-02T00:00:00.000Z');
      expect(result.warningEmailQueued).toBe(true);
      expect(queue.enqueuePurge).toHaveBeenCalledOnce();
      expect(mailer.sendDeletionWarning).toHaveBeenCalledOnce();
      const user = await User.findById(userId);
      expect(user?.deletionScheduledAt).toBeInstanceOf(Date);
      expect(user?.deletionWarningSentAt).toBeInstanceOf(Date);
    });

    it('concurrent schedule calls: exactly one enqueue, one email, loser gets 409', async () => {
      const { userId } = await seedUser();
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      const mailer = { sendDeletionWarning: vi.fn(async () => undefined) };
      const calls = [
        scheduleAccountDeletion(userId, {
          graceHours: 24,
          queue,
          mailer,
          now: () => new Date('2026-01-01T00:00:00Z'),
        }),
        scheduleAccountDeletion(userId, {
          graceHours: 24,
          queue,
          mailer,
          now: () => new Date('2026-01-01T00:00:00Z'),
        }),
      ] as const;
      const results = await Promise.allSettled(calls);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ status: 409 }),
      });
      expect(queue.enqueuePurge).toHaveBeenCalledOnce();
      expect(mailer.sendDeletionWarning).toHaveBeenCalledOnce();
    });

    it('blocks when a legal hold is active', async () => {
      const { userId } = await seedUser();
      await User.updateOne({ _id: userId }, { legalHold: true });
      const queue = { enqueuePurge: vi.fn() };
      await expect(
        scheduleAccountDeletion(userId, { graceHours: 24, queue }),
      ).rejects.toMatchObject({ status: 403 });
      expect(queue.enqueuePurge).not.toHaveBeenCalled();
    });

    it('refuses to schedule twice', async () => {
      const { userId } = await seedUser();
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      await scheduleAccountDeletion(userId, { graceHours: 24, queue });
      await expect(
        scheduleAccountDeletion(userId, { graceHours: 24, queue }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('404s a missing user', async () => {
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      await expect(
        scheduleAccountDeletion('507f1f77bcf86cd799439011', { graceHours: 24, queue }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('keeps the schedule intact when the warning email fails (non-fatal)', async () => {
      // User with no profile → also exercises the `firstName ?? ''` fallback.
      const user = await User.create({ email: 'nomail@example.com' });
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      const mailer = {
        sendDeletionWarning: vi.fn(async () => {
          throw new Error('smtp down');
        }),
      };
      const result = await scheduleAccountDeletion(user._id.toString(), {
        graceHours: 24,
        queue,
        mailer,
      });
      expect(result.warningEmailQueued).toBe(false);
      expect(queue.enqueuePurge).toHaveBeenCalledOnce();
      const reloaded = await User.findById(user._id);
      expect(reloaded?.deletionScheduledAt).toBeInstanceOf(Date);
      // Warning stamp not written because the send failed.
      expect(reloaded?.deletionWarningSentAt ?? null).toBeNull();
    });

    it('does not restore warning state when cancellation finishes during email delivery', async () => {
      const { userId } = await seedUser();
      let markSending!: () => void;
      let finishSending!: () => void;
      const sending = new Promise<void>((resolve) => {
        markSending = resolve;
      });
      const finish = new Promise<void>((resolve) => {
        finishSending = resolve;
      });
      const queue = {
        enqueuePurge: vi.fn(async () => undefined),
        cancelPurge: vi.fn(async () => undefined),
      };
      const scheduled = scheduleAccountDeletion(userId, {
        graceHours: 24,
        queue,
        mailer: {
          sendDeletionWarning: vi.fn(async () => {
            markSending();
            await finish;
          }),
        },
      });
      await sending;
      await cancelAccountDeletion(userId, { queue });
      finishSending();

      await expect(scheduled).resolves.toMatchObject({ warningEmailQueued: false });
      const reloaded = await User.findById(userId).lean();
      expect(reloaded?.deletionScheduledAt ?? null).toBeNull();
      expect(reloaded?.deletionWarningSentAt ?? null).toBeNull();
      expect(reloaded?.deletionLifecycleId ?? null).toBeNull();
      expect(reloaded?.deletionCancellationRequestedAt ?? null).toBeNull();
    });

    it('does not begin warning delivery when cancellation wins after enqueue', async () => {
      const { userId } = await seedUser();
      const mailer = { sendDeletionWarning: vi.fn(async () => undefined) };
      const queue: PurgeQueue = {
        enqueuePurge: vi.fn(async () => {
          await cancelAccountDeletion(userId, { queue });
        }),
        cancelPurge: vi.fn(async () => undefined),
      };

      await expect(
        scheduleAccountDeletion(userId, { graceHours: 24, queue, mailer }),
      ).resolves.toMatchObject({ warningEmailQueued: false });

      expect(mailer.sendDeletionWarning).not.toHaveBeenCalled();
      const reloaded = await User.findById(userId).lean();
      expect(reloaded?.deletionScheduledAt ?? null).toBeNull();
      expect(reloaded?.deletionWarningSentAt ?? null).toBeNull();
      expect(reloaded?.deletionCancellationRequestedAt ?? null).toBeNull();
    });

    it('rolls back the exact schedule and queued job when requested-audit persistence fails', async () => {
      const { userId } = await seedUser();
      const queue = {
        enqueuePurge: vi.fn(async () => undefined),
        cancelPurge: vi.fn(async () => undefined),
      };
      const mailer = { sendDeletionWarning: vi.fn(async () => undefined) };
      const auditWrite = vi
        .spyOn(AuditLog, 'updateOne')
        .mockRejectedValueOnce(new Error('mongo audit unavailable'));
      await expect(
        scheduleAccountDeletion(userId, { graceHours: 24, queue, mailer }),
      ).rejects.toThrow('mongo audit unavailable');
      auditWrite.mockRestore();

      expect(queue.cancelPurge).toHaveBeenCalledWith({ userId });
      expect(mailer.sendDeletionWarning).not.toHaveBeenCalled();
      expect((await User.findById(userId))?.deletionScheduledAt ?? null).toBeNull();
      await expect(
        scheduleAccountDeletion(userId, { graceHours: 24, queue }),
      ).resolves.toMatchObject({ warningEmailQueued: false });
      expect(
        await AuditLog.countDocuments({
          actorUserId: userId,
          action: 'data.delete.requested',
        }),
      ).toBe(1);
    });

    it('keeps a failed cancellation pending, blocks reschedule, and repairs idempotently', async () => {
      const { userId } = await seedUser();
      const queue = {
        enqueuePurge: vi.fn(async () => undefined),
        cancelPurge: vi.fn(async () => undefined),
      };
      await scheduleAccountDeletion(userId, { graceHours: 24, queue });
      const auditWrite = vi
        .spyOn(AuditLog, 'updateOne')
        .mockRejectedValueOnce(new Error('mongo audit unavailable'));
      await expect(cancelAccountDeletion(userId, { queue })).rejects.toThrow(
        'mongo audit unavailable',
      );
      auditWrite.mockRestore();

      const pending = await User.findById(userId).lean();
      expect(pending?.deletionScheduledAt).toBeInstanceOf(Date);
      expect(pending?.deletionCancellationRequestedAt).toBeInstanceOf(Date);
      await expect(
        scheduleAccountDeletion(userId, { graceHours: 24, queue }),
      ).rejects.toMatchObject({ status: 409 });

      await expect(cancelAccountDeletion(userId, { queue })).resolves.toMatchObject({
        cancelledAt: expect.any(String),
      });
      const repaired = await User.findById(userId).lean();
      expect(repaired?.deletionScheduledAt ?? null).toBeNull();
      expect(repaired?.deletionCancellationRequestedAt ?? null).toBeNull();
      expect(
        await AuditLog.countDocuments({
          actorUserId: userId,
          action: 'data.delete.cancelled',
        }),
      ).toBe(1);

      await expect(
        scheduleAccountDeletion(userId, { graceHours: 48, queue }),
      ).resolves.toBeDefined();
      expect((await User.findById(userId))?.deletionScheduledAt).toBeInstanceOf(Date);
    });

    it('prefers an explicit locale over the user language for the warning', async () => {
      const user = await User.create({
        email: 'loc@example.com',
        profile: { firstName: 'Lo', lastName: 'C' },
        language: 'de',
      });
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      const mailer = { sendDeletionWarning: vi.fn(async () => undefined) };
      await scheduleAccountDeletion(user._id.toString(), {
        graceHours: 24,
        queue,
        mailer,
        locale: 'es',
      });
      expect(mailer.sendDeletionWarning).toHaveBeenCalledWith(
        expect.objectContaining({ locale: 'es', firstName: 'Lo' }),
      );
    });

    it('falls back to the user language for the warning locale when none is passed', async () => {
      const user = await User.create({
        email: 'loc2@example.com',
        profile: { firstName: 'Lo', lastName: 'C' },
        language: 'ru',
      });
      const queue = { enqueuePurge: vi.fn(async () => undefined) };
      const mailer = { sendDeletionWarning: vi.fn(async () => undefined) };
      await scheduleAccountDeletion(user._id.toString(), {
        graceHours: 24,
        queue,
        mailer,
      });
      expect(mailer.sendDeletionWarning).toHaveBeenCalledWith(
        expect.objectContaining({ locale: 'ru' }),
      );
    });
  });

  describe('HTTP controller (/api/legal)', () => {
    afterEachController();

    it('POST /export returns the user data envelope', async () => {
      const { userId, cookie } = await seedAuthedUser();
      setContentIntelligenceDb(getTestDb() as never);
      const res = await request(app).post('/api/legal/export').set('Cookie', cookie);
      setContentIntelligenceDb(null);
      expect(res.status).toBe(200);
      expect(res.body.account.email).toBe('gdpr@example.com');
      const audit = await AuditLog.findOne({ actorUserId: userId, action: 'data.export' }).lean();
      expect(audit).not.toBeNull();
      expect(audit?.targetType).toBe('user');
      expect(audit?.targetId).toBe(userId);
    });

    it('POST /export remains available when the intelligence DB holder is unset', async () => {
      const { cookie } = await seedAuthedUser();
      setContentIntelligenceDb(null);
      const res = await request(app).post('/api/legal/export').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.contentIntelligence.recommendationEvents).toEqual([]);
      setContentIntelligenceDb(getTestDb() as never);
    });

    it('unconfigured queue still 500s with security.deletion.notConfigured', async () => {
      const { cookie } = await seedAuthedUser();
      resetLegalController();
      const csrf = await csrfFor(cookie);
      const res = await request(app)
        .post('/api/legal/delete-account')
        .set('Cookie', csrf.cookie)
        .set(env.CSRF_HEADER_NAME, csrf.token);
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Deletion queue is not configured.');
    });

    it('POST /api/legal/delete-account enqueues (no 500) and returns 202 with purgeAt = now + grace', async () => {
      const { userId, cookie } = await seedAuthedUser();
      const frozen = new Date('2026-01-01T00:00:00Z');
      const enqueued: Array<{ userId: string; purgeAt: Date }> = [];
      configureLegalController({
        queue: {
          enqueuePurge: async (payload) => void enqueued.push(payload),
          cancelPurge: async () => undefined,
        },
      });
      const csrf = await csrfFor(cookie);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(frozen);
      const res = await request(app)
        .post('/api/legal/delete-account')
        .set('Cookie', csrf.cookie)
        .set(env.CSRF_HEADER_NAME, csrf.token);
      vi.useRealTimers();
      expect(res.status).toBe(202);
      // `shouldAdvanceTime: true` lets the mocked clock tick alongside the
      // real supertest I/O (a fully frozen clock would hang the request), so
      // exact-ISO equality is racy. Assert the real invariants instead: the
      // schedule starts at (about) the frozen instant and the purge lands
      // exactly one grace period later.
      expect(res.body.warningEmailQueued).toBe(false);
      const scheduledAtMs = new Date(res.body.scheduledAt as string).getTime();
      const purgeAtMs = new Date(res.body.purgeAt as string).getTime();
      expect(Math.abs(scheduledAtMs - frozen.getTime())).toBeLessThan(1000);
      expect(purgeAtMs - scheduledAtMs).toBe(
        env.ACCOUNT_DELETION_GRACE_HOURS * 60 * 60 * 1000,
      );
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]?.userId).toBe(userId);
      expect(enqueued[0]?.purgeAt.getTime()).toBe(purgeAtMs);
      const audit = await AuditLog.findOne({
        actorUserId: userId,
        action: 'data.delete.requested',
      }).lean();
      expect(audit).not.toBeNull();
      expect(audit?.targetType).toBe('user');
      expect(audit?.targetId).toBe(userId);
    });

    it('POST /api/legal/cancel-account-deletion clears a grace-period schedule', async () => {
      const { userId, cookie } = await seedAuthedUser();
      const cancelPurge = vi.fn(async () => undefined);
      configureLegalController({
        queue: {
          enqueuePurge: async () => undefined,
          cancelPurge,
        },
      });
      await User.updateOne(
        { _id: userId },
        { $set: { deletionScheduledAt: new Date(Date.now() + 60_000) } },
      );
      const before = await request(app)
        .get('/api/legal/account-deletion')
        .set('Cookie', cookie);
      expect(before.status).toBe(200);
      expect(before.body).toMatchObject({ cancellable: true, startedAt: null });
      const csrf = await csrfFor(cookie);
      const res = await request(app)
        .post('/api/legal/cancel-account-deletion')
        .set('Cookie', csrf.cookie)
        .set(env.CSRF_HEADER_NAME, csrf.token);
      expect(res.status).toBe(200);
      expect(new Date(res.body.cancelledAt as string).toString()).not.toBe('Invalid Date');
      expect(cancelPurge).toHaveBeenCalledWith({ userId });
      expect((await User.findById(userId))?.deletionScheduledAt ?? null).toBeNull();
      expect(
        await AuditLog.countDocuments({
          actorUserId: userId,
          action: 'data.delete.cancelled',
        }),
      ).toBe(1);
      const after = await request(app)
        .get('/api/legal/account-deletion')
        .set('Cookie', cookie);
      expect(after.body).toEqual({
        scheduledAt: null,
        startedAt: null,
        cancellable: false,
      });
    });

    it('createApp holder wiring enqueues a delayed account-purge job through the real helper', async () => {
      const { userId, cookie } = await seedAuthedUser();
      const add = vi.fn(
        async (name: string, data: unknown, opts: { jobId?: string; delay?: number }) => ({
          id: opts.jobId,
          name,
          data,
          opts,
        }),
      );
      setAccountPurgeQueue({ add } as unknown as NonNullable<Parameters<typeof setAccountPurgeQueue>[0]>);
      const localApp = createApp();
      const csrf = await csrfFor(cookie);
      const frozen = new Date('2026-02-01T00:00:00Z');
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(frozen);
      const res = await request(localApp)
        .post('/api/legal/delete-account')
        .set('Cookie', csrf.cookie)
        .set(env.CSRF_HEADER_NAME, csrf.token);
      vi.useRealTimers();
      expect(res.status).toBe(202);
      // `shouldAdvanceTime: true` ticks the mocked clock during the real
      // supertest round-trip, so the computed delay can undershoot the grace
      // period by a few ms — assert with a 1s tolerance instead of equality.
      expect(add).toHaveBeenCalledWith(
        ACCOUNT_PURGE_JOB_NAME,
        { userId },
        expect.objectContaining({ jobId: `account-purge-${userId}` }),
      );
      const delay = (add.mock.calls[0]?.[2] as { delay?: number }).delay ?? 0;
      const grace = env.ACCOUNT_DELETION_GRACE_HOURS * 60 * 60 * 1000;
      expect(Math.abs(delay - grace)).toBeLessThan(1000);
    });

    it('holder-null enqueuePurge path errors when REDIS_URL is unset', async () => {
      const { cookie } = await seedAuthedUser();
      setAccountPurgeQueue(null);
      const localApp = createApp();
      const csrf = await csrfFor(cookie);
      const res = await request(localApp)
        .post('/api/legal/delete-account')
        .set('Cookie', csrf.cookie)
        .set(env.CSRF_HEADER_NAME, csrf.token);
      expect(res.status).toBe(500);
    });

    it('POST /delete-account rejects a cookie request with no CSRF token (403)', async () => {
      const { cookie } = await seedAuthedUser();
      configureLegalController({
        queue: { enqueuePurge: async () => undefined },
      });
      // Authenticated session cookie but no double-submit CSRF pair → blocked
      // before it ever reaches the deletion handler.
      __setCsrfBypassForTests(false);
      try {
        const res = await request(app).post('/api/legal/delete-account').set('Cookie', cookie);
        expect(res.status).toBe(403);
      } finally {
        __setCsrfBypassForTests(true);
      }
    });

    it('POST /export rejects a cookie request with no CSRF token (403)', async () => {
      const { cookie } = await seedAuthedUser();
      // Data export is a mutating, audit-logged action on the ambient session —
      // a cross-site auto-submit must not force it. Both data-rights routes now
      // carry the double-submit CSRF guard, so a cookie without the token is
      // blocked before the export handler runs.
      __setCsrfBypassForTests(false);
      try {
        const res = await request(app).post('/api/legal/export').set('Cookie', cookie);
        expect(res.status).toBe(403);
      } finally {
        __setCsrfBypassForTests(true);
      }
    });
  });

  describe('controller guard branches (no req.user / unconfigured queue)', () => {
    beforeEach(() => resetLegalController());

    it('exportMyData raises the unauthorized key when unauthenticated', async () => {
      const err = await invokeHandler(exportMyData, {});
      expect(err).toMatchObject({ status: 401, message: 'errors.unauthorized' });
    });

    it('deleteMyAccount raises the unauthorized key when unauthenticated', async () => {
      const err = await invokeHandler(deleteMyAccount, {});
      expect(err).toMatchObject({ status: 401, message: 'errors.unauthorized' });
    });

    it('deleteMyAccount raises the unconfigured-queue key rather than literal prose', async () => {
      resetLegalController();
      const err = await invokeHandler(deleteMyAccount, {
        user: { id: '507f1f77bcf86cd799439011' } as Express.User,
      });
      expect(err).toMatchObject({
        status: 500,
        message: 'security.deletion.notConfigured',
      });
    });

    it('cancel and status controllers reject missing identities', async () => {
      await expect(invokeHandler(cancelMyAccountDeletion, {})).resolves.toMatchObject({
        status: 401,
      });
      await expect(invokeHandler(accountDeletionStatus, {})).resolves.toMatchObject({
        status: 401,
      });
    });

    it('cancel controller raises the unconfigured-queue key for the error handler to localize', async () => {
      const user = { id: '507f1f77bcf86cd799439011' } as Express.User;
      await expect(
        invokeHandler(cancelMyAccountDeletion, { user }),
      ).resolves.toMatchObject({
        status: 500,
        message: 'security.deletion.notConfigured',
      });
    });
  });
});

function afterEachController(): void {
  // Reset injected deps after each controller test so leakage can't mask a
  // missing-configuration path in another test.
  beforeEach(() => resetLegalController());
}
