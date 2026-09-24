/**
 * Content-monitor processor tests (spec 10) against real PGlite + memory Mongo.
 * Proves: check_completed + change_detected event recording (units 0 — no
 * double-count), material vs noise-suppressed detection, first-observation
 * baseline, durable notification-outbox crash recovery, idempotent replay of a
 * processed receipt, missing / mismatched monitor handling, and that no
 * crawled/diff text ever reaches the logger.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
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
import { contentMonitorEvents } from '../../db/schema/content-monitor-events.js';
import { Site } from '../sites/sites.model.js';
import { User } from '../users/index.js';
import {
  ContentMonitor,
  MonitorEvidence,
  MonitorWebhookReceipt,
} from './monitor.model.js';
import { normalizeFingerprint } from './change-detector.js';
import { recordContentMonitorEvent } from './monitoring.events.js';
import {
  monitorNotificationRequestFingerprint,
  type NotifyMonitorMaterialChangeInput,
} from './monitoring.notifications.js';
import {
  createContentMonitorProcessor,
  monitoringProcessorTestables,
  MONITOR_NOTIFICATION_LEASE_MS,
  MONITOR_NOTIFICATION_MAX_ATTEMPTS,
  MONITOR_NOTIFICATION_RETRY_WINDOW_MS,
  MONITOR_PROCESSING_MAX_ATTEMPTS,
  MONITOR_PLANNING_LEASE_MS,
  shouldDeadLetterContentMonitorJob,
} from './monitoring.processor.js';
import type { ContentMonitorJob } from '../../shared/queue/index.js';
import { featureFlags } from '../../db/schema/index.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';
const REF = 'provider-ref-hash';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;

const ENC = { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyVersion: 1 };
const originalMonitoringEnabled = env.CONTENT_MONITORING_ENABLED;

function jobFor(monitorId: string, receiptId: string): Job<ContentMonitorJob> {
  return {
    data: { accountId: ACCOUNT, siteId: SITE, monitorId, receiptId },
  } as unknown as Job<ContentMonitorJob>;
}

async function seedMonitor(over: Record<string, unknown> = {}) {
  return ContentMonitor.create({
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId: SITE,
    targetUrl: 'https://example.com/page',
    targetKind: 'owned',
    locale: 'en',
    providerMonitorIdEncrypted: ENC,
    providerMonitorRef: REF,
    createdBy: ACCOUNT,
    ...over,
  });
}

async function seedReceipt(
  monitorId: string,
  events: Record<string, unknown>[],
  over: Record<string, unknown> = {},
) {
  return MonitorWebhookReceipt.create({
    provider: 'firecrawl',
    eventId: `evt-${monitorId}-${Math.random()}`,
    monitorId,
    accountId: ACCOUNT,
    siteId: SITE,
    providerMonitorRef: REF,
    checkId: 'chk-1',
    eventType: 'monitor.check.completed',
    payloadHash: 'ph',
    events,
    status: 'received',
    receivedAt: new Date(),
    expiryAt: new Date(Date.now() + 1000),
    ...over,
  });
}

const changeEvent = (over: Record<string, unknown> = {}) => ({
  eventKey: 'evt-key-1',
  checkId: 'chk-1',
  targetUrl: 'https://example.com/page',
  status: 'changed',
  changed: true,
  contentHash: 'new-hash',
  diffText: 'a short sanitized diff fragment',
  occurredAt: new Date(),
  ...over,
});

const processingPlan = (over: Record<string, unknown> = {}) => ({
  plannedAt: new Date('2026-07-20T00:00:00.000Z'),
  isoWeek: '2026-W30',
  previousNormalizedHash: 'old',
  previousBaselineStatus: 'changed',
  previousCursorOccurredAt: null,
  previousCursorEventKey: null,
  nextNormalizedHash: 'next',
  nextBaselineStatus: 'changed',
  nextCursorOccurredAt: new Date('2026-07-20T00:00:00.000Z'),
  nextCursorEventKey: 'evt-key-1',
  acceptedEventKeys: ['evt-key-1'],
  materialEvents: [{ eventKey: 'evt-key-1', reason: 'hash_changed' }],
  baselineCommittedAt: null,
  ...over,
});

const pendingNotification = (over: Record<string, unknown> = {}) => {
  const base = {
    state: 'pending',
    ownerUserId: ACCOUNT,
    recipientEmail: 'owner@example.com',
    senderIdentity: 'no-reply@example.com',
    suppressionReason: null,
    targetUrl: 'https://example.com/page',
    locale: 'en' as const,
    subject: 'Page changed',
    text: 'Review the monitored page in RankMeFast.',
    html: '<html lang="en" dir="ltr"><body>Review the monitored page in RankMeFast.</body></html>',
    idempotencyKey: 'content-monitor/test-notification',
    leaseId: null,
    leaseUntil: null,
    attemptCount: 0,
    firstAttemptAt: null,
    retryUntil: null,
    lastAttemptAt: null,
    completedAt: null,
    outcome: null,
    providerMessageId: null,
    lastFailure: null,
  };
  const merged = { ...base, ...over };
  return {
    ...merged,
    requestFingerprint: over.requestFingerprint ?? monitorNotificationRequestFingerprint({
      locale: merged.locale as 'en',
      recipientEmail: merged.recipientEmail as string | null,
      senderIdentity: merged.senderIdentity as string | null,
      subject: merged.subject as string,
      text: merged.text as string,
      html: merged.html as string,
      idempotencyKey: merged.idempotencyKey as string,
    }),
  };
};

describe('shouldDeadLetterContentMonitorJob', () => {
  it('archives only malformed jobs or receipts that are durably terminal failures', async () => {
    const monitor = await seedMonitor();
    const receipt = await seedReceipt(String(monitor._id), []);
    const job = jobFor(String(monitor._id), String(receipt._id));

    expect(await shouldDeadLetterContentMonitorJob(job)).toBe(false);

    await MonitorWebhookReceipt.updateOne(
      { _id: receipt._id },
      {
        $set: {
          status: 'failed',
          failureReason: 'processing-retries-exhausted',
          processedAt: new Date(),
        },
      },
      { runValidators: true },
    );
    expect(await shouldDeadLetterContentMonitorJob(job)).toBe(true);

    await MonitorWebhookReceipt.updateOne(
      { _id: receipt._id },
      {
        $set: {
          status: 'processed',
          failureReason: null,
          notification: {
            state: 'failed',
            ownerUserId: ACCOUNT,
            locale: 'en',
            idempotencyKey: `content-monitor/${receipt._id}`,
            attemptCount: MONITOR_NOTIFICATION_MAX_ATTEMPTS,
            outcome: 'retries-exhausted',
          },
        },
      },
      { runValidators: true },
    );
    expect(await shouldDeadLetterContentMonitorJob(job)).toBe(true);

    await MonitorWebhookReceipt.deleteOne({ _id: receipt._id });
    expect(await shouldDeadLetterContentMonitorJob(job)).toBe(false);
    expect(
      await shouldDeadLetterContentMonitorJob({ data: { invalid: true } } as Job),
    ).toBe(true);
  });
});

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  env.CONTENT_MONITORING_ENABLED = originalMonitoringEnabled;
  await stopMemoryMongo();
  await stopTestPostgres();
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.CONTENT_MONITORING_ENABLED = true;
  await clearCollections();
  await truncateAllTables();
});

describe('createContentMonitorProcessor', () => {
  it('finishes an accepted receipt after the env switch turns off', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    env.CONTENT_MONITORING_ENABLED = false;
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    expect((await MonitorWebhookReceipt.findById(receipt._id))!.status).toBe('processed');
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(2);
    expect(await MonitorEvidence.find({ monitorId: monitor._id })).toHaveLength(1);
    expect(notify).toHaveBeenCalledOnce();
    expect((await ContentMonitor.findById(monitor._id))!.normalizedHash).not.toBe('old');
  });

  it('finishes an accepted receipt after the operator kill switch turns off', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    await db().insert(featureFlags).values({ key: 'firecrawl_change_monitoring', enabled: false });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    expect((await MonitorWebhookReceipt.findById(receipt._id))!.status).toBe('processed');
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(2);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('detects a material change: events, evidence, baseline, notify', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const logger = pino({ level: 'silent' });
    const monitor = await seedMonitor({ normalizedHash: 'old-baseline' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const now = () => new Date('2026-07-20T00:00:00.000Z');

    const processor = createContentMonitorProcessor({ db: db(), logger, now, notify });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    const events = await db()
      .select()
      .from(contentMonitorEvents)
      .where(eq(contentMonitorEvents.monitorId, String(monitor._id)));
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(['change_detected', 'check_completed']);
    // Never reserves — every processor-written row carries 0 units.
    expect(events.every((e) => Number(e.units) === 0)).toBe(true);

    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.normalizedHash).toBe(normalizeFingerprint({ status: 'changed', contentHash: 'new-hash', diffText: null }));
    expect(updated!.lastMaterialChangeAt).not.toBeNull();
    expect(updated!.lastCheckAt).not.toBeNull();

    const evidence = await MonitorEvidence.find({ monitorId: monitor._id });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.reason).toBe('hash_changed');

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('delivered');
    expect(done!.notification?.outcome).toBe('delivered');
    expect(done!.notification?.attemptCount).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('records a first-observation baseline without notifying', async () => {
    const notify = vi.fn();
    const monitor = await seedMonitor(); // normalizedHash null
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);

    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.normalizedHash).not.toBeNull();
    expect(updated!.lastMaterialChangeAt).toBeNull();
    const events = await db().select().from(contentMonitorEvents);
    expect(events.map((e) => e.kind)).toEqual(['check_completed']);
    expect(notify).not.toHaveBeenCalled();
  });

  it('suppresses noise: vendor "changed" but the normalized hash is unchanged', async () => {
    const baseline = normalizeFingerprint({ status: 'changed', contentHash: 'same', diffText: null });
    const notify = vi.fn();
    const monitor = await seedMonitor({ normalizedHash: baseline });
    const receipt = await seedReceipt(String(monitor._id), [
      changeEvent({ contentHash: 'same', diffText: null }),
    ]);

    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    const events = await db().select().from(contentMonitorEvents);
    expect(events.map((e) => e.kind)).toEqual(['check_completed']);
    expect(notify).not.toHaveBeenCalled();
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
  });

  it('is a no-op on replay of an already-processed receipt', async () => {
    const notify = vi.fn();
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processed',
      processedAt: new Date(),
    });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    expect(notify).not.toHaveBeenCalled();
    const events = await db().select().from(contentMonitorEvents);
    expect(events).toHaveLength(0);
  });

  it('drops a job whose receipt is missing', async () => {
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });
    await expect(
      processor(jobFor(SITE, '000000000000000000000fff')),
    ).resolves.toBeUndefined();
  });

  it('skips the receipt when the monitor is deleted / ref mismatched', async () => {
    const notify = vi.fn();
    const monitor = await seedMonitor({ providerMonitorRef: 'DIFFERENT' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('skipped');
    expect(notify).not.toHaveBeenCalled();
  });

  it('terminal-skips a planned outbox when its monitor was deleted', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: {
        plannedAt: new Date('2026-07-20T00:00:00.000Z'),
        isoWeek: '2026-W30',
        nextNormalizedHash: 'next',
        materialEvents: [{ eventKey: 'evt-key-1', reason: 'hash_changed' }],
      },
      notification: {
        state: 'waiting',
        ownerUserId: ACCOUNT,
        targetUrl: 'https://example.com/page',
        locale: 'en',
        subject: 'Page changed',
        text: 'Review the monitored page in RankMeFast.',
        idempotencyKey: 'content-monitor/deleted-monitor',
      },
    });
    await ContentMonitor.deleteOne({ _id: monitor._id });
    const notify = vi.fn();
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const skipped = await MonitorWebhookReceipt.findById(receipt._id);
    expect(skipped!.status).toBe('skipped');
    expect(skipped!.processedAt).not.toBeNull();
    expect(skipped!.notification?.leaseId).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('terminalizes a malformed legacy receipt instead of retrying it forever', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: null,
    });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');
    const failed = await MonitorWebhookReceipt.findById(receipt._id);
    expect(failed!.status).toBe('failed');
    expect(failed!.failureReason).toBe('processing-plan-missing');
    expect(failed!.events[0]!.diffText).toBeNull();
  });

  it('dead-letters a legacy unrendered notification locale with zero sends', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'notification_pending',
      processingPlan: processingPlan(),
      notification: pendingNotification({
        html: null,
        requestFingerprint: null,
      }),
    });
    const notify = vi.fn();
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect(notify).not.toHaveBeenCalled();
    const failed = await MonitorWebhookReceipt.findById(receipt._id);
    expect(failed).toMatchObject({
      status: 'failed',
      failureReason: 'notification-payload-invalid',
      notification: null,
    });
  });

  it('terminal-skips the receipt when the monitor site is paused (belt-and-braces)', async () => {
    const notify = vi.fn();
    const paused = await Site.create({
      accountId: ACCOUNT,
      url: 'https://paused.example.com',
      domain: 'paused.example.com',
      paused: true,
      pausedAt: new Date(),
    });
    const monitor = await seedMonitor({ siteId: paused._id, normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    // Terminal skip: nothing re-enqueues it and nothing was processed.
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('skipped');
    expect(done!.processedAt).not.toBeNull();
    const events = await db().select().from(contentMonitorEvents);
    expect(events).toHaveLength(0);
    const evidence = await MonitorEvidence.find({ monitorId: monitor._id });
    expect(evidence).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.lastCheckAt).toBeNull();
    expect(updated!.normalizedHash).toBe('old');
  });

  it('repairs evidence when the change event landed before a prior crash', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    // Pre-record the change event so recordContentMonitorEvent no-ops (wrote=false).
    await recordContentMonitorEvent(db(), {
      accountId: ACCOUNT,
      siteId: SITE,
      monitorId: String(monitor._id),
      eventKey: 'evt-key-1',
      kind: 'change_detected',
      checkId: 'chk-1',
    });
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    // Still material, and replay repairs the missing evidence row even though
    // the append-only Postgres event already exists.
    expect(notify).toHaveBeenCalledTimes(1);
    const evidence = await MonitorEvidence.find({ monitorId: monitor._id });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.eventKey).toBe('evt-key-1');
  });

  it('replays a crash after the immutable plan without re-deciding materiality', async () => {
    const notify = vi.fn().mockResolvedValue({
      delivered: true,
      providerMessageId: 'email-plan-replay',
    });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const crash = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      notify,
      afterProcessingPlanPersisted: async () => {
        throw new Error('simulated process death after plan commit');
      },
    });

    await expect(
      crash(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('simulated process death');
    const planned = await MonitorWebhookReceipt.findById(receipt._id);
    expect(planned!.status).toBe('processing');
    expect(planned!.processingPlan?.materialEvents).toEqual([
      expect.objectContaining({ eventKey: 'evt-key-1', reason: 'hash_changed' }),
    ]);
    expect(planned!.notification?.state).toBe('waiting');
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();

    const replay = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => new Date('2026-07-20T00:01:00.000Z'),
      notify,
    });
    await replay(jobFor(String(monitor._id), String(receipt._id)));

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('delivered');
    expect(done!.notification?.providerMessageId).toBe('email-plan-replay');
    expect(notify).toHaveBeenCalledOnce();
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(2);
    expect(await MonitorEvidence.find({ monitorId: monitor._id })).toHaveLength(1);
  });

  it('retries the same provider idempotency key after a crash post-send without a duplicate visible email', async () => {
    let clock = new Date('2026-07-20T00:00:00.000Z');
    const visibleKeys = new Set<string>();
    let visibleDeliveries = 0;
    const notify = vi.fn(async (input: NotifyMonitorMaterialChangeInput) => {
      if (!visibleKeys.has(input.idempotencyKey)) {
        visibleKeys.add(input.idempotencyKey);
        visibleDeliveries += 1;
      }
      return { delivered: true, providerMessageId: 'email-idempotent' };
    });
    await User.create({
      _id: ACCOUNT,
      email: 'frozen-owner@example.com',
      emailVerified: true,
      notificationPreferences: { emailMonitorChange: true },
    });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const crash = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => clock,
      notify,
      afterNotificationAttempted: async () => {
        throw new Error('simulated process death after provider accept');
      },
    });

    await expect(
      crash(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('simulated process death');
    const stranded = await MonitorWebhookReceipt.findById(receipt._id);
    expect(stranded!.status).toBe('notification_pending');
    expect(stranded!.processedAt).toBeNull();
    expect(stranded!.notification?.state).toBe('sending');
    expect(stranded!.notification?.attemptCount).toBe(1);
    expect(stranded!.notification?.requestFingerprint).toBe(
      notify.mock.calls[0]![0].requestFingerprint,
    );
    expect(visibleDeliveries).toBe(1);

    // Mutable account state cannot alter a request paired with the same
    // provider idempotency key after the first outcome became ambiguous.
    await User.updateOne(
      { _id: ACCOUNT },
      {
        $set: {
          email: 'changed-after-send@example.com',
          language: 'ar',
          'notificationPreferences.emailMonitorChange': false,
        },
      },
    );

    // A concurrent/stale replay cannot steal an unexpired sending lease.
    const tooEarly = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => clock,
      notify,
    });
    await tooEarly(jobFor(String(monitor._id), String(receipt._id)));
    expect(notify).toHaveBeenCalledOnce();

    clock = new Date(clock.getTime() + MONITOR_NOTIFICATION_LEASE_MS + 1);
    const replay = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => clock,
      notify,
    });
    await replay(jobFor(String(monitor._id), String(receipt._id)));

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('delivered');
    expect(done!.notification?.attemptCount).toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0]![0].idempotencyKey).toBe(
      notify.mock.calls[1]![0].idempotencyKey,
    );
    expect(notify.mock.calls[1]![0]).toEqual(notify.mock.calls[0]![0]);
    expect(notify.mock.calls[1]![0]).toMatchObject({
      recipientEmail: notify.mock.calls[0]![0].recipientEmail,
      senderIdentity: notify.mock.calls[0]![0].senderIdentity,
      suppressionReason: notify.mock.calls[0]![0].suppressionReason,
      subject: notify.mock.calls[0]![0].subject,
      text: notify.mock.calls[0]![0].text,
      html: notify.mock.calls[0]![0].html,
      locale: notify.mock.calls[0]![0].locale,
      requestFingerprint: notify.mock.calls[0]![0].requestFingerprint,
    });
    expect(notify.mock.calls[0]![0].recipientEmail).toBe(
      'frozen-owner@example.com',
    );
    expect(visibleDeliveries).toBe(1);
    const events = await db().select().from(contentMonitorEvents);
    expect(events).toHaveLength(2);
    expect(events.every((event) => Number(event.units) === 0)).toBe(true);
    expect(await MonitorEvidence.find({ monitorId: monitor._id })).toHaveLength(1);
  });

  it('keeps a transport failure pending and completes on a later replay', async () => {
    const notify = vi
      .fn()
      .mockResolvedValueOnce({ delivered: false, reason: 'transport-failure' })
      .mockResolvedValueOnce({ delivered: true, providerMessageId: 'email-retried' });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('notification transport failure');
    const pending = await MonitorWebhookReceipt.findById(receipt._id);
    expect(pending!.status).toBe('notification_pending');
    expect(pending!.processedAt).toBeNull();
    expect(pending!.notification?.state).toBe('pending');
    expect(pending!.notification?.lastFailure).toBe('transport-failure');

    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('delivered');
    expect(done!.notification?.attemptCount).toBe(2);
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(2);
  });

  it('terminalizes a bounded series of known transport failures', async () => {
    const notify = vi
      .fn()
      .mockResolvedValue({ delivered: false, reason: 'transport-failure' });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      notify,
    });

    for (let attempt = 1; attempt < MONITOR_NOTIFICATION_MAX_ATTEMPTS; attempt += 1) {
      await expect(
        processor(jobFor(String(monitor._id), String(receipt._id))),
      ).rejects.toThrow('notification transport failure');
    }
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('failed');
    expect(done!.notification?.outcome).toBe('retries-exhausted');
    expect(done!.notification?.attemptCount).toBe(
      MONITOR_NOTIFICATION_MAX_ATTEMPTS,
    );
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    expect(notify).toHaveBeenCalledTimes(MONITOR_NOTIFICATION_MAX_ATTEMPTS);
  });

  it('never mislabels an ambiguous transport result as a known non-delivery', async () => {
    const notify = vi.fn().mockResolvedValue({
      delivered: false,
      reason: 'transport-failure',
      outcomeUnknown: true,
    });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      notify,
    });

    for (let attempt = 1; attempt < MONITOR_NOTIFICATION_MAX_ATTEMPTS; attempt += 1) {
      await expect(
        processor(jobFor(String(monitor._id), String(receipt._id))),
      ).rejects.toThrow('provider outcome is unknown');
    }
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('failed');
    expect(done!.notification?.outcome).toBe('provider-outcome-unknown');
    expect(done!.notification?.lastFailure).toBe('provider-outcome-unknown');
    expect(notify).toHaveBeenCalledTimes(MONITOR_NOTIFICATION_MAX_ATTEMPTS);
  });

  it('stops retrying at the 23-hour idempotency safety boundary', async () => {
    let clock = new Date('2026-07-20T00:00:00.000Z');
    const notify = vi
      .fn()
      .mockResolvedValue({ delivered: false, reason: 'transport-failure' });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => clock,
      notify,
    });
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('notification transport failure');
    const pending = await MonitorWebhookReceipt.findById(receipt._id);
    expect(
      pending!.notification!.retryUntil!.getTime() -
        pending!.notification!.firstAttemptAt!.getTime(),
    ).toBe(MONITOR_NOTIFICATION_RETRY_WINDOW_MS);

    clock = new Date(clock.getTime() + MONITOR_NOTIFICATION_RETRY_WINDOW_MS);
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.outcome).toBe('retry-window-expired');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('records an unknown provider outcome for an exhausted expired sending lease', async () => {
    let clock = new Date('2026-07-20T00:00:00.000Z');
    const notify = vi.fn().mockResolvedValue({
      delivered: true,
      providerMessageId: 'accepted-before-crash',
    });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const crash = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => clock,
      notify,
      afterNotificationAttempted: async () => {
        throw new Error('simulated ambiguous provider outcome');
      },
    });
    await expect(
      crash(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('simulated ambiguous provider outcome');

    clock = new Date(clock.getTime() + MONITOR_NOTIFICATION_LEASE_MS + 1);
    await MonitorWebhookReceipt.updateOne(
      { _id: receipt._id },
      {
        $set: {
          'notification.attemptCount': MONITOR_NOTIFICATION_MAX_ATTEMPTS,
          'notification.leaseUntil': new Date(clock.getTime() - 1),
        },
      },
    );
    const replay = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => clock,
      notify,
    });
    await expect(
      replay(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('failed');
    expect(done!.notification?.outcome).toBe('provider-outcome-unknown');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('durably suppresses an opted-out notification without retrying it', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: false, reason: 'opted-out' });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    expect(done!.notification?.state).toBe('suppressed');
    expect(done!.notification?.outcome).toBe('opted-out');
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    expect(notify).toHaveBeenCalledOnce();
  });

  it('releases the notification claim when the notifier throws', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('recipient detail must not escape'));
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('content-monitor notification transport threw');

    const pending = await MonitorWebhookReceipt.findById(receipt._id);
    expect(pending!.status).toBe('notification_pending');
    expect(pending!.notification?.state).toBe('pending');
    expect(pending!.notification?.leaseId).toBeNull();
    expect(pending!.notification?.lastFailure).toBe('transport-failure');
  });

  it('handles a diff-only event (null contentHash) as material', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [
      changeEvent({ contentHash: null, diffText: 'a changed paragraph of text' }),
    ]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.normalizedHash).toBe(
      normalizeFingerprint({ status: 'changed', contentHash: null, diffText: 'a changed paragraph of text' }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('uses the default deps (now / evidenceTtl / notify) when not injected', async () => {
    // No `now`, no `notify`, no `evidenceTtlDays` → factory defaults are used.
    // ACCOUNT is not a real User, so the default notifier resolves to
    // no-recipient and sends no email.
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('processed');
    const evidence = await MonitorEvidence.find({ monitorId: monitor._id });
    expect(evidence).toHaveLength(1);
  });

  it('records evidence with a null diff for a hash-only material change', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [
      changeEvent({ contentHash: 'brand-new', diffText: null }),
    ]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const evidence = await MonitorEvidence.find({ monitorId: monitor._id });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.diffText).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('rejects a queue envelope whose site or monitor does not exactly match the receipt', async () => {
    const notify = vi.fn();
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    const wrongSite = {
      data: {
        accountId: ACCOUNT,
        siteId: '000000000000000000000aaa',
        monitorId: String(monitor._id),
        receiptId: String(receipt._id),
      },
    } as unknown as Job<ContentMonitorJob>;

    await expect(processor(wrongSite)).rejects.toThrow('durable terminal failure');
    const failed = await MonitorWebhookReceipt.findById(receipt._id);
    expect(failed!.status).toBe('failed');
    expect(failed!.failureReason).toBe('receipt-binding-invalid');
    expect(await MonitorEvidence.countDocuments()).toBe(0);
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['target', { 'events.0.targetUrl': 'https://other.example.com/page' }],
    ['check', { 'events.0.checkId': 'chk-other' }],
  ])('terminalizes a provider batch with a mixed %s binding', async (_kind, mutation) => {
    const notify = vi.fn();
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    // Simulate a legacy/corrupted row that bypassed current field validators.
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: receipt._id },
      { $set: mutation },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.failureReason).toBe(
      'receipt-binding-invalid',
    );
    expect(await MonitorEvidence.countDocuments()).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the baseline monotonic when an older receipt arrives after a newer one', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const newerAt = new Date('2026-07-20T02:00:00.000Z');
    const olderAt = new Date('2026-07-20T01:00:00.000Z');
    const newer = await seedReceipt(
      String(monitor._id),
      [
        changeEvent({
          eventKey: 'evt-newer',
          checkId: 'chk-newer',
          contentHash: 'newer-hash',
          occurredAt: newerAt,
        }),
      ],
      { checkId: 'chk-newer' },
    );
    const older = await seedReceipt(
      String(monitor._id),
      [
        changeEvent({
          eventKey: 'evt-older',
          checkId: 'chk-older',
          contentHash: 'older-hash',
          occurredAt: olderAt,
        }),
      ],
      { checkId: 'chk-older' },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    await processor(jobFor(String(monitor._id), String(newer._id)));
    const expectedNewestHash = normalizeFingerprint({
      status: 'changed',
      contentHash: 'newer-hash',
      diffText: null,
    });
    await processor(jobFor(String(monitor._id), String(older._id)));

    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.normalizedHash).toBe(expectedNewestHash);
    expect(updated!.baselineOccurredAt).toEqual(newerAt);
    expect(updated!.baselineEventKey).toBe('evt-newer');
    expect(notify).toHaveBeenCalledOnce();
    expect(await MonitorEvidence.find({ monitorId: monitor._id })).toHaveLength(1);
    expect((await MonitorWebhookReceipt.findById(older._id))!.events[0]!.diffText).toBeNull();
  });

  it('serializes concurrent receipt planning and applies observations in cursor order', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const firstAt = new Date('2026-07-20T01:00:00.000Z');
    const secondAt = new Date('2026-07-20T02:00:00.000Z');
    const first = await seedReceipt(
      String(monitor._id),
      [
        changeEvent({
          eventKey: 'evt-first',
          checkId: 'chk-first',
          contentHash: 'hash-first',
          occurredAt: firstAt,
        }),
      ],
      { checkId: 'chk-first' },
    );
    const second = await seedReceipt(
      String(monitor._id),
      [
        changeEvent({
          eventKey: 'evt-second',
          checkId: 'chk-second',
          contentHash: 'hash-second',
          occurredAt: secondAt,
        }),
      ],
      { checkId: 'chk-second' },
    );
    let planPersisted!: () => void;
    const planPersistedPromise = new Promise<void>((resolve) => {
      planPersisted = resolve;
    });
    let releaseFirst!: () => void;
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstProcessor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
      afterProcessingPlanPersisted: async () => {
        planPersisted();
        await releaseFirstPromise;
      },
    });
    const secondProcessor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    const firstRun = firstProcessor(jobFor(String(monitor._id), String(first._id)));
    await planPersistedPromise;
    await expect(
      secondProcessor(jobFor(String(monitor._id), String(second._id))),
    ).rejects.toThrow('baseline planner is busy');
    releaseFirst();
    await firstRun;
    await secondProcessor(jobFor(String(monitor._id), String(second._id)));

    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.baselineOccurredAt).toEqual(secondAt);
    expect(updated!.baselineEventKey).toBe('evt-second');
    expect(updated!.normalizedHash).toBe(
      normalizeFingerprint({
        status: 'changed',
        contentHash: 'hash-second',
        diffText: null,
      }),
    );
    expect(updated!.planningReceiptId).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(
      (await MonitorEvidence.find({ monitorId: monitor._id }).sort({ observedAt: 1 })).map(
        (row) => row.eventKey,
      ),
    ).toEqual(['evt-first', 'evt-second']);
  });

  it('suppresses repeated removed events but not a later restoration', async () => {
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const removedAt = new Date('2026-07-20T01:00:00.000Z');
    const monitor = await seedMonitor({
      normalizedHash: 'old',
      baselineStatus: 'removed',
      baselineOccurredAt: removedAt,
      baselineEventKey: 'removed-first',
    });
    const repeated = await seedReceipt(
      String(monitor._id),
      [
        changeEvent({
          eventKey: 'removed-again',
          status: 'removed',
          contentHash: null,
          occurredAt: new Date('2026-07-20T02:00:00.000Z'),
        }),
      ],
    );
    const restored = await seedReceipt(
      String(monitor._id),
      [
        changeEvent({
          eventKey: 'restored',
          checkId: 'chk-restored',
          status: 'changed',
          contentHash: 'restored-hash',
          occurredAt: new Date('2026-07-20T03:00:00.000Z'),
        }),
      ],
      { checkId: 'chk-restored' },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    await processor(jobFor(String(monitor._id), String(repeated._id)));
    expect(notify).not.toHaveBeenCalled();
    await processor(jobFor(String(monitor._id), String(restored._id)));
    expect(notify).toHaveBeenCalledOnce();
    expect((await MonitorEvidence.findOne({ eventKey: 'restored' }))!.reason).toBe(
      'page_restored',
    );
  });

  it('accepts a maximum-length configured URL by freezing a bounded display label', async () => {
    const prefix = 'https://example.com/';
    const targetUrl = `${prefix}${'a'.repeat(2048 - prefix.length)}`;
    const notify = vi.fn().mockResolvedValue({ delivered: true });
    const monitor = await seedMonitor({ targetUrl, normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent({ targetUrl })]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });

    await processor(jobFor(String(monitor._id), String(receipt._id)));
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.status).toBe('processed');
    expect(notify.mock.calls[0]![0].subject.length).toBeLessThan(1000);
    expect(notify.mock.calls[0]![0].subject).toContain('…');
  });

  it('bounds a permanently throwing preparation stage across queue recovery cycles', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
      prepareNotification: vi.fn().mockRejectedValue(new Error('template backend unavailable')),
    });

    for (let attempt = 1; attempt < MONITOR_PROCESSING_MAX_ATTEMPTS; attempt += 1) {
      await expect(
        processor(jobFor(String(monitor._id), String(receipt._id))),
      ).rejects.toThrow('template backend unavailable');
    }
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');
    const failed = await MonitorWebhookReceipt.findById(receipt._id);
    expect(failed!.status).toBe('failed');
    expect(failed!.failureReason).toBe('processing-retries-exhausted');
    expect(failed!.processingAttemptCount).toBe(MONITOR_PROCESSING_MAX_ATTEMPTS);
    expect(failed!.events[0]!.diffText).toBeNull();
  });

  it('terminalizes an unsafe or oversized frozen notification before provider dispatch', async () => {
    const notify = vi.fn();
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
      prepareNotification: vi.fn().mockResolvedValue({
        locale: 'en',
        recipientEmail: 'owner@example.com',
        senderIdentity: 'RankMeFast <no-reply@example.com>',
        suppressionReason: null,
        subject: 'x'.repeat(1001),
        text: 'safe body',
        html: '<html lang="en" dir="ltr"><body>safe body</body></html>',
      }),
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toThrow('durable terminal failure');
    const failed = await MonitorWebhookReceipt.findById(receipt._id);
    expect(failed!.status).toBe('failed');
    expect(failed!.failureReason).toBe('notification-payload-invalid');
    expect(notify).not.toHaveBeenCalled();
  });

  it('retains only seven-day evidence after scrubbing the 30-day receipt', async () => {
    const secretDiff = 'SEVEN-DAY-ONLY-DIFF';
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [
      changeEvent({ diffText: secretDiff }),
    ]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn().mockResolvedValue({ delivered: true }),
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    expect((await MonitorWebhookReceipt.findById(receipt._id))!.events[0]!.diffText).toBeNull();
    expect((await MonitorEvidence.findOne({ monitorId: monitor._id }))!.diffText).toBe(
      secretDiff,
    );
    await MonitorEvidence.deleteMany({ expiryAt: { $lte: new Date(Date.now() + 8 * 86_400_000) } });
    expect(await MonitorEvidence.countDocuments({ monitorId: monitor._id })).toBe(0);
    expect(JSON.stringify(await MonitorWebhookReceipt.findById(receipt._id))).not.toContain(
      secretDiff,
    );
  });

  it('terminalizes a receipt whose processing attempts are already exhausted', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      processingAttemptCount: MONITOR_PROCESSING_MAX_ATTEMPTS,
      processingFirstAttemptAt: new Date(Date.now() - 60_000),
      processingRetryUntil: new Date(Date.now() + 3_600_000),
    });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('failed');
    expect(done!.failureReason).toBe('processing-retries-exhausted');
    // The planning owner is always released with the terminal write.
    expect((await ContentMonitor.findById(monitor._id))!.planningReceiptId).toBeNull();
  });

  it('terminalizes a receipt whose processing retry window has expired', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      processingAttemptCount: 1,
      processingFirstAttemptAt: new Date(Date.now() - 86_400_000),
      processingRetryUntil: new Date(Date.now() - 60_000),
    });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('failed');
    expect(done!.failureReason).toBe('processing-window-expired');
  });

  it('skips an accepted receipt whose site was paused before planning', async () => {
    const notify = vi.fn();
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    await Site.create({ _id: SITE, accountId: ACCOUNT, url: 'https://example.com', domain: 'example.com', paused: true });

    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));

    expect((await MonitorWebhookReceipt.findById(receipt._id))!.status).toBe('skipped');
    expect(notify).not.toHaveBeenCalled();
    // No evidence, no events, and the planning claim is handed back.
    expect(await db().select().from(contentMonitorEvents)).toHaveLength(0);
    expect((await ContentMonitor.findById(monitor._id))!.planningReceiptId).toBeNull();
  });

  it('rethrows the original error when the receipt is gone by the time the attempt fails', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const boom = new Error('prepare exploded');
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
      prepareNotification: async () => {
        await MonitorWebhookReceipt.deleteOne({ _id: receipt._id });
        throw boom;
      },
    });

    // No receipt left to terminalize, so the boundary cannot reclassify the
    // failure — the original error propagates untouched.
    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toBe(boom);
  });

  it('permanently fails a receipt whose monitor target URL is unparsable', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    // Bypass schema validation to reproduce a legacy/corrupted stored target.
    await ContentMonitor.collection.updateOne(
      { _id: monitor._id },
      { $set: { targetUrl: 'not-a-url' } },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const done = await MonitorWebhookReceipt.findById(receipt._id);
    expect(done!.status).toBe('failed');
    expect(done!.failureReason).toBe('receipt-binding-invalid');
  });

  it('permanently fails a receipt whose event target URL is unparsable', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: receipt._id },
      { $set: { 'events.0.targetUrl': 'not-a-url' } },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.failureReason).toBe(
      'receipt-binding-invalid',
    );
  });

  it('permanently fails a receipt carrying an event from a different check', async () => {
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    // The schema pre-validate hook rejects this at write time, so the stored
    // row has to be corrupted directly — the binding assertion is the
    // defence-in-depth layer for a legacy or tampered document.
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: receipt._id },
      { $set: { 'events.0.checkId': 'chk-other' } },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });

    await expect(
      processor(jobFor(String(monitor._id), String(receipt._id))),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.failureReason).toBe(
      'receipt-binding-invalid',
    );
  });

  it('never logs crawled / diff text', async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: 'info' },
      { write: (chunk: string) => lines.push(chunk) },
    );
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [
      changeEvent({ diffText: 'SECRET-DIFF-CONTENT-XYZ' }),
    ]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger,
      notify: vi.fn().mockResolvedValue({ delivered: true }),
    });
    await processor(jobFor(String(monitor._id), String(receipt._id)));
    const out = lines.join('\n');
    expect(out).not.toContain('SECRET-DIFF-CONTENT-XYZ');
    expect(out).not.toContain('example.com/page');
  });
});

describe('processor durable invariants', () => {
  it('orders every cursor shape and validates frozen payload and ownership bindings', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const later = new Date(at.getTime() + 1);
    const cursorA = { occurredAt: at, eventKey: 'a' };
    const cursorB = { occurredAt: at, eventKey: 'b' };
    expect(monitoringProcessorTestables.compareCursor(null, null)).toBe(0);
    expect(monitoringProcessorTestables.compareCursor(null, cursorA)).toBe(-1);
    expect(monitoringProcessorTestables.compareCursor(cursorA, null)).toBe(1);
    expect(monitoringProcessorTestables.compareCursor(cursorA, cursorB)).toBeLessThan(0);
    expect(monitoringProcessorTestables.compareCursor(
      { occurredAt: later, eventKey: 'a' },
      cursorA,
    )).toBe(1);

    const monitor = await seedMonitor();
    expect(monitoringProcessorTestables.monitorCursor(monitor)).toBeNull();
    monitor.baselineOccurredAt = at;
    monitor.baselineEventKey = null;
    expect(monitoringProcessorTestables.monitorCursor(monitor)).toEqual({
      occurredAt: at,
      eventKey: '',
    });
    const noPlan = await seedReceipt(String(monitor._id), [changeEvent()]);
    expect(monitoringProcessorTestables.planNextCursor(noPlan)).toBeNull();
    const legacyPlan = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: processingPlan({
        nextCursorOccurredAt: null,
        nextCursorEventKey: null,
      }),
    });
    expect(monitoringProcessorTestables.planNextCursor(legacyPlan)).toBeNull();
    const planned = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: processingPlan({ nextCursorEventKey: null }),
    });
    expect(monitoringProcessorTestables.planNextCursor(planned)).toEqual({
      occurredAt: at,
      eventKey: '',
    });

    const safePayload = {
      locale: 'en',
      recipientEmail: 'owner@example.com',
      senderIdentity: 'no-reply@example.com',
      subject: 'Safe subject',
      text: 'Safe body',
      html: '<html lang="en" dir="ltr"><body>Safe body</body></html>',
    };
    expect(() => monitoringProcessorTestables.assertFrozenNotificationPayload(safePayload))
      .not.toThrow();
    for (const unsafe of [
      { ...safePayload, subject: 'x'.repeat(1001) },
      { ...safePayload, text: 'x'.repeat(10_001) },
      { ...safePayload, subject: '<script>' },
      { ...safePayload, text: '<script>' },
      { ...safePayload, recipientEmail: '<bad>' },
      { ...safePayload, senderIdentity: '<bad>' },
    ]) {
      expect(() => monitoringProcessorTestables.assertFrozenNotificationPayload(unsafe))
        .toThrow(/payload is invalid/u);
    }

    const boundReceipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    expect(() => monitoringProcessorTestables.assertReceiptBindings(boundReceipt, monitor))
      .not.toThrow();
    const foreignReceipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      accountId: '000000000000000000000aaa',
    });
    expect(() => monitoringProcessorTestables.assertReceiptBindings(foreignReceipt, monitor))
      .toThrow(/ownership binding/u);
  });

  it('fails a stale processing claim when its durable receipt disappeared or became terminal', async () => {
    const monitor = await seedMonitor();
    const missing = await seedReceipt(String(monitor._id), [changeEvent()]);
    await MonitorWebhookReceipt.deleteOne({ _id: missing._id });
    await expect(monitoringProcessorTestables.beginProcessingAttempt(missing, new Date()))
      .rejects.toBeInstanceOf(UnrecoverableError);

    const terminal = await seedReceipt(String(monitor._id), [changeEvent()]);
    await MonitorWebhookReceipt.updateOne(
      { _id: terminal._id },
      { $set: { status: 'processed', processedAt: new Date() } },
      { runValidators: true },
    );
    await expect(monitoringProcessorTestables.beginProcessingAttempt(terminal, new Date()))
      .rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('handles every baseline commit outcome, including ownership loss and idempotent recovery', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor();
    const missingPlan = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: null,
    });
    await expect(monitoringProcessorTestables.commitProcessingPlanBaseline(missingPlan, at))
      .rejects.toThrow(/plan is missing/u);

    const committed = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: processingPlan({ baselineCommittedAt: at }),
    });
    await expect(monitoringProcessorTestables.commitProcessingPlanBaseline(committed, at))
      .resolves.toBe('committed');

    const absentMonitorReceipt = await seedReceipt('000000000000000000000999', [changeEvent()], {
      status: 'processing',
      processingPlan: processingPlan(),
    });
    await expect(
      monitoringProcessorTestables.commitProcessingPlanBaseline(absentMonitorReceipt, at),
    ).resolves.toBe('monitor-missing');

    const behindReceipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: processingPlan(),
    });
    monitor.planningReceiptId = absentMonitorReceipt._id;
    monitor.planningLeaseUntil = new Date(at.getTime() + MONITOR_PLANNING_LEASE_MS);
    monitor.baselineOccurredAt = new Date(at.getTime() - 1);
    monitor.baselineEventKey = 'older';
    await monitor.save();
    await expect(monitoringProcessorTestables.commitProcessingPlanBaseline(behindReceipt, at))
      .rejects.toThrow(/ownership was lost/u);

    monitor.baselineOccurredAt = new Date(at.getTime() + 1);
    await monitor.save();
    await expect(monitoringProcessorTestables.commitProcessingPlanBaseline(behindReceipt, at))
      .rejects.toThrow(/ownership changed/u);

    monitor.planningReceiptId = behindReceipt._id;
    monitor.baselineOccurredAt = at;
    monitor.baselineEventKey = 'evt-key-1';
    await monitor.save();
    const updateSpy = vi.spyOn(ContentMonitor, 'updateOne').mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    });
    await expect(monitoringProcessorTestables.commitProcessingPlanBaseline(behindReceipt, at))
      .resolves.toBe('committed');
    updateSpy.mockRestore();
  });

  it('repairs legacy cursors, helps expired planners, and reports a busy live planner', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor();
    const noPlan = await seedReceipt(String(monitor._id), [changeEvent()]);
    await expect(monitoringProcessorTestables.repairLegacyProcessingPlan(noPlan))
      .resolves.toBe(noPlan);
    const alreadyCurrent = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processing',
      processingPlan: processingPlan(),
    });
    await expect(monitoringProcessorTestables.repairLegacyProcessingPlan(alreadyCurrent))
      .resolves.toBe(alreadyCurrent);
    const emptyLegacy = await seedReceipt(String(monitor._id), [], {
      status: 'processing',
      processingPlan: processingPlan({ nextCursorOccurredAt: null }),
    });
    await expect(monitoringProcessorTestables.repairLegacyProcessingPlan(emptyLegacy))
      .resolves.toBe(emptyLegacy);

    const legacy = await seedReceipt(String(monitor._id), [
      changeEvent({ eventKey: 'error', status: 'error', occurredAt: new Date(at.getTime() - 1) }),
      changeEvent({ eventKey: 'latest', status: 'changed', occurredAt: at }),
    ], {
      status: 'processing',
      processingPlan: processingPlan({
        nextCursorOccurredAt: null,
        nextCursorEventKey: null,
        acceptedEventKeys: [],
      }),
    });
    const repaired = await monitoringProcessorTestables.repairLegacyProcessingPlan(legacy);
    expect(repaired.processingPlan).toMatchObject({
      acceptedEventKeys: ['error', 'latest'],
      nextCursorEventKey: 'latest',
      nextBaselineStatus: 'changed',
    });
    await MonitorWebhookReceipt.deleteOne({ _id: legacy._id });
    await expect(monitoringProcessorTestables.repairLegacyProcessingPlan(legacy))
      .resolves.toBe(legacy);

    await expect(monitoringProcessorTestables.helpExpiredPlanningOwner(monitor, at))
      .resolves.toBeUndefined();
    monitor.planningReceiptId = alreadyCurrent._id;
    monitor.planningLeaseUntil = new Date(at.getTime() + 1);
    await expect(monitoringProcessorTestables.helpExpiredPlanningOwner(monitor, at))
      .resolves.toBeUndefined();
    monitor.planningLeaseUntil = new Date(at.getTime() - 1);
    await monitor.save();
    await expect(monitoringProcessorTestables.helpExpiredPlanningOwner(monitor, at))
      .resolves.toBeUndefined();

    const busyReceipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    monitor.planningReceiptId = alreadyCurrent._id;
    monitor.planningLeaseUntil = new Date(at.getTime() + MONITOR_PLANNING_LEASE_MS);
    await monitor.save();
    await expect(monitoringProcessorTestables.acquirePlanningMonitor(busyReceipt, at))
      .rejects.toThrow(/planner is busy/u);
  });

  it('observes concurrent plan persistence and a disappeared concurrent receipt', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const prepare = vi.fn().mockResolvedValue({
      locale: 'en',
      recipientEmail: 'owner@example.com',
      senderIdentity: 'no-reply@example.com',
      suppressionReason: null,
      subject: 'Page changed',
      text: 'Safe body',
      html: '<html lang="en" dir="ltr"><body>Safe body</body></html>',
    });
    const concurrent = await seedReceipt(String(monitor._id), [
      changeEvent({ eventKey: 'b', occurredAt: new Date(at.getTime() + 1) }),
      changeEvent({ eventKey: 'a', occurredAt: at }),
    ]);
    await MonitorWebhookReceipt.updateOne(
      { _id: concurrent._id },
      { $set: { status: 'processing', processingPlan: processingPlan() } },
      { runValidators: true },
    );
    await expect(monitoringProcessorTestables.persistProcessingPlan(
      concurrent,
      monitor,
      at,
      prepare,
    )).resolves.toMatchObject({ claimed: false });

    const disappeared = await seedReceipt(String(monitor._id), [changeEvent()]);
    await MonitorWebhookReceipt.deleteOne({ _id: disappeared._id });
    await expect(monitoringProcessorTestables.persistProcessingPlan(
      disappeared,
      monitor,
      at,
      prepare,
    )).rejects.toThrow(/receipt disappeared/u);
  });

  it('covers null baseline fields, all-error legacy plans, and expired missing owners', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const nullPlan = await seedReceipt(String(monitor._id), [], {
      status: 'processing',
      processingPlan: processingPlan({
        nextNormalizedHash: null,
        nextBaselineStatus: null,
        nextCursorOccurredAt: null,
        nextCursorEventKey: null,
        materialEvents: [],
      }),
    });
    monitor.planningReceiptId = nullPlan._id;
    await monitor.save();
    await expect(monitoringProcessorTestables.commitProcessingPlanBaseline(nullPlan, at))
      .resolves.toBe('committed');

    const allError = await seedReceipt(String(monitor._id), [
      changeEvent({ status: 'error', eventKey: 'error-a', occurredAt: at }),
      changeEvent({ status: 'error', eventKey: 'error-b', occurredAt: new Date(at.getTime() + 1) }),
    ], {
      status: 'processing',
      processingPlan: processingPlan({ nextCursorOccurredAt: null }),
    });
    const repaired = await monitoringProcessorTestables.repairLegacyProcessingPlan(allError);
    expect(repaired.processingPlan?.nextBaselineStatus).toBeNull();

    const ownerless = await seedMonitor({ targetUrl: 'https://example.com/ownerless' });
    ownerless.planningReceiptId = allError._id;
    ownerless.planningLeaseUntil = null;
    await ownerless.save();
    await MonitorWebhookReceipt.deleteOne({ _id: allError._id });
    await monitoringProcessorTestables.helpExpiredPlanningOwner(ownerless, at);
    expect((await ContentMonitor.findById(ownerless._id))!.planningReceiptId).toBeNull();
  });

  it('persists an empty cursor plan and applies missing, deleted, and disappearing records safely', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const logger = pino({ level: 'silent' });
    const deps = { db: db(), logger, notify: vi.fn() };
    const monitor = await seedMonitor();
    const empty = await seedReceipt(String(monitor._id), []);
    const emptyPlan = await monitoringProcessorTestables.persistProcessingPlan(
      empty,
      monitor,
      at,
      vi.fn(),
    );
    expect(emptyPlan.receipt.processingPlan).toMatchObject({
      nextCursorOccurredAt: null,
      nextCursorEventKey: null,
    });

    const missingPlan = await seedReceipt(String(monitor._id), [], {
      status: 'processing',
      processingPlan: null,
    });
    await expect(monitoringProcessorTestables.applyProcessingPlan(deps, missingPlan, 7, at))
      .rejects.toThrow(/plan is missing/u);

    const deletedMonitorReceipt = await seedReceipt('000000000000000000000996', [], {
      status: 'processing',
      processingPlan: processingPlan({ baselineCommittedAt: at, materialEvents: [] }),
    });
    await expect(monitoringProcessorTestables.applyProcessingPlan(
      deps,
      deletedMonitorReceipt,
      7,
      at,
    )).resolves.toBeNull();

    const commitRaceMonitor = await seedMonitor({ targetUrl: 'https://example.com/commit-race' });
    const commitRace = await seedReceipt(String(commitRaceMonitor._id), [], {
      status: 'processing',
      processingPlan: processingPlan({ materialEvents: [] }),
    });
    commitRaceMonitor.planningReceiptId = commitRace._id;
    await commitRaceMonitor.save();
    await expect(monitoringProcessorTestables.applyProcessingPlan(
      {
        ...deps,
        beforeBaselineCommit: async () => {
          await ContentMonitor.deleteOne({ _id: commitRaceMonitor._id });
        },
      },
      commitRace,
      7,
      at,
    )).resolves.toBeNull();

    const receiptRaceMonitor = await seedMonitor({ targetUrl: 'https://example.com/receipt-race' });
    const receiptRace = await seedReceipt(String(receiptRaceMonitor._id), [], {
      status: 'processing',
      processingPlan: processingPlan({ materialEvents: [] }),
    });
    receiptRaceMonitor.planningReceiptId = receiptRace._id;
    await receiptRaceMonitor.save();
    await expect(monitoringProcessorTestables.applyProcessingPlan(
      {
        ...deps,
        beforeBaselineCommit: async () => {
          await MonitorWebhookReceipt.deleteOne({ _id: receiptRace._id });
        },
      },
      receiptRace,
      7,
      at,
    )).resolves.toBeNull();
  });
});

describe('notification deletion and settlement races', () => {
  it('terminalizes a legacy notification-pending receipt whose outbox is absent', async () => {
    const monitor = await seedMonitor();
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'processed',
      processedAt: new Date(),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: receipt._id },
      { $set: { status: 'notification_pending' }, $unset: { notification: '' } },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });
    await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.failureReason)
      .toBe('notification-payload-invalid');
  });

  it('scrubs pending delivery when its monitor is absent before or immediately after claim', async () => {
    const missingMonitor = await seedMonitor();
    const beforeClaim = await seedReceipt(String(missingMonitor._id), [changeEvent()], {
      status: 'notification_pending',
      notification: pendingNotification({ idempotencyKey: 'content-monitor/before-claim' }),
    });
    await ContentMonitor.deleteOne({ _id: missingMonitor._id });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });
    await expect(processor(jobFor(String(missingMonitor._id), String(beforeClaim._id))))
      .resolves.toBeUndefined();

    const claimedMonitor = await seedMonitor();
    const afterClaim = await seedReceipt(String(claimedMonitor._id), [changeEvent()], {
      status: 'notification_pending',
      notification: pendingNotification({ idempotencyKey: 'content-monitor/after-claim' }),
    });
    const notify = vi.fn();
    const deleteAfterClaim = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify,
      beforeNotificationActivityRecheck: async () => {
        await ContentMonitor.deleteOne({ _id: claimedMonitor._id });
      },
    });
    await expect(deleteAfterClaim(jobFor(String(claimedMonitor._id), String(afterClaim._id))))
      .resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('terminalizes a malformed frozen payload after obtaining the durable claim', async () => {
    const monitor = await seedMonitor();
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'notification_pending',
      notification: pendingNotification({ idempotencyKey: 'content-monitor/malformed-claim' }),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: receipt._id },
      { $set: { 'notification.subject': null } },
    );
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      notify: vi.fn(),
    });
    await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.failureReason)
      .toBe('notification-payload-invalid');
  });

  it('closes an exhausted thrown transport as an unknown provider outcome', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor();
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
      status: 'notification_pending',
      notification: pendingNotification({
        idempotencyKey: 'content-monitor/thrown-boundary',
        attemptCount: MONITOR_NOTIFICATION_MAX_ATTEMPTS - 1,
        firstAttemptAt: at,
        retryUntil: new Date(at.getTime() + MONITOR_NOTIFICATION_RETRY_WINDOW_MS),
      }),
    });
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => at,
      notify: vi.fn().mockRejectedValue(new Error('transport threw')),
    });
    await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.notification?.outcome)
      .toBe('provider-outcome-unknown');
  });

  it('treats a concurrent terminal outcome as authoritative for delivered and suppressed sends', async () => {
    for (const [index, outcome] of [
      { delivered: true, providerMessageId: null },
      { delivered: false, reason: 'no-recipient' as const },
    ].entries()) {
      const monitor = await seedMonitor();
      const receipt = await seedReceipt(String(monitor._id), [changeEvent()], {
        status: 'notification_pending',
        notification: pendingNotification({
          idempotencyKey: `content-monitor/settlement-${index}`,
        }),
      });
      const processor = createContentMonitorProcessor({
        db: db(),
        logger: pino({ level: 'silent' }),
        notify: vi.fn().mockResolvedValue(outcome),
        afterNotificationAttempted: async () => {
          await MonitorWebhookReceipt.collection.updateOne(
            { _id: receipt._id },
            { $set: { status: 'processed', processedAt: new Date() } },
          );
        },
      });
      await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
        .resolves.toBeUndefined();
      await ContentMonitor.deleteOne({ _id: monitor._id });
    }
  });
});

describe('processor orchestration races', () => {
  it('consumes a concurrent committed plan without claiming it a second time', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor({ normalizedHash: 'old' });
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    monitor.planningReceiptId = receipt._id;
    await monitor.save();
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => at,
      notify: vi.fn().mockResolvedValue({ delivered: true }),
      beforeProcessingPlanPersist: async () => {
        await MonitorWebhookReceipt.updateOne(
          { _id: receipt._id },
          {
            $set: {
              status: 'processing',
              processingPlan: processingPlan({ baselineCommittedAt: at }),
              notification: pendingNotification({ state: 'waiting' }),
            },
          },
          { runValidators: true },
        );
      },
    });
    await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
      .resolves.toBeUndefined();
  });

  it('honors a concurrent terminal receipt and a planned receipt whose monitor vanished', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const terminalMonitor = await seedMonitor();
    const terminalReceipt = await seedReceipt(String(terminalMonitor._id), []);
    const terminal = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => at,
      beforeProcessingPlanPersist: async () => {
        await MonitorWebhookReceipt.updateOne(
          { _id: terminalReceipt._id },
          { $set: { status: 'processed', processedAt: at } },
          { runValidators: true },
        );
      },
    });
    await expect(terminal(jobFor(String(terminalMonitor._id), String(terminalReceipt._id))))
      .resolves.toBeUndefined();

    await ContentMonitor.deleteOne({ _id: terminalMonitor._id });
    const missingMonitor = await seedMonitor({ targetUrl: 'https://example.com/planned-missing' });
    const planned = await seedReceipt(String(missingMonitor._id), [], {
      status: 'processing',
      processingPlan: processingPlan({ baselineCommittedAt: at, materialEvents: [] }),
    });
    await ContentMonitor.deleteOne({ _id: missingMonitor._id });
    const replay = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => at,
    });
    await expect(replay(jobFor(String(missingMonitor._id), String(planned._id))))
      .resolves.toBeUndefined();
  });

  it('classifies a retry record with a missing deadline as window-expired', async () => {
    const at = new Date('2026-07-20T00:00:00.000Z');
    const monitor = await seedMonitor();
    const receipt = await seedReceipt(String(monitor._id), [changeEvent()]);
    const processor = createContentMonitorProcessor({
      db: db(),
      logger: pino({ level: 'silent' }),
      now: () => at,
      beforeProcessingPlanPersist: async () => {
        await MonitorWebhookReceipt.collection.updateOne(
          { _id: receipt._id },
          { $set: { processingRetryUntil: null } },
        );
        throw new Error('planning dependency failed');
      },
    });
    await expect(processor(jobFor(String(monitor._id), String(receipt._id))))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect((await MonitorWebhookReceipt.findById(receipt._id))!.failureReason)
      .toBe('processing-window-expired');
  });
});
