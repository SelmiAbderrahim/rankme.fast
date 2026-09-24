import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { keywords } from '../../db/schema/keywords.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
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
import { recordObservation } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import {
  setContentBriefAi,
  setContentBriefDb,
  setContentBriefQueue,
} from './content-brief.holder.js';
import { ContentBrief } from './content-brief.model.js';
import { listContentBriefs } from './content-brief.service.js';

const app = createApp();
const NOW = new Date();
let emailSequence = 0;
let queueAdd: ReturnType<typeof vi.fn>;

async function account(): Promise<{ user: TestUser; siteId: string; keywordId: string }> {
  emailSequence += 1;
  const user = await signupVerifiedUser(app, {
    email: `content-brief-${emailSequence}@example.test`,
  });
  const site = await Site.create({
    accountId: user.id,
    url: `https://site-${emailSequence}.example`,
    domain: `site-${emailSequence}.example`,
  });
  const [keyword] = await getTestDb().insert(keywords).values({
    accountId: user.id,
    siteId: String(site._id),
    phrase: 'evidence led seo',
    locationCode: 2840,
    languageCode: 'en',
    device: 'desktop',
    engine: 'google',
  }).returning({ id: keywords.id });
  return { user, siteId: String(site._id), keywordId: keyword!.id };
}

async function addStoredObservation(
  context: { user: TestUser; siteId: string; keywordId: string },
): Promise<void> {
  await recordObservation(getTestDb() as never, {
    accountId: context.user.id,
    siteId: context.siteId,
    keywordId: context.keywordId,
    checkedAt: NOW,
    source: 'fresh',
    features: {
      features: [], featuredSnippet: null,
      paa: [{ question: 'Why use evidence?', answerDomain: null, answerUrl: null }],
    },
    topResults: [{
      domain: 'result.example', url: 'https://result.example/guide', rankGroup: 1, rankAbsolute: 1,
    }],
  }, NOW);
}

function preview(context: { user: TestUser; siteId: string }) {
  return request(app)
    .post(`/api/sites/${context.siteId}/content-briefs/preview`)
    .set('Cookie', context.user.cookie)
    .send({ keyword: 'Evidence Led SEO', locale: 'en' });
}

function create(
  context: { user: TestUser; siteId: string },
  clientKey = `key-${Math.random().toString(16).slice(2)}`,
) {
  return request(app)
    .post(`/api/sites/${context.siteId}/content-briefs`)
    .set('Cookie', context.user.cookie)
    .send({ keyword: 'Evidence Led SEO', locale: 'en', clientKey });
}

async function terminalBrief(context: {
  user: TestUser;
  siteId: string;
  keywordId: string;
}, overrides: Record<string, unknown> = {}) {
  return ContentBrief.create({
    accountId: context.user.id,
    siteId: context.siteId,
    keywordId: context.keywordId,
    keyword: 'evidence led seo',
    locale: 'en',
    reservationKey: `stored-${new mongoose.Types.ObjectId()}`,
    status: 'completed',
    runCeilingMicros: 120_000,
    serpSource: 'stored',
    serpCheckedAt: NOW,
    documents: [{
      id: 'doc-1', sourceUrl: 'https://result.example/guide', title: '<img onerror=alert(1)>',
      excerpt: '<script>alert(1)</script>', headings: [{ level: 1, text: '<b>Heading</b>' }],
      capturedAt: NOW, wordCount: 100, entityLabels: ['Article'],
    }],
    corpusStats: {
      wordCount: { min: 100, max: 100, average: 100, documentCount: 1 },
      headingHistogram: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      entities: [{ label: 'Article', documentCount: 1 }], scrapeDates: [NOW],
    },
    outline: [{ id: 'outline-1', heading: 'Stored outline', purpose: 'Guidance', citations: ['doc-1'] }],
    ...overrides,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setContentBriefDb(db as never);
  setContentBriefAi(
    createAiProfileRunner({ provider: createFakeAiGenerationProvider() }),
    ['fake'],
  );
});

afterAll(async () => {
  uninstallTestAuth();
  setContentBriefDb(null);
  setContentBriefQueue(null);
  setContentBriefAi(null);
  (env as { CONTENT_BRIEFS_ENABLED: boolean }).CONTENT_BRIEFS_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { CONTENT_BRIEFS_ENABLED: boolean }).CONTENT_BRIEFS_ENABLED = true;
  (env as { CONTENT_BRIEF_COST_CEILING_MICROS: number }).CONTENT_BRIEF_COST_CEILING_MICROS = 120_000;
  queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
  setContentBriefQueue({ add: queueAdd } as unknown as Queue);
});

