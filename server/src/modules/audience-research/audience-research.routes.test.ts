/**
 * Audience Research — router + service smoke integration test (prompt 10e).
 *
 * Real PGlite Postgres (with all migrations applied by the shared harness),
 * real mongodb-memory-server, real Better Auth-backed sessions via the test
 * auth harness, and an in-process fake BullMQ queue. Three focused tests:
 *
 *   1. POST /preview returns a SpendPreview shape with no side-effects.
 *   2. POST /runs returns 202; a duplicate POST with the same body returns
 *      the same runId with `duplicate: true` and never creates a second run.
 *   3. A different account gets 404 on GET run (owner-scoped, no existence
 *      leak — 404 not 403).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import type { Job, Queue } from 'bullmq';
import pino from 'pino';
import { createApp } from '../../app.js';
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
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { setSitesDb } from '../sites/index.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import {
  AudienceResearchRun,
  setAudienceResearchDb,
  setAudienceResearchQueue,
} from './index.js';
import { db as productionDb } from '../../db/client.js';
import {
  decideAudienceResearchSignalController,
  previewAudienceResearchController,
  resolveAudienceResearchDb,
} from './audience-research.controller.js';

const app = createApp();

interface EnqueuedJob {
  name: string;
  data: { accountId: string; siteId: string; runId: string; outputLocale: string };
  opts: { jobId?: string };
}

function fakeQueue() {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    async add(name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      jobs.push({ name, data: data as EnqueuedJob['data'], opts });
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

async function addSite(user: TestUser, origin = 'https://example.com'): Promise<string> {
  const res = await request(app)
    .post('/api/sites')
    .set('Cookie', user.cookie)
    .send({ url: origin });
  return (res.body as { site: { id: string } }).site.id;
}

function baseInputBody() {
  return {
    siteMarket: {
      country: 'US',
      region: null,
      city: null,
      language: 'en',
      device: 'desktop' as const,
    },
    competitorDomains: ['acme.example'],
    seedTopics: ['project management tools'],
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setAudienceResearchDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setAudienceResearchDb(null);
  setAudienceResearchQueue(null);
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  const { queue } = fakeQueue();
  setAudienceResearchQueue(queue);
});

afterEach(() => {
  setAudienceResearchQueue(null);
});

describe('audience-research API smoke', () => {
  it('POST preview returns a SpendPreview shape without side-effects', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-preview@example.com' });
    const siteId = await addSite(user);

    const res = await request(app)
      .post(`/api/sites/${siteId}/audience-research/preview`)
      .set('Cookie', user.cookie)
      .send(baseInputBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });

    // No side-effects: no run doc.
    const runCount = await AudienceResearchRun.countDocuments();
    expect(runCount).toBe(0);
  });

  it('POST run returns 202; duplicate body returns same runId with duplicate:true and no second run', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-run@example.com' });
    const siteId = await addSite(user);

    const first = await request(app)
      .post(`/api/sites/${siteId}/audience-research/runs`)
      .set('Cookie', user.cookie)
      .send(baseInputBody());
    expect(first.status).toBe(202);
    expect(typeof first.body.runId).toBe('string');
    expect(first.body.duplicate).toBe(false);
    expect(first.body.outputLocale).toBe('en');
    const firstRunId = first.body.runId as string;

    const second = await request(app)
      .post(`/api/sites/${siteId}/audience-research/runs`)
      .set('Cookie', user.cookie)
      .send(baseInputBody());
    expect(second.status).toBe(202);
    expect(second.body.runId).toBe(firstRunId);
    expect(second.body.duplicate).toBe(true);

    // Exactly one persisted run.
    const runCount = await AudienceResearchRun.countDocuments();
    expect(runCount).toBe(1);
  });

  it('versions run identity by output locale and a language-only read has no side effects', async () => {
    const { queue, jobs } = fakeQueue();
    setAudienceResearchQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'alice-locale@example.com' });
    const siteId = await addSite(user);

    const french = await request(app)
      .post(`/api/sites/${siteId}/audience-research/runs`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr')
      .send(baseInputBody());
    expect(french.status).toBe(202);
    expect(french.body.outputLocale).toBe('fr');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.outputLocale).toBe('fr');

    const historical = await request(app)
      .get(`/api/sites/${siteId}/audience-research/runs/${french.body.runId as string}`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'de');
    expect(historical.status).toBe(200);
    expect(historical.body.outputLocale).toBe('fr');
    expect(jobs).toHaveLength(1);

    const german = await request(app)
      .post(`/api/sites/${siteId}/audience-research/runs`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'de')
      .send(baseInputBody());
    expect(german.status).toBe(202);
    expect(german.body.outputLocale).toBe('de');
    expect(german.body.runId).not.toBe(french.body.runId);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.data.outputLocale).toBe('de');
  });

  it('cross-account GET /runs/:runId returns 404 (no existence leak)', async () => {
    const alice = await signupVerifiedUser(app, { email: 'alice-cross@example.com' });
    const aliceSiteId = await addSite(alice);

    const started = await request(app)
      .post(`/api/sites/${aliceSiteId}/audience-research/runs`)
      .set('Cookie', alice.cookie)
      .send(baseInputBody());
    expect(started.status).toBe(202);
    const aliceRunId = started.body.runId as string;

    // Bob authenticates and tries to read Alice's run — MUST get 404, not 403.
    const bob = await signupVerifiedUser(app, { email: 'bob-cross@example.com' });

    const cross = await request(app)
      .get(`/api/sites/${aliceSiteId}/audience-research/runs/${aliceRunId}`)
      .set('Cookie', bob.cookie);
    expect(cross.status).toBe(404);
  });
});

/**
 * Controller-layer coverage: the list / result / decision endpoints and the
 * two seams that never fire through a normal authenticated request (the
 * unauthenticated guard and the production-db fallback).
 */
