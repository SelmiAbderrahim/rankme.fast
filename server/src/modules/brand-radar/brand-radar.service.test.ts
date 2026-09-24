/**
 * Spec 07a-1 — Brand Radar service unit tests.
 *
 * Covers the trend-series key (`normalizeBrandQuery` / `brandQueryHash`),
 * `priorScanId` linkage, the cursor codec, the create-then-enqueue failure
 * paths, and the community `previewSpend` shape.
 */
import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import { BrandRadarScan } from './brand-radar.model.js';
import {
  assertBrandRadarEnabled,
  brandQueryHash,
  createScan as createScanImpl,
  decodeBrandRadarCursor,
  encodeBrandRadarCursor,
  findPriorScanId,
  getScan,
  listScans,
  normalizeBrandQuery,
  previewSpend,
} from './brand-radar.service.js';

function createScan(
  accountId: Parameters<typeof createScanImpl>[0],
  siteId: Parameters<typeof createScanImpl>[1],
  input: Omit<Parameters<typeof createScanImpl>[2], 'outputLocale'> & {
    outputLocale?: Parameters<typeof createScanImpl>[2]['outputLocale'];
  },
  deps: Parameters<typeof createScanImpl>[3],
) {
  return createScanImpl(
    accountId,
    siteId,
    { ...input, outputLocale: input.outputLocale ?? 'en' },
    deps,
  );
}

let queue: Queue;
let queueAdd: ReturnType<typeof vi.fn>;

function accountId(): string {
  return new mongoose.Types.ObjectId().toString();
}

/**
 * Every scan is site-scoped (rankme-site-scoping 01), so each account under
 * test owns at least one site.
 */
async function seedSite(
  id: string,
  domain = 'example.com',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(id),
    url: `https://${domain}`,
    domain,
    ...extra,
  });
  return String(site._id);
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = true;
  queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
  queue = { add: queueAdd } as unknown as Queue;
});

describe('trend series key', () => {
  it('normalizes case, NFKC form, and internal whitespace runs', () => {
    expect(normalizeBrandQuery('  Acme   Corp  ')).toBe('acme corp');
    expect(normalizeBrandQuery('ACME\tCorp')).toBe('acme corp');
    // U+FF21 FULLWIDTH LATIN CAPITAL A folds to "A" under NFKC.
    expect(normalizeBrandQuery('Ａcme Corp')).toBe('acme corp');
  });

  it('hashes equal normalized queries to the same 64-hex digest', () => {
    const a = brandQueryHash('  Acme   Corp ');
    const b = brandQueryHash('acme corp');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(brandQueryHash('other brand')).not.toBe(a);
    expect(brandQueryHash('acme corp', 'en', 'US')).not.toBe(
      brandQueryHash('acme corp', 'en', 'FR'),
    );
  });
});

