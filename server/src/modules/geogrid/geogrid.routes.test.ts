/**
 * Geogrid API integration tests (community-requests spec 09 §4.1, §6).
 *
 * Every assertion goes through the router, not the service — the ordering
 * guarantee this suite exists to prove (clamp/own/flag BEFORE any scan row is
 * written) is only real if it holds at the HTTP boundary.
 */
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { geogridScans, geogridSnapshots } from '../../db/schema/geogrid.js';
import { keywords } from '../../db/schema/keywords.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
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
import { setGeogridDb, setGeogridQueue } from './geogrid.holder.js';

const app = createApp();
let emailSequence = 0;
let queueAdd: ReturnType<typeof vi.fn>;

interface Context {
  user: TestUser;
  siteId: string;
  keywordId: string;
}

const GRID = {
  centerLat: 30.2672,
  centerLng: -97.7431,
  spacingMeters: 1_000,
  gridSize: 3,
  zoom: 17,
} as const;

async function account(): Promise<Context> {
  emailSequence += 1;
  const user = await signupVerifiedUser(app, {
    email: `geogrid-${emailSequence}@example.test`,
  });
  const site = await Site.create({
    accountId: user.id,
    url: `https://geo-${emailSequence}.example`,
    domain: `geo-${emailSequence}.example`,
  });
  const [keyword] = await getTestDb()
    .insert(keywords)
    .values({
      accountId: user.id,
      siteId: String(site._id),
      phrase: 'dentist austin',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine: 'google',
    })
    .returning({ id: keywords.id });
  return { user, siteId: String(site._id), keywordId: keyword!.id };
}

function body(context: Context, overrides: Record<string, unknown> = {}) {
  return { ...GRID, keywordId: context.keywordId, ...overrides };
}

function createScan(context: Context, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/sites/${context.siteId}/geogrid/scans`)
    .set('Cookie', context.user.cookie)
    .send(body(context, overrides));
}

function previewScan(context: Context, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/sites/${context.siteId}/geogrid/preview`)
    .set('Cookie', context.user.cookie)
    .send(body(context, overrides));
}

