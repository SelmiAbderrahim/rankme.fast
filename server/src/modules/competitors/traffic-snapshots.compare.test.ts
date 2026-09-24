import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { trafficSnapshots } from '../../db/schema/index.js';
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
import { getCompetitorsDb, setCompetitorsDb } from './competitors.holder.js';
import { compareTrafficSnapshots } from './traffic-snapshots.compare.js';
import { buildTrafficSnapshotPayload } from './traffic-snapshots.processor.js';
import type { TrafficProviderBundle } from './traffic-snapshots.schema.js';

const app = createApp();

function providerBundle(
  domain: string,
  monthlyVisits: number,
  countries: Array<{ countryCode: string; visits: number }>,
): TrafficProviderBundle {
  return {
    traffic: [{ domain, monthlyOrganicVisits: monthlyVisits, topCountries: countries }],
    rankOverview: {
      domain,
      rank: 25,
      keywordsCount: 100,
      estimatedMonthlyOrganicVisits: monthlyVisits,
    },
    history: {
      domain,
      points: [
        { year: 2026, month: 6, rank: 25, organicKeywords: 100, organicEtv: monthlyVisits },
      ],
    },
    retainedOps: { traffic: true, rankOverview: true, history: true },
    retryableFailures: { traffic: null, rankOverview: null, history: null },
  };
}

async function seedSnapshot(
  user: TestUser,
  index: number,
  countries: Array<{ countryCode: string; visits: number }> = [
    { countryCode: 'US', visits: 70 },
    { countryCode: 'DE', visits: 30 },
  ],
  monthlyVisits = 100,
  siteId: string | null = null,
): Promise<string> {
  const runId = new mongoose.Types.ObjectId().toString();
  const targetDomain = `rival-${index}.example`;
  const capturedAt = new Date(`2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`);
  await getTestDb().insert(trafficSnapshots).values({
    accountId: user.id,
    runId,
    siteId,
    targetDomain,
    payload: buildTrafficSnapshotPayload(
      providerBundle(targetDomain, monthlyVisits, countries),
      { inputs: { locationCode: 2840, languageCode: 'en' } },
      capturedAt,
    ),
    capturedAt,
  });
  return runId;
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setCompetitorsDb(db as never);
});

