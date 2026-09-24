import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { brandRadarEvents } from '../db/schema/brand-radar-events.js';
import { BrandRadarScan } from '../modules/brand-radar/brand-radar.model.js';
import {
  BrandRadarMention,
  BrandRadarMentionSummary,
} from '../modules/brand-radar/brand-radar.rows.model.js';
import { Site } from '../modules/sites/sites.model.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../shared/testing/postgres.js';
import { backfillBrandRadarSite } from './backfill-brand-radar-site.js';
import { runBackfillBrandRadarSiteCli } from './run-backfill-brand-radar-site.js';

const asDb = (): Db => getTestDb() as unknown as Db;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

function deps() {
  return {
    db: asDb(),
    scanModel: BrandRadarScan,
    mentionModel: BrandRadarMention,
    mentionSummaryModel: BrandRadarMentionSummary,
    siteModel: Site,
  };
}

async function seedSite(
  accountId: mongoose.Types.ObjectId,
  domain: string,
  createdAt: Date,
  extra: Record<string, unknown> = {},
): Promise<mongoose.Types.ObjectId> {
  const id = new mongoose.Types.ObjectId();
  await Site.collection.insertOne({
    _id: id,
    accountId,
    url: `https://${domain}`,
    domain,
    displayName: '',
    paused: false,
    deletionStartedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });
  return id;
}

/**
 * Legacy scans are written through the raw collection so the fixture models
 * the pre-backfill world: `siteId: null` is what the shipped API produced and
 * what the (now required) Mongoose validation would reject.
 */
