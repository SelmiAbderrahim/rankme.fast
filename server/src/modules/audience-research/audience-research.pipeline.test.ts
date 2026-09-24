/**
 * Prompt 10d — pipeline invariants (spec §7).
 *
 * Coverage focus (100% is the enforced gate; each branch has a matching test):
 *   - Discovery: happy path, empty rows, provider quota → unavailable ledger,
 *     provider malformed → provider_error ledger, cost-ceiling stop.
 *   - Selection: zero candidates from safe URL denial.
 *   - Collection: bounded scrape, Firecrawl quota/timeout mid-flight,
 *     content-hash dedupe collapses two rows into one.
 *   - Clustering: successful AI dispatch (cited signals persist), AI
 *     rejection of unknown source ids, AI provider error (partial), AI
 *     dispatch indeterminate crash window, AI cost pre-flight ceiling.
 *   - Zero evidence: `no_usable_public_evidence` finishes `failed`.
 *   - Idempotent replay: terminal doc short-circuit.
 */
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import type {
  ContentSourceProvider,
  ScrapePageResult,
} from '../../shared/providers/content-source.js';
import type {
  PublicPageDiscoveryResult,
  PublicPageDiscoveryRow,
  RankProvider,
} from '../../shared/providers/types.js';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../../shared/providers/errors.js';
import { UnsafeUrlError } from '../../shared/security/url-safety.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import {
  AiInvalidInputError,
  AiMalformedOutputError,
} from '../../shared/providers/ai-generation.js';
import type {
  AiProfileRunner,
  AiProfileRunResult,
} from '../../shared/ai-profiles/index.js';
import { selectCandidates, MAX_CANDIDATES } from './selection.js';
import type * as SelectionModule from './selection.js';
import { AudienceResearchRun } from './audience-research.model.js';
import {
  runAudienceResearchPipeline as runAudienceResearchPipelineImpl,
  AI_CLUSTER_PROFILE_NAME,
  TOTAL_COST_CEILING_MICROS,
  AI_COST_CEILING_MICROS,
  type AudienceResearchPipelineDeps,
} from './audience-research.pipeline.js';

function runAudienceResearchPipeline(
  input: Omit<Parameters<typeof runAudienceResearchPipelineImpl>[0], 'outputLocale'> & {
    outputLocale?: Parameters<typeof runAudienceResearchPipelineImpl>[0]['outputLocale'];
  },
  deps: Parameters<typeof runAudienceResearchPipelineImpl>[1],
) {
  return runAudienceResearchPipelineImpl(
    { ...input, outputLocale: input.outputLocale ?? 'en' },
    deps,
  );
}

vi.mock('./selection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SelectionModule>();
  return { ...actual, selectCandidates: vi.fn(actual.selectCandidates) };
});

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

function stubRankProvider(fn: (input: unknown) => Promise<PublicPageDiscoveryResult>): RankProvider {
  return {
    async checkRank() { throw new Error('unused'); },
    async checkLocalPackRank() { throw new Error('unused'); },
    async checkAltEngineRank() {
      throw new Error('unused: alt-engine rank checks are not exercised in this suite');
    },
    async searchPublicPages(input) { return fn(input); },
  } as RankProvider;
}

function stubContentSource(scrapes: Record<string, ScrapePageResult | Error>): ContentSourceProvider {
  return {
    async scrapePage(input) {
      const key = Object.keys(scrapes).find((k) => input.url.includes(k)) ?? '*';
      const entry = scrapes[key] ?? scrapes['*'];
      if (entry instanceof Error) throw entry;
      if (!entry) throw new VendorMalformedError('no fixture', { provider: 'fake', operation: 'scrape' });
      return entry;
    },
    async crawlSite() { throw new Error('unused'); },
  } as ContentSourceProvider;
}

function stubAiRunner(
  fn: (input: unknown) => Promise<AiProfileRunResult<{ signals: Array<Record<string, unknown>>; citations: string[] }>>,
): AiProfileRunner {
  return {
    preflight() { /* no-op */ },
    async run<T extends object>(input: { profile: string }) {
      expect(input.profile).toBe(AI_CLUSTER_PROFILE_NAME);
      return (await fn(input)) as unknown as AiProfileRunResult<T>;
    },
  } as unknown as AiProfileRunner;
}

function makeScrapeResult(url: string, text: string): ScrapePageResult {
  return {
    document: {
      sourceUrl: url,
      statusCode: 200,
      title: 'example',
      description: null,
      canonical: url,
      robots: [],
      language: 'en',
      markdown: text,
      text,
      headings: [],
      links: [],
      structuredData: [],
      contentHash: createHash('sha256').update(`${url}|${text}`).digest('hex'),
      capturedAt: new Date(),
    },
    usage: {
      credits: 1,
      estimatedCostMicros: 2_000n,
      estimated: true,
    },
  };
}

function makeDiscoveryRow(overrides: Partial<PublicPageDiscoveryRow> = {}): PublicPageDiscoveryRow {
  return {
    queryId: 'q-001',
    canonicalUrl: 'https://forum.example.com/post-1',
    title: 'Public post 1',
    organicPosition: 1,
    observedAt: new Date().toISOString(),
    sourceTypeHint: 'forum',
    observationMeta: {
      sourceKind: 'provider_observation',
      sourceLabel: 'fake',
      observedAt: new Date().toISOString(),
      freshUntil: null,
      freshness: 'fresh',
      market: null,
      sampleCount: 1,
      coverageNoteKey: null,
    },
    ...overrides,
  };
}

