import { readFileSync } from 'node:fs';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { keywords } from '../../db/schema/keywords.js';
import { createAiProfileRunner, type AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { createFakeContentSourceProvider } from '../../shared/providers/content-source-fake.js';
import type { ContentSourceProvider, ScrapePageInput } from '../../shared/providers/content-source.js';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
import { ProviderError } from '../../shared/providers/errors.js';
import { createFakeRankProvider } from '../../shared/providers/fakes.js';
import type { RankProvider } from '../../shared/providers/types.js';
import type { ContentBriefJob } from '../../shared/queue/index.js';
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
import { recordObservation } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import { ContentBrief } from './content-brief.model.js';
import { CONTENT_BRIEF_AI_MAX_COST_MICROS } from './content-brief.service.js';
import {
  canAffordContentBriefStage,
  createContentBriefProcessor,
  onContentBriefJobExhausted,
  runContentBriefPipeline,
  toSafeContentBriefMicros,
  type ContentBriefProcessorDeps,
} from './content-brief.processor.js';

const ACCOUNT = '000000000000000000000801';
const SITE = '000000000000000000000802';
const NOW = new Date('2026-08-01T12:00:00.000Z');
const logger = pino({ level: 'silent' });
let sequence = 0;

const ai = createAiProfileRunner({ provider: createFakeAiGenerationProvider() });

function defaultRank(result: Partial<Awaited<ReturnType<RankProvider['checkRank']>>> = {}): RankProvider {
  return createFakeRankProvider({
    result: {
      position: 5,
      checkedAt: NOW,
      serpTopUrls: ['https://one.example.test/a'],
      serpFeatures: {
        features: [], featuredSnippet: null,
        paa: [{ question: 'What is stored evidence?', answerDomain: null, answerUrl: null }],
      },
      ...result,
    },
  });
}

function defaultSource(): ContentSourceProvider {
  return createFakeContentSourceProvider({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    costMicrosPerCredit: 1_000n,
  });
}

function deps(overrides: Partial<ContentBriefProcessorDeps> = {}): ContentBriefProcessorDeps {
  return {
    db: getTestDb() as never,
    rank: defaultRank(),
    contentSource: defaultSource(),
    ai,
    aiProviderOrder: ['fake'],
    logger,
    now: () => NOW,
    assertSafe: async (url) => new URL(url),
    ...overrides,
  };
}

async function seedContext(): Promise<{ keywordId: string }> {
  await Site.create({ _id: SITE, accountId: ACCOUNT, url: 'https://owned.example', domain: 'owned.example' });
  const [keyword] = await getTestDb().insert(keywords).values({
    accountId: ACCOUNT,
    siteId: SITE,
    phrase: 'evidence led seo',
    locationCode: 2840,
    languageCode: 'en',
    device: 'desktop',
    engine: 'google',
  }).returning({ id: keywords.id });
  return { keywordId: keyword!.id };
}

async function storedSerp(
  keywordId: string,
  urls = ['https://one.example.test/a'],
  paaCount = 12,
): Promise<void> {
  await recordObservation(getTestDb() as never, {
    accountId: ACCOUNT,
    siteId: SITE,
    keywordId,
    checkedAt: new Date('2026-07-31T12:00:00.000Z'),
    source: 'fresh',
    features: {
      features: [],
      featuredSnippet: null,
      paa: Array.from({ length: paaCount }, (_, index) => ({
        question: `Stored question ${index + 1}?`, answerDomain: null, answerUrl: null,
      })),
    },
    topResults: urls.map((url, index) => ({
      domain: new URL(url).hostname, url, rankGroup: index + 1, rankAbsolute: index + 1,
    })),
  }, NOW);
}

async function queuedBrief(
  keywordId: string,
  overrides: Record<string, unknown> = {},
): Promise<InstanceType<typeof ContentBrief>> {
  sequence += 1;
  return ContentBrief.create({
    accountId: ACCOUNT,
    siteId: SITE,
    keywordId,
    keyword: 'evidence led seo',
    locale: 'en',
    reservationKey: `processor-${sequence}`,
    runCeilingMicros: 120_000,
    ...overrides,
  });
}

function payload(briefId: string): ContentBriefJob {
  return { accountId: ACCOUNT, siteId: SITE, briefId };
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
});

