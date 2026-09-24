import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { env } from '../../config/env.js';
import type { Queue } from 'bullmq';
import { appKeywords, appRankSnapshots } from '../../db/schema/index.js';
import { appSeoTrackingJobId } from '../../shared/queue/index.js';
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
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { AppProfile } from './app-profile.model.js';
import { registerAppProfileBodySchema } from './app-seo.schema.js';
import {
  deleteAppProfile,
  listAppProfiles,
  purgeAppProfileMongoChildren,
  registerAppProfile,
} from './app-seo.service.js';
import { setAppSeoTrackingQueue } from './keywords.queue-holder.js';
import { listAppKeywords } from './keywords.service.js';
import { appKeywordIsoWeek } from './weekly-checks.js';

// The `/api/sites/:siteId` param lease answers 404 before a nested router ever
// runs, so the service's own owner check is defence in depth that only a direct
// call can exercise.
let originalEnabled = true;

async function seedSite(accountId: string, domain: string): Promise<string> {
  const site = await Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

beforeAll(async () => {
  await startMemoryMongo();
  await AppProfile.syncIndexes();
  await startTestPostgres();
});

afterAll(async () => {
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
  setAppSeoTrackingQueue(null);
});

describe('service-level owner scope', () => {
  it('answers 404 for a foreign and a missing site on every entry point', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const strangerId = new mongoose.Types.ObjectId().toHexString();
    const foreignSiteId = await seedSite(strangerId, 'service-foreign.example');
    const missingSiteId = new mongoose.Types.ObjectId().toHexString();
    const profileId = new mongoose.Types.ObjectId().toHexString();
    const deps = { db: getTestDb() as never };

    for (const siteId of [foreignSiteId, missingSiteId]) {
      await expect(
        registerAppProfile({
          accountId,
          siteId,
          profile: { playPackageId: 'fast.rankme.service', paired: false },
        }),
      ).rejects.toMatchObject({ status: 404, message: 'appSeo.errors.notFound' });
      await expect(listAppProfiles({ accountId, siteId })).rejects.toBeInstanceOf(
        HttpError,
      );
      await expect(
        deleteAppProfile({ accountId, siteId, profileId }, deps),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it('answers 404 for a soft-deleted site the account still owns', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = await seedSite(accountId, 'service-deleting.example');
    await Site.updateOne(
      { _id: siteId },
      { $set: { deletionStartedAt: new Date() } },
    );
    await expect(listAppProfiles({ accountId, siteId })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('Mongo descendant purge', () => {
  it('skips a referencing collection with no rows and orders equal-depth peers by name', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = await seedSite(accountId, 'service-purge.example');
    const profile = await AppProfile.create({
      accountId,
      siteId,
      playPackageId: 'fast.rankme.purge',
    });

    const refSchema = () =>
      new mongoose.Schema({
        profileId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'AppProfile',
          required: true,
        },
      });
    // Two peers at the same depth force the comparator's name tiebreak; the
    // third references AppProfile but stores nothing, so its bounded walk step
    // finds no ids and is skipped.
    const First = mongoose.model('AppSeoPurgePeerAlpha', refSchema());
    const Second = mongoose.model('AppSeoPurgePeerBeta', refSchema());
    const Empty = mongoose.model('AppSeoPurgePeerEmpty', refSchema());

    try {
      await First.create({ profileId: profile._id });
      await Second.create({ profileId: profile._id });

      const deleted = await purgeAppProfileMongoChildren(String(profile._id));

      expect(deleted).toBe(2);
      expect(await First.countDocuments()).toBe(0);
      expect(await Second.countDocuments()).toBe(0);
      expect(await Empty.countDocuments()).toBe(0);
    } finally {
      await Promise.all([
        First.collection.drop().catch(() => undefined),
        Second.collection.drop().catch(() => undefined),
        Empty.collection.drop().catch(() => undefined),
      ]);
      mongoose.deleteModel('AppSeoPurgePeerAlpha');
      mongoose.deleteModel('AppSeoPurgePeerBeta');
      mongoose.deleteModel('AppSeoPurgePeerEmpty');
    }
  });
});

describe('registration body schema', () => {
  it('requires both store ids when the profile is marked as paired', () => {
    for (const body of [
      { playPackageId: 'fast.rankme.pairing', paired: true },
      { appStoreId: '123456789', paired: true },
    ]) {
      const parsed = registerAppProfileBodySchema.safeParse(body);
      expect(parsed.success).toBe(false);
      expect(
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => issue.message),
      ).toContain('appSeo.errors.pairedStoreIdsRequired');
    }

    expect(
      registerAppProfileBodySchema.safeParse({
        playPackageId: 'fast.rankme.pairing',
        appStoreId: '123456789',
        paired: true,
      }).success,
    ).toBe(true);
  });
});

describe('keyword check lifecycle', () => {
  it('returns queue-derived queued and failed states plus snapshot succeeded and idle states', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = await seedSite(accountId, 'keyword-lifecycle.example');
    const profile = await AppProfile.create({
      accountId,
      siteId,
      playPackageId: 'fast.rankme.lifecycle',
    });
    const db = getTestDb();
    const keywords = await db
      .insert(appKeywords)
      .values(['queued', 'succeeded', 'failed', 'legacy', 'idle'].map((phrase) => ({
        accountId,
        siteId,
        profileId: String(profile._id),
        store: 'google_play' as const,
        phrase,
        locationCode: 2840,
        languageCode: 'en',
      })))
      .returning({ id: appKeywords.id, phrase: appKeywords.phrase });
    const ids = new Map(keywords.map((keyword) => [keyword.phrase, keyword.id]));
    const observationMeta = {
      sourceKind: 'provider_observation' as const,
      sourceLabel: 'dataforseo',
      observedAt: '2026-08-11T22:23:34.000Z',
      freshUntil: null,
      freshness: 'fresh' as const,
      market: null,
      sampleCount: 1,
      coverageNoteKey: null,
    };
    await db.insert(appRankSnapshots).values([
      {
        accountId,
        siteId,
        keywordId: ids.get('succeeded')!,
        position: 7,
        checkedAt: new Date('2026-08-11T22:23:34.000Z'),
        observationMeta,
      },
      {
        accountId,
        siteId,
        keywordId: ids.get('legacy')!,
        position: 9,
        checkedAt: new Date('2026-08-04T22:23:34.000Z'),
        observationMeta,
      },
    ]);
    const stamp = appKeywordIsoWeek(new Date());
    const states = new Map<string, { state: string; finishedOn?: number }>([
      [appSeoTrackingJobId(ids.get('queued')!, stamp), { state: 'waiting' }],
      [appSeoTrackingJobId(ids.get('succeeded')!, stamp), { state: 'completed' }],
      [appSeoTrackingJobId(ids.get('failed')!, stamp), {
        state: 'failed',
        finishedOn: Date.parse('2026-08-11T22:23:31.000Z'),
      }],
    ]);
    setAppSeoTrackingQueue({
      getJob: async (id: string) => {
        const entry = states.get(id);
        return entry
          ? { getState: async () => entry.state, finishedOn: entry.finishedOn }
          : undefined;
      },
    } as unknown as Queue);

    const result = await listAppKeywords({
      accountId,
      siteId,
      profileId: String(profile._id),
    }, db);
    const byPhrase = new Map(result.items.map((keyword) => [keyword.phrase, keyword]));

    expect(byPhrase.get('queued')).toMatchObject({ checkStatus: 'queued' });
    expect(byPhrase.get('succeeded')).toMatchObject({
      checkStatus: 'succeeded',
      latestPosition: 7,
    });
    expect(byPhrase.get('failed')).toMatchObject({
      checkStatus: 'failed',
      lastFailedCheckAt: '2026-08-11T22:23:31.000Z',
    });
    expect(byPhrase.get('legacy')).toMatchObject({ checkStatus: 'succeeded' });
    expect(byPhrase.get('idle')).toMatchObject({ checkStatus: 'idle' });
  });
});

describe('profile registration', () => {
  it('creates unlimited profiles and maps a duplicate store id to 409', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = await seedSite(accountId, 'service-register.example');
    for (const playPackageId of ['fast.rankme.one', 'fast.rankme.two', 'fast.rankme.three']) {
      await expect(registerAppProfile({
        accountId,
        siteId,
        profile: { playPackageId, paired: false },
      })).resolves.toMatchObject({ siteId, playPackageId, appStoreId: null, paired: false });
    }
    await expect(registerAppProfile({
      accountId,
      siteId,
      profile: { playPackageId: 'fast.rankme.one', paired: false },
    })).rejects.toMatchObject({ status: 409, message: 'appSeo.errors.duplicate' });
    expect(await listAppProfiles({ accountId, siteId })).toHaveLength(3);
    await expect(registerAppProfile({
      accountId,
      siteId,
      profile: { paired: false },
    })).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
  });
});
