import { UnrecoverableError, type Job } from 'bullmq';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics } from '../../db/schema/gsc.js';
import {
  AiAvailabilityError,
  AiBudgetRefusalError,
  AiInvalidInputError,
  AiMalformedOutputError,
  AiSafetyError,
} from '../../shared/providers/ai-generation.js';
import { createDeadLetterHandler } from '../../shared/queue/dead-letter.js';
import type { InternalLinkJob } from '../../shared/queue/index.js';
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
  ContentInventoryPage,
  ContentInventoryRun,
} from '../content-intelligence/inventory.model.js';
import { Site } from '../sites/index.js';
import type { InventoryPageFacts } from '../content-intelligence/inventory.schemas.js';
import { InternalLinkAiOutputContractError } from './internal-links.ai-contract.js';
import { InternalLinkRun } from './internal-links.model.js';
import {
  createInternalLinksProcessor,
  isInternalLinkAiOutputRejection,
  onInternalLinksJobExhausted,
} from './internal-links.processor.js';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function pageFacts(url: string, headings: string[]): InventoryPageFacts {
  return {
    url,
    canonical: null,
    statusCode: 200,
    robots: [],
    language: 'en',
    title: headings[0] ?? null,
    description: null,
    headings,
    wordCount: 500,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 0,
    externalLinkCount: 0,
    internalOutLinks: [],
    contentHash: `hash-${url}`,
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
  };
}

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function job(data: unknown): Job<InternalLinkJob> {
  return { data } as Job<InternalLinkJob>;
}

function aiResult(object: object) {
  return {
    trust: 'untrusted' as const,
    status: 'complete' as const,
    object,
    warnings: [],
    qualityFlags: ['complete'] as const,
    provenance: {
      task: 'internal_linking' as const,
      profileVersion: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 'internal-linking',
      promptTemplateVersion: '1',
      provider: 'fake' as const,
      model: 'fixture',
      finishReason: 'stop',
      attempts: 1,
      fallbackUsed: false,
      latencyMs: 1,
      actualOrEstimatedCostMicros: 500n,
    },
    classification: { generatedFields: 'untrusted' as const, renderAs: 'text_only' as const },
  };
}

function ai(implementation: (input: Record<string, unknown>) => Promise<unknown>): AiProfileRunner {
  return {
    preflight: vi.fn(),
    run: vi.fn(implementation),
  } as unknown as AiProfileRunner;
}

async function seedInventory(input: {
  accountId: string;
  siteId: string;
  pages: InventoryPageFacts[];
}) {
  const inventory = await ContentInventoryRun.create({
    accountId: input.accountId,
    ownerUserId: input.accountId,
    siteId: input.siteId,
    origin: 'https://example.test',
    locale: 'en',
    status: 'completed',
    input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    inputFingerprint: new Types.ObjectId().toString(),
    idempotencyKey: new Types.ObjectId().toString(),
    requestedAt: new Date(NOW.getTime() - 60_000),
    completedAt: new Date(NOW.getTime() - 30_000),
  });
  await ContentInventoryPage.insertMany(
    input.pages.map((facts) => ({
      runId: inventory._id,
      accountId: input.accountId,
      siteId: input.siteId,
      facts,
      url: facts.url,
      contentHash: facts.contentHash,
      createdAtMs: NOW.getTime(),
    })),
  );
  return inventory;
}

async function seedRun(input: {
  accountId: string;
  siteId: string;
  inventoryRunId: string;
  status?: 'queued' | 'processing' | 'completed' | 'failed';
  gscSnapshotDate?: string | null;
}) {
  return InternalLinkRun.create({
    accountId: input.accountId,
    siteId: input.siteId,
    inventoryRunId: input.inventoryRunId,
    inventoryDate: new Date(NOW.getTime() - 30_000),
    gscSnapshotDate: input.gscSnapshotDate ?? null,
    candidateRulesVersion: '2026-08-02.1',
    locale: 'en',
    status: input.status ?? 'queued',
    aiStatus: 'pending',
    suggestions: [],
    requestedAt: NOW,
  });
}

