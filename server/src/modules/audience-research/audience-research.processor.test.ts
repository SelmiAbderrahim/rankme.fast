/**
 * Prompt 10d — BullMQ processor envelope invariants (spec §7.1).
 *
 * Guarantees exercised:
 *   - malformed payload → UnrecoverableError (dead-letter, no retry burn)
 *   - missing run (ownership deleted between enqueue + processing) → warn + drop
 *   - cross-account payload → warn + drop
 *   - terminal run on replay → no-op (idempotent replay)
 *   - queued run → invokes the pipeline (state advances past `queued`)
 */
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import type { AudienceResearchJob } from '../../shared/queue/index.js';
import type {
  ContentSourceProvider,
  ScrapePageResult,
} from '../../shared/providers/content-source.js';
import type { RankProvider } from '../../shared/providers/types.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { AudienceResearchRun } from './audience-research.model.js';
import { createAudienceResearchProcessor } from './audience-research.processor.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

const rankProvider = {
  async checkRank() { throw new Error('unused'); },
  async checkLocalPackRank() { throw new Error('unused'); },
  async searchPublicPages() {
    return { rows: [] };
  },
} as unknown as RankProvider;

const contentSource = {
  async scrapePage(): Promise<ScrapePageResult> {
    throw new Error('unused');
  },
  async crawlSite() { throw new Error('unused'); },
} as ContentSourceProvider;

const aiRunner = {
  preflight() { /* no-op */ },
  async run() {
    throw new Error('unused');
  },
} as unknown as AiProfileRunner;

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    accountId: new Types.ObjectId(),
    siteId: new Types.ObjectId(),
    state: 'queued' as const,
    input: {
      outputLocale: 'en',
      siteMarket: { country: 'US', language: 'en', device: 'desktop' as const },
      competitorDomains: [],
      seedTopics: ['seo'],
      queryTemplateVersion: 1,
    },
    deterministicInputHash: 'x'.repeat(64),
    sources: [],
    signals: [],
    costLedger: [],
    requestedAt: new Date(),
    ...overrides,
  };
}

function fakeJob<T>(data: T): Job<T> {
  return { data } as Job<T>;
}

describe('createAudienceResearchProcessor', () => {
  let processor: ReturnType<typeof createAudienceResearchProcessor>;
  beforeEach(() => {
    processor = createAudienceResearchProcessor({
      rankProvider,
      contentSource,
      aiRunner,
      aiProviderOrder: ['fake'],
      logger: silentLogger,
    });
  });

  it('rejects a malformed payload as UnrecoverableError', async () => {
    await expect(
      processor(fakeJob({ oops: true } as unknown as AudienceResearchJob), 'tok'),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('dead-letters a locale-less active payload and fails the run before providers', async () => {
    const rankSpy = vi.spyOn(rankProvider, 'searchPublicPages');
    const doc = await AudienceResearchRun.create(baseRun());
    await AudienceResearchRun.collection.updateOne(
      { _id: doc._id },
      { $unset: { 'input.outputLocale': 1 } },
    );
    const malformed = fakeJob({
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      runId: doc._id.toString(),
    } as unknown as AudienceResearchJob);

    await expect(processor(malformed, 'tok')).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(malformed, 'tok')).rejects.toBeInstanceOf(UnrecoverableError);
    const after = await AudienceResearchRun.findById(doc._id);
    expect(after).toMatchObject({
      state: 'failed',
      terminal: { state: 'failed', reasonCode: 'processing_failure' },
    });
    expect(rankSpy).not.toHaveBeenCalled();
    rankSpy.mockRestore();
  });

  it('dead-letters a valid payload whose locale differs from the frozen run locale', async () => {
    const rankSpy = vi.spyOn(rankProvider, 'searchPublicPages');
    const doc = await AudienceResearchRun.create(baseRun());
    const mismatched = fakeJob({
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      runId: doc._id.toString(),
      outputLocale: 'fr' as const,
    });

    await expect(processor(mismatched, 'tok')).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(mismatched, 'tok')).resolves.toBeUndefined();
    expect(await AudienceResearchRun.findById(doc._id)).toMatchObject({
      state: 'failed',
      terminal: { state: 'failed', reasonCode: 'processing_failure' },
    });
    expect(rankSpy).not.toHaveBeenCalled();
    rankSpy.mockRestore();
  });

  it('drops silently when the run is missing (owning account deleted)', async () => {
    const payload: AudienceResearchJob = {
      accountId: new Types.ObjectId().toString(),
      siteId: new Types.ObjectId().toString(),
      runId: new Types.ObjectId().toString(),
      outputLocale: 'en',
    };
    await expect(processor(fakeJob(payload), 'tok')).resolves.toBeUndefined();
  });

  it('drops silently on a cross-account payload (ownership guard)', async () => {
    const doc = await AudienceResearchRun.create(baseRun());
    const payload: AudienceResearchJob = {
      accountId: new Types.ObjectId().toString(),
      siteId: doc.siteId.toString(),
      runId: doc._id.toString(),
      outputLocale: 'en',
    };
    await expect(processor(fakeJob(payload), 'tok')).resolves.toBeUndefined();
  });

  it('is a no-op replay on a terminal run', async () => {
    const doc = await AudienceResearchRun.create(baseRun({
      state: 'completed',
      terminal: { state: 'completed', reasonCode: 'ok', completedAt: new Date() },
    }));
    const before = doc.updatedAt.getTime();
    const payload: AudienceResearchJob = {
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      runId: doc._id.toString(),
      outputLocale: 'en',
    };
    await processor(fakeJob(payload), 'tok');
    const after = await AudienceResearchRun.findById(doc._id);
    expect(after?.state).toBe('completed');
    expect(after?.updatedAt.getTime()).toBe(before);
  });

  it('advances a queued run through the pipeline (empty discovery → failed)', async () => {
    const doc = await AudienceResearchRun.create(baseRun());
    const payload: AudienceResearchJob = {
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      runId: doc._id.toString(),
      outputLocale: 'en',
    };
    await processor(fakeJob(payload), 'tok');
    const after = await AudienceResearchRun.findById(doc._id);
    // fake rankProvider.searchPublicPages returns zero rows → terminal `failed`
    // with `no_usable_public_evidence`.
    expect(after?.state).toBe('failed');
    expect(after?.terminal?.reasonCode).toBe('no_usable_public_evidence');
  });
});
