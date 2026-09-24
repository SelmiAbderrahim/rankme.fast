/**
 * Named `review_sync` per-account rate bucket.
 *
 * Source CRUD and sync submits share ONE bucket; stored-result reads are not
 * throttled, so a polling client can never lock itself out of its own data.
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

const originalEnabled = env.REVIEW_INTELLIGENCE_ENABLED;
const originalMax = env.RATE_LIMIT_REVIEW_SYNC_MAX;

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setLocalSeoDb(db as unknown as never);
});

afterAll(async () => {
  (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = originalEnabled;
  (env as { RATE_LIMIT_REVIEW_SYNC_MAX: number }).RATE_LIMIT_REVIEW_SYNC_MAX = originalMax;
  setReviewSyncQueue(null);
  setLocalSeoDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = true;
  (env as { RATE_LIMIT_REVIEW_SYNC_MAX: number }).RATE_LIMIT_REVIEW_SYNC_MAX = 3;
  setReviewSyncQueue({ add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue);
});

describe('review_sync named rate bucket', () => {
  it('rejects the fourth account mutation in one window with localized 429 copy', async () => {
    const app = createApp();
    const user = await signupVerifiedUser(app, { email: 'review-rate-limit@example.test' });
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      url: 'https://example.com',
      domain: 'example.com',
    });
    const profileId = String(site._id);

    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post('/api/local-seo/reviews/sources')
        .set('Cookie', user.cookie)
        .send({ profileId, source: 'tripadvisor', target: `6076${index}` })
        .expect(201);
    }

    const limited = await request(app)
      .post('/api/local-seo/reviews/sync')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'zh')
      .send({ profileId, sources: ['tripadvisor'] })
      .expect(429);
    expect(limited.body.error).toBe(translate('zh', 'reviewIntelligence.errors.rateLimited'));

    // Reads share no bucket with mutations.
    await request(app)
      .get(`/api/local-seo/reviews/sources?profileId=${profileId}`)
      .set('Cookie', user.cookie)
      .expect(200);
  });
});