afterAll(async () => {
  setCompetitorsDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('GET /api/competitors/traffic-snapshots/compare', () => {
  it('returns two through five stored DTOs in requested id order', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-happy@example.test' });
    const ids = [];
    for (let index = 0; index < 5; index += 1) ids.push(await seedSnapshot(user, index));

    for (let count = 2; count <= 5; count += 1) {
      const selected = ids.slice(0, count).reverse();
      const response = await request(app)
        .get(`/api/competitors/traffic-snapshots/compare?ids=${selected.join(',')}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(response.body.snapshots.map((snapshot: { id: string }) => snapshot.id)).toEqual(selected);
      expect(response.body.snapshots[0]).toMatchObject({
        id: selected[0],
        siteId: null,
        targetDomain: expect.stringMatching(/^rival-/),
        capturedAt: expect.any(String),
        payload: {
          monthlyOrganicVisits: {
            observation: { sourceKind: 'estimate' },
          },
        },
      });
      expect(response.body.axes.countryCodes).toEqual(['US', 'DE']);
    }
  });

  it('rejects one id with 400 and requires authentication', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-one@example.test' });
    const id = await seedSnapshot(user, 0);
    await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${id}`)
      .set('Cookie', user.cookie)
      .expect(400);
    await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${id},${new mongoose.Types.ObjectId()}`)
      .expect(401);
  });

  it('rejects duplicate compare ids', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-duplicate@example.test' });
    const id = await seedSnapshot(user, 0);
    await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${id},${id}`)
      .set('Cookie', user.cookie)
      .expect(400);
  });

  it('clamps six ids with ASCII-only headers and localizes the body in all seven locales', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-clamp@example.test' });
    const ids = [];
    for (let index = 0; index < 6; index += 1) ids.push(await seedSnapshot(user, index));
    for (const locale of ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const) {
      const response = await request(app)
        .get(`/api/competitors/traffic-snapshots/compare?ids=${ids.join(',')}`)
        .set('Cookie', user.cookie)
        .set('Accept-Language', locale)
        .expect(200);
      expect(response.body.snapshots).toHaveLength(5);
      expect(response.body.warning).toEqual({
        code: 'RESULT_SET_CLAMPED',
        messageKey: 'trafficInsights.compare.clamped',
        messageVars: { count: 5 },
        message: translate(locale, 'trafficInsights.compare.clamped', { count: 5 }),
      });
      expect(response.body.warning.message).not.toMatch(/\{\{|trafficInsights\./u);
      expect(response.headers['content-language']).toBe(locale);
      expect(response.headers['x-rankmefast-warning']).toBe('RESULT_SET_CLAMPED');
      expect(response.headers.warning).toBe('299 RankMeFast "RESULT_SET_CLAMPED"');
      expect(`${response.headers['x-rankmefast-warning']} ${response.headers.warning}`)
        .toMatch(/^[\x20-\x7e]+$/u);
    }
  });

  it('returns one indistinguishable 404 instead of a partial cross-account comparison', async () => {
    const owner = await signupVerifiedUser(app, { email: 'compare-owner@example.test' });
    const stranger = await signupVerifiedUser(app, { email: 'compare-stranger@example.test' });
    const ownedId = await seedSnapshot(owner, 0);
    const foreignIds = [await seedSnapshot(stranger, 1), await seedSnapshot(stranger, 2)];
    await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${ownedId},${foreignIds[0]}`)
      .set('Cookie', owner.cookie)
      .expect(404);

    const missing = await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${foreignIds.join(',')}`)
      .set('Cookie', owner.cookie)
      .set('Accept-Language', 'de')
      .expect(404);
    expect(missing.body.error.message).toBe(
      translate('de', 'trafficInsights.errors.notFound'),
    );
  });

  it('allows only explicitly granted Site-bound rows for selected scopes', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-selected-sites@example.test' });
    const allowedSiteId = new mongoose.Types.ObjectId().toHexString();
    const deniedSiteId = new mongoose.Types.ObjectId().toHexString();
    const allowedIds = [
      await seedSnapshot(user, 0, undefined, 100, allowedSiteId),
      await seedSnapshot(user, 1, undefined, 100, allowedSiteId),
    ];
    const allowed = await compareTrafficSnapshots(
      user.id,
      { ids: allowedIds, clamped: false },
      getCompetitorsDb(),
      [allowedSiteId],
    );
    expect(allowed.snapshots.map((snapshot) => snapshot.id)).toEqual(allowedIds);

    const accountWideId = await seedSnapshot(user, 2);
    await expect(
      compareTrafficSnapshots(
        user.id,
        { ids: [allowedIds[0]!, accountWideId], clamped: false },
        getCompetitorsDb(),
        [allowedSiteId],
      ),
    ).rejects.toMatchObject({ status: 404 });

    const deniedId = await seedSnapshot(user, 3, undefined, 100, deniedSiteId);
    await expect(
      compareTrafficSnapshots(
        user.id,
        { ids: [allowedIds[0]!, deniedId], clamped: false },
        getCompetitorsDb(),
        [allowedSiteId],
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('404s when any requested stored id does not exist', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-missing@example.test' });
    const id = await seedSnapshot(user, 0);
    await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${id},${new mongoose.Types.ObjectId()}`)
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it('orders the union by total share and clamps the shared country axis to ten', async () => {
    const user = await signupVerifiedUser(app, { email: 'compare-axes@example.test' });
    const firstCodes = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'II', 'JJ'];
    const first = await seedSnapshot(
      user,
      0,
      firstCodes.map((countryCode) => ({ countryCode, visits: 10 })),
      100,
    );
    const second = await seedSnapshot(
      user,
      1,
      [
        { countryCode: 'KK', visits: 100 },
        { countryCode: 'LL', visits: 100 },
        ...firstCodes.slice(0, 8).map((countryCode) => ({ countryCode, visits: 1 })),
      ],
      208,
    );
    const response = await request(app)
      .get(`/api/competitors/traffic-snapshots/compare?ids=${first},${second}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(response.body.axes.countryCodes).toEqual([
      'KK',
      'LL',
      'AA',
      'BB',
      'CC',
      'DD',
      'EE',
      'FF',
      'GG',
      'HH',
    ]);
  });
});
