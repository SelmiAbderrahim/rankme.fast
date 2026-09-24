/**
 * Content-monitor reconciliation tests (spec 10) against real PGlite + memory
 * Mongo. Proves: producer gating (feature flag, operator kill switch, deleting
 * sites), provider drift folded into local state (error / paused /
 * read-failure tolerated), and stuck-receipt re-enqueue.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Queue } from 'bullmq';
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
import { encryptSecret } from '../../shared/crypto/index.js';
import { contentMonitorEvents } from '../../db/schema/content-monitor-events.js';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
import { Site } from '../sites/sites.model.js';
import { ContentMonitor, MonitorWebhookReceipt } from './monitor.model.js';
import {
  createContentMonitorReconciliationProcessor,
  runContentMonitorReconciliationSweep,
} from './monitoring.reconciliation.js';
import { MONITOR_NOTIFICATION_MAX_ATTEMPTS } from './monitoring.processor.js';
import { featureFlags } from '../../db/schema/index.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;
const NOW = new Date('2026-07-20T00:00:00.000Z');
const originalMonitoringEnabled = env.CONTENT_MONITORING_ENABLED;
/**
 * Mongo's TTL monitor reaps on the REAL clock, not the injected `NOW`, so a
 * receipt's `expiryAt` must stay in the real future for the whole test.
 */
const ttlExpiry = () => new Date(Date.now() + 86_400_000);

function fakeQueue(existingState?: string) {
  const jobs: Array<{ name: string; data: unknown }> = [];
  const retry = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const existingJob = existingState
    ? {
        getState: vi.fn(async () => existingState),
        retry,
        remove,
      }
    : undefined;
  const queue = {
    async add(name: string, data: unknown) {
      jobs.push({ name, data });
      return { id: 'x' };
    },
    async getJob() {
      return existingJob;
    },
  } as unknown as Queue;
  return { queue, jobs, retry, remove };
}

function fakeProvider(over: Partial<ContentMonitorProvider> = {}): ContentMonitorProvider {
  return {
    createMonitor: vi.fn(),
    pauseMonitor: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'paused' }),
    resumeMonitor: vi.fn(),
    deleteMonitor: vi.fn(),
    getMonitorStatus: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'active' }),
    normalizeWebhookDelivery: vi.fn(),
    ...over,
  } as ContentMonitorProvider;
}

async function seedMonitor(over: Record<string, unknown> = {}) {
  const siteId = String(over.siteId ?? SITE);
  await Site.updateOne(
    { _id: siteId },
    {
      $setOnInsert: {
        accountId: ACCOUNT,
        url: `https://site-${siteId}.example.com`,
        domain: `site-${siteId}.example.com`,
      },
    },
    { upsert: true },
  );
  return ContentMonitor.create({
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId: SITE,
    targetUrl: `https://example.com/${Math.random()}`,
    targetKind: 'owned',
    locale: 'en',
    providerMonitorIdEncrypted: encryptSecret('vendor-monitor-1'),
    providerMonitorRef: 'ref',
    createdBy: ACCOUNT,
    status: 'active',
    ...over,
  });
}

