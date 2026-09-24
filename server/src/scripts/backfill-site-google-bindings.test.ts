import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleConnection } from '../modules/google-connections/google-connection.model.js';
import { Site } from '../modules/sites/sites.model.js';
import type { Ga4Provider } from '../shared/providers/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../shared/testing/mongo.js';
import { backfillSiteGoogleBindings } from './backfill-site-google-bindings.js';
import { runBackfillSiteGoogleBindingsCli } from './run-backfill-site-google-bindings.js';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  vi.restoreAllMocks();
});

const encryptedRefreshToken = {
  ciphertext: 'ciphertext',
  iv: 'initial-vector',
  authTag: 'authentication-tag',
  keyVersion: 1,
};

async function seedLegacyConnection(
  accountId: mongoose.Types.ObjectId,
  input: {
    propertyUrl?: string;
    ga4PropertyId?: string;
    ga4PropertyDisplayName?: string;
    status?: 'connected' | 'needs_reconnect';
  },
): Promise<void> {
  const now = new Date('2026-08-20T00:00:00.000Z');
  await GoogleConnection.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    accountId,
    googleAccountEmail: 'owner@example.com',
    encryptedRefreshToken,
    scopes: [],
    status: input.status ?? 'connected',
    propertyUrl: input.propertyUrl ?? null,
    ga4PropertyId: input.ga4PropertyId ?? null,
    ga4PropertyDisplayName: input.ga4PropertyDisplayName ?? null,
    connectedAt: now,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSite(
  accountId: mongoose.Types.ObjectId,
  domain: string,
  extra: Record<string, unknown> = {},
) {
  return Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    displayName: domain,
    ...extra,
  });
}

function ga4Provider(streamUri = 'https://example.com'): Ga4Provider {
  return {
    async listProperties() {
      return [];
    },
    async listWebDataStreams(_connection, propertyId) {
      return [
        {
          streamId: `${propertyId}/dataStreams/1`,
          displayName: 'Web',
          defaultUri: streamUri,
        },
      ];
    },
    async runReport() {
      return {
        rows: [],
        rowCount: 0,
        startDate: '2026-08-01',
        endDate: '2026-08-19',
        dimensions: [],
        metrics: [],
      };
    },
  };
}

