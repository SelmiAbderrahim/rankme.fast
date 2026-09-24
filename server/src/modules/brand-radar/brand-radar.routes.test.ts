/**
 * Spec 07a-1 — Brand Radar router tests.
 *
 * Brand Radar is available to every verified account; the only gate is the
 * `BRAND_RADAR_ENABLED` kill switch. Also covered: cross-account 404 on `:id`
 * and list, the v1 multi-query refusal, and both named rate buckets. Site scoping
 * (rankme-site-scoping 01) adds: create/preview/list live under
 * `/api/sites/:siteId/brand-radar`, and a foreign, malformed, paused, or
 * deleting site is refused there before anything else is disclosed.
 */
import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { translate } from '../../shared/i18n/index.js';
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
import { Site } from '../sites/index.js';
import { setBrandRadarDb, setBrandRadarQueue } from './brand-radar.holder.js';
import { BrandRadarScan } from './brand-radar.model.js';

const app = createApp();
let queueAdd: ReturnType<typeof vi.fn>;
let emailSeq = 0;

/** Every scan is created from a site workspace, so the fixture owns one. */
interface RadarUser extends TestUser {
  siteId: string;
}

async function seedSite(
  accountId: string,
  domain: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
    ...extra,
  });
  return String(site._id);
}

async function seedUser(): Promise<RadarUser> {
  emailSeq += 1;
  const user = await signupVerifiedUser(app, {
    email: `brand-radar-${emailSeq}@example.test`,
  });
  return { ...user, siteId: await seedSite(user.id, `brand-radar-${emailSeq}.test`) };
}

function createScan(
  user: RadarUser,
  body: Record<string, unknown> = {},
  siteId = user.siteId,
  outputLocale = 'en',
) {
  return request(app)
    .post(`/api/sites/${siteId}/brand-radar/scans`)
    .set('Cookie', user.cookie)
    .set('x-lang', outputLocale)
    .send({ brandQuery: 'Acme Corp', ...body });
}

function previewScan(
  user: RadarUser,
  body: Record<string, unknown> = {},
  siteId = user.siteId,
) {
  return request(app)
    .post(`/api/sites/${siteId}/brand-radar/preview`)
    .set('Cookie', user.cookie)
    .send({ brandQuery: 'Acme Corp', ...body });
}

function listScans(user: RadarUser, query = '', siteId = user.siteId) {
  return request(app)
    .get(`/api/sites/${siteId}/brand-radar/scans${query}`)
    .set('Cookie', user.cookie);
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
  queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
  setBrandRadarQueue({ add: queueAdd } as unknown as Queue);
});

describe('auth', () => {
  it('rejects unauthenticated calls on every route with 401', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const site = new mongoose.Types.ObjectId().toString();
    await request(app)
      .post(`/api/sites/${site}/brand-radar/scans`)
      .send({ brandQuery: 'x' })
      .expect(401);
    await request(app)
      .post(`/api/sites/${site}/brand-radar/preview`)
      .send({ brandQuery: 'x' })
      .expect(401);
    await request(app).get(`/api/sites/${site}/brand-radar/scans`).expect(401);
    await request(app).get(`/api/brand-radar/scans/${id}`).expect(401);
    await request(app).get(`/api/brand-radar/scans/${id}/mentions`).expect(401);
  });
});

