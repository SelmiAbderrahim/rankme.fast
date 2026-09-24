/**
 * Content Intelligence — end-to-end processor smoke (prompt 05, Phase A).
 *
 * Permanent, intentionally small integration smoke that runs the three
 * headline flows through the REAL stage handlers with minimal fakes:
 *   1. happy path → completed, snapshot persisted, replay idempotent;
 *   2. owned-page-unusable → failed + exactly-once failed event;
 *   3. SERP failure → partial while brief/draft still generate.
 *
 * The exhaustive branch-level suite lives in
 * `content-analysis.processor.test.ts`; this file stays as a fast regression
 * canary for the composed pipeline.
 */
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { ContentAnalysis, ContentSnapshot, createContentAnalysisProcessor } from './index.js';
import type { ContentAnalysisJob } from '../../shared/queue/index.js';
import type { ContentDocument } from '../../shared/providers/content-source.js';

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

const events: Array<Record<string, unknown>> = [];

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

function makeDocument(overrides: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: 'https://example.com/p',
    statusCode: 200,
    title: 'A very reasonable page title',
    description: 'A description that is long enough to look like a real one here.',
    canonical: 'https://example.com/p',
    robots: [],
    language: 'en',
    markdown:
      'Intro words about the topic seo audits and more helpful details. '.repeat(20),
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
    capturedAt: new Date(),
    ...overrides,
  };
}

function baseAnalysisInput() {
  const accountId = new Types.ObjectId().toString();
  const key = `idem_${'x'.repeat(43)}`;
  return {
    accountId,
    ownerUserId: accountId,
    siteId: new Types.ObjectId().toString(),
    ownedUrl: 'https://example.com/p',
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
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    db: fakeDb(),
    contentSource: {
      scrapePage: vi.fn(async () => ({
        document: makeDocument(),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      })),
      crawlSite: vi.fn(),
    } as never,
    keyword: {
      getMetrics: vi.fn(async () => [
        { keyword: 'seo audits', searchVolume: 100, difficulty: 40 },
      ]),
      classifyIntent: vi.fn(async () => [
        { keyword: 'seo audits', intent: 'informational' },
      ]),
    } as never,
    rank: {
      checkRank: vi.fn(async () => ({
        position: 4,
        serpTopUrls: [] as string[],
      })),
    } as never,
    ai: {
      preflight: vi.fn(),
      run: vi.fn(async (input: { profile: string }) => ({
        trust: 'untrusted',
        status: 'complete',
        object:
          input.profile === 'content_brief'
            ? { title: 'Brief title', audience: 'General', outline: ['a', 'b'], citations: [] }
            : { title: 'Draft title', body: 'Draft body with several words of text.', citations: [] },
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
      })),
    } as never,
    aiProviderOrder: ['fake'] as const,
    logger: silentLogger,
    ...overrides,
  };
}

function fakeJob<T>(data: T): Job<T> {
  return { data } as Job<T>;
}

describe('processor smoke', () => {
  beforeEach(() => {
    events.length = 0;
  });

  it('runs the full happy path to completed', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const payload: ContentAnalysisJob = {
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      analysisId: doc._id.toString(),
      reservationKey: doc.idempotencyKey,
    };
    const processor = createContentAnalysisProcessor(deps());
    await processor(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('completed');
    expect(after?.scorecardV2).toBeTruthy();
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft?.markdown).toBeTruthy();
    expect(after?.stageLedger.length).toBeGreaterThanOrEqual(5);
    expect(events.some((e) => e.kind === 'completed')).toBe(true);
    const snapshots = await ContentSnapshot.find({ analysisId: doc._id });
    expect(snapshots).toHaveLength(1);
    // Replay is a no-op.
    await processor(fakeJob(payload), 'tok');
    expect(events.filter((e) => e.kind === 'completed')).toHaveLength(1);
  });

  it('fails when the owned page is unusable', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const payload: ContentAnalysisJob = {
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      analysisId: doc._id.toString(),
      reservationKey: doc.idempotencyKey,
    };
    const d = deps();
    (d.contentSource as { scrapePage: ReturnType<typeof vi.fn> }).scrapePage = vi.fn(
      async () => ({
        document: makeDocument({ markdown: '', title: null, headings: [], structuredData: [] }),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      }),
    );
    const processor = createContentAnalysisProcessor(d);
    await processor(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error?.category).toBe('owned_page_unusable');
    expect(events.map((e) => e.kind)).toEqual(['failed']);
  });

  it('serp failure degrades to partial while brief/draft still run', async () => {
    const doc = await ContentAnalysis.create(baseAnalysisInput());
    const payload: ContentAnalysisJob = {
      accountId: doc.accountId.toString(),
      siteId: doc.siteId.toString(),
      analysisId: doc._id.toString(),
      reservationKey: doc.idempotencyKey,
    };
    const d = deps();
    (d.rank as { checkRank: ReturnType<typeof vi.fn> }).checkRank = vi.fn(async () => {
      throw new Error('serp down');
    });
    const processor = createContentAnalysisProcessor(d);
    await processor(fakeJob(payload), 'tok');
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('partial');
    expect(after?.warnings.some((w) => w.code === 'serp_unavailable')).toBe(true);
    expect(after?.brief?.text).toBeTruthy();
    expect(after?.draft?.markdown).toBeTruthy();
    expect(events.some((e) => e.kind === 'completed')).toBe(true);
  });
});