/** A real paused Site doc whose _id the monitor's siteId points at. */
async function seedPausedSite(domain: string) {
  return Site.create({
    accountId: ACCOUNT,
    url: `https://${domain}`,
    domain,
    paused: true,
    pausedAt: NOW,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  env.CONTENT_MONITORING_ENABLED = originalMonitoringEnabled;
  await stopMemoryMongo();
  await stopTestPostgres();
});
beforeEach(() => {
  env.CONTENT_MONITORING_ENABLED = true;
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

const deps = (over: Record<string, unknown> = {}) => ({
  db: db(),
  logger: pino({ level: 'silent' }),
  queue: fakeQueue().queue,
  provider: fakeProvider(),
  now: () => NOW,
  ...over,
});

const EMPTY_OUTCOME = {
  driftReconciled: 0,
  receiptsRequeued: 0,
  skippedPaused: 0,
};

describe('runContentMonitorReconciliationSweep — producer gating', () => {
  it('does not call the provider, write Mongo, or enqueue for a deleting site', async () => {
    const monitor = await seedMonitor();
    await Site.updateOne(
      { _id: monitor.siteId },
      { $set: { deletionStartedAt: NOW, paused: true, pausedAt: NOW } },
    );
    const provider = fakeProvider();
    const queueHarness = fakeQueue();

    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider, queue: queueHarness.queue }),
    );

    expect(outcome.driftReconciled).toBe(0);
    expect(outcome.skippedPaused).toBe(1);
    expect(await db().select().from(contentMonitorEvents)).toEqual([]);
    expect(provider.getMonitorStatus).not.toHaveBeenCalled();
    expect(provider.pauseMonitor).not.toHaveBeenCalled();
    expect(queueHarness.jobs).toEqual([]);
    const unchanged = await ContentMonitor.findById(monitor._id);
    expect(unchanged?.status).toBe('active');
    expect(unchanged?.lastReconcileAt).toBeNull();
  });

  it('makes no provider call or enqueue while the feature flag is off', async () => {
    await seedMonitor();
    const provider = fakeProvider();
    const queueHarness = fakeQueue();
    const previous = env.CONTENT_MONITORING_ENABLED;
    try {
      env.CONTENT_MONITORING_ENABLED = false;
      const outcome = await runContentMonitorReconciliationSweep(
        deps({ provider, queue: queueHarness.queue }),
      );
      expect(outcome).toEqual(EMPTY_OUTCOME);
      expect(await db().select().from(contentMonitorEvents)).toEqual([]);
      expect(provider.pauseMonitor).not.toHaveBeenCalled();
      expect(provider.getMonitorStatus).not.toHaveBeenCalled();
      expect(queueHarness.jobs).toEqual([]);
    } finally {
      env.CONTENT_MONITORING_ENABLED = previous;
    }
  });

  it('makes no provider call or enqueue while the operator kill switch is off', async () => {
    await seedMonitor();
    await db().insert(featureFlags).values({ key: 'firecrawl_change_monitoring', enabled: false });
    const provider = fakeProvider();
    const queueHarness = fakeQueue();
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider, queue: queueHarness.queue }),
    );
    expect(outcome).toEqual(EMPTY_OUTCOME);
    expect(await db().select().from(contentMonitorEvents)).toEqual([]);
    expect(provider.pauseMonitor).not.toHaveBeenCalled();
    expect(provider.getMonitorStatus).not.toHaveBeenCalled();
    expect(queueHarness.jobs).toEqual([]);
  });

  it('exposes a BullMQ processor factory that runs a sweep', async () => {
    const monitor = await seedMonitor();
    const getMonitorStatus = vi
      .fn()
      .mockResolvedValue({ providerMonitorId: 'v', status: 'paused' });
    const processor = createContentMonitorReconciliationProcessor(
      deps({ provider: fakeProvider({ getMonitorStatus }) }),
    );
    const outcome = await processor();
    expect(outcome.driftReconciled).toBe(1);
    expect((await ContentMonitor.findById(monitor._id))?.status).toBe('paused');
  });

  it('defaults to a real clock when no `now` is injected', async () => {
    // Empty DB — the sweep does nothing but exercises the default clock.
    const outcome = await runContentMonitorReconciliationSweep({
      db: db(),
      logger: pino({ level: 'silent' }),
      queue: fakeQueue().queue,
      provider: fakeProvider(),
    });
    expect(outcome).toEqual(EMPTY_OUTCOME);
  });
});

