/**
 * Content Intelligence — processor orchestration tests (prompt 05, Phase A6).
 *
 * Covers the full worker pipeline over real memory-Mongo documents with
 * inline provider fakes:
 *   - envelope invariants (malformed payload → dead-letter, missing doc →
 *     drop, terminal replay → no-op);
 *   - full success → completed with artifacts, ledger, costs, snapshot;
 *   - owned-unusable → failed + exactly-once failed event (replay never re-scrapes);
 *   - SERP failure → partial with owned-only scoring while brief/draft still
 *     run on synthesized keyword evidence;
 *   - competitor partial, brief/draft failures, budget + ceiling boundaries;
 *   - concurrent cancellation at every stage boundary → quiet stop;
 *   - crash-replay ledger skips (vendor-cost work never repeated);
 *   - legacy documents with null accounting fields;
 *   - SEC-REDACT: crawled/AI text never reaches the logger.
 */
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { UnrecoverableError } from 'bullmq';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  ContentAnalysis,
  ContentSnapshot,
  advanceContentAnalysisStage,
  createContentAnalysisProcessor,
} from './index.js';
import { stripHtmlMarkers } from './content-analysis.processor.js';
import { hashInputs } from './content-analysis.pipeline.js';
import type { ContentAnalysisJob } from '../../shared/queue/index.js';
import type { ContentDocument } from '../../shared/providers/content-source.js';
import { VendorAuthError, VendorTimeoutError } from '../../shared/providers/errors.js';
import type * as PipelineModule from './content-analysis.pipeline.js';
import type * as ScoreModule from './content-analysis.score.js';

// ---------------------------------------------------------------------------
// Module seams
// ---------------------------------------------------------------------------

const events: Array<Record<string, unknown>> = [];

/** Per-test stage-handler overrides (undefined → the real implementation). */
const overrides: {
  owned: undefined | ((...args: never[]) => unknown);
  competitors: undefined | ((...args: never[]) => unknown);
  brief: undefined | ((...args: never[]) => unknown);
  draft: undefined | ((...args: never[]) => unknown);
  score: undefined | ((...args: never[]) => unknown);
} = { owned: undefined, competitors: undefined, brief: undefined, draft: undefined, score: undefined };

vi.mock('../../shared/security/url-safety.js', () => ({
  assertPublicUrlSafe: vi.fn(async (url: string) => {
    if (url.includes('unsafe')) throw new Error('private address blocked');
    return url;
  }),
}));

vi.mock('./content-analysis.pipeline.js', async (importOriginal) => {
  const original = await importOriginal<typeof PipelineModule>();
  return {
    ...original,
    runOwnedStage: (...args: Parameters<typeof original.runOwnedStage>) =>
      ((overrides.owned as typeof original.runOwnedStage | undefined) ??
        original.runOwnedStage)(...args),
    runCompetitorsStage: (...args: Parameters<typeof original.runCompetitorsStage>) =>
      ((overrides.competitors as typeof original.runCompetitorsStage | undefined) ??
        original.runCompetitorsStage)(...args),
    runBriefStage: (...args: Parameters<typeof original.runBriefStage>) =>
      ((overrides.brief as typeof original.runBriefStage | undefined) ??
        original.runBriefStage)(...args),
    runDraftStage: (...args: Parameters<typeof original.runDraftStage>) =>
      ((overrides.draft as typeof original.runDraftStage | undefined) ??
        original.runDraftStage)(...args),
  };
});

vi.mock('./content-analysis.score.js', async (importOriginal) => {
  const original = await importOriginal<typeof ScoreModule>();
  return {
    ...original,
    buildScorecard: (...args: Parameters<typeof original.buildScorecard>) =>
      ((overrides.score as typeof original.buildScorecard | undefined) ??
        original.buildScorecard)(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-07-15T12:00:00.000Z');
const OWNED_URL = 'https://example.com/p';
const RIVAL_1 = 'https://rival-1.example/a';
const RIVAL_2 = 'https://rival-2.example/b';

function silentLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as Logger;
}

function makeDocument(overrides_: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: OWNED_URL,
    statusCode: 200,
    title: 'A very reasonable page title',
    description: 'A description that is long enough to look like a real one here.',
    canonical: OWNED_URL,
    robots: [],
    language: 'en',
    markdown: `Practical guidance about seo audits with several helpful details. ${Array.from(
      { length: 160 },
      (_, i) => `context${i}`,
    ).join(' ')}`,
    text: 'Intro words about the topic seo audits and more helpful details.',
    headings: [
      { level: 2, text: 'One' },
      { level: 2, text: 'Two' },
    ],
    links: [
      { url: 'https://example.com/a', external: false },
      { url: 'https://example.com/b', external: false },
      { url: 'https://example.com/c', external: false },
      { url: 'https://other.com/x', external: true },
    ],
    structuredData: [{ type: 'Article', property: 'headline', value: 'x' }],
    contentHash: 'hash-owned-1',
    capturedAt: FIXED_NOW,
    ...overrides_,
  };
}

function fakeDb() {
  const db: Record<string, unknown> = {};
  db.insert = () => ({
    values: (v: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          const dup = events.some(
            (e) => e.reservationKey === v.reservationKey && e.kind === v.kind,
          );
          if (dup) return [];
          events.push(v);
          return [v];
        },
      }),
    }),
  });
  return db as never;
}

interface DepsShape {
  db: never;
  contentSource: { scrapePage: ReturnType<typeof vi.fn>; crawlSite: ReturnType<typeof vi.fn> };
  keyword: { getMetrics: ReturnType<typeof vi.fn>; classifyIntent: ReturnType<typeof vi.fn> };
  rank: { checkRank: ReturnType<typeof vi.fn> };
  ai: { preflight: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> };
  aiProviderOrder: readonly ['fake'];
  logger: Logger;
  now: () => Date;
  costCeilingMicros: number;
  aiBudgetMicros: number;
  snapshotTtlDays: number;
}

function aiRunResult(input: { profile: string }, body?: string) {
  return {
    trust: 'untrusted',
    status: 'complete',
    object:
      input.profile === 'content_brief'
        ? { title: 'Brief title', audience: 'General', outline: ['a', 'b'], citations: [] }
        : {
            title: 'Draft title',
            body: body ?? 'Draft body with several words of text.',
            citations: [],
          },
    warnings: [],
    qualityFlags: ['complete'],
    provenance: {
      task: input.profile,
      profileVersion: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 't',
      promptTemplateVersion: '1',
      provider: 'fake',
      model: 'fake-1',
      finishReason: 'stop',
      attempts: 1,
      fallbackUsed: false,
      latencyMs: 5,
      actualOrEstimatedCostMicros: 2_000n,
    },
    classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
  };
}

function deps(partial: Partial<DepsShape> = {}): DepsShape {
  return {
    db: fakeDb(),
    contentSource: {
      scrapePage: vi.fn(async () => ({
        document: makeDocument(),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      })),
      crawlSite: vi.fn(),
    },
    keyword: {
      getMetrics: vi.fn(async () => [
        { keyword: 'seo audits', searchVolume: 100, difficulty: 40, cpc: null, monthlySearches: [] },
      ]),
      classifyIntent: vi.fn(async () => [
        { keyword: 'seo audits', intent: 'informational', confidence: 0.9 },
      ]),
    },
    rank: {
      checkRank: vi.fn(async () => ({
        position: 4,
        serpTopUrls: [] as string[],
        checkedAt: FIXED_NOW,
      })),
    },
    ai: {
      preflight: vi.fn(),
      run: vi.fn(async (input: { profile: string }) => aiRunResult(input)),
    },
    aiProviderOrder: ['fake'] as const,
    logger: silentLogger(),
    now: () => FIXED_NOW,
    costCeilingMicros: 250_000,
    aiBudgetMicros: 140_000,
    snapshotTtlDays: 2,
    ...partial,
  };
}