async function seedRun(overrides: Record<string, unknown> = {}) {
  const accountId = new Types.ObjectId();
  const siteId = new Types.ObjectId();
  const doc = await AudienceResearchRun.create({
    accountId,
    siteId,
    state: 'queued',
    input: {
      outputLocale: 'en',
      siteMarket: { country: 'US', language: 'en', device: 'desktop' as const },
      competitorDomains: ['competitor.com'],
      seedTopics: ['seo audit'],
      queryTemplateVersion: 1,
    },
    deterministicInputHash: 'x'.repeat(64),
    sources: [],
    signals: [],
    costLedger: [],
    requestedAt: new Date(),
    ...overrides,
  });
  return { runId: String(doc._id), accountId: String(accountId), siteId: String(siteId), doc };
}

const skipUrlSafety = async () => {
  /* accept every URL in tests */
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Baseline dependency set; every test overrides only what it exercises. */
function deps(
  overrides: Partial<AudienceResearchPipelineDeps> = {},
): AudienceResearchPipelineDeps {
  const base: AudienceResearchPipelineDeps = {
    rankProvider: stubRankProvider(async () => ({ rows: [] })),
    contentSource: stubContentSource({}),
    aiRunner: stubAiRunner(async () => {
      throw new Error('AI must not be dispatched in this scenario');
    }),
    aiProviderOrder: ['fake'],
    logger: silentLogger,
    urlSafety: skipUrlSafety,
  };
  return { ...base, ...overrides };
}

/** Same baseline, but with the real `assertPublicUrlSafe` authority in play. */
function depsWithRealUrlSafety(
  overrides: Partial<AudienceResearchPipelineDeps> = {},
): AudienceResearchPipelineDeps {
  const full = deps(overrides);
  delete (full as { urlSafety?: unknown }).urlSafety;
  return full;
}

/** Freeform AI stub — lets a test emit a provenance/output shape off-contract. */
function stubAiRawRunner(fn: () => Promise<unknown>): AiProfileRunner {
  return {
    preflight() {
      /* no-op */
    },
    async run() {
      return (await fn()) as never;
    },
  } as unknown as AiProfileRunner;
}

function aiResult(
  signals: Array<Record<string, unknown>>,
  provenanceOverrides: Record<string, unknown> = {},
): AiProfileRunResult<{ signals: Array<Record<string, unknown>>; citations: string[] }> {
  return {
    trust: 'untrusted' as const,
    status: 'complete' as const,
    object: { signals, citations: [] },
    warnings: [],
    qualityFlags: ['complete' as const],
    provenance: {
      task: AI_CLUSTER_PROFILE_NAME,
      profileVersion: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 'audience-research-cluster',
      promptTemplateVersion: '1',
      provider: 'fake',
      model: 'fake',
      finishReason: 'stop',
      attempts: 1,
      fallbackUsed: false,
      latencyMs: 1,
      actualOrEstimatedCostMicros: 1_000n,
      ...provenanceOverrides,
    },
    classification: {
      generatedFields: 'untrusted' as const,
      renderAs: 'text_only' as const,
    },
  } as AiProfileRunResult<{ signals: Array<Record<string, unknown>>; citations: string[] }>;
}

/**
 * Replace the Nth `findById` of a run with a fixed value, leaving every other
 * lookup real. The pipeline re-reads the run once per stage advance (plus once
 * for the AI reload and once at finalize), so this is the seam that reproduces
 * a run vanishing, turning terminal, or arriving without an evidence list
 * partway through a job — none of which a persisted fixture can express.
 */
function stubFindByIdOnCall(nth: number, value: unknown): void {
  const original = AudienceResearchRun.findById.bind(AudienceResearchRun) as (
    id: unknown,
  ) => unknown;
  let calls = 0;
  vi.spyOn(AudienceResearchRun, 'findById').mockImplementation(((id: unknown) => {
    calls += 1;
    if (calls === nth) return Promise.resolve(value);
    return original(id);
  }) as never);
}

/** A stage document the pipeline can advance without touching persistence. */
function stageDoc(overrides: Record<string, unknown> = {}) {
  return {
    state: 'queued',
    startedAt: null,
    input: {},
    async save() {
      /* the real row is untouched by this stub */
    },
    ...overrides,
  };
}

function terminalDoc(state: 'completed' | 'partial' | 'failed', reasonCode: string) {
  return { state, terminal: { reasonCode }, sources: [], signals: [] };
}

function makeScrapeFor(url: string, text: string): ScrapePageResult {
  return makeScrapeResult(url, text);
}

function everyUrlScrapes(): ContentSourceProvider {
  return {
    async scrapePage(input) {
      return makeScrapeFor(input.url, `evidence for ${input.url}`);
    },
    async crawlSite() {
      throw new Error('unused');
    },
  } as ContentSourceProvider;
}

describe('runAudienceResearchPipeline', () => {
  it('passes all seven frozen locales to clustering and preserves evidence excerpts', async () => {
    const seen: Array<{ locale: string; input: unknown }> = [];
    for (const outputLocale of SUPPORTED_LOCALES) {
      const { runId, accountId, siteId } = await seedRun({
        input: {
          outputLocale,
          siteMarket: { country: 'US', language: 'en', device: 'desktop' },
          competitorDomains: ['competitor.com'],
          seedTopics: ['seo audit'],
          queryTemplateVersion: 1,
        },
      });
      const discoveryRow = makeDiscoveryRow({
        canonicalUrl: `https://forum.example.com/${outputLocale}`,
      });
      const scrape = makeScrapeResult(
        discoveryRow.canonicalUrl,
        `SOURCE_EXCERPT_${outputLocale}`,
      );
      const aiRunner = stubAiRunner(async (profileInput) => {
        const typed = profileInput as { locale: string; input: unknown };
        seen.push({ locale: typed.locale, input: typed.input });
        return aiResult([
          {
            type: 'complaint',
            title: `Generated ${outputLocale}`,
            summary: `Generated summary ${outputLocale}`,
            suggestedRoute: 'content',
            citedSourceIds: ['src-001'],
          },
        ]);
      });
      await runAudienceResearchPipeline(
        { runId, accountId, siteId, outputLocale },
        {
          rankProvider: stubRankProvider(async () => ({ rows: [discoveryRow] })),
          contentSource: stubContentSource({ [discoveryRow.canonicalUrl]: scrape }),
          aiRunner,
          aiProviderOrder: ['fake'],
          logger: silentLogger,
          urlSafety: skipUrlSafety,
        },
      );
    }

    expect(seen.map((entry) => entry.locale)).toEqual(SUPPORTED_LOCALES);
    for (const outputLocale of SUPPORTED_LOCALES) {
      expect(JSON.stringify(seen.find((entry) => entry.locale === outputLocale)?.input)).toContain(
        `SOURCE_EXCERPT_${outputLocale}`,
      );
    }
  });

  it('rejects an active run when the job locale differs from its frozen locale', async () => {
    const { runId, accountId, siteId } = await seedRun();

    await expect(
      runAudienceResearchPipeline(
        { runId, accountId, siteId, outputLocale: 'fr' },
        deps(),
      ),
    ).rejects.toThrow('audience-research pipeline: invalid frozen output locale');
  });

  it('is a no-op on a terminal replay', async () => {
    const { runId, accountId, siteId } = await seedRun({
      state: 'completed',
      terminal: { state: 'completed', reasonCode: 'ok', completedAt: new Date() },
    });
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [] })),
        contentSource: stubContentSource({}),
        aiRunner: stubAiRunner(async () => { throw new Error('unused'); }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(result.terminal).toBe('completed');
  });

  it('fails a zero-discovery run with no_usable_public_evidence', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [] })),
        contentSource: stubContentSource({}),
        aiRunner: stubAiRunner(async () => { throw new Error('unused'); }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('hands the discovery provider a PLAIN siteMarket, never the Mongoose subdocument', async () => {
    // Provider inputs are parsed by strict zod schemas. Passing the hydrated
    // subdocument straight through leaks `$__`, `_doc`, `save`, … as own
    // properties, every one of which is an unrecognized key — the shipped
    // fake provider rejected the call and the job dead-lettered before a
    // single query ran.
    const { runId, accountId, siteId } = await seedRun();
    let received: unknown;
    const rankProvider = stubRankProvider(async (input) => {
      received = (input as { siteMarket: unknown }).siteMarket;
      return { rows: [] };
    });
    await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider,
        contentSource: stubContentSource({}),
        aiRunner: stubAiRunner(async () => {
          throw new Error('unreachable — discovery returns no rows');
        }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(Object.getPrototypeOf(received)).toBe(Object.prototype);
    expect(Object.keys(received as object).sort()).toEqual([
      'city',
      'country',
      'device',
      'language',
      'region',
    ]);
    expect(JSON.stringify(received)).not.toMatch(/\$__|_doc/);
  });

  it('completes with cited signals when AI dispatch succeeds', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const discoveryRow = makeDiscoveryRow();
    const scrape = makeScrapeResult(discoveryRow.canonicalUrl, 'Users complain the pricing page is confusing.');
    const rankProvider = stubRankProvider(async () => ({ rows: [discoveryRow] }));
    const contentSource = stubContentSource({ [discoveryRow.canonicalUrl]: scrape });
    const aiRunner = stubAiRunner(async () => ({
      trust: 'untrusted',
      status: 'complete',
      object: {
        signals: [
          {
            type: 'complaint',
            title: 'Pricing page confusion',
            summary: 'Users report pricing page is confusing.',
            suggestedRoute: 'content',
            citedSourceIds: ['src-001'],
          },
        ],
        citations: ['src-001'],
      },
      warnings: [],
      qualityFlags: ['complete'],
      provenance: {
        task: AI_CLUSTER_PROFILE_NAME,
        profileVersion: '1.0.0',
        outputSchemaVersion: '1',
        promptTemplateId: 'audience-research-cluster',
        promptTemplateVersion: '1',
        provider: 'fake',
        model: 'fake',
        finishReason: 'stop',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 10,
        actualOrEstimatedCostMicros: 2_500n,
      },
      classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
    }));

    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      { rankProvider, contentSource, aiRunner, aiProviderOrder: ['fake'], logger: silentLogger, urlSafety: skipUrlSafety },
    );
    expect(result.terminal).toBe('completed');
    expect(result.signalCount).toBe(1);
  });

  it('completes evidence-only when AI drops every signal for unknown source ids', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const discoveryRow = makeDiscoveryRow();
    const scrape = makeScrapeResult(discoveryRow.canonicalUrl, 'complaint about setup');
    const aiRunner = stubAiRunner(async () => ({
      trust: 'untrusted',
      status: 'complete',
      object: {
        signals: [
          {
            type: 'complaint',
            title: 'ghost',
            summary: 'no cited real source id',
            suggestedRoute: 'content',
            // Unknown id — pipeline strips this signal entirely.
            citedSourceIds: ['src-999'],
          },
        ],
        citations: [],
      },
      warnings: [],
      qualityFlags: ['complete'],
      provenance: {
        task: AI_CLUSTER_PROFILE_NAME,
        profileVersion: '1.0.0',
        outputSchemaVersion: '1',
        promptTemplateId: 'audience-research-cluster',
        promptTemplateVersion: '1',
        provider: 'fake',
        model: 'fake',
        finishReason: 'stop',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 5,
        actualOrEstimatedCostMicros: 1_500n,
      },
      classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
    }));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [discoveryRow] })),
        contentSource: stubContentSource({ [discoveryRow.canonicalUrl]: scrape }),
        aiRunner,
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(result.terminal).toBe('completed');
    expect(result.signalCount).toBe(0);
    expect(result.sourceCount).toBe(1);
  });

  it('finishes partial with `processing_failure` on AI runtime outage after at least one source', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const discoveryRow = makeDiscoveryRow();
    const scrape = makeScrapeResult(discoveryRow.canonicalUrl, 'evidence');
    const aiRunner = stubAiRunner(async () => {
      throw new Error('provider outage');
    });
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [discoveryRow] })),
        contentSource: stubContentSource({ [discoveryRow.canonicalUrl]: scrape }),
        aiRunner,
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(result.terminal).toBe('partial');
    expect(result.sourceCount).toBe(1);
  });

  it('finishes partial with `ai_dispatch_indeterminate` after a crash-window replay', async () => {
    const { runId, accountId, siteId, doc } = await seedRun();
    // Pre-stamp `claimedAt` without `resolvedAt` — simulates a crashed prior
    // attempt that already dispatched (or may have dispatched) but never
    // wrote the resolution row.
    await AudienceResearchRun.updateOne(
      { _id: doc._id },
      {
        $set: {
          'aiClustering.claimedAt': new Date(Date.now() - 60_000),
          'aiClustering.idempotencyKey': 'ambiguous',
        },
      },
    );
    const discoveryRow = makeDiscoveryRow();
    const scrape = makeScrapeResult(discoveryRow.canonicalUrl, 'evidence');
    const aiCalls = { count: 0 };
    const aiRunner = stubAiRunner(async () => {
      aiCalls.count += 1;
      return {
        trust: 'untrusted', status: 'complete',
        object: { signals: [], citations: [] },
        warnings: [], qualityFlags: ['complete'],
        provenance: {
          task: AI_CLUSTER_PROFILE_NAME,
          profileVersion: '1.0.0',
          outputSchemaVersion: '1',
          promptTemplateId: 'audience-research-cluster',
          promptTemplateVersion: '1',
          provider: 'fake', model: 'fake', finishReason: 'stop',
          attempts: 1, fallbackUsed: false, latencyMs: 1,
          actualOrEstimatedCostMicros: 0n,
        },
        classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
      };
    });
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [discoveryRow] })),
        contentSource: stubContentSource({ [discoveryRow.canonicalUrl]: scrape }),
        aiRunner,
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('ai_dispatch_indeterminate');
    // Crash-safety proof: NO second AI dispatch fired.
    expect(aiCalls.count).toBe(0);
  });

  it('bounds discovery cost by the total ceiling', async () => {
    const { runId, accountId, siteId } = await seedRun();
    // Deliberately push a large existing actual so the discovery pre-flight
    // ceiling check trips.
    await AudienceResearchRun.updateOne(
      { _id: new Types.ObjectId(runId) },
      {
        $push: {
          costLedger: {
            stage: 'discovery',
            operationCounts: {},
            estimatedCostMicros: TOTAL_COST_CEILING_MICROS,
            actualCostMicros: TOTAL_COST_CEILING_MICROS,
            startedAt: new Date(),
            endedAt: new Date(),
            outcome: 'ok',
          },
        },
      },
    );
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => {
          throw new Error('should not call rank provider when ceiling is exhausted');
        }),
        contentSource: stubContentSource({}),
        aiRunner: stubAiRunner(async () => { throw new Error('unused'); }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    // Zero rows + ceiling stop → the pipeline terminates `failed` with
    // `no_usable_public_evidence`.
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('bounds AI dispatch by the AI sub-budget', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const discoveryRow = makeDiscoveryRow();
    const scrape = makeScrapeResult(discoveryRow.canonicalUrl, 'evidence');
    // Push aiSoFar over the ceiling by pre-writing a cluster ledger entry.
    await AudienceResearchRun.updateOne(
      { _id: new Types.ObjectId(runId) },
      {
        $push: {
          costLedger: {
            stage: 'cluster',
            operationCounts: { 'ai.cluster': 1 },
            estimatedCostMicros: AI_COST_CEILING_MICROS,
            actualCostMicros: AI_COST_CEILING_MICROS,
            startedAt: new Date(),
            endedAt: new Date(),
            outcome: 'ok',
          },
        },
      },
    );
    let aiCalls = 0;
    const aiRunner = stubAiRunner(async () => {
      aiCalls += 1;
      throw new Error('should not dispatch when AI budget is exhausted');
    });
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [discoveryRow] })),
        contentSource: stubContentSource({ [discoveryRow.canonicalUrl]: scrape }),
        aiRunner,
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(aiCalls).toBe(0);
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('cost_ceiling_partial');
  });

  it('skips SSRF-blocked candidate URLs silently (never fetch)', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const discoveryRow = makeDiscoveryRow();
    const scrape = makeScrapeResult(discoveryRow.canonicalUrl, 'evidence');
    let scraped = 0;
    const contentSource: ContentSourceProvider = {
      async scrapePage() {
        scraped += 1;
        return scrape;
      },
      async crawlSite() { throw new Error('unused'); },
    };
    // Reject every URL.
    const denyAll = async () => {
      throw Object.assign(new Error('unsafe'), { name: 'UnsafeUrlError' });
    };
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [discoveryRow] })),
        contentSource,
        aiRunner: stubAiRunner(async () => { throw new Error('unused'); }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: denyAll,
      },
    );
    expect(scraped).toBe(0);
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('flags provider vendor errors mid-collect as `unavailable` and finishes partial', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const rows = [
      makeDiscoveryRow(),
      makeDiscoveryRow({ canonicalUrl: 'https://forum.example.com/post-2', queryId: 'q-002' }),
    ];
    const scrapes: Record<string, ScrapePageResult | Error> = {
      'post-1': makeScrapeResult(rows[0]!.canonicalUrl, 'evidence one'),
      'post-2': new VendorQuotaError('quota', { provider: 'firecrawl', operation: 'scrape' }),
    };
    const aiRunner = stubAiRunner(async () => ({
      trust: 'untrusted', status: 'complete',
      object: { signals: [], citations: [] },
      warnings: [], qualityFlags: ['complete'],
      provenance: {
        task: AI_CLUSTER_PROFILE_NAME,
        profileVersion: '1.0.0',
        outputSchemaVersion: '1',
        promptTemplateId: 'audience-research-cluster',
        promptTemplateVersion: '1',
        provider: 'fake', model: 'fake', finishReason: 'stop',
        attempts: 1, fallbackUsed: false, latencyMs: 1,
        actualOrEstimatedCostMicros: 0n,
      },
      classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
    }));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows })),
        contentSource: stubContentSource(scrapes),
        aiRunner,
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    // At least one source retained; collect vendor outage → partial per §7.5.
    expect(result.sourceCount).toBe(1);
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('cost_ceiling_partial');
  });

  it('terminal replay: rerunning after terminal leaves the run untouched', async () => {
    const { runId, accountId, siteId } = await seedRun();
    // First run: forced failure.
    await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [] })),
        contentSource: stubContentSource({}),
        aiRunner: stubAiRunner(async () => { throw new Error('unused'); }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    // Second run: terminal replay.
    const second = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      {
        rankProvider: stubRankProvider(async () => ({ rows: [] })),
        contentSource: stubContentSource({}),
        aiRunner: stubAiRunner(async () => { throw new Error('unused'); }),
        aiProviderOrder: ['fake'],
        logger: silentLogger,
        urlSafety: skipUrlSafety,
      },
    );
    expect(second.terminal).toBe('failed');
    expect(second.reasonCode).toBe('no_usable_public_evidence');
    const doc = await AudienceResearchRun.findById(runId);
    expect(doc?.state).toBe('failed');
  });
});