describe('backfillSiteGoogleBindings', () => {
  it('returns zero counts for an already-current database', async () => {
    await expect(
      backfillSiteGoogleBindings({
        siteModel: Site,
        connectionModel: GoogleConnection,
      }),
    ).resolves.toEqual({
      normalizedSiteBindings: 0,
      migratedGscBindings: 0,
      migratedGa4Bindings: 0,
      removedGlobalGscSelections: 0,
      removedGlobalGa4Selections: 0,
      queuedSites: 0,
      ga4AccountsDeferred: 0,
    });
  });

  it('normalizes legacy Site metadata without changing an existing resource pick', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const legacy = await seedSite(accountId, 'legacy.example', {
      gscPropertyUrl: 'sc-domain:legacy.example',
      ga4PropertyId: 'properties/1',
      ga4PropertyDisplayName: 'Legacy analytics',
    });
    await seedSite(accountId, 'settled.example', {
      gscPropertyUrl: 'sc-domain:settled.example',
      gscBindingGenerationId: 'manual-generation',
      gscBindingSource: 'manual',
      ga4PropertyId: 'properties/2',
      ga4BindingGenerationId: 'manual-generation',
      ga4BindingSource: 'manual',
      googleAutoMatch: { gscStatus: 'bound', ga4Status: 'bound' },
    });

    const result = await backfillSiteGoogleBindings({
      siteModel: Site,
      connectionModel: GoogleConnection,
    });

    expect(result.normalizedSiteBindings).toBe(1);
    const reloaded = await Site.findById(legacy._id);
    expect(reloaded).toMatchObject({
      gscPropertyUrl: 'sc-domain:legacy.example',
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
      ga4PropertyId: 'properties/1',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    expect(reloaded?.googleAutoMatch).toMatchObject({
      gscStatus: 'bound',
      ga4Status: 'bound',
    });
  });

  it('leaves complete binding metadata unchanged', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await seedSite(accountId, 'complete.example', {
      gscPropertyUrl: 'sc-domain:complete.example',
      gscBindingGenerationId: 'generation',
      gscBindingSource: 'manual',
      ga4PropertyId: 'properties/complete',
      ga4BindingGenerationId: 'generation',
      ga4BindingSource: 'manual',
      googleAutoMatch: { gscStatus: 'bound', ga4Status: 'bound' },
    });
    await seedSite(accountId, 'ga4-only.example', {
      ga4PropertyId: 'properties/ga4-only',
      ga4BindingGenerationId: 'generation',
      ga4BindingSource: 'manual',
      googleAutoMatch: { gscStatus: 'unbound', ga4Status: 'bound' },
    });

    await expect(backfillSiteGoogleBindings({
      siteModel: Site,
      connectionModel: GoogleConnection,
    })).resolves.toMatchObject({ normalizedSiteBindings: 0 });
  });

  it('ignores unsafe matches and queue jobs without ids', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const site = await seedSite(accountId, 'target.example');
    await seedLegacyConnection(accountId, {
      propertyUrl: 'sc-domain:other.example',
      ga4PropertyId: 'properties/no-match',
    });
    const scheduleSiteMatch = vi.fn(async () => null);

    const result = await backfillSiteGoogleBindings({
      siteModel: Site,
      connectionModel: GoogleConnection,
      ga4Provider: ga4Provider('https://other.example'),
      resolveAccessToken: async () => ({ accessToken: 'redacted' }),
      scheduleSiteMatch,
    });

    expect(result).toMatchObject({
      migratedGscBindings: 0,
      migratedGa4Bindings: 0,
      queuedSites: 0,
    });
    expect(await Site.findById(site._id)).toMatchObject({
      gscPropertyUrl: null,
      ga4PropertyId: null,
    });
  });

  it('migrates only safe matches, preserves Site picks, queues Sites, and is idempotent', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const exact = await seedSite(accountId, 'example.com');
    const child = await seedSite(accountId, 'shop.example.com');
    const settled = await seedSite(accountId, 'settled.example', {
      gscPropertyUrl: 'sc-domain:settled.example',
      gscBindingGenerationId: 'manual-generation',
      gscBindingSource: 'manual',
      ga4PropertyId: 'properties/settled',
      ga4BindingGenerationId: 'manual-generation',
      ga4BindingSource: 'manual',
      googleAutoMatch: { gscStatus: 'bound', ga4Status: 'bound' },
    });
    await seedSite(accountId, 'deleted.example', {
      deletionStartedAt: new Date('2026-08-19T00:00:00.000Z'),
    });
    await seedLegacyConnection(accountId, {
      propertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/100',
      ga4PropertyDisplayName: 'Example analytics',
    });

    const gscOnlyAccount = new mongoose.Types.ObjectId();
    await seedLegacyConnection(gscOnlyAccount, {
      propertyUrl: 'sc-domain:no-sites.example',
    });

    const scheduleSiteMatch = vi.fn(async (_accountId: string, siteId: string) => {
      if (siteId === String(child._id)) throw new Error('redis unavailable');
      return randomUUID();
    });
    const warn = vi.fn();
    const result = await backfillSiteGoogleBindings({
      siteModel: Site,
      connectionModel: GoogleConnection,
      ga4Provider: ga4Provider(),
      resolveAccessToken: async () => ({ accessToken: 'redacted' }),
      scheduleSiteMatch,
      logger: { warn } as unknown as Logger,
    });

    expect(result).toEqual({
      normalizedSiteBindings: 0,
      migratedGscBindings: 2,
      migratedGa4Bindings: 1,
      removedGlobalGscSelections: 2,
      removedGlobalGa4Selections: 1,
      queuedSites: 2,
      ga4AccountsDeferred: 0,
    });
    expect(await Site.findById(exact._id)).toMatchObject({
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
      ga4PropertyId: 'properties/100',
      ga4PropertyDisplayName: 'Example analytics',
      ga4MatchedWebStreamUri: 'https://example.com',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    expect(await Site.findById(child._id)).toMatchObject({
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: null,
    });
    expect(await Site.findById(settled._id)).toMatchObject({
      gscPropertyUrl: 'sc-domain:settled.example',
      ga4PropertyId: 'properties/settled',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(accountId), siteId: String(child._id) }),
      'site Google binding backfill could not schedule auto-match',
    );
    expect(
      await GoogleConnection.collection.countDocuments({
        $or: [
          { propertyUrl: { $type: 'string', $ne: '' } },
          { ga4PropertyId: { $type: 'string', $ne: '' } },
        ],
      }),
    ).toBe(0);

    scheduleSiteMatch.mockClear();
    await expect(
      backfillSiteGoogleBindings({
        siteModel: Site,
        connectionModel: GoogleConnection,
        scheduleSiteMatch,
      }),
    ).resolves.toEqual({
      normalizedSiteBindings: 0,
      migratedGscBindings: 0,
      migratedGa4Bindings: 0,
      removedGlobalGscSelections: 0,
      removedGlobalGa4Selections: 0,
      queuedSites: 0,
      ga4AccountsDeferred: 0,
    });
    expect(scheduleSiteMatch).not.toHaveBeenCalled();
  });

  it('retains a GA4 selection when safe matching must be deferred', async () => {
    const disconnectedAccount = new mongoose.Types.ObjectId();
    await seedSite(disconnectedAccount, 'reconnect.example');
    await seedLegacyConnection(disconnectedAccount, {
      ga4PropertyId: 'properties/200',
      status: 'needs_reconnect',
    });

    const failingAccount = new mongoose.Types.ObjectId();
    await seedSite(failingAccount, 'failure.example');
    await seedLegacyConnection(failingAccount, {
      ga4PropertyId: 'properties/201',
    });
    const warn = vi.fn();
    const provider = ga4Provider();
    const listWebDataStreams = vi.spyOn(provider, 'listWebDataStreams');

    const result = await backfillSiteGoogleBindings({
      siteModel: Site,
      connectionModel: GoogleConnection,
      ga4Provider: provider,
      resolveAccessToken: async (accountId) => {
        if (accountId === String(failingAccount)) throw new Error('token unavailable');
        return { accessToken: 'redacted' };
      },
      logger: { warn } as unknown as Logger,
    });

    expect(result.ga4AccountsDeferred).toBe(2);
    expect(result.removedGlobalGa4Selections).toBe(0);
    expect(listWebDataStreams).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(failingAccount) }),
      'site Google binding backfill deferred GA4 selection',
    );
    expect(
      await GoogleConnection.collection.countDocuments({
        ga4PropertyId: { $type: 'string', $ne: '' },
      }),
    ).toBe(2);
  });

  it('defers GA4 when the provider seam is intentionally unavailable', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await seedLegacyConnection(accountId, { ga4PropertyId: 'properties/300' });

    const result = await backfillSiteGoogleBindings({
      siteModel: Site,
      connectionModel: GoogleConnection,
    });

    expect(result.ga4AccountsDeferred).toBe(1);
    expect(result.removedGlobalGa4Selections).toBe(0);
  });
});

