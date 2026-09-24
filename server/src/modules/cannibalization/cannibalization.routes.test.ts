/**
 * Cannibalization router integration tests (prompt 04).
 *
 * Covers stored-rows-only computation (the GSC provider is never constructed), the
 * awaiting-sync state, `windowDays` surfacing, the kill switch, cross-account
 * 404, re-open, and the honesty invariant on every candidate DTO.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics } from '../../db/schema/gsc.js';
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
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/sites.model.js';
import { setCannibalizationDb } from './cannibalization.holder.js';
import { previewReport } from './cannibalization.service.js';

const app = createApp();
const SNAPSHOT_DATE = '2026-07-01';
let emailSeq = 0;

async function seedUser(): Promise<TestUser> {
  emailSeq += 1;
  return signupVerifiedUser(app, {
    email: `cannibalization-${emailSeq}@example.test`,
  });
}

async function seedSite(user: TestUser, domain = 'example.test'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(user.id),
    url: `https://${domain}`,
    domain,
    displayName: domain,
    gscPropertyUrl: `sc-domain:${domain}`,
    gscBindingGenerationId: 'legacy',
  });
  return String(site._id);
}

interface SeedRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

const DEFAULT_ROWS: SeedRow[] = [
  {
    query: 'seo audit tool',
    page: 'https://example.test/seo-audit',
    clicks: 120,
    impressions: 3000,
    position: 4.1,
  },
  {
    query: 'seo audit tool',
    page: 'https://example.test/blog/seo-audit-guide',
    clicks: 60,
    impressions: 2400,
    position: 9.3,
  },
  {
    query: 'lonely query',
    page: 'https://example.test/only',
    clicks: 3,
    impressions: 30,
    position: 12,
  },
];

async function seedRows(
  accountId: string,
  siteId: string,
  rows: SeedRow[] = DEFAULT_ROWS,
  windowDays = 28,
  snapshotDate = SNAPSHOT_DATE,
): Promise<void> {
  await getTestDb()
    .insert(gscSearchAnalytics)
    .values(
      rows.map((row) => ({
        accountId,
        siteId,
        bindingGenerationId: 'legacy',
        snapshotDate,
        dimensionSet: 'query,page',
        windowDays,
        dimensionKey: `${row.query}${GSC_DIMENSION_KEY_SEPARATOR}${row.page}`,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.impressions === 0 ? 0 : row.clicks / row.impressions,
        position: row.position,
      })),
    );
}

const generate = (user: TestUser, siteId: string, body: object = {}) =>
  request(app)
    .post(`/api/sites/${siteId}/cannibalization-reports`)
    .set('Cookie', user.cookie)
    .send(body);

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setCannibalizationDb(db as unknown as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setCannibalizationDb(null);
  (env as { CANNIBALIZATION_ENABLED: boolean }).CANNIBALIZATION_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { CANNIBALIZATION_ENABLED: boolean }).CANNIBALIZATION_ENABLED = true;
});

describe('auth', () => {
  it('rejects unauthenticated calls on every route with 401', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    await request(app).post(`/api/sites/${id}/cannibalization-reports`).send({}).expect(401);
    await request(app)
      .post(`/api/sites/${id}/cannibalization-reports/preview`)
      .send({})
      .expect(401);
    await request(app).get(`/api/sites/${id}/cannibalization-reports`).expect(401);
    await request(app).get(`/api/cannibalization-reports/${id}`).expect(401);
  });
});

describe('generation', () => {
  it('computes candidates from stored rows and surfaces the window + last sync', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId);

    const res = await generate(user, siteId).expect(201);
    expect(res.body.windowDays).toBe(28);
    expect(res.body.snapshotDate).toBe(SNAPSHOT_DATE);
    expect(res.body.queriesAnalyzed).toBe(2);
    expect(res.body.candidateCount).toBe(1);
    expect(res.body.pagesInvolved).toBe(2);

    const candidate = res.body.candidates[0];
    expect(candidate.query).toBe('seo audit tool');
    expect(candidate.confidence).toBe('high');
    expect(candidate.primaryUrl).toBe('https://example.test/seo-audit');
    expect(candidate.primaryReason).toBe('most_clicks');
    expect(candidate.pages).toHaveLength(2);
    expect(candidate.pages[0].isPrimary).toBe(true);
  });

  it('honesty invariant — every candidate carries first_party, its window and last-sync date', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId);
    const res = await generate(user, siteId, { windowDays: 28 }).expect(201);
    for (const candidate of res.body.candidates) {
      expect(candidate.sourceKind).toBe('first_party');
      expect(candidate.windowDays).toBe(28);
      expect(candidate.snapshotDate).toBe(SNAPSHOT_DATE);
      expect(candidate.observation.sourceKind).toBe('first_party');
      expect(candidate.observation.sourceLabel).toBe('google_search_console');
    }
  });

  it('reads only the requested window', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId, DEFAULT_ROWS, 28);
    await seedRows(
      user.id,
      siteId,
      [
        {
          query: 'seven day query',
          page: 'https://example.test/a',
          clicks: 5,
          impressions: 50,
          position: 3,
        },
        {
          query: 'seven day query',
          page: 'https://example.test/b',
          clicks: 1,
          impressions: 10,
          position: 7,
        },
      ],
      7,
    );
    const res = await generate(user, siteId, { windowDays: 7 }).expect(201);
    expect(res.body.windowDays).toBe(7);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].query).toBe('seven day query');
  });

  it('skips a malformed row that carries no key separator', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId);
    await getTestDb().insert(gscSearchAnalytics).values([
      {
        accountId: user.id,
        siteId,
        bindingGenerationId: 'legacy',
        snapshotDate: SNAPSHOT_DATE,
        dimensionSet: 'query,page',
        windowDays: 28,
        dimensionKey: 'no-separator-here',
        clicks: 9,
        impressions: 90,
        ctr: 0.1,
        position: 2,
      },
      {
        accountId: user.id,
        siteId,
        bindingGenerationId: 'legacy',
        snapshotDate: SNAPSHOT_DATE,
        dimensionSet: 'query,page',
        windowDays: 28,
        dimensionKey: `${GSC_DIMENSION_KEY_SEPARATOR}https://example.test/empty-query`,
        clicks: 1,
        impressions: 10,
        ctr: 0.1,
        position: 3,
      },
    ]);
    const res = await generate(user, siteId).expect(201);
    expect(res.body.queriesAnalyzed).toBe(2);
  });

  it('returns the localized waiting-for-sync state until rows exist', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const res = await generate(user, siteId).expect(409);
    expect(res.body.error.message).toBe(
      translate('en', 'cannibalization.errors.awaitingSync'),
    );
    await seedRows(user.id, siteId);
    await generate(user, siteId).expect(201);
  });

  it('reads legacy rows when a bound site predates generation ids', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await Site.updateOne({ _id: siteId }, { $unset: { gscBindingGenerationId: 1 } });
    await seedRows(user.id, siteId);

    const res = await generate(user, siteId).expect(201);
    expect(res.body).toMatchObject({ snapshotDate: SNAPSHOT_DATE, candidateCount: 1 });
  });

  it('does not read orphaned rows after the site property is disconnected', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId);
    await Site.updateOne(
      { _id: siteId },
      { $unset: { gscPropertyUrl: 1, gscBindingGenerationId: 1 } },
    );

    const res = await generate(user, siteId).expect(409);
    expect(res.body.error.message).toBe(
      translate('en', 'cannibalization.errors.awaitingSync'),
    );
  });

  it('refuses an unsupported window', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await generate(user, siteId, { windowDays: 30 }).expect(400);
  });
});

describe('preview', () => {
  it('returns the community spend preview without generating a report', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/cannibalization-reports/preview`)
      .set('Cookie', user.cookie)
      .send({})
      .expect(200);
    expect(res.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    const list = await request(app)
      .get(`/api/sites/${siteId}/cannibalization-reports`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.items).toEqual([]);
  });
});

describe('stored reports', () => {
  it('lists newest first, filters by window, and re-opens a stored report', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId);
    await seedRows(
      user.id,
      siteId,
      [
        {
          query: 'a query',
          page: 'https://example.test/x',
          clicks: 4,
          impressions: 40,
          position: 2,
        },
        {
          query: 'a query',
          page: 'https://example.test/y',
          clicks: 2,
          impressions: 20,
          position: 6,
        },
      ],
      90,
    );
    const first = await generate(user, siteId, { windowDays: 28 }).expect(201);
    const second = await generate(user, siteId, { windowDays: 90 }).expect(201);

    const list = await request(app)
      .get(`/api/sites/${siteId}/cannibalization-reports`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);

    const filtered = await request(app)
      .get(`/api/sites/${siteId}/cannibalization-reports?windowDays=90&limit=5`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].windowDays).toBe(90);

    const reopened = await request(app)
      .get(`/api/cannibalization-reports/${first.body.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(reopened.body.candidates).toHaveLength(1);
  });

  it('returns 404 for another account report and site', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    await seedRows(owner.id, siteId);
    const report = await generate(owner, siteId).expect(201);

    const stranger = await seedUser();
    await request(app)
      .get(`/api/cannibalization-reports/${report.body.id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get(`/api/sites/${siteId}/cannibalization-reports`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    const res = await generate(stranger, siteId).expect(404);
    // A site-scoped route is refused by the site work lease before the module
    // ever runs, so the foreign site reads as a missing site. Still a bare 404
    // with no existence disclosure — never a 403.
    expect(res.body.error.message).toBe(translate('en', 'sites.errors.notFound'));
  });

  it('returns 400 for a malformed report id', async () => {
    const user = await seedUser();
    await request(app)
      .get('/api/cannibalization-reports/not-an-id')
      .set('Cookie', user.cookie)
      .expect(400);
  });
});

describe('kill switch', () => {
  it('resolves site ownership before disclosing the disabled state', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    const stranger = await seedUser();
    (env as { CANNIBALIZATION_ENABLED: boolean }).CANNIBALIZATION_ENABLED = false;

    await generate(stranger, siteId).expect(404);
    await request(app)
      .post(`/api/sites/${siteId}/cannibalization-reports/preview`)
      .set('Cookie', stranger.cookie)
      .send({})
      .expect(404);
  });

  it('closes preview and generate but leaves stored reads open', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedRows(user.id, siteId);
    const report = await generate(user, siteId).expect(201);

    (env as { CANNIBALIZATION_ENABLED: boolean }).CANNIBALIZATION_ENABLED = false;
    const blocked = await generate(user, siteId).expect(503);
    expect(blocked.body.error.message).toBe(
      translate('en', 'cannibalization.errors.productUnavailable'),
    );
    await request(app)
      .post(`/api/sites/${siteId}/cannibalization-reports/preview`)
      .set('Cookie', user.cookie)
      .send({})
      .expect(503);
    await request(app)
      .get(`/api/cannibalization-reports/${report.body.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/sites/${siteId}/cannibalization-reports`)
      .set('Cookie', user.cookie)
      .expect(200);
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('cannibalization service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(previewReport({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99', windowDays: 28 })).rejects.toMatchObject({ status: 404 });
  });

});