function processorFrom(d: DepsShape) {
  return createContentAnalysisProcessor(d as never);
}

function baseAnalysisInput(overrides_: Record<string, unknown> = {}) {
  const accountId = new Types.ObjectId().toString();
  const key = `idem_${new Types.ObjectId().toString()}${'x'.repeat(19)}`;
  return {
    accountId,
    ownerUserId: accountId,
    siteId: new Types.ObjectId().toString(),
    ownedUrl: OWNED_URL,
    keyword: 'seo audits',
    locale: 'en' as const,
    status: 'queued' as const,
    stages: [
      { name: 'queued' as const, startedAt: new Date(), completedAt: null, error: null },
    ],
    inputFingerprint: 'x'.repeat(64),
    idempotencyKey: key,
    providerRefs: { snapshotIds: [] },
    requestedAt: new Date(),
    ...overrides_,
  };
}

function payloadFor(doc: {
  accountId: unknown;
  siteId: unknown;
  _id: unknown;
  idempotencyKey: string;
}): ContentAnalysisJob {
  return {
    accountId: String(doc.accountId),
    siteId: String(doc.siteId),
    analysisId: String(doc._id),
    reservationKey: doc.idempotencyKey,
  };
}

function fakeJob<T>(data: T): Job<T> {
  return { data } as Job<T>;
}

// Stage hashes for the standard fixture (keyword 'seo audits', locale en).
const OWNED_HASH = hashInputs('collecting_owned', OWNED_URL, 'seo audits', 'en');
const SERP_HASH = hashInputs('collecting_serp', 'seo audits', 'en', 'example.com');
const BRIEF_HASH = hashInputs('generating_brief', 'hash-owned-1', 'seo audits', 'en');

const SEED_FACTS = {
  url: OWNED_URL,
  title: 'A very reasonable page title',
  description: 'A description that is long enough to look like a real one here.',
  canonical: OWNED_URL,
  language: 'en',
  wordCount: 120,
  headingCount: 2,
  schemaTypes: ['Article'],
  hasSchemaOrgArticle: true,
  internalLinkCount: 3,
  externalLinkCount: 1,
  contentHash: 'hash-owned-1',
  excerpt: 'A bounded excerpt about seo audits with enough words to look entirely real.',
};

const SEED_KEYWORD_EVIDENCE = {
  keyword: 'seo audits',
  locationCode: 2840,
  languageCode: 'en',
  volume: 100,
  difficulty: 40,
  intent: 'informational',
};

const SEED_SERP_EVIDENCE = { device: 'desktop', ownedPosition: 4, topUrls: [] };

function ledgerEntry(
  stage: string,
  inputHash: string,
  result: 'ok' | 'skipped' | 'failed' = 'ok',
  reason: string | null = null,
) {
  return { stage, inputHash, result, durationMs: 0, costMicros: 0, aiCostMicros: 0, reason };
}

/**
 * Insert a raw analysis document at the Mongo collection level (bypassing
 * Mongoose defaults/validation) so crash-replay states — including legacy
 * documents with null accounting fields — can be constructed exactly.
 */
async function seedRaw(input: {
  status: string;
  stageLedger?: unknown[];
  owned?: object | null;
  evidence?: object | null;
  scorecardV2?: object | null;
  brief?: object | null;
  draft?: object | null;
  warnings?: Array<{ code: string; messageKey: string }>;
  costMicros?: number | null;
  aiCostMicros?: number | null;
}) {
  const _id = new Types.ObjectId();
  const accountId = new Types.ObjectId();
  const siteId = new Types.ObjectId();
  const key = `idem_${_id.toString()}${'y'.repeat(19)}`;
  const now = new Date();
  await ContentAnalysis.collection.insertOne({
    _id,
    accountId,
    ownerUserId: accountId,
    siteId,
    ownedUrl: OWNED_URL,
    keyword: 'seo audits',
    locale: 'en',
    status: input.status,
    stages: [{ name: input.status, startedAt: now, completedAt: null, error: null }],
    inputFingerprint: 'x'.repeat(64),
    idempotencyKey: key,
    providerRefs: { firecrawlJobId: null, snapshotIds: [], serpCacheKey: null },
    scorecard: null,
    brief: input.brief ?? null,
    draft: input.draft ?? null,
    citations: [],
    warnings: input.warnings ?? [],
    error: null,
    owned: input.owned ?? null,
    evidence: input.evidence ?? null,
    scorecardV2: input.scorecardV2 ?? null,
    recommendations: [],
    recommendationStates: [],
    stageLedger: input.stageLedger ?? [],
    budgetSpentMicros: 0,
    costMicros: input.costMicros === undefined ? 0 : input.costMicros,
    aiCostMicros: input.aiCostMicros === undefined ? 0 : input.aiCostMicros,
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  } as never);
  const payload: ContentAnalysisJob = {
    accountId: accountId.toString(),
    siteId: siteId.toString(),
    analysisId: _id.toString(),
    reservationKey: key,
  };
  return { analysisId: _id.toString(), payload };
}

/** Ledger seeds for a run whose owned + serp stages already completed. */
function throughSerpLedger(): unknown[] {
  return [ledgerEntry('collecting_owned', OWNED_HASH), ledgerEntry('collecting_serp', SERP_HASH)];
}