describe('create + kill switch', () => {
  it('freezes output locale independently from the collection language', async () => {
    const user = await seedUser();
    const res = await createScan(user, { language: 'fr' }, user.siteId, 'de').expect(202);
    expect(res.body).toMatchObject({ outputLocale: 'de' });
    expect(queueAdd).toHaveBeenCalledWith(
      'brand-radar-scan',
      expect.objectContaining({ scanId: res.body.scanId, outputLocale: 'de' }),
      expect.anything(),
    );
    const persisted = await BrandRadarScan.findById(res.body.scanId);
    expect(persisted?.language).toBe('fr');
    expect(persisted?.outputLocale).toBe('de');
  });

  it('queues a scan for any verified account with no plan or add-on', async () => {
    const user = await seedUser();
    const res = await createScan(user).expect(202);
    expect(res.body).toEqual({
      scanId: expect.any(String),
      status: 'queued',
      queryHash: expect.any(String),
      priorScanId: null,
      outputLocale: 'en',
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('keeps queueing scans back to back — there is no monthly cap', async () => {
    const user = await seedUser();
    for (let index = 0; index < 3; index += 1) {
      await createScan(user, { brandQuery: `Brand ${index}` }).expect(202);
    }
    expect(queueAdd).toHaveBeenCalledTimes(3);
  });

  it('flag off → 503 on create and preview; stored reads survive', async () => {
    const user = await seedUser();
    const created = await createScan(user).expect(202);

    (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;

    const refused = await createScan(user).expect(503);
    expect(refused.body.error.message).toBe(
      translate('en', 'brandRadar.errors.productUnavailable'),
    );
    await previewScan(user).expect(503);

    // Stored reads keep working while the switch is off.
    await listScans(user).expect(200);
    const detail = await request(app)
      .get(`/api/brand-radar/scans/${created.body.scanId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.id).toBe(created.body.scanId);
  });
});

describe('validation', () => {
  it('rejects a competitorQueries payload with the v1 multi-query key', async () => {
    const user = await seedUser();
    const res = await createScan(user, { competitorQueries: ['Rival Inc'] }).expect(400);
    expect(JSON.stringify(res.body.error.details)).toContain(
      'brandRadar.errors.multiQueryUnsupported',
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects an empty, over-long, or non-ISO-639-1 input', async () => {
    const user = await seedUser();
    await createScan(user, { brandQuery: '   ' }).expect(400);
    await createScan(user, { brandQuery: 'x'.repeat(201) }).expect(400);
    await createScan(user, { language: 'eng' }).expect(400);
    await createScan(user, { locationCode: -1 }).expect(400);
    await createScan(user, { countryCode: 'USA' }).expect(400);
    await createScan(user, { countryCode: 'US', locationCode: 2840 }).expect(400);
    await createScan(user, { unexpected: true }).expect(400);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('trims and lowercases the accepted optional inputs', async () => {
    const user = await seedUser();
    const res = await createScan(user, {
      brandQuery: '  Acme   Corp  ',
      language: 'FR',
      countryCode: 'fr',
    }).expect(202);
    const stored = await BrandRadarScan.findById(res.body.scanId);
    expect(stored).toMatchObject({
      brandQuery: 'Acme   Corp',
      language: 'fr',
      countryCode: 'FR',
    });
  });

  it('rejects an out-of-range list limit and a malformed cursor', async () => {
    const user = await seedUser();
    await listScans(user, '?limit=51').expect(400);
    const bad = await listScans(user, '?cursor=%25%25%25').expect(400);
    expect(bad.body.error.message).toBe(
      translate('en', 'brandRadar.errors.invalidCursor'),
    );
  });
});

describe('cross-account isolation', () => {
  it('returns 404 (never 403) for another account scan and hides it from the list', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const created = await createScan(owner).expect(202);

    const miss = await request(app)
      .get(`/api/brand-radar/scans/${created.body.scanId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    expect(miss.body.error.message).toBe(
      translate('en', 'brandRadar.errors.notFound'),
    );

    const list = await listScans(stranger).expect(200);
    expect(list.body.items).toEqual([]);
  });

  it('returns 400 for a malformed :id (never leaks whether a row exists)', async () => {
    const user = await seedUser();
    await request(app)
      .get('/api/brand-radar/scans/not-an-object-id')
      .set('Cookie', user.cookie)
      .expect(400);
  });
});

describe('cross-site isolation', () => {
  it('404s create, preview, and list on another account site', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();

    // A well-formed foreign id is caught by the shared `/api/sites/:siteId`
    // lease, which answers the generic site miss — never 403, and never a
    // Brand Radar-specific signal that would confirm the tool was reachable.
    const created = await createScan(stranger, {}, owner.siteId).expect(404);
    expect(created.body.error.message).toBe(translate('en', 'sites.errors.notFound'));
    await previewScan(stranger, {}, owner.siteId).expect(404);
    await listScans(stranger, '', owner.siteId).expect(404);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('404s a malformed and an unknown siteId with the same status', async () => {
    const user = await seedUser();
    const ghost = new mongoose.Types.ObjectId().toString();
    for (const siteId of ['not-an-object-id', ghost]) {
      await createScan(user, {}, siteId).expect(404);
      await previewScan(user, {}, siteId).expect(404);
      await listScans(user, '', siteId).expect(404);
    }
    // The malformed id never reaches the lease (it cannot be an ObjectId), so
    // the module's own guard answers — with its own miss key, same status.
    const malformed = await listScans(user, '', 'not-an-object-id').expect(404);
    expect(malformed.body.error.message).toBe(
      translate('en', 'brandRadar.errors.notFound'),
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('lists only the scans of the requested site', async () => {
    const user = await seedUser();
    const other = await seedSite(user.id, 'second.test');
    const onFirst = await createScan(user).expect(202);
    await createScan(user, { brandQuery: 'Zeta' }, other).expect(202);

    const first = await listScans(user).expect(200);
    expect(first.body.items.map((row: { id: string }) => row.id)).toEqual([
      onFirst.body.scanId,
    ]);
    expect(first.body.items[0].siteId).toBe(user.siteId);
  });

  it('refuses a paused site and 404s a site being deleted before any spend', async () => {
    const user = await seedUser();
    const paused = await seedSite(user.id, 'paused.test', {
      paused: true,
      pausedAt: new Date(),
    });
    await createScan(user, {}, paused).expect(409);

    const deleting = await seedSite(user.id, 'deleting.test', {
      deletionStartedAt: new Date(),
    });
    await createScan(user, {}, deleting).expect(404);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(await BrandRadarScan.countDocuments({})).toBe(0);
  });
});

describe('preview route', () => {
  it('answers the community preview shape without writing anything', async () => {
    const user = await seedUser();
    const quoted = await previewScan(user).expect(200);
    expect(quoted.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    // Preview never creates a scan and never enqueues.
    expect(await BrandRadarScan.countDocuments({})).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects a malformed preview body like create does', async () => {
    const user = await seedUser();
    await previewScan(user, { competitorQueries: ['Rival Inc'] }).expect(400);
  });
});

describe('named rate buckets', () => {
  it('rejects the eleventh create in one window with localized 429 copy', async () => {
    const freshApp = createApp();
    const user = await signupVerifiedUser(freshApp, {
      email: 'brand-radar-create-bucket@example.test',
    });
    const siteId = await seedSite(user.id, 'create-bucket.test');

    for (let index = 0; index < 10; index += 1) {
      await request(freshApp)
        .post(`/api/sites/${siteId}/brand-radar/scans`)
        .set('Cookie', user.cookie)
        .send({ brandQuery: `Brand ${index}` })
        .expect(202);
    }
    const limited = await request(freshApp)
      .post(`/api/sites/${siteId}/brand-radar/scans`)
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'zh')
      .send({ brandQuery: 'Brand over' })
      .expect(429);
    expect(limited.body.error).toBe(
      translate('zh', 'brandRadar.errors.rateLimited'),
    );
  });

  it('rejects the sixty-first stored-scan read in one window', async () => {
    const freshApp = createApp();
    const user = await signupVerifiedUser(freshApp, {
      email: 'brand-radar-poll-bucket@example.test',
    });
    const siteId = await seedSite(user.id, 'poll-bucket.test');

    for (let index = 0; index < 60; index += 1) {
      await request(freshApp)
        .get(`/api/sites/${siteId}/brand-radar/scans`)
        .set('Cookie', user.cookie)
        .expect(200);
    }
    const limited = await request(freshApp)
      .get(`/api/sites/${siteId}/brand-radar/scans`)
      .set('Cookie', user.cookie)
      .expect(429);
    expect(limited.body.error).toBe(
      translate('en', 'brandRadar.errors.rateLimited'),
    );
  });
});