function payload(accountId: string, siteId: string, runId: string): InternalLinkJob {
  return { accountId, siteId, runId };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('createInternalLinksProcessor', () => {
  it('rejects malformed payloads and drops missing runs without work', async () => {
    const log = logger();
    const runner = ai(async () => aiResult({ suggestions: [], citations: [] }));
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: log,
      now: () => NOW,
    });
    await expect(processor(job({ runId: 'bad' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const missingPayload = payload(
      new Types.ObjectId().toString(),
      new Types.ObjectId().toString(),
      new Types.ObjectId().toString(),
    );
    await expect(processor(job(missingPayload))).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed'] as const)(
    'is a no-op when a replay finds a %s run',
    async (status) => {
      const accountId = new Types.ObjectId().toString();
      const siteId = new Types.ObjectId().toString();
      const inventory = await seedInventory({ accountId, siteId, pages: [] });
      const run = await seedRun({
        accountId,
        siteId,
        inventoryRunId: String(inventory._id),
        status,
      });
      const log = logger();
      const runner = ai(async () => aiResult({ suggestions: [], citations: [] }));
      const processor = createInternalLinksProcessor({
        db: getTestDb() as never,
        ai: runner,
        aiProviderOrder: ['fake'],
        logger: log,
      });
      await processor(job(payload(accountId, siteId, String(run._id))));
      expect(log.info).toHaveBeenCalledWith(
        { runId: String(run._id), status },
        'internal-links processor: terminal run on replay; no-op',
      );
      expect(runner.run).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicate processing claim and the exhausted hook settles it', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const inventory = await seedInventory({ accountId, siteId, pages: [] });
    const run = await seedRun({
      accountId,
      siteId,
      inventoryRunId: String(inventory._id),
      status: 'processing',
    });
    await InternalLinkRun.updateOne({ _id: run._id }, { $set: { startedAt: NOW } });
    const runner = ai(async () => aiResult({ suggestions: [], citations: [] }));
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: logger(),
    });
    const replay = job(payload(accountId, siteId, String(run._id)));

    await expect(processor(replay)).rejects.toThrow('already processing');
    expect(runner.run).not.toHaveBeenCalled();
    await onInternalLinksJobExhausted(replay);
    expect(await InternalLinkRun.findById(run._id)).toMatchObject({
      status: 'failed',
      error: { category: 'processing_failed' },
    });
    await expect(onInternalLinksJobExhausted(job({ bad: true }))).resolves.toBeUndefined();
  });

  it('pins stored GSC evidence, applies ranked anchors, and logs identifiers/counts only', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const pages = [
      pageFacts('https://example.test/blog/source', ['SEO audit guide']),
      pageFacts('https://example.test/services/target', ['SEO audit checklist']),
    ];
    await Site.create({
      _id: siteId,
      accountId,
      url: 'https://example.test',
      domain: 'example.test',
      displayName: 'Example',
      gscPropertyUrl: 'sc-domain:example.test',
      gscBindingGenerationId: 'legacy',
    });
    const inventory = await seedInventory({ accountId, siteId, pages });
    for (const snapshotDate of ['2026-07-01', '2026-07-31']) {
      await getTestDb().insert(gscSearchAnalytics).values(
        pages.map((facts) => ({
          accountId,
          siteId,
          bindingGenerationId: 'legacy',
          snapshotDate,
          dimensionSet: 'query,page',
          windowDays: 28,
          dimensionKey: `${snapshotDate === '2026-07-01' ? 'old evidence' : 'new evidence'}${GSC_DIMENSION_KEY_SEPARATOR}${facts.url}`,
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          position: 5,
        })),
      );
    }
    const run = await seedRun({
      accountId,
      siteId,
      inventoryRunId: String(inventory._id),
      gscSnapshotDate: '2026-07-01',
    });
    const captured: { input?: Record<string, unknown> } = {};
    const runner = ai(async (input) => {
      captured.input = input;
      const candidates = (input.input as { candidates: Array<Record<string, string>> }).candidates;
      const first = candidates[0]!;
      return aiResult({
        suggestions: [
          {
            candidateId: first.id,
            sourceUrl: first.sourceUrl,
            targetUrl: first.targetUrl,
            anchorText: '=AI anchor',
          },
        ],
        citations: [first.id],
      });
    });
    const log = logger();
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: log,
      now: () => NOW,
    });
    await processor(job(payload(accountId, siteId, String(run._id))));

    const saved = await InternalLinkRun.findById(run._id).lean();
    expect(saved?.status).toBe('completed');
    expect(saved?.aiStatus).toBe('applied');
    expect(saved?.startedAt?.toISOString()).toBe(NOW.toISOString());
    expect(saved?.completedAt?.toISOString()).toBe(NOW.toISOString());
    expect(saved?.aiCostMicros).toBe(500);
    expect(saved?.suggestions[0]?.anchorText).toBe('=AI anchor');
    expect(saved?.suggestions[0]?.rank).toBe(1);
    expect(saved?.suggestions[0]?.sharedQueries).toContain('old evidence');
    expect(saved?.suggestions[0]?.sharedQueries).not.toContain('new evidence');
    expect((captured.input?.input as Record<string, unknown>)).toHaveProperty('candidates');
    expect(captured.input?.input).not.toHaveProperty('pageMarkdown');
    expect(captured.input?.input).not.toHaveProperty('html');
    const logged = JSON.stringify([
      ...(log.info as unknown as ReturnType<typeof vi.fn>).mock.calls,
      ...(log.warn as unknown as ReturnType<typeof vi.fn>).mock.calls,
      ...(log.error as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(logged).not.toContain('SEO audit guide');
    expect(logged).not.toContain('https://example.test');
    expect(logged).not.toContain('=AI anchor');
  });

  it('resumes processing and keeps all deterministic candidates when AI returns an empty subset', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const inventory = await seedInventory({
      accountId,
      siteId,
      pages: [
        pageFacts('https://example.test/a', ['shared topic words']),
        pageFacts('https://example.test/b', ['shared topic words']),
      ],
    });
    const run = await seedRun({
      accountId,
      siteId,
      inventoryRunId: String(inventory._id),
      status: 'processing',
    });
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ suggestions: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    });
    await processor(job(payload(accountId, siteId, String(run._id))));
    const saved = await InternalLinkRun.findById(run._id).lean();
    expect(saved?.status).toBe('completed');
    expect(saved?.aiStatus).toBe('applied');
    expect(saved?.suggestions.length).toBeGreaterThan(0);
    expect(saved?.suggestions.every((entry) => entry.rank === null)).toBe(true);
  });

  it('falls back unranked on hostile output and retains deterministic suggestions', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const inventory = await seedInventory({
      accountId,
      siteId,
      pages: [
        pageFacts('https://example.test/a', ['shared topic words']),
        pageFacts('https://example.test/b', ['shared topic words']),
      ],
    });
    const run = await seedRun({ accountId, siteId, inventoryRunId: String(inventory._id) });
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: ai(async () =>
        aiResult({
          suggestions: [
            {
              candidateId: 'link-99999999999999999999',
              sourceUrl: 'https://outside.test',
              targetUrl: 'https://outside.test/noindex',
              anchorText: 'hostile',
            },
          ],
          citations: [],
        }),
      ),
      aiProviderOrder: ['fake'],
      logger: logger(),
    });
    await processor(job(payload(accountId, siteId, String(run._id))));
    const saved = await InternalLinkRun.findById(run._id).lean();
    expect(saved?.status).toBe('completed');
    expect(saved?.aiStatus).toBe('output_rejected');
    expect(saved?.suggestions.length).toBeGreaterThan(0);
    expect(saved?.suggestions.every((entry) => entry.rankingSource === 'deterministic')).toBe(
      true,
    );
  });

  it('classifies malformed profile output as rejection and provider errors as fallback', async () => {
    expect(isInternalLinkAiOutputRejection(new InternalLinkAiOutputContractError())).toBe(true);
    expect(isInternalLinkAiOutputRejection(new AiMalformedOutputError())).toBe(true);
    expect(isInternalLinkAiOutputRejection(new AiInvalidInputError())).toBe(true);
    expect(isInternalLinkAiOutputRejection(new AiSafetyError())).toBe(true);
    expect(isInternalLinkAiOutputRejection(new AiBudgetRefusalError())).toBe(true);
    expect(isInternalLinkAiOutputRejection(new AiAvailabilityError())).toBe(false);
    expect(isInternalLinkAiOutputRejection(new Error('provider died'))).toBe(false);

    for (const error of [new AiMalformedOutputError(), new AiAvailabilityError()]) {
      const accountId = new Types.ObjectId().toString();
      const siteId = new Types.ObjectId().toString();
      const inventory = await seedInventory({
        accountId,
        siteId,
        pages: [
          pageFacts(`https://${accountId}.test/a`, ['shared topic words']),
          pageFacts(`https://${accountId}.test/b`, ['shared topic words']),
        ],
      });
      const run = await seedRun({ accountId, siteId, inventoryRunId: String(inventory._id) });
      const processor = createInternalLinksProcessor({
        db: getTestDb() as never,
        ai: ai(async () => {
          throw error;
        }),
        aiProviderOrder: ['fake'],
        logger: logger(),
      });
      await processor(job(payload(accountId, siteId, String(run._id))));
      const saved = await InternalLinkRun.findById(run._id).lean();
      expect(saved?.aiStatus).toBe(
        error instanceof AiMalformedOutputError ? 'output_rejected' : 'provider_failed',
      );
      expect(saved?.suggestions.length).toBeGreaterThan(0);
    }
  });

  it('completes with zero suggestions when the AI provider fails and nothing is retained', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const inventory = await seedInventory({
      accountId,
      siteId,
      pages: [pageFacts('https://example.test/only', ['only page'])],
    });
    const run = await seedRun({ accountId, siteId, inventoryRunId: String(inventory._id) });
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: ai(async () => {
        throw new Error('provider unavailable');
      }),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    });
    await processor(job(payload(accountId, siteId, String(run._id))));
    const saved = await InternalLinkRun.findById(run._id).lean();
    expect(saved?.status).toBe('completed');
    expect(saved?.aiStatus).toBe('provider_failed');
    expect(saved?.suggestions).toHaveLength(0);
  });

  it('marks an unexpected terminal failure and its unrecoverable error enters the DLQ', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const missingInventoryId = new Types.ObjectId().toString();
    const run = await seedRun({ accountId, siteId, inventoryRunId: missingInventoryId });
    const log = logger();
    const processor = createInternalLinksProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ suggestions: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: log,
      now: () => NOW,
    });
    let terminalError: Error | null = null;
    try {
      await processor(job(payload(accountId, siteId, String(run._id))));
    } catch (error) {
      terminalError = error as Error;
    }
    expect(terminalError).toBeInstanceOf(UnrecoverableError);
    const saved = await InternalLinkRun.findById(run._id).lean();
    expect(saved?.status).toBe('failed');
    expect(saved?.error).toMatchObject({
      category: 'processing_failed',
      messageKey: 'internalLinks.errors.processingFailed',
    });

    const add = vi.fn(async () => undefined);
    const handler = createDeadLetterHandler({
      deadLetterQueue: { add } as never,
      sourceQueueName: 'internal-links',
      logger: log,
      now: () => NOW,
    });
    await handler(
      {
        id: `internal-links-${run._id}`,
        data: payload(accountId, siteId, String(run._id)),
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as Job,
      terminalError!,
    );
    expect(add).toHaveBeenCalledWith(
      'dead-letter',
      expect.objectContaining({ queue: 'internal-links' }),
    );
  });
});