function throughScoringSeed() {
  const scoringHash = hashInputs('scoring', 'hash-owned-1', 'seo audits', '4');
  const competitorsHash = hashInputs('collecting_competitors');
  return {
    owned: SEED_FACTS,
    evidence: {
      keyword: SEED_KEYWORD_EVIDENCE,
      serp: SEED_SERP_EVIDENCE,
      competitorUrls: [],
      competitors: [],
      competitorFailures: [],
    },
    scorecardV2: {
      version: 'seeded',
      total: 77,
      sections: ['intent', 'coverage', 'structure', 'links', 'schema', 'technical'].map(
        (sectionKey) => ({
          key: sectionKey,
          score: 77,
          weight: sectionKey === 'intent' || sectionKey === 'coverage' ? 25
            : sectionKey === 'structure' ? 20
            : sectionKey === 'schema' ? 15
            : sectionKey === 'links' ? 10 : 5,
          confidence: 0.9,
          reason: 'seeded',
        }),
      ),
    },
    stageLedger: [
      ...throughSerpLedger(),
      ledgerEntry('collecting_competitors', competitorsHash, 'skipped', 'no_candidates'),
      ledgerEntry('scoring', scoringHash),
    ],
  };
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  events.length = 0;
  overrides.competitors = undefined;
  overrides.brief = undefined;
  overrides.draft = undefined;
  overrides.score = undefined;
  overrides.owned = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Envelope invariants
// ---------------------------------------------------------------------------

describe('createContentAnalysisProcessor — envelope', () => {
  it('rejects a malformed payload as UnrecoverableError', async () => {
    const processor = processorFrom(deps());
    await expect(
      processor(fakeJob({ what: 'ever' } as unknown as ContentAnalysisJob), 'tok'),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('drops silently when the analysis is missing (owning account deleted)', async () => {
    const d = deps();
    const processor = processorFrom(d);
    const payload: ContentAnalysisJob = {
      accountId: new Types.ObjectId().toString(),
      siteId: new Types.ObjectId().toString(),
      analysisId: new Types.ObjectId().toString(),
      reservationKey: `idem_${'x'.repeat(43)}`,
    };
    await expect(processor(fakeJob(payload), 'tok')).resolves.toBeUndefined();
    expect(d.logger.warn).toHaveBeenCalled();
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
  });

  it('is a no-op replay on a terminal analysis', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput({ status: 'completed' }));
    const before = doc.updatedAt.getTime();
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.updatedAt.getTime()).toBe(before);
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
  });

  it('stops quietly when the run disappears between load and the first stage', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    vi.spyOn(ContentAnalysis, 'findById').mockReturnValue(
      Promise.resolve(null) as never,
    );
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline paths
// ---------------------------------------------------------------------------

describe('processor — full pipeline', () => {
  it('runs the whole pipeline to completed with artifacts, ledger, costs, and one event', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps({
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: [OWNED_URL, RIVAL_1, RIVAL_2],
          checkedAt: FIXED_NOW,
        })),
      },
    });
    const processor = processorFrom(d);
    await processor(fakeJob(payloadFor(doc)), 'tok');

    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.startedAt).not.toBeNull();
    expect(after?.completedAt?.getTime()).toBe(FIXED_NOW.getTime());
    expect(after?.owned).toMatchObject({ url: OWNED_URL, contentHash: 'hash-owned-1' });
    const evidence = after?.evidence as {
      keyword: { volume: number };
      serp: { ownedPosition: number };
      competitorUrls: string[];
      competitors: Array<{ sourceId: string }>;
      competitorFailures: unknown[];
    };
    expect(evidence.keyword.volume).toBe(100);
    expect(evidence.serp.ownedPosition).toBe(4);
    expect(evidence.competitorUrls).toEqual([RIVAL_1, RIVAL_2]);
    expect(evidence.competitors.map((c) => c.sourceId)).toEqual([
      'competitor-1',
      'competitor-2',
    ]);
    expect(evidence.competitorFailures).toEqual([]);
    expect(after?.scorecardV2).toMatchObject({ version: expect.any(String) });
    expect((after?.recommendations ?? []).length).toBeGreaterThanOrEqual(0);
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft?.markdown).toBeTruthy();
    expect(after?.draft?.wordCount).toBeGreaterThan(0);
    expect(after?.citations.map((c) => c.sourceId)).toEqual([
      'owned',
      'competitor-1',
      'competitor-2',
    ]);
    expect(after?.warnings).toHaveLength(0);
    // owned 1000 + serp 0 + competitors 2×1000 + brief 2000 + draft 2000.
    expect(after?.costMicros).toBe(7_000);
    expect(after?.aiCostMicros).toBe(4_000);
    const ledger = (after?.stageLedger ?? []) as Array<{ stage: string; result: string }>;
    expect(ledger.map((e) => `${e.stage}:${e.result}`)).toEqual([
      'collecting_owned:ok',
      'collecting_serp:ok',
      'collecting_competitors:ok',
      'scoring:ok',
      'generating_brief:ok',
      'generating_draft:ok',
    ]);

    // Owned snapshot with the injected TTL.
    const snapshots = await ContentSnapshot.find({ analysisId: doc._id });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.expiryAt.getTime()).toBe(
      FIXED_NOW.getTime() + 2 * 24 * 60 * 60 * 1000,
    );
    expect(after?.providerRefs.snapshotIds.map(String)).toEqual([String(snapshots[0]!._id)]);

    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'completed', costMicros: 7_000, aiCostMicros: 4_000 });

    // Terminal replay is a pure no-op — no new provider work, no new events.
    await processor(fakeJob(payloadFor(doc)), 'tok');
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
  });

  it('tolerates an unknown in-memory stage value and falls back to env-derived budgets', async () => {
    // No now/ceiling/budget/ttl overrides — the factory reads env defaults —
    // and the first stage lookup sees a bogus status (defensive ?? -1 path).
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    const base = {
      db: d.db,
      contentSource: d.contentSource,
      keyword: d.keyword,
      rank: d.rank,
      ai: d.ai,
      aiProviderOrder: d.aiProviderOrder,
      logger: d.logger,
    };
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    let calls = 0;
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) => {
      calls += 1;
      const query = real(id as never);
      if (calls === 1) {
        return query.then((loaded) => {
          if (loaded) loaded.status = 'bogus_stage' as never;
          return loaded;
        });
      }
      return query;
    }) as never);
    await createContentAnalysisProcessor(base as never)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
  });

  it('fails exactly once when the owned page is unusable, and never re-scrapes on replay', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => ({
      document: makeDocument({ markdown: '', title: null, headings: [], structuredData: [] }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    const processor = processorFrom(d);
    await processor(fakeJob(payloadFor(doc)), 'tok');

    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatchObject({
      category: 'owned_page_unusable',
      messageKey: 'contentIntelligence.errors.ownedPageUnusable',
      retryable: false,
      terminal: true,
    });
    expect(after?.completedAt).not.toBeNull();
    expect(after?.stages[after.stages.length - 1]).toMatchObject({
      name: 'failed',
      error: 'owned_page_unusable',
    });
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(1);
    expect(events[0]).toMatchObject({ reservationKey: doc.idempotencyKey, errorCategory: 'owned_page_unusable' });

    // Replay: terminal no-op — no re-scrape, no second event.
    await processor(fakeJob(payloadFor(doc)), 'tok');
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('maps an unrecognized owned-stage failure code to owned_page_unusable', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    overrides.owned = async () => ({ ok: false, code: 'unexpected_owned_code', reason: 'no usable content' });
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatchObject({
      category: 'owned_page_unusable',
      messageKey: 'contentIntelligence.errors.ownedPageUnusable',
      retryable: false,
    });
    expect(events.map((e) => e.kind)).toEqual(['failed']);
    expect(d.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unexpected_owned_code' }),
      expect.stringContaining('owned stage failed'),
    );
  });

  it('fails RETRYABLE when the owned scrape throws a transient vendor fault', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => {
      throw new VendorTimeoutError('scrape timed out', {
        provider: 'firecrawl',
        operation: 'scrape',
      });
    });
    const processor = processorFrom(d);
    await processor(fakeJob(payloadFor(doc)), 'tok');

    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatchObject({
      category: 'owned_fetch_failed',
      messageKey: 'contentIntelligence.errors.ownedFetchFailed',
      retryable: true,
      terminal: true,
    });
    expect(after?.stages[after.stages.length - 1]).toMatchObject({
      name: 'failed',
      error: 'owned_fetch_failed',
    });
    expect(events.map((e) => e.kind)).toEqual(['failed']);
  });

  it('fails TERMINAL as provider_unavailable + warns when the vendor rejects our credentials', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => {
      throw new VendorAuthError('credentials rejected (HTTP 403)', {
        provider: 'firecrawl',
        operation: 'scrape',
      });
    });
    const processor = processorFrom(d);
    await processor(fakeJob(payloadFor(doc)), 'tok');

    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatchObject({
      category: 'provider_unavailable',
      messageKey: 'contentIntelligence.errors.providerUnavailable',
      retryable: false,
      terminal: true,
    });
    expect(after?.stages[after.stages.length - 1]).toMatchObject({
      name: 'failed',
      error: 'provider_unavailable',
    });
    expect(events.map((e) => e.kind)).toEqual(['failed']);
    // Operator misconfiguration is logged at warn, not buried at info.
    expect(d.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'provider_unavailable', reason: 'credentials rejected (HTTP 403)' }),
      expect.stringContaining('owned stage failed'),
    );
  });

  it('degrades to partial on SERP failure while brief/draft run on synthesized keyword evidence', async () => {
    const stuffed = `${'audit '.repeat(20)}${Array.from({ length: 40 }, (_, i) => `filler${i}`).join(' ')}`;
    const doc = await ContentAnalysis.create(baseAnalysisInput({ keyword: 'audit tools' }));
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => ({
      document: makeDocument({ markdown: stuffed }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    d.keyword.getMetrics = vi.fn(async () => {
      throw new Error('keyword vendor down');
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');

    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.warnings.map((w) => w.code)).toContain('serp_unavailable');
    expect(after?.warnings.map((w) => w.code)).toContain('stuffing_suspected');
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      result: string;
      reason: string | null;
    }>;
    expect(ledger.find((e) => e.stage === 'collecting_serp')).toMatchObject({
      result: 'failed',
      reason: 'keyword_unavailable',
    });
    // Owned-only scoring — no keyword/serp/competitor evidence persisted.
    const evidence = after?.evidence as { keyword: unknown; serp: unknown } | null;
    expect(evidence?.keyword ?? null).toBeNull();
    expect(evidence?.serp ?? null).toBeNull();
    expect(after?.scorecardV2).toBeTruthy();
    // Brief + draft still generated from the analysis-input keyword string.
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft?.markdown).toBeTruthy();
    expect(d.ai.run).toHaveBeenCalledTimes(2);
    const briefCall = d.ai.run.mock.calls[0]![0] as { input: { keyword: string } };
    expect(briefCall.input.keyword).toBe('audit tools');
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
  });

  it('degrades to partial on rank failure for the zh locale (zh-CN fallback evidence)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput({ locale: 'zh' }));
    const d = deps();
    d.rank.checkRank = vi.fn(async () => {
      throw new Error('serp down');
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.warnings.map((w) => w.code)).toContain('serp_unavailable');
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft?.markdown).toBeTruthy();
    expect(d.ai.run).toHaveBeenCalledTimes(2);
  });

  it('keeps a replayed run degraded when the ledger already records a failed SERP stage', async () => {
    const { analysisId, payload } = await seedRaw({
      status: 'collecting_serp',
      owned: SEED_FACTS,
      stageLedger: [
        ledgerEntry('collecting_owned', OWNED_HASH),
        ledgerEntry('collecting_serp', SERP_HASH, 'failed', 'serp_unavailable'),
      ],
      warnings: [
        { code: 'serp_unavailable', messageKey: 'contentIntelligence.warnings.serpUnavailable' },
      ],
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('partial');
    // Neither the owned scrape nor the SERP lookups were repeated.
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
    expect(d.keyword.getMetrics).not.toHaveBeenCalled();
    expect(d.rank.checkRank).not.toHaveBeenCalled();
    expect(after?.brief?.text).toBeTruthy();
  });

  it('reuses persisted SERP evidence on replay and never re-spends', async () => {
    const { analysisId, payload } = await seedRaw({
      status: 'collecting_serp',
      owned: SEED_FACTS,
      evidence: {
        keyword: SEED_KEYWORD_EVIDENCE,
        serp: SEED_SERP_EVIDENCE,
        competitorUrls: [],
        competitors: [],
        competitorFailures: [],
      },
      stageLedger: throughSerpLedger(),
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    expect(d.keyword.getMetrics).not.toHaveBeenCalled();
    expect(d.rank.checkRank).not.toHaveBeenCalled();
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
  });

  it('re-runs the SERP stage when an ok ledger entry has no matching evidence', async () => {
    // keyword evidence missing entirely.
    const first = await seedRaw({
      status: 'collecting_serp',
      owned: SEED_FACTS,
      stageLedger: throughSerpLedger(),
    });
    const d1 = deps();
    await processorFrom(d1)(fakeJob(first.payload), 'tok');
    expect(d1.keyword.getMetrics).toHaveBeenCalledTimes(1);
    expect((await ContentAnalysis.findById(first.analysisId))?.status).toBe('completed');

    // keyword present but serp evidence missing.
    const second = await seedRaw({
      status: 'collecting_serp',
      owned: SEED_FACTS,
      evidence: {
        keyword: SEED_KEYWORD_EVIDENCE,
        competitorUrls: [],
        competitors: [],
        competitorFailures: [],
      },
      stageLedger: throughSerpLedger(),
    });
    const d2 = deps();
    await processorFrom(d2)(fakeJob(second.payload), 'tok');
    expect(d2.rank.checkRank).toHaveBeenCalledTimes(1);
    expect((await ContentAnalysis.findById(second.analysisId))?.status).toBe('completed');
  });

  it('records competitor failures as warnings while still completing the run', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps({
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: [RIVAL_1, RIVAL_2],
          checkedAt: FIXED_NOW,
        })),
      },
    });
    d.contentSource.scrapePage = vi.fn(async ({ url }: { url: string }) => {
      if (url === RIVAL_2) throw new Error('scrape timeout');
      return {
        document: makeDocument(),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      };
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.warnings.map((w) => w.code)).toContain('competitors_partial');
    const evidence = after?.evidence as {
      competitors: unknown[];
      competitorFailures: Array<{ url: string; reason: string }>;
    };
    expect(evidence.competitors).toHaveLength(1);
    expect(evidence.competitorFailures).toEqual([{ url: RIVAL_2, reason: 'timeout' }]);
  });

  it('treats a whole-competitor-stage failure as a warning, never fatal (defensive branch)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    overrides.competitors = async () => ({
      ok: false as const,
      code: 'competitors_failed',
      reason: 'stage exploded',
    });
    const d = deps({
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: [RIVAL_1],
          checkedAt: FIXED_NOW,
        })),
      },
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.warnings.map((w) => w.code)).toContain('competitors_partial');
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      result: string;
      reason: string | null;
    }>;
    expect(ledger.find((e) => e.stage === 'collecting_competitors')).toMatchObject({
      result: 'failed',
      reason: 'competitors_failed',
    });
  });

  it('reuses persisted competitor evidence on replay (ok ledger entry)', async () => {
    const competitorsHash = hashInputs('collecting_competitors', RIVAL_1);
    const competitor = {
      sourceId: 'competitor-1',
      url: RIVAL_1,
      title: 'Rival',
      wordCount: 400,
      headingCount: 3,
      schemaTypes: ['Article'],
      hasSchemaOrgArticle: true,
      snippet: 'rival snippet',
      contentHash: 'hash-rival-1',
    };
    const { analysisId, payload } = await seedRaw({
      status: 'collecting_competitors',
      owned: SEED_FACTS,
      evidence: {
        keyword: SEED_KEYWORD_EVIDENCE,
        serp: SEED_SERP_EVIDENCE,
        competitorUrls: [RIVAL_1],
        competitors: [competitor],
        competitorFailures: [],
      },
      stageLedger: [...throughSerpLedger(), ledgerEntry('collecting_competitors', competitorsHash)],
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
    expect(after?.citations.map((c) => c.sourceId)).toEqual(['owned', 'competitor-1']);
  });

  it('filters dirty persisted evidence shapes instead of crashing', async () => {
    const { analysisId, payload } = await seedRaw({
      status: 'collecting_competitors',
      owned: SEED_FACTS,
      evidence: {
        keyword: SEED_KEYWORD_EVIDENCE,
        serp: SEED_SERP_EVIDENCE,
        competitorUrls: [RIVAL_1, 42, null],
        competitors: [{ junk: true }],
        competitorFailures: [{ junk: true }],
      },
      stageLedger: throughSerpLedger(),
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    // Only the one string URL survived the filter and was scraped.
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(1);
  });

  it('fails the run when scoring throws', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    overrides.score = () => {
      throw new Error('scorer exploded');
    };
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error?.category).toBe('scoring_failed');
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(1);
    expect(d.logger.error).toHaveBeenCalled();
    expect(d.ai.run).not.toHaveBeenCalled();
  });

  it('skips scoring on replay when the scorecard and its ok ledger entry match', async () => {
    const seed = throughScoringSeed();
    const { analysisId, payload } = await seedRaw({ status: 'scoring', ...seed });
    const scoreSpy = vi.fn();
    overrides.score = scoreSpy as never;
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    expect(scoreSpy).not.toHaveBeenCalled();
    expect((after?.scorecardV2 as { version: string }).version).toBe('seeded');
  });

  it('re-scores when a scorecard exists without a matching ledger entry', async () => {
    const seed = throughScoringSeed();
    const { analysisId, payload } = await seedRaw({
      status: 'scoring',
      ...seed,
      stageLedger: [
        ...throughSerpLedger(),
        ledgerEntry('collecting_competitors', hashInputs('collecting_competitors')),
      ],
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    expect((after?.scorecardV2 as { version: string }).version).not.toBe('seeded');
  });

  it('re-runs the owned stage when facts exist but the ledger hash mismatches (junk tolerated)', async () => {
    const { analysisId, payload } = await seedRaw({
      status: 'collecting_owned',
      owned: SEED_FACTS,
      stageLedger: [
        { bogus: true },
        ledgerEntry('collecting_owned', 'not-the-right-hash'),
        ledgerEntry('collecting_serp', SERP_HASH, 'failed', 'unrelated'),
      ],
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(1);
    expect((await ContentAnalysis.findById(analysisId))?.status).toBe('partial');
  });

  it('never duplicates a warning code (dedupe guard)', async () => {
    const doc = await ContentAnalysis.create(
      baseAnalysisInput({
        warnings: [
          { code: 'serp_unavailable', messageKey: 'contentIntelligence.warnings.serpUnavailable' },
        ],
      }),
    );
    const d = deps();
    d.keyword.getMetrics = vi.fn(async () => {
      throw new Error('down again');
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.warnings.filter((w) => w.code === 'serp_unavailable')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AI stages — budgets, failures, replays
// ---------------------------------------------------------------------------

describe('processor — AI budget + brief/draft outcomes', () => {
  it('skips brief AND draft with a warning when the AI budget cannot fit the brief', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps({ aiBudgetMicros: 49_999 });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.warnings.map((w) => w.code)).toContain('ai_budget_exhausted');
    expect(after?.brief).toBeNull();
    expect(after?.draft).toBeNull();
    expect(d.ai.run).not.toHaveBeenCalled();
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      result: string;
      reason: string | null;
    }>;
    expect(ledger.find((e) => e.stage === 'generating_brief')).toMatchObject({
      result: 'skipped',
      reason: 'ai_budget_exhausted',
    });
    expect(ledger.find((e) => e.stage === 'generating_draft')).toMatchObject({
      result: 'skipped',
      reason: 'ai_budget_exhausted',
    });
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
  });

  it('runs the brief at the exact budget boundary, then skips the draft (brief kept)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    // content_brief worst case is exactly 50_000 micros — boundary inclusive.
    const d = deps({ aiBudgetMicros: 50_000 });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft).toBeNull();
    expect(after?.warnings.map((w) => w.code)).toContain('ai_budget_exhausted');
    expect(d.ai.run).toHaveBeenCalledTimes(1);
  });

  it('starves the competitor stage and the AI stages when the cost ceiling is already spent', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps({
      costCeilingMicros: 1_000, // exactly the owned scrape
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: [RIVAL_1, RIVAL_2],
          checkedAt: FIXED_NOW,
        })),
      },
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    // Only the owned page was scraped — zero competitor budget.
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(1);
    const evidence = after?.evidence as {
      competitors: unknown[];
      competitorFailures: Array<{ reason: string }>;
    };
    expect(evidence.competitors).toEqual([]);
    expect(evidence.competitorFailures.map((f) => f.reason)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    expect(after?.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['competitors_partial', 'ai_budget_exhausted']),
    );
    expect(d.ai.run).not.toHaveBeenCalled();
  });

  it('finishes partial without a draft attempt when the brief fails (one AI call only)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.ai.run = vi.fn(async () => {
      throw new Error('brief provider refused');
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.warnings.map((w) => w.code)).toContain('brief_failed');
    expect(after?.brief).toBeNull();
    expect(after?.draft).toBeNull();
    expect(d.ai.run).toHaveBeenCalledTimes(1);
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      result: string;
      reason: string | null;
    }>;
    expect(ledger.find((e) => e.stage === 'generating_brief')).toMatchObject({
      result: 'failed',
      reason: 'brief_failed',
    });
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
  });

  it('finishes partial keeping the brief when the draft fails', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.ai.run = vi.fn(async (input: { profile: string }) => {
      if (input.profile === 'content_first_draft') throw new Error('draft refused');
      return aiRunResult(input);
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft).toBeNull();
    expect(after?.warnings.map((w) => w.code)).toContain('draft_failed');
    expect(d.ai.run).toHaveBeenCalledTimes(2);
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      result: string;
      reason: string | null;
    }>;
    expect(ledger.find((e) => e.stage === 'generating_draft')).toMatchObject({
      result: 'failed',
      reason: 'draft_failed',
    });
  });

  it('treats an all-whitespace draft as failed with reason draft_empty (brief kept)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.ai.run = vi.fn(async (input: { profile: string }) => aiRunResult(input, '   '));
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft).toBeNull();
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      result: string;
      reason: string | null;
    }>;
    expect(ledger.find((e) => e.stage === 'generating_draft')).toMatchObject({
      result: 'failed',
      reason: 'draft_empty',
    });
  });

  it('strips HTML markers from the AI draft before persistence (model hook stays green)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.ai.run = vi.fn(async (input: { profile: string }) =>
      aiRunResult(input, '<script>bad()</script> Clean draft text that survives.'),
    );
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.draft?.markdown).toContain('Clean draft text that survives.');
    expect(after?.draft?.markdown).not.toMatch(/<script|<iframe|<!doctype/i);
  });

  it('records zero AI micros when a stage outcome omits the aiCostMicros field', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    overrides.brief = async () => ({
      ok: true as const,
      artifact: {
        text: 'brief text from override',
        citations: [],
        profileVersion: 'v-test',
        provider: 'fake',
        costMicros: 5,
      },
      costMicros: 5,
    });
    overrides.draft = async () => ({
      ok: true as const,
      artifact: {
        text: 'draft text from override',
        citations: [],
        profileVersion: 'v-test',
        provider: 'fake',
        costMicros: 7,
      },
      costMicros: 7,
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.aiCostMicros).toBe(0);
    expect(after?.costMicros).toBe(1_000 + 5 + 7);
    const ledger = (after?.stageLedger ?? []) as Array<{
      stage: string;
      aiCostMicros: number;
    }>;
    expect(ledger.find((e) => e.stage === 'generating_brief')?.aiCostMicros).toBe(0);
    expect(ledger.find((e) => e.stage === 'generating_draft')?.aiCostMicros).toBe(0);
  });

  it('reuses a stored brief on replay (legacy null provenance) and only generates the draft', async () => {
    const seed = throughScoringSeed();
    const { analysisId, payload } = await seedRaw({
      status: 'generating_brief',
      ...seed,
      brief: {
        versionId: 'v-old',
        sections: [],
        text: 'stored brief text',
        citations: ['competitor-1'],
        profileVersion: null,
        provider: null,
      },
      stageLedger: [...seed.stageLedger, ledgerEntry('generating_brief', BRIEF_HASH)],
    });
    // A legacy document may also lack the citations array entirely — serve a
    // one-shot facade for the brief-stage read so the ?? [] fallback is real.
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    let calls = 0;
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) => {
      calls += 1;
      const query = real(id as never);
      if (calls === 5) {
        return query.then((loaded) =>
          loaded
            ? Object.create(loaded, {
                brief: {
                  value: {
                    text: 'stored brief text',
                    citations: undefined,
                    profileVersion: null,
                    provider: null,
                  },
                  enumerable: true,
                },
              })
            : loaded,
        );
      }
      return query;
    }) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    expect(after?.brief?.text).toBe('stored brief text');
    expect(d.ai.run).toHaveBeenCalledTimes(1);
    expect((d.ai.run.mock.calls[0]![0] as { profile: string }).profile).toBe(
      'content_first_draft',
    );
    // The fresh draft hash chains off the STORED brief text.
    const draftHash = hashInputs('generating_draft', 'hash-owned-1', 'seo audits', 'stored brief text');
    const ledger = (after?.stageLedger ?? []) as Array<{ stage: string; inputHash: string }>;
    expect(ledger.find((e) => e.stage === 'generating_draft')?.inputHash).toBe(draftHash);
  });

  it('replays a fully-generated run without any AI call (draft ledger skip)', async () => {
    const seed = throughScoringSeed();
    const draftHash = hashInputs('generating_draft', 'hash-owned-1', 'seo audits', 'stored brief text');
    const { analysisId, payload } = await seedRaw({
      status: 'generating_draft',
      ...seed,
      brief: {
        versionId: 'v1',
        sections: [],
        text: 'stored brief text',
        citations: ['competitor-1'],
        profileVersion: '1.0.0',
        provider: 'fake',
      },
      draft: {
        versionId: 'v1',
        markdown: 'stored draft words that satisfy the length checks',
        wordCount: 8,
        text: null,
        citations: [],
        profileVersion: '1.0.0',
        provider: 'fake',
      },
      stageLedger: [
        ...seed.stageLedger,
        ledgerEntry('generating_brief', BRIEF_HASH),
        ledgerEntry('generating_draft', draftHash),
      ],
    });
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(analysisId);
    expect(after?.status).toBe('completed');
    expect(d.ai.run).not.toHaveBeenCalled();
    expect(d.contentSource.scrapePage).not.toHaveBeenCalled();
    expect(after?.draft?.markdown).toBe('stored draft words that satisfy the length checks');
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrent cancellation at every stage boundary
// ---------------------------------------------------------------------------

async function cancelInDb(analysisId: string): Promise<void> {
  await ContentAnalysis.collection.updateOne(
    { _id: new Types.ObjectId(analysisId) },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
  );
}

describe('processor — concurrent cancellation stops quietly', () => {
  it('stops after the owned stage when cancellation lands during the scrape', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => {
      await cancelInDb(String(doc._id));
      return {
        document: makeDocument(),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      };
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('cancelled');
    expect(d.keyword.getMetrics).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('stops before the competitor stage when cancellation lands during the SERP lookup', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.keyword.getMetrics = vi.fn(async () => {
      await cancelInDb(String(doc._id));
      return [{ keyword: 'seo audits', searchVolume: 1, difficulty: 1, cpc: null, monthlySearches: [] }];
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('cancelled');
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(1); // owned only
    expect(d.ai.run).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('stops before scoring when cancellation lands during a competitor scrape', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps({
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: [RIVAL_1],
          checkedAt: FIXED_NOW,
        })),
      },
    });
    let scrapeCount = 0;
    d.contentSource.scrapePage = vi.fn(async () => {
      scrapeCount += 1;
      if (scrapeCount === 2) await cancelInDb(String(doc._id));
      return {
        document: makeDocument(),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      };
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('cancelled');
    expect(after?.scorecardV2).toBeNull();
    expect(d.ai.run).not.toHaveBeenCalled();
  });

  it('stops before the brief when a terminal race wins the stage advance', async () => {
    const seed = throughScoringSeed();
    const { analysisId, payload } = await seedRaw({ status: 'scoring', ...seed });
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    let calls = 0;
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) => {
      calls += 1;
      const query = real(id as never);
      if (calls === 6) {
        return query.then((loaded) => {
          if (loaded) loaded.status = 'cancelled' as never;
          return loaded;
        });
      }
      return query;
    }) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    expect(d.ai.run).not.toHaveBeenCalled();
    expect((await ContentAnalysis.findById(analysisId))?.status).toBe('scoring');
    expect(events).toEqual([]);
  });

  it('stops before the draft when a terminal race wins the stage advance', async () => {
    const seed = throughScoringSeed();
    const { analysisId, payload } = await seedRaw({
      status: 'generating_brief',
      ...seed,
      brief: {
        versionId: 'v1',
        sections: [],
        text: 'stored brief text',
        citations: [],
        profileVersion: '1.0.0',
        provider: 'fake',
      },
      stageLedger: [...seed.stageLedger, ledgerEntry('generating_brief', BRIEF_HASH)],
    });
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    let calls = 0;
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) => {
      calls += 1;
      const query = real(id as never);
      if (calls === 7) {
        return query.then((loaded) => {
          if (loaded) loaded.status = 'cancelled' as never;
          return loaded;
        });
      }
      return query;
    }) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payload), 'tok');
    expect(d.ai.run).not.toHaveBeenCalled();
    expect((await ContentAnalysis.findById(analysisId))?.status).toBe('generating_brief');
  });

  it('records no terminal event when cancellation lands during the draft generation', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.ai.run = vi.fn(async (input: { profile: string }) => {
      if (input.profile === 'content_first_draft') await cancelInDb(String(doc._id));
      return aiRunResult(input);
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('cancelled');
    // The paid draft was still persisted for a potential un-cancel audit trail.
    expect(after?.draft?.markdown).toBeTruthy();
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(0);
  });

  it('stops when the final document vanishes after the draft stage', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) =>
      real(id as never).then((loaded) =>
        loaded && loaded.status === 'generating_draft' && loaded.draft?.markdown
          ? null
          : loaded,
      )) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(0);
    const after = await ContentAnalysis.collection.findOne({ _id: doc._id });
    expect(after?.status).toBe('generating_draft');
  });

  it('records no event when the terminal advance itself loses a cancellation race', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    let draftSightings = 0;
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) =>
      real(id as never).then((loaded) => {
        if (loaded && loaded.status === 'generating_draft' && loaded.draft?.markdown) {
          draftSightings += 1;
          if (draftSightings === 2) loaded.status = 'cancelled' as never;
        }
        return loaded;
      })) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(0);
    const after = await ContentAnalysis.collection.findOne({ _id: doc._id });
    expect(after?.status).toBe('generating_draft');
  });

  it('skips the completion event when the finalized doc cannot be re-read', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) =>
      real(id as never).then((loaded) =>
        loaded && loaded.status === 'completed' ? null : loaded,
      )) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(0);
    const after = await ContentAnalysis.collection.findOne({ _id: doc._id });
    expect(after?.status).toBe('completed');
  });

  it('stops the failure quietly when cancellation beats the failed advance', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => {
      await cancelInDb(String(doc._id));
      return {
        document: makeDocument({ markdown: '', title: null, headings: [], structuredData: [] }),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      };
    });
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('cancelled');
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(0);
  });

  it('stops the failure quietly when the failed doc cannot be re-read for the event', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) =>
      real(id as never).then((loaded) =>
        loaded && loaded.status === 'failed' ? null : loaded,
      )) as never);
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => ({
      document: makeDocument({ markdown: '', title: null, headings: [], structuredData: [] }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(0);
    const after = await ContentAnalysis.collection.findOne({ _id: doc._id });
    expect(after?.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Accounting resilience + event defaults
// ---------------------------------------------------------------------------

describe('processor — legacy accounting fields', () => {
  it('treats null cost fields as zero across the owned, serp, and competitor stages', async () => {
    // Owned stage on a legacy doc with a null direct-cost total.
    const owned = await seedRaw({ status: 'collecting_owned', costMicros: null });
    const d1 = deps();
    await processorFrom(d1)(fakeJob(owned.payload), 'tok');
    const afterOwned = await ContentAnalysis.findById(owned.analysisId);
    expect(afterOwned?.status).toBe('completed');
    expect(afterOwned?.costMicros).toBe(1_000 + 2_000 + 2_000);

    // SERP stage entered with a null total.
    const serp = await seedRaw({
      status: 'collecting_serp',
      owned: SEED_FACTS,
      stageLedger: [ledgerEntry('collecting_owned', OWNED_HASH)],
      costMicros: null,
    });
    const d2 = deps();
    await processorFrom(d2)(fakeJob(serp.payload), 'tok');
    expect((await ContentAnalysis.findById(serp.analysisId))?.status).toBe('completed');

    // Competitor stage entered with a null total (budget math + accumulation).
    const competitors = await seedRaw({
      status: 'collecting_competitors',
      owned: SEED_FACTS,
      evidence: {
        keyword: SEED_KEYWORD_EVIDENCE,
        serp: SEED_SERP_EVIDENCE,
        competitorUrls: [RIVAL_1],
        competitors: [],
        competitorFailures: [],
      },
      stageLedger: throughSerpLedger(),
      costMicros: null,
    });
    const d3 = deps();
    await processorFrom(d3)(fakeJob(competitors.payload), 'tok');
    const afterCompetitors = await ContentAnalysis.findById(competitors.analysisId);
    expect(afterCompetitors?.status).toBe('completed');
    expect(d3.contentSource.scrapePage).toHaveBeenCalledTimes(1);
  });

  it('treats null AI cost fields as zero across the brief and draft budget gates', async () => {
    const seed = throughScoringSeed();
    const brief = await seedRaw({
      status: 'generating_brief',
      ...seed,
      costMicros: null,
      aiCostMicros: null,
    });
    const d1 = deps();
    await processorFrom(d1)(fakeJob(brief.payload), 'tok');
    const afterBrief = await ContentAnalysis.findById(brief.analysisId);
    expect(afterBrief?.status).toBe('completed');
    expect(afterBrief?.aiCostMicros).toBe(4_000);

    const draft = await seedRaw({
      status: 'generating_draft',
      ...seed,
      brief: {
        versionId: 'v1',
        sections: [],
        text: 'stored brief text',
        citations: [],
        profileVersion: '1.0.0',
        provider: 'fake',
      },
      stageLedger: [...seed.stageLedger, ledgerEntry('generating_brief', BRIEF_HASH)],
      costMicros: null,
      aiCostMicros: null,
    });
    const d2 = deps();
    await processorFrom(d2)(fakeJob(draft.payload), 'tok');
    const afterDraft = await ContentAnalysis.findById(draft.analysisId);
    expect(afterDraft?.status).toBe('completed');
    expect(afterDraft?.aiCostMicros).toBe(2_000);
    expect(d2.ai.run).toHaveBeenCalledTimes(1);
  });

  it('records zero-cost terminal events when the finalized doc lost its accounting fields', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) =>
      real(id as never).then((loaded) =>
        loaded && loaded.status === 'completed'
          ? ({
              status: 'completed',
              idempotencyKey: loaded.idempotencyKey,
              costMicros: undefined,
              aiCostMicros: undefined,
            } as never)
          : loaded,
      )) as never);
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const completed = events.find((e) => e.kind === 'completed');
    expect(completed).toMatchObject({ costMicros: 0, aiCostMicros: 0 });
  });

  it('records a zero-cost failed event when the failed doc lost its accounting fields', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) =>
      real(id as never).then((loaded) =>
        loaded && loaded.status === 'failed'
          ? ({
              status: 'failed',
              idempotencyKey: loaded.idempotencyKey,
              costMicros: undefined,
              aiCostMicros: undefined,
            } as never)
          : loaded,
      )) as never);
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => ({
      document: makeDocument({ markdown: '', title: null, headings: [], structuredData: [] }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const failed = events.find((e) => e.kind === 'failed');
    expect(failed).toMatchObject({ costMicros: 0, aiCostMicros: 0 });
  });

  it('re-runs the owned collection when facts exist without a ledger over an absent ledger array', async () => {
    const seed = await seedRaw({ status: 'collecting_owned', owned: SEED_FACTS });
    // Simulate a legacy doc whose ledger array is missing at read time.
    const real = ContentAnalysis.findById.bind(ContentAnalysis);
    let calls = 0;
    vi.spyOn(ContentAnalysis, 'findById').mockImplementation(((id: unknown) => {
      calls += 1;
      const query = real(id as never);
      if (calls === 1) {
        return query.then((loaded) =>
          loaded
            ? Object.create(loaded, {
                stageLedger: { value: undefined, enumerable: true },
              })
            : loaded,
        );
      }
      return query;
    }) as never);
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => ({
      document: makeDocument({ markdown: '', title: null, headings: [], structuredData: [] }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    await processorFrom(d)(fakeJob(seed.payload), 'tok');
    expect(d.contentSource.scrapePage).toHaveBeenCalledTimes(1);
    expect((await ContentAnalysis.findById(seed.analysisId))?.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

describe('processor — owned snapshot persistence', () => {
  it('skips the snapshot when the sanitized excerpt is empty (usable title-only page)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const d = deps();
    d.contentSource.scrapePage = vi.fn(async () => ({
      document: makeDocument({ markdown: '', headings: [], structuredData: [] }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(await ContentSnapshot.countDocuments({ analysisId: doc._id })).toBe(0);
    expect(after?.providerRefs.snapshotIds).toHaveLength(0);
  });

  it('continues the run when the snapshot write fails (warning only)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    vi.spyOn(ContentSnapshot, 'create').mockRejectedValueOnce(new Error('disk full'));
    const d = deps();
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.providerRefs.snapshotIds).toHaveLength(0);
    expect(d.logger.warn).toHaveBeenCalledWith(
      { analysisId: String(doc._id) },
      expect.stringContaining('snapshot persist failed'),
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism + SEC-REDACT
// ---------------------------------------------------------------------------

describe('processor — determinism and redaction', () => {
  it('produces an identical scorecard across runs with different AI outputs', async () => {
    const scorecards: unknown[] = [];
    for (const flavor of ['first flavor of prose', 'a totally different draft body entirely']) {
      const doc = await ContentAnalysis.create(baseAnalysisInput());
      const d = deps();
      d.ai.run = vi.fn(async (input: { profile: string }) => aiRunResult(input, flavor));
      await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
      const after = await ContentAnalysis.findById(doc._id);
      expect(after?.status).toBe('completed');
      scorecards.push(JSON.parse(JSON.stringify(after?.scorecardV2)));
    }
    expect(scorecards[0]).toEqual(scorecards[1]);
  });

  it('never passes crawled or AI-generated text to the logger (SEC-REDACT)', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const logger = silentLogger();
    const d = deps({
      logger,
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: [RIVAL_1],
          checkedAt: FIXED_NOW,
        })),
      },
    });
    d.contentSource.scrapePage = vi.fn(async ({ url }: { url: string }) => ({
      document: makeDocument({
        markdown:
          url === OWNED_URL
            ? 'Owned page ZZ_CRAWLED_MARKER_ZZ words about the seo audits topic here. '.repeat(5)
            : 'Competitor ZZ_COMPETITOR_MARKER_ZZ prose in the rival document body. '.repeat(5),
        title: url === OWNED_URL ? 'Owned ZZ_CRAWLED_TITLE_ZZ' : 'Rival title',
      }),
      usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
    }));
    d.ai.run = vi.fn(async (input: { profile: string }) =>
      aiRunResult(input, 'Draft with ZZ_AI_MARKER_ZZ inside the generated body.'),
    );
    await processorFrom(d)(fakeJob(payloadFor(doc)), 'tok');
    expect((await ContentAnalysis.findById(doc._id))?.status).toBe('completed');

    const markers = [
      'ZZ_CRAWLED_MARKER_ZZ',
      'ZZ_COMPETITOR_MARKER_ZZ',
      'ZZ_CRAWLED_TITLE_ZZ',
      'ZZ_AI_MARKER_ZZ',
    ];
    for (const method of ['info', 'warn', 'error', 'debug', 'fatal', 'trace'] as const) {
      const calls = (logger[method] as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const serialized = JSON.stringify(calls);
      for (const marker of markers) {
        expect(serialized).not.toContain(marker);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// stripHtmlMarkers
// ---------------------------------------------------------------------------

describe('stripHtmlMarkers', () => {
  it('returns marker-free input untouched', () => {
    expect(stripHtmlMarkers('plain markdown text')).toBe('plain markdown text');
  });

  it('removes script, iframe, and doctype markers in one pass', () => {
    const out = stripHtmlMarkers('a <script>x</script> b <IFRAME></IFRAME> c <!DOCTYPE html> d');
    expect(out).not.toMatch(/<script|<iframe|<!doctype/i);
    expect(out).toContain('a ');
    expect(out).toContain(' d');
  });

  it('resolves nested fragments that rebuild a marker after one pass', () => {
    // Removing the inner '<!doctype' re-forms an outer '<!doctype'.
    const out = stripHtmlMarkers('<!doc<!doctypetype html>');
    expect(out).not.toMatch(/<!doctype/i);
  });

  it('neutralizes angle brackets outright when nesting exceeds the pass budget', () => {
    const depth = 12;
    const nested = `${'<!doc'.repeat(depth)}<!doctype${'type'.repeat(depth)}`;
    const out = stripHtmlMarkers(nested);
    expect(out).not.toMatch(/<script|<iframe|<!doctype/i);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });
});

// ---------------------------------------------------------------------------
// advanceContentAnalysisStage
// ---------------------------------------------------------------------------

describe('advanceContentAnalysisStage', () => {
  it('returns not_found for a missing document', async () => {
    const result = await advanceContentAnalysisStage({
      analysisId: new Types.ObjectId().toString(),
      nextStatus: 'collecting_owned',
    });
    expect(result.outcome).toBe('not_found');
  });

  it('returns terminal (no-op) for a completed analysis', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput({ status: 'completed' }));
    const result = await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_owned',
    });
    expect(result).toEqual({ outcome: 'terminal', status: 'completed' });
  });

  it('is idempotent when asked to advance to the current stage', async () => {
    const doc = await ContentAnalysis.create(
      baseAnalysisInput({ status: 'collecting_owned' }),
    );
    const result = await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_owned',
    });
    expect(result.outcome).toBe('advanced');
    if (result.outcome === 'advanced') {
      expect(result.status).toBe('collecting_owned');
    }
  });

  it('closes out the current stage and appends the next one', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_owned',
    });
    await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_serp',
    });
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('collecting_serp');
    const closed = after!.stages.filter((s) => s.completedAt !== null).length;
    expect(closed).toBeGreaterThanOrEqual(2);
    expect(after!.stages[after!.stages.length - 1]!.name).toBe('collecting_serp');
  });

  it('tolerates a stages array with no open entry for the current status', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput({ stages: [] }));
    const result = await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_owned',
    });
    expect(result.outcome).toBe('advanced');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.stages).toHaveLength(1);
    expect(after?.stages[0]).toMatchObject({ name: 'collecting_owned', completedAt: null });
  });

  it('does not overwrite startedAt on a later stage or a pre-stamped run', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_owned',
    });
    const started1 = (await ContentAnalysis.findById(doc._id))?.startedAt;
    await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'scoring',
    });
    const started2 = (await ContentAnalysis.findById(doc._id))?.startedAt;
    expect(started1?.getTime()).toBe(started2?.getTime());

    const preStamped = new Date('2026-07-01T00:00:00Z');
    const doc2 = await ContentAnalysis.create(baseAnalysisInput({ startedAt: preStamped }));
    await advanceContentAnalysisStage({
      analysisId: doc2._id.toString(),
      nextStatus: 'collecting_owned',
    });
    const after2 = await ContentAnalysis.findById(doc2._id);
    expect(after2?.startedAt?.getTime()).toBe(preStamped.getTime());
  });

  it('invokes the onEnter callback with the loaded doc', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    let called = false;
    await advanceContentAnalysisStage({
      analysisId: doc._id.toString(),
      nextStatus: 'collecting_owned',
      onEnter: (loaded) => {
        called = true;
        loaded.warnings.push({ code: 'from-hook', messageKey: 'x' });
      },
    });
    expect(called).toBe(true);
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.warnings.some((w) => w.code === 'from-hook')).toBe(true);
  });

  it('throws a transition error on a backward move', async () => {
    const doc = await ContentAnalysis.create(
      baseAnalysisInput({ status: 'scoring' }),
    );
    await expect(
      advanceContentAnalysisStage({
        analysisId: doc._id.toString(),
        nextStatus: 'collecting_owned',
      }),
    ).rejects.toThrow(/cannot move/);
  });
});