async function seedCompletedRun(accountId: string, siteId: string) {
  const run = await AudienceResearchRun.create({
    accountId: new Types.ObjectId(accountId),
    siteId: new Types.ObjectId(siteId),
    state: 'completed',
    input: {
      outputLocale: 'en',
      siteMarket: { country: 'US', language: 'en', device: 'desktop' },
      competitorDomains: ['acme.example'],
      seedTopics: ['project management tools'],
      queryTemplateVersion: 1,
    },
    deterministicInputHash: `route-hash-${accountId}`,
    sources: [
      {
        sourceId: 'src-001',
        canonicalUrl: 'https://forum.example.test/thread',
        title: 'Thread',
        sourceType: 'forum',
        registrableDomain: 'example.test',
        observedAt: '2026-01-01T00:00:00.000Z',
        contentHash: 'd'.repeat(64),
        excerpt: 'Visitors ask for a bulk export.',
        observationMeta: {
          sourceKind: 'provider_observation',
          sourceLabel: 'fake',
          observedAt: '2026-01-01T00:00:00.000Z',
          freshUntil: null,
          freshness: 'fresh',
          market: null,
          sampleCount: 1,
          coverageNoteKey: null,
        },
        discoveryQueryIds: ['q-001'],
      },
    ],
    signals: (['content', 'product', 'seo'] as const).map((route, index) => ({
      signalId: `sig-00${index + 1}`,
      type: 'request',
      title: `Signal ${index + 1}`,
      summary: 'Visitors ask for a bulk export.',
      suggestedRoute: route,
      citedSourceIds: ['src-001'],
      independentDomainCount: 1,
      sourceTypeCount: 1,
      mostRecentSourceObservedAt: '2026-01-01T00:00:00.000Z',
      confidence: 'medium',
    })),
    terminal: { state: 'completed', reasonCode: 'ok', completedAt: new Date() },
    requestedAt: new Date(),
    completedAt: new Date(),
  });
  return String(run._id);
}

