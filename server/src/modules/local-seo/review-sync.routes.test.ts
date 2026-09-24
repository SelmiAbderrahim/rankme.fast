/**
 * Review Intelligence route tests.
 *
 * Covers: source-setup CRUD, preview, the sync path (own → kill switch →
 * configured targets → run row → enqueue), cross-account 404 on every `:id`
 * and `profileId` surface, kill-switch behaviour (mutations refuse, stored
 * reads survive), and the read APIs.
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
import { setLocalSeoDb, setReviewSyncQueue } from './local-seo.holder.js';
import {
  LocalSeoReviewRow,
  LocalSeoReviewSource,
  LocalSeoReviewSyncRun,
} from './review-sync.model.js';

const app = createApp();
const GOOGLE_PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

let queueAdd: ReturnType<typeof vi.fn>;

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedProfile(accountId: string, domain = 'example.com'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

async function configureSource(
  user: TestUser,
  profileId: string,
  source: 'google' | 'trustpilot' | 'tripadvisor' = 'google',
  target: string = GOOGLE_PLACE_ID,
) {
  return request(app)
    .post('/api/local-seo/reviews/sources')
    .set('Cookie', user.cookie)
    .send({ profileId, source, target });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setLocalSeoDb(db as unknown as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setLocalSeoDb(null);
  setReviewSyncQueue(null);
  (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = true;
  queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
  setReviewSyncQueue({ add: queueAdd } as unknown as Queue);
});

describe('review source setup', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app)
      .post('/api/local-seo/reviews/sources')
      .send({ profileId: new mongoose.Types.ObjectId().toString(), source: 'google', target: GOOGLE_PLACE_ID });
    expect(res.status).toBe(401);
  });

  it('creates one source per (profile, source) and replaces the target on re-create', async () => {
    const user = await seedUser('src-create@x.co');
    const profileId = await seedProfile(user.id);

    const created = await configureSource(user, profileId);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ profileId, source: 'google', target: GOOGLE_PLACE_ID });

    const replaced = await configureSource(user, profileId, 'google', 'ChIJ_replacement_id_value');
    expect(replaced.status).toBe(201);
    expect(replaced.body.id).toBe(created.body.id);
    expect(replaced.body.target).toBe('ChIJ_replacement_id_value');
    expect(await LocalSeoReviewSource.countDocuments({ profileId })).toBe(1);
  });

  it('normalizes a trustpilot business domain and rejects a scheme-prefixed one', async () => {
    const user = await seedUser('src-tp@x.co');
    const profileId = await seedProfile(user.id);

    const ok = await configureSource(user, profileId, 'trustpilot', 'WWW.Example.COM');
    expect(ok.status).toBe(201);
    expect(ok.body.target).toBe('example.com');

    const scheme = await configureSource(user, profileId, 'trustpilot', 'https://example.com');
    expect(scheme.status).toBe(400);

    // Not a resolvable public domain — rejected by the shared site-URL validator.
    const notADomain = await configureSource(user, profileId, 'trustpilot', 'nodots');
    expect(notADomain.status).toBe(400);
  });

  it('accepts opaque provider-prefixed ids and rejects whitespace, controls, and over-bound ids', async () => {
    const user = await seedUser('src-bad@x.co');
    const profileId = await seedProfile(user.id);
    expect(
      (await configureSource(user, profileId, 'google', 'place_id:ChIJ!opaque')).status,
    ).toBe(201);
    expect((await configureSource(user, profileId, 'tripadvisor', 'has space')).status).toBe(400);
    expect((await configureSource(user, profileId, 'tripadvisor', 'bad\u0007id')).status).toBe(400);
    expect((await configureSource(user, profileId, 'tripadvisor', 'bad\u007fid')).status).toBe(400);
    expect((await configureSource(user, profileId, 'google', 'x'.repeat(201))).status).toBe(400);
    expect(
      (await configureSource(user, profileId, 'tripadvisor', 'location_id:60763')).status,
    ).toBe(201);
  });

  it('returns 404 for a profile owned by another account and for a malformed id', async () => {
    const owner = await seedUser('src-owner@x.co');
    const stranger = await seedUser('src-stranger@x.co');
    const profileId = await seedProfile(owner.id);

    expect((await configureSource(stranger, profileId)).status).toBe(404);
    const listed = await request(app)
      .get(`/api/local-seo/reviews/sources?profileId=${profileId}`)
      .set('Cookie', stranger.cookie);
    expect(listed.status).toBe(404);
  });

  it('lists sources for the owner and deletes one; a stranger gets 404 on delete', async () => {
    const owner = await seedUser('src-list@x.co');
    const stranger = await seedUser('src-list-other@x.co');
    const profileId = await seedProfile(owner.id);
    const created = await configureSource(owner, profileId);

    const listed = await request(app)
      .get(`/api/local-seo/reviews/sources?profileId=${profileId}`)
      .set('Cookie', owner.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.sources).toHaveLength(1);

    const strangerDelete = await request(app)
      .delete(`/api/local-seo/reviews/sources/${created.body.id}`)
      .set('Cookie', stranger.cookie);
    expect(strangerDelete.status).toBe(404);

    const ownerDelete = await request(app)
      .delete(`/api/local-seo/reviews/sources/${created.body.id}`)
      .set('Cookie', owner.cookie);
    expect(ownerDelete.status).toBe(200);
    expect(await LocalSeoReviewSource.countDocuments({ profileId })).toBe(0);
  });
});

describe('POST /api/local-seo/reviews/preview', () => {
  it('returns the community SpendPreview for one sync', async () => {
    const user = await seedUser('prev-pro@x.co');
    const profileId = await seedProfile(user.id);
    const res = await request(app)
      .post('/api/local-seo/reviews/preview')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google', 'trustpilot'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      deploymentMode: 'community',
      capacityEnforced: false,
      feature: 'review_intelligence',
      metric: 'review_syncs',
      productUnits: 1,
      cachedStatus: 'miss',
    });
    expect(res.body.breakdown[0].operationKey).toBe('review-sync:google+trustpilot');
  });

  it('rejects duplicate sources with 400', async () => {
    const user = await seedUser('prev-dupe@x.co');
    const profileId = await seedProfile(user.id);
    const res = await request(app)
      .post('/api/local-seo/reviews/preview')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google', 'google'] });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a cross-account profile', async () => {
    const owner = await seedUser('prev-owner@x.co');
    const stranger = await seedUser('prev-stranger@x.co');
    const profileId = await seedProfile(owner.id);
    const res = await request(app)
      .post('/api/local-seo/reviews/preview')
      .set('Cookie', stranger.cookie)
      .send({ profileId, sources: ['google'] });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/local-seo/reviews/sync', () => {
  it('creates a queued run and enqueues exactly one job', async () => {
    const user = await seedUser('sync-ok@x.co');
    const profileId = await seedProfile(user.id);
    await configureSource(user, profileId);

    const res = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr')
      .send({ profileId, sources: ['google'], depth: 25 });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: 'queued',
      depth: 25,
      outputLocale: 'fr',
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith(
      'review-sync',
      expect.objectContaining({ runId: res.body.runId, outputLocale: 'fr' }),
      expect.anything(),
    );

    const run = await LocalSeoReviewSyncRun.findById(res.body.runId);
    expect(run?.status).toBe('queued');
    expect(run?.aiTerminalState).toBe('pending');
    expect(run?.outputLocale).toBe('fr');
    expect(res.body).not.toHaveProperty('reservedUnits');
  });

  it('defaults depth to 100 and rejects a depth above the ceiling', async () => {
    const user = await seedUser('sync-depth@x.co');
    const profileId = await seedProfile(user.id);
    await configureSource(user, profileId);

    const ok = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'] });
    expect(ok.status).toBe(202);
    expect(ok.body.depth).toBe(100);

    const tooDeep = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'], depth: 101 });
    expect(tooDeep.status).toBe(400);
  });

  it('refuses a source with no configured target and never creates a run', async () => {
    const user = await seedUser('sync-unconfigured@x.co');
    const profileId = await seedProfile(user.id);
    const res = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ source: 'google' });
    expect(await LocalSeoReviewSyncRun.countDocuments()).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('fails the run and answers 503 when the enqueue fails', async () => {
    const user = await seedUser('sync-enqueue-fail@x.co');
    const profileId = await seedProfile(user.id);
    await configureSource(user, profileId);
    queueAdd.mockRejectedValueOnce(new Error('redis down'));

    const res = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'] });
    expect(res.status).toBe(503);
    const run = await LocalSeoReviewSyncRun.findOne({ accountId: user.id });
    expect(run?.status).toBe('failed');
  });

  it('answers 503 when the queue is not wired', async () => {
    const user = await seedUser('sync-no-queue@x.co');
    const profileId = await seedProfile(user.id);
    await configureSource(user, profileId);
    setReviewSyncQueue(null);
    const res = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'] });
    expect(res.status).toBe(503);
    expect(await LocalSeoReviewSyncRun.countDocuments()).toBe(0);
  });

  it('returns 404 for a cross-account profile before creating a run', async () => {
    const owner = await seedUser('sync-owner@x.co');
    const stranger = await seedUser('sync-stranger@x.co');
    const profileId = await seedProfile(owner.id);
    await configureSource(owner, profileId);
    const res = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', stranger.cookie)
      .send({ profileId, sources: ['google'] });
    expect(res.status).toBe(404);
    expect(await LocalSeoReviewSyncRun.countDocuments()).toBe(0);
  });

});

describe('REVIEW_INTELLIGENCE_ENABLED kill switch', () => {
  it('refuses every mutation with the localized product-unavailable response', async () => {
    const user = await seedUser('kill-mutate@x.co');
    const profileId = await seedProfile(user.id);
    const created = await configureSource(user, profileId);
    expect(created.status).toBe(201);

    (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = false;

    const source = await configureSource(user, profileId, 'trustpilot', 'example.com');
    expect(source.status).toBe(503);
    const removed = await request(app)
      .delete(`/api/local-seo/reviews/sources/${created.body.id}`)
      .set('Cookie', user.cookie);
    expect(removed.status).toBe(503);
    const preview = await request(app)
      .post('/api/local-seo/reviews/preview')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'] });
    expect(preview.status).toBe(503);
    const sync = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'de')
      .send({ profileId, sources: ['google'] });
    expect(sync.status).toBe(503);
    expect(sync.body.error.message).toBe(
      translate('de', 'reviewIntelligence.errors.productUnavailable'),
    );
    expect(await LocalSeoReviewSyncRun.countDocuments()).toBe(0);
  });

  it('still serves stored sources, runs, run detail and inventory while disabled', async () => {
    const user = await seedUser('kill-read@x.co');
    const profileId = await seedProfile(user.id);
    await configureSource(user, profileId);
    const submitted = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .send({ profileId, sources: ['google'] });
    expect(submitted.status).toBe(202);
    await LocalSeoReviewRow.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      profileId: new mongoose.Types.ObjectId(profileId),
      source: 'google',
      sourceReviewId: 'g-1',
      rating: 5,
      title: null,
      text: 'stored review',
      authorDisplayName: 'Sam',
      language: 'en',
      reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
      firstSeenRunId: new mongoose.Types.ObjectId(submitted.body.runId),
      fetchedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = false;

    const sources = await request(app)
      .get(`/api/local-seo/reviews/sources?profileId=${profileId}`)
      .set('Cookie', user.cookie);
    expect(sources.status).toBe(200);
    const runs = await request(app)
      .get(`/api/local-seo/reviews/runs?profileId=${profileId}`)
      .set('Cookie', user.cookie);
    expect(runs.status).toBe(200);
    expect(runs.body.runs).toHaveLength(1);
    const detail = await request(app)
      .get(`/api/local-seo/reviews/runs/${submitted.body.runId}`)
      .set('Cookie', user.cookie);
    expect(detail.status).toBe(200);
    const inventory = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}`)
      .set('Cookie', user.cookie);
    expect(inventory.status).toBe(200);
    expect(inventory.body.reviews).toHaveLength(1);
  });
});

describe('review read APIs', () => {
  async function seedRuns(user: TestUser, profileId: string, count: number) {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const run = await LocalSeoReviewSyncRun.create({
        accountId: new mongoose.Types.ObjectId(user.id),
        profileId: new mongoose.Types.ObjectId(profileId),
        sources: ['google'],
        depth: 100,
        status: 'succeeded',
        perSourceOutcomes: [{ source: 'google', outcome: 'ok', retained: 1, errorCode: null }],
        retainedCount: 1,
        aiTerminalState: 'pending',
        aiCostMicros: null,
        completedAt: new Date(Date.UTC(2026, 0, index + 1)),
      });
      ids.push(String(run._id));
    }
    return ids;
  }

  it('paginates runs newest-first through the opaque cursor', async () => {
    const user = await seedUser('runs-page@x.co');
    const profileId = await seedProfile(user.id);
    await seedRuns(user, profileId, 3);

    const first = await request(app)
      .get(`/api/local-seo/reviews/runs?profileId=${profileId}&limit=2`)
      .set('Cookie', user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.runs).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app)
      .get(
        `/api/local-seo/reviews/runs?profileId=${profileId}&limit=2&cursor=${encodeURIComponent(
          first.body.nextCursor,
        )}`,
      )
      .set('Cookie', user.cookie);
    expect(second.status).toBe(200);
    expect(second.body.runs).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('serves stored themes with clamped citation excerpts and 404s cross-account', async () => {
    const owner = await seedUser('themes-owner@x.co');
    const stranger = await seedUser('themes-stranger@x.co');
    const profileId = await seedProfile(owner.id);
    const [runId] = await seedRuns(owner, profileId, 1);
    const storedReviewIds: string[] = [];
    for (const sourceReviewId of ['g-1', 'g-2']) {
      const row = await LocalSeoReviewRow.create({
        accountId: new mongoose.Types.ObjectId(owner.id),
        profileId: new mongoose.Types.ObjectId(profileId),
        source: 'google',
        sourceReviewId,
        rating: 2,
        title: null,
        text: 'z'.repeat(900),
        authorDisplayName: null,
        language: 'en',
        reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
        firstSeenRunId: new mongoose.Types.ObjectId(runId),
        fetchedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      storedReviewIds.push(String(row._id));
    }
    await LocalSeoReviewSyncRun.updateOne(
      { _id: runId },
      {
        $set: {
          aiTerminalState: 'themes-ok',
          aiCostMicros: 4_000,
          aiPassStartedAt: new Date('2026-01-02T00:01:00.000Z'),
          aiCompletedAt: new Date('2026-01-02T00:01:01.000Z'),
          aiInputCount: 2,
          aiThemes: [
            {
              kind: 'complaint',
              label: 'Waits',
              summary: 'Long waits.',
              citedReviewIds: storedReviewIds,
            },
          ],
        },
      },
    );
    await LocalSeoReviewSyncRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(runId) },
      { $unset: { outputLocale: '' } },
    );

    const response = await request(app)
      .get(`/api/local-seo/reviews/themes/${runId}`)
      .set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.terminal).toBe('themes-ok');
    expect(response.body.outputLocale).toBe('en');
    expect(response.body.praiseThemes).toEqual([]);
    expect(response.body.complaintThemes).toHaveLength(1);
    expect(response.body.observation).toMatchObject({
      sourceKind: 'ai_interpretation',
      sourceLabel: 'rankme_ai',
      sampleCount: 2,
    });
    for (const citation of response.body.complaintThemes[0].citations) {
      expect(citation.excerpt.length).toBeLessThanOrEqual(300);
    }

    const detail = await request(app)
      .get(`/api/local-seo/reviews/runs/${runId}`)
      .set('Cookie', owner.cookie);
    expect(detail.body).toMatchObject({
      aiTerminalState: 'themes-ok',
      aiThemeCount: 1,
      outputLocale: 'en',
    });
    expect(
      (await LocalSeoReviewSyncRun.collection.findOne({
        _id: new mongoose.Types.ObjectId(runId),
      }))?.outputLocale,
    ).toBeUndefined();

    const cross = await request(app)
      .get(`/api/local-seo/reviews/themes/${runId}`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);
  });

  it('rejects an undecodable cursor and a well-formed cursor of the wrong shape with 400', async () => {
    const user = await seedUser('runs-cursor@x.co');
    const profileId = await seedProfile(user.id);
    const undecodable = await request(app)
      .get(`/api/local-seo/reviews/runs?profileId=${profileId}&cursor=not-a-cursor`)
      .set('Cookie', user.cookie);
    expect(undecodable.status).toBe(400);

    const wrongShape = Buffer.from(JSON.stringify({ createdAt: 'yesterday' })).toString(
      'base64url',
    );
    const mismatched = await request(app)
      .get(
        `/api/local-seo/reviews/runs?profileId=${profileId}&cursor=${encodeURIComponent(wrongShape)}`,
      )
      .set('Cookie', user.cookie);
    expect(mismatched.status).toBe(400);
  });

  it('returns 404 on a run owned by another account and on a malformed run id', async () => {
    const owner = await seedUser('run-owner@x.co');
    const stranger = await seedUser('run-stranger@x.co');
    const profileId = await seedProfile(owner.id);
    const [runId] = await seedRuns(owner, profileId, 1);

    const cross = await request(app)
      .get(`/api/local-seo/reviews/runs/${runId}`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);

    const malformed = await request(app)
      .get('/api/local-seo/reviews/runs/not-an-object-id')
      .set('Cookie', owner.cookie);
    expect(malformed.status).toBe(400);

    const missing = await request(app)
      .get(`/api/local-seo/reviews/runs/${new mongoose.Types.ObjectId().toString()}`)
      .set('Cookie', owner.cookie);
    expect(missing.status).toBe(404);
  });

  it('filters the inventory by source, rating and free text, newest-first with nulls last', async () => {
    const user = await seedUser('inventory@x.co');
    const profileId = await seedProfile(user.id);
    const [runId] = await seedRuns(user, profileId, 1);
    const base = {
      accountId: new mongoose.Types.ObjectId(user.id),
      profileId: new mongoose.Types.ObjectId(profileId),
      firstSeenRunId: new mongoose.Types.ObjectId(runId),
      fetchedAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    await LocalSeoReviewRow.create([
      {
        ...base,
        source: 'google',
        sourceReviewId: 'g-newest',
        rating: 5,
        text: 'Fast onboarding and great support',
        reviewedAt: new Date('2026-01-20T00:00:00.000Z'),
      },
      {
        ...base,
        source: 'trustpilot',
        sourceReviewId: 'tp-older',
        rating: 2,
        text: 'Support was slow to reply',
        reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        ...base,
        source: 'google',
        sourceReviewId: 'g-undated',
        rating: null,
        title: null,
        authorDisplayName: null,
        language: null,
        text: 'No date on this one',
        reviewedAt: null,
      },
    ]);

    const all = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}`)
      .set('Cookie', user.cookie);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.reviews.map((row: { sourceReviewId: string }) => row.sourceReviewId)).toEqual([
      'g-newest',
      'tp-older',
      'g-undated',
    ]);
    expect(all.body.observation).toMatchObject({
      sourceKind: 'provider_observation',
      observedAt: '2026-02-01T00:00:00.000Z',
      sampleCount: 3,
    });

    const bySource = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&src=trustpilot`)
      .set('Cookie', user.cookie);
    expect(bySource.body.reviews).toHaveLength(1);

    const byRating = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&rating=5`)
      .set('Cookie', user.cookie);
    expect(byRating.body.total).toBe(1);
    expect(byRating.body.reviews[0]).toMatchObject({
      sourceReviewId: 'g-newest',
      title: null,
      authorDisplayName: null,
    });

    const byQuery = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&q=support`)
      .set('Cookie', user.cookie);
    expect(byQuery.body.total).toBe(2);

    // Regex metacharacters in `q` are escaped, never compiled as a pattern.
    const hostile = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&q=${encodeURIComponent('.*')}`)
      .set('Cookie', user.cookie);
    expect(hostile.status).toBe(200);
    expect(hostile.body.total).toBe(0);

    const ratingHigh = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&sort=rating-high`)
      .set('Cookie', user.cookie);
    expect(
      ratingHigh.body.reviews.map((entry: { sourceReviewId: string }) => entry.sourceReviewId),
    ).toEqual(['g-newest', 'tp-older', 'g-undated']);

    const sourceSort = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&sort=source`)
      .set('Cookie', user.cookie);
    expect(
      sourceSort.body.reviews.map((entry: { sourceReviewId: string }) => entry.sourceReviewId),
    ).toEqual(['g-newest', 'g-undated', 'tp-older']);

    const badSort = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&sort=oldest`)
      .set('Cookie', user.cookie);
    expect(badSort.status).toBe(400);
  });

  it('reports pages but exports every matching row, neutralized, for free and 404 cross-account', async () => {
    const owner = await seedUser('inv-owner@x.co');
    const stranger = await seedUser('inv-stranger@x.co');
    const profileId = await seedProfile(owner.id);
    const [runId] = await seedRuns(owner, profileId, 1);
    await LocalSeoReviewRow.create(
      Array.from({ length: 51 }, (_unused, index) => ({
        accountId: new mongoose.Types.ObjectId(owner.id),
        profileId: new mongoose.Types.ObjectId(profileId),
        firstSeenRunId: new mongoose.Types.ObjectId(runId),
        fetchedAt: new Date('2026-02-01T00:00:00.000Z'),
        source: 'google' as const,
        sourceReviewId: `g-${index}`,
        rating: index === 1 ? null : 4,
        title: index === 0 ? '@hostile title' : null,
        text:
          index === 0
            ? '=SUM(A1) <script>alert(1)</script> \u202E'
            : `review ${index}`,
        authorDisplayName: index === 0 ? '+hostile author' : null,
        reviewedAt: index === 1 ? null : new Date(Date.UTC(2026, 0, 1, index)),
      })),
    );

    const page1 = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}`)
      .set('Cookie', owner.cookie);
    expect(page1.body.reviews).toHaveLength(50);
    expect(page1.body.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`/api/local-seo/reviews/reviews?profileId=${profileId}&page=2`)
      .set('Cookie', owner.cookie);
    expect(page2.body.reviews).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);

    // Stored-data reads survive the kill switch. The export is not paginated.
    (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = false;
    const exported = await request(app)
      .get(`/api/local-seo/reviews/export.csv?profileId=${profileId}`)
      .set('Cookie', owner.cookie);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.headers['content-disposition']).toContain('reviews.csv');
    expect(exported.text.startsWith('﻿rating,reviewed_at,source,title,text,author\r\n')).toBe(true);
    // One header + all 51 stored rows (not the visible page of 50).
    expect(exported.text.match(/\r\n/g)).toHaveLength(52);
    expect(exported.text).toContain('review 50');
    expect(exported.text).toContain("'@hostile title");
    expect(exported.text).toContain("'=SUM(A1) <script>alert(1)</script> \u202E");
    expect(exported.text).toContain("'+hostile author");

    const cross = await request(app)
      .get(`/api/local-seo/reviews/export.csv?profileId=${profileId}`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);
  });
});

describe('review stats read', () => {
  async function seedRun(user: TestUser, profileId: string): Promise<string> {
    const run = await LocalSeoReviewSyncRun.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      profileId: new mongoose.Types.ObjectId(profileId),
      sources: ['google'],
      depth: 100,
      status: 'succeeded',
      perSourceOutcomes: [{ source: 'google', outcome: 'ok', retained: 2, errorCode: null }],
      retainedCount: 2,
      aiTerminalState: 'pending',
      aiCostMicros: null,
      completedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    return String(run._id);
  }

  async function seedRow(
    user: TestUser,
    profileId: string,
    runId: string,
    overrides: {
      sourceReviewId: string;
      source?: 'google' | 'trustpilot' | 'tripadvisor';
      rating?: number | null;
      reviewedAt?: Date | null;
    },
  ) {
    await LocalSeoReviewRow.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      profileId: new mongoose.Types.ObjectId(profileId),
      source: overrides.source ?? 'google',
      sourceReviewId: overrides.sourceReviewId,
      rating: overrides.rating === undefined ? 4 : overrides.rating,
      title: null,
      text: 'stored review',
      authorDisplayName: null,
      language: 'en',
      reviewedAt: overrides.reviewedAt === undefined ? new Date('2026-01-05T00:00:00.000Z') : overrides.reviewedAt,
      firstSeenRunId: new mongoose.Types.ObjectId(runId),
      fetchedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
  }

  it('computes the four series over the live inventory for the run profile', async () => {
    const user = await seedUser('stats-owner@x.co');
    const profileId = await seedProfile(user.id);
    const runId = await seedRun(user, profileId);
    await seedRow(user, profileId, runId, { sourceReviewId: 'g-1', rating: 5 });
    await seedRow(user, profileId, runId, {
      sourceReviewId: 'tp-1',
      source: 'trustpilot',
      rating: null,
      reviewedAt: new Date('2026-03-02T00:00:00.000Z'),
    });
    await seedRow(user, profileId, runId, {
      sourceReviewId: 'ta-1',
      source: 'tripadvisor',
      rating: 3,
      reviewedAt: null,
    });

    const res = await request(app)
      .get(`/api/local-seo/reviews/stats/${runId}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(runId);
    expect(res.body.profileId).toBe(profileId);
    expect(res.body.totalReviews).toBe(3);
    expect(res.body.ratingHistogram).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, unrated: 1 });
    expect(res.body.sourceMix).toEqual({ google: 1, trustpilot: 1, tripadvisor: 1, total: 3 });
    // January + the February gap month + March; the undated row is excluded.
    expect(res.body.monthlyVelocity.map((bucket: { ymKey: string }) => bucket.ymKey)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(res.body.monthlyVelocity[1].total).toBe(0);
    expect(res.body.averageRatingTrend[0].total).toBe(5);
    expect(res.body.averageRatingTrend[1].total).toBeNull();
    expect(res.body.averageRatingTrend[2].total).toBeNull();
    expect(res.body.observation).toMatchObject({
      sourceKind: 'provider_observation',
      observedAt: '2026-02-01T00:00:00.000Z',
      sampleCount: 3,
    });
  });

  it('returns empty series for a run whose profile has no stored rows', async () => {
    const user = await seedUser('stats-empty@x.co');
    const profileId = await seedProfile(user.id);
    const runId = await seedRun(user, profileId);

    const res = await request(app)
      .get(`/api/local-seo/reviews/stats/${runId}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalReviews: 0,
      monthlyVelocity: [],
      averageRatingTrend: [],
      ratingHistogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 },
      sourceMix: { google: 0, trustpilot: 0, tripadvisor: 0, total: 0 },
      observation: null,
    });
  });

  it('stays readable while the kill switch is off and ignores the AI terminal state', async () => {
    const user = await seedUser('stats-killswitch@x.co');
    const profileId = await seedProfile(user.id);
    const runId = await seedRun(user, profileId);
    await seedRow(user, profileId, runId, { sourceReviewId: 'g-1', rating: 2 });
    await LocalSeoReviewSyncRun.updateOne(
      { _id: runId },
      { $set: { aiTerminalState: 'ai-failed-reviews-intact' } },
    );
    (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = false;

    const res = await request(app)
      .get(`/api/local-seo/reviews/stats/${runId}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.ratingHistogram[2]).toBe(1);
  });

  it('returns 404 cross-account, for an unknown run, and 400 for a malformed id', async () => {
    const owner = await seedUser('stats-cross-owner@x.co');
    const stranger = await seedUser('stats-cross-stranger@x.co');
    const profileId = await seedProfile(owner.id);
    const runId = await seedRun(owner, profileId);

    const cross = await request(app)
      .get(`/api/local-seo/reviews/stats/${runId}`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);
    expect(cross.body.error.message).toBe(translate('en', 'reviewIntelligence.errors.notFound'));

    const unknown = await request(app)
      .get(`/api/local-seo/reviews/stats/${new mongoose.Types.ObjectId().toString()}`)
      .set('Cookie', owner.cookie);
    expect(unknown.status).toBe(404);

    const malformed = await request(app)
      .get('/api/local-seo/reviews/stats/not-an-id')
      .set('Cookie', owner.cookie);
    expect(malformed.status).toBe(400);
  });

  it('rejects an unauthenticated stats read with 401', async () => {
    const res = await request(app).get(
      `/api/local-seo/reviews/stats/${new mongoose.Types.ObjectId().toString()}`,
    );
    expect(res.status).toBe(401);
  });
});
