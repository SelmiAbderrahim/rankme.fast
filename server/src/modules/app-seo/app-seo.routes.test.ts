import mongoose from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  appChartSnapshots,
  appKeywords,
  appListingSnapshots,
  appRankSnapshots,
  vendorResponses,
} from '../../db/schema/index.js';
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
import { AppProfile } from './app-profile.model.js';
import { getAppSeoDb, setAppSeoDb } from './app-seo.holder.js';

const app = createApp();
let emailSequence = 0;
let originalEnabled = true;

const observation = {
  sourceKind: 'provider_observation' as const,
  sourceLabel: 'dataforseo' as const,
  observedAt: '2026-08-09T12:00:00.000Z',
  freshUntil: null,
  freshness: 'fresh' as const,
  market: null,
  sampleCount: 1,
  coverageNoteKey: null,
};

async function seedUser(): Promise<TestUser> {
  emailSequence += 1;
  return signupVerifiedUser(app, {
    email: `app-seo-${emailSequence}@example.test`,
  });
}

async function seedSite(user: TestUser, domain: string): Promise<string> {
  const site = await Site.create({
    accountId: user.id,
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

function register(
  user: TestUser,
  siteId: string,
  body: { playPackageId?: string; appStoreId?: string; paired?: boolean },
) {
  return request(app)
    .post(`/api/sites/${siteId}/apps/profiles`)
    .set('Cookie', user.cookie)
    .send(body);
}

beforeAll(async () => {
  await startMemoryMongo();
  await AppProfile.syncIndexes();
  const db = await startTestPostgres();
  installTestAuth();
  setAppSeoDb(db as never);
});

afterAll(async () => {
  setAppSeoDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  originalEnabled = env.APP_SEO_ENABLED;
  env.APP_SEO_ENABLED = true;
});

afterEach(() => {
  env.APP_SEO_ENABLED = originalEnabled;
});

describe('App SEO profile registration routes', () => {
  it('registers Play-only, Apple-only, and paired profile shapes without vendor calls', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, 'profile-shapes.example');
    const bodies = [
      { playPackageId: 'fast.rankme.android' },
      { appStoreId: '123456789' },
      {
        playPackageId: 'fast.rankme.paired',
        appStoreId: '987654321',
        paired: true,
      },
    ];

    for (const body of bodies) {
      const response = await register(user, siteId, body);
      expect(response.status).toBe(201);
      expect(response.body.profile).toMatchObject({ siteId, ...body });
    }
    expect(await AppProfile.countDocuments({ accountId: user.id })).toBe(3);
    expect(await getTestDb().select().from(vendorResponses)).toEqual([]);
  });

  it('returns localized format errors and a deterministic duplicate conflict', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, 'validation.example');
    const invalid = await register(user, siteId, { playPackageId: 'not-a-package' });
    expect(invalid.status).toBe(400);

    expect((await register(user, siteId, { playPackageId: 'fast.rankme.duplicate' })).status)
      .toBe(201);
    const duplicate = await register(user, siteId, {
      playPackageId: 'fast.rankme.duplicate',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe(
      translate('en', 'appSeo.errors.duplicate'),
    );
  });

  it('registers profiles without a live-count cap and re-registers after deletion', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, 'unlimited.example');
    const first = await register(user, siteId, { playPackageId: 'fast.rankme.one' });
    expect(first.status).toBe(201);
    for (const playPackageId of ['fast.rankme.two', 'fast.rankme.three', 'fast.rankme.four']) {
      expect((await register(user, siteId, { playPackageId })).status).toBe(201);
    }
    expect(await AppProfile.countDocuments({ accountId: user.id })).toBe(4);

    const removed = await request(app)
      .delete(`/api/sites/${siteId}/apps/profiles/${first.body.profile.id}`)
      .set('Cookie', user.cookie);
    expect(removed.status).toBe(204);
    expect((await register(user, siteId, { playPackageId: 'fast.rankme.one' })).status)
      .toBe(201);
  });

  it('checks the kill switch before ownership', async () => {
    const user = await seedUser();
    const foreign = await seedUser();
    const ownedSiteId = await seedSite(user, 'gate-order-owned.example');
    const foreignSiteId = await seedSite(foreign, 'gate-order.example');
    env.APP_SEO_ENABLED = false;
    try {
      const disabled = await register(user, ownedSiteId, {
        playPackageId: 'fast.rankme.disabled',
      });
      expect(disabled.status).toBe(503);
      expect(disabled.body.error.message).toBe(
        translate('en', 'appSeo.errors.productUnavailable'),
      );
    } finally {
      env.APP_SEO_ENABLED = true;
    }
    const foreignResponse = await register(user, foreignSiteId, {
      playPackageId: 'fast.rankme.foreign',
    });
    expect(foreignResponse.status).toBe(404);
  });
});