describe('content-brief processor', () => {
  it('references scrapePage as the only content-source provider operation', () => {
    const source = readFileSync(new URL('./content-brief.processor.ts', import.meta.url), 'utf8');
    const operations = [...source.matchAll(/deps\.contentSource\.(\w+)/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(operations)]).toEqual(['scrapePage']);
    expect(source).not.toMatch(
      /deps\.contentSource\.(?:crawlSite|search|extract|agent|screenshot|authenticatedScrape)/u,
    );
  });

  it('rejects negative and unsafe-integer provider costs', () => {
    expect(toSafeContentBriefMicros(0n)).toBe(0);
    expect(toSafeContentBriefMicros(1_000)).toBe(1_000);
    expect(() => toSafeContentBriefMicros(-1n)).toThrow('safe integer range');
    expect(() => toSafeContentBriefMicros(-1)).toThrow('safe integer range');
    expect(() => toSafeContentBriefMicros(1.5)).toThrow('safe integer range');
    expect(() =>
      toSafeContentBriefMicros(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ).toThrow('safe integer range');
    expect(() => toSafeContentBriefMicros(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      'safe integer range',
    );
    expect(canAffordContentBriefStage(Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER))
      .toBe(false);
    expect(canAffordContentBriefStage(-1, 1, 1)).toBe(false);
  });

  it('completes from a fresh stored SERP, clamps PAA, scrapes each top URL, and cites stored rows', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId, ['https://one.example.test/a', 'https://two.example.test/b']);
    const brief = await queuedBrief(keywordId);
    const rank = defaultRank();
    const rankSpy = vi.spyOn(rank, 'checkRank');
    await runContentBriefPipeline(payload(String(brief._id)), deps({ rank }));

    const stored = await ContentBrief.findById(brief._id);
    expect(stored).toMatchObject({
      status: 'completed', serpSource: 'stored', fetchedInsideUnit: false,
      scrapeAttempts: 2, successfulScrapeAttempts: 2, totalCostMicros: 2_000,
    });
    expect(stored?.paaRows).toHaveLength(10);
    expect(stored?.documents).toHaveLength(2);
    expect(stored?.corpusStats?.wordCount.documentCount).toBe(2);
    expect(stored?.outline.every((node) => node.citations[0]?.startsWith('doc-'))).toBe(true);
    expect(stored?.questions.every((row) => row.citations[0]?.startsWith('paa-'))).toBe(true);
    expect(rankSpy).not.toHaveBeenCalled();

    await runContentBriefPipeline(payload(String(brief._id)), deps({ rank }));
    expect(rankSpy).not.toHaveBeenCalled();
  });

  it('fetches one stale/missing SERP inside the unit and records captured cost', async () => {
    const { keywordId } = await seedContext();
    const rank = defaultRank({
      serpTopUrls: ['https://one.example.test/a'],
      serpFeatures: {
        features: [], featuredSnippet: null,
        paa: Array.from({ length: 12 }, (_, index) => ({
          question: `Fetched ${index}?`, answerDomain: null, answerUrl: null,
        })),
      },
    });
    const baseCheck = rank.checkRank.bind(rank);
    const spy = vi.spyOn(rank, 'checkRank').mockImplementation(async (input) => {
      recordVendorCostUsd(0.008);
      return baseCheck(input);
    });
    const brief = await queuedBrief(keywordId);
    await runContentBriefPipeline(payload(String(brief._id)), deps({ rank }));
    const stored = await ContentBrief.findById(brief._id);
    expect(stored).toMatchObject({
      status: 'completed', serpSource: 'fetched', fetchedInsideUnit: true,
      totalCostMicros: 9_000,
    });
    expect(stored?.paaRows).toHaveLength(10);
    expect(stored?.costEntries[0]).toMatchObject({
      stage: 'serp_fetch', costMicros: 8_000, source: 'captured',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('atomically admits only one duplicate delivery into paid provider work', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId);
    const rank = defaultRank();
    const baseRank = rank.checkRank.bind(rank);
    let releaseRank!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseRank = resolve; });
    const rankSpy = vi.spyOn(rank, 'checkRank').mockImplementation(async (input) => {
      signalEntered();
      await gate;
      return baseRank(input);
    });
    const source = defaultSource();
    const scrapeSpy = vi.spyOn(source, 'scrapePage');
    const aiSpy = vi.spyOn(ai, 'run');
    const first = runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ rank, contentSource: source }),
    );
    await entered;

    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ rank, contentSource: source }),
    );
    releaseRank();
    await first;

    expect(rankSpy).toHaveBeenCalledOnce();
    expect(scrapeSpy).toHaveBeenCalledOnce();
    expect(aiSpy).toHaveBeenCalledOnce();
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'completed',
      processorAttempt: 0,
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
    });
  });

  it('lets a newer retry fence a stale in-flight delivery without a second dispatch', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId);
    const rank = defaultRank();
    const baseRank = rank.checkRank.bind(rank);
    let releaseRank!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseRank = resolve; });
    const rankSpy = vi.spyOn(rank, 'checkRank').mockImplementation(async (input) => {
      signalEntered();
      await gate;
      return baseRank(input);
    });
    const source = defaultSource();
    const scrapeSpy = vi.spyOn(source, 'scrapePage');
    const first = runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ rank, contentSource: source, deliveryAttempt: 0 }),
    );
    await entered;

    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ rank, contentSource: source, deliveryAttempt: 1 }),
    );
    releaseRank();
    await first;

    expect(rankSpy).toHaveBeenCalledOnce();
    expect(scrapeSpy).not.toHaveBeenCalled();
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'failed',
      processorAttempt: 1,
      totalCostMicros: 10_000,
      halt: { stage: 'serp_fetch', reason: 'processing_failure' },
      costEntries: [
        { stage: 'serp_fetch', costMicros: 10_000, source: 'estimated' },
      ],
    });
  });

  it('reclaims only a newer delivery attempt and skips an indeterminate scrape target', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId, {
      status: 'running',
      processorAttempt: 0,
      processorStartedAt: NOW,
      serpSource: 'stored',
      serpTopUrls: [
        'https://uncertain.example.test/a',
        'https://remaining.example.test/b',
      ],
      // Target zero was claimed before a simulated worker crash. Its result
      // is unknowable, so recovery must never dispatch it again.
      scrapeAttempts: 1,
    });
    const source = defaultSource();
    const scrapeSpy = vi.spyOn(source, 'scrapePage');

    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ contentSource: source, deliveryAttempt: 1 }),
    );

    expect(scrapeSpy).toHaveBeenCalledOnce();
    expect(scrapeSpy.mock.calls[0]?.[0].url).toBe('https://remaining.example.test/b');
    const recovered = await ContentBrief.findById(brief._id);
    expect(recovered).toMatchObject({
      status: 'completed_partial',
      processorAttempt: 1,
      scrapeAttempts: 2,
      successfulScrapeAttempts: 1,
      indeterminateScrapeAttempts: 1,
      halt: { stage: 'scrape', reason: 'processing_failure' },
    });
    expect(recovered?.costEntries[0]).toMatchObject({
      stage: 'scrape',
      costMicros: 30_000,
      source: 'estimated',
    });
  });

  it('rejects invalid delivery-attempt counters before claiming work', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId);
    await expect(
      runContentBriefPipeline(
        payload(String(brief._id)),
        deps({ deliveryAttempt: -1 }),
      ),
    ).rejects.toThrow('delivery attempt');
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'queued',
      processorAttempt: -1,
    });
  });

  it('stops without provider work when ownership is lost at each paid-stage claim', async () => {
    const firstContext = await seedContext();
    const serp = await queuedBrief(firstContext.keywordId);
    const rank = defaultRank();
    const rankSpy = vi.spyOn(rank, 'checkRank');
    vi.spyOn(ContentBrief, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 } as never);
    await runContentBriefPipeline(payload(String(serp._id)), deps({ rank }));
    expect(rankSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const unsafeContext = await seedContext();
    await storedSerp(unsafeContext.keywordId, ['http://127.0.0.1/private']);
    const unsafe = await queuedBrief(unsafeContext.keywordId);
    const unsafeSource = defaultSource();
    const unsafeSpy = vi.spyOn(unsafeSource, 'scrapePage');
    vi.spyOn(ContentBrief, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 } as never);
    await runContentBriefPipeline(
      payload(String(unsafe._id)),
      deps({
        contentSource: unsafeSource,
        assertSafe: async () => { throw new Error('unsafe'); },
      }),
    );
    expect(unsafeSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const safeContext = await seedContext();
    await storedSerp(safeContext.keywordId);
    const safe = await queuedBrief(safeContext.keywordId);
    const safeSource = defaultSource();
    const safeSpy = vi.spyOn(safeSource, 'scrapePage');
    vi.spyOn(ContentBrief, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 } as never);
    await runContentBriefPipeline(
      payload(String(safe._id)),
      deps({ contentSource: safeSource }),
    );
    expect(safeSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const aiContext = await seedContext();
    const aiBrief = await queuedBrief(aiContext.keywordId, {
      serpSource: 'stored',
      serpTopUrls: ['https://one.example.test/a'],
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Stored',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
    });
    const aiRunner: AiProfileRunner = {
      preflight() {},
      async run() { throw new Error('must not dispatch'); },
    };
    const aiSpy = vi.spyOn(aiRunner, 'run');
    vi.spyOn(ContentBrief, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 } as never);
    await runContentBriefPipeline(
      payload(String(aiBrief._id)),
      deps({ ai: aiRunner }),
    );
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it('fences stale success and failure outcomes at every provider boundary', async () => {
    const serpContext = await seedContext();
    const serpBrief = await queuedBrief(serpContext.keywordId);
    const rank = defaultRank();
    let rejectRank!: (error: Error) => void;
    let signalRank!: () => void;
    const rankEntered = new Promise<void>((resolve) => { signalRank = resolve; });
    const rankGate = new Promise<never>((_resolve, reject) => { rejectRank = reject; });
    vi.spyOn(rank, 'checkRank').mockImplementation(async () => {
      signalRank();
      return rankGate;
    });
    const staleRank = runContentBriefPipeline(
      payload(String(serpBrief._id)),
      deps({ rank, deliveryAttempt: 0 }),
    );
    await rankEntered;
    await runContentBriefPipeline(
      payload(String(serpBrief._id)),
      deps({ rank, deliveryAttempt: 1 }),
    );
    rejectRank(new Error('stale rank failure'));
    await staleRank;

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const scrapeSuccessContext = await seedContext();
    await storedSerp(scrapeSuccessContext.keywordId);
    const scrapeSuccessBrief = await queuedBrief(scrapeSuccessContext.keywordId);
    const successSource = defaultSource();
    const baseScrape = successSource.scrapePage.bind(successSource);
    let releaseScrape!: () => void;
    let signalScrape!: () => void;
    const scrapeEntered = new Promise<void>((resolve) => { signalScrape = resolve; });
    const scrapeGate = new Promise<void>((resolve) => { releaseScrape = resolve; });
    vi.spyOn(successSource, 'scrapePage').mockImplementation(async (input) => {
      signalScrape();
      await scrapeGate;
      return baseScrape(input);
    });
    const staleScrapeSuccess = runContentBriefPipeline(
      payload(String(scrapeSuccessBrief._id)),
      deps({ contentSource: successSource, deliveryAttempt: 0 }),
    );
    await scrapeEntered;
    await runContentBriefPipeline(
      payload(String(scrapeSuccessBrief._id)),
      deps({ contentSource: successSource, deliveryAttempt: 1 }),
    );
    releaseScrape();
    await staleScrapeSuccess;
    expect(await ContentBrief.findById(scrapeSuccessBrief._id)).toMatchObject({
      status: 'failed',
      indeterminateScrapeAttempts: 1,
      halt: { stage: 'scrape', reason: 'processing_failure' },
    });

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const scrapeFailureContext = await seedContext();
    await storedSerp(scrapeFailureContext.keywordId);
    const scrapeFailureBrief = await queuedBrief(scrapeFailureContext.keywordId);
    const failureSource = defaultSource();
    let rejectScrape!: (error: Error) => void;
    let signalFailedScrape!: () => void;
    const failedScrapeEntered = new Promise<void>((resolve) => {
      signalFailedScrape = resolve;
    });
    const failedScrapeGate = new Promise<never>((_resolve, reject) => {
      rejectScrape = reject;
    });
    vi.spyOn(failureSource, 'scrapePage').mockImplementation(async () => {
      signalFailedScrape();
      return failedScrapeGate;
    });
    const staleScrapeFailure = runContentBriefPipeline(
      payload(String(scrapeFailureBrief._id)),
      deps({ contentSource: failureSource, deliveryAttempt: 0 }),
    );
    await failedScrapeEntered;
    await runContentBriefPipeline(
      payload(String(scrapeFailureBrief._id)),
      deps({ contentSource: failureSource, deliveryAttempt: 1 }),
    );
    rejectScrape(new Error('stale scrape failure'));
    await staleScrapeFailure;

    const runAiFenceCase = async (rejectOutcome: boolean): Promise<void> => {
      vi.restoreAllMocks();
      await clearCollections();
      await truncateAllTables();
      const aiContext = await seedContext();
      const brief = await queuedBrief(aiContext.keywordId, {
        serpSource: 'stored',
        serpTopUrls: ['https://one.example.test/a'],
        scrapeAttempts: 1,
        successfulScrapeAttempts: 1,
        secondaryTerms: [{ id: 'term-1', term: 'existing' }],
        documents: [
          {
            id: 'doc-1',
            sourceUrl: 'https://one.example.test/a',
            title: 'Stored',
            excerpt: 'body',
            headings: [],
            capturedAt: NOW,
            wordCount: 1,
            entityLabels: [],
          },
        ],
      });
      const baseAi = ai.run.bind(ai);
      let settleAi!: () => void;
      let signalAi!: () => void;
      let rejectAi!: (error: Error) => void;
      const aiEntered = new Promise<void>((resolve) => { signalAi = resolve; });
      const aiGate = rejectOutcome
        ? new Promise<void>((_resolve, reject) => { rejectAi = reject; })
        : new Promise<void>((resolve) => { settleAi = resolve; });
      vi.spyOn(ai, 'run').mockImplementation(async (input) => {
        signalAi();
        await aiGate;
        return baseAi(input) as never;
      });
      const staleAi = runContentBriefPipeline(
        payload(String(brief._id)),
        deps({ deliveryAttempt: 0 }),
      );
      await aiEntered;
      await runContentBriefPipeline(
        payload(String(brief._id)),
        deps({ deliveryAttempt: 1 }),
      );
      if (rejectOutcome) rejectAi(new Error('stale AI failure'));
      else settleAi();
      await staleAi;
      expect(await ContentBrief.findById(brief._id)).toMatchObject({
        status: 'completed_partial',
        processorAttempt: 1,
        halt: { stage: 'brief_ai', reason: 'processing_failure' },
      });
    };
    await runAiFenceCase(false);
    await runAiFenceCase(true);
  });

  it('does not duplicate conservative ledger entries on repeated started-stage recovery', async () => {
    const serpContext = await seedContext();
    const serp = await queuedBrief(serpContext.keywordId, {
      status: 'running',
      serpFetchStartedAt: NOW,
      totalCostMicros: 10_000,
      costEntries: [
        { stage: 'serp_fetch', costMicros: 10_000, source: 'estimated' },
      ],
    });
    await runContentBriefPipeline(payload(String(serp._id)), deps());
    expect((await ContentBrief.findById(serp._id))?.costEntries).toHaveLength(1);

    await clearCollections();
    await truncateAllTables();
    const aiContext = await seedContext();
    const aiStarted = await queuedBrief(aiContext.keywordId, {
      status: 'running',
      serpSource: 'stored',
      serpTopUrls: ['https://one.example.test/a'],
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Stored',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
      briefAiStartedAt: NOW,
      totalCostMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS,
      costEntries: [
        {
          stage: 'brief_ai',
          costMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS,
          source: 'estimated',
        },
      ],
    });
    await runContentBriefPipeline(payload(String(aiStarted._id)), deps());
    expect((await ContentBrief.findById(aiStarted._id))?.costEntries).toHaveLength(1);
  });

  it('normalizes fetched URLs, bounds the corpus at ten, and accepts absent SERP fields', async () => {
    const { keywordId } = await seedContext();
    const urls = [
      '',
      'https://one.example.test/a',
      'https://one.example.test/a',
      ...Array.from({ length: 11 }, (_, index) => `https://result-${index}.example.test/a`),
    ];
    const brief = await queuedBrief(keywordId);
    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({
        rank: defaultRank({ serpTopUrls: urls, serpFeatures: undefined }),
        scrapeBudgetMicros: 10_000,
      }),
    );
    const stored = await ContentBrief.findById(brief._id);
    expect(stored).toMatchObject({
      status: 'completed',
      serpSource: 'fetched',
      scrapeAttempts: 10,
      successfulScrapeAttempts: 10,
    });
    expect(stored?.serpTopUrls).toHaveLength(10);
    expect(stored?.paaRows).toEqual([]);

    await clearCollections();
    await truncateAllTables();
    const emptyContext = await seedContext();
    const empty = await queuedBrief(emptyContext.keywordId);
    await runContentBriefPipeline(
      payload(String(empty._id)),
      deps({ rank: defaultRank({ serpTopUrls: undefined, serpFeatures: undefined }) }),
    );
    expect(await ContentBrief.findById(empty._id)).toMatchObject({
      status: 'completed_empty',
      serpTopUrls: [],
    });
  });

  it('uses the production SSRF checker when no test override is supplied', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId, ['https://93.184.216.34/guide']);
    const brief = await queuedBrief(keywordId);
    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ assertSafe: undefined }),
    );
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'completed',
      successfulScrapeAttempts: 1,
    });
  });

  it('completes a featureless fetched SERP without scraping', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId);
    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({ rank: defaultRank({ serpTopUrls: [], serpFeatures: null }) }),
    );
    const stored = await ContentBrief.findById(brief._id);
    expect(stored).toMatchObject({ status: 'completed_empty', serpSource: 'fetched' });
    expect(stored?.abstentions).toContain('contentBriefs.abstentions.noSerpResults');
  });

  it('covers equality and every rolling ceiling stage boundary', async () => {
    expect(canAffordContentBriefStage(10, 20, 30)).toBe(true);
    expect(canAffordContentBriefStage(11, 20, 30)).toBe(false);

    const one = await seedContext();
    const serpHalt = await queuedBrief(one.keywordId, { runCeilingMicros: 9_999 });
    const rank = defaultRank();
    const rankSpy = vi.spyOn(rank, 'checkRank');
    await runContentBriefPipeline(payload(String(serpHalt._id)), deps({ rank }));
    expect(await ContentBrief.findById(serpHalt._id)).toMatchObject({
      status: 'completed_partial', halt: { stage: 'serp_fetch', reason: 'cost_ceiling' },
    });
    expect(rankSpy).not.toHaveBeenCalled();

    await clearCollections();
    await truncateAllTables();
    const two = await seedContext();
    await storedSerp(two.keywordId);
    const scrapeHalt = await queuedBrief(two.keywordId, { runCeilingMicros: 59_999 });
    const source = defaultSource();
    const scrapeSpy = vi.spyOn(source, 'scrapePage');
    await runContentBriefPipeline(payload(String(scrapeHalt._id)), deps({ contentSource: source }));
    expect(await ContentBrief.findById(scrapeHalt._id)).toMatchObject({
      status: 'completed_partial', halt: { stage: 'scrape', reason: 'cost_ceiling' },
    });
    expect(scrapeSpy).not.toHaveBeenCalled();

    await clearCollections();
    await truncateAllTables();
    const three = await seedContext();
    await storedSerp(three.keywordId);
    const aiHalt = await queuedBrief(three.keywordId, { runCeilingMicros: 50_999 });
    const aiSpy: AiProfileRunner = {
      preflight() {}, async run() { throw new Error('must not run'); },
    };
    await runContentBriefPipeline(payload(String(aiHalt._id)), deps({
      ai: aiSpy, scrapeBudgetMicros: 1_000,
    }));
    expect(await ContentBrief.findById(aiHalt._id)).toMatchObject({
      status: 'completed_partial', halt: { stage: 'brief_ai', reason: 'cost_ceiling' },
    });

    await clearCollections();
    await truncateAllTables();
    const four = await seedContext();
    await storedSerp(four.keywordId, ['https://one.example.test/a'], 0);
    const aiHaltWithoutPaa = await queuedBrief(four.keywordId, {
      runCeilingMicros: 50_999,
    });
    await runContentBriefPipeline(
      payload(String(aiHaltWithoutPaa._id)),
      deps({ scrapeBudgetMicros: 1_000 }),
    );
    expect(await ContentBrief.findById(aiHaltWithoutPaa._id)).toMatchObject({
      status: 'completed_partial',
      halt: { stage: 'brief_ai', reason: 'cost_ceiling' },
      paaRows: [],
    });
  });

  it('halts between individual scrapes while keeping the first stored document', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId, ['https://one.example.test/a', 'https://two.example.test/b']);
    const brief = await queuedBrief(keywordId, { runCeilingMicros: 30_999 });
    const source = defaultSource();
    const spy = vi.spyOn(source, 'scrapePage');
    await runContentBriefPipeline(payload(String(brief._id)), deps({ contentSource: source }));
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'completed_partial', scrapeAttempts: 1,
      halt: { stage: 'scrape', reason: 'cost_ceiling' },
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fails a SERP provider failure with zero documents and ignores a replay', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId);
    const rank = defaultRank();
    vi.spyOn(rank, 'checkRank').mockRejectedValue(new ProviderError('down', true, {
      provider: 'fake', operation: 'rank',
    }));
    await runContentBriefPipeline(payload(String(brief._id)), deps({ rank }));
    await runContentBriefPipeline(payload(String(brief._id)), deps({ rank }));
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'failed',
      halt: { stage: 'serp_fetch', reason: 'provider_error' },
    });
  });

  it('fails an all-scrape provider failure but completes a successful empty scrape', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId);
    const failed = await queuedBrief(keywordId);
    const broken = defaultSource();
    vi.spyOn(broken, 'scrapePage').mockRejectedValue(new ProviderError('down', false, {
      provider: 'fake', operation: 'scrape',
    }));
    await runContentBriefPipeline(payload(String(failed._id)), deps({ contentSource: broken }));
    expect(await ContentBrief.findById(failed._id)).toMatchObject({
      status: 'failed', providerFailureCount: 1,
    });

    await clearCollections();
    await truncateAllTables();
    const next = await seedContext();
    await storedSerp(next.keywordId);
    const empty = await queuedBrief(next.keywordId);
    const emptySource = defaultSource();
    const base = emptySource.scrapePage.bind(emptySource);
    vi.spyOn(emptySource, 'scrapePage').mockImplementation(async (input: ScrapePageInput) => {
      const result = await base(input);
      return {
        ...result,
        document: {
          ...result.document, title: null, text: '', markdown: '', headings: [], structuredData: [],
        },
      };
    });
    await runContentBriefPipeline(payload(String(empty._id)), deps({ contentSource: emptySource }));
    expect(await ContentBrief.findById(empty._id)).toMatchObject({
      status: 'completed_empty', successfulScrapeAttempts: 1,
    });

    await clearCollections();
    await truncateAllTables();
    const mixedContext = await seedContext();
    await storedSerp(mixedContext.keywordId, [
      'https://one.example.test/a',
      'https://two.example.test/b',
    ]);
    const mixed = await queuedBrief(mixedContext.keywordId);
    const mixedSource = defaultSource();
    const scrape = mixedSource.scrapePage.bind(mixedSource);
    let calls = 0;
    vi.spyOn(mixedSource, 'scrapePage').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 2) throw new Error('second failed');
      const result = await scrape(input);
      return {
        ...result,
        document: {
          ...result.document,
          title: null,
          text: '',
          markdown: '',
          headings: [],
          structuredData: [],
        },
      };
    });
    await runContentBriefPipeline(
      payload(String(mixed._id)),
      deps({ contentSource: mixedSource }),
    );
    expect(await ContentBrief.findById(mixed._id)).toMatchObject({
      status: 'completed_empty',
      successfulScrapeAttempts: 1,
      providerFailureCount: 1,
      halt: { stage: 'scrape', reason: 'provider_error' },
    });
  });

  it('keeps a partial corpus when a later scrape fails', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId, ['https://one.example.test/a', 'https://two.example.test/b']);
    const brief = await queuedBrief(keywordId);
    const source = defaultSource();
    const base = source.scrapePage.bind(source);
    let calls = 0;
    vi.spyOn(source, 'scrapePage').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 2) throw new Error('second failed');
      return base(input);
    });
    await runContentBriefPipeline(payload(String(brief._id)), deps({ contentSource: source }));
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'completed_partial', providerFailureCount: 1,
      halt: { stage: 'scrape', reason: 'provider_error' },
    });
  });

  it('rejects hostile stored URLs before provider dispatch and consumes the observation', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId, ['http://127.0.0.1/private']);
    const brief = await queuedBrief(keywordId);
    const source = defaultSource();
    const scrape = vi.spyOn(source, 'scrapePage');
    await runContentBriefPipeline(payload(String(brief._id)), deps({
      contentSource: source,
      assertSafe: async () => { throw new Error('private address'); },
    }));
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'completed_empty', unsafeUrlCount: 1,
      halt: { stage: 'scrape', reason: 'unsafe_url' },
    });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('retains a safe document when a later stored target is unsafe', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId, [
      'https://one.example.test/a',
      'http://127.0.0.1/private',
    ]);
    const brief = await queuedBrief(keywordId);
    await runContentBriefPipeline(
      payload(String(brief._id)),
      deps({
        assertSafe: async (url) => {
          if (url.includes('127.0.0.1')) throw new Error('private address');
          return new URL(url);
        },
      }),
    );
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'completed_partial',
      successfulScrapeAttempts: 1,
      unsafeUrlCount: 1,
      halt: { stage: 'scrape', reason: 'unsafe_url' },
    });
  });

  it('persists AI provider and malformed-evidence partial states over readable stats', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId);
    const failedAi = await queuedBrief(keywordId);
    const throwingAi: AiProfileRunner = {
      preflight() {}, async run() { throw new Error('ai unavailable'); },
    };
    await runContentBriefPipeline(payload(String(failedAi._id)), deps({ ai: throwingAi }));
    expect(await ContentBrief.findById(failedAi._id)).toMatchObject({
      status: 'completed_partial', briefAiCompleted: true,
      halt: { stage: 'brief_ai', reason: 'provider_error' },
    });

    await clearCollections();
    await truncateAllTables();
    const next = await seedContext();
    await storedSerp(next.keywordId);
    const malformed = await queuedBrief(next.keywordId);
    const hostileAi: AiProfileRunner = {
      preflight() {},
      async run() {
        return {
          object: {
            outline: [{ id: 'x', heading: 'Invented', purpose: 'No', citations: ['foreign'] }],
            questions: [], score: null, rationale: null, citations: [],
          },
          status: 'partial',
          provenance: { actualOrEstimatedCostMicros: 1_000n },
        } as never;
      },
    };
    await runContentBriefPipeline(payload(String(malformed._id)), deps({ ai: hostileAi }));
    expect(await ContentBrief.findById(malformed._id)).toMatchObject({
      status: 'completed_partial',
      halt: { stage: 'brief_ai', reason: 'malformed_output' },
    });

    await clearCollections();
    await truncateAllTables();
    const withoutPaa = await seedContext();
    await storedSerp(withoutPaa.keywordId, ['https://one.example.test/a'], 0);
    const noQuestionFailure = await queuedBrief(withoutPaa.keywordId);
    await runContentBriefPipeline(
      payload(String(noQuestionFailure._id)),
      deps({ ai: throwingAi }),
    );
    expect(await ContentBrief.findById(noQuestionFailure._id)).toMatchObject({
      status: 'completed_partial',
      paaRows: [],
      halt: { stage: 'brief_ai', reason: 'provider_error' },
    });
  });

  it('turns indeterminate started stages into consumed processing halts on replay', async () => {
    const { keywordId } = await seedContext();
    const serp = await queuedBrief(keywordId, { status: 'running', serpFetchStartedAt: NOW });
    await runContentBriefPipeline(payload(String(serp._id)), deps());
    expect(await ContentBrief.findById(serp._id)).toMatchObject({
      status: 'failed', halt: { stage: 'serp_fetch', reason: 'processing_failure' },
      totalCostMicros: 10_000,
      costEntries: [
        { stage: 'serp_fetch', costMicros: 10_000, source: 'estimated' },
      ],
    });

    await clearCollections();
    await truncateAllTables();
    const next = await seedContext();
    await storedSerp(next.keywordId);
    const aiStarted = await queuedBrief(next.keywordId, {
      status: 'running',
      serpSource: 'stored',
      serpTopUrls: ['https://one.example.test/a'],
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
      documents: [{
        id: 'doc-1', sourceUrl: 'https://one.example.test/a', title: 'Stored', excerpt: 'body',
        headings: [], capturedAt: NOW, wordCount: 1, entityLabels: [],
      }],
      corpusStats: {
        wordCount: { min: 1, max: 1, average: 1, documentCount: 1 },
        headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        entities: [], scrapeDates: [NOW],
      },
      paaRows: [
        {
          id: 'paa-1',
          question: 'What is replay safety?',
          answerDomain: null,
          answerUrl: null,
        },
      ],
      briefAiStartedAt: NOW,
    });
    await runContentBriefPipeline(payload(String(aiStarted._id)), deps());
    expect(await ContentBrief.findById(aiStarted._id)).toMatchObject({
      status: 'completed_partial', halt: { stage: 'brief_ai', reason: 'processing_failure' },
      totalCostMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS,
      costEntries: [
        {
          stage: 'brief_ai',
          costMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS,
          source: 'estimated',
        },
      ],
    });

    await clearCollections();
    await truncateAllTables();
    const noPaaContext = await seedContext();
    const noPaaStarted = await queuedBrief(noPaaContext.keywordId, {
      status: 'running',
      serpSource: 'stored',
      serpTopUrls: ['https://one.example.test/a'],
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Stored',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
      briefAiStartedAt: NOW,
      paaRows: [],
    });
    await runContentBriefPipeline(payload(String(noPaaStarted._id)), deps());
    expect(await ContentBrief.findById(noPaaStarted._id)).toMatchObject({
      status: 'completed_partial',
      paaRows: [],
      halt: { stage: 'brief_ai', reason: 'processing_failure' },
    });
  });

  it('loads cluster terms once and no-ops an already completed AI stage', async () => {
    const { keywordId } = await seedContext();
    await storedSerp(keywordId);
    await SerpClusterRun.create({
      accountId: ACCOUNT,
      siteId: SITE,
      locale: 'en',
      status: 'completed',
      aiStatus: 'skipped',
      rulesVersion: 'test-rules',
      minSharedUrls: 3,
      topUrlWindow: 10,
      keywordCount: 2,
      keywordIds: [keywordId, 'secondary-keyword-id'],
      clusters: [
        {
          id: 'cluster-1',
          size: 2,
          pivotKeywordId: keywordId,
          sharedUrls: [],
          members: [
            {
              keywordId,
              phrase: 'evidence led seo',
              observedAt: NOW,
              isPivot: true,
              sharedUrls: [],
              sharedUrlCount: 0,
            },
            {
              keywordId: 'secondary-keyword-id',
              phrase: 'proof driven seo',
              observedAt: NOW,
              isPivot: false,
              sharedUrls: [],
              sharedUrlCount: 0,
            },
          ],
          label: null,
          labelSource: null,
        },
      ],
      reservation: { key: 'brief-processor-cluster', reservedAt: NOW },
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
    });
    const brief = await queuedBrief(keywordId);
    await runContentBriefPipeline(payload(String(brief._id)), deps());
    expect((await ContentBrief.findById(brief._id))?.secondaryTerms).toMatchObject([
      { id: 'term-1', term: 'proof driven seo' },
    ]);

    await clearCollections();
    await truncateAllTables();
    const replayContext = await seedContext();
    const replay = await queuedBrief(replayContext.keywordId, {
      status: 'running',
      processorStartedAt: NOW,
      serpSource: 'stored',
      serpTopUrls: ['https://one.example.test/a'],
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
      secondaryTerms: [{ id: 'term-existing', term: 'retained term' }],
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Stored',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
      corpusStats: {
        wordCount: { min: 1, max: 1, average: 1, documentCount: 1 },
        headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        entities: [],
        scrapeDates: [NOW],
      },
      briefAiStartedAt: NOW,
      briefAiCompleted: true,
    });
    await runContentBriefPipeline(
      payload(String(replay._id)),
      deps({ now: undefined }),
    );
    expect(await ContentBrief.findById(replay._id)).toMatchObject({
      status: 'running',
      secondaryTerms: [{ id: 'term-existing', term: 'retained term' }],
      briefAiCompleted: true,
    });
  });

  it('persists and rethrows unexpected failures', async () => {
    const { keywordId } = await seedContext();
    const empty = await queuedBrief(keywordId);
    vi.spyOn(ContentBrief.prototype, 'save').mockRejectedValueOnce(new Error('mongo write failed'));
    await expect(
      runContentBriefPipeline(payload(String(empty._id)), deps()),
    ).rejects.toThrow('mongo write failed');
    expect(await ContentBrief.findById(empty._id)).toMatchObject({
      status: 'failed',
      // The provider response and bounded cost remain known in-process even
      // though its first persistence attempt failed, so the recovery write
      // retains them and reports the next boundary as the failed stage.
      serpSource: 'fetched',
      totalCostMicros: 10_000,
      halt: { stage: 'scrape', reason: 'processing_failure' },
    });

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const partialContext = await seedContext();
    const partial = await queuedBrief(partialContext.keywordId, {
      status: 'running',
      serpSource: 'stored',
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Retained',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
    });
    vi.spyOn(ContentBrief.prototype, 'save').mockRejectedValueOnce(new Error('mongo write failed'));
    await expect(
      runContentBriefPipeline(payload(String(partial._id)), deps()),
    ).rejects.toThrow('mongo write failed');
    expect(await ContentBrief.findById(partial._id)).toMatchObject({
      status: 'completed_partial',
      halt: { stage: 'scrape', reason: 'processing_failure' },
    });
  });

  it('attributes unexpected AI persistence errors and ignores stale outer failures', async () => {
    const { keywordId } = await seedContext();
    const aiBrief = await queuedBrief(keywordId, {
      serpSource: 'stored',
      serpTopUrls: ['https://one.example.test/a'],
      scrapeAttempts: 1,
      successfulScrapeAttempts: 1,
      secondaryTerms: [{ id: 'term-1', term: 'existing' }],
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Stored',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
    });
    const originalSave = ContentBrief.prototype.save;
    const save = vi.spyOn(ContentBrief.prototype, 'save');
    save.mockImplementationOnce(function (...args) {
      return originalSave.apply(this, args as never) as never;
    });
    save.mockRejectedValueOnce(new Error('AI result write failed'));
    await expect(
      runContentBriefPipeline(payload(String(aiBrief._id)), deps()),
    ).rejects.toThrow('AI result write failed');
    expect(await ContentBrief.findById(aiBrief._id)).toMatchObject({
      status: 'completed_partial',
      halt: { stage: 'brief_ai', reason: 'processing_failure' },
    });

    vi.restoreAllMocks();
    await clearCollections();
    await truncateAllTables();
    const staleContext = await seedContext();
    const stale = await queuedBrief(staleContext.keywordId);
    vi.spyOn(ContentBrief.prototype, 'save').mockRejectedValueOnce(
      new Error('stale result write failed'),
    );
    vi.spyOn(ContentBrief, 'exists')
      .mockResolvedValueOnce({ _id: stale._id } as never)
      .mockResolvedValueOnce(null);
    await expect(
      runContentBriefPipeline(payload(String(stale._id)), deps()),
    ).resolves.toBeUndefined();
    expect(await ContentBrief.findById(stale._id)).toMatchObject({
      status: 'running',
      processorAttempt: 0,
    });
  });

  it('drops missing account-scoped jobs, rejects malformed payloads, and settles exhausted jobs', async () => {
    const processor = createContentBriefProcessor(deps());
    await processor({ data: payload('000000000000000000000899') } as Job<ContentBriefJob>, 'token');
    await expect(
      processor({ data: { crafted: true } } as unknown as Job<ContentBriefJob>, 'token'),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const { keywordId } = await seedContext();
    const exhausted = await queuedBrief(keywordId, {
      status: 'running', providerFailureCount: 1,
    });
    await onContentBriefJobExhausted(
      { data: payload(String(exhausted._id)) } as Job,
    );
    expect(await ContentBrief.findById(exhausted._id)).toMatchObject({
      status: 'failed',
      halt: { reason: 'processing_failure' },
    });
    await onContentBriefJobExhausted({ data: payload(String(exhausted._id)) } as Job);
    await onContentBriefJobExhausted({ data: { bad: true } } as Job);
    await onContentBriefJobExhausted({ data: payload('000000000000000000000898') } as Job);

    const retained = await queuedBrief(keywordId, {
      status: 'running',
      serpSource: 'stored',
      providerFailureCount: 1,
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://one.example.test/a',
          title: 'Retained',
          excerpt: 'body',
          headings: [],
          capturedAt: NOW,
          wordCount: 1,
          entityLabels: [],
        },
      ],
    });
    await onContentBriefJobExhausted(
      { data: payload(String(retained._id)) } as Job,
    );
    expect(await ContentBrief.findById(retained._id)).toMatchObject({
      status: 'completed_partial',
      halt: { stage: 'scrape', reason: 'processing_failure' },
    });
  });

  it('persists bounded processing failures when owned state disappears', async () => {
    const { keywordId } = await seedContext();
    const brief = await queuedBrief(keywordId);
    await Site.deleteMany({});
    await runContentBriefPipeline(payload(String(brief._id)), deps());
    expect(await ContentBrief.findById(brief._id)).toMatchObject({
      status: 'failed', halt: { reason: 'processing_failure' },
    });

    await clearCollections();
    await truncateAllTables();
    const missingKeyword = await seedContext();
    const keywordBrief = await queuedBrief(missingKeyword.keywordId);
    await getTestDb().delete(keywords);
    await runContentBriefPipeline(payload(String(keywordBrief._id)), deps());
    expect(await ContentBrief.findById(keywordBrief._id)).toMatchObject({
      status: 'failed',
      halt: { stage: 'serp_fetch', reason: 'processing_failure' },
    });
  });
});