async function scanCount(accountId: string): Promise<number> {
  const rows = await getTestDb()
    .select()
    .from(geogridScans)
    .where(eq(geogridScans.accountId, accountId));
  return rows.length;
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setGeogridDb(db as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setGeogridDb(null);
  setGeogridQueue(null);
  (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = true;
  queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
  setGeogridQueue({ add: queueAdd } as unknown as Queue);
});

describe('geogrid routes — auth and ownership', () => {
  it('requires authentication on every endpoint', async () => {
    const siteId = new mongoose.Types.ObjectId().toString();
    const scanId = '00000000-0000-4000-8000-000000000000';
    await request(app).post(`/api/sites/${siteId}/geogrid/preview`).send({}).expect(401);
    await request(app).post(`/api/sites/${siteId}/geogrid/scans`).send({}).expect(401);
    await request(app).get(`/api/sites/${siteId}/geogrid/scans`).expect(401);
    await request(app).get(`/api/sites/${siteId}/geogrid/scans/${scanId}`).expect(401);
  });

  it('another account gets 404, never 403', async () => {
    const owner = await account();
    const created = await createScan(owner).expect(202);
    const stranger = await account();
    await request(app)
      .get(`/api/sites/${owner.siteId}/geogrid/scans/${created.body.scanId}`)
      .set('Cookie', stranger.user.cookie)
      .expect(404);
    await request(app)
      .get(`/api/sites/${owner.siteId}/geogrid/scans`)
      .set('Cookie', stranger.user.cookie)
      .expect(404);
    await request(app)
      .post(`/api/sites/${owner.siteId}/geogrid/scans`)
      .set('Cookie', stranger.user.cookie)
      .send(body(owner))
      .expect(404);
  });

  it("a keyword from another site is a 404 and never writes a scan", async () => {
    const owner = await account();
    const other = await account();
    await request(app)
      .post(`/api/sites/${owner.siteId}/geogrid/scans`)
      .set('Cookie', owner.user.cookie)
      .send(body(owner, { keywordId: other.keywordId }))
      .expect(404);
    expect(await scanCount(owner.user.id)).toBe(0);
  });

  it('a malformed site id is a 404', async () => {
    const owner = await account();
    await request(app)
      .get('/api/sites/not-an-object-id/geogrid/scans')
      .set('Cookie', owner.user.cookie)
      .expect(404);
  });

  it('an unknown scan id is a 404', async () => {
    const owner = await account();
    await request(app)
      .get(`/api/sites/${owner.siteId}/geogrid/scans/00000000-0000-4000-8000-0000000000ff`)
      .set('Cookie', owner.user.cookie)
      .expect(404);
  });
});

describe('geogrid routes — bounds are enforced before any scan row', () => {
  it.each([
    ['a 9×9 grid', { gridSize: 9 }],
    ['a 49×49 grid', { gridSize: 49 }],
    ['an even grid', { gridSize: 4 }],
    ['a latitude past the pole guard', { centerLat: 89 }],
    ['a longitude out of range', { centerLng: 181 }],
    ['spacing below the floor', { spacingMeters: 50 }],
    ['spacing above the ceiling', { spacingMeters: 20_000 }],
    ['spacing off the 100 m step', { spacingMeters: 150 }],
    ['zoom below the vendor range', { zoom: 2 }],
    ['zoom above the vendor range', { zoom: 22 }],
    ['a non-uuid keyword id', { keywordId: 'not-a-uuid' }],
  ])('%s is rejected and writes nothing', async (_label, overrides) => {
    const context = await account();
    await createScan(context, overrides).expect(400);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(geogridScans)).toHaveLength(0);
  });

  it('accepts every offered grid size and derives the matching cell count', async () => {
    for (const gridSize of [3, 5, 7]) {
      const context = await account();
      const response = await createScan(context, { gridSize }).expect(202);
      expect(response.body.cellCount).toBe(gridSize * gridSize);
      const rows = await getTestDb()
        .select()
        .from(geogridScans)
        .where(eq(geogridScans.id, response.body.scanId));
      expect(rows[0]).toMatchObject({ totalCells: gridSize * gridSize, status: 'queued' });
    }
  });
});

describe('geogrid routes — create', () => {
  it('writes one scan row and enqueues a colon-free job id', async () => {
    const context = await account();
    const response = await createScan(context).expect(202);
    expect(response.body).toEqual({
      scanId: expect.any(String),
      status: 'queued',
      cellCount: 9,
    });
    expect(await scanCount(context.user.id)).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const jobId = queueAdd.mock.calls[0]![2].jobId as string;
    expect(jobId).toBe(`geogrid-scan-${response.body.scanId}`);
    expect(jobId).not.toContain(':');
  });

  it('keeps accepting scans back to back — there is no monthly allowance', async () => {
    const context = await account();
    for (let index = 0; index < 7; index += 1) {
      await createScan(context).expect(202);
    }
    expect(await scanCount(context.user.id)).toBe(7);
    expect(queueAdd).toHaveBeenCalledTimes(7);
  });
});

describe('geogrid routes — preview', () => {
  it('discloses the cell count with the community preview shape and writes nothing', async () => {
    const context = await account();
    const response = await previewScan(context, { gridSize: 7 }).expect(200);
    expect(response.body).toEqual({
      preview: { deploymentMode: 'community', capacityEnforced: false },
      cellCount: 49,
    });
    expect(await scanCount(context.user.id)).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects an oversized grid without writing a scan', async () => {
    const context = await account();
    await previewScan(context, { gridSize: 9 }).expect(400);
    expect(await scanCount(context.user.id)).toBe(0);
  });
});