describe('runBackfillSiteGoogleBindingsCli', () => {
  function stubMongoose() {
    return {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };
  }

  it('connects, runs against production models, logs counts, and disconnects', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const site = await seedSite(accountId, 'cli.example', {
      gscPropertyUrl: 'sc-domain:cli.example',
    });
    const stub = stubMongoose();
    const info = vi.fn();

    const result = await runBackfillSiteGoogleBindingsCli({
      mongoose: stub as never,
      mongoUri: 'mongodb://ignored',
      logger: { info } as unknown as Logger,
    });

    expect(result.normalizedSiteBindings).toBe(1);
    expect(stub.connect).toHaveBeenCalledWith('mongodb://ignored');
    expect(stub.disconnect).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      result,
      'site Google binding backfill complete',
    );
    expect(await Site.findById(site._id)).toMatchObject({
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
  });

  it('disconnects when the backfill fails', async () => {
    const stub = stubMongoose();
    vi.spyOn(Site, 'find').mockImplementationOnce((() => {
      throw new Error('mongo read failed');
    }) as never);

    await expect(
      runBackfillSiteGoogleBindingsCli({
        mongoose: stub as never,
        mongoUri: 'mongodb://ignored',
        logger: { info: vi.fn() } as unknown as Logger,
      }),
    ).rejects.toThrow('mongo read failed');
    expect(stub.disconnect).toHaveBeenCalledOnce();
  });

  it('forwards every optional production dependency', async () => {
    const stub = stubMongoose();
    const resolveToken = vi.fn(async () => ({ accessToken: 'redacted' }));
    const scheduleSiteMatch = vi.fn(async () => null);

    await runBackfillSiteGoogleBindingsCli({
      mongoose: stub as never,
      mongoUri: 'mongodb://ignored',
      ga4Provider: ga4Provider(),
      resolveAccessToken: resolveToken,
      scheduleSiteMatch,
      logger: { info: vi.fn() } as unknown as Logger,
    });

    expect(stub.disconnect).toHaveBeenCalledOnce();
  });
});