async function ledgerFor(runId: string, stage: 'discovery' | 'collect' | 'cluster') {
  const doc = await AudienceResearchRun.findById(runId);
  return (doc?.costLedger ?? []).find((entry) => entry.stage === stage);
}

describe('discovery stage', () => {
  it('never calls the vendor when the templates produce no queries', async () => {
    const { runId, accountId, siteId } = await seedRun();
    // A run whose stored input carries neither seed topics nor competitor
    // domains generates zero queries — the vendor must not be touched.
    stubFindByIdOnCall(1, stageDoc());
    let searched = 0;
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => {
          searched += 1;
          return { rows: [] };
        }),
      }),
    );
    expect(searched).toBe(0);
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('projects a missing site market onto the neutral provider contract', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(1, stageDoc({ input: { seedTopics: ['seo audit'], competitorDomains: [] } }));
    let received: unknown;
    await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async (input) => {
          received = (input as { siteMarket: unknown }).siteMarket;
          return { rows: [] };
        }),
      }),
    );
    expect(received).toEqual({
      country: '',
      region: null,
      city: null,
      language: '',
      device: 'all',
    });
  });

  it.each<[string, () => Error]>([
    ['quota', () => new VendorQuotaError('quota', { provider: 'dataforseo', operation: 'serp' })],
    ['timeout', () => new VendorTimeoutError('timeout', { provider: 'dataforseo', operation: 'serp' })],
    [
      'unavailable',
      () => new VendorUnavailableError('503', { provider: 'dataforseo', operation: 'serp' }),
    ],
  ])('records a discovery %s outage as an `unavailable` ledger row', async (_label, make) => {
    const { runId, accountId, siteId } = await seedRun();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => {
          throw make();
        }),
      }),
    );
    expect(result.terminal).toBe('failed');
    // A vendor outage must NOT masquerade as "no usable public evidence".
    expect(result.reasonCode).toBe('processing_failure');
    expect((await ledgerFor(runId, 'discovery'))?.outcome).toBe('unavailable');
  });

  it('records a malformed discovery payload as a `provider_error` ledger row and fails as processing_failure', async () => {
    // Production regression 2026-07-20 (run 6a5e06bc46704176c0820eb6): a
    // vendor contract failure at discovery surfaced to the user as
    // `no_usable_public_evidence` — a false "your niche has no evidence".
    const { runId, accountId, siteId } = await seedRun();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => {
          throw new VendorMalformedError('bad shape', {
            provider: 'dataforseo',
            operation: 'serp',
          });
        }),
      }),
    );
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('processing_failure');
    expect((await ledgerFor(runId, 'discovery'))?.outcome).toBe('provider_error');
  });

  it('dead-letters the job when the run vanishes before discovery starts', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(1, null);
    await expect(
      runAudienceResearchPipeline({ runId, accountId, siteId }, deps()),
    ).rejects.toThrow(/vanished mid-run/);
  });

  it('mirrors a run another worker finalized before discovery starts', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(1, terminalDoc('partial', 'ai_dispatch_indeterminate'));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('ai_dispatch_indeterminate');
  });

  it('resumes a re-delivered job already parked on the discovering stage', async () => {
    const { runId, accountId, siteId } = await seedRun({ state: 'discovering' });
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result.terminal).toBe('failed');
    // The stage was not re-entered, so `startedAt` was never stamped.
    const doc = await AudienceResearchRun.findById(runId);
    expect(doc?.startedAt).toBeNull();
  });

  it('propagates an unclassified discovery failure to the queue', async () => {
    const { runId, accountId, siteId } = await seedRun();
    await expect(
      runAudienceResearchPipeline(
        { runId, accountId, siteId },
        deps({
          rankProvider: stubRankProvider(async () => {
            throw new Error('kernel panic');
          }),
        }),
      ),
    ).rejects.toThrow('kernel panic');
  });
});