describe('audience-research controllers', () => {
  it('rejects an unauthenticated invocation with a localized 401', async () => {
    const forwarded = await new Promise<unknown>((resolve) => {
      previewAudienceResearchController(
        { params: {}, body: {} } as unknown as Request,
        {} as unknown as Response,
        resolve as unknown as NextFunction,
      );
    });
    expect(forwarded).toMatchObject({
      status: 401,
      message: 'errors.unauthorized',
    });
  });

  it('rejects a decision without an actor even when workspace context is present', async () => {
    const forwarded = await new Promise<unknown>((resolve) => {
      decideAudienceResearchSignalController(
        { workspaceAccountId: 'account-1', params: {}, body: {} } as unknown as Request,
        {} as unknown as Response,
        resolve as unknown as NextFunction,
      );
    });
    expect(forwarded).toMatchObject({
      status: 401,
      message: 'errors.unauthorized',
    });
  });

  it('falls back to the production db handle when no override is injected', () => {
    setAudienceResearchDb(null);
    expect(resolveAudienceResearchDb()).toBe(productionDb);
    setAudienceResearchDb(getTestDb() as unknown as never);
  });

  it('paginates the run list and honours an opaque cursor', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-list@example.com' });
    const siteId = await addSite(user);

    const older = await request(app)
      .post(`/api/sites/${siteId}/audience-research/runs`)
      .set('Cookie', user.cookie)
      .send(baseInputBody());
    const newer = await request(app)
      .post(`/api/sites/${siteId}/audience-research/runs`)
      .set('Cookie', user.cookie)
      .send({ ...baseInputBody(), seedTopics: ['issue tracking tools'] });
    expect(older.status).toBe(202);
    expect(newer.status).toBe(202);

    const firstPage = await request(app)
      .get(`/api/sites/${siteId}/audience-research/runs?limit=1`)
      .set('Cookie', user.cookie);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(typeof firstPage.body.nextCursor).toBe('string');

    const secondPage = await request(app)
      .get(
        `/api/sites/${siteId}/audience-research/runs?limit=1&cursor=${encodeURIComponent(
          firstPage.body.nextCursor as string,
        )}`,
      )
      .set('Cookie', user.cookie);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].runId).not.toBe(firstPage.body.items[0].runId);
    expect(secondPage.body.nextCursor).toBeNull();
  });

  it('returns the status view for a single owned run', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-status@example.com' });
    const siteId = await addSite(user);
    const runId = await seedCompletedRun(user.id, siteId);

    const res = await request(app)
      .get(`/api/sites/${siteId}/audience-research/runs/${runId}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      runId,
      siteId,
      state: 'completed',
      stage: 'terminal',
      progress: { percent: 100 },
    });
    expect(res.body.counts).toEqual({ candidates: 0, sources: 1, signals: 3 });
    expect(res.body.terminal.reasonCode).toBe('ok');
  });

  it('400s an out-of-range list limit', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-limit@example.com' });
    const siteId = await addSite(user);
    const res = await request(app)
      .get(`/api/sites/${siteId}/audience-research/runs?limit=500`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('returns the result view with the account’s durable terminal decisions', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-result@example.com' });
    const siteId = await addSite(user);
    const runId = await seedCompletedRun(user.id, siteId);

    const before = await request(app)
      .get(`/api/sites/${siteId}/audience-research/runs/${runId}/result`)
      .set('Cookie', user.cookie);
    expect(before.status).toBe(200);
    expect(before.body.sources).toHaveLength(1);
    expect(before.body.decisions).toEqual([]);

    const accepted = await request(app)
      .post(
        `/api/sites/${siteId}/audience-research/runs/${runId}/signals/sig-001/decision`,
      )
      .set('Cookie', user.cookie)
      .send({
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'route-idem-0001',
      });
    expect(accepted.status).toBe(201);
    expect(accepted.body.duplicate).toBe(false);
    expect(accepted.body.destination).toBe('content');

    // A reload must replay the persisted decision — without it the workspace
    // reverted accepted cards to their undecided controls.
    const after = await request(app)
      .get(`/api/sites/${siteId}/audience-research/runs/${runId}/result`)
      .set('Cookie', user.cookie);
    expect(after.status).toBe(200);
    expect(after.body.decisions).toHaveLength(1);
    expect(after.body.decisions[0]).toMatchObject({
      signalId: 'sig-001',
      terminalDecision: 'accepted',
      destination: 'content',
    });
  });

  it('replays an identical decision as 200 and records dismissals with and without a reason', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-decide@example.com' });
    const siteId = await addSite(user);
    const runId = await seedCompletedRun(user.id, siteId);
    const base = `/api/sites/${siteId}/audience-research/runs/${runId}/signals`;

    const first = await request(app)
      .post(`${base}/sig-002/decision`)
      .set('Cookie', user.cookie)
      .send({
        decision: 'accepted',
        destination: 'product',
        idempotencyKey: 'route-idem-0002',
      });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`${base}/sig-002/decision`)
      .set('Cookie', user.cookie)
      .send({
        decision: 'accepted',
        destination: 'product',
        idempotencyKey: 'route-idem-0002',
      });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.downstreamId).toBe(first.body.downstreamId);

    const dismissedWithReason = await request(app)
      .post(`${base}/sig-003/decision`)
      .set('Cookie', user.cookie)
      .send({
        decision: 'dismissed',
        reason: 'already_addressed',
        idempotencyKey: 'route-idem-0003',
      });
    expect(dismissedWithReason.status).toBe(201);
    expect(dismissedWithReason.body.destination).toBeNull();

    const dismissedWithoutReason = await request(app)
      .post(`${base}/sig-001/decision`)
      .set('Cookie', user.cookie)
      .send({ decision: 'dismissed', idempotencyKey: 'route-idem-0004' });
    expect(dismissedWithoutReason.status).toBe(201);
    expect(dismissedWithoutReason.body.terminalDecision).toBe('dismissed');
  });

  it('400s a decision body that omits the idempotency key', async () => {
    const user = await signupVerifiedUser(app, { email: 'alice-baddecision@example.com' });
    const siteId = await addSite(user);
    const runId = await seedCompletedRun(user.id, siteId);
    const res = await request(app)
      .post(
        `/api/sites/${siteId}/audience-research/runs/${runId}/signals/sig-001/decision`,
      )
      .set('Cookie', user.cookie)
      .send({ decision: 'dismissed' });
    expect(res.status).toBe(400);
  });
});