async function seedLegacyScan(
  accountId: mongoose.Types.ObjectId,
  brandQuery: string,
): Promise<mongoose.Types.ObjectId> {
  const id = new mongoose.Types.ObjectId();
  await BrandRadarScan.collection.insertOne({
    _id: id,
    accountId,
    siteId: null,
    brandQuery,
    language: null,
    locationCode: null,
    status: 'completed',
    digestState: 'digest_absent',
    queryHash: 'a'.repeat(64),
    priorScanId: null,
    retainedRowCount: 0,
    retainedRowIds: [],
    mentionSummaryId: null,
    mentionCount: 0,
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
    topDomains: [],
    trendVsPrevious: null,
    digestSentences: [],
    refund: { issued: false, unit: 1 },
    halt: null,
    terminalAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function seedScanGraph(
  accountId: mongoose.Types.ObjectId,
  scanId: mongoose.Types.ObjectId,
): Promise<void> {
  await BrandRadarMention.collection.insertMany([
    {
      _id: new mongoose.Types.ObjectId(),
      accountId,
      scanId,
      url: 'https://example.com/a',
      domain: 'example.com',
      title: '',
      snippet: '',
      polarity: 'neutral',
      confidence: null,
      language: null,
      observedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      accountId,
      scanId,
      url: 'https://example.com/b',
      domain: 'example.com',
      title: '',
      snippet: '',
      polarity: 'neutral',
      confidence: null,
      language: null,
      observedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await BrandRadarMentionSummary.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    accountId,
    scanId,
    totalMentions: 2,
    distribution: { positive: 0, neutral: 2, negative: 0 },
    topDomains: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await asDb()
    .insert(brandRadarEvents)
    .values({
      accountId: String(accountId),
      scanId: String(scanId),
      stage: 'scan',
      event: 'started',
      costMicros: 0,
      metadata: {},
    });
}

describe('backfillBrandRadarSite', () => {
  it('reports all-zero counts when nothing is legacy', async () => {
    expect(await backfillBrandRadarSite(deps())).toEqual({
      assignedScans: 0,
      purgedScans: 0,
      purgedMentionRows: 0,
      purgedSummaryRows: 0,
      purgedEventRows: 0,
      accountsAssigned: 0,
      accountsPurged: 0,
    });
  });

  it('assigns an account with one live site', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const siteId = await seedSite(accountId, 'only.example', new Date('2026-01-01'));
    const scanId = await seedLegacyScan(accountId, 'acme');

    const result = await backfillBrandRadarSite(deps());

    expect(result.assignedScans).toBe(1);
    expect(result.accountsAssigned).toBe(1);
    expect(result.purgedScans).toBe(0);
    const scan = await BrandRadarScan.collection.findOne({ _id: scanId });
    expect(String(scan?.siteId)).toBe(String(siteId));
  });

  it('assigns every legacy scan of an account to its OLDEST live site', async () => {
    const accountId = new mongoose.Types.ObjectId();
    // Insert newest first so the result cannot come from insertion order.
    await seedSite(accountId, 'new.example', new Date('2026-05-01'));
    const oldest = await seedSite(accountId, 'old.example', new Date('2024-02-02'));
    await seedSite(accountId, 'mid.example', new Date('2025-03-03'));
    const first = await seedLegacyScan(accountId, 'acme');
    const second = await seedLegacyScan(accountId, 'acme rival');

    const result = await backfillBrandRadarSite(deps());

    expect(result).toMatchObject({ assignedScans: 2, accountsAssigned: 1 });
    for (const id of [first, second]) {
      const scan = await BrandRadarScan.collection.findOne({ _id: id });
      expect(String(scan?.siteId)).toBe(String(oldest));
    }
  });

  it('treats a paused site as live and a deleting site as gone', async () => {
    const accountId = new mongoose.Types.ObjectId();
    // Oldest overall, but mid-deletion → skipped.
    await seedSite(accountId, 'dying.example', new Date('2023-01-01'), {
      deletionStartedAt: new Date('2026-01-01'),
    });
    const paused = await seedSite(accountId, 'paused.example', new Date('2024-01-01'), {
      paused: true,
      pausedAt: new Date('2026-01-01'),
    });
    const scanId = await seedLegacyScan(accountId, 'acme');

    await backfillBrandRadarSite(deps());

    const scan = await BrandRadarScan.collection.findOne({ _id: scanId });
    expect(String(scan?.siteId)).toBe(String(paused));
  });

  it('purges the whole scan graph for an account with zero live sites', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await seedSite(accountId, 'gone.example', new Date('2024-01-01'), {
      deletionStartedAt: new Date('2026-01-01'),
    });
    const scanId = await seedLegacyScan(accountId, 'acme');
    await seedScanGraph(accountId, scanId);

    const result = await backfillBrandRadarSite(deps());

    expect(result).toEqual({
      assignedScans: 0,
      purgedScans: 1,
      purgedMentionRows: 2,
      purgedSummaryRows: 1,
      purgedEventRows: 1,
      accountsAssigned: 0,
      accountsPurged: 1,
    });
    expect(await BrandRadarScan.collection.countDocuments({})).toBe(0);
    expect(await BrandRadarMention.collection.countDocuments({})).toBe(0);
    expect(await BrandRadarMentionSummary.collection.countDocuments({})).toBe(0);
    expect(await asDb().select().from(brandRadarEvents)).toHaveLength(0);
  });

  it('handles a mixed population and is idempotent on a second run', async () => {
    const keeper = new mongoose.Types.ObjectId();
    const orphan = new mongoose.Types.ObjectId();
    const siteId = await seedSite(keeper, 'keeper.example', new Date('2024-01-01'));
    await seedLegacyScan(keeper, 'keeper brand');
    const orphanScan = await seedLegacyScan(orphan, 'orphan brand');
    await seedScanGraph(orphan, orphanScan);
    // A scan another site already owns must never be touched by either pass.
    const settled = new mongoose.Types.ObjectId();
    await BrandRadarScan.collection.insertOne({
      ...(await BrandRadarScan.collection.findOne({ accountId: keeper }))!,
      _id: settled,
      siteId,
    });

    const first = await backfillBrandRadarSite(deps());
    expect(first).toEqual({
      assignedScans: 1,
      purgedScans: 1,
      purgedMentionRows: 2,
      purgedSummaryRows: 1,
      purgedEventRows: 1,
      accountsAssigned: 1,
      accountsPurged: 1,
    });

    const second = await backfillBrandRadarSite(deps());
    expect(second).toEqual({
      assignedScans: 0,
      purgedScans: 0,
      purgedMentionRows: 0,
      purgedSummaryRows: 0,
      purgedEventRows: 0,
      accountsAssigned: 0,
      accountsPurged: 0,
    });
    expect(await BrandRadarScan.collection.countDocuments({ siteId: null })).toBe(0);
    expect(await BrandRadarScan.collection.countDocuments({})).toBe(2);
  });
});

describe('runBackfillBrandRadarSiteCli', () => {
  const silentLogger = { info: vi.fn() } as unknown as Logger;

  function stubMongoose() {
    return {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };
  }

  it('connects, backfills through the production models, and tears both handles down', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const siteId = await seedSite(accountId, 'cli.example', new Date('2024-01-01'));
    const scanId = await seedLegacyScan(accountId, 'acme');
    const stub = stubMongoose();
    const closeDb = vi.fn(async () => undefined);

    const result = await runBackfillBrandRadarSiteCli({
      mongoose: stub as never,
      mongoUri: 'mongodb://ignored',
      db: asDb(),
      closeDb,
      logger: silentLogger,
    });

    expect(result).toMatchObject({ assignedScans: 1, accountsAssigned: 1 });
    expect(stub.connect).toHaveBeenCalledWith('mongodb://ignored');
    expect(stub.disconnect).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    const scan = await BrandRadarScan.collection.findOne({ _id: scanId });
    expect(String(scan?.siteId)).toBe(String(siteId));
  });

  it('tears both handles down when the backfill throws', async () => {
    const stub = stubMongoose();
    const closeDb = vi.fn(async () => undefined);
    const distinct = vi
      .spyOn(BrandRadarScan, 'distinct')
      .mockImplementation((() => {
        throw new Error('boom');
      }) as never);

    await expect(
      runBackfillBrandRadarSiteCli({
        mongoose: stub as never,
        mongoUri: 'mongodb://ignored',
        db: asDb(),
        closeDb,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/boom/);

    expect(stub.disconnect).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    distinct.mockRestore();
  });
});
