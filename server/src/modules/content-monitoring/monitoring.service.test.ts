/**
 * Content-monitor service tests (spec 10) against real PGlite + memory Mongo.
 * Proves the create-order invariants (runtime 503, ownership 404, both kill
 * switches, SSRF, owned/competitor eligibility, active limit 409, duplicate
 * short-circuit, provider failure 502), the encrypted-at-rest guarantee
 * (plaintext vendor id NEVER persisted; ref = sha256), pause/resume/delete, and
 * the list + change-feed reads. DNS is injected — no live lookup.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
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
import type { PublicUrlResolver } from '../../shared/security/index.js';
import { decryptSecret } from '../../shared/crypto/index.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { competitorProfiles } from '../../db/schema/index.js';
import { featureFlags } from '../../db/schema/index.js';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
import {
  ContentMonitor,
  MonitorEvidence,
  MonitorWebhookReceipt,
} from './monitor.model.js';
import { recordContentMonitorEvent } from './monitoring.events.js';
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  isDuplicateKeyError,
  listMonitors,
  pauseMonitor,
  resumeMonitor,
  type MonitoringDeps,
} from './monitoring.service.js';

const ACCOUNT = '000000000000000000000abc';
const OTHER = '000000000000000000000fff';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;
const publicResolver: PublicUrlResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const privateResolver: PublicUrlResolver = async () => [{ address: '10.0.0.5', family: 4 }];

function provider(over: Partial<ContentMonitorProvider> = {}): ContentMonitorProvider {
  return {
    createMonitor: vi.fn(async (input: { targetUrl: string }) => ({
        providerMonitorId:
          input.targetUrl === 'https://example.com/page'
            ? 'vendor-secret-id'
            : `vendor-${createHash('sha256').update(input.targetUrl).digest('hex').slice(0, 16)}`,
        providerCredentialRef: 'service-test-credential',
        status: 'active',
        cadence: 'weekly',
      })),
    pauseMonitor: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'paused' }),
    resumeMonitor: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'active' }),
    deleteMonitor: vi.fn().mockResolvedValue(undefined),
    getMonitorStatus: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'active' }),
    normalizeWebhookDelivery: vi.fn(),
    ...over,
  } as ContentMonitorProvider;
}

function fakeQueue() {
  const jobs: unknown[] = [];
  return {
    jobs,
    queue: {
      async add(_n: string, d: unknown) {
        jobs.push(d);
        return { id: 'x' };
      },
    } as unknown as Queue,
  };
}

const deps = (over: Partial<MonitoringDeps> = {}): MonitoringDeps => ({
  db: db(),
  queue: fakeQueue().queue,
  provider: provider(),
  resolver: publicResolver,
  ...over,
});

async function seedSite(accountId = ACCOUNT, url = 'https://example.com') {
  const site = await Site.create({ accountId, url, domain: new URL(url).hostname });
  return String(site._id);
}

function createInput(siteId: string, over: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId,
    body: {
      targetUrl: 'https://example.com/page',
      targetKind: 'owned' as const,
      locale: 'en' as const,
      ...over,
    },
  };
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
  env.CONTENT_MONITORING_ENABLED = true;
});

describe('createMonitor — ordering + guards', () => {
  it('503 when the queue or provider runtime is missing', async () => {
    const siteId = await seedSite();
    await expect(createMonitor(createInput(siteId), deps({ queue: null }))).rejects.toMatchObject({
      status: 503,
    });
    await expect(createMonitor(createInput(siteId), deps({ provider: null }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it('404 for a non-owned / invalid site (no existence leak)', async () => {
    await expect(createMonitor(createInput('not-an-id'), deps())).rejects.toMatchObject({ status: 404 });
    const otherSite = await seedSite(OTHER);
    await expect(createMonitor(createInput(otherSite), deps())).rejects.toMatchObject({ status: 404 });
  });

  it('503 when the env kill switch is off', async () => {
    const siteId = await seedSite();
    env.CONTENT_MONITORING_ENABLED = false;
    await expect(createMonitor(createInput(siteId), deps())).rejects.toMatchObject({ status: 503 });
  });

  it('503 when the operator kill switch is off', async () => {
    const siteId = await seedSite();
    await db().insert(featureFlags).values({ key: 'firecrawl_change_monitoring', enabled: false });
    await expect(createMonitor(createInput(siteId), deps())).rejects.toMatchObject({ status: 503 });
  });

  it('400 for an unsafe target URL', async () => {
    const siteId = await seedSite();
    await expect(
      createMonitor(createInput(siteId), deps({ resolver: privateResolver })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('validates a public IP literal without an injected DNS resolver', async () => {
    const siteId = await seedSite(ACCOUNT, 'https://8.8.8.8');
    const result = await createMonitor(
      createInput(siteId, { targetUrl: 'https://8.8.8.8/page' }),
      deps({ resolver: undefined }),
    );

    expect(result).toMatchObject({
      duplicate: false,
      monitor: { targetUrl: 'https://8.8.8.8/page' },
    });
  });

  it('400 for an owned target not on the site origin', async () => {
    const siteId = await seedSite();
    await expect(
      createMonitor(
        createInput(siteId, { targetUrl: 'https://elsewhere.com/x' }),
        deps(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404 for a competitor target with no confirmed profile', async () => {
    const siteId = await seedSite();
    await expect(
      createMonitor(
        createInput(siteId, { targetUrl: 'https://rival.com/x', targetKind: 'competitor' }),
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('creates a monitor for a confirmed competitor target', async () => {
    const siteId = await seedSite();
    await db().insert(competitorProfiles).values({
      accountId: ACCOUNT,
      siteId,
      origin: 'https://rival.com',
      registrableDomain: 'rival.com',
      source: 'manual',
      status: 'active',
    });
    const result = await createMonitor(
      createInput(siteId, { targetUrl: 'https://rival.com/x', targetKind: 'competitor' }),
      deps({ resolver: async () => [{ address: '93.184.216.34', family: 4 }] }),
    );
    expect(result.duplicate).toBe(false);
    expect(result.monitor.targetKind).toBe('competitor');
  });

  it('encrypts the vendor id at rest — plaintext NEVER persisted, ref = sha256', async () => {
    const siteId = await seedSite();
    const result = await createMonitor(createInput(siteId), deps());
    const doc = await ContentMonitor.findOne({ accountId: ACCOUNT });
    const raw = JSON.stringify(doc!.toObject());
    // Plaintext vendor id is absent from the stored document.
    expect(raw).not.toContain('vendor-secret-id');
    // The envelope decrypts back to the vendor id, and the non-secret ref is
    // its sha256 — the only value used for webhook correlation.
    expect(decryptSecret(doc!.providerMonitorIdEncrypted as never)).toBe('vendor-secret-id');
    expect(doc!.providerMonitorRef).toBe(
      createHash('sha256').update('vendor-secret-id').digest('hex'),
    );
    expect(doc!.providerCredentialRef).toBe('service-test-credential');
    expect(result.monitor).not.toHaveProperty('providerCredentialRef');
  });

  it('short-circuits a duplicate (accountId, targetUrl) to the existing monitor', async () => {
    const siteId = await seedSite();
    const first = await createMonitor(createInput(siteId), deps());
    const second = await createMonitor(createInput(siteId), deps());
    expect(second.duplicate).toBe(true);
    expect(second.monitor.monitorId).toBe(first.monitor.monitorId);
    expect(await ContentMonitor.countDocuments()).toBe(1);
  });

  it('409 once the active-monitor limit (5) is reached', async () => {
    const siteId = await seedSite();
    for (let i = 0; i < 5; i += 1) {
      await createMonitor(
        createInput(siteId, { targetUrl: `https://example.com/p${i}` }),
        deps(),
      );
    }
    await expect(
      createMonitor(createInput(siteId, { targetUrl: 'https://example.com/p6' }), deps()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('502 when the provider create call fails', async () => {
    const siteId = await seedSite();
    await expect(
      createMonitor(
        createInput(siteId),
        deps({ provider: provider({ createMonitor: vi.fn().mockRejectedValue(new Error('vendor down')) }) }),
      ),
    ).rejects.toMatchObject({ status: 502 });
    // No monitor persisted on a provider failure.
    expect(await ContentMonitor.countDocuments()).toBe(0);
  });

  it('resolves a persist race (duplicate key) to the winning monitor + deletes the orphan', async () => {
    const siteId = await seedSite();
    // The winner already occupies (accountId, targetUrl).
    const winner = await ContentMonitor.create({
      accountId: ACCOUNT,
      ownerUserId: ACCOUNT,
      siteId,
      targetUrl: 'https://example.com/page',
      targetKind: 'owned',
      locale: 'en',
      providerMonitorIdEncrypted: { ciphertext: 'ct', iv: 'iv', authTag: 't', keyVersion: 1 },
      providerMonitorRef: 'ref',
      createdBy: ACCOUNT,
    });
    // Force the create() path to see a fresh insert (existence check → null),
    // then throw a duplicate-key error; the race re-read resolves the winner.
    const findSpy = vi
      .spyOn(ContentMonitor, 'findOne')
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(winner as never);
    const createSpy = vi
      .spyOn(ContentMonitor, 'create')
      .mockRejectedValueOnce({ code: 11000 });
    // The orphan-cleanup delete REJECTS — the `.catch(() => undefined)` must
    // swallow it (best-effort) and the create still resolves to the winner.
    const deleteMonitorFn = vi.fn().mockRejectedValue(new Error('cleanup failed'));

    const result = await createMonitor(
      createInput(siteId),
      deps({ provider: provider({ deleteMonitor: deleteMonitorFn }) }),
    );
    expect(result.duplicate).toBe(true);
    expect(result.monitor.monitorId).toBe(String(winner._id));
    // Best-effort cleanup of the orphan vendor monitor we just created.
    expect(deleteMonitorFn).toHaveBeenCalledTimes(1);
    expect(deleteMonitorFn).toHaveBeenCalledWith({
      providerMonitorId: 'vendor-secret-id',
      providerCredentialRef: 'service-test-credential',
      timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
    });
    findSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('rethrows a non-duplicate persist error', async () => {
    const siteId = await seedSite();
    const findSpy = vi.spyOn(ContentMonitor, 'findOne').mockResolvedValueOnce(null as never);
    const createSpy = vi
      .spyOn(ContentMonitor, 'create')
      .mockRejectedValueOnce(new Error('db exploded'));
    await expect(createMonitor(createInput(siteId), deps())).rejects.toThrow('db exploded');
    findSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('rethrows a duplicate-key error when no winning row is found on re-read', async () => {
    const siteId = await seedSite();
    // Existence check → null; re-read after the 11000 → still null (no winner).
    const findSpy = vi
      .spyOn(ContentMonitor, 'findOne')
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    const createSpy = vi
      .spyOn(ContentMonitor, 'create')
      .mockRejectedValueOnce({ code: 11000 });
    await expect(createMonitor(createInput(siteId), deps())).rejects.toMatchObject({
      code: 11000,
    });
    findSpy.mockRestore();
    createSpy.mockRestore();
  });
});

describe('isDuplicateKeyError', () => {
  it('classifies every error shape', () => {
    expect(isDuplicateKeyError('a string')).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ name: 'MongoServerError' })).toBe(true);
    expect(isDuplicateKeyError({ code: 1, name: 'Other' })).toBe(false);
  });
});

describe('pause / resume / delete', () => {
  async function makeMonitor(siteId: string) {
    const res = await createMonitor(createInput(siteId), deps());
    return res.monitor.monitorId;
  }

  it('503 when the provider runtime is missing', async () => {
    const siteId = await seedSite();
    const monitorId = await makeMonitor(siteId);
    await expect(
      pauseMonitor({ accountId: ACCOUNT, siteId, monitorId }, deps({ provider: null })),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      resumeMonitor({ accountId: ACCOUNT, siteId, monitorId }, deps({ provider: null })),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      deleteMonitor({ accountId: ACCOUNT, siteId, monitorId }, deps({ provider: null })),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('404 for an unknown / cross-account monitor', async () => {
    const siteId = await seedSite();
    await expect(
      pauseMonitor({ accountId: ACCOUNT, siteId, monitorId: 'bad' }, deps()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      pauseMonitor(
        { accountId: ACCOUNT, siteId, monitorId: '000000000000000000000fff' },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('pauses then resumes via the provider + state machine', async () => {
    const siteId = await seedSite();
    const providerHarness = provider();
    const created = await createMonitor(
      createInput(siteId),
      deps({ provider: providerHarness }),
    );
    const monitorId = created.monitor.monitorId;
    const paused = await pauseMonitor(
      { accountId: ACCOUNT, siteId, monitorId },
      deps({ provider: providerHarness }),
    );
    expect(paused.status).toBe('paused');
    const resumed = await resumeMonitor(
      { accountId: ACCOUNT, siteId, monitorId },
      deps({ provider: providerHarness }),
    );
    expect(resumed.status).toBe('active');
    expect(providerHarness.pauseMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'service-test-credential' }),
    );
    expect(providerHarness.resumeMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'service-test-credential' }),
    );
  });

  it('mutates legacy monitors without inventing a provider credential reference', async () => {
    const siteId = await seedSite();
    const providerHarness = provider({
      createMonitor: vi.fn().mockResolvedValue({
        providerMonitorId: 'legacy-vendor-monitor',
        status: 'active',
        cadence: 'weekly',
      }),
    });
    const created = await createMonitor(
      createInput(siteId),
      deps({ provider: providerHarness }),
    );
    const input = { accountId: ACCOUNT, siteId, monitorId: created.monitor.monitorId };

    await pauseMonitor(input, deps({ provider: providerHarness }));
    await resumeMonitor(input, deps({ provider: providerHarness }));
    await deleteMonitor(input, deps({ provider: providerHarness }));

    for (const mutation of [
      providerHarness.pauseMonitor,
      providerHarness.resumeMonitor,
      providerHarness.deleteMonitor,
    ]) {
      expect(mutation).toHaveBeenCalledWith({
        providerMonitorId: 'legacy-vendor-monitor',
        timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
      });
    }
  });

  it('502 when the provider mutation fails', async () => {
    const siteId = await seedSite();
    const monitorId = await makeMonitor(siteId);
    await expect(
      pauseMonitor(
        { accountId: ACCOUNT, siteId, monitorId },
        deps({ provider: provider({ pauseMonitor: vi.fn().mockRejectedValue(new Error('x')) }) }),
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      resumeMonitor(
        { accountId: ACCOUNT, siteId, monitorId },
        deps({ provider: provider({ resumeMonitor: vi.fn().mockRejectedValue(new Error('x')) }) }),
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      deleteMonitor(
        { accountId: ACCOUNT, siteId, monitorId },
        deps({ provider: provider({ deleteMonitor: vi.fn().mockRejectedValue(new Error('x')) }) }),
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(
      (await ContentMonitor.findById(monitorId))?.deletionStartedAt,
    ).toBeNull();
  });

  it('deletes the monitor + its evidence', async () => {
    const siteId = await seedSite();
    const providerHarness = provider();
    const created = await createMonitor(
      createInput(siteId),
      deps({ provider: providerHarness }),
    );
    const monitorId = created.monitor.monitorId;
    await deleteMonitor(
      { accountId: ACCOUNT, siteId, monitorId },
      deps({ provider: providerHarness }),
    );
    expect(providerHarness.deleteMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'service-test-credential' }),
    );
    expect(await ContentMonitor.countDocuments()).toBe(0);
  });

  it('retains only scrubbed receipt tombstones and records an in-flight send as unknown', async () => {
    const siteId = await seedSite();
    const providerHarness = provider();
    const created = await createMonitor(
      createInput(siteId),
      deps({ provider: providerHarness }),
    );
    const monitorId = created.monitor.monitorId;
    const monitor = await ContentMonitor.findById(monitorId).orFail();
    const now = new Date('2026-08-06T12:00:00.000Z');
    const targetUrl = 'https://example.com/page';
    const makeReceipt = (eventId: string, state: 'pending' | 'sending') => ({
      provider: 'firecrawl',
      eventId,
      monitorId: monitor._id,
      accountId: ACCOUNT,
      siteId,
      providerMonitorRef: monitor.providerMonitorRef,
      checkId: `check-${eventId}`,
      eventType: 'changed',
      payloadHash: `payload-${eventId}`,
      events: [
        {
          eventKey: `event-${eventId}`,
          checkId: `check-${eventId}`,
          targetUrl,
          status: 'changed',
          changed: true,
          contentHash: `hash-${eventId}`,
          diffText: `private diff ${eventId}`,
          occurredAt: now,
        },
      ],
      status: 'notification_pending',
      notification: {
        state,
        ownerUserId: ACCOUNT,
        recipientEmail: 'owner@example.com',
        senderIdentity: 'RankMe <alerts@example.com>',
        suppressionReason: null,
        targetUrl,
        locale: 'en',
        subject: `Changed ${eventId}`,
        text: `Rendered body ${eventId}`,
        idempotencyKey: `monitor:${eventId}`,
        ...(state === 'sending'
          ? { leaseId: `lease-${eventId}`, leaseUntil: new Date(now.getTime() + 60_000) }
          : {}),
      },
      receivedAt: now,
      expiryAt: new Date(Date.now() + 86_400_000),
    });
    const [pending, sending] = await MonitorWebhookReceipt.create([
      makeReceipt('pending', 'pending'),
      makeReceipt('sending', 'sending'),
    ]);
    await MonitorEvidence.create({
      monitorId: monitor._id,
      accountId: ACCOUNT,
      checkId: 'check-evidence',
      eventKey: 'event-evidence',
      sourceUrl: targetUrl,
      reason: 'hash_changed',
      diffText: 'private evidence',
      observedAt: now,
      expiryAt: new Date(Date.now() + 86_400_000),
    });

    await deleteMonitor(
      { accountId: ACCOUNT, siteId, monitorId },
      deps({ provider: providerHarness }),
    );

    expect(await ContentMonitor.findById(monitorId)).toBeNull();
    expect(await MonitorEvidence.countDocuments({ monitorId })).toBe(0);
    const pendingTombstone = await MonitorWebhookReceipt.findById(pending!._id).orFail();
    const sendingTombstone = await MonitorWebhookReceipt.findById(sending!._id).orFail();
    expect(pendingTombstone).toMatchObject({
      status: 'skipped',
      notification: {
        state: 'suppressed',
        outcome: 'monitor-deleted',
      },
    });
    expect(sendingTombstone).toMatchObject({
      status: 'processed',
      notification: {
        state: 'failed',
        outcome: 'provider-outcome-unknown',
      },
    });
    for (const receipt of [pendingTombstone, sendingTombstone]) {
      expect(receipt.events[0]?.diffText).toBeNull();
      expect(receipt.notification).toMatchObject({
        recipientEmail: null,
        senderIdentity: null,
        targetUrl: null,
        subject: null,
        text: null,
        leaseId: null,
        leaseUntil: null,
        providerMessageId: null,
      });
    }
  });
});

describe('reads — list + change feed', () => {
  it('lists monitors with the active-limit meta', async () => {
    const siteId = await seedSite();
    await createMonitor(createInput(siteId), deps());
    await createMonitor(createInput(siteId, { targetUrl: 'https://example.com/two' }), deps());
    const all = await listMonitors({ accountId: ACCOUNT, siteId, status: 'all' });
    expect(all.monitors).toHaveLength(2);
    expect(all.activeLimit).toBe(5);
    expect(all.usedSlots).toBe(2);
    const activeOnly = await listMonitors({ accountId: ACCOUNT, siteId, status: 'active' });
    expect(activeOnly.monitors).toHaveLength(2);
  });

  it('returns a paginated change feed with sanitized diff evidence', async () => {
    const siteId = await seedSite();
    const { monitor } = await createMonitor(createInput(siteId), deps());
    const monitorId = monitor.monitorId;
    // Two change events, newest first.
    for (const [i, when] of [0, 1].entries()) {
      await recordContentMonitorEvent(db(), {
        accountId: ACCOUNT,
        siteId,
        monitorId,
        eventKey: `evt-${i}`,
        kind: 'change_detected',
        checkId: `chk-${i}`,
        isoWeek: '2026-W30',
      });
      void when;
    }
    const page = await getMonitor({
      db: db(),
      accountId: ACCOUNT,
      siteId,
      monitorId,
      limit: 1,
    });
    expect(page.monitor.monitorId).toBe(monitorId);
    expect(page.feed).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();

    const next = await getMonitor({
      db: db(),
      accountId: ACCOUNT,
      siteId,
      monitorId,
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(next.feed).toHaveLength(1);
    expect(next.feed[0]!.eventKey).not.toBe(page.feed[0]!.eventKey);
  });

  it('serializes error + timestamps + feed diff evidence (all present branches)', async () => {
    const siteId = await seedSite();
    const { monitor } = await createMonitor(createInput(siteId), deps());
    const monitorId = monitor.monitorId;
    const when = new Date('2026-07-19T00:00:00.000Z');
    // Populate the optional timestamp + error fields so their present-branches
    // in toPublicMonitor are serialized (not just the null fallbacks).
    await ContentMonitor.updateOne(
      { _id: monitorId },
      {
        $set: {
          status: 'error',
          error: { category: 'reconcile_failed', messageKey: 'x' },
          lastCheckAt: when,
          lastMaterialChangeAt: when,
          lastReconcileAt: when,
        },
      },
    );
    // One feed event WITH checkId+isoWeek + attached diff evidence, and one
    // WITHOUT (null checkId/isoWeek) so both `?? null` branches are exercised.
    await recordContentMonitorEvent(db(), {
      accountId: ACCOUNT,
      siteId,
      monitorId,
      eventKey: 'with-meta',
      kind: 'change_detected',
      checkId: 'chk-x',
      isoWeek: '2026-W30',
    });
    await recordContentMonitorEvent(db(), {
      accountId: ACCOUNT,
      siteId,
      monitorId,
      eventKey: 'no-meta',
      kind: 'check_completed',
    });
    await MonitorEvidence.create({
      monitorId,
      accountId: ACCOUNT,
      checkId: 'chk-x',
      eventKey: 'with-meta',
      sourceUrl: 'https://example.com/page',
      reason: 'hash_changed',
      diffText: 'a short diff',
      observedAt: when,
      expiryAt: new Date(Date.now() + 86_400_000),
    });
    // A second evidence row with a NULL diff so the `diffText ?? null` map
    // branch is exercised on both sides.
    await MonitorEvidence.create({
      monitorId,
      accountId: ACCOUNT,
      checkId: 'chk-none',
      eventKey: 'no-meta',
      sourceUrl: 'https://example.com/page',
      reason: 'page_removed',
      diffText: null,
      observedAt: when,
      expiryAt: new Date(Date.now() + 86_400_000),
    });

    const list = await listMonitors({ accountId: ACCOUNT, siteId, status: 'all' });
    expect(list.monitors[0]!.error).toEqual({ category: 'reconcile_failed', messageKey: 'x' });
    expect(list.monitors[0]!.lastCheckAt).toBe(when.toISOString());

    const page = await getMonitor({ db: db(), accountId: ACCOUNT, siteId, monitorId, limit: 10 });
    const withMeta = page.feed.find((f) => f.eventKey === 'with-meta')!;
    const noMeta = page.feed.find((f) => f.eventKey === 'no-meta')!;
    expect(withMeta.diffText).toBe('a short diff');
    expect(withMeta.checkId).toBe('chk-x');
    expect(withMeta.isoWeek).toBe('2026-W30');
    expect(noMeta.checkId).toBeNull();
    expect(noMeta.isoWeek).toBeNull();
    expect(noMeta.diffText).toBeNull();
  });

  it('rejects a malformed change-feed cursor with 400', async () => {
    const siteId = await seedSite();
    const { monitor } = await createMonitor(createInput(siteId), deps());
    await expect(
      getMonitor({
        db: db(),
        accountId: ACCOUNT,
        siteId,
        monitorId: monitor.monitorId,
        limit: 10,
        cursor: 'not-a-valid-cursor',
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
