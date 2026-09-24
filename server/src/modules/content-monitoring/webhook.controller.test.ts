/**
 * Firecrawl monitor webhook adversarial matrix (spec 10 §4/§Security). Runs
 * through the REAL createApp() middleware order (per-IP bucket → express.raw →
 * handler, BEFORE express.json and OUTSIDE the auth/CSRF chain). Covers:
 * valid delivery, byte cap pre-HMAC (413), bad/missing/malformed/wrong-secret
 * signatures (401), duplicate + concurrent-duplicate dedupe (200, single
 * receipt/enqueue), parse failure after valid signature (400), unconditional
 * replay reject, secret rotation (previous OK / retired fails), bounded batch,
 * enqueue-failure reconciliation, unknown monitor ack, 503 when the runtime is
 * down, 500 when unconfigured, and a logger spy proving no body/signature leak.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Queue } from 'bullmq';
import type { Request, Response } from 'express';
import pino from 'pino';
import { createApp } from '../../app.js';
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
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import { createFakeContentMonitorProvider } from '../../shared/providers/content-monitor-fake.js';
import { firecrawlCredentialRef } from '../../shared/providers/index.js';
import { logger as sharedLogger } from '../../config/logger.js';
import { Site } from '../sites/sites.model.js';
import { ContentMonitor, MonitorWebhookReceipt } from './monitor.model.js';
import {
  setContentMonitorDb,
  setContentMonitorProvider,
  setContentMonitorQueue,
} from './monitoring.holders.js';
import { providerMonitorRef } from './monitoring.service.js';
import { featureFlags } from '../../db/schema/index.js';
import * as featureFlagsModule from '../../shared/safety/feature-flags.js';
import { signMonitorWebhookBody } from './webhook.verify.js';
import * as verifyModule from './webhook.verify.js';
import {
  MONITOR_WEBHOOK_MAX_BODY_BYTES,
  isMonitorWebhookConfigured,
  monitorWebhookHandler,
} from './webhook.controller.js';

const app = createApp();
const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';
const VENDOR_ID = 'vendor-monitor-1';
const SECRET = 'primary-secret-value';
const PREVIOUS_SECRET = 'previous-secret-value';
const FALLBACK_SECRET = 'fallback-secret-value';
const PRIMARY_API_KEY = 'firecrawl-primary-api-key';
const FALLBACK_API_KEY = 'firecrawl-fallback-api-key';
const PRIMARY_CREDENTIAL_REF = firecrawlCredentialRef(PRIMARY_API_KEY);
const FALLBACK_CREDENTIAL_REF = firecrawlCredentialRef(FALLBACK_API_KEY);
const WEBHOOK = '/api/firecrawl/webhook';

function fakeQueue() {
  const jobs: Array<{ name: string; data: unknown }> = [];
  const queue = {
    async add(name: string, data: unknown) {
      jobs.push({ name, data });
      return { id: 'x' };
    },
  } as unknown as Queue;
  return { queue, jobs };
}

let queueHarness = fakeQueue();

function body(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'monitor.check.completed',
    monitorId: VENDOR_ID,
    providerCredentialRef: PRIMARY_CREDENTIAL_REF,
    checkId: 'chk-1',
    pages: [
      { url: 'https://example.com/page', status: 'changed', changed: true, contentHash: 'h1' },
    ],
    ...over,
  });
}

function post(raw: string, secret: string | null) {
  const req = request(app).post(WEBHOOK).set('Content-Type', 'application/json');
  if (secret !== null) {
    req.set('X-Firecrawl-Signature', signMonitorWebhookBody(Buffer.from(raw), secret));
  }
  return req.send(raw);
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
    targetUrl: 'https://example.com/page',
    targetKind: 'owned',
    locale: 'en',
    providerMonitorIdEncrypted: { ciphertext: 'ct', iv: 'iv', authTag: 't', keyVersion: 1 },
    providerMonitorRef: providerMonitorRef(VENDOR_ID),
    providerCredentialRef: PRIMARY_CREDENTIAL_REF,
    createdBy: ACCOUNT,
    ...over,
  });
}

const originalSecret = env.FIRECRAWL_WEBHOOK_SECRET;
const originalSecrets = env.FIRECRAWL_WEBHOOK_SECRETS;
const originalBindings = env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS;
const originalApiKey = env.FIRECRAWL_API_KEY;
const originalFallbackApiKeys = env.FIRECRAWL_FALLBACK_API_KEYS;
const originalMonitoringEnabled = env.CONTENT_MONITORING_ENABLED;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setContentMonitorDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  setContentMonitorProvider(createFakeContentMonitorProvider());
});
afterAll(async () => {
  setContentMonitorProvider(null);
  setContentMonitorQueue(null);
  setContentMonitorDb(null);
  env.FIRECRAWL_WEBHOOK_SECRET = originalSecret;
  env.FIRECRAWL_WEBHOOK_SECRETS = originalSecrets;
  env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = originalBindings;
  env.FIRECRAWL_API_KEY = originalApiKey;
  env.FIRECRAWL_FALLBACK_API_KEYS = originalFallbackApiKeys;
  env.CONTENT_MONITORING_ENABLED = originalMonitoringEnabled;
  await stopMemoryMongo();
  await stopTestPostgres();
});
beforeEach(() => {
  queueHarness = fakeQueue();
  setContentMonitorQueue(queueHarness.queue);
  setContentMonitorProvider(createFakeContentMonitorProvider());
  env.FIRECRAWL_API_KEY = PRIMARY_API_KEY;
  env.FIRECRAWL_FALLBACK_API_KEYS = [];
  env.FIRECRAWL_WEBHOOK_SECRET = undefined;
  env.FIRECRAWL_WEBHOOK_SECRETS = [];
  env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
    { credential: 'primary', secrets: [SECRET] },
  ];
  env.CONTENT_MONITORING_ENABLED = true;
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('valid delivery', () => {
  it('verifies, stores a receipt, and enqueues once → 200', async () => {
    await seedMonitor();
    const raw = body();
    const res = await post(raw, SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const receipts = await MonitorWebhookReceipt.find({});
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.status).toBe('received');
    expect(queueHarness.jobs).toHaveLength(1);
    expect((queueHarness.jobs[0]!.data as { receiptId: string }).receiptId).toBe(
      String(receipts[0]!._id),
    );
  });

  it('bounds the stored batch to the normalized events', async () => {
    await seedMonitor();
    const pages = Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/page`,
      status: 'changed',
      changed: true,
      contentHash: `h${i}`,
    }));
    const raw = body({ pages });
    const res = await post(raw, SECRET);
    expect(res.status).toBe(200);
    const receipt = await MonitorWebhookReceipt.findOne({});
    expect(receipt!.events.length).toBeLessThanOrEqual(20);
    expect(receipt!.events).toHaveLength(20);
  });
});

describe('signature rejection (401) — no detail leakage', () => {
  it('rejects a missing signature header', async () => {
    await seedMonitor();
    const res = await post(body(), null);
    expect(res.status).toBe(401);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
  });

  it('rejects a one-byte body mutation', async () => {
    await seedMonitor();
    const raw = body();
    const sig = signMonitorWebhookBody(Buffer.from(raw), SECRET);
    const res = await request(app)
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('X-Firecrawl-Signature', sig)
      .send(raw + ' ');
    expect(res.status).toBe(401);
  });

  it('rejects the wrong secret', async () => {
    await seedMonitor();
    const res = await post(body(), 'the-wrong-secret');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed / algorithm-confusion signature header', async () => {
    await seedMonitor();
    const raw = body();
    for (const sig of ['none', 'sha1=deadbeef', 'md5=deadbeef', 'deadbeef']) {
      const res = await request(app)
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('X-Firecrawl-Signature', sig)
        .send(raw);
      expect(res.status).toBe(401);
    }
  });
});

describe('replay + concurrency dedupe', () => {
  it('a duplicate delivery is a 200 no-op with no second receipt/enqueue', async () => {
    await seedMonitor();
    await MonitorWebhookReceipt.syncIndexes();
    const raw = body();
    const first = await post(raw, SECRET);
    expect(first.status).toBe(200);
    const second = await post(raw, SECRET);
    expect(second.status).toBe(200);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(1);
    expect(queueHarness.jobs).toHaveLength(1);
  });

  it('two concurrent identical deliveries land exactly one receipt (unique index)', async () => {
    await seedMonitor();
    await MonitorWebhookReceipt.syncIndexes();
    const raw = body();
    const [a, b] = await Promise.all([post(raw, SECRET), post(raw, SECRET)]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(1);
    expect(queueHarness.jobs).toHaveLength(1);
  });
});

describe('paused-site guard (7b)', () => {
  it('stores the receipt terminal-skipped and acks 200 without enqueueing', async () => {
    const paused = await Site.create({
      accountId: ACCOUNT,
      url: 'https://paused.example.com',
      domain: 'paused.example.com',
      paused: true,
      pausedAt: new Date(),
    });
    await seedMonitor({ siteId: paused._id });
    const res = await post(body(), SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    // Receipt persisted TERMINAL — never left `received` for the stuck-receipt
    // sweep to re-enqueue forever — and nothing reached the queue.
    const receipts = await MonitorWebhookReceipt.find({});
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.status).toBe('skipped');
    expect(receipts[0]!.processedAt).not.toBeNull();
    expect(queueHarness.jobs).toHaveLength(0);
  });
});

describe('site deletion barrier', () => {
  it('acks a late verified delivery without recreating a receipt or queue job', async () => {
    const monitor = await seedMonitor();
    await Site.updateOne(
      { _id: monitor.siteId },
      {
        $set: {
          deletionStartedAt: new Date(),
          paused: true,
          pausedAt: new Date(),
        },
      },
    );

    const res = await post(body({ checkId: 'late-after-delete' }), SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
    expect(queueHarness.jobs).toHaveLength(0);
  });
});

describe('post-verification failures', () => {
  it('returns 400 when the verified body is not valid JSON', async () => {
    await seedMonitor();
    const raw = 'not-json-at-all';
    const res = await post(raw, SECRET);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the verified body has a malformed vendor shape', async () => {
    await seedMonitor();
    const raw = JSON.stringify({ type: 'monitor.check.completed', bogus: true });
    const res = await post(raw, SECRET);
    expect(res.status).toBe(400);
  });
});

describe('secret rotation', () => {
  it('accepts a signature from the previous secret and rejects a retired one', async () => {
    await seedMonitor();
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: ['new-primary', PREVIOUS_SECRET] },
    ];
    // Previous secret still verifies during the rotation window.
    const ok = await post(body(), PREVIOUS_SECRET);
    expect(ok.status).toBe(200);
    // A fully retired secret fails.
    const bad = await post(body({ checkId: 'chk-2' }), 'ancient-retired-secret');
    expect(bad.status).toBe(401);
  });
});

describe('correlation + runtime', () => {
  it('rejects a valid primary signature that claims the fallback credential', async () => {
    env.FIRECRAWL_FALLBACK_API_KEYS = [FALLBACK_API_KEY];
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [SECRET] },
      { credential: 'fallback:0', secrets: [FALLBACK_SECRET] },
    ];
    const monitorA = await seedMonitor({
      targetUrl: 'https://example.com/team-a',
      providerCredentialRef: PRIMARY_CREDENTIAL_REF,
    });
    const monitorB = await seedMonitor({
      targetUrl: 'https://example.com/team-b',
      providerCredentialRef: FALLBACK_CREDENTIAL_REF,
    });

    const attack = await post(
      body({ providerCredentialRef: FALLBACK_CREDENTIAL_REF, checkId: 'chk-attack' }),
      SECRET,
    );
    expect(attack.status).toBe(401);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
    expect(queueHarness.jobs).toHaveLength(0);

    const first = await post(
      body({ providerCredentialRef: PRIMARY_CREDENTIAL_REF, checkId: 'chk-primary' }),
      SECRET,
    );
    const second = await post(
      body({ providerCredentialRef: FALLBACK_CREDENTIAL_REF, checkId: 'chk-fallback' }),
      FALLBACK_SECRET,
    );
    expect([first.status, second.status]).toEqual([200, 200]);
    const receipts = await MonitorWebhookReceipt.find({});
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => String(receipt.monitorId)).sort()).toEqual(
      [String(monitorA._id), String(monitorB._id)].sort(),
    );
    expect(queueHarness.jobs).toHaveLength(2);
  });

  it('fails closed for metadata-free legacy deliveries', async () => {
    await seedMonitor({
      targetUrl: 'https://example.com/legacy',
      providerCredentialRef: null,
    });
    const legacyResponse = await post(
      body({ providerCredentialRef: undefined, checkId: 'chk-legacy' }),
      SECRET,
    );
    expect(legacyResponse.status).toBe(401);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
  });

  it('rejects an unknown credential reference even with a valid configured signature', async () => {
    await seedMonitor({
      providerCredentialRef: PRIMARY_CREDENTIAL_REF,
    });
    const res = await post(
      body({ providerCredentialRef: 'fc-cred-v1:removed-credential' }),
      SECRET,
    );
    expect(res.status).toBe(401);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
  });

  it('acks 200 for a delivery whose monitor is unknown (no receipt)', async () => {
    // No monitor seeded → providerMonitorRef has no match.
    const res = await post(body(), SECRET);
    expect(res.status).toBe(200);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
  });

  it('returns 503 when the queue/provider runtime is down', async () => {
    await seedMonitor();
    setContentMonitorQueue(null);
    const res = await post(body(), SECRET);
    expect(res.status).toBe(503);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
  });

  it('returns 500 when no explicit webhook binding is configured', async () => {
    await seedMonitor();
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [];
    const res = await post(body(), SECRET);
    expect(res.status).toBe(500);
  });

  it('accepts an authenticated in-flight delivery when the root rollout flag is off', async () => {
    await seedMonitor();
    env.CONTENT_MONITORING_ENABLED = false;
    const res = await post(body(), SECRET);
    expect(res.status).toBe(200);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(1);
    expect(queueHarness.jobs).toHaveLength(1);
  });

  it('returns 503 without persistence when the operator kill switch is off', async () => {
    await seedMonitor();
    await getTestDb().insert(featureFlags).values({ key: 'firecrawl_change_monitoring', enabled: false });
    const res = await post(body(), SECRET);
    expect(res.status).toBe(503);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
    expect(queueHarness.jobs).toHaveLength(0);
  });

  it('returns 503 without persistence when the kill-switch read fails', async () => {
    await seedMonitor();
    const switchSpy = vi
      .spyOn(featureFlagsModule, 'isKillSwitchEnabled')
      .mockRejectedValueOnce(new Error('postgres unavailable'));
    const res = await post(body({ checkId: 'chk-switch-read-failed' }), SECRET);
    expect(res.status).toBe(503);
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(0);
    expect(queueHarness.jobs).toHaveLength(0);
    switchSpy.mockRestore();
  });

  it('persists the receipt and still 200s when the enqueue fails (reconciled later)', async () => {
    await seedMonitor();
    setContentMonitorQueue({
      async add() {
        throw new Error('redis down');
      },
    } as unknown as Queue);
    const res = await post(body(), SECRET);
    expect(res.status).toBe(200);
    // Receipt persisted for the reconciliation stuck-receipt sweep.
    expect(await MonitorWebhookReceipt.countDocuments()).toBe(1);
  });

  it('surfaces a non-duplicate receipt-insert error as a 500', async () => {
    await seedMonitor();
    const createSpy = vi
      .spyOn(MonitorWebhookReceipt, 'create')
      .mockRejectedValueOnce(new Error('mongo exploded'));
    const res = await post(body(), SECRET);
    expect(res.status).toBe(500);
    createSpy.mockRestore();
  });
});

describe('isMonitorWebhookConfigured', () => {
  it('reflects whether the exact credential bindings are configured (boolean only)', () => {
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [SECRET] },
    ];
    expect(isMonitorWebhookConfigured()).toBe(true);
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [];
    expect(isMonitorWebhookConfigured()).toBe(false);
  });

  it('fails closed for every malformed credential-binding shape', () => {
    env.FIRECRAWL_API_KEY = undefined;
    expect(isMonitorWebhookConfigured()).toBe(false);

    env.FIRECRAWL_API_KEY = PRIMARY_API_KEY;
    env.FIRECRAWL_FALLBACK_API_KEYS = [FALLBACK_API_KEY];
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [SECRET] },
      { credential: 'fallback:9', secrets: [FALLBACK_SECRET] },
    ];
    expect(isMonitorWebhookConfigured()).toBe(false);

    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [SECRET] },
      { credential: 'primary', secrets: [FALLBACK_SECRET] },
    ];
    expect(isMonitorWebhookConfigured()).toBe(false);

    env.FIRECRAWL_FALLBACK_API_KEYS = [''];
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [SECRET] },
      { credential: 'fallback:0', secrets: [FALLBACK_SECRET] },
    ];
    expect(isMonitorWebhookConfigured()).toBe(false);

    env.FIRECRAWL_FALLBACK_API_KEYS = [];
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [' '] },
    ];
    expect(isMonitorWebhookConfigured()).toBe(false);

    env.FIRECRAWL_FALLBACK_API_KEYS = [FALLBACK_API_KEY];
    env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
      { credential: 'primary', secrets: [SECRET] },
      { credential: 'fallback:0', secrets: [SECRET] },
    ];
    expect(isMonitorWebhookConfigured()).toBe(false);
  });
});

describe('byte cap (pre-HMAC) + log redaction', () => {
  it('rejects an oversized body with 413 before any HMAC work', async () => {
    // Direct handler unit test — express.raw would reject >1mb transport-side;
    // this proves the explicit in-handler cap runs BEFORE signature verification.
    const oversized = Buffer.alloc(MONITOR_WEBHOOK_MAX_BODY_BYTES + 1, 0x61);
    let status = 0;
    let payload: unknown;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: unknown) {
        payload = value;
        return this;
      },
    } as unknown as Response;
    const req = { body: oversized, headers: {} } as unknown as Request;
    await (monitorWebhookHandler as unknown as (
      r: unknown,
      s: unknown,
      n: unknown,
    ) => Promise<void>)(req, res, vi.fn());
    expect(status).toBe(413);
    expect(payload).toEqual({ received: false });
  });

  async function callHandler(req: Partial<Request>) {
    let status = 0;
    let payload: unknown;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: unknown) {
        payload = value;
        return this;
      },
    } as unknown as Response;
    await (monitorWebhookHandler as unknown as (
      r: unknown,
      s: unknown,
      n: unknown,
    ) => Promise<void>)(req, res, vi.fn());
    return { status, payload };
  }

  it('treats a non-Buffer body as empty (401 missing signature)', async () => {
    // req.body is not a Buffer (express.raw did not run) → Buffer.from('').
    const { status, payload } = await callHandler({ body: undefined, headers: {} });
    expect(status).toBe(401);
    expect(payload).toEqual({ received: false });
  });

  it('maps a non-verify error from verification to a 401 (no detail leak)', async () => {
    const spy = vi
      .spyOn(verifyModule, 'verifyMonitorWebhookSignature')
      .mockImplementationOnce(() => {
        throw new Error('unexpected non-verify error');
      });
    const raw = body();
    const { status, payload } = await callHandler({
      body: Buffer.from(raw),
      headers: { 'x-firecrawl-signature': signMonitorWebhookBody(Buffer.from(raw), SECRET) },
    });
    expect(status).toBe(401);
    expect(payload).toEqual({ received: false });
    spy.mockRestore();
  });

  it('never logs the raw body or the signature header', async () => {
    await seedMonitor();
    const infoSpy = vi.spyOn(sharedLogger, 'info');
    const warnSpy = vi.spyOn(sharedLogger, 'warn');
    const raw = body();
    const sig = signMonitorWebhookBody(Buffer.from(raw), SECRET);
    await post(raw, SECRET);
    await post(raw, SECRET); // duplicate → controller logs a dedupe info line
    // Drive the enqueue-failure warn path too.
    setContentMonitorQueue({
      async add() {
        throw new Error('down');
      },
    } as unknown as Queue);
    await post(body({ checkId: 'chk-9' }), SECRET);

    const allArgs = [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => JSON.stringify(call))
      .join('\n');
    expect(allArgs).not.toContain(sig);
    expect(allArgs).not.toContain('sha256=');
    expect(allArgs).not.toContain('example.com/page');
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
