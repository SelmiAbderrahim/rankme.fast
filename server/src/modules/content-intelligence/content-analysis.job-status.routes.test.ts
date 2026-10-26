/**
 * Content-analysis job status, failure codes and Try again, through the
 * router: status shape, retry preview, consent, one new run per retry,
 * cross-account 404 and unauthenticated 401.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import { Types } from 'mongoose';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { setSitesDb } from '../sites/index.js';
import { setContentAnalysisQueue, setContentIntelligenceDb } from './content-intelligence.holders.js';
import { ContentAnalysis } from './content-analysis.model.js';
import { getAnalysisStatus } from './content-intelligence.service.js';
import { Site } from '../sites/index.js';

const app = createApp();

function fakeQueue() {
  const jobs: unknown[] = [];
  const queue = {
    async add(_name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      jobs.push(data);
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

let jobs: unknown[] = [];

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setContentIntelligenceDb(getTestDb() as unknown as never);
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setContentIntelligenceDb(null);
  setContentAnalysisQueue(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  const fake = fakeQueue();
  jobs = fake.jobs;
  setContentAnalysisQueue(fake.queue);
});

afterEach(() => {
  setContentAnalysisQueue(null);
});

async function seedUser(): Promise<TestUser> {
  const user = await signupVerifiedUser(app, {
    email: `job-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'CorrectHorseBattery9!',
  });
  return user;
}

async function seedRun(user: TestUser): Promise<{ siteId: string; analysisId: string }> {
  const site = await request(app).post('/api/sites').set('Cookie', user.cookie).send({ url: 'https://example.com' });
  const siteId = (site.body as { site: { id: string } }).site.id;
  const res = await request(app)
    .post(`/api/sites/${siteId}/content-analyses`)
    .set('Cookie', user.cookie)
    .send({ ownedUrl: 'https://example.com/pillar', keyword: 'seo audit', locale: 'en' });
  expect(res.status).toBe(202);
  return { siteId, analysisId: res.body.analysisId as string };
}

/** Fail the run at "Reading your page" the way the owned stage does. */
async function failRun(analysisId: string, error: { category: string; reason?: string | null }) {
  await ContentAnalysis.updateOne(
    { _id: analysisId },
    {
      $set: {
        status: 'failed',
        stages: [
          { name: 'queued', startedAt: new Date(), completedAt: new Date(), error: null },
          { name: 'collecting_owned', startedAt: new Date(), completedAt: null, error: null },
        ],
        error: {
          category: error.category,
          messageKey: 'contentIntelligence.errors.providerUnavailable',
          retryable: false,
          terminal: true,
          reason: error.reason ?? null,
        },
        completedAt: new Date(),
      },
    },
  );
}

describe('GET /api/content-analyses/:id/status', () => {
  it('reports the running step from server state', async () => {
    const user = await seedUser();
    const { analysisId } = await seedRun(user);
    await ContentAnalysis.updateOne(
      { _id: analysisId },
      {
        $set: { status: 'collecting_owned' },
        $push: { stages: { name: 'collecting_owned', startedAt: new Date(), completedAt: null, error: null } },
      },
    );
    const res = await request(app).get(`/api/content-analyses/${analysisId}/status`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      analysisId,
      status: 'collecting_owned',
      terminal: false,
      stepIndex: 2,
      stepCount: 7,
      stepKey: 'collecting_owned',
      failureReasonCode: null,
      retryAction: null,
    });
  });

  it('turns terminal with a specific failure code and way out; list and detail agree', async () => {
    const user = await seedUser();
    const { siteId, analysisId } = await seedRun(user);
    await failRun(analysisId, { category: 'provider_unavailable' });
    const status = await request(app).get(`/api/content-analyses/${analysisId}/status`).set('Cookie', user.cookie);
    expect(status.body).toMatchObject({
      status: 'failed',
      terminal: true,
      stepIndex: 2,
      stepKey: 'collecting_owned',
      failureReasonCode: 'provider_unavailable',
      retryAction: 'retry',
    });
    const detail = await request(app).get(`/api/content-analyses/${analysisId}`).set('Cookie', user.cookie);
    const list = await request(app).get(`/api/sites/${siteId}/content-analyses`).set('Cookie', user.cookie);
    const { analysisId: _id, status: _status, ...progress } = status.body as Record<string, unknown>;
    expect(detail.body.progress).toEqual(progress);
    expect(list.body.items[0].progress).toEqual(progress);
  });

  it('reads 7 of 7 once the run completed', async () => {
    const user = await seedUser();
    const { analysisId } = await seedRun(user);
    await ContentAnalysis.updateOne({ _id: analysisId }, { $set: { status: 'completed' } });
    const res = await request(app).get(`/api/content-analyses/${analysisId}/status`).set('Cookie', user.cookie);
    expect(res.body).toMatchObject({ terminal: true, stepIndex: 7, stepKey: 'generating_draft', failureReasonCode: null });
  });

  it('stays readable while the product flag is off', async () => {
    const user = await seedUser();
    const { analysisId } = await seedRun(user);
    const previous = env.CONTENT_INTELLIGENCE_ENABLED;
    env.CONTENT_INTELLIGENCE_ENABLED = false;
    try {
      const res = await request(app).get(`/api/content-analyses/${analysisId}/status`).set('Cookie', user.cookie);
      expect(res.status).toBe(200);
      const retry = await request(app).get(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie);
      expect(retry.status).toBe(503);
      const post = await request(app).post(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie).send({ consent: true });
      expect(post.status).toBe(503);
    } finally {
      env.CONTENT_INTELLIGENCE_ENABLED = previous;
    }
  });
});