describe.each(['POST', 'GET', 'DELETE'] as const)(
  '%s owner-scoped profile route',
  (method) => {
    it('collapses malformed, foreign, and missing Site ids to the same 404', async () => {
      const owner = await seedUser();
      const stranger = await seedUser();
      const foreignSiteId = await seedSite(stranger, `${method.toLowerCase()}-foreign.example`);
      const missingSiteId = new mongoose.Types.ObjectId().toHexString();
      const profileId = new mongoose.Types.ObjectId().toHexString();
      const makeRequest = (siteId: string) => {
        const path = `/api/sites/${siteId}/apps/profiles${
          method === 'DELETE' ? `/${profileId}` : ''
        }`;
        if (method === 'POST') {
          return request(app)
            .post(path)
            .set('Cookie', owner.cookie)
            .send({ playPackageId: 'fast.rankme.ownercheck' });
        }
        if (method === 'DELETE') {
          return request(app).delete(path).set('Cookie', owner.cookie);
        }
        return request(app).get(path).set('Cookie', owner.cookie);
      };

      for (const siteId of ['malformed', foreignSiteId, missingSiteId]) {
        const response = await makeRequest(siteId);
        expect(response.status).toBe(404);
      }
    });
  },
);

describe('stored reads, deletion, and relational cascades', () => {
  it('keeps the list readable while flag-off blocks POST and DELETE', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, 'flag-off.example');
    const created = await register(user, siteId, {
      playPackageId: 'fast.rankme.persisted',
    });
    env.APP_SEO_ENABLED = false;
    try {
      const blockedPost = await register(user, siteId, {
        appStoreId: '123456789',
      });
      expect(blockedPost.status).toBe(503);
      expect(blockedPost.body.error.message).toBe(
        translate('en', 'appSeo.errors.productUnavailable'),
      );

      const listed = await request(app)
        .get(`/api/sites/${siteId}/apps/profiles`)
        .set('Cookie', user.cookie);
      expect(listed.status).toBe(200);
      expect(listed.body.items).toMatchObject([
        { id: created.body.profile.id, playPackageId: 'fast.rankme.persisted' },
      ]);

      const blockedDelete = await request(app)
        .delete(`/api/sites/${siteId}/apps/profiles/${created.body.profile.id}`)
        .set('Cookie', user.cookie)
        .set('Accept-Language', 'fr');
      expect(blockedDelete.status).toBe(503);
      expect(blockedDelete.body.error.message).toBe(
        translate('fr', 'appSeo.errors.productUnavailable'),
      );
    } finally {
      env.APP_SEO_ENABLED = true;
    }
  });

  it('returns 404 for malformed, missing, foreign-account, and cross-site profiles', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const ownerSiteId = await seedSite(owner, 'profile-owner.example');
    const siblingSiteId = await seedSite(owner, 'profile-sibling.example');
    const strangerSiteId = await seedSite(stranger, 'profile-stranger.example');
    const sibling = await AppProfile.create({
      accountId: owner.id,
      siteId: siblingSiteId,
      playPackageId: 'fast.rankme.sibling',
    });
    const foreign = await AppProfile.create({
      accountId: stranger.id,
      siteId: strangerSiteId,
      playPackageId: 'fast.rankme.stranger',
    });

    for (const profileId of [
      'malformed',
      new mongoose.Types.ObjectId().toHexString(),
      String(foreign._id),
      String(sibling._id),
    ]) {
      const response = await request(app)
        .delete(`/api/sites/${ownerSiteId}/apps/profiles/${profileId}`)
        .set('Cookie', owner.cookie);
      expect(response.status).toBe(404);
    }
  });

  it('deletes owned Postgres history and Mongo descendants without touching colliding tenants', async () => {
    const owner = await seedUser();
    const control = await seedUser();
    const siteId = await seedSite(owner, 'cascade-owner.example');
    const controlSiteId = await seedSite(control, 'cascade-control.example');
    const profile = await AppProfile.create({
      accountId: owner.id,
      siteId,
      appStoreId: '123456789',
    });
    const controlProfile = await AppProfile.create({
      accountId: control.id,
      siteId: controlSiteId,
      appStoreId: '987654321',
    });
    const db = getTestDb();
    const [keyword, controlKeyword] = await db
      .insert(appKeywords)
      .values([
        {
          accountId: owner.id,
          siteId,
          profileId: String(profile._id),
          store: 'app_store',
          phrase: 'owned phrase',
          locationCode: 2840,
          languageCode: 'en',
        },
        {
          accountId: control.id,
          siteId: controlSiteId,
          profileId: String(controlProfile._id),
          store: 'app_store',
          phrase: 'control phrase',
          locationCode: 2840,
          languageCode: 'en',
        },
      ])
      .returning({ id: appKeywords.id });
    await db.insert(appRankSnapshots).values([
      {
        accountId: owner.id,
        siteId,
        keywordId: keyword!.id,
        checkedAt: new Date(),
        observationMeta: observation,
      },
      {
        accountId: control.id,
        siteId: controlSiteId,
        keywordId: controlKeyword!.id,
        checkedAt: new Date(),
        observationMeta: observation,
      },
    ]);
    await db.insert(appChartSnapshots).values({
      accountId: owner.id,
      siteId,
      profileId: String(profile._id),
      store: 'app_store',
      chartId: 'top_free',
      checkedAt: new Date(),
      observationMeta: observation,
    });
    await db.insert(appListingSnapshots).values({
      accountId: owner.id,
      siteId,
      profileId: String(profile._id),
      store: 'app_store',
      capturedAt: new Date(),
      listing: {},
      findings: {},
      observationMeta: observation,
    } as never);

    const childSchema = new mongoose.Schema({
      profileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AppProfile',
        required: true,
      },
    });
    const grandchildSchema = new mongoose.Schema({
      parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AppProfileCascadeChild',
        required: true,
      },
    });
    const Child = mongoose.model('AppProfileCascadeChild', childSchema);
    const Grandchild = mongoose.model('AppProfileCascadeGrandchild', grandchildSchema);
    try {
      const child = await Child.create({ profileId: profile._id });
      const controlChild = await Child.create({ profileId: controlProfile._id });
      await Grandchild.create({ parentId: child._id });
      await Grandchild.create({ parentId: controlChild._id });

      const response = await request(app)
        .delete(`/api/sites/${siteId}/apps/profiles/${profile._id}`)
        .set('Cookie', owner.cookie);
      expect(response.status).toBe(204);
      expect(await AppProfile.exists({ _id: profile._id })).toBeNull();
      expect(await Child.exists({ _id: child._id })).toBeNull();
      expect(await Grandchild.exists({ parentId: child._id })).toBeNull();
      expect(await AppProfile.exists({ _id: controlProfile._id })).not.toBeNull();
      expect(await Child.exists({ _id: controlChild._id })).not.toBeNull();
      expect(await Grandchild.exists({ parentId: controlChild._id })).not.toBeNull();

      expect(await db.select().from(appChartSnapshots)).toEqual([]);
      expect(await db.select().from(appListingSnapshots)).toEqual([]);
      expect((await db.select().from(appKeywords)).map((row) => row.accountId))
        .toEqual([control.id]);
      expect((await db.select().from(appRankSnapshots)).map((row) => row.accountId))
        .toEqual([control.id]);
    } finally {
      await Promise.all([
        Child.collection.drop().catch(() => undefined),
        Grandchild.collection.drop().catch(() => undefined),
      ]);
      mongoose.deleteModel('AppProfileCascadeChild');
      mongoose.deleteModel('AppProfileCascadeGrandchild');
    }
  });
});

describe('App SEO dependency seam', () => {
  it('falls back to the production handle when the test database is cleared', () => {
    setAppSeoDb(null);
    try {
      expect(getAppSeoDb()).toBeDefined();
    } finally {
      setAppSeoDb(getTestDb() as never);
    }
  });
});