describe('selection stage', () => {
  it('finishes without evidence when selection retains no candidate', async () => {
    const { runId, accountId, siteId } = await seedRun();
    vi.mocked(selectCandidates).mockReturnValueOnce([]);
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({ rankProvider: stubRankProvider(async () => ({ rows: [makeDiscoveryRow()] })) }),
    );
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('degrades to `processing_failure` when the run vanishes before selecting', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(2, null);
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({ rankProvider: stubRankProvider(async () => ({ rows: [makeDiscoveryRow()] })) }),
    );
    expect(result).toEqual({
      terminal: 'failed',
      reasonCode: 'processing_failure',
      sourceCount: 0,
      signalCount: 0,
    });
  });

  it('mirrors a run another worker finalized before selecting', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(2, terminalDoc('partial', 'cost_ceiling_partial'));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({ rankProvider: stubRankProvider(async () => ({ rows: [makeDiscoveryRow()] })) }),
    );
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('cost_ceiling_partial');
  });
});

describe('collect stage', () => {
  const singleRow = () => makeDiscoveryRow();

  it('stops before a scrape whose worst case would eat the AI sub-budget', async () => {
    const { runId, accountId, siteId } = await seedRun();
    await AudienceResearchRun.updateOne(
      { _id: new Types.ObjectId(runId) },
      {
        $push: {
          costLedger: {
            stage: 'discovery',
            operationCounts: {},
            estimatedCostMicros: 108_000,
            actualCostMicros: 108_000,
            startedAt: new Date(),
            endedAt: new Date(),
            outcome: 'ok',
          },
        },
      },
    );
    let scraped = 0;
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [singleRow()] })),
        contentSource: {
          async scrapePage() {
            scraped += 1;
            throw new Error('must not scrape past the ceiling');
          },
          async crawlSite() {
            throw new Error('unused');
          },
        } as ContentSourceProvider,
      }),
    );
    expect(scraped).toBe(0);
    expect((await ledgerFor(runId, 'collect'))?.outcome).toBe('ceiling_stop');
    expect(result.terminal).toBe('failed');
  });

  it.each<[string, () => Error]>([
    ['timeout', () => new VendorTimeoutError('slow', { provider: 'firecrawl', operation: 'scrape' })],
    [
      'unavailable',
      () => new VendorUnavailableError('502', { provider: 'firecrawl', operation: 'scrape' }),
    ],
  ])('halts collection on a Firecrawl %s and keeps what it already has', async (_label, make) => {
    const { runId, accountId, siteId } = await seedRun();
    const rows = [
      makeDiscoveryRow(),
      makeDiscoveryRow({ canonicalUrl: 'https://forum.example.com/post-2', queryId: 'q-002' }),
    ];
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows })),
        contentSource: stubContentSource({
          'post-1': makeScrapeResult(rows[0]!.canonicalUrl, 'evidence one'),
          'post-2': make(),
        }),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    expect(result.sourceCount).toBe(1);
    expect((await ledgerFor(runId, 'collect'))?.outcome).toBe('unavailable');
  });

  it('reports a vendor outage that left zero sources as processing_failure, not missing evidence', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const row = singleRow();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: new VendorUnavailableError('502', {
            provider: 'firecrawl',
            operation: 'scrape',
          }),
        }),
      }),
    );
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('processing_failure');
  });

  it('skips a single malformed scrape and keeps collecting', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const rows = [
      makeDiscoveryRow(),
      makeDiscoveryRow({ canonicalUrl: 'https://forum.example.com/post-2', queryId: 'q-002' }),
    ];
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows })),
        contentSource: stubContentSource({
          'post-1': new VendorMalformedError('bad body', {
            provider: 'firecrawl',
            operation: 'scrape',
          }),
          'post-2': makeScrapeResult(rows[1]!.canonicalUrl, 'evidence two'),
        }),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    expect(result.sourceCount).toBe(1);
    expect(result.terminal).toBe('completed');
  });

  it('propagates an unclassified scrape failure to the queue', async () => {
    const { runId, accountId, siteId } = await seedRun();
    await expect(
      runAudienceResearchPipeline(
        { runId, accountId, siteId },
        deps({
          rankProvider: stubRankProvider(async () => ({ rows: [singleRow()] })),
          contentSource: stubContentSource({ '*': new Error('socket reset') }),
        }),
      ),
    ).rejects.toThrow('socket reset');
  });

  it('bills the configured per-page estimate when the vendor reports no usage', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const row = singleRow();
    const complete = makeScrapeResult(row.canonicalUrl, 'evidence');
    const scrape = { document: complete.document } as unknown as ScrapePageResult;
    await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({ [row.canonicalUrl]: scrape }),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    expect((await ledgerFor(runId, 'collect'))?.actualCostMicros).toBe(3_000);
  });

  it('falls back to markdown, and derives a hash, when the vendor omits them', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const row = singleRow();
    const complete = makeScrapeResult(row.canonicalUrl, 'markdown only evidence');
    const document: Record<string, unknown> = { ...complete.document };
    delete document.text;
    delete document.contentHash;
    const scrape = {
      document,
      usage: complete.usage,
    } as unknown as ScrapePageResult;
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({ [row.canonicalUrl]: scrape }),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    expect(result.sourceCount).toBe(1);
    const doc = await AudienceResearchRun.findById(runId);
    expect(doc?.sources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc?.sources[0]?.excerpt).toContain('markdown only evidence');
  });

  it('retains nothing from a scrape that returned no document at all', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const row = singleRow();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: { usage: { credits: 1, estimatedCostMicros: 10n, estimated: true } } as ScrapePageResult,
        }),
      }),
    );
    expect(result.sourceCount).toBe(0);
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('synthesizes provenance for a discovery row that carried none', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const bare: Record<string, unknown> = { ...makeDiscoveryRow() };
    delete bare.observationMeta;
    const row = bare as unknown as PublicPageDiscoveryRow;
    await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({ [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence') }),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    const doc = await AudienceResearchRun.findById(runId);
    expect(doc?.sources[0]?.observationMeta).toMatchObject({
      sourceKind: 'vendor',
      freshness: 'unknown',
      sampleCount: 1,
    });
  });

  it('stops collecting at the candidate ceiling', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const rows: PublicPageDiscoveryRow[] = [];
    for (let domain = 0; domain < 8; domain += 1) {
      for (let page = 0; page < 3; page += 1) {
        rows.push(
          makeDiscoveryRow({
            queryId: 'q-001',
            // Distinct registrable domains — the selector caps how many
            // candidates one domain may contribute.
            canonicalUrl: `https://forum.example-${domain}.com/post-${page}`,
            title: `Post ${domain}-${page}`,
            organicPosition: domain * 3 + page + 1,
          }),
        );
      }
    }
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows })),
        contentSource: everyUrlScrapes(),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    expect(result.sourceCount).toBe(MAX_CANDIDATES);
  });

  it('skips a candidate the real URL-safety authority refuses', async () => {
    const { runId, accountId, siteId } = await seedRun();
    let scraped = 0;
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      depsWithRealUrlSafety({
        rankProvider: stubRankProvider(async () => ({
          rows: [makeDiscoveryRow({ canonicalUrl: 'https://169.254.169.254/latest/meta-data' })],
        })),
        contentSource: {
          async scrapePage() {
            scraped += 1;
            throw new Error('must never fetch a blocked host');
          },
          async crawlSite() {
            throw new Error('unused');
          },
        } as ContentSourceProvider,
      }),
    );
    expect(scraped).toBe(0);
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('skips a candidate whose safety check fails with a typed UnsafeUrlError', async () => {
    const { runId, accountId, siteId } = await seedRun();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [makeDiscoveryRow()] })),
        contentSource: everyUrlScrapes(),
        urlSafety: async () => {
          throw new UnsafeUrlError('blocked host');
        },
      }),
    );
    expect(result.sourceCount).toBe(0);
  });

  it('degrades to `processing_failure` when the run vanishes before collecting', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(3, null);
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({ rankProvider: stubRankProvider(async () => ({ rows: [makeDiscoveryRow()] })) }),
    );
    expect(result.reasonCode).toBe('processing_failure');
  });

  it('mirrors a run another worker finalized before collecting', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(3, terminalDoc('completed', 'ok'));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({ rankProvider: stubRankProvider(async () => ({ rows: [makeDiscoveryRow()] })) }),
    );
    expect(result.terminal).toBe('completed');
  });
});

