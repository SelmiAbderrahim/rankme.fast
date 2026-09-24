import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GscReconnectRequiredError,
  VendorUnavailableError,
  createFakeGa4Provider,
  createFakeGscProvider,
} from '../../shared/providers/index.js';
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
import { Site } from '../sites/index.js';
import { setGa4SyncQueue } from './ga4-sync-queue.js';
import {
  createGoogleSiteAutoMatchProcessor,
  scheduleGoogleSiteAutoMatch,
} from './google-site-auto-match.processor.js';
import {
  getConnection,
  markNeedsReconnect,
  setGoogleConnectionsDb,
  upsertConnection,
} from './google-connections.service.js';
import { SCOPE_GA4, SCOPE_GSC } from './google-connections.schema.js';
import { setGscSyncQueue } from './gsc-sync-queue.js';

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setGoogleConnectionsDb(getTestDb() as never);
  setGscSyncQueue(null);
  setGa4SyncQueue(null);
  vi.restoreAllMocks();
});

const NOW = new Date('2026-08-20T10:00:00.000Z');

function objectId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

function job(
  data: Record<string, unknown>,
  attemptsMade = 0,
  attempts = 3,
): Job {
  return { data, attemptsMade, opts: { attempts } } as unknown as Job;
}

async function seedSite(
  accountId: string,
  input: Record<string, unknown> = {},
) {
  const requestId = randomUUID();
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
    googleAutoMatch: {
      requestId,
      gscStatus: 'queued',
      ga4Status: 'queued',
      requestedAt: NOW,
    },
    ...input,
  });
  return { site, requestId };
}

async function connect(accountId: string, includeGa4 = true): Promise<void> {
  await upsertConnection({
    accountId,
    googleAccountEmail: 'owner@example.com',
    refreshToken: 'refresh-token',
    scopes: includeGa4 ? [SCOPE_GSC, SCOPE_GA4] : [SCOPE_GSC],
  });
}

function processor(overrides: {
  gscProvider?: ReturnType<typeof createFakeGscProvider>;
  ga4Provider?: ReturnType<typeof createFakeGa4Provider>;
  logger?: Logger;
} = {}) {
  return createGoogleSiteAutoMatchProcessor({
    gscProvider: overrides.gscProvider ?? createFakeGscProvider(),
    ga4Provider: overrides.ga4Provider ?? createFakeGa4Provider(),
    now: () => NOW,
    ...(overrides.logger ? { logger: overrides.logger } : {}),
  });
}

