import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { keywords } from '../../db/schema/keywords.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
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
import { SerpClusterRun } from '../keyword-clusters/index.js';
import { Site } from '../sites/index.js';
import { ContentBrief, CONTENT_BRIEF_MAX_DRAFT_VERSIONS } from './content-brief.model.js';
import {
  CONTENT_BRIEF_AI_MAX_COST_MICROS,
  CONTENT_BRIEF_CONFLICT_KEY,
  CONTENT_BRIEF_SERP_FRESHNESS_MS,
  createContentBrief,
  decodeContentBriefCursor,
  encodeContentBriefCursor,
  getContentBrief,
  isFreshBriefObservation,
  listContentBriefs,
  previewContentBrief,
  readBriefSecondaryTerms,
  rescoreContentBriefDraft as rescoreContentBriefDraftService,
  serializeContentBriefDetail,
  type RescoreContentBriefDeps,
} from './content-brief.service.js';

const ACCOUNT = '000000000000000000000811';
const SITE = '000000000000000000000812';
const NOW = new Date('2026-08-01T12:00:00.000Z');

function rescoreContentBriefDraft(
  accountId: string,
  siteId: string,
  briefId: string,
  input: Parameters<typeof rescoreContentBriefDraftService>[3],
  deps: Omit<RescoreContentBriefDeps, 'db'>,
) {
  return rescoreContentBriefDraftService(accountId, siteId, briefId, input, {
    ...deps,
    db: getTestDb() as never,
  });
}

async function seed() {
  await Site.create({
    _id: SITE,
    accountId: ACCOUNT,
    url: 'https://owned.example',
    domain: 'owned.example',
  });
  const [keyword] = await getTestDb()
    .insert(keywords)
    .values({
      accountId: ACCOUNT,
      siteId: SITE,
      phrase: 'evidence led seo',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine: 'google',
    })
    .returning({ id: keywords.id });
  return keyword!.id;
}

async function completeBrief(
  keywordId: string,
  overrides: Record<string, unknown> = {},
) {
  return ContentBrief.create({
    accountId: ACCOUNT,
    siteId: SITE,
    keywordId,
    keyword: 'evidence led seo',
    locale: 'en',
    reservationKey: `service-${new mongoose.Types.ObjectId()}`,
    status: 'completed',
    runCeilingMicros: 120_000,
    serpSource: 'stored',
    serpCheckedAt: NOW,
    paaRows: [
      {
        id: 'paa-1',
        question: 'What is evidence?',
        answerDomain: 'answer.example',
        answerUrl: 'https://answer.example/source',
      },
      {
        id: 'paa-2',
        question: 'Unsafe answer?',
        answerDomain: null,
        answerUrl: 'javascript:alert(1)',
      },
      {
        id: 'paa-3',
        question: 'Malformed answer?',
        answerDomain: null,
        answerUrl: 'not a url',
      },
      {
        id: 'paa-4',
        question: 'No linked answer?',
        answerDomain: null,
        answerUrl: null,
      },
    ],
    documents: [
      {
        id: 'doc-1',
        sourceUrl: 'https://result.example/guide',
        title: 'Evidence guide',
        excerpt: 'Evidence led article guidance.',
        headings: [{ level: 1, text: 'Evidence guide' }],
        capturedAt: NOW,
        wordCount: 4,
        entityLabels: ['Article'],
      },
      {
        id: 'doc-2',
        sourceUrl: 'mailto:unsafe@example.test',
        title: 'Literal hostile URL',
        excerpt: '',
        headings: [],
        capturedAt: NOW,
        wordCount: 0,
        entityLabels: [],
      },
    ],
    corpusStats: {
      wordCount: { min: 0, max: 4, average: 2, documentCount: 2 },
      headingHistogram: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      entities: [{ label: 'Article', documentCount: 1 }],
      scrapeDates: [NOW],
    },
    outline: [
      {
        id: 'outline-1',
        heading: 'Evidence outline',
        purpose: 'Use the retained corpus.',
        citations: ['doc-1'],
      },
    ],
    questions: [{ question: 'What is evidence?', citations: ['paa-1'] }],
    secondaryTerms: [{ id: 'term-1', term: 'proof driven seo' }],
    abstentions: ['contentBriefs.abstentions.questions'],
    costEntries: [{ stage: 'scrape', costMicros: 1_000, source: 'estimated' }],
    totalCostMicros: 1_000,
    terminalAt: NOW,
    ...overrides,
  });
}

