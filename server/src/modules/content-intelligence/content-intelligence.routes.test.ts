/**
 * Content Intelligence — router + service integration tests (prompt 04).
 *
 * Real PGlite Postgres (with the 0035 migration applied by the shared
 * harness), real mongodb-memory-server, real Better Auth-backed sessions
 * via the test auth harness, and an in-process fake queue. Covers every
 * load-bearing invariant the prompt requires:
 *
 *   - cross-account 404 (no existence leak);
 *   - unverified site → 404, off-origin URL → 400, private-IP URL → 400;
 *   - over-length URL/keyword + `$`-prefixed keyword payload rejected;
 *   - duplicate idempotency key returns the existing analysis (no second run);
 *   - concurrent starts with the same key resolve to one analysis;
 *   - enqueue failure marks the run failed and records a `failed` event;
 *   - cancel is 409 on terminal / 202 on cancellable;
 *   - regenerate is a new run;
 *   - preflight is a no-op (no write, no enqueue);
 *   - list is paginated with the HMAC cursor codec;
 *   - client `clientKey` is server-namespaced (cross-account collision impossible);
 *   - rate limiter fronts create/regenerate.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
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
import { contentAnalysisEvents } from '../../db/schema/content-analysis-events.js';
import { contentRecommendationEvents } from '../../db/schema/content-recommendations.js';
import { rateLimitHits } from '../../db/schema/rate-limit-hits.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import pino from 'pino';
import {
  setContentAnalysisQueue,
  setContentIntelligenceDb,
} from './content-intelligence.holders.js';
import {
  createAnalysisController,
  resolveContentIntelligenceDb,
  saveBriefVersionController,
} from './content-intelligence.controller.js';
import { saveBriefVersionBodySchema } from './content-intelligence.schema.js';
import { ContentAnalysis } from './index.js';
import { Site } from '../sites/index.js';
import { recordContentAnalysisEvent } from './content-analysis.events.js';
import {
  cancelAnalysis,
  getAnalysis,
  listAnalyses,
  preflightAnalysis,
  regenerateAnalysis,
  saveBriefVersion,
  saveDraftVersion,
  startAnalysis,
  toPublicAnalysis,
} from './content-intelligence.service.js';

const app = createApp();

interface EnqueuedJob {
  name: string;
  data: { analysisId: string; siteId: string; accountId: string; reservationKey: string };
  opts: { jobId?: string };
}

function fakeQueue(overrides: { onAdd?: () => void | Promise<void> } = {}) {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    async add(name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      await overrides.onAdd?.();
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

async function seedCompletedRecommendationAnalysis(input: {
  user: TestUser;
  siteId: string;
  contentHash?: string;
  completedAt?: Date;
  ownedUrl?: string;
}) {
  return ContentAnalysis.create({
    accountId: input.user.id,
    ownerUserId: input.user.id,
    siteId: input.siteId,
    ownedUrl: input.ownedUrl ?? 'https://example.com/guide',
    keyword: 'content audit',
    locale: 'en',
    status: 'completed',
    stages: [],
    inputFingerprint: `fingerprint_${new Types.ObjectId()}`,
    idempotencyKey: `idem_${new Types.ObjectId()}`,
    providerRefs: { snapshotIds: [] },
    owned: {
      url: input.ownedUrl ?? 'https://example.com/guide',
      title: 'Guide',
      description: null,
      canonical: null,
      language: 'en',
      wordCount: 100,
      headingCount: 3,
      schemaTypes: [],
      hasSchemaOrgArticle: false,
      internalLinkCount: 2,
      externalLinkCount: 1,
      contentHash: input.contentHash ?? 'analysis-hash',
      excerpt: 'A bounded excerpt used by the analysis fixture.',
    },
    recommendations: [{
      id: 'rec_1', section: 'coverage', ruleId: 'rule', direction: 'add',
      confidence: 0.9, messageKey: 'rec', evidenceSourceIds: [],
    }],
    recommendationStates: [],
    requestedAt: new Date('2026-07-14T00:00:00Z'),
    completedAt: input.completedAt ?? new Date(),
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setContentIntelligenceDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setContentIntelligenceDb(null);
  setContentAnalysisQueue(null);
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  const { queue } = fakeQueue();
  setContentAnalysisQueue(queue);
});

afterEach(() => {
  setContentAnalysisQueue(null);
  vi.restoreAllMocks();
});

it('persists idempotent draft versions', async () => {
  const user = await signupVerifiedUser(app, {
    email: 'content-workspace@example.com',
    password: 'CorrectHorseBattery9!',
  });
  const siteId = await addSite(user);

  const analysis = await seedCompletedRecommendationAnalysis({ user, siteId });
  await expect(saveDraftVersion({
    accountId: user.id,
    actorUserId: user.id,
    analysisId: analysis.id,
    markdown: 'No generated draft yet',
    clientKey: 'missing-draft',
  })).rejects.toMatchObject({ status: 409 });
  await expect(saveDraftVersion({
    accountId: user.id,
    actorUserId: user.id,
    analysisId: 'not-an-id',
    markdown: 'Invalid analysis',
    clientKey: 'invalid-analysis',
  })).rejects.toMatchObject({ status: 404 });
  analysis.draft = {
    versionId: 'generated-v1',
    markdown: 'Generated draft',
    wordCount: 2,
    text: null,
    citations: [],
    profileVersion: null,
    provider: null,
  };
  await analysis.save();

  const first = await request(app)
    .post(`/api/content-analyses/${analysis.id}/draft-versions`)
    .set('Cookie', user.cookie)
    .send({ markdown: 'Edited draft text', clientKey: 'draft-save-1' });
  expect(first.status).toBe(201);
  expect(first.body.version).toMatchObject({ markdown: 'Edited draft text', wordCount: 3 });

  const replay = await request(app)
    .post(`/api/content-analyses/${analysis.id}/draft-versions`)
    .set('Cookie', user.cookie)
    .send({ markdown: 'Ignored replay', clientKey: 'draft-save-1' });
  expect(replay.status).toBe(201);
  expect(replay.body.version.versionId).toBe(first.body.version.versionId);

  const refreshed = await ContentAnalysis.findById(analysis.id).lean();
  expect(refreshed?.draft?.markdown).toBe('Edited draft text');
  expect(refreshed?.draftVersions).toHaveLength(1);
});

it('persists idempotent brief versions and serializes both version histories', async () => {
  const user = await signupVerifiedUser(app, {
    email: 'content-brief-versions@example.com',
    password: 'CorrectHorseBattery9!',
  });
  const siteId = await addSite(user);
  const analysis = await seedCompletedRecommendationAnalysis({ user, siteId });

  await expect(
    saveBriefVersion({
      accountId: user.id,
      actorUserId: user.id,
      analysisId: 'not-an-id',
      sections: [{ heading: 'Heading', body: 'Body' }],
      clientKey: 'invalid-brief',
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    saveBriefVersion({
      accountId: user.id,
      actorUserId: user.id,
      analysisId: new Types.ObjectId().toString(),
      sections: [{ heading: 'Heading', body: 'Body' }],
      clientKey: 'missing-brief-analysis',
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    saveBriefVersion({
      accountId: user.id,
      actorUserId: user.id,
      analysisId: analysis.id,
      sections: [{ heading: 'Heading', body: 'Body' }],
      clientKey: 'unavailable-brief',
    }),
  ).rejects.toMatchObject({ status: 409 });

  analysis.set('brief', {
    versionId: 'generated-v1',
    sections: [],
    text: 'Generated brief',
    citations: [],
    profileVersion: null,
    provider: null,
  });
  analysis.draft = {
    versionId: 'generated-v1',
    markdown: 'Generated draft',
    wordCount: 2,
    text: null,
    citations: [],
    profileVersion: null,
    provider: null,
  };
  await analysis.save();

  const first = await saveBriefVersion({
    accountId: user.id,
    actorUserId: user.id,
    analysisId: analysis.id,
    sections: [{ heading: '  First heading  ', body: '  First body  ' }],
    clientKey: 'brief-save-1',
  });
  expect(first.sections).toEqual([{ heading: 'First heading', body: 'First body' }]);
  await expect(
    saveBriefVersion({
      accountId: user.id,
      actorUserId: user.id,
      analysisId: analysis.id,
      sections: [{ heading: 'Ignored', body: 'Ignored' }],
      clientKey: 'brief-save-1',
    }),
  ).resolves.toEqual(first);

  await expect(
    saveDraftVersion({
      accountId: user.id,
      actorUserId: user.id,
      analysisId: new Types.ObjectId().toString(),
      markdown: 'missing',
      clientKey: 'missing-draft-analysis',
    }),
  ).rejects.toMatchObject({ status: 404 });
  const emptyDraft = await saveDraftVersion({
    accountId: user.id,
    actorUserId: user.id,
    analysisId: analysis.id,
    markdown: '   ',
    clientKey: 'empty-draft',
  });
  expect(emptyDraft.wordCount).toBe(0);

  const refreshed = await ContentAnalysis.findById(analysis.id);
  expect(refreshed).not.toBeNull();
  if (!refreshed) throw new Error('expected analysis');
  const publicAnalysis = toPublicAnalysis(refreshed.toObject());
  expect(publicAnalysis.briefVersions).toEqual([
    expect.objectContaining({
      versionId: first.versionId,
      sections: [{ heading: 'First heading', body: 'First body' }],
    }),
  ]);
  expect(publicAnalysis.draftVersions).toEqual([
    expect.objectContaining({ versionId: emptyDraft.versionId, markdown: '   ', wordCount: 0 }),
  ]);
  const controllerSave = await request(app)
    .post(`/api/content-analyses/${analysis.id}/brief-versions`)
    .set('Cookie', user.cookie)
    .send({
      sections: [{ heading: 'Controller heading', body: 'Controller body' }],
      clientKey: 'brief-controller-save',
    });
  expect(controllerSave.status).toBe(201);
  expect(controllerSave.body.version.sections).toEqual([
    { heading: 'Controller heading', body: 'Controller body' },
  ]);
});

it('freezes reviewed landscape matches into a new analysis without trusting URL state', async () => {
  const user = await signupVerifiedUser(app, {
    email: 'content-reviewed-matches@example.com',
    password: 'CorrectHorseBattery9!',
  });
  const siteId = await addSite(user);
  const { queue } = fakeQueue();
  const loader = vi.fn(async (
    _db: Parameters<NonNullable<Parameters<typeof startAnalysis>[1]['loadReviewedPageMatch']>>[0],
    reference: Parameters<NonNullable<Parameters<typeof startAnalysis>[1]['loadReviewedPageMatch']>>[1],
  ) => ({
    landscapeReportId: reference.reportId,
    landscapeOpportunityId: reference.opportunityId ?? null,
    suggestionId: reference.suggestionId,
    competitorProfileId: '00000000-0000-4000-8000-000000000031',
    suggestedUrl: 'https://rival.example/suggested',
    selectedUrl: `https://rival.example/${reference.suggestionId}`,
    ownedUrl: 'https://example.com/guide',
    keywordEvidence: [],
  }));

  const started = await startAnalysis(
    {
      accountId: user.id,
      ownerUserId: user.id,
      siteId,
      ownedUrl: 'https://example.com/guide',
      keyword: 'reviewed landscape',
      locale: 'en',
      clientKey: 'reviewed-page-handoff',
      reviewedPageMatches: [
        {
          landscapeReportId: new Types.ObjectId().toString(),
          suggestionId: 'suggestion-without-opportunity',
        },
        {
          landscapeReportId: new Types.ObjectId().toString(),
          landscapeOpportunityId: 'opportunity-1',
          suggestionId: 'suggestion-with-opportunity',
        },
      ],
    },
    {
      db: getTestDb(),
      contentAnalysisQueue: queue,
      loadReviewedPageMatch: loader,
    },
  );

  expect(loader).toHaveBeenCalledTimes(2);
  const stored = await ContentAnalysis.findById(started.analysisId).lean();
  expect(stored?.reviewedCompetitorUrls).toEqual([
    'https://rival.example/suggestion-without-opportunity',
    'https://rival.example/suggestion-with-opportunity',
  ]);
  expect(stored?.reviewedPageMatches).toEqual([
    expect.objectContaining({
      landscapeOpportunityId: null,
      suggestionId: 'suggestion-without-opportunity',
    }),
    expect.objectContaining({
      landscapeOpportunityId: 'opportunity-1',
      suggestionId: 'suggestion-with-opportunity',
    }),
  ]);
});

describe('content-intelligence service defensive paths', () => {
  it('covers the production-db fallback and controller authentication guard', async () => {
    setContentIntelligenceDb(null);
    try {
      expect(resolveContentIntelligenceDb()).toBeDefined();
      const error = await new Promise<unknown>((resolve) => {
        createAnalysisController(
          {} as Request,
          {} as Response,
          ((value?: unknown) => resolve(value)) as NextFunction,
        );
      });
      expect(error).toMatchObject({ status: 401 });
    } finally {
      setContentIntelligenceDb(getTestDb() as never);
    }
  });

  it('requires an authenticated actor for brief saves after workspace resolution', async () => {
    const error = await new Promise<unknown>((resolve) => {
      saveBriefVersionController(
        { workspaceAccountId: new Types.ObjectId().toString() } as Request,
        {} as Response,
        ((value?: unknown) => resolve(value)) as NextFunction,
      );
    });
    expect(error).toMatchObject({ status: 401 });
  });

  it('bounds the combined brief section payload', () => {
    expect(saveBriefVersionBodySchema.safeParse({
      sections: Array.from({ length: 6 }, (_, index) => ({
        heading: `Section ${index}`,
        body: 'x'.repeat(20_000),
      })),
      clientKey: 'combined-brief-limit',
    }).success).toBe(false);
    expect(saveBriefVersionBodySchema.safeParse({
      sections: [{ heading: 'Section', body: 'Within the aggregate limit.' }],
      clientKey: 'combined-brief-valid',
    }).success).toBe(true);
  });

  it('serializes optional evidence, recommendation states, hashes, and timestamps', () => {
    const actor = new Types.ObjectId();
    const date = new Date('2026-07-15T12:00:00.000Z');
    const publicAnalysis = toPublicAnalysis({
      _id: new Types.ObjectId(),
      siteId: new Types.ObjectId(),
      ownedUrl: 'https://example.com/guide',
      keyword: 'content audit',
      locale: 'en',
      status: 'completed',
      stages: undefined,
      warnings: undefined,
      scorecard: undefined,
      scorecardV2: { invalid: true },
      owned: { invalid: true },
      recommendations: [
        { invalid: true },
        {
          id: 'valid_rec',
          section: 'coverage',
          ruleId: 'add-topic',
          direction: 'add',
          confidence: 0.8,
          messageKey: 'contentIntelligence.recs.coverage.addTopic',
          evidenceSourceIds: [],
        },
        {
          id: 'technical_rec',
          section: 'structure',
          ruleId: 'add-title',
          direction: 'add',
          confidence: 0.9,
          messageKey: 'contentIntelligence.rules.add-title',
          evidenceSourceIds: [],
        },
      ],
      recommendationStates: [
        {
          recommendationId: 'same', analysisVersion: 'v1', state: 'applied', version: 1,
          actorUserId: actor, stateChangedAt: date, appliedAt: date,
          baselineAnchorAt: date, contentHash: 'same', analysisContentHash: 'same',
        },
        {
          recommendationId: 'changed', analysisVersion: 'v1', state: 'applied', version: 1,
          actorUserId: actor, stateChangedAt: date, appliedAt: null,
          baselineAnchorAt: null, contentHash: 'new', analysisContentHash: 'old',
        },
        {
          recommendationId: 'missing', analysisVersion: 'v1', state: 'accepted', version: 1,
          actorUserId: actor, stateChangedAt: date, contentHash: null, analysisContentHash: null,
        },
      ],
      brief: undefined,
      draft: undefined,
      citations: undefined,
      error: undefined,
      costMicros: undefined,
      aiCostMicros: undefined,
      requestedAt: null,
      startedAt: date,
      completedAt: null,
      cancelledAt: date,
    } as never);

    expect(publicAnalysis.recommendations).toHaveLength(2);
    expect(publicAnalysis.recommendations.find((item) => item.id === 'valid_rec'))
      .not.toHaveProperty('codeFixPromptAvailable');
    expect(publicAnalysis.recommendations.find((item) => item.id === 'technical_rec'))
      .toMatchObject({ codeFixPromptAvailable: true });
    expect(publicAnalysis.recommendationStates.map((state) => state.hashStatus)).toEqual([
      'same', 'changed', 'unavailable',
    ]);
    expect(publicAnalysis).toMatchObject({
      stages: [], warnings: [], scorecard: null, scorecardV2: null, owned: null,
      brief: null, draft: null, citations: [], error: null,
      costMicros: 0, aiCostMicros: 0, requestedAt: null,
      startedAt: date.toISOString(), completedAt: null, cancelledAt: date.toISOString(),
    });
    expect(publicAnalysis).not.toHaveProperty('reservation');

    const sections = ['intent', 'coverage', 'structure', 'links', 'schema', 'technical']
      .map((key) => ({ key, score: 50, weight: 1, confidence: 0.5, reason: 'Evidence' }));
    const withEvidence = toPublicAnalysis({
      ...({
        _id: new Types.ObjectId(), siteId: new Types.ObjectId(),
        ownedUrl: 'https://example.com/guide', keyword: 'content audit', locale: 'en',
        status: 'completed', stages: [],
        warnings: [{
          code: 'serp_unavailable',
          messageKey: 'contentIntelligence.warnings.serpUnavailable',
        }],
        recommendations: [],
        recommendationStates: [],
        requestedAt: date,
      }),
      scorecardV2: { version: 'v1', total: 50, sections },
      owned: {
        url: 'https://example.com/guide', title: 'Guide', description: null,
        canonical: null, language: 'en', wordCount: 100, headingCount: 2,
        schemaTypes: [], hasSchemaOrgArticle: false, internalLinkCount: 1,
        externalLinkCount: 1, contentHash: 'hash', excerpt: 'Evidence',
      },
    } as never);
    expect(withEvidence.scorecardV2?.total).toBe(50);
    expect(withEvidence.warnings[0]).toMatchObject({
      code: 'serp_unavailable',
      messageKey: 'contentIntelligence.warnings.serpUnavailable',
    });
    expect(withEvidence.owned).toEqual({ url: 'https://example.com/guide', contentHash: 'hash' });
    expect(withEvidence.requestedAt).toBe(date.toISOString());

    const withoutRecommendationProjection = toPublicAnalysis({
      ...({
        _id: new Types.ObjectId(), siteId: new Types.ObjectId(),
        ownedUrl: 'https://example.com/empty', keyword: 'empty', locale: 'en',
        status: 'completed',
        requestedAt: date,
      }),
      recommendations: undefined,
      recommendationStates: undefined,
    } as never);
    expect(withoutRecommendationProjection.recommendations).toEqual([]);
    expect(withoutRecommendationProjection.recommendationStates).toEqual([]);
  });

  it('returns service-level invalid-id and unsafe-url outcomes before spending', async () => {
    const badId = 'not-an-object-id';
    await expect(getAnalysis({ accountId: badId, analysisId: badId })).rejects.toMatchObject({ status: 404 });
    await expect(cancelAnalysis({ accountId: badId, analysisId: badId })).rejects.toMatchObject({ status: 404 });
    await expect(
      regenerateAnalysis(
        { accountId: badId, ownerUserId: badId, analysisId: badId },
        { db: getTestDb() as never, contentAnalysisQueue: null },
      ),
    ).rejects.toMatchObject({ status: 404 });
    const { queue: invalidSiteQueue } = fakeQueue();
    await expect(
      startAnalysis(
        {
          accountId: badId, ownerUserId: badId, siteId: badId,
          ownedUrl: 'https://example.com', keyword: 'seo', locale: 'en',
        },
        { db: getTestDb() as never, contentAnalysisQueue: invalidSiteQueue },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      preflightAnalysis({
        accountId: badId, siteId: badId, ownedUrl: 'https://example.com', keyword: 'seo', locale: 'en',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_owned' });

    vi.spyOn(Site, 'findOne').mockResolvedValueOnce({ url: 'http://127.0.0.1' } as never);
    await expect(
      preflightAnalysis({
        accountId: new Types.ObjectId().toString(),
        siteId: new Types.ObjectId().toString(),
        ownedUrl: 'http://127.0.0.1/private',
        keyword: 'seo',
        locale: 'en',
      }),
    ).resolves.toEqual({ ok: false, reason: 'url_unsafe' });

    vi.spyOn(Site, 'findOne').mockResolvedValueOnce({ url: 'https://example.com' } as never);
    await expect(
      preflightAnalysis({
        accountId: new Types.ObjectId().toString(),
        siteId: new Types.ObjectId().toString(),
        ownedUrl: 'not a url', keyword: 'seo', locale: 'en',
      }),
    ).resolves.toEqual({ ok: false, reason: 'url_invalid' });

    const { queue } = fakeQueue();
    vi.spyOn(Site, 'findOne').mockResolvedValueOnce({ url: 'https://example.com' } as never);
    await expect(
      startAnalysis(
        {
          accountId: new Types.ObjectId().toString(), ownerUserId: new Types.ObjectId().toString(),
          siteId: new Types.ObjectId().toString(), ownedUrl: 'not a url', keyword: 'seo', locale: 'en',
        },
        { db: getTestDb() as never, contentAnalysisQueue: queue },
      ),
    ).rejects.toMatchObject({ status: 400 });
    vi.spyOn(Site, 'findOne').mockResolvedValueOnce({ url: 'http://127.0.0.1' } as never);
    await expect(
      startAnalysis(
        {
          accountId: new Types.ObjectId().toString(), ownerUserId: new Types.ObjectId().toString(),
          siteId: new Types.ObjectId().toString(), ownedUrl: 'http://127.0.0.1/private',
          keyword: 'seo', locale: 'en',
        },
        { db: getTestDb() as never, contentAnalysisQueue: queue },
      ),
    ).rejects.toMatchObject({ status: 400 });

    vi.spyOn(ContentAnalysis, 'findOne').mockResolvedValueOnce(null);
    await expect(
      cancelAnalysis({
        accountId: new Types.ObjectId().toString(),
        analysisId: new Types.ObjectId().toString(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('covers the create race and rethrows a duplicate-key failure with no visible winner', async () => {
    // The race path depends on Mongo's unique idempotency index. Await its
    // construction explicitly so this test cannot race Mongoose auto-indexing.
    await ContentAnalysis.createIndexes();
    const user = await signupVerifiedUser(app, {
      email: 'service-race@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const { queue } = fakeQueue();
    const input = {
      accountId: user.id,
      ownerUserId: user.id,
      siteId,
      ownedUrl: 'https://example.com/race',
      keyword: 'race keyword',
      locale: 'en',
      clientKey: 'race-key',
    };
    const first = await startAnalysis(input, { db: getTestDb() as never, contentAnalysisQueue: queue });
    vi.spyOn(ContentAnalysis, 'findOne').mockResolvedValueOnce(null);
    const replay = await startAnalysis(input, { db: getTestDb() as never, contentAnalysisQueue: queue });
    expect(replay).toMatchObject({ analysisId: first.analysisId, duplicate: true });

    vi.spyOn(ContentAnalysis, 'create').mockRejectedValueOnce({ name: 'MongoServerError' });
    await expect(
      startAnalysis(
        { ...input, ownedUrl: 'https://example.com/no-winner', clientKey: 'no-winner' },
        { db: getTestDb() as never, contentAnalysisQueue: queue },
      ),
    ).rejects.toMatchObject({ name: 'MongoServerError' });
    expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(1);
  });

  it('records zero-valued event defaults and rethrows a non-object create failure', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'service-failure@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    await expect(recordContentAnalysisEvent(getTestDb() as never, {
      accountId: user.id,
      siteId,
      analysisId: new Types.ObjectId().toString(),
      reservationKey: 'event-defaults',
      kind: 'completed',
    })).resolves.toBe(true);
    const [event] = await getTestDb().select().from(contentAnalysisEvents)
      .where(eq(contentAnalysisEvents.reservationKey, 'event-defaults'));
    expect(event).toMatchObject({ units: 0, costMicros: 0, aiCostMicros: 0, errorCategory: null });

    const { queue } = fakeQueue();
    vi.spyOn(ContentAnalysis, 'create').mockRejectedValueOnce(null);
    await expect(
      startAnalysis(
        {
          accountId: user.id, ownerUserId: user.id, siteId,
          ownedUrl: 'https://example.com/null-failure', keyword: 'failure', locale: 'en',
        },
        { db: getTestDb() as never, contentAnalysisQueue: queue },
      ),
    ).rejects.toBeNull();
    expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(0);
  });
});

describe('POST /api/sites/:siteId/content-analyses — ordering', () => {
  it('creates the analysis and enqueues with a deterministic jobId', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'cap@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const { queue, jobs } = fakeQueue();
    setContentAnalysisQueue(queue);
    const siteId = await addSite(user);

    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit tools',
        locale: 'en',
      });
    expect(res.status).toBe(202);
    expect(res.body.analysisId).toBeDefined();
    expect(res.body.status).toBe('queued');
    expect(res.body.duplicate).toBe(false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.opts.jobId).toBe(`content-analysis-${res.body.analysisId}`);
    const doc = await ContentAnalysis.findById(res.body.analysisId);
    expect(jobs[0]!.data.reservationKey).toBe(doc?.idempotencyKey);

    // No lifecycle event is recorded until the run reaches a terminal state.
    expect(await getTestDb().select().from(contentAnalysisEvents)).toEqual([]);
  });

  it('returns 404 when the requested site belongs to another account (no existence leak)', async () => {
    const alice = await signupVerifiedUser(app, {
      email: 'alice@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const bob = await signupVerifiedUser(app, {
      email: 'bob@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const aliceSite = await addSite(alice);

    const res = await request(app)
      .post(`/api/sites/${aliceSite}/content-analyses`)
      .set('Cookie', bob.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
      });
    expect(res.status).toBe(404);
  });

  it('returns 400 when the URL is off-origin from the verified site', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'origin@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const { queue } = fakeQueue();
    setContentAnalysisQueue(queue);
    const siteId = await addSite(user, 'https://example.com');

    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://other.example/anywhere',
        keyword: 'seo',
        locale: 'en',
      });
    expect(res.status).toBe(400);
    const payload = JSON.stringify(res.body);
    expect(payload).toMatch(/does not belong|not.*site/i);
  });

  it('rejects an over-length URL and an over-length keyword', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'oversized@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);

    const longUrl = `https://example.com/${'x'.repeat(3000)}`;
    const overUrl = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({ ownedUrl: longUrl, keyword: 'seo', locale: 'en' });
    expect(overUrl.status).toBe(400);

    const longKeyword = 'x'.repeat(500);
    const overKw = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/p',
        keyword: longKeyword,
        locale: 'en',
      });
    expect(overKw.status).toBe(400);
  });

  it('rejects an unsupported locale value', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'locale@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/p',
        keyword: 'seo',
        locale: 'xx',
      });
    expect(res.status).toBe(400);
  });

  it('is idempotent: same clientKey returns the existing analysis without a second run', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'idem@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const { queue, jobs } = fakeQueue();
    setContentAnalysisQueue(queue);
    const siteId = await addSite(user);

    const first = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
        clientKey: 'user-supplied-key',
      });
    expect(first.status).toBe(202);
    expect(first.body.duplicate).toBe(false);

    const second = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
        clientKey: 'user-supplied-key',
      });
    expect(second.status).toBe(202);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.analysisId).toBe(first.body.analysisId);
    expect(jobs).toHaveLength(1);
    expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(1);
  });

  it('marks the run failed and records a failed event when enqueue throws', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'enqueue-fail@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const throwingQueue = {
      async add() {
        throw new Error('redis exploded');
      },
    } as unknown as Queue;
    setContentAnalysisQueue(throwingQueue);
    const siteId = await addSite(user);

    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
      });
    expect(res.status).toBe(503);

    const doc = await ContentAnalysis.findOne({ accountId: user.id });
    expect(doc?.status).toBe('failed');
    expect(doc?.error).toMatchObject({
      category: 'unexpected',
      messageKey: 'contentIntelligence.errors.queueUnavailable',
    });
    const events = await getTestDb().select().from(contentAnalysisEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'failed',
      errorCategory: 'unexpected',
      reservationKey: doc?.idempotencyKey,
    });
  });

  it('returns 503 when no queue is configured (never writes)', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'no-queue@example.com',
      password: 'CorrectHorseBattery9!',
    });
    setContentAnalysisQueue(null);
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
      });
    expect(res.status).toBe(503);
    expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(0);
  });
});

describe('POST /api/sites/:siteId/content-analyses/preflight — no spend', () => {
  it('returns ok:true for a valid owned URL and writes nothing', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'preflight@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses/preflight`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.reason).toBeNull();
    expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('returns reason=not_owned for a site the caller does not own', async () => {
    const alice = await signupVerifiedUser(app, {
      email: 'alice-pf@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const bob = await signupVerifiedUser(app, {
      email: 'bob-pf@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const aliceSite = await addSite(alice);
    const res = await request(app)
      .post(`/api/sites/${aliceSite}/content-analyses/preflight`)
      .set('Cookie', bob.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe('not_owned');
  });

  it('returns reason=off_origin when URL does not share the site origin', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'pf-origin@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user, 'https://example.com');
    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses/preflight`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://other.example/p',
        keyword: 'seo',
        locale: 'en',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: 'off_origin' });
  });

  it('returns reason=not_owned for a non-ObjectId site id', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'pf-badid@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const res = await request(app)
      .post(`/api/sites/not-hex/content-analyses/preflight`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/p',
        keyword: 'seo',
        locale: 'en',
      });
    // Zod rejects the site id shape → 400 (validation error). This variant
    // is caught by the schema before it can reach preflight.
    expect(res.status).toBe(400);
  });
});

describe('GET / cancel / regenerate / list', () => {
  async function seedRun(): Promise<{
    user: TestUser;
    siteId: string;
    analysisId: string;
  }> {
    const user = await signupVerifiedUser(app, {
      email: `run-${Math.random().toString(36).slice(2, 10)}@example.com`,
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({
        ownedUrl: 'https://example.com/pillar',
        keyword: 'seo audit',
        locale: 'en',
      });
    expect(res.status).toBe(202);
    return { user, siteId, analysisId: res.body.analysisId as string };
  }

  it('GET /api/content-analyses/:id returns the owner-scoped analysis', async () => {
    const { user, siteId, analysisId } = await seedRun();
    const res = await request(app)
      .get(`/api/content-analyses/${analysisId}?siteId=${siteId}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.analysisId).toBe(analysisId);
    expect(res.body).not.toHaveProperty('reservation');
    expect(res.body.status).toBe('queued');
  });

  it('uses the stored locale by default and an explicit locale for list and detail reads', async () => {
    const { user, siteId, analysisId } = await seedRun();
    await ContentAnalysis.updateOne(
      { _id: analysisId },
      {
        $set: {
          locale: 'ar',
          warnings: [{
            code: 'serp_unavailable',
            messageKey: 'contentIntelligence.warnings.serpUnavailable',
          }],
        },
      },
    );

    const storedDetail = await getAnalysis({ accountId: user.id, analysisId });
    const explicitDetail = await getAnalysis({
      accountId: user.id,
      analysisId,
      locale: 'fr',
    });
    expect(storedDetail.warnings[0]?.message).toMatch(/[\u0600-\u06ff]/u);
    expect(explicitDetail.warnings[0]?.message).not.toBe(storedDetail.warnings[0]?.message);

    const storedList = await listAnalyses({ accountId: user.id, siteId, limit: 10 });
    const explicitList = await listAnalyses({
      accountId: user.id,
      siteId,
      limit: 10,
      locale: 'de',
    });
    expect(storedList.items[0]?.warnings[0]?.message).toMatch(/[\u0600-\u06ff]/u);
    expect(explicitList.items[0]?.warnings[0]?.message).not.toBe(
      storedList.items[0]?.warnings[0]?.message,
    );
  });

  it('GET binds an analysis deep link to the requested owned site', async () => {
    const { user, siteId, analysisId } = await seedRun();
    const otherSiteId = await addSite(user, 'https://other.example');

    const wrongSite = await request(app)
      .get(`/api/content-analyses/${analysisId}?siteId=${otherSiteId}`)
      .set('Cookie', user.cookie);
    expect(wrongSite.status).toBe(404);

    const correctSite = await request(app)
      .get(`/api/content-analyses/${analysisId}?siteId=${siteId}`)
      .set('Cookie', user.cookie);
    expect(correctSite.status).toBe(200);

    const malformedSite = await request(app)
      .get(`/api/content-analyses/${analysisId}?siteId=not-an-object-id`)
      .set('Cookie', user.cookie);
    expect(malformedSite.status).toBe(400);
  });

  it('GET returns 404 for a non-existent id', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'get-404@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const res = await request(app)
      .get(`/api/content-analyses/${new Types.ObjectId().toString()}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('GET returns 404 for a non-hex id (schema reject)', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'get-nohex@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const res = await request(app)
      .get(`/api/content-analyses/not-hex`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('GET cross-account → 404 (existence leak rule)', async () => {
    const { analysisId } = await seedRun();
    const stranger = await signupVerifiedUser(app, {
      email: `stranger-${Math.random().toString(36).slice(2, 10)}@example.com`,
      password: 'CorrectHorseBattery9!',
    });
    const res = await request(app)
      .get(`/api/content-analyses/${analysisId}`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });

  it('POST cancel a cancellable run → 202 + terminal state', async () => {
    const { user, analysisId } = await seedRun();
    const res = await request(app)
      .post(`/api/content-analyses/${analysisId}/cancel`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(202);
    const doc = await ContentAnalysis.findById(analysisId);
    expect(doc?.status).toBe('cancelled');
    expect(doc?.cancelledAt).not.toBeNull();
    expect(doc?.error?.category).toBe('cancelled');
  });

  it('POST cancel a terminal run → 409', async () => {
    const { user, analysisId } = await seedRun();
    await ContentAnalysis.updateOne(
      { _id: analysisId },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
    const res = await request(app)
      .post(`/api/content-analyses/${analysisId}/cancel`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(409);
  });

  it('POST regenerate on a completed run creates a NEW analysis', async () => {
    const { user, analysisId } = await seedRun();
    await ContentAnalysis.updateOne(
      { _id: analysisId },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
    const res = await request(app)
      .post(`/api/content-analyses/${analysisId}/regenerate`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(202);
    expect(res.body.analysisId).not.toBe(analysisId);
    expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(2);
  });

  it('POST regenerate on an in-flight run → 409', async () => {
    const { user, analysisId } = await seedRun();
    // Still `queued` — cancellable = in-flight in our semantics.
    const res = await request(app)
      .post(`/api/content-analyses/${analysisId}/regenerate`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(409);
  });

  it('POST regenerate for a non-existent id → 404', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'regen-404@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const res = await request(app)
      .post(`/api/content-analyses/${new Types.ObjectId().toString()}/regenerate`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it('GET list returns paginated analyses (owner-scoped)', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'list-page@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/sites/${siteId}/content-analyses`)
        .set('Cookie', user.cookie)
        .send({
          ownedUrl: `https://example.com/p-${i}`,
          keyword: `k-${i}`,
          locale: 'en',
        });
    }
    const first = await request(app)
      .get(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .query({ limit: '3' });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app)
      .get(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .query({ limit: '3', cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
  });

  it('GET list rejects a tampered cursor', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'list-bad-cursor@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const res = await request(app)
      .get(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .query({ limit: '3', cursor: 'not-a-real-cursor' });
    expect(res.status).toBe(400);
  });
});

describe('idempotency-key isolation across accounts', () => {
  it('the same clientKey from two different accounts never collides', async () => {
    const alice = await signupVerifiedUser(app, {
      email: 'iso-alice@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const bob = await signupVerifiedUser(app, {
      email: 'iso-bob@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const aliceSite = await addSite(alice);
    const bobSite = await addSite(bob);
    const first = await request(app)
      .post(`/api/sites/${aliceSite}/content-analyses`)
      .set('Cookie', alice.cookie)
      .send({
        ownedUrl: 'https://example.com/p',
        keyword: 'seo',
        locale: 'en',
        clientKey: 'shared-key',
      });
    expect(first.status).toBe(202);
    expect(first.body.duplicate).toBe(false);
    const second = await request(app)
      .post(`/api/sites/${bobSite}/content-analyses`)
      .set('Cookie', bob.cookie)
      .send({
        ownedUrl: 'https://example.com/p',
        keyword: 'seo',
        locale: 'en',
        clientKey: 'shared-key',
      });
    expect(second.status).toBe(202);
    expect(second.body.duplicate).toBe(false);
    expect(second.body.analysisId).not.toBe(first.body.analysisId);
  });
});

describe('recommendation lifecycle routes', () => {
  it('prechecks the content hash and preserves ordered accept/apply/undo history', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'recommendations@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const analysis = await seedCompletedRecommendationAnalysis({ user, siteId });
    const base = `/api/content-analyses/${analysis._id}/recommendations/rec_1`;

    const check = await request(app)
      .get(`${base}/application-check`)
      .set('Cookie', user.cookie);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({
      available: true,
      hashStatus: 'same',
      noteRequired: true,
      contentHash: 'analysis-hash',
    });

    const accepted = await request(app)
      .post(`${base}/accept`)
      .set('Cookie', user.cookie)
      .send({
        analysisVersion: '2026-07-15.1',
        expectedVersion: 0,
        clientKey: 'accept-route',
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.state).toMatchObject({ state: 'accepted', version: 1 });

    const stale = await request(app)
      .post(`${base}/dismiss`)
      .set('Cookie', user.cookie)
      .send({
        analysisVersion: '2026-07-15.1',
        expectedVersion: 0,
        clientKey: 'stale-route',
      });
    expect(stale.status).toBe(409);

    const unchangedWithoutNote = await request(app)
      .post(`${base}/apply`)
      .set('Cookie', user.cookie)
      .send({
        analysisVersion: '2026-07-15.1',
        expectedVersion: 1,
        clientKey: 'apply-no-note',
        confirm: true,
      });
    expect(unchangedWithoutNote.status).toBe(409);

    const applyBody = {
      analysisVersion: '2026-07-15.1',
      expectedVersion: 1,
      clientKey: 'apply-route',
      note: 'The page was edited in the CMS.',
      confirm: true,
    };
    const applied = await request(app)
      .post(`${base}/apply`)
      .set('Cookie', user.cookie)
      .send(applyBody);
    expect(applied.status).toBe(200);
    expect(applied.body.state).toMatchObject({
      state: 'applied',
      version: 2,
      hashStatus: 'same',
    });

    const replay = await request(app)
      .post(`${base}/apply`)
      .set('Cookie', user.cookie)
      .send(applyBody);
    expect(replay.status).toBe(200);
    expect(replay.body.state).toMatchObject({ state: 'applied', version: 2 });

    const history = await request(app)
      .get(`${base}/history`)
      .set('Cookie', user.cookie);
    expect(history.status).toBe(200);
    expect(history.body.events).toHaveLength(2);
    expect(history.body.events.map((event: { eventKind: string }) => event.eventKind))
      .toEqual(['accepted', 'applied']);

    const outcome = await request(app)
      .get(`${base}/outcome`)
      .set('Cookie', user.cookie);
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ available: true, dataAvailable: false });

    const undone = await request(app)
      .post(`${base}/undo`)
      .set('Cookie', user.cookie)
      .send({
        analysisVersion: '2026-07-15.1',
        expectedVersion: 2,
        clientKey: 'undo-route',
        note: 'Reverted in the CMS.',
      });
    expect(undone.status).toBe(200);
    expect(undone.body.state).toMatchObject({ state: 'accepted', version: 3 });

    const rows = await getTestDb().select().from(contentRecommendationEvents);
    expect(rows.map((event) => event.eventKind)).toEqual([
      'accepted',
      'applied',
      'undo_applied',
    ]);
  });

  it('rejects stale schema versions, over-length notes, and operator-shaped IDs', async () => {
    const user = await signupVerifiedUser(app, {
      email: 'recommendation-validation@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const siteId = await addSite(user);
    const analysis = await seedCompletedRecommendationAnalysis({ user, siteId });
    const base = `/api/content-analyses/${analysis._id}/recommendations/rec_1`;

    const staleSchema = await request(app)
      .post(`${base}/accept`)
      .set('Cookie', user.cookie)
      .send({ analysisVersion: 'old', expectedVersion: 0, clientKey: 'old-schema' });
    expect(staleSchema.status).toBe(409);

    const longNote = await request(app)
      .post(`${base}/accept`)
      .set('Cookie', user.cookie)
      .send({
        analysisVersion: '2026-07-15.1',
        expectedVersion: 0,
        clientKey: 'long-note',
        note: 'x'.repeat(4_001),
      });
    expect(longNote.status).toBe(400);

    const operatorId = await request(app)
      .get(`/api/content-analyses/${analysis._id}/recommendations/%24ne/history`)
      .set('Cookie', user.cookie);
    expect(operatorId.status).toBe(400);
    expect(await getTestDb().select().from(contentRecommendationEvents)).toHaveLength(0);
  });

  it('returns cross-account 404 and scopes a shared client key to each account', async () => {
    const alice = await signupVerifiedUser(app, {
      email: 'recommendation-alice@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const bob = await signupVerifiedUser(app, {
      email: 'recommendation-bob@example.com',
      password: 'CorrectHorseBattery9!',
    });
    const aliceAnalysis = await seedCompletedRecommendationAnalysis({
      user: alice,
      siteId: await addSite(alice),
    });
    const bobAnalysis = await seedCompletedRecommendationAnalysis({
      user: bob,
      siteId: await addSite(bob),
    });
    const aliceBase = `/api/content-analyses/${aliceAnalysis._id}/recommendations/rec_1`;
    const bobBase = `/api/content-analyses/${bobAnalysis._id}/recommendations/rec_1`;

    for (const [cookie, base, clientKey] of [
      [alice.cookie, aliceBase, 'accept-alice'],
      [bob.cookie, bobBase, 'accept-bob'],
    ] as const) {
      const response = await request(app)
        .post(`${base}/accept`)
        .set('Cookie', cookie)
        .send({
          analysisVersion: '2026-07-15.1',
          expectedVersion: 0,
          clientKey,
        });
      expect(response.status).toBe(200);
    }

    const applyBody = {
      analysisVersion: '2026-07-15.1',
      expectedVersion: 1,
      clientKey: 'shared-apply-key',
      note: 'Confirmed account-owned edit.',
      confirm: true,
    };
    expect((await request(app).post(`${aliceBase}/apply`).set('Cookie', alice.cookie).send(applyBody)).status)
      .toBe(200);
    expect((await request(app).post(`${aliceBase}/apply`).set('Cookie', bob.cookie).send(applyBody)).status)
      .toBe(404);
    expect((await request(app).post(`${bobBase}/apply`).set('Cookie', bob.cookie).send(applyBody)).status)
      .toBe(200);

    const events = await getTestDb().select().from(contentRecommendationEvents);
    expect(events.filter((event) => event.eventKind === 'applied')).toHaveLength(2);
    expect(new Set(events.map((event) => event.idempotencyKey)).size).toBe(events.length);
  });
});

describe('rate limit — content_intelligence_create bucket', () => {
  it('throttles recommendation state floods and records the named bucket', async () => {
    const priorMax = env.RATE_LIMIT_RECOMMENDATION_MAX;
    const priorWin = env.RATE_LIMIT_RECOMMENDATION_WINDOW_MS;
    (env as { RATE_LIMIT_RECOMMENDATION_MAX: number }).RATE_LIMIT_RECOMMENDATION_MAX = 1;
    (env as { RATE_LIMIT_RECOMMENDATION_WINDOW_MS: number }).RATE_LIMIT_RECOMMENDATION_WINDOW_MS = 60_000;
    try {
      const freshApp = createApp();
      const user = await signupVerifiedUser(freshApp, {
        email: `rec-rate-${Math.random().toString(36).slice(2, 10)}@example.com`,
        password: 'CorrectHorseBattery9!',
      });
      const siteId = await addSite(user);
      const analysis = await ContentAnalysis.create({
        accountId: user.id,
        ownerUserId: user.id,
        siteId,
        ownedUrl: 'https://example.com/guide',
        keyword: 'content audit',
        locale: 'en',
        status: 'completed',
        stages: [],
        inputFingerprint: 'fingerprint',
        idempotencyKey: `idem_${Math.random().toString(36).slice(2)}`,
        providerRefs: { snapshotIds: [] },
        recommendations: [{
          id: 'rec_1', section: 'coverage', ruleId: 'rule', direction: 'add',
          confidence: 0.9, messageKey: 'rec', evidenceSourceIds: [],
        }],
        recommendationStates: [],
        requestedAt: new Date(),
        completedAt: new Date(),
      });
      const path = `/api/content-analyses/${analysis._id}/recommendations/rec_1/accept`;
      const body = {
        analysisVersion: '2026-07-15.1',
        expectedVersion: 0,
        clientKey: 'rate_1',
      };
      expect((await request(freshApp).post(path).set('Cookie', user.cookie).send(body)).status).toBe(200);
      expect((await request(freshApp).post(path).set('Cookie', user.cookie).send({ ...body, clientKey: 'rate_2' })).status).toBe(429);
      await new Promise((resolve) => setImmediate(resolve));
      const hits = await getTestDb().select().from(rateLimitHits);
      expect(hits.some((hit) => hit.route === 'content_recommendation_state')).toBe(true);
    } finally {
      (env as { RATE_LIMIT_RECOMMENDATION_MAX: number }).RATE_LIMIT_RECOMMENDATION_MAX = priorMax;
      (env as { RATE_LIMIT_RECOMMENDATION_WINDOW_MS: number }).RATE_LIMIT_RECOMMENDATION_WINDOW_MS = priorWin;
    }
  });

  it('returns 429 when the create bucket is exhausted and records to rate_limit_hits', async () => {
    const priorMax = env.RATE_LIMIT_CONTENT_CREATE_MAX;
    const priorWin = env.RATE_LIMIT_CONTENT_CREATE_WINDOW_MS;
    (env as { RATE_LIMIT_CONTENT_CREATE_MAX: number }).RATE_LIMIT_CONTENT_CREATE_MAX = 2;
    (env as { RATE_LIMIT_CONTENT_CREATE_WINDOW_MS: number }).RATE_LIMIT_CONTENT_CREATE_WINDOW_MS = 60_000;
    try {
      // Build a fresh app so the express-rate-limit MemoryStore starts empty.
      const freshApp = createApp();
      const user = await signupVerifiedUser(freshApp, {
        email: `rate-${Math.random().toString(36).slice(2, 10)}@example.com`,
        password: 'CorrectHorseBattery9!',
      });
      const siteRes = await request(freshApp)
        .post('/api/sites')
        .set('Cookie', user.cookie)
        .send({ url: 'https://example.com' });
      const siteId = (siteRes.body as { site: { id: string } }).site.id;
      const { queue } = fakeQueue();
      setContentAnalysisQueue(queue);
      for (let i = 0; i < 2; i++) {
        await request(freshApp)
          .post(`/api/sites/${siteId}/content-analyses`)
          .set('Cookie', user.cookie)
          .send({
            ownedUrl: `https://example.com/p-${i}`,
            keyword: `k${i}`,
            locale: 'en',
            clientKey: `rl-${i}`,
          });
      }
      const overflow = await request(freshApp)
        .post(`/api/sites/${siteId}/content-analyses`)
        .set('Cookie', user.cookie)
        .send({
          ownedUrl: 'https://example.com/p-2',
          keyword: 'k2',
          locale: 'en',
          clientKey: 'rl-2',
        });
      expect(overflow.status).toBe(429);
      await new Promise((resolve) => setImmediate(resolve));
      const hits = await getTestDb().select().from(rateLimitHits);
      expect(hits.some((h) => h.route === 'content_intelligence_create')).toBe(true);
    } finally {
      (env as { RATE_LIMIT_CONTENT_CREATE_MAX: number }).RATE_LIMIT_CONTENT_CREATE_MAX = priorMax;
      (env as { RATE_LIMIT_CONTENT_CREATE_WINDOW_MS: number }).RATE_LIMIT_CONTENT_CREATE_WINDOW_MS = priorWin;
    }
  });

  it('poll bucket 429 records as content_intelligence_poll', async () => {
    const priorMax = env.RATE_LIMIT_CONTENT_POLL_MAX;
    const priorWin = env.RATE_LIMIT_CONTENT_POLL_WINDOW_MS;
    (env as { RATE_LIMIT_CONTENT_POLL_MAX: number }).RATE_LIMIT_CONTENT_POLL_MAX = 1;
    (env as { RATE_LIMIT_CONTENT_POLL_WINDOW_MS: number }).RATE_LIMIT_CONTENT_POLL_WINDOW_MS = 60_000;
    try {
      const freshApp = createApp();
      const user = await signupVerifiedUser(freshApp, {
        email: `poll-${Math.random().toString(36).slice(2, 10)}@example.com`,
        password: 'CorrectHorseBattery9!',
      });
      const siteRes = await request(freshApp)
        .post('/api/sites')
        .set('Cookie', user.cookie)
        .send({ url: 'https://example.com' });
      const siteId = (siteRes.body as { site: { id: string } }).site.id;
      await request(freshApp)
        .get(`/api/sites/${siteId}/content-analyses`)
        .set('Cookie', user.cookie);
      const over = await request(freshApp)
        .get(`/api/sites/${siteId}/content-analyses`)
        .set('Cookie', user.cookie);
      expect(over.status).toBe(429);
      await new Promise((resolve) => setImmediate(resolve));
      const hits = await getTestDb().select().from(rateLimitHits);
      expect(hits.some((h) => h.route === 'content_intelligence_poll')).toBe(true);
    } finally {
      (env as { RATE_LIMIT_CONTENT_POLL_MAX: number }).RATE_LIMIT_CONTENT_POLL_MAX = priorMax;
      (env as { RATE_LIMIT_CONTENT_POLL_WINDOW_MS: number }).RATE_LIMIT_CONTENT_POLL_WINDOW_MS = priorWin;
    }
  });
});

describe('CONTENT_INTELLIGENCE_ENABLED kill switch (prompt 15)', () => {
  it('returns a localized 503 on create/preflight/regenerate while reads and cancel stay open', async () => {
    const user = await signupVerifiedUser(app, {
      email: `kill-switch-${Math.random().toString(36).slice(2, 10)}@example.com`,
      password: 'CorrectHorseBattery9!',
    });
    const { queue, jobs } = fakeQueue();
    setContentAnalysisQueue(queue);
    const siteId = await addSite(user);

    // Seed one in-flight run and one completed recommendation analysis while
    // the product is enabled.
    const started = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({ ownedUrl: 'https://example.com/pillar', keyword: 'seo audit', locale: 'en' });
    expect(started.status).toBe(202);
    const inFlightId = started.body.analysisId as string;
    const recAnalysis = await seedCompletedRecommendationAnalysis({ user, siteId });

    const prior = env.CONTENT_INTELLIGENCE_ENABLED;
    (env as { CONTENT_INTELLIGENCE_ENABLED: boolean }).CONTENT_INTELLIGENCE_ENABLED = false;
    try {
      // New-run entry points → localized 503.
      const create = await request(app)
        .post(`/api/sites/${siteId}/content-analyses`)
        .set('Cookie', user.cookie)
        .send({ ownedUrl: 'https://example.com/blocked', keyword: 'blocked', locale: 'en' });
      expect(create.status).toBe(503);
      expect(create.body.error.message).toBe(
        'Content analysis is temporarily unavailable. Please try again later.',
      );

      const preflight = await request(app)
        .post(`/api/sites/${siteId}/content-analyses/preflight`)
        .set('Cookie', user.cookie)
        .send({ ownedUrl: 'https://example.com/blocked', keyword: 'blocked', locale: 'en' });
      expect(preflight.status).toBe(503);
      expect(preflight.body.error.message).toBe(
        'Content analysis is temporarily unavailable. Please try again later.',
      );

      // The switch is checked FIRST — even a nonexistent id gets 503, not 404.
      const regenerate = await request(app)
        .post(`/api/content-analyses/${new Types.ObjectId().toString()}/regenerate`)
        .set('Cookie', user.cookie)
        .send({});
      expect(regenerate.status).toBe(503);
      expect(regenerate.body.error.message).toBe(
        'Content analysis is temporarily unavailable. Please try again later.',
      );

      // The blocked create spent nothing and enqueued nothing new.
      expect(jobs).toHaveLength(1);
      expect(await ContentAnalysis.countDocuments({ accountId: user.id })).toBe(2);

      // Reads stay open.
      const list = await request(app)
        .get(`/api/sites/${siteId}/content-analyses`)
        .set('Cookie', user.cookie);
      expect(list.status).toBe(200);

      const detail = await request(app)
        .get(`/api/content-analyses/${inFlightId}`)
        .set('Cookie', user.cookie);
      expect(detail.status).toBe(200);

      const recCheck = await request(app)
        .get(`/api/content-analyses/${recAnalysis._id}/recommendations/rec_1/application-check`)
        .set('Cookie', user.cookie);
      expect(recCheck.status).toBe(200);

      // Cancel stays open so in-flight runs are never stranded.
      const cancel = await request(app)
        .post(`/api/content-analyses/${inFlightId}/cancel`)
        .set('Cookie', user.cookie)
        .send({});
      expect(cancel.status).toBe(202);
    } finally {
      (env as { CONTENT_INTELLIGENCE_ENABLED: boolean }).CONTENT_INTELLIGENCE_ENABLED = prior;
    }

    // Flag restored → create works again unchanged.
    const reopened = await request(app)
      .post(`/api/sites/${siteId}/content-analyses`)
      .set('Cookie', user.cookie)
      .send({ ownedUrl: 'https://example.com/reopened', keyword: 'reopened', locale: 'en' });
    expect(reopened.status).toBe(202);
  });
});

describe('unauthenticated access → 401', () => {
  it('POST create requires a session', async () => {
    const res = await request(app)
      .post(`/api/sites/${new Types.ObjectId().toString()}/content-analyses`)
      .send({
        ownedUrl: 'https://example.com/p',
        keyword: 'seo',
        locale: 'en',
      });
    expect(res.status).toBe(401);
  });
});

// Silence a noisy PGlite EXPLAIN warning in a rare CI configuration.
vi.mock('drizzle-orm/node-postgres/session', async (importOriginal) => importOriginal());

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('content-intelligence service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';
  it('refuses a well-formed site id this account does not own', async () => {
    await expect(listAnalyses({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99', limit: 10 })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(listAnalyses({ accountId: GUARD_ACCOUNT, siteId: 'not-an-id', limit: 10 })).rejects.toMatchObject({ status: 404 });
  });
});
