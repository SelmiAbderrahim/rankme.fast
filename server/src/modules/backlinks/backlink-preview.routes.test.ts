import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { translate } from '../../shared/i18n/index.js';
import { createFakeBacklinkProvider } from '../../shared/providers/index.js';
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
import { computeVendorCacheKey } from '../../shared/vendor-cache/cache-key.js';
import { createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import { setBacklinksDb } from './backlinks.holder.js';
import {
  backlinkDeepPreviewBodySchema,
  linkGapPreviewBodySchema,
} from './backlink-preview.schema.js';
import {
  BACKLINK_VENDOR_OPERATIONS,
  backlinkBulkRanksCacheParams,
  backlinkCompetitorsCacheParams,
  deepVendorCacheParams,
} from './backlink-vendor-operations.js';

const app = createApp();
const originalEnabled = env.LINK_INTELLIGENCE_ENABLED;

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function populateCache(
  operation: string,
  params: Record<string, unknown>,
  payload: unknown,
): Promise<void> {
  const fetchedAt = new Date();
  await createVendorCacheRepo(getTestDb() as never).upsert({
    capability: 'backlink',
    operation,
    cacheKey: computeVendorCacheKey({ capability: 'backlink', operation, params }),
    params,
    payload,
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + 60_000),
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setBacklinksDb(db as never);
});

afterAll(async () => {
  (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = originalEnabled;
  setBacklinksDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = true;
});

describe('Link Intelligence previews', () => {
  it('requires authentication and validates both strict request boundaries', async () => {
    await request(app)
      .post('/api/backlinks/deep/preview')
      .send({ type: 'history', domain: 'example.com', limit: 12 })
      .expect(401);
    expect(() => backlinkDeepPreviewBodySchema.parse({ type: 'history', domain: 'localhost' }))
      .toThrow();
    expect(() => linkGapPreviewBodySchema.parse({ ownDomain: 'example.com', competitors: [] }))
      .toThrow();
    expect(() => backlinkDeepPreviewBodySchema.parse({
      type: 'bulkRanks',
      domains: ['one.example'],
      extra: true,
    })).toThrow();
    expect(deepVendorCacheParams({
      type: 'bulkRanks',
      domain: 'example.com',
    })).toEqual({ domains: [] });
  });

  it('returns a community preview with no capacity fields', async () => {
    const user = await seedUser('community@preview.test');
    const response = await request(app)
      .post('/api/backlinks/deep/preview')
      .set('Cookie', user.cookie)
      .send({ type: 'history', domain: 'example.com', limit: 12 })
      .expect(200);
    expect(response.body).toMatchObject({
      deploymentMode: 'community',
      capacityEnforced: false,
      feature: 'link_intelligence',
      operation: BACKLINK_VENDOR_OPERATIONS.history,
      productUnits: 1,
      cachedStatus: 'miss',
    });
    expect(typeof response.body.estimatedAt).toBe('string');
    expect(response.body.breakdown).toEqual([
      expect.objectContaining({ productUnits: 1, cachedStatus: 'miss' }),
    ]);
    for (const key of ['remainingBaseUnits', 'remainingPackUnits', 'canFit', 'packs', 'willConsume']) {
      expect(response.body).not.toHaveProperty(key);
    }
  });

  it('discloses fresh then cached from a fixture-populated vendor_cache row', async () => {
    const user = await seedUser('cache@preview.test');
    const body = { type: 'history' as const, domain: 'example.com', limit: 12 };
    const first = await request(app)
      .post('/api/backlinks/deep/preview')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    expect(first.body.cachedStatus).toBe('miss');

    const fixture = await createFakeBacklinkProvider().getHistory!('example.com', { limit: 12 });
    const params = deepVendorCacheParams({ ...body, domains: [] });
    await populateCache(BACKLINK_VENDOR_OPERATIONS.history, params, fixture);
    const cached = await request(app)
      .post('/api/backlinks/deep/preview')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    expect(cached.body.cachedStatus).toBe('hit');

    await populateCache(BACKLINK_VENDOR_OPERATIONS.history, params, { malformed: true });
    const malformed = await request(app)
      .post('/api/backlinks/deep/preview')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    expect(malformed.body.cachedStatus).toBe('miss');
  });

  it('deduplicates gap competitors, combines two-stage cache disclosure, and rejects the own domain', async () => {
    const user = await seedUser('gap@preview.test');
    const competitorParams = backlinkCompetitorsCacheParams('rival.example', 500);
    await populateCache(
      BACKLINK_VENDOR_OPERATIONS.competitors,
      competitorParams,
      [{ domain: 'link.example', intersections: 3, rank: 40 }],
    );
    const bulkParams = backlinkBulkRanksCacheParams(['link.example']);
    await populateCache(
      BACKLINK_VENDOR_OPERATIONS.bulkRanks,
      bulkParams,
      [{ domain: 'link.example', rank: 42 }],
    );

    const response = await request(app)
      .post('/api/backlinks/gap/preview')
      .set('Cookie', user.cookie)
      .send({
        ownDomain: 'example.com',
        competitors: [
          'HTTPS://WWW.Rival.Example/path',
          'rival.example',
          'other.example',
        ],
      })
      .expect(200);
    expect(response.body).toMatchObject({
      operation: 'link-gap',
      productUnits: 2,
      cachedStatus: 'partial',
    });
    expect(response.body.breakdown).toEqual([
      expect.objectContaining({ operationKey: 'gap:rival.example', cachedStatus: 'hit' }),
      expect.objectContaining({ operationKey: 'gap:other.example', cachedStatus: 'miss' }),
    ]);

    await populateCache(
      BACKLINK_VENDOR_OPERATIONS.competitors,
      backlinkCompetitorsCacheParams('other.example', 500),
      [{ domain: 'other-link.example', intersections: 1, rank: null }],
    );
    const missingBulk = await request(app)
      .post('/api/backlinks/gap/preview')
      .set('Cookie', user.cookie)
      .send({ ownDomain: 'example.com', competitors: ['other.example'] })
      .expect(200);
    expect(missingBulk.body.cachedStatus).toBe('miss');

    await populateCache(
      BACKLINK_VENDOR_OPERATIONS.competitors,
      backlinkCompetitorsCacheParams('empty.example', 500),
      [],
    );
    const cachedEmpty = await request(app)
      .post('/api/backlinks/gap/preview')
      .set('Cookie', user.cookie)
      .send({ ownDomain: 'example.com', competitors: ['empty.example'] })
      .expect(200);
    expect(cachedEmpty.body.cachedStatus).toBe('hit');

    const rejected = await request(app)
      .post('/api/backlinks/gap/preview')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'fr')
      .send({ ownDomain: 'example.com', competitors: ['www.example.com'] })
      .expect(400);
    expect(rejected.body.error.message).toBe(
      translate('fr', 'backlinks.errors.gapDomainConflict'),
    );
  });

  it('supports singular and list bulk-rank previews and honors the kill switch', async () => {
    const user = await seedUser('bulk@preview.test');
    for (const body of [
      { type: 'bulkRanks', domain: 'one.example' },
      { type: 'bulkRanks', domains: ['one.example', 'ONE.EXAMPLE', 'two.example'] },
    ]) {
      const response = await request(app)
        .post('/api/backlinks/deep/preview')
        .set('Cookie', user.cookie)
        .send(body)
        .expect(200);
      expect(response.body.productUnits).toBe(1);
    }
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = false;
    const disabled = await request(app)
      .post('/api/backlinks/deep/preview')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'fr')
      .send({ type: 'anchors', domain: 'example.com' })
      .expect(503);
    expect(disabled.body.error.message).toBe(translate('fr', 'backlinks.errors.unavailable'));
    await request(app)
      .post('/api/backlinks/gap/preview')
      .set('Cookie', user.cookie)
      .send({ ownDomain: 'example.com', competitors: ['rival.example'] })
      .expect(503);
  });
});
