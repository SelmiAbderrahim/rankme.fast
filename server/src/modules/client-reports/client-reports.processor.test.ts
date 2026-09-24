import { randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import mongoose from 'mongoose';
import { pino } from 'pino';
import sharp from 'sharp';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { env } from '../../config/env.js';
import {
  scheduledReportDeliveries,
  scheduledReports,
  teamMembers,
} from '../../db/schema/index.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import {
  CLIENT_REPORTS_QUEUE,
  createDeadLetterHandler,
} from '../../shared/queue/index.js';
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
import { AuditRun, writeReportSnapshot } from '../audits/index.js';
import { makeAuditResult } from '../audits/rules/fixtures.js';
import { Site } from '../sites/sites.model.js';
import { User } from '../users/users.model.js';
import { deliverClientReportEmail } from '../communication/index.js';
import {
  clientReportProcessorTestables,
  clientReportDeliveryIdempotencyKey,
  clientReportRunKey,
  createClientReportProcessor,
  processClientReportJob,
} from './client-reports.processor.js';

const logger = pino({ level: 'silent' });
const originalClientReportsFlag = env.CLIENT_REPORTS_ENABLED;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED =
    originalClientReportsFlag;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = true;
});

async function seedSchedule(withAudit = true) {
  const accountId = new mongoose.Types.ObjectId();
  await User.create({
    _id: accountId,
    email: 'processor-owner@example.test',
    emailVerified: true,
    branding: { companyName: 'Agency', accentColor: '#112233' },
  });
  const site = await Site.create({
    accountId,
    url: 'https://processor.example.test',
    domain: 'processor.example.test',
    displayName: 'Processor Client',
  });
  if (withAudit) {
    const run = await AuditRun.create({
      accountId,
      siteId: site._id,
      pageCap: 50,
      status: 'succeeded',
      finishedAt: new Date('2026-07-30T10:00:00.000Z'),
    });
    await writeReportSnapshot({
      runId: run.id as string,
      siteId: site.id as string,
      accountId: accountId.toHexString(),
      result: makeAuditResult(),
    });
  }
  const id = randomUUID();
  const [schedule] = await getTestDb().insert(scheduledReports).values({
    id,
    accountId: accountId.toHexString(),
    siteId: site.id as string,
    name: 'Weekly report',
    frequency: 'weekly',
    weekdayUtc: 4,
    monthdayUtc: null,
    hourUtc: 10,
    minuteUtc: 15,
    locale: 'en',
    recipients: [
      'a-sent@example.test',
      'b-suppressed@example.test',
      'c-failed@example.test',
    ],
    sections: { audit: true, ranks: false, gsc: false },
    enabled: true,
    nextRunAt: new Date('2026-07-30T10:15:00.000Z'),
  }).returning();
  return schedule!;
}

