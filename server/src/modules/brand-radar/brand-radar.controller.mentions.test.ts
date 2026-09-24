/**
 * Spec 07a-5 — `GET /api/brand-radar/scans/:id/mentions`.
 *
 * The mention inventory the 07b workspace table and CSV export read. It is a
 * STORED-data read: bounded, keyset-paginated, owner-scoped, and provably
 * free — no queue job, no vendor cost capture. The
 * stored URL is scheme-guarded at serialization so nothing but http(s) can
 * ever reach a rendered link.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { translate } from '../../shared/i18n/index.js';
import type * as CostCaptureModule from '../../shared/providers/cost-capture.js';
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
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { setBrandRadarDb, setBrandRadarQueue } from './brand-radar.holder.js';
import { Site } from '../sites/index.js';
import { BrandRadarScan } from './brand-radar.model.js';
import {
  BrandRadarMention,
  readMentionRows,
  readMentionRowsPage,
} from './brand-radar.rows.model.js';
import { brandQueryHash } from './brand-radar.service.js';

const spend = { vendorCost: 0 };

vi.mock('../../shared/providers/cost-capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CostCaptureModule>();
  return {
    ...actual,
    captureVendorCost: async (...args: unknown[]) => {
      spend.vendorCost += 1;
      return (actual.captureVendorCost as unknown as (...rest: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

const app = createApp();
let emailSeq = 0;
let queueAdd: ReturnType<typeof vi.fn>;

const BASE_TIME = Date.parse('2026-03-01T00:00:00.000Z');

async function seedUser(): Promise<TestUser> {
  emailSeq += 1;
  return signupVerifiedUser(app, {
    email: `brand-radar-mentions-${emailSeq}@example.test`,
  });
}


/**
 * Every scan is site-scoped (rankme-site-scoping 01) and the stored-read lease
 * resolves a REAL site, so each account under test owns one.
 */
async function siteFor(accountId: string): Promise<string> {
  const existing = await Site.findOne({ accountId }).select({ _id: 1 });
  if (existing) return String(existing._id);
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://site-${accountId}.example`,
    domain: `site-${accountId}.example`,
  });
  return String(site._id);
}

async function seedScan(
  accountId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const scan = await BrandRadarScan.create({
    accountId,
    siteId: await siteFor(accountId),
    brandQuery: 'Acme Corp',
    status: 'completed',
    digestState: 'digest_present',
    queryHash: brandQueryHash('Acme Corp'),
    retainedRowCount: 0,
    retainedRowIds: [],
    ...overrides,
  });
  return String(scan._id);
}

interface SeedRow {
  url: string;
  domain?: string;
  title?: string;
  snippet?: string;
  polarity?: string;
  confidence?: number | null;
  language?: string | null;
  observedAt?: Date | null;
}

/**
 * Raw collection insert so `createdAt` is deterministic — mongoose stamps its
 * own timestamp on `create()`, and the keyset order is the contract here.
 */