describe('runContentMonitorReconciliationSweep — paused sites', () => {
  it('drift sweep skips an active paused-site monitor BEFORE any event or provider call', async () => {
    const pausedSite = await seedPausedSite('paused-active.example.com');
    const monitor = await seedMonitor({ siteId: pausedSite._id });
    const getMonitorStatus = vi.fn();
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider: fakeProvider({ getMonitorStatus }) }),
    );
    expect(outcome.skippedPaused).toBe(1);
    expect(outcome.driftReconciled).toBe(0);
    const events = await db()
      .select()
      .from(contentMonitorEvents)
      .where(eq(contentMonitorEvents.monitorId, String(monitor._id)));
    expect(events).toHaveLength(0);
    expect(getMonitorStatus).not.toHaveBeenCalled();
  });

  it('drift sweep skips a paused-site monitor without a provider status call', async () => {
    const pausedSite = await seedPausedSite('paused-drift.example.com');
    // A `paused` monitor is still in the drift sweep's scope.
    const monitor = await seedMonitor({ siteId: pausedSite._id, status: 'paused' });
    const getMonitorStatus = vi.fn();
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider: fakeProvider({ getMonitorStatus }) }),
    );
    expect(outcome.skippedPaused).toBe(1);
    expect(outcome.driftReconciled).toBe(0);
    expect(getMonitorStatus).not.toHaveBeenCalled();
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.status).toBe('paused');
    expect(updated!.lastReconcileAt).toBeNull();
  });
});

describe('runContentMonitorReconciliationSweep — drift', () => {
  it('folds a provider "error" status into local error state', async () => {
    // A paused monitor still gets a drift read.
    const monitor = await seedMonitor({
      status: 'paused',
      providerCredentialRef: 'credential-b',
    });
    const getMonitorStatus = vi
      .fn()
      .mockResolvedValue({ providerMonitorId: 'v', status: 'error' });
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider: fakeProvider({ getMonitorStatus }) }),
    );
    expect(outcome.driftReconciled).toBe(1);
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.status).toBe('error');
    expect(updated!.error?.category).toBe('reconcile_failed');
    expect(updated!.lastReconcileAt).not.toBeNull();
    expect(getMonitorStatus).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'credential-b' }),
    );
  });

  it('folds a provider "paused" status into a local active monitor', async () => {
    const monitor = await seedMonitor();
    const getMonitorStatus = vi
      .fn()
      .mockResolvedValue({ providerMonitorId: 'v', status: 'paused' });
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider: fakeProvider({ getMonitorStatus }) }),
    );
    expect(outcome.driftReconciled).toBe(1);
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.status).toBe('paused');
  });

  it('tolerates a provider status read failure (no crash, no state change)', async () => {
    const monitor = await seedMonitor({ status: 'paused' });
    const getMonitorStatus = vi.fn().mockRejectedValue(new Error('timeout'));
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ provider: fakeProvider({ getMonitorStatus }) }),
    );
    expect(outcome.driftReconciled).toBe(0);
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.status).toBe('paused');
  });

  it('leaves a healthy active monitor untouched (provider agrees)', async () => {
    const monitor = await seedMonitor();
    const outcome = await runContentMonitorReconciliationSweep(deps());
    expect(outcome.driftReconciled).toBe(0);
    const updated = await ContentMonitor.findById(monitor._id);
    expect(updated!.status).toBe('active');
    expect(updated!.lastReconcileAt).not.toBeNull();
  });
});

