/**
 * Content-monitoring Mongo model unit tests. Proves the pre-validate
 * hooks reject raw-HTML markers (SEC-OUT / no-raw-HTML) on the target URL, on a
 * receipt event URL, and on evidence fields, and that a valid document persists.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  ContentMonitor,
  MonitorEvidence,
  MonitorWebhookReceipt,
} from './monitor.model.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';

const ENC = {
  ciphertext: 'ct',
  iv: 'iv',
  authTag: 'tag',
  keyVersion: 1,
};

function monitorDoc(over: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId: SITE,
    targetUrl: 'https://example.com/page',
    targetKind: 'owned',
    locale: 'en',
    providerMonitorIdEncrypted: ENC,
    providerMonitorRef: 'ref-hash',
    createdBy: ACCOUNT,
    ...over,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
afterEach(async () => {
  await clearCollections();
});

describe('ContentMonitor', () => {
  it('persists a valid monitor with defaults', async () => {
    const doc = await ContentMonitor.create(monitorDoc());
    expect(doc.status).toBe('active');
    expect(doc.cadence).toBe('weekly');
    expect(doc.normalizedHash).toBeNull();
    expect(doc.providerCredentialRef).toBeNull();
    expect(doc.providerMonitorIdEncrypted.ciphertext).toBe('ct');
  });

  it('rejects a raw-HTML marker in targetUrl', async () => {
    await expect(
      ContentMonitor.create(monitorDoc({ targetUrl: 'https://x.com/<script>' })),
    ).rejects.toThrow(/raw HTML/);
  });

  it.each(['https://x.com/<img src=x>', 'https://x.com/<svg/onload=alert(1)>', 'https://x.com/\tpath'])
  ('rejects broader markup and single-line whitespace in targetUrl', async (targetUrl) => {
    await expect(ContentMonitor.create(monitorDoc({ targetUrl }))).rejects.toThrow();
  });

  it('enforces the unique (accountId, targetUrl) index', async () => {
    await ContentMonitor.create(monitorDoc());
    await ContentMonitor.syncIndexes();
    await expect(ContentMonitor.create(monitorDoc())).rejects.toThrow();
  });

  it('scopes vendor monitor-id uniqueness by credential while preserving legacy rows', async () => {
    await ContentMonitor.syncIndexes();
    await ContentMonitor.create(
      monitorDoc({
        targetUrl: 'https://example.com/a',
        providerMonitorRef: 'shared-monitor-ref',
        providerCredentialRef: 'credential-a',
      }),
    );
    await ContentMonitor.create(
      monitorDoc({
        targetUrl: 'https://example.com/b',
        providerMonitorRef: 'shared-monitor-ref',
        providerCredentialRef: 'credential-b',
      }),
    );
    await expect(
      ContentMonitor.create(
        monitorDoc({
          targetUrl: 'https://example.com/c',
          providerMonitorRef: 'shared-monitor-ref',
          providerCredentialRef: 'credential-a',
        }),
      ),
    ).rejects.toThrow();

    // The partial compound index intentionally excludes legacy null/absent rows.
    await ContentMonitor.create(
      monitorDoc({
        targetUrl: 'https://example.com/legacy-a',
        providerMonitorRef: 'legacy-shared-ref',
      }),
    );
    await expect(
      ContentMonitor.create(
        monitorDoc({
          targetUrl: 'https://example.com/legacy-b',
          providerMonitorRef: 'legacy-shared-ref',
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('MonitorWebhookReceipt', () => {
  const base = {
    provider: 'firecrawl',
    eventId: 'evt-1',
    monitorId: SITE,
    accountId: ACCOUNT,
    siteId: SITE,
    providerMonitorRef: 'ref',
    checkId: 'chk-1',
    eventType: 'monitor.check.completed',
    payloadHash: 'ph',
    receivedAt: new Date(),
    expiryAt: new Date(Date.now() + 1000),
  };

  it('persists a valid receipt', async () => {
    const doc = await MonitorWebhookReceipt.create({
      ...base,
      events: [
        {
          eventKey: 'k1',
          checkId: 'chk-1',
          targetUrl: 'https://example.com/page',
          status: 'changed',
          changed: true,
          contentHash: 'h',
          diffText: null,
          occurredAt: new Date(),
        },
      ],
    });
    expect(doc.status).toBe('received');
    expect(doc.events).toHaveLength(1);
    expect(doc.processingPlan).toBeNull();
    expect(doc.notification).toBeNull();
  });

  it('persists a planned receipt with an embedded pending notification outbox', async () => {
    const doc = await MonitorWebhookReceipt.create({
      ...base,
      eventId: 'evt-outbox',
      status: 'notification_pending',
      events: [],
      processingPlan: {
        plannedAt: new Date(),
        isoWeek: '2026-W30',
        nextNormalizedHash: 'next-hash',
        materialEvents: [{ eventKey: 'k1', reason: 'hash_changed' }],
      },
      notification: {
        state: 'pending',
        ownerUserId: ACCOUNT,
        targetUrl: 'https://example.com/page',
        locale: 'en',
        subject: 'Page changed',
        text: 'Review the monitored page in RankMeFast.',
        idempotencyKey: 'content-monitor/receipt-1',
      },
    });
    expect(doc.processingPlan?.materialEvents[0]?.reason).toBe('hash_changed');
    expect(doc.notification?.state).toBe('pending');
    expect(doc.notification?.attemptCount).toBe(0);
  });

  it('rejects a raw-HTML marker in an event targetUrl', async () => {
    await expect(
      MonitorWebhookReceipt.create({
        ...base,
        events: [
          {
            eventKey: 'k1',
            checkId: 'chk-1',
            targetUrl: 'https://x.com/<iframe>',
            status: 'changed',
            changed: true,
            occurredAt: new Date(),
          },
        ],
      }),
    ).rejects.toThrow(/raw HTML/);
  });

  it('rejects an event whose check id does not match its receipt', async () => {
    await expect(
      MonitorWebhookReceipt.create({
        ...base,
        eventId: 'evt-mismatched-check',
        events: [
          {
            eventKey: 'k-mismatch',
            checkId: 'chk-other',
            targetUrl: 'https://example.com/page',
            status: 'changed',
            changed: true,
            occurredAt: new Date(),
          },
        ],
      }),
    ).rejects.toThrow(/checkId must match receipt/);
  });

  it('rejects a raw-HTML marker in the durable notification target', async () => {
    await expect(
      MonitorWebhookReceipt.create({
        ...base,
        eventId: 'evt-bad-outbox',
        status: 'notification_pending',
        events: [],
        processingPlan: {
          plannedAt: new Date(),
          isoWeek: '2026-W30',
          materialEvents: [{ eventKey: 'k1', reason: 'hash_changed' }],
        },
        notification: {
          state: 'pending',
          ownerUserId: ACCOUNT,
          targetUrl: 'https://x.com/<script>',
          locale: 'en',
          subject: 'Page changed',
          text: 'Review the monitored page in RankMeFast.',
          idempotencyKey: 'content-monitor/receipt-bad',
        },
      }),
    ).rejects.toThrow(/raw HTML/);
  });

  it('rejects an active notification whose frozen payload is incomplete', async () => {
    await expect(
      MonitorWebhookReceipt.create({
        ...base,
        eventId: 'evt-incomplete-outbox',
        status: 'notification_pending',
        events: [],
        notification: {
          state: 'pending',
          ownerUserId: ACCOUNT,
          targetUrl: 'https://example.com/page',
          locale: 'en',
          subject: null,
          text: 'Review the monitored page in RankMeFast.',
          idempotencyKey: 'content-monitor/incomplete',
        },
      }),
    ).rejects.toThrow(/payload must be complete/);
  });

  it('enforces anti-markup/control validation on query-update paths', async () => {
    const doc = await MonitorWebhookReceipt.create({
      ...base,
      eventId: 'evt-query-validator',
      status: 'notification_pending',
      events: [],
      processingPlan: {
        plannedAt: new Date(),
        isoWeek: '2026-W30',
        materialEvents: [{ eventKey: 'k1', reason: 'hash_changed' }],
      },
      notification: {
        state: 'pending',
        ownerUserId: ACCOUNT,
        targetUrl: 'https://example.com/page',
        locale: 'en',
        subject: 'Page changed',
        text: 'Review the monitored page in RankMeFast.',
        idempotencyKey: 'content-monitor/query-validator',
      },
    });
    await expect(
      MonitorWebhookReceipt.updateOne(
        { _id: doc._id },
        { $set: { 'notification.subject': '<img onerror=alert(1)>' } },
        { runValidators: true },
      ),
    ).rejects.toThrow(/raw HTML/);
    await expect(
      MonitorWebhookReceipt.updateOne(
        { _id: doc._id },
        { $set: { 'notification.subject': 'header\ninjection' } },
        { runValidators: true },
      ),
    ).rejects.toThrow();
  });

  it('enforces the unique (provider, eventId) index', async () => {
    await MonitorWebhookReceipt.create({ ...base, events: [] });
    await MonitorWebhookReceipt.syncIndexes();
    await expect(
      MonitorWebhookReceipt.create({ ...base, events: [] }),
    ).rejects.toThrow();
  });
});

describe('MonitorEvidence', () => {
  const base = {
    monitorId: SITE,
    accountId: ACCOUNT,
    checkId: 'chk-1',
    eventKey: 'k1',
    sourceUrl: 'https://example.com/page',
    reason: 'hash_changed',
    diffText: 'a short sanitized diff',
    observedAt: new Date(),
    expiryAt: new Date(Date.now() + 1000),
  };

  it('persists valid evidence', async () => {
    const doc = await MonitorEvidence.create(base);
    expect(doc.reason).toBe('hash_changed');
  });

  it('rejects a raw-HTML marker in sourceUrl', async () => {
    await expect(
      MonitorEvidence.create({ ...base, sourceUrl: 'https://x.com/<script>' }),
    ).rejects.toThrow(/raw HTML/);
  });

  it('rejects a raw-HTML marker in diffText', async () => {
    await expect(
      MonitorEvidence.create({ ...base, diffText: 'before <!doctype html> after' }),
    ).rejects.toThrow(/raw HTML/);
  });

  it.each(['before <img src=x> after', '<svg><path /></svg>', 'before\u0001after'])
  ('rejects markup and control characters in diffText', async (diffText) => {
    await expect(MonitorEvidence.create({ ...base, diffText })).rejects.toThrow();
  });
});