function scoredAi(options?: {
  malformed?: boolean;
  throws?: boolean;
  captured?: boolean;
  estimatedMicros?: bigint;
}): AiProfileRunner {
  return {
    preflight() {},
    async run() {
      if (options?.throws) throw new Error('provider unavailable');
      if (options?.captured) recordVendorCostUsd(0.004);
      return {
        object: options?.malformed
          ? {
              outline: [{ id: 'forbidden', heading: 'Injected', purpose: 'No', citations: ['foreign'] }],
              questions: [],
              score: 99,
              rationale: 'Unstored promise',
              citations: [],
            }
          : {
              outline: [],
              questions: [],
              score: 71,
              rationale: 'Grounded guidance only.',
              citations: ['doc-1'],
            },
        status: 'complete',
        provenance: { actualOrEstimatedCostMicros: options?.estimatedMicros ?? 5_000n },
      } as never;
    },
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clearCollections();
  await truncateAllTables();
  (env as { CONTENT_BRIEFS_ENABLED: boolean }).CONTENT_BRIEFS_ENABLED = true;
  (env as { CONTENT_BRIEF_COST_CEILING_MICROS: number }).CONTENT_BRIEF_COST_CEILING_MICROS = 120_000;
});

describe('content-brief service boundaries', () => {
  it('returns the community spend preview for a tracked keyword', async () => {
    await seed();
    (env as { CONTENT_BRIEFS_ENABLED: boolean }).CONTENT_BRIEFS_ENABLED = true;

    await expect(
      previewContentBrief(ACCOUNT, SITE, { keyword: 'evidence led seo', locale: 'en' }, {
        db: getTestDb() as never,
      }),
    ).resolves.toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
    });
  });

  it('classifies observation freshness at the exact boundary', () => {
    const base = {
      engine: 'google' as const,
      checkedAt: new Date(NOW.getTime() - CONTENT_BRIEF_SERP_FRESHNESS_MS),
    };
    expect(isFreshBriefObservation(null, NOW)).toBe(false);
    expect(isFreshBriefObservation({ ...base, engine: 'bing' } as never, NOW)).toBe(false);
    expect(isFreshBriefObservation(base as never, NOW)).toBe(true);
    expect(
      isFreshBriefObservation(
        { ...base, checkedAt: new Date(base.checkedAt.getTime() - 1) } as never,
        NOW,
      ),
    ).toBe(false);
  });

  it('rejects invalid site ids and unavailable queue before persisting', async () => {
    const keywordId = await seed();
    await expect(
      createContentBrief(ACCOUNT, 'invalid', { keyword: 'evidence led seo', locale: 'en' }, {
        db: getTestDb() as never,
        queue: {} as Queue,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createContentBrief(ACCOUNT, SITE, { keyword: 'evidence led seo', locale: 'en' }, {
        db: getTestDb() as never,
        queue: null,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await ContentBrief.countDocuments({ keywordId })).toBe(0);
  });

  it('surfaces persistence errors and collapses a duplicate-key race', async () => {
    await seed();
    const queue = { add: vi.fn() } as unknown as Queue;
    const createSpy = vi.spyOn(ContentBrief, 'create');
    createSpy.mockRejectedValueOnce(new Error('mongo unavailable') as never);
    await expect(
      createContentBrief(
        ACCOUNT,
        SITE,
        { keyword: 'evidence led seo', locale: 'en', clientKey: 'mongo-error' },
        { db: getTestDb() as never, queue },
      ),
    ).rejects.toThrow('mongo unavailable');

    const duplicate = await completeBrief((await getTestDb().select({ id: keywords.id }).from(keywords))[0]!.id);
    createSpy.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }) as never);
    const find = vi.spyOn(ContentBrief, 'findOne');
    find.mockResolvedValueOnce(null as never).mockResolvedValueOnce(duplicate as never);
    const result = await createContentBrief(
      ACCOUNT,
      SITE,
      { keyword: 'evidence led seo', locale: 'en', clientKey: 'racing' },
      { db: getTestDb() as never, queue },
    );
    expect(result).toEqual({ briefId: String(duplicate._id), status: 'completed', duplicate: true });

    createSpy.mockRejectedValueOnce(Object.assign(new Error('orphan duplicate'), { code: 11000 }) as never);
    find.mockResolvedValueOnce(null as never);
    await expect(
      createContentBrief(
        ACCOUNT,
        SITE,
        { keyword: 'evidence led seo', locale: 'en', clientKey: 'orphan-duplicate' },
        { db: getTestDb() as never, queue },
      ),
    ).rejects.toThrow('orphan duplicate');
  });

  it('uses random idempotency when no client key is supplied', async () => {
    const keywordId = await seed();
    const queue = { add: vi.fn().mockResolvedValue({ id: 'queued' }) } as unknown as Queue;
    const input = { keyword: 'evidence led seo', locale: 'en' as const };
    const created = await createContentBrief(ACCOUNT, SITE, input, {
      db: getTestDb() as never, queue, now: () => NOW,
    });
    const second = await createContentBrief(ACCOUNT, SITE, input, {
      db: getTestDb() as never, queue, now: () => NOW,
    });
    expect(created).toMatchObject({ status: 'queued', duplicate: false });
    expect(second.briefId).not.toBe(created.briefId);
    expect(await ContentBrief.findById(created.briefId)).toMatchObject({ keywordId });
  });

  it('validates cursors and serializes every nullable and hostile field safely', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const encoded = encodeContentBriefCursor({ createdAt: NOW.toISOString(), id });
    expect(decodeContentBriefCursor(encoded)).toEqual({ createdAt: NOW.toISOString(), id });
    for (const cursor of [
      'not-json',
      Buffer.from('null').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: 'bad', id })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: NOW.toISOString(), id: 'bad' })).toString('base64url'),
    ]) {
      expect(() => decodeContentBriefCursor(cursor)).toThrow();
    }

    const keywordId = await seed();
    const brief = await completeBrief(keywordId, {
      halt: { stage: 'scrape', reason: 'unsafe_url' },
      editorAiCostMicros: 130_000,
      draftVersions: [
        {
          version: 1,
          draft: '<script>literal</script>',
          comparison: {
            wordCount: 1,
            corpusMin: 0,
            corpusMax: 4,
            corpusAverage: 2,
            wordDeltaFromAverage: -1,
            headingCount: 0,
            corpusAverageHeadings: 0.5,
            matchedEntities: 0,
            totalEntities: 1,
            deterministicScore: 50,
          },
          aiScore: null,
          aiRationale: null,
          aiCitations: [],
          aiCostMicros: 0,
          aiDisclosure: 'cost_ceiling',
          createdAt: NOW,
        },
      ],
      draftVersionCount: 1,
    });
    const detail = serializeContentBriefDetail(brief);
    expect(detail).toMatchObject({
      halt: { stage: 'scrape', reason: 'unsafe_url' },
      serp: {
        paaRows: [
          { answerUrl: 'https://answer.example/source' },
          { answerUrl: null },
          { answerUrl: null },
          { answerUrl: null },
        ],
      },
      documents: [{ sourceUrl: 'https://result.example/guide' }, { sourceUrl: null }],
      corpusStats: { wordCount: { min: 0, max: 4, average: 2 } },
      questions: [{ citations: ['paa-1'] }],
      secondaryTerms: [{ term: 'proof driven seo' }],
      cost: { residueMicros: 0, stages: [{ stage: 'scrape' }] },
      scoreHistory: [{ draft: '<script>literal</script>', trust: 'untrusted' }],
    });
  });

  it('lists status-filtered pages, rejects bad cursors, and returns account-scoped 404s', async () => {
    const keywordId = await seed();
    const completed = await completeBrief(keywordId);
    await completeBrief(keywordId, { status: 'failed', corpusStats: null, terminalAt: null });
    const filtered = await listContentBriefs(ACCOUNT, SITE, { status: 'completed', limit: 50 });
    expect(filtered).toMatchObject({ creationEnabled: true, nextCursor: null });
    expect(filtered.items.map((item) => item.id)).toEqual([String(completed._id)]);
    await expect(
      listContentBriefs(ACCOUNT, SITE, { status: 'all', limit: 10, cursor: 'bad' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(getContentBrief(ACCOUNT, 'bad', 'bad')).rejects.toMatchObject({ status: 404 });
    await expect(
      getContentBrief(ACCOUNT, SITE, new mongoose.Types.ObjectId().toString()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('stores deterministic-only versions for absent AI and empty corpus', async () => {
    const keywordId = await seed();
    const brief = await completeBrief(keywordId, {
      documents: [],
      corpusStats: null,
      paaRows: [],
      secondaryTerms: [],
    });
    const result = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(brief._id),
      { draft: '# Draft', locale: 'en' },
      { ai: null, aiProviderOrder: [], now: () => NOW },
    );
    expect(result.scoreHistory[0]).toMatchObject({
      version: 1,
      aiScore: null,
      aiDisclosure: 'provider_error',
      comparison: { corpusMin: null, corpusMax: null, corpusAverage: null },
    });

    const nullable = await completeBrief(keywordId, {
      serpCheckedAt: null,
      corpusStats: {
        wordCount: { min: null, max: null, average: null, documentCount: 1 },
        headingHistogram: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        entities: [],
        scrapeDates: [NOW],
      },
    });
    const nullableResult = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(nullable._id),
      { draft: '# Draft', locale: 'en' },
      { ai: null, aiProviderOrder: [] },
    );
    expect(nullableResult).toMatchObject({
      serp: { checkedAt: null },
      corpusStats: { wordCount: { min: null, max: null, average: null } },
      scoreHistory: [
        { comparison: { corpusMin: null, corpusMax: null, corpusAverage: null } },
      ],
    });
  });

  it('rejects invalid, unready, and saturated editor targets', async () => {
    const keywordId = await seed();
    await expect(
      rescoreContentBriefDraft(ACCOUNT, SITE, 'bad', { draft: 'x', locale: 'en' }, {
        ai: null,
        aiProviderOrder: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      rescoreContentBriefDraft(
        ACCOUNT,
        SITE,
        new mongoose.Types.ObjectId().toHexString(),
        { draft: 'x', locale: 'en' },
        { ai: null, aiProviderOrder: [] },
      ),
    ).rejects.toMatchObject({ status: 404 });
    const queued = await completeBrief(keywordId, { status: 'queued' });
    await expect(
      rescoreContentBriefDraft(ACCOUNT, SITE, String(queued._id), { draft: 'x', locale: 'en' }, {
        ai: null,
        aiProviderOrder: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
    const full = await completeBrief(keywordId, { draftVersionCount: CONTENT_BRIEF_MAX_DRAFT_VERSIONS });
    await expect(
      rescoreContentBriefDraft(ACCOUNT, SITE, String(full._id), { draft: 'x', locale: 'en' }, {
        ai: null,
        aiProviderOrder: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('accounts captured, malformed, and thrown editor AI outcomes under residue', async () => {
    const keywordId = await seed();
    const captured = await completeBrief(keywordId);
    const scored = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(captured._id),
      { draft: '# Evidence\nArticle proof', locale: 'en' },
      { ai: scoredAi({ captured: true }), aiProviderOrder: ['fake'], now: () => NOW },
    );
    expect(scored.scoreHistory[0]).toMatchObject({
      aiScore: 71,
      aiCitations: ['doc-1'],
      aiCostMicros: 4_000,
      aiDisclosure: 'scored',
    });
    expect(scored.cost).toMatchObject({ editorAiMicros: 4_000, residueMicros: 115_000 });
    expect(scored.cost.stages.at(-1)).toMatchObject({ stage: 'editor_ai', source: 'captured' });

    const malformed = await completeBrief(keywordId);
    const rejected = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(malformed._id),
      { draft: 'Draft', locale: 'en' },
      { ai: scoredAi({ malformed: true }), aiProviderOrder: ['fake'] },
    );
    expect(rejected.scoreHistory[0]).toMatchObject({
      aiScore: null,
      aiRationale: null,
      aiDisclosure: 'malformed_output',
      aiCostMicros: 5_000,
    });

    const thrown = await completeBrief(keywordId);
    const fallback = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(thrown._id),
      { draft: 'Draft', locale: 'en' },
      { ai: scoredAi({ throws: true }), aiProviderOrder: ['fake'] },
    );
    expect(fallback.scoreHistory[0]).toMatchObject({
      aiScore: null,
      aiDisclosure: 'provider_error',
      aiCostMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS,
    });
    expect(fallback.cost.residueMicros).toBe(69_000);

    const outOfRange = await completeBrief(keywordId);
    const bounded = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(outOfRange._id),
      { draft: 'Draft', locale: 'en' },
      {
        ai: scoredAi({ estimatedMicros: BigInt(CONTENT_BRIEF_AI_MAX_COST_MICROS + 1) }),
        aiProviderOrder: ['fake'],
      },
    );
    expect(bounded.scoreHistory[0]).toMatchObject({
      aiScore: null,
      aiDisclosure: 'provider_error',
      aiCostMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS,
    });
    expect(bounded.cost.residueMicros).toBe(69_000);
  });

  it('falls back deterministically when a concurrent editor call owns the AI residue', async () => {
    const keywordId = await seed();
    const brief = await completeBrief(keywordId);
    const runner = scoredAi();
    const run = vi.spyOn(runner, 'run');
    vi.spyOn(ContentBrief, 'findOneAndUpdate').mockResolvedValueOnce(null as never);
    const result = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(brief._id),
      { draft: '# Concurrent draft', locale: 'en' },
      { ai: runner, aiProviderOrder: ['fake'] },
    );
    expect(run).not.toHaveBeenCalled();
    expect(result.scoreHistory[0]).toMatchObject({
      aiScore: null,
      aiDisclosure: 'cost_ceiling',
      aiCostMicros: 0,
    });
  });

  it('retries optimistic draft appends and reports disappearance or repeated conflict', async () => {
    const keywordId = await seed();
    const retried = await completeBrief(keywordId);
    vi.spyOn(ContentBrief, 'findOneAndUpdate').mockResolvedValueOnce(null as never);
    const result = await rescoreContentBriefDraft(
      ACCOUNT,
      SITE,
      String(retried._id),
      { draft: 'Retry once', locale: 'en' },
      { ai: null, aiProviderOrder: [] },
    );
    expect(result.scoreHistory).toMatchObject([{ version: 1, draft: 'Retry once' }]);

    vi.restoreAllMocks();
    const disappeared = await completeBrief(keywordId);
    vi.spyOn(ContentBrief, 'findOneAndUpdate').mockImplementationOnce(
      (async () => {
        await ContentBrief.deleteOne({ _id: disappeared._id });
        return null as never;
      }) as never,
    );
    await expect(
      rescoreContentBriefDraft(
        ACCOUNT,
        SITE,
        String(disappeared._id),
        { draft: 'Gone', locale: 'en' },
        { ai: null, aiProviderOrder: [] },
      ),
    ).rejects.toMatchObject({ status: 404 });

    vi.restoreAllMocks();
    const conflicted = await completeBrief(keywordId);
    vi.spyOn(ContentBrief, 'findOneAndUpdate').mockResolvedValue(null as never);
    await expect(
      rescoreContentBriefDraft(
        ACCOUNT,
        SITE,
        String(conflicted._id),
        { draft: 'Conflict', locale: 'en' },
        { ai: null, aiProviderOrder: [] },
      ),
    ).rejects.toMatchObject({ status: 409, message: CONTENT_BRIEF_CONFLICT_KEY });
  });

  it('settles held AI cost when a concurrent append reaches the version limit', async () => {
    const keywordId = await seed();
    const aiBrief = await completeBrief(keywordId);
    const original = ContentBrief.findOneAndUpdate.bind(ContentBrief);
    const update = vi.spyOn(ContentBrief, 'findOneAndUpdate');
    update.mockImplementationOnce((...args) => original(...args) as never);
    update.mockImplementationOnce(
      (async () => {
        await ContentBrief.updateOne(
          { _id: aiBrief._id },
          { $set: { draftVersionCount: CONTENT_BRIEF_MAX_DRAFT_VERSIONS } },
        );
        return null as never;
      }) as never,
    );
    await expect(
      rescoreContentBriefDraft(
        ACCOUNT,
        SITE,
        String(aiBrief._id),
        { draft: 'Losing concurrent draft', locale: 'en' },
        { ai: scoredAi(), aiProviderOrder: ['fake'] },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await ContentBrief.findById(aiBrief._id)).toMatchObject({
      draftVersionCount: CONTENT_BRIEF_MAX_DRAFT_VERSIONS,
      editorAiReservedMicros: 0,
      editorAiCostMicros: 5_000,
      costEntries: [
        { stage: 'scrape', costMicros: 1_000 },
        { stage: 'editor_ai', costMicros: 5_000, source: 'estimated' },
      ],
    });

    vi.restoreAllMocks();
    const deterministic = await completeBrief(keywordId);
    vi.spyOn(ContentBrief, 'findOneAndUpdate').mockImplementationOnce(
      (async () => {
        await ContentBrief.updateOne(
          { _id: deterministic._id },
          { $set: { draftVersionCount: CONTENT_BRIEF_MAX_DRAFT_VERSIONS } },
        );
        return null as never;
      }) as never,
    );
    await expect(
      rescoreContentBriefDraft(
        ACCOUNT,
        SITE,
        String(deterministic._id),
        { draft: 'Deterministic losing draft', locale: 'en' },
        { ai: null, aiProviderOrder: [] },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await ContentBrief.findById(deterministic._id)).toMatchObject({
      editorAiReservedMicros: 0,
      editorAiCostMicros: 0,
    });
  });

  it('settles held AI cost after three consecutive append conflicts', async () => {
    const keywordId = await seed();
    const brief = await completeBrief(keywordId);
    const original = ContentBrief.findOneAndUpdate.bind(ContentBrief);
    const update = vi.spyOn(ContentBrief, 'findOneAndUpdate');
    update.mockImplementationOnce((...args) => original(...args) as never);
    update
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    await expect(
      rescoreContentBriefDraft(
        ACCOUNT,
        SITE,
        String(brief._id),
        { draft: 'Repeated conflict', locale: 'en' },
        { ai: scoredAi(), aiProviderOrder: ['fake'] },
      ),
    ).rejects.toMatchObject({ status: 409, message: CONTENT_BRIEF_CONFLICT_KEY });
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      draftVersionCount: 0,
      editorAiReservedMicros: 0,
      editorAiCostMicros: 5_000,
    });
  });

  it('reads the completed account-and-site SERP cluster and bounds secondary terms', async () => {
    await seed();
    const members = [
      { keywordId: 'keyword-id', phrase: 'evidence led seo' },
      ...Array.from({ length: 22 }, (_, index) => ({
        keywordId: `secondary-${index}`,
        phrase: index === 0 ? 'x'.repeat(250) : `secondary ${index}`,
      })),
    ];
    await SerpClusterRun.create({
      accountId: ACCOUNT,
      siteId: SITE,
      locale: 'en',
      status: 'completed',
      aiStatus: 'skipped',
      rulesVersion: 'test-rules',
      minSharedUrls: 3,
      topUrlWindow: 10,
      keywordCount: members.length,
      keywordIds: members.map((member) => member.keywordId),
      clusters: [
        {
          id: 'cluster-1',
          size: members.length,
          pivotKeywordId: 'keyword-id',
          sharedUrls: [],
          members: members.map((member, index) => ({
            ...member,
            observedAt: NOW,
            isPivot: index === 0,
            sharedUrls: [],
            sharedUrlCount: 0,
          })),
          label: null,
          labelSource: null,
        },
      ],
      reservation: { key: 'brief-cluster', reservedAt: NOW },
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
    });
    const terms = await readBriefSecondaryTerms(ACCOUNT, SITE, {
      id: 'keyword-id',
      phrase: 'evidence led seo',
      locationCode: 2840,
      languageCode: 'EN',
      device: 'desktop',
    });
    expect(terms).toHaveLength(20);
    expect(terms[0]).toEqual({ id: 'term-1', term: 'x'.repeat(200) });
    expect(terms.some((term) => term.term.toLowerCase() === 'evidence led seo')).toBe(false);
    expect(
      await readBriefSecondaryTerms('000000000000000000000899', SITE, {
        id: 'keyword-id',
        phrase: 'evidence led seo',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      }),
    ).toEqual([]);
    expect(
      await readBriefSecondaryTerms(
        ACCOUNT,
        '000000000000000000000898',
        {
          id: 'keyword-id',
          phrase: 'evidence led seo',
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop',
        },
      ),
    ).toEqual([]);
  });
});