describe('runContentMonitorReconciliationSweep — stuck receipts', () => {
  it('terminalizes a stale notification whose retry-attempt boundary is closed', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-closed-notification',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-closed-notification',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph-closed-notification',
      events: [],
      status: 'notification_pending',
      processingPlan: {
        plannedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        isoWeek: '2026-W30',
        nextNormalizedHash: 'next',
        materialEvents: [{ eventKey: 'event-1', reason: 'hash_changed' }],
      },
      notification: {
        state: 'pending',
        ownerUserId: ACCOUNT,
        recipientEmail: 'owner@example.com',
        senderIdentity: 'RankMeFast <no-reply@rankme.test>',
        targetUrl: 'https://example.com/page',
        locale: 'en',
        subject: 'Page changed',
        text: 'Review the monitored page in RankMeFast.',
        idempotencyKey: 'content-monitor/closed-notification',
        attemptCount: MONITOR_NOTIFICATION_MAX_ATTEMPTS,
        firstAttemptAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        retryUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
        lastAttemptAt: new Date(NOW.getTime() - 1_000),
      },
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: stale._id },
      { $set: { updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000) } },
    );
    const queueHarness = fakeQueue();

    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: queueHarness.queue }),
    );

    expect(outcome.receiptsRequeued).toBe(0);
    expect(queueHarness.jobs).toEqual([]);
    await expect(MonitorWebhookReceipt.findById(stale._id).lean()).resolves.toMatchObject({
      status: 'processed',
      notification: {
        state: 'failed',
        outcome: 'retries-exhausted',
      },
    });
  });

  it('counts a stale receipt whose deleting site refuses a work lease', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    await Site.updateOne(
      { _id: monitor.siteId },
      { $set: { deletionStartedAt: NOW, paused: true, pausedAt: NOW } },
    );
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-deleting-site-receipt',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-deleting-site-receipt',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph-deleting-site-receipt',
      events: [],
      status: 'received',
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const queueHarness = fakeQueue();

    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: queueHarness.queue }),
    );

    expect(outcome.skippedPaused).toBe(1);
    expect(outcome.receiptsRequeued).toBe(0);
    expect(queueHarness.jobs).toEqual([]);
    expect((await MonitorWebhookReceipt.findById(stale._id))?.status).toBe('received');
  });

  it('recovers accepted work before waiting on a blocked provider drift call', async () => {
    const monitor = await seedMonitor({ status: 'paused' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-recovery-before-provider',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-recovery-before-provider',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'received',
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const q = fakeQueue();
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const getMonitorStatus = vi.fn(async () => {
      await providerGate;
      return { providerMonitorId: 'v', status: 'paused' as const };
    });

    const sweep = runContentMonitorReconciliationSweep(
      deps({
        queue: q.queue,
        provider: fakeProvider({ getMonitorStatus }),
      }),
    );
    await vi.waitFor(() => {
      expect(q.jobs).toHaveLength(1);
      expect((q.jobs[0]!.data as { receiptId: string }).receiptId).toBe(
        String(stale._id),
      );
    });
    await vi.waitFor(() => expect(getMonitorStatus).toHaveBeenCalledOnce());
    releaseProvider();

    const outcome = await sweep;
    expect(outcome.receiptsRequeued).toBe(1);
  });

  it('round-robins beyond a full 200-row batch without starving row 201', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const receipts = await MonitorWebhookReceipt.insertMany(
      Array.from({ length: 201 }, (_, index) => ({
        provider: 'firecrawl',
        eventId: `evt-fair-${index}`,
        monitorId: monitor._id,
        accountId: ACCOUNT,
        siteId: SITE,
        providerMonitorRef: 'ref',
        checkId: `chk-fair-${index}`,
        eventType: 'monitor.check.completed',
        payloadHash: `ph-${index}`,
        events: [],
        status: 'received',
        receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        expiryAt: ttlExpiry(),
      })),
    );
    const occupied = new Set(receipts.slice(0, 200).map((receipt) => String(receipt._id)));
    const enqueued: Array<{ receiptId: string }> = [];
    const queue = {
      async add(_name: string, data: { receiptId: string }) {
        enqueued.push(data);
        return { id: 'x' };
      },
      async getJob(jobId: string) {
        const receiptId = jobId.replace(/^content-monitor-/, '');
        if (!occupied.has(receiptId)) return undefined;
        return {
          async getState() {
            return 'waiting';
          },
          async retry() {},
          async remove() {},
        };
      },
    } as unknown as Queue;
    const previous = env.CONTENT_MONITORING_ENABLED;
    try {
      env.CONTENT_MONITORING_ENABLED = false;
      const first = await runContentMonitorReconciliationSweep(
        deps({ queue }),
      );
      expect(first.receiptsRequeued).toBe(0);
      expect(enqueued).toEqual([]);

      const second = await runContentMonitorReconciliationSweep(
        deps({ queue }),
      );
      expect(second.receiptsRequeued).toBe(1);
      expect(enqueued.map((payload) => payload.receiptId)).toEqual([
        String(receipts[200]!._id),
      ]);
    } finally {
      env.CONTENT_MONITORING_ENABLED = previous;
    }
  });

  it('never re-enqueues a durably failed receipt', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const failed = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-terminal-failed',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-terminal-failed',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'failed',
      failureReason: 'processing-retries-exhausted',
      processedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      receivedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const q = fakeQueue();
    const previous = env.CONTENT_MONITORING_ENABLED;
    try {
      env.CONTENT_MONITORING_ENABLED = false;
      const outcome = await runContentMonitorReconciliationSweep(
        deps({ queue: q.queue }),
      );
      expect(outcome.receiptsRequeued).toBe(0);
      expect(q.jobs).toEqual([]);
      expect((await MonitorWebhookReceipt.findById(failed._id))?.recoveryCheckedAt).toBeNull();
    } finally {
      env.CONTENT_MONITORING_ENABLED = previous;
    }
  });

  it('drains an accepted receipt while the producer feature flag is off', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-stale-flag-off',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-flag-off',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'received',
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const previous = env.CONTENT_MONITORING_ENABLED;
    const q = fakeQueue();
    try {
      env.CONTENT_MONITORING_ENABLED = false;
      const outcome = await runContentMonitorReconciliationSweep(
        deps({ queue: q.queue }),
      );
      expect(outcome.receiptsRequeued).toBe(1);
      expect(q.jobs).toHaveLength(1);
      expect((q.jobs[0]!.data as { receiptId: string }).receiptId).toBe(
        String(stale._id),
      );
    } finally {
      env.CONTENT_MONITORING_ENABLED = previous;
    }
  });

  it('drains a stale processing plan while the producer feature flag is off', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-processing-flag-off',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-processing',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'processing',
      processingPlan: {
        plannedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        isoWeek: '2026-W30',
        nextNormalizedHash: null,
        materialEvents: [],
      },
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: stale._id },
      { $set: { updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000) } },
    );
    const previous = env.CONTENT_MONITORING_ENABLED;
    const q = fakeQueue();
    try {
      env.CONTENT_MONITORING_ENABLED = false;
      const outcome = await runContentMonitorReconciliationSweep(
        deps({ queue: q.queue }),
      );
      expect(outcome.receiptsRequeued).toBe(1);
      expect(q.jobs).toHaveLength(1);
      expect((q.jobs[0]!.data as { receiptId: string }).receiptId).toBe(
        String(stale._id),
      );
    } finally {
      env.CONTENT_MONITORING_ENABLED = previous;
    }
  });

  it('retries the retained failed job for an expired notification claim', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-notification-failed-job',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-notification',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'notification_pending',
      processingPlan: {
        plannedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        isoWeek: '2026-W30',
        nextNormalizedHash: 'next',
        materialEvents: [{ eventKey: 'event-1', reason: 'hash_changed' }],
      },
      notification: {
        state: 'sending',
        ownerUserId: ACCOUNT,
        targetUrl: 'https://example.com/page',
        locale: 'en',
        subject: 'Page changed',
        text: 'Review the monitored page in RankMeFast.',
        idempotencyKey: 'content-monitor/failed-job',
        leaseId: 'dead-worker',
        leaseUntil: new Date(NOW.getTime() - 1),
        attemptCount: 3,
        firstAttemptAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        retryUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
        lastAttemptAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const q = fakeQueue('failed');
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: q.queue }),
    );
    expect(outcome.receiptsRequeued).toBe(1);
    expect(q.retry).toHaveBeenCalledWith('failed');
    expect(q.jobs).toHaveLength(0);
  });

  it('recreates a completed job when its durable notification is still pending', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-notification-completed-job',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-notification-completed',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'notification_pending',
      processingPlan: {
        plannedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        isoWeek: '2026-W30',
        nextNormalizedHash: 'next',
        materialEvents: [{ eventKey: 'event-1', reason: 'hash_changed' }],
      },
      notification: {
        state: 'pending',
        ownerUserId: ACCOUNT,
        targetUrl: 'https://example.com/page',
        locale: 'en',
        subject: 'Page changed',
        text: 'Review the monitored page in RankMeFast.',
        idempotencyKey: 'content-monitor/completed-job',
        attemptCount: 1,
        firstAttemptAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        retryUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
        lastAttemptAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: stale._id },
      { $set: { updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000) } },
    );
    const q = fakeQueue('completed');
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: q.queue }),
    );
    expect(outcome.receiptsRequeued).toBe(1);
    expect(q.remove).toHaveBeenCalledOnce();
    expect(q.jobs).toHaveLength(1);
  });

  it('does not duplicate a waiting or active recovery job', async () => {
    const monitor = await seedMonitor({ status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-notification-waiting-job',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-notification-waiting',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'processing',
      processingPlan: {
        plannedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        isoWeek: '2026-W30',
        nextNormalizedHash: null,
        materialEvents: [],
      },
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: stale._id },
      { $set: { updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000) } },
    );
    const q = fakeQueue('waiting');
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: q.queue }),
    );
    expect(outcome.receiptsRequeued).toBe(0);
    expect(q.jobs).toHaveLength(0);
    expect(q.retry).not.toHaveBeenCalled();
  });

  it('re-enqueues a stale received receipt whose job never landed', async () => {
    const monitor = await seedMonitor();
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-stale',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-1',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'received',
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const q = fakeQueue();
    const outcome = await runContentMonitorReconciliationSweep(deps({ queue: q.queue }));
    expect(outcome.receiptsRequeued).toBe(1);
    expect(q.jobs).toHaveLength(1);
    expect((q.jobs[0]!.data as { receiptId: string }).receiptId).toBe(String(stale._id));
  });

  it('terminal-skips a stale received receipt whose site is paused (no re-enqueue)', async () => {
    const pausedSite = await seedPausedSite('paused-receipt.example.com');
    // `error` status keeps the drift sweep away from this
    // monitor so the outcome isolates the stuck-receipt arm.
    const monitor = await seedMonitor({ siteId: pausedSite._id, status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-paused-stale',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: pausedSite._id,
      providerMonitorRef: 'ref',
      checkId: 'chk-1',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'received',
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const q = fakeQueue();
    const outcome = await runContentMonitorReconciliationSweep(deps({ queue: q.queue }));
    expect(outcome.receiptsRequeued).toBe(0);
    expect(outcome.skippedPaused).toBe(1);
    expect(q.jobs).toHaveLength(0);
    // Saved TERMINAL — never left `received` to clog every future sweep batch.
    const updated = await MonitorWebhookReceipt.findById(stale._id);
    expect(updated!.status).toBe('skipped');
    expect(updated!.processedAt).toEqual(NOW);
  });

  it('still drains a planned receipt after its site is paused', async () => {
    const pausedSite = await seedPausedSite('paused-planned-receipt.example.com');
    const monitor = await seedMonitor({ siteId: pausedSite._id, status: 'error' });
    const stale = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-paused-planned-stale',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: pausedSite._id,
      providerMonitorRef: 'ref',
      checkId: 'chk-planned',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'processing',
      processingPlan: {
        plannedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        isoWeek: '2026-W30',
        nextNormalizedHash: null,
        materialEvents: [],
      },
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    await MonitorWebhookReceipt.collection.updateOne(
      { _id: stale._id },
      { $set: { updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000) } },
    );
    const q = fakeQueue();
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: q.queue }),
    );
    expect(outcome.receiptsRequeued).toBe(1);
    expect(outcome.skippedPaused).toBe(0);
    expect(q.jobs).toHaveLength(1);
  });

  it('tolerates an enqueue failure during the stuck-receipt sweep', async () => {
    const monitor = await seedMonitor();
    await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'evt-stale2',
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId: SITE,
      providerMonitorRef: 'ref',
      checkId: 'chk-1',
      eventType: 'monitor.check.completed',
      payloadHash: 'ph',
      events: [],
      status: 'received',
      receivedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      expiryAt: ttlExpiry(),
    });
    const failingQueue = {
      async add() {
        throw new Error('redis down');
      },
    } as unknown as Queue;
    const outcome = await runContentMonitorReconciliationSweep(
      deps({ queue: failingQueue }),
    );
    expect(outcome.receiptsRequeued).toBe(0);
  });
});