describe('content-brief authenticated routes', () => {
  it('requires authentication on every endpoint', async () => {
    const siteId = new mongoose.Types.ObjectId().toString();
    const briefId = new mongoose.Types.ObjectId().toString();
    await request(app).post(`/api/sites/${siteId}/content-briefs/preview`).send({}).expect(401);
    await request(app).post(`/api/sites/${siteId}/content-briefs`).send({}).expect(401);
    await request(app).get(`/api/sites/${siteId}/content-briefs`).expect(401);
    await request(app).get(`/api/sites/${siteId}/content-briefs/${briefId}`).expect(401);
    await request(app).post(`/api/sites/${siteId}/content-briefs/${briefId}/drafts`).send({}).expect(401);
  });

  it('returns the community spend preview without enqueueing', async () => {
    const stored = await account();
    await addStoredObservation(stored);
    const cached = await preview(stored).expect(200);
    expect(cached.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('blocks writes while disabled but keeps stored list and detail reads available', async () => {
    const agency = await account();
    await request(app)
      .post(`/api/sites/${agency.siteId}/content-briefs`)
      .set('Cookie', agency.user.cookie)
      .send({ keyword: 'not tracked', locale: 'en' })
      .expect(422);
    await request(app)
      .post(`/api/sites/${agency.siteId}/content-briefs`)
      .set('Cookie', agency.user.cookie)
      .send({ keyword: '', locale: 'en', unexpected: true })
      .expect(400);
    const stored = await terminalBrief(agency);
    (env as { CONTENT_BRIEFS_ENABLED: boolean }).CONTENT_BRIEFS_ENABLED = false;
    await create(agency).expect(503);
    await preview(agency).expect(503);
    const list = await request(app)
      .get(`/api/sites/${agency.siteId}/content-briefs`)
      .set('Cookie', agency.user.cookie)
      .expect(200);
    expect(list.body).toMatchObject({ creationEnabled: false });
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: String(stored._id), keyword: 'evidence led seo' }),
    ]);
    const detail = await request(app)
      .get(`/api/sites/${agency.siteId}/content-briefs/${stored._id}`)
      .set('Cookie', agency.user.cookie)
      .expect(200);
    expect(detail.body).toMatchObject({ id: String(stored._id), creationEnabled: false });
    await request(app)
      .post(`/api/sites/${agency.siteId}/content-briefs/${stored._id}/drafts`)
      .set('Cookie', agency.user.cookie)
      .send({ draft: 'Stored draft', locale: 'en' })
      .expect(503);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('returns cross-account 404 before disabled-state disclosure', async () => {
    const owner = await account();
    const stranger = await account();
    const brief = await terminalBrief(owner);
    (env as { CONTENT_BRIEFS_ENABLED: boolean }).CONTENT_BRIEFS_ENABLED = false;
    await request(app)
      .get(`/api/sites/${owner.siteId}/content-briefs/${brief._id}`)
      .set('Cookie', stranger.user.cookie)
      .expect(404);
    await request(app)
      .get(`/api/sites/${owner.siteId}/content-briefs`)
      .set('Cookie', stranger.user.cookie)
      .expect(404);
    await request(app)
      .post(`/api/sites/${owner.siteId}/content-briefs/${brief._id}/drafts`)
      .set('Cookie', stranger.user.cookie)
      .send({ draft: 'draft', locale: 'en' })
      .expect(404);
  });

  it('reopens stored briefs, lists with filters/cursors, and preserves untrusted text literally', async () => {
    const context = await account();
    const first = await terminalBrief(context);
    await terminalBrief(context, { status: 'completed_partial' });
    const detail = await request(app)
      .get(`/api/sites/${context.siteId}/content-briefs/${first._id}`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(detail.body.documents[0]).toMatchObject({
      title: '<img onerror=alert(1)>', trust: 'untrusted',
    });
    expect(detail.body.creationEnabled).toBe(true);
    const list = await request(app)
      .get(`/api/sites/${context.siteId}/content-briefs?status=all&limit=1`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.creationEnabled).toBe(true);
    expect(list.body.nextCursor).toEqual(expect.any(String));
    const pageTwo = await request(app)
      .get(`/api/sites/${context.siteId}/content-briefs?status=all&limit=1&cursor=${list.body.nextCursor}`)
      .set('Cookie', context.user.cookie)
      .expect(200);
    expect(pageTwo.body.items).toHaveLength(1);
  });

  it('idempotently reuses a client key and fails the brief when enqueue fails', async () => {
    const context = await account();
    const first = await create(context, 'same-key').expect(202);
    const duplicate = await create(context, 'same-key').expect(202);
    expect(duplicate.body).toMatchObject({
      briefId: first.body.briefId, duplicate: true,
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);

    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    await create(context, 'queue-failure').expect(503);
    expect(await ContentBrief.findOne({ reservationKey: { $ne: first.body.briefId }, status: 'failed' }))
      .not.toBeNull();
  });

  it('appends deterministic plus bounded AI score history', async () => {
    const context = await account();
    const brief = await terminalBrief(context);
    const scored = await request(app)
      .post(`/api/sites/${context.siteId}/content-briefs/${brief._id}/drafts`)
      .set('Cookie', context.user.cookie)
      .send({ draft: '# Draft\nArticle guidance text', locale: 'en' })
      .expect(200);
    expect(scored.body.scoreHistory[0]).toMatchObject({
      version: 1,
      aiScore: 72,
      aiDisclosure: 'scored',
      comparison: { headingCount: 1, matchedEntities: 1 },
      trust: 'untrusted',
    });
  });

  it('falls back to deterministic-only editor guidance when ceiling residue is exhausted', async () => {
    const context = await account();
    const brief = await terminalBrief(context, { totalCostMicros: 80_000 });
    const result = await request(app)
      .post(`/api/sites/${context.siteId}/content-briefs/${brief._id}/drafts`)
      .set('Cookie', context.user.cookie)
      .send({ draft: 'Plain draft', locale: 'en' })
      .expect(200);
    expect(result.body.scoreHistory[0]).toMatchObject({
      aiScore: null, aiDisclosure: 'cost_ceiling', aiCostMicros: 0,
    });
    expect(result.body.cost.residueMicros).toBe(40_000);
  });

  it('uses a separate named per-account limiter for repeated editor scoring', async () => {
    const context = await account();
    const brief = await terminalBrief(context, { totalCostMicros: 80_000 });
    let last: request.Response | undefined;
    for (let index = 0; index < 11; index += 1) {
      last = await request(app)
        .post(`/api/sites/${context.siteId}/content-briefs/${brief._id}/drafts`)
        .set('Cookie', context.user.cookie)
        .send({ draft: `Draft ${index}`, locale: 'en' });
    }
    expect(last?.status).toBe(429);
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('content-brief service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(
      listContentBriefs(GUARD_ACCOUNT, '6a6fa7c28d75c2fd32d84a99', {
        status: 'all',
        limit: 20,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(
      listContentBriefs(GUARD_ACCOUNT, 'not-an-id', { status: 'all', limit: 20 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
