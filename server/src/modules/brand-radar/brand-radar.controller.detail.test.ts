/**
 * `GET /api/brand-radar/scans/:id` detail DTO.
 *
 * Pins the contract the workspace reads: deterministic aggregates, the
 * digest state, and the cited digest sentences — all bounded, normalized
 * fields, no vendor envelope and no mention URL. Cross-account access stays a
 * 404 (never a 403), and the list DTO stays narrow.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
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
import { brandQueryHash } from './brand-radar.service.js';
import { Site } from '../sites/index.js';
import { BrandRadarScan } from './brand-radar.model.js';

const app = createApp();
let emailSeq = 0;

const ROW_A = '651f1a2b3c4d5e6f708192aa';
const ROW_B = '651f1a2b3c4d5e6f708192bb';

async function seedUser(): Promise<TestUser> {
  emailSeq += 1;
  return signupVerifiedUser(app, {
    email: `brand-radar-detail-${emailSeq}@example.test`,
  });
}


/**
 * Every scan is site-scoped and the stored-read lease
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

async function seedSettledScan(
  accountId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const scan = await BrandRadarScan.create({
    accountId,
    siteId: await siteFor(accountId),
    brandQuery: 'Acme Corp',
    language: 'en',
    status: 'completed',
    digestState: 'digest_present',
    queryHash: brandQueryHash('Acme Corp'),
    retainedRowCount: 2,
    retainedRowIds: [ROW_A, ROW_B],
    mentionCount: 2,
    sentimentDistribution: { positive: 50, neutral: 50, negative: 0, unknown: 0 },
    topDomains: [
      { domain: 'example.com', count: 1 },
      { domain: 'news.test', count: 1 },
    ],
    trendVsPrevious: 3,
    digestSentences: [
      { text: 'Coverage skews positive.', citedRowIds: [ROW_A, ROW_B] },
    ],
    terminalAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  });
  return String(scan._id);
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
});

describe('GET /api/brand-radar/scans/:id', () => {
  it('returns the aggregates, digest state, and cited sentences', async () => {
    const user = await seedUser();
    const scanId = await seedSettledScan(user.id);

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body).toMatchObject({
      id: scanId,
      brandQuery: 'Acme Corp',
      status: 'completed',
      digestState: 'digest_present',
      mentionCount: 2,
      sentimentDistribution: {
        positive: 50,
        neutral: 50,
        negative: 0,
        unknown: 0,
      },
      topDomains: [
        { domain: 'example.com', count: 1 },
        { domain: 'news.test', count: 1 },
      ],
      trend: { delta: 3, direction: 'up' },
      digestSentences: [
        { text: 'Coverage skews positive.', citedRowIds: [ROW_A, ROW_B] },
      ],
    });
    // A clean terminal (and any legacy doc without the field) reports null.
    expect(res.body.halt).toBeNull();
    // Bounded normalized fields only — no vendor envelope, no mention URL.
    expect(JSON.stringify(res.body)).not.toContain('https://');
  });

  it('exposes the halt stage and reason on a partial scan', async () => {
    const user = await seedUser();
    const scanId = await seedSettledScan(user.id, {
      status: 'completed_partial',
      digestState: 'digest_absent',
      digestSentences: [],
      halt: { stage: 'summary', reason: 'cost_ceiling' },
    });

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.status).toBe('completed_partial');
    expect(res.body.halt).toEqual({ stage: 'summary', reason: 'cost_ceiling' });
  });

  it('reports a negative trend as down and an unchanged one as flat', async () => {
    const user = await seedUser();
    const down = await seedSettledScan(user.id, { trendVsPrevious: -2 });
    const flat = await seedSettledScan(user.id, { trendVsPrevious: 0 });

    const downRes = await request(app)
      .get(`/api/brand-radar/scans/${down}`)
      .set('Cookie', user.cookie)
      .expect(200);
    const flatRes = await request(app)
      .get(`/api/brand-radar/scans/${flat}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(downRes.body.trend).toEqual({ delta: -2, direction: 'down' });
    expect(flatRes.body.trend).toEqual({ delta: 0, direction: 'flat' });
  });

  it('surfaces a first-of-series scan as trend null, never a zero delta', async () => {
    const user = await seedUser();
    const scanId = await seedSettledScan(user.id, { trendVsPrevious: null });

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.trend).toBeNull();
  });

  it('reports an abstained scan honestly with zero sentences', async () => {
    const user = await seedUser();
    const scanId = await seedSettledScan(user.id, {
      status: 'completed_partial',
      digestState: 'no_reliable_digest',
      digestSentences: [],
    });

    const res = await request(app)
      .get(`/api/brand-radar/scans/${scanId}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.status).toBe('completed_partial');
    expect(res.body.digestState).toBe('no_reliable_digest');
    expect(res.body.digestSentences).toEqual([]);
  });

  it('keeps the digest out of the list DTO', async () => {
    const user = await seedUser();
    await seedSettledScan(user.id);

    const res = await request(app)
      .get(`/api/sites/${await siteFor(user.id)}/brand-radar/scans`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).not.toHaveProperty('digestSentences');
    expect(res.body.items[0]).not.toHaveProperty('topDomains');
    expect(res.body.items[0]).not.toHaveProperty('halt');
    expect(res.body.items[0].digestState).toBe('digest_present');
  });

  it('returns 404 for another account, never 403', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const scanId = await seedSettledScan(owner.id);

    await request(app)
      .get(`/api/brand-radar/scans/${scanId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('returns 404 for a scan that does not exist', async () => {
    const user = await seedUser();
    await request(app)
      .get(`/api/brand-radar/scans/${new mongoose.Types.ObjectId().toString()}`)
      .set('Cookie', user.cookie)
      .expect(404);
  });
});