describe('kill switch', () => {
  it('throws 503 when BRAND_RADAR_ENABLED is false', () => {
    (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
    try {
      assertBrandRadarEnabled();
      expect.unreachable('expected a 503');
    } catch (error) {
      const err = error as { status: number; message: string };
      expect(err.status).toBe(503);
      expect(err.message).toBe('brandRadar.errors.productUnavailable');
    }
  });
});

describe('createScan', () => {
  it('links no prior scan on the first run and enqueues', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const result = await createScan(id, siteId, { brandQuery: 'Acme Corp' }, { queue });

    expect(result).toMatchObject({
      status: 'queued',
      priorScanId: null,
      queryHash: brandQueryHash('Acme Corp'),
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0]?.[2]).toMatchObject({
      jobId: `brand-radar-${result.scanId}`,
    });
    expect(result).not.toHaveProperty('reservedUnits');
  });

  it('links priorScanId to the newest settled scan for the same normalized query', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const first = await createScan(id, siteId, { brandQuery: 'Acme Corp' }, { queue });
    // A still-queued scan is NOT a trend anchor.
    expect(
      await findPriorScanId(id, siteId, brandQueryHash('Acme Corp')),
    ).toBeNull();

    await BrandRadarScan.updateOne(
      { _id: first.scanId },
      { $set: { status: 'completed' } },
    );
    const second = await createScan(
      id,
      siteId,
      { brandQuery: '  acme   CORP ' },
      { queue },
    );
    expect(second.priorScanId).toBe(first.scanId);

    // A different query starts its own series.
    const other = await createScan(id, siteId, { brandQuery: 'Other Brand' }, { queue });
    expect(other.priorScanId).toBeNull();
  });

  it('never links a baseline from a sibling site of the same account', async () => {
    const id = accountId();
    const siteA = await seedSite(id, 'a.example');
    const siteB = await seedSite(id, 'b.example');
    const onA = await createScan(id, siteA, { brandQuery: 'Acme Corp' }, { queue });
    await BrandRadarScan.updateOne(
      { _id: onA.scanId },
      { $set: { status: 'completed' } },
    );

    // Same account, same normalized query, different site → separate series.
    const onB = await createScan(id, siteB, { brandQuery: 'acme corp' }, { queue });
    expect(onB.priorScanId).toBeNull();
    expect(await findPriorScanId(id, siteB, brandQueryHash('Acme Corp'))).toBeNull();
    expect(String(await findPriorScanId(id, siteA, brandQueryHash('Acme Corp')))).toBe(
      onA.scanId,
    );
  });

  it('does not link a settled scan belonging to another account', async () => {
    const mine = accountId();
    const theirs = accountId();
    const theirSite = await seedSite(theirs, 'theirs.example');
    const mySite = await seedSite(mine, 'mine.example');
    const foreign = await createScan(
      theirs,
      theirSite,
      { brandQuery: 'Acme Corp' },
      { queue },
    );
    await BrandRadarScan.updateOne(
      { _id: foreign.scanId },
      { $set: { status: 'completed' } },
    );
    const own = await createScan(mine, mySite, { brandQuery: 'Acme Corp' }, { queue });
    expect(own.priorScanId).toBeNull();
  });

  it('stores the owning site, language, and location and refuses a foreign site', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const created = await createScan(
      id,
      siteId,
      { brandQuery: 'Acme', language: 'fr', locationCode: 2250 },
      { queue },
    );
    const stored = await BrandRadarScan.findById(created.scanId);
    expect(stored).toMatchObject({ language: 'fr', countryCode: 'FR', locationCode: 2250 });
    expect(String(stored?.siteId)).toBe(siteId);

    const unknownLocation = await createScan(
      id,
      siteId,
      { brandQuery: 'Unknown Market', locationCode: 999_999 },
      { queue },
    );
    expect(await BrandRadarScan.findById(unknownLocation.scanId)).toMatchObject({
      countryCode: null,
      locationCode: 999_999,
    });

    const stranger = accountId();
    await expect(
      createScan(stranger, siteId, { brandQuery: 'Acme' }, { queue }),
    ).rejects.toMatchObject({ status: 404, message: 'brandRadar.errors.notFound' });
    // Malformed id is the SAME miss — no existence oracle.
    await expect(
      createScan(stranger, 'not-an-id', { brandQuery: 'Acme' }, { queue }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a paused site and a site that is being deleted', async () => {
    const id = accountId();
    const paused = await seedSite(id, 'paused.example', {
      paused: true,
      pausedAt: new Date(),
    });
    await expect(
      createScan(id, paused, { brandQuery: 'Acme' }, { queue }),
    ).rejects.toMatchObject({ status: 409 });

    const deleting = await seedSite(id, 'deleting.example', {
      deletionStartedAt: new Date(),
    });
    await expect(
      createScan(id, deleting, { brandQuery: 'Acme' }, { queue }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 503 without writing a scan when the queue is not wired', async () => {
    const id = accountId();
    await expect(
      createScan(id, await seedSite(id), { brandQuery: 'Acme' }, { queue: null }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await BrandRadarScan.countDocuments({})).toBe(0);
  });

  it('propagates a scan document write failure without enqueueing', async () => {
    const id = accountId();
    const create = vi
      .spyOn(BrandRadarScan, 'create')
      .mockRejectedValueOnce(new Error('mongo down'));
    await expect(
      createScan(id, await seedSite(id), { brandQuery: 'Acme' }, { queue }),
    ).rejects.toThrow('mongo down');
    expect(queueAdd).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('fails the scan when the enqueue throws', async () => {
    const id = accountId();
    const brokenQueue = {
      add: vi.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Queue;
    await expect(
      createScan(id, await seedSite(id), { brandQuery: 'Acme' }, { queue: brokenQueue }),
    ).rejects.toMatchObject({ status: 503 });

    const stored = await BrandRadarScan.findOne({ accountId: id });
    expect(stored?.status).toBe('failed');
    expect(stored?.terminalAt).toBeInstanceOf(Date);
  });

  it('honours an injected clock for the terminal timestamp', async () => {
    const id = accountId();
    const frozen = new Date('2026-07-25T10:00:00.000Z');
    const brokenQueue = {
      add: vi.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Queue;
    await expect(
      createScan(id, await seedSite(id), { brandQuery: 'Acme' }, {
        queue: brokenQueue,
        now: () => frozen,
      }),
    ).rejects.toMatchObject({ status: 503 });
    const stored = await BrandRadarScan.findOne({ accountId: id });
    expect(stored?.terminalAt?.toISOString()).toBe(frozen.toISOString());
  });
});

describe('list + detail', () => {
  it('pages newest-first and round-trips the cursor', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const created: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const scan = await createScan(
        id,
        siteId,
        { brandQuery: `Brand ${index}` },
        { queue },
      );
      created.push(scan.scanId);
    }
    const first = await listScans(id, siteId, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items[0]?.id).toBe(created[2]);

    const second = await listScans(id, siteId, { limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).toBe(created[0]);
    expect(second.nextCursor).toBeNull();
  });

  it('never lists or reads another account row', async () => {
    const mine = accountId();
    const theirs = accountId();
    const theirSite = await seedSite(theirs, 'theirs.example');
    const foreign = await createScan(theirs, theirSite, { brandQuery: 'Acme' }, { queue });
    // Their site id is not mine — the list read 404s rather than leaking.
    await expect(listScans(mine, theirSite, { limit: 20 })).rejects.toMatchObject({
      status: 404,
    });
    await expect(getScan(mine, foreign.scanId)).rejects.toMatchObject({
      status: 404,
      message: 'brandRadar.errors.notFound',
    });
  });

  it('lists only the requested site of the account', async () => {
    const id = accountId();
    const siteA = await seedSite(id, 'a.example');
    const siteB = await seedSite(id, 'b.example');
    const onA = await createScan(id, siteA, { brandQuery: 'Acme' }, { queue });
    await createScan(id, siteB, { brandQuery: 'Zeta' }, { queue });

    const listed = await listScans(id, siteA, { limit: 20 });
    expect(listed.items.map((row) => row.id)).toEqual([onA.scanId]);
    expect(listed.items[0]?.siteId).toBe(siteA);
  });

  it('serializes a settled scan', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const created = await createScan(id, siteId, { brandQuery: 'Acme' }, { queue });
    await BrandRadarScan.updateOne(
      { _id: created.scanId },
      {
        $set: {
          status: 'completed_partial',
          digestState: 'digest_absent',
          retainedRowCount: 7,
          terminalAt: new Date('2026-07-25T11:00:00.000Z'),
        },
      },
    );
    const detail = await getScan(id, created.scanId);
    expect(detail).toMatchObject({
      status: 'completed_partial',
      digestState: 'digest_absent',
      retainedRowCount: 7,
      terminalAt: '2026-07-25T11:00:00.000Z',
      language: null,
      locationCode: null,
      siteId,
      outputLocale: 'en',
    });
  });

  it('reads a settled pre-change digest as English without rewriting it', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const created = await createScan(id, siteId, { brandQuery: 'Legacy' }, { queue });
    await BrandRadarScan.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(created.scanId) },
      {
        $unset: { outputLocale: 1 },
        $set: { status: 'completed', digestState: 'digest_present' },
      },
    );

    const detail = await getScan(id, created.scanId);
    expect(detail.outputLocale).toBe('en');
    expect((await BrandRadarScan.findById(created.scanId).lean())?.outputLocale).toBeUndefined();
  });

  it('does not invent a locale for a legacy scan that retained no digest prose', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    const created = await createScan(id, siteId, { brandQuery: 'Legacy empty' }, { queue });
    await BrandRadarScan.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(created.scanId) },
      {
        $unset: { outputLocale: 1 },
        $set: { status: 'completed_empty', digestState: 'digest_absent' },
      },
    );

    expect((await getScan(id, created.scanId)).outputLocale).toBeNull();
  });

  it('rejects a malformed cursor', () => {
    expect(encodeBrandRadarCursor({ createdAt: 'x', id: 'y' })).toBeTypeOf('string');
    expect(() => decodeBrandRadarCursor('%%%not-base64%%%')).toThrow(
      'brandRadar.errors.invalidCursor',
    );
    expect(() =>
      decodeBrandRadarCursor(Buffer.from('{"createdAt":1}').toString('base64url')),
    ).toThrow('brandRadar.errors.invalidCursor');
    expect(() =>
      decodeBrandRadarCursor(
        Buffer.from(JSON.stringify({ createdAt: 'nope', id: 'a'.repeat(24) })).toString(
          'base64url',
        ),
      ),
    ).toThrow('brandRadar.errors.invalidCursor');
    expect(() =>
      decodeBrandRadarCursor(
        Buffer.from(
          JSON.stringify({ createdAt: new Date().toISOString(), id: 'bad' }),
        ).toString('base64url'),
      ),
    ).toThrow('brandRadar.errors.invalidCursor');
    expect(() => decodeBrandRadarCursor(Buffer.from('null').toString('base64url'))).toThrow(
      'brandRadar.errors.invalidCursor',
    );
  });
});

describe('previewSpend', () => {
  it('returns the community preview shape with no capacity arithmetic', async () => {
    const id = accountId();
    const preview = await previewSpend(id, await seedSite(id, 'community.example'));
    expect(preview).toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
    });
  });

  it('refuses when the kill switch is off', async () => {
    const id = accountId();
    const siteId = await seedSite(id);
    (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
    await expect(previewSpend(id, siteId)).rejects.toMatchObject({ status: 503 });
  });

  it('refuses a foreign or paused site before it reveals anything', async () => {
    const owner = accountId();
    const stranger = accountId();
    const siteId = await seedSite(owner);
    await expect(previewSpend(stranger, siteId)).rejects.toMatchObject({
      status: 404,
      message: 'brandRadar.errors.notFound',
    });
    const paused = await seedSite(owner, 'paused-preview.example', {
      paused: true,
      pausedAt: new Date(),
    });
    await expect(previewSpend(owner, paused)).rejects.toMatchObject({ status: 409 });
  });
});