describe('clustering stage', () => {
  async function runToClustering(
    overrides: Partial<AudienceResearchPipelineDeps>,
    seedOverrides: Record<string, unknown> = {},
  ) {
    const seeded = await seedRun(seedOverrides);
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
        ...overrides,
      }),
    );
    return { ...seeded, result };
  }

  it('finishes indeterminate when the claimed run disappears before the reload', async () => {
    const seeded = await seedRun();
    await AudienceResearchRun.updateOne(
      { _id: seeded.doc._id },
      { $set: { 'aiClustering.claimedAt': new Date() } },
    );
    stubFindByIdOnCall(5, null);
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
      }),
    );
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('ai_dispatch_indeterminate');
  });

  it('mirrors an already-resolved clustering pass instead of dispatching again', async () => {
    const seeded = await seedRun();
    await AudienceResearchRun.updateOne(
      { _id: seeded.doc._id },
      {
        $set: {
          'aiClustering.claimedAt': new Date(),
          'aiClustering.resolvedAt': new Date(),
          'aiClustering.resultDigest': 'f'.repeat(64),
          signals: [
            {
              signalId: 'sig-001',
              type: 'complaint',
              title: 'Already resolved',
              summary: 'Persisted by the prior attempt.',
              suggestedRoute: 'content',
              citedSourceIds: ['src-001'],
              independentDomainCount: 1,
              sourceTypeCount: 1,
              mostRecentSourceObservedAt: '2026-01-01T00:00:00.000Z',
              confidence: 'high',
            },
          ],
        },
      },
    );
    let dispatched = 0;
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
        aiRunner: stubAiRawRunner(async () => {
          dispatched += 1;
          return aiResult([]);
        }),
      }),
    );
    expect(dispatched).toBe(0);
    expect(result.terminal).toBe('completed');
    expect(result.signalCount).toBe(1);
  });

  it('mirrors a resolved pass whose persisted signal predates the current fields', async () => {
    const seeded = await seedRun();
    await AudienceResearchRun.updateOne(
      { _id: seeded.doc._id },
      { $set: { 'aiClustering.claimedAt': new Date() } },
    );
    stubFindByIdOnCall(5, {
      aiClustering: { resolvedAt: new Date() },
      signals: [
        {
          signalId: 'sig-001',
          type: 'complaint',
          title: 'Sparse signal',
          summary: 'Persisted before the confidence columns existed.',
          suggestedRoute: 'content',
          confidence: 'low',
        },
      ],
    });
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
      }),
    );
    expect(result.terminal).toBe('completed');
    const doc = await AudienceResearchRun.findById(seeded.runId);
    expect(doc?.signals[0]).toMatchObject({
      signalId: 'sig-001',
      citedSourceIds: [],
      independentDomainCount: 0,
      sourceTypeCount: 0,
      mostRecentSourceObservedAt: null,
    });
  });

  it('mirrors a resolved pass that produced no signals at all', async () => {
    const seeded = await seedRun();
    await AudienceResearchRun.updateOne(
      { _id: seeded.doc._id },
      { $set: { 'aiClustering.claimedAt': new Date() } },
    );
    stubFindByIdOnCall(5, { aiClustering: { resolvedAt: new Date() } });
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
      }),
    );
    expect(result.terminal).toBe('completed');
    expect(result.signalCount).toBe(0);
  });

  it.each<[string, () => Error]>([
    ['malformed output', () => new AiMalformedOutputError()],
    ['invalid input', () => new AiInvalidInputError()],
  ])('finishes partial when the AI runtime rejects the request (%s)', async (_label, make) => {
    const { result, runId } = await runToClustering({
      aiRunner: stubAiRawRunner(async () => {
        throw make();
      }),
    });
    expect(result.terminal).toBe('partial');
    expect(result.reasonCode).toBe('processing_failure');
    expect((await ledgerFor(runId, 'cluster'))?.outcome).toBe('provider_error');
  });

  it('books zero AI spend when the runtime reports no cost', async () => {
    const { result, runId } = await runToClustering({
      aiRunner: stubAiRawRunner(async () =>
        aiResult([], { actualOrEstimatedCostMicros: undefined }),
      ),
    });
    expect(result.terminal).toBe('completed');
    expect((await ledgerFor(runId, 'cluster'))?.actualCostMicros).toBe(0);
  });

  it('reads a clustering document that carries neither market nor creation time', async () => {
    const seeded = await seedRun();
    stubFindByIdOnCall(4, stageDoc({ state: 'collecting' }));
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
        aiRunner: stubAiRawRunner(async () =>
          aiResult([
            {
              type: 'question',
              title: 'Still classified',
              summary: 'Confidence falls back to the current clock.',
              suggestedRoute: 'seo',
              citedSourceIds: ['src-001'],
            },
          ]),
        ),
      }),
    );
    expect(result.terminal).toBe('completed');
    expect(result.signalCount).toBe(1);
  });

  it('degrades to `processing_failure` when the run vanishes before clustering', async () => {
    const seeded = await seedRun();
    stubFindByIdOnCall(4, null);
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
      }),
    );
    expect(result.reasonCode).toBe('processing_failure');
  });

  it('mirrors a run another worker finalized before clustering', async () => {
    const seeded = await seedRun();
    stubFindByIdOnCall(4, terminalDoc('failed', 'processing_failure'));
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId: seeded.runId, accountId: seeded.accountId, siteId: seeded.siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
      }),
    );
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('processing_failure');
  });
});