function jobFor(scheduleId: string, attemptsMade = 1): Job {
  return {
    id: `client-report-${scheduleId}-202607301015`,
    data: {
      accountId: '000000000000000000000001',
      siteId: '000000000000000000000002',
      scheduleId,
      runKey: `${scheduleId}-202607301015`,
      scheduledFor: '2026-07-30T10:15:00.000Z',
    },
    timestamp: Date.parse('2026-07-30T10:15:00.000Z'),
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job;
}

describe('client report processor', () => {
  it('resolves explicit and production delivery transports', () => {
    const override = vi.fn() as unknown as typeof deliverClientReportEmail;
    expect(clientReportProcessorTestables.resolveDeliveryTransport(override)).toBe(override);
    expect(clientReportProcessorTestables.resolveDeliveryTransport(undefined)).toBe(
      deliverClientReportEmail,
    );
  });

  it('persists isolated outcomes, throws for a partial failure, and retries only that recipient', async () => {
    const schedule = await seedSchedule();
    const firstDeliver = vi.fn(async (_input: {
      payload: { attachment: { contentBase64: string } };
    }) => [
      {
        email: 'a-sent@example.test',
        status: 'sent' as const,
        suppressionReason: null,
        errorCode: null,
        providerMessageId: 'message-1',
      },
      {
        email: 'b-suppressed@example.test',
        status: 'sent' as const,
        suppressionReason: null,
        errorCode: null,
        providerMessageId: 'message-2',
      },
      {
        email: 'c-failed@example.test',
        status: 'failed' as const,
        suppressionReason: null,
        errorCode: 'transport_reported_failure' as const,
        providerMessageId: null,
      },
    ]);
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      deliver: firstDeliver,
      now: () => new Date('2026-07-30T10:16:00.000Z'),
    })).rejects.toMatchObject({
      outcome: { attempted: 3, sent: 2, failed: 1, suppressed: 0 },
    });
    expect(firstDeliver.mock.calls[0]![0].payload.attachment.contentBase64)
      .toMatch(/^JVBER/u);
    let rows = await getTestDb().select().from(scheduledReportDeliveries);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.status).sort()).toEqual(['failed', 'sent', 'sent']);
    expect(rows.every((row) => row.snapshotDate?.toISOString() === '2026-07-30T10:00:00.000Z'))
      .toBe(true);

    const retryDeliver = vi.fn(async (input: { recipients: Array<{ email: string }> }) => [{
      email: input.recipients[0]!.email,
      status: 'sent' as const,
      suppressionReason: null,
      errorCode: null,
      providerMessageId: 'message-retry',
    }]);
    const retried = await processClientReportJob(jobFor(schedule.id, 2), {
      db: getTestDb() as never,
      deliver: retryDeliver as never,
      now: () => new Date('2026-07-30T10:16:01.000Z'),
    });
    expect(retried).toMatchObject({ attempted: 1, sent: 1, failed: 0 });
    expect(retryDeliver.mock.calls[0]![0].recipients).toEqual([
      expect.objectContaining({ email: 'c-failed@example.test' }),
    ]);
    rows = await getTestDb().select().from(scheduledReportDeliveries);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status !== 'failed')).toBe(true);
    await expect(processClientReportJob(jobFor(schedule.id, 3), {
      db: getTestDb() as never,
      deliver: retryDeliver as never,
    })).resolves.toMatchObject({ skipped: true, attempted: 0 });
  });

  it('reuses opaque provider keys after an ambiguous delivery crash', async () => {
    const schedule = await seedSchedule();
    const attempts: string[][] = [];
    const crashAfterSend = vi.fn(async (input: {
      recipients: Array<{ email: string; idempotencyKey: string }>;
    }) => {
      attempts.push(input.recipients.map((recipient) => recipient.idempotencyKey));
      throw new Error('worker exited after the provider accepted the request');
    });
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      deliver: crashAfterSend as never,
      now: () => new Date('2026-07-30T10:16:00.000Z'),
    })).rejects.toThrow('worker exited');

    const recovered = vi.fn(async (input: {
      recipients: Array<{ email: string; idempotencyKey: string }>;
    }) => {
      attempts.push(input.recipients.map((recipient) => recipient.idempotencyKey));
      return input.recipients.map((recipient) => ({
        email: recipient.email,
        status: 'sent' as const,
        suppressionReason: null,
        errorCode: null,
        providerMessageId: 'provider-replay-collapsed',
      }));
    });
    await expect(clientReportProcessorTestables.settleWinningClientReportRun({
      db: getTestDb() as never,
      deliver: recovered as never,
      now: () => new Date('2026-07-30T10:16:31.000Z'),
    }, schedule, jobFor(schedule.id, 2).data.runKey as string,
    new Date('2026-07-30T10:16:31.000Z'))).resolves.toMatchObject({ sent: 3, failed: 0 });

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).toHaveLength(3);
    expect(new Set(attempts[0]).size).toBe(3);
    expect(JSON.stringify(attempts)).not.toContain('@example.test');
  });

  it('classifies a missing per-recipient fan-out result as provider outcome unknown', async () => {
    const schedule = await seedSchedule();
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      deliver: vi.fn(async () => []),
      now: () => new Date('2026-07-30T10:16:00.000Z'),
    })).rejects.toMatchObject({
      outcome: { attempted: 3, failed: 3 },
    });
    const rows = await getTestDb().select().from(scheduledReportDeliveries);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) =>
      row.status === 'failed' && row.errorCode === 'provider_outcome_unknown'
    )).toBe(true);
  });

  it('defaults a failed provider leg without an error code to outcome unknown', async () => {
    const schedule = await seedSchedule();
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      deliver: vi.fn(async (input: { recipients: Array<{ email: string }> }) =>
        input.recipients.map((recipient, index) => ({
          email: recipient.email,
          status: index === 0 ? 'failed' as const : 'sent' as const,
          suppressionReason: null,
          errorCode: null,
          providerMessageId: null,
        }))) as never,
      now: () => new Date('2026-07-30T10:16:00.000Z'),
    })).rejects.toMatchObject({ outcome: { failed: 1, sent: 2 } });
    const failed = await getTestDb().query.scheduledReportDeliveries.findFirst({
      where: eq(scheduledReportDeliveries.status, 'failed'),
    });
    expect(failed?.errorCode).toBe('provider_outcome_unknown');
  });

  it('leaves claims retryable when another worker wins every settlement CAS', async () => {
    const schedule = await seedSchedule();
    const deliver = vi.fn(async (input: { recipients: Array<{ email: string }> }) => {
      await getTestDb().update(scheduledReportDeliveries).set({ claimToken: randomUUID() });
      return input.recipients.map((recipient) => ({
        email: recipient.email,
        status: 'sent' as const,
        suppressionReason: null,
        errorCode: null,
        providerMessageId: 'cas-winner',
      }));
    });
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      deliver: deliver as never,
      now: () => new Date('2026-07-30T10:16:00.000Z'),
    })).resolves.toMatchObject({ attempted: 3, sent: 0, failed: 0 });
    const rows = await getTestDb().select().from(scheduledReportDeliveries);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
  });

  it('does not overwrite composition failures when a concurrent outbox winner disappears', async () => {
    const schedule = await seedSchedule();
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      deliver: vi.fn() as never,
      freezeRun: vi.fn(async () => ({ created: false, claims: [] })),
      now: () => new Date('2026-07-30T10:16:00.000Z'),
    })).rejects.toThrow('client report outbox winner disappeared');
    expect(await getTestDb().select().from(scheduledReportDeliveries)).toEqual([]);
  });

  it('writes composition failures before throwing and no-ops missing/disabled schedules', async () => {
    const schedule = await seedSchedule(false);
    await clientReportProcessorTestables.recordCompositionFailures(getTestDb() as never, {
      schedule,
      runKey: 'empty-composition-failure',
      recipients: [],
      now: new Date('2026-07-30T10:15:00.000Z'),
    });
    expect(await getTestDb().select().from(scheduledReportDeliveries)).toHaveLength(0);
    await expect(clientReportProcessorTestables.settleWinningClientReportRun(
      { db: getTestDb() as never },
      schedule,
      'missing-winning-run',
      new Date('2026-07-30T10:15:00.000Z'),
    )).rejects.toThrow('client report outbox winner disappeared');
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
      logger,
    })).rejects.toMatchObject({ status: 409 });
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
    })).rejects.toMatchObject({ status: 409 });
    const failed = await getTestDb().select().from(scheduledReportDeliveries);
    expect(failed).toHaveLength(3);
    expect(failed.every((row) =>
      row.status === 'failed' && row.errorCode === 'composition_failed' && row.snapshotDate === null,
    )).toBe(true);

    await getTestDb()
      .update(scheduledReports)
      .set({ enabled: false })
      .where(eq(scheduledReports.id, schedule.id));
    await expect(processClientReportJob(jobFor(schedule.id), {
      db: getTestDb() as never,
    })).resolves.toMatchObject({ skipped: true, attempted: 0 });
    await expect(processClientReportJob(jobFor(randomUUID()), {
      db: getTestDb() as never,
    })).resolves.toMatchObject({ skipped: true, attempted: 0 });
  });

  it('surfaces an all-recipient terminal failure after persisting every row', async () => {
    const schedule = await seedSchedule();
    const job = jobFor(schedule.id, 3);
    const deliver = vi.fn(async (input: { recipients: Array<{ email: string }> }) =>
      input.recipients.map((recipient) => ({
        email: recipient.email,
        status: 'failed' as const,
        suppressionReason: null,
        errorCode: 'transport_reported_failure' as const,
        providerMessageId: null,
      })));
    let terminalError: Error | null = null;
    try {
      await processClientReportJob(job, {
        db: getTestDb() as never,
        deliver: deliver as never,
      });
    } catch (error) {
      terminalError = error as Error;
    }
    expect(terminalError?.message).toContain('delivery incomplete: 3 recipient(s) failed');
    const rows = await getTestDb().select().from(scheduledReportDeliveries);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === 'failed')).toBe(true);
  });

  it('finishes a job already owned by a running worker after the flag turns off', async () => {
    const schedule = await seedSchedule();
    (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = false;
    const deliver = vi.fn(async (input: { recipients: Array<{ email: string }> }) =>
      input.recipients.map((recipient) => ({
        email: recipient.email,
        status: 'sent' as const,
        suppressionReason: null,
        errorCode: null,
        providerMessageId: 'existing-job',
      })));

    const templateJob = jobFor(schedule.id);
    templateJob.data.runKey = 'template';
    await expect(processClientReportJob(templateJob, {
      db: getTestDb() as never,
      deliver: deliver as never,
    })).resolves.toMatchObject({ attempted: 3, sent: 3, skipped: false });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('uses the communication delivery seam when no test delivery override is supplied', async () => {
    const schedule = await seedSchedule();
    const originalKey = env.RESEND_API_KEY;
    const originalFrom = env.RESEND_FROM;
    const originalTransport = env.EMAIL_TRANSPORT;
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = undefined;
    (env as { RESEND_FROM?: string }).RESEND_FROM = undefined;
    (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = 'resend';
    try {
      await expect(processClientReportJob(jobFor(schedule.id), {
        db: getTestDb() as never,
      })).resolves.toMatchObject({ attempted: 3, suppressed: 3, skipped: false });
    } finally {
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = originalKey;
      (env as { RESEND_FROM?: string }).RESEND_FROM = originalFrom;
      (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = originalTransport;
    }
  });

  it('classifies a non-Error composition rejection without logging its value', async () => {
    const schedule = await seedSchedule();
    const rejection = { kind: 'opaque-rejection' };
    const find = vi.spyOn(Site, 'findOne').mockImplementationOnce(() => ({
      select: () => ({ lean: () => Promise.reject(rejection) }),
    }) as never);
    try {
      await expect(processClientReportJob(jobFor(schedule.id), {
        db: getTestDb() as never,
        logger,
      })).rejects.toBe(rejection);
    } finally {
      find.mockRestore();
    }
  });

  it('resolves owner, active, removed, pending, unattached, and external recipients independently', async () => {
    const schedule = await seedSchedule();
    const accountId = schedule.accountId;
    const active = await User.create({
      _id: new mongoose.Types.ObjectId(),
      email: 'active-member@example.test',
      emailVerified: true,
    });
    const removed = await User.create({
      _id: new mongoose.Types.ObjectId(),
      email: 'removed-member@example.test',
      emailVerified: true,
    });
    const pending = await User.create({
      _id: new mongoose.Types.ObjectId(),
      email: 'pending-member@example.test',
      emailVerified: true,
    });
    await User.create({
      _id: new mongoose.Types.ObjectId(),
      email: 'unattached-user@example.test',
      emailVerified: true,
    });
    const adminMember = await User.create({
      _id: new mongoose.Types.ObjectId(),
      email: 'admin-member@example.test',
      emailVerified: true,
    });
    const selectedDenied = await User.create({
      _id: new mongoose.Types.ObjectId(),
      email: 'selected-denied@example.test',
      emailVerified: true,
    });
    const expiresAt = new Date('2027-01-01T00:00:00.000Z');
    await getTestDb().insert(teamMembers).values([
      {
        teamId: accountId,
        userId: active.id as string,
        email: active.email,
        inviteTokenHash: 'a'.repeat(64),
        invitedBy: accountId,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt,
      },
      {
        teamId: accountId,
        userId: selectedDenied.id as string,
        email: selectedDenied.email,
        siteAccessMode: 'selected',
        inviteTokenHash: 'e'.repeat(64),
        invitedBy: accountId,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt,
      },
      {
        teamId: accountId,
        userId: removed.id as string,
        email: removed.email,
        inviteTokenHash: 'b'.repeat(64),
        invitedBy: accountId,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        revokedAt: new Date('2026-07-02T00:00:00.000Z'),
        expiresAt,
      },
      {
        teamId: accountId,
        userId: pending.id as string,
        email: pending.email,
        inviteTokenHash: 'c'.repeat(64),
        invitedBy: accountId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt,
      },
      {
        // Recipient eligibility keys off acceptance/revocation, never off the
        // team role — the `admin` role added
        // must deliver exactly like `member`.
        teamId: accountId,
        userId: adminMember.id as string,
        email: adminMember.email,
        role: 'admin',
        inviteTokenHash: 'd'.repeat(64),
        invitedBy: accountId,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt,
      },
    ]);
    const [keyword] = await getTestDb().insert(keywords).values({
      accountId,
      siteId: schedule.siteId,
      phrase: 'rank only report',
      locationCode: 2_848,
      languageCode: 'en',
      device: 'desktop',
      engine: 'google',
      engineTarget: null,
      active: true,
    }).returning({ id: keywords.id });
    await getTestDb().insert(rankings).values({
      keywordId: keyword!.id,
      engine: 'google',
      position: 2,
      checkedAt: new Date('2026-07-31T00:00:00.000Z'),
      source: 'fresh',
    });
    const logo = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    }).png().toBuffer();
    await User.findByIdAndUpdate(accountId, {
      $set: {
        branding: {
          companyName: '',
          accentColor: '',
          logoPngBase64: logo.toString('base64'),
          logoWidth: 8,
          logoHeight: 8,
        },
      },
    });
    const emails = [
      'processor-owner@example.test',
      'active-member@example.test',
      'removed-member@example.test',
      'pending-member@example.test',
      'unattached-user@example.test',
      'admin-member@example.test',
      'external@example.test',
      'selected-denied@example.test',
    ];
    await getTestDb().update(scheduledReports).set({
      recipients: emails,
      sections: { audit: false, ranks: true, gsc: false },
    }).where(eq(scheduledReports.id, schedule.id));

    const deliver = vi.fn(async (input: {
      recipients: Array<{ email: string; idempotencyKey: string }>;
      payload: { attachment: { contentBase64: string } };
    }) => input.recipients.map((recipient) => ({
      email: recipient.email,
      status: 'sent' as const,
      suppressionReason: null,
      errorCode: null,
      providerMessageId: 'resolved-recipient',
    })));
    const processor = createClientReportProcessor({
      db: getTestDb() as never,
      deliver: deliver as never,
    });
    await expect(processor(jobFor(schedule.id))).resolves.toMatchObject({
      attempted: 8,
      sent: 5,
      suppressed: 3,
    });
    const resolved = deliver.mock.calls[0]![0];
    expect(resolved.payload.attachment.contentBase64).toMatch(/^JVBER/u);
    expect(resolved.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'processor-owner@example.test' }),
      expect.objectContaining({ email: 'active-member@example.test' }),
      expect.objectContaining({ email: 'unattached-user@example.test' }),
      // Delivered, not suppressed — the `sent: 5` count above is the assertion
      // that the admin-role membership resolved `active`.
      expect.objectContaining({ email: 'admin-member@example.test' }),
      expect.objectContaining({ email: 'external@example.test' }),
    ]));
    expect(resolved.recipients.map((recipient) => recipient.email)).not.toEqual(
      expect.arrayContaining([
        'removed-member@example.test',
        'pending-member@example.test',
        'selected-denied@example.test',
      ]),
    );
  });

  it('dead-letters an exhausted client-report job with its minimal payload', async () => {
    const scheduleId = randomUUID();
    const job = jobFor(scheduleId, 3);
    const terminalError = new Error('client report delivery failed for every eligible recipient');
    const add = vi.fn(async () => ({}));
    const dlq = { add } as unknown as Queue;
    await createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: CLIENT_REPORTS_QUEUE,
      logger,
      now: () => new Date('2026-07-30T10:20:00.000Z'),
    })(job, terminalError!);
    expect(add).toHaveBeenCalledWith('dead-letter', {
      original: job.data,
      queue: 'client-reports',
      err: terminalError!.message,
      failedAt: '2026-07-30T10:20:00.000Z',
    });
  });

  it('derives a colon-free run key for scheduler template jobs', () => {
    const runKey = clientReportRunKey(
      '3f918d5c-2f24-4a78-a82e-adf466d53ee5',
      new Date('2026-07-30T10:15:30.000Z'),
    );
    expect(runKey).toBe('3f918d5c-2f24-4a78-a82e-adf466d53ee5-202607301015');
    expect(runKey).not.toContain(':');
  });

  it('derives a normalized, recipient-free delivery idempotency key', () => {
    const a = clientReportDeliveryIdempotencyKey(
      '3f918d5c-2f24-4a78-a82e-adf466d53ee5',
      'run-202607301015',
      ' Client@Example.Test ',
    );
    const b = clientReportDeliveryIdempotencyKey(
      '3f918d5c-2f24-4a78-a82e-adf466d53ee5',
      'run-202607301015',
      'client@example.test',
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^client-report\/[0-9a-f-]{36}\/run-202607301015\/[0-9a-f]{64}$/u);
    expect(a).not.toContain('example.test');
    expect(a).not.toContain('@');
  });
});