describe('createGoogleSiteAutoMatchProcessor', () => {
  it('rejects malformed queue payloads without retrying', async () => {
    await expect(processor()(job({ invalid: true }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('treats a paused or superseded Site request as stale', async () => {
    const accountId = objectId();
    const { site } = await seedSite(accountId, { paused: true });

    await expect(
      processor()(
        job({
          accountId,
          siteId: String(site._id),
          requestId: randomUUID(),
        }),
      ),
    ).resolves.toEqual({
      status: 'stale',
      gscStatus: 'unbound',
      ga4Status: 'unbound',
    });
  });

  it('records a terminal not-connected state while preserving existing bindings', async () => {
    const accountId = objectId();
    const { site, requestId } = await seedSite(accountId, {
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingGenerationId: 'manual-gsc',
      gscBindingSource: 'manual',
    });

    const result = await processor()(
      job({ accountId, siteId: String(site._id), requestId }),
    );

    expect(result).toEqual({
      status: 'not_connected',
      gscStatus: 'bound',
      ga4Status: 'not_connected',
    });
    expect((await Site.findById(site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'bound',
      ga4Status: 'not_connected',
      completedAt: NOW,
    });
  });

  it('preserves both existing bindings for connected and reconnecting accounts', async () => {
    const connectedAccount = objectId();
    await connect(connectedAccount);
    const connected = await seedSite(connectedAccount, {
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingGenerationId: 'manual-gsc',
      gscBindingSource: 'manual',
      ga4PropertyId: 'properties/manual',
      ga4BindingGenerationId: 'manual-ga4',
      ga4BindingSource: 'manual',
    });
    await expect(processor()(job({
      accountId: connectedAccount,
      siteId: String(connected.site._id),
      requestId: connected.requestId,
    }))).resolves.toEqual({
      status: 'manual',
      gscStatus: 'bound',
      ga4Status: 'bound',
    });

    const reconnectingAccount = objectId();
    await connect(reconnectingAccount);
    await markNeedsReconnect(reconnectingAccount);
    const reconnecting = await seedSite(reconnectingAccount, {
      ga4PropertyId: 'properties/manual',
      ga4BindingGenerationId: 'manual-ga4',
      ga4BindingSource: 'manual',
    });
    await expect(processor()(job({
      accountId: reconnectingAccount,
      siteId: String(reconnecting.site._id),
      requestId: reconnecting.requestId,
    }))).resolves.toEqual({
      status: 'not_connected',
      gscStatus: 'needs_reconnect',
      ga4Status: 'bound',
    });
  });

  it('matches GSC and GA4 independently and enqueues only this Site', async () => {
    const accountId = objectId();
    await connect(accountId);
    const { site, requestId } = await seedSite(accountId);
    const gscAdd = vi.fn(async () => undefined);
    const ga4Add = vi.fn(async () => undefined);
    setGscSyncQueue({ add: gscAdd } as never);
    setGa4SyncQueue({ add: ga4Add } as never);

    const result = await processor()(
      job({ accountId, siteId: String(site._id), requestId }),
    );

    expect(result).toEqual({
      status: 'matched',
      gscStatus: 'bound',
      ga4Status: 'bound',
    });
    const reloaded = await Site.findById(site._id);
    expect(reloaded).toMatchObject({
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingSource: 'auto',
      ga4PropertyId: 'properties/100000001',
      ga4PropertyDisplayName: 'example.com — GA4',
      ga4MatchedWebStreamUri: 'https://example.com',
      ga4BindingSource: 'auto',
    });
    expect(reloaded?.gscBindingGenerationId).toMatch(/[0-9a-f-]{36}/u);
    expect(reloaded?.ga4BindingGenerationId).toMatch(/[0-9a-f-]{36}/u);
    expect(gscAdd).toHaveBeenCalledWith(
      'gsc-sync',
      { accountId, siteId: String(site._id), domain: 'example.com' },
      expect.objectContaining({
        jobId: `gsc-sync-${String(site._id)}-2026-08-20`,
      }),
    );
    expect(ga4Add).toHaveBeenCalledWith(
      'ga4-sync',
      { accountId, siteId: String(site._id) },
      expect.objectContaining({
        jobId: `ga4-sync-${String(site._id)}-2026-08-20`,
      }),
    );
  });

  it('does not overwrite a manual binding that wins a race with discovery', async () => {
    const accountId = objectId();
    await connect(accountId, false);
    const { site, requestId } = await seedSite(accountId);
    let release!: () => void;
    let signalStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const base = createFakeGscProvider();
    const gscProvider = {
      ...base,
      listProperties: async (...args: Parameters<typeof base.listProperties>) => {
        signalStarted();
        await gate;
        return base.listProperties(...args);
      },
    };
    const running = processor({ gscProvider })(
      job({ accountId, siteId: String(site._id), requestId }),
    );
    await started;
    await Site.updateOne(
      { _id: site._id },
      {
        $set: {
          gscPropertyUrl: 'sc-domain:manual.example',
          gscBindingGenerationId: 'manual-generation',
          gscBindingSource: 'manual',
        },
      },
    );
    release();
    await running;

    expect(await Site.findById(site._id)).toMatchObject({
      gscPropertyUrl: 'sc-domain:manual.example',
      gscBindingGenerationId: 'manual-generation',
      gscBindingSource: 'manual',
    });
  });

  it('returns manual selection when no resource matches and GA4 scope is absent', async () => {
    const accountId = objectId();
    await connect(accountId, false);
    const { site, requestId } = await seedSite(accountId);
    const result = await processor({
      gscProvider: createFakeGscProvider({ properties: [] }),
    })(job({ accountId, siteId: String(site._id), requestId }));

    expect(result).toEqual({
      status: 'manual',
      gscStatus: 'no_match',
      ga4Status: 'scope_missing',
    });
  });

  it('returns a partial match when only GSC has a safe candidate', async () => {
    const accountId = objectId();
    await connect(accountId);
    const { site, requestId } = await seedSite(accountId);

    await expect(processor({
      ga4Provider: createFakeGa4Provider({ properties: [] }),
    })(job({ accountId, siteId: String(site._id), requestId }))).resolves.toEqual({
      status: 'partial',
      gscStatus: 'bound',
      ga4Status: 'no_match',
    });
  });

  it('sanitizes opaque discovery failures and keeps the first failure class', async () => {
    const accountId = objectId();
    await connect(accountId);
    const first = await seedSite(accountId);
    const gscBase = createFakeGscProvider();
    const ga4Base = createFakeGa4Provider();
    const bothOpaque = processor({
      gscProvider: { ...gscBase, listProperties: async () => { throw 'opaque gsc'; } },
      ga4Provider: { ...ga4Base, listProperties: async () => { throw new Error('opaque ga4'); } },
    });
    await expect(bothOpaque(job({
      accountId,
      siteId: String(first.site._id),
      requestId: first.requestId,
    }))).resolves.toMatchObject({ status: 'manual' });
    expect((await Site.findById(first.site._id))?.googleAutoMatch.failureClass).toBe('unknown');

    const second = await seedSite(accountId, {
      url: 'https://second.example.com',
      domain: 'second.example.com',
    });
    const ga4Opaque = processor({
      gscProvider: createFakeGscProvider({ properties: [] }),
      ga4Provider: { ...ga4Base, listProperties: async () => { throw 'opaque ga4'; } },
    });
    await ga4Opaque(job({
      accountId,
      siteId: String(second.site._id),
      requestId: second.requestId,
    }));
    expect((await Site.findById(second.site._id))?.googleAutoMatch.failureClass).toBe('unknown');
  });

  it('retries a retryable GA4 discovery failure while attempts remain', async () => {
    const accountId = objectId();
    await connect(accountId);
    const { site, requestId } = await seedSite(accountId);
    const failure = new VendorUnavailableError('ga4 down', {
      provider: 'google',
      operation: 'ga4-properties-list',
    });
    const base = createFakeGa4Provider();
    const match = processor({
      ga4Provider: { ...base, listProperties: async () => { throw failure; } },
    });

    await expect(match(job({
      accountId,
      siteId: String(site._id),
      requestId,
    }, 0, 3))).rejects.toBe(failure);
  });

  it('uses runtime time and default attempts for a terminal opaque token failure', async () => {
    const accountId = objectId();
    await connect(accountId);
    const { site, requestId } = await seedSite(accountId, {
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/manual',
    });
    const base = createFakeGscProvider();
    const match = createGoogleSiteAutoMatchProcessor({
      gscProvider: { ...base, refreshAccessToken: async () => { throw 'opaque token'; } },
      ga4Provider: createFakeGa4Provider(),
    });

    await expect(match({
      data: { accountId, siteId: String(site._id), requestId },
      attemptsMade: 0,
      opts: {},
    } as unknown as Job)).resolves.toEqual({
      status: 'manual',
      gscStatus: 'bound',
      ga4Status: 'bound',
    });
  });

  it('uses one attempt when the queue payload omits an attempts option', async () => {
    const accountId = objectId();
    await connect(accountId, false);
    const { site, requestId } = await seedSite(accountId);
    const failure = new VendorUnavailableError('token unavailable', {
      provider: 'google',
      operation: 'gsc-token-refresh',
    });
    const match = createGoogleSiteAutoMatchProcessor({
      gscProvider: createFakeGscProvider({ failure }),
      ga4Provider: createFakeGa4Provider(),
    });

    await expect(match({
      data: { accountId, siteId: String(site._id), requestId },
      attemptsMade: 0,
      opts: {},
    } as unknown as Job)).resolves.toMatchObject({
      status: 'manual',
      gscStatus: 'unavailable',
    });
  });

  it('retries transient discovery errors and records them after the final attempt', async () => {
    const accountId = objectId();
    await connect(accountId, false);
    const { site, requestId } = await seedSite(accountId);
    const base = createFakeGscProvider();
    const unavailable = new VendorUnavailableError('down', {
      provider: 'google',
      operation: 'gsc-sites-list',
    });
    const match = processor({
      gscProvider: {
        ...base,
        listProperties: async () => {
          throw unavailable;
        },
      },
    });
    const data = { accountId, siteId: String(site._id), requestId };

    await expect(match(job(data, 0, 3))).rejects.toBe(unavailable);
    await expect(match(job(data, 2, 3))).resolves.toEqual({
      status: 'manual',
      gscStatus: 'unavailable',
      ga4Status: 'scope_missing',
    });
    expect((await Site.findById(site._id))?.googleAutoMatch.failureClass).toBe(
      'VendorUnavailableError',
    );
  });

  it('maps token refresh failures to retry or reconnect states', async () => {
    const accountId = objectId();
    await connect(accountId);
    const first = await seedSite(accountId);
    const transient = new VendorUnavailableError('token down', {
      provider: 'google',
      operation: 'gsc-token-refresh',
    });
    await expect(
      processor({ gscProvider: createFakeGscProvider({ failure: transient }) })(
        job(
          {
            accountId,
            siteId: String(first.site._id),
            requestId: first.requestId,
          },
          0,
          2,
        ),
      ),
    ).rejects.toBe(transient);

    const second = await seedSite(accountId, {
      url: 'https://second.example.com',
      domain: 'second.example.com',
    });
    const reconnect = new GscReconnectRequiredError('invalid grant', {
      provider: 'google',
      operation: 'gsc-token-refresh',
    });
    await expect(
      processor({ gscProvider: createFakeGscProvider({ failure: reconnect }) })(
        job({
          accountId,
          siteId: String(second.site._id),
          requestId: second.requestId,
        }),
      ),
    ).resolves.toMatchObject({
      status: 'manual',
      gscStatus: 'needs_reconnect',
      ga4Status: 'needs_reconnect',
    });
    expect((await getConnection(accountId))?.status).toBe('needs_reconnect');
  });
});

describe('scheduleGoogleSiteAutoMatch', () => {
  it('returns null for a missing Site and marks an unconnected Site honestly', async () => {
    const accountId = objectId();
    await expect(
      scheduleGoogleSiteAutoMatch(accountId, objectId()),
    ).resolves.toBeNull();
    const { site } = await seedSite(accountId);
    await scheduleGoogleSiteAutoMatch(accountId, String(site._id));
    expect((await Site.findById(site._id))?.googleAutoMatch).toMatchObject({
      requestId: null,
      gscStatus: 'not_connected',
      ga4Status: 'not_connected',
    });
  });

  it('records queue unavailability without making Site creation fail', async () => {
    const accountId = objectId();
    await connect(accountId);
    const { site } = await seedSite(accountId);

    await expect(
      scheduleGoogleSiteAutoMatch(accountId, String(site._id)),
    ).resolves.toBeNull();
    expect((await Site.findById(site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'unavailable',
      ga4Status: 'unavailable',
      failureClass: 'queue_unavailable',
      completedAt: expect.any(Date),
    });
  });

  it('preserves bound resources through reconnect and missing-queue states', async () => {
    const reconnectingAccount = objectId();
    await connect(reconnectingAccount);
    await markNeedsReconnect(reconnectingAccount);
    const reconnecting = await seedSite(reconnectingAccount, {
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/manual',
    });
    await scheduleGoogleSiteAutoMatch(reconnectingAccount, String(reconnecting.site._id));
    expect((await Site.findById(reconnecting.site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'bound',
      ga4Status: 'bound',
    });

    const connectedAccount = objectId();
    await connect(connectedAccount);
    const connected = await seedSite(connectedAccount, {
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/manual',
    });
    await scheduleGoogleSiteAutoMatch(connectedAccount, String(connected.site._id));
    expect((await Site.findById(connected.site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'bound',
      ga4Status: 'bound',
      failureClass: 'queue_unavailable',
    });

    const reconnectingUnbound = await seedSite(reconnectingAccount, {
      url: 'https://unbound.example.com',
      domain: 'unbound.example.com',
    });
    await scheduleGoogleSiteAutoMatch(
      reconnectingAccount,
      String(reconnectingUnbound.site._id),
    );
    expect((await Site.findById(reconnectingUnbound.site._id))?.googleAutoMatch)
      .toMatchObject({
        gscStatus: 'needs_reconnect',
        ga4Status: 'needs_reconnect',
      });
  });

  it('enqueues a fresh request and reports enqueue failures without throwing', async () => {
    const accountId = objectId();
    await connect(accountId, false);
    const successful = await seedSite(accountId);
    const add = vi.fn(async () => undefined);
    setGscSyncQueue({ add } as never);

    const requestId = await scheduleGoogleSiteAutoMatch(
      accountId,
      String(successful.site._id),
    );
    expect(requestId).toMatch(/[0-9a-f-]{36}/u);
    expect(add).toHaveBeenCalledWith(
      'google-site-auto-match',
      {
        accountId,
        siteId: String(successful.site._id),
        requestId,
      },
      expect.objectContaining({ attempts: 3 }),
    );

    const failed = await seedSite(accountId, {
      url: 'https://failed.example.com',
      domain: 'failed.example.com',
    });
    const warn = vi.fn();
    setGscSyncQueue({
      add: async () => {
        throw new Error('redis down');
      },
    } as never);
    await expect(
      scheduleGoogleSiteAutoMatch(
        accountId,
        String(failed.site._id),
        { warn } as unknown as Logger,
      ),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        siteId: String(failed.site._id),
      }),
      'google site auto-match enqueue failed',
    );
    expect((await Site.findById(failed.site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'unavailable',
      ga4Status: 'scope_missing',
      failureClass: 'queue_unavailable',
    });

    const ga4Account = objectId();
    await connect(ga4Account);
    const bound = await seedSite(ga4Account, {
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/manual',
    });
    const unbound = await seedSite(ga4Account, {
      url: 'https://unbound.example.com',
      domain: 'unbound.example.com',
    });
    for (const target of [bound, unbound]) {
      await scheduleGoogleSiteAutoMatch(
        ga4Account,
        String(target.site._id),
        { warn } as unknown as Logger,
      );
    }
    expect((await Site.findById(bound.site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'bound',
      ga4Status: 'bound',
    });
    expect((await Site.findById(unbound.site._id))?.googleAutoMatch).toMatchObject({
      gscStatus: 'unavailable',
      ga4Status: 'unavailable',
    });
  });

  it('swallows unexpected scheduling failures at the Site-creation boundary', async () => {
    const warn = vi.fn();
    await expect(
      scheduleGoogleSiteAutoMatch(objectId(), 'not-an-object-id', {
        warn,
      } as unknown as Logger),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'not-an-object-id' }),
      'google site auto-match scheduling failed',
    );
  });
});