describe('geogrid routes — kill switch', () => {
  it('closes new scans but keeps stored scans readable', async () => {
    const context = await account();
    const created = await createScan(context).expect(202);
    (env as { GEOGRID_ENABLED: boolean }).GEOGRID_ENABLED = false;
    await createScan(context).expect(503);
    await previewScan(context).expect(503);
    await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans/${created.body.scanId}`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(await scanCount(context.user.id)).toBe(1);
  });

  it('a missing queue is a 503 that writes nothing', async () => {
    const context = await account();
    setGeogridQueue(null);
    await createScan(context).expect(503);
    expect(await scanCount(context.user.id)).toBe(0);
  });

  it('an enqueue failure marks the scan failed', async () => {
    const context = await account();
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    await createScan(context).expect(503);
    const rows = await getTestDb().select().from(geogridScans);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      failureReason: 'geogrid.failure.enqueue',
    });
  });
});

describe('geogrid routes — reads', () => {
  it('lists newest first and filters by keyword', async () => {
    const context = await account();
    const first = await createScan(context).expect(202);
    const second = await createScan(context, { gridSize: 5 }).expect(202);
    const list = await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans?keywordId=${context.keywordId}`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(list.body.scans.map((scan: { id: string }) => scan.id)).toEqual([
      second.body.scanId,
      first.body.scanId,
    ]);
  });

  it('honours the bounded limit', async () => {
    const context = await account();
    await createScan(context).expect(202);
    await createScan(context).expect(202);
    const list = await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans?limit=1`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(list.body.scans).toHaveLength(1);
    await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans?limit=999`)
      .set('Cookie', context.user.cookie)
      .expect(400);
  });

  it('an in-flight scan reports no cells rather than empty outcomes', async () => {
    const context = await account();
    const created = await createScan(context).expect(202);
    const detail = await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans/${created.body.scanId}`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(detail.body.cells).toEqual([]);
    expect(detail.body.status).toBe('queued');
  });

  it('the cell DTO partitions observed / not-in-pack / failed and never blends them', async () => {
    const context = await account();
    const created = await createScan(context).expect(202);
    const scanId = created.body.scanId as string;
    const capturedAt = new Date('2026-08-02T09:00:00.000Z');
    await getTestDb()
      .insert(geogridSnapshots)
      .values([
        {
          scanId,
          accountId: context.user.id,
          siteId: context.siteId,
          keywordId: context.keywordId,
          pointIndex: 0,
          lat: 30.276,
          lng: -97.753,
          position: 2,
          totalPackSize: 5,
          capturedAt,
        },
        {
          scanId,
          accountId: context.user.id,
          siteId: context.siteId,
          keywordId: context.keywordId,
          pointIndex: 1,
          lat: 30.276,
          lng: -97.743,
          position: null,
          totalPackSize: 5,
          capturedAt,
        },
      ]);
    await getTestDb()
      .update(geogridScans)
      .set({
        status: 'completed_partial',
        observedCells: 1,
        notInPackCells: 1,
        failedCells: 1,
        failedPointIndexes: [2],
        finishedAt: capturedAt,
      })
      .where(eq(geogridScans.id, scanId));

    const detail = await request(app)
      .get(`/api/sites/${context.siteId}/geogrid/scans/${scanId}`)
      .set('Cookie', context.user.cookie)
      .expect(200);

    expect(detail.body.finishedAt).toBe(capturedAt.toISOString());
    const cells = detail.body.cells as Array<Record<string, unknown>>;
    expect(cells.map((cell) => cell.pointIndex)).toEqual([0, 1, 2]);
    const byState = new Map(cells.map((cell) => [cell.state, cell]));
    expect(byState.get('observed')).toMatchObject({
      position: 2,
      totalPackSize: 5,
      capturedAt: capturedAt.toISOString(),
    });
    expect(byState.get('not_in_pack')).toMatchObject({
      position: null,
      totalPackSize: 5,
      capturedAt: capturedAt.toISOString(),
    });
    // The honesty invariant: a failed cell carries no rank, no pack size, and
    // no capture time — it cannot be rendered as "not in the pack".
    const failed = byState.get('failed')!;
    expect(failed).not.toHaveProperty('position');
    expect(failed).not.toHaveProperty('totalPackSize');
    expect(failed).not.toHaveProperty('capturedAt');
    expect(typeof failed.lat).toBe('number');
    expect(typeof failed.lng).toBe('number');
    for (const cell of cells) {
      expect(['observed', 'not_in_pack', 'failed']).toContain(cell.state);
    }
  });
});