async function seedRows(
  accountId: string,
  scanId: string,
  rows: readonly SeedRow[],
): Promise<string[]> {
  const docs = rows.map((row, index) => ({
    _id: new mongoose.Types.ObjectId(),
    accountId: new mongoose.Types.ObjectId(accountId),
    scanId: new mongoose.Types.ObjectId(scanId),
    url: row.url,
    domain: row.domain ?? 'example.com',
    title: row.title ?? 'Acme in the news',
    snippet: row.snippet ?? 'Acme shipped a thing.',
    polarity: row.polarity ?? 'positive',
    confidence: row.confidence === undefined ? 0.75 : row.confidence,
    language: row.language === undefined ? 'en' : row.language,
    observedAt:
      row.observedAt === undefined
        ? new Date('2026-02-01T00:00:00.000Z')
        : row.observedAt,
    createdAt: new Date(BASE_TIME + index * 1000),
    updatedAt: new Date(BASE_TIME + index * 1000),
  }));
  await BrandRadarMention.collection.insertMany(docs);
  return docs.map((doc) => String(doc._id));
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setBrandRadarDb(db as unknown as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setBrandRadarDb(null);
  setBrandRadarQueue(null);
  (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = true;
  spend.vendorCost = 0;
  queueAdd = vi.fn(async () => ({ id: 'job-1' }));
  setBrandRadarQueue({ add: queueAdd } as unknown as never);
});

describe('GET /api/brand-radar/scans/:id/mentions', () => {
  it('returns the stored rows in retention order with every field', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    const [first, second] = await seedRows(user.id, scanId, [
      { url: 'https://example.com/a', domain: 'example.com' },
      {
        url: 'http://news.test/b',
        domain: 'news.test',
        title: 'Acme criticized',
        snippet: 'Mixed reception.',
        polarity: 'negative',
        confidence: null,
        language: null,
        observedAt: null,
      },
    ]);

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body).toEqual({
      items: [
        {
          id: first,
          url: 'https://example.com/a',
          domain: 'example.com',
          title: 'Acme in the news',
          snippet: 'Acme shipped a thing.',
          polarity: 'positive',
          confidence: 0.75,
          language: 'en',
          observedAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: second,
          url: 'http://news.test/b',
          domain: 'news.test',
          title: 'Acme criticized',
          snippet: 'Mixed reception.',
          polarity: 'negative',
          confidence: null,
          language: null,
          observedAt: null,
        },
      ],
      nextCursor: null,
    });
  });

  it('pages by keyset in retention order and ends with a null cursor', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    const [first, second] = await seedRows(user.id, scanId, [
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
    ]);

    const page1 = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions?limit=1`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(page1.body.items.map((row: { id: string }) => row.id)).toEqual([
      first,
    ]);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(app)
      .get(
        `/api/brand-radar/scans/${scanId}/mentions?limit=1&cursor=${encodeURIComponent(
          page1.body.nextCursor,
        )}`,
      )
      .set('Cookie', user.cookie)
      .expect(200);
    expect(page2.body.items.map((row: { id: string }) => row.id)).toEqual([
      second,
    ]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('rejects an out-of-range limit and defaults an absent one to 50', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    await seedRows(
      user.id,
      scanId,
      Array.from({ length: 51 }, (_unused, index) => ({
        url: `https://example.com/${index}`,
      })),
    );

    await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions?limit=0`)
      .set('Cookie', user.cookie)
      .expect(400);
    await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions?limit=101`)
      .set('Cookie', user.cookie)
      .expect(400);

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(50);
    expect(res.body.nextCursor).toEqual(expect.any(String));
  });

  it('rejects a malformed cursor with the shipped invalid-cursor message', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions?cursor=%25%25%25`)
      .set('Cookie', user.cookie)
      .expect(400);
    expect(res.body.error.message).toBe(
      translate('en', 'brandRadar.errors.invalidCursor'),
    );
  });

  it('returns 404 (never 403) for another account scan', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const scanId = await seedScan(owner.id);
    await seedRows(owner.id, scanId, [{ url: 'https://example.com/a' }]);

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    expect(res.body.error.message).toBe(
      translate('en', 'brandRadar.errors.notFound'),
    );
  });

  it('treats a non-hex :id as a miss, not a validation error', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/brand-radar/scans/not-an-object-id/mentions')
      .set('Cookie', user.cookie)
      .expect(404);
    expect(res.body.error.message).toBe(
      translate('en', 'brandRadar.errors.notFound'),
    );
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const user = await seedUser();
    await request(app)
      .get(
        `/api/brand-radar/scans/${new mongoose.Types.ObjectId().toString()}/mentions`,
      )
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it('serves only http(s) URLs and nulls every other stored scheme', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    await seedRows(user.id, scanId, [
      { url: 'https://example.com/safe' },
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,x' },
      { url: 'not a url at all' },
    ]);

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.items.map((row: { url: string | null }) => row.url)).toEqual(
      ['https://example.com/safe', null, null, null],
    );
  });

  it('spends nothing: no queue job, no vendor cost capture', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    await seedRows(user.id, scanId, [
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
    ]);

    await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions?limit=1`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(spend).toEqual({ vendorCost: 0 });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('stays readable while the kill switch is off', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    await seedRows(user.id, scanId, [{ url: 'https://example.com/a' }]);
    (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('reports an empty scan honestly', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id, { status: 'completed_empty' });

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}/mentions`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });
});

describe('mention row readers', () => {
  it('clamps both readers to the ≤1000 retention bound by default', async () => {
    const user = await seedUser();
    const scanId = await seedScan(user.id);
    const ids = await seedRows(user.id, scanId, [
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
    ]);

    // No `limit` → the retention bound, not an unbounded read.
    const all = await readMentionRows({ accountId: user.id, scanId });
    expect(all.map((row) => row.id)).toEqual(ids);
    expect(all[0]!.url).toBe('https://example.com/a');

    // Below the floor and above the ceiling both land inside `1..100`.
    const floor = await readMentionRowsPage({
      accountId: user.id,
      scanId,
      limit: 0,
    });
    expect(floor.items).toHaveLength(1);
    const ceiling = await readMentionRowsPage({
      accountId: user.id,
      scanId,
      limit: 5000,
    });
    expect(ceiling.items).toHaveLength(2);
    expect(ceiling.nextCursor).toBeNull();
  });
});