describe('Try again — /api/content-analyses/:id/retry', () => {
  it('previews the request, requires consent, then starts one new run', async () => {
    const user = await seedUser();
    const { analysisId } = await seedRun(user);
    await failRun(analysisId, { category: 'owned_fetch_failed', reason: 'timeout' });

    const preview = await request(app).get(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      analysisId,
      ownedUrl: 'https://example.com/pillar',
      keyword: 'seo audit',
      failureReasonCode: 'timeout',
    });

    const noConsent = await request(app).post(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie).send({});
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error.code).toBe('CONTENT_INTELLIGENCE_ERRORS_CONSENT_REQUIRED');
    expect(jobs).toHaveLength(1);

    const retried = await request(app)
      .post(`/api/content-analyses/${analysisId}/retry`)
      .set('Cookie', user.cookie)
      .send({ consent: true });
    expect(retried.status).toBe(202);
    expect(retried.body.analysisId).not.toBe(analysisId);
    expect(jobs).toHaveLength(2);
  });

  it('refuses a page problem (Edit the URL) and a run that is still going with 409', async () => {
    const user = await seedUser();
    const { analysisId } = await seedRun(user);
    const running = await request(app).post(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie).send({ consent: true });
    expect(running.status).toBe(409);
    await failRun(analysisId, { category: 'owned_page_unusable', reason: 'robots_blocked' });
    const status = await request(app).get(`/api/content-analyses/${analysisId}/status`).set('Cookie', user.cookie);
    expect(status.body).toMatchObject({ failureReasonCode: 'page_blocked', retryAction: 'edit_url' });
    for (const res of [
      await request(app).get(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie),
      await request(app).post(`/api/content-analyses/${analysisId}/retry`).set('Cookie', user.cookie).send({ consent: true }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONTENT_INTELLIGENCE_ERRORS_NOT_RETRYABLE');
    }
    expect(jobs).toHaveLength(1);
  });

  it('answers 404 to another account and for unknown ids, 401 when signed out', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const { analysisId } = await seedRun(owner);
    await failRun(analysisId, { category: 'provider_unavailable' });
    const unknown = new Types.ObjectId().toString();
    for (const id of [analysisId, unknown]) {
      expect((await request(app).get(`/api/content-analyses/${id}/status`).set('Cookie', stranger.cookie)).status).toBe(404);
      expect((await request(app).get(`/api/content-analyses/${id}/retry`).set('Cookie', stranger.cookie)).status).toBe(404);
      expect(
        (await request(app).post(`/api/content-analyses/${id}/retry`).set('Cookie', stranger.cookie).send({ consent: true })).status,
      ).toBe(404);
    }
    expect((await request(app).get(`/api/content-analyses/${analysisId}/status`)).status).toBe(401);
    expect((await request(app).get(`/api/content-analyses/${analysisId}/retry`)).status).toBe(401);
    expect((await request(app).post(`/api/content-analyses/${analysisId}/retry`).send({ consent: true })).status).toBe(401);
    expect(jobs).toHaveLength(1);
  });
});

describe('job status service edges', () => {
  it('answers not-found for a malformed id and for a run whose site is gone', async () => {
    const user = await seedUser();
    const { siteId, analysisId } = await seedRun(user);
    await expect(getAnalysisStatus({ accountId: user.id, analysisId: 'not-an-id' })).rejects.toMatchObject({ status: 404 });
    await Site.deleteOne({ _id: siteId });
    await expect(getAnalysisStatus({ accountId: user.id, analysisId })).rejects.toMatchObject({ status: 404 });
  });
});