describe('run loading and finalization', () => {
  it('dead-letters a job whose run id does not resolve', async () => {
    const { accountId, siteId } = await seedRun();
    await expect(
      runAudienceResearchPipeline(
        { runId: new Types.ObjectId().toHexString(), accountId, siteId },
        deps(),
      ),
    ).rejects.toThrow(/run not found or ownership mismatch/);
  });

  it('starts from a zero budget when the run carries no cost ledger', async () => {
    const { runId, accountId, siteId } = await seedRun();
    vi.spyOn(AudienceResearchRun, 'findOne').mockResolvedValueOnce({
      state: 'queued',
      input: { outputLocale: 'en' },
    } as never);
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result.terminal).toBe('failed');
    expect(result.reasonCode).toBe('no_usable_public_evidence');
  });

  it('treats a ledger row with no recorded cost as zero spend', async () => {
    const { runId, accountId, siteId } = await seedRun();
    vi.spyOn(AudienceResearchRun, 'findOne').mockResolvedValueOnce({
      state: 'queued',
      costLedger: [{ stage: 'cluster' }],
      input: { outputLocale: 'en' },
    } as never);
    const row = makeDiscoveryRow();
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps({
        rankProvider: stubRankProvider(async () => ({ rows: [row] })),
        contentSource: stubContentSource({
          [row.canonicalUrl]: makeScrapeResult(row.canonicalUrl, 'evidence body'),
        }),
        aiRunner: stubAiRawRunner(async () => aiResult([])),
      }),
    );
    // A ledger row with no cost must not poison the budget arithmetic.
    expect(result.terminal).toBe('completed');
  });

  it('reports the intended terminal when the run disappears during finalization', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(2, null);
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result).toEqual({
      terminal: 'failed',
      reasonCode: 'no_usable_public_evidence',
      sourceCount: 0,
      signalCount: 0,
    });
  });

  it('never regresses a run another worker already finalized', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(2, terminalDoc('completed', 'ok'));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result.terminal).toBe('completed');
    expect(result.reasonCode).toBe('ok');
  });

  it('mirrors rather than throws when the terminal transition is rejected', async () => {
    const { runId, accountId, siteId } = await seedRun();
    // A run whose stored state is not on the locked machine cannot legally
    // transition; finalization must degrade, not throw the job into retry.
    stubFindByIdOnCall(2, {});
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result).toEqual({
      terminal: 'completed',
      reasonCode: 'ok',
      sourceCount: 0,
      signalCount: 0,
    });
  });

  it('counts absent evidence lists as zero when finalizing', async () => {
    const { runId, accountId, siteId } = await seedRun();
    stubFindByIdOnCall(2, stageDoc({ state: 'collecting' }));
    const result = await runAudienceResearchPipeline(
      { runId, accountId, siteId },
      deps(),
    );
    expect(result.sourceCount).toBe(0);
    expect(result.signalCount).toBe(0);
    expect(result.terminal).toBe('failed');
  });
});
