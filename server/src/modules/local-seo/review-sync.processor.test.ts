/**
 * Review Intelligence sync consumer tests.
 *
 * Covers the settle status table, `(source, sourceReviewId)` dedupe across
 * reruns, per-source outcome bookkeeping, field bounding on persist, and the
 * idempotency of the settle claim under a replayed job.
 */
import { UnrecoverableError, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/client.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { vendorResponses } from '../../db/schema/vendor-cache.js';
import {
  VendorQuotaError,
  VendorTimeoutError,
  createFakeReviewsProvider,
  type ReviewRow,
  type ReviewsProvider,
  type ReviewsResult,
} from '../../shared/providers/index.js';
import type { ReviewSyncJob } from '../../shared/queue/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';
import {
  LocalSeoReviewRow,
  LocalSeoReviewSource,
  LocalSeoReviewSyncRun,
  type ReviewSourceName,
} from './review-sync.model.js';
import {
  createReviewSyncProcessor,
  normalizeReviewRow,
  orderNewestFirst,
  persistUnseenRows,
} from './review-sync.processor.js';
import { settleReviewSyncRun } from './review-sync.service.js';

const NOW = new Date('2026-03-01T00:00:00.000Z');
let db: Db;

const ACCOUNT_ID = new mongoose.Types.ObjectId().toString();

function row(overrides: Partial<ReviewRow> & { sourceReviewId: string }): ReviewRow {
  return {
    rating: 5,
    title: null,
    text: 'A useful review.',
    authorDisplayName: 'Sam P.',
    language: 'en',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function providerReturning(
  perSource: Partial<Record<ReviewSourceName, ReviewRow[] | Error>>,
): ReviewsProvider {
  return {
    async getReviews(input): Promise<ReviewsResult> {
      const outcome = perSource[input.source];
      if (outcome instanceof Error) throw outcome;
      return {
        source: input.source,
        target: input.target,
        rows: (outcome ?? []).slice(0, input.depth),
        fetchedAt: NOW.toISOString(),
      };
    },
  };
}

/**
 * Theme-pass stub. Cites the two newest stored rows so the theme
 * clears the two-citation bar.
 */
function themeRunner(): AiProfileRunner {
  return {
    preflight: () => undefined,
    run: vi.fn(async () => ({
      trust: 'untrusted' as const,
      status: 'complete' as const,
      object: {
        complaintThemes: [
          { label: 'Waits', summary: 'Long waits.', citedReviewIds: ['rev-001', 'rev-002'] },
        ],
        praiseThemes: [],
        citations: [],
      },
      warnings: [],
      qualityFlags: ['complete' as const],
      provenance: {
        task: 'review_themes' as const,
        profileVersion: '1.0.0',
        outputSchemaVersion: '1',
        promptTemplateId: 'review-themes',
        promptTemplateVersion: '1',
        provider: 'fake' as const,
        model: 'stub',
        finishReason: 'stop',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 1,
        actualOrEstimatedCostMicros: 3_000n,
      },
      classification: { generatedFields: 'untrusted' as const, renderAs: 'text_only' as const },
    })) as AiProfileRunner['run'],
  };
}

async function seedAccount(accountId: string): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: 'https://example.com',
    domain: 'example.com',
  });
  return String(site._id);
}

async function seedRun(
  accountId: string,
  profileId: string,
  sources: ReviewSourceName[],
): Promise<string> {
  for (const source of sources) {
    await LocalSeoReviewSource.create({
      accountId,
      profileId,
      source,
      target: source === 'trustpilot' ? 'example.com' : `target-${source}`,
    });
  }
  const run = await LocalSeoReviewSyncRun.create({
    accountId,
    profileId,
    outputLocale: 'en',
    sources,
    depth: 100,
    status: 'queued',
  });
  return String(run._id);
}

function jobFor(
  runId: string,
  accountId = ACCOUNT_ID,
  outputLocale: ReviewSyncJob['outputLocale'] = 'en',
): Job<ReviewSyncJob> {
  return {
    data: { accountId, siteId: '000000000000000000000002', runId, outputLocale },
  } as Job<ReviewSyncJob>;
}

beforeAll(async () => {
  await startMemoryMongo();
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('normalizeReviewRow', () => {
  it('clamps every bounded field, masks in-body emails, and drops an unparsable date', () => {
    const normalized = normalizeReviewRow(
      row({
        sourceReviewId: 'x',
        rating: 9,
        title: `t${'a'.repeat(400)} reach me at spam@example.com`,
        text: `${'b'.repeat(1200)} spam@example.com`,
        authorDisplayName: 'c'.repeat(200),
        language: 'e'.repeat(40),
        reviewedAt: 'not-a-date',
      }),
    );
    expect(normalized.rating).toBe(5);
    expect(normalized.title).toHaveLength(200);
    expect(normalized.text).toHaveLength(1000);
    expect(normalized.authorDisplayName).toHaveLength(120);
    expect(normalized.language).toHaveLength(16);
    expect(normalized.reviewedAt).toBeNull();
  });

  it('masks an email inside the body and keeps nulls null', () => {
    const normalized = normalizeReviewRow(
      row({
        sourceReviewId: 'y',
        rating: null,
        title: null,
        authorDisplayName: null,
        language: null,
        reviewedAt: null,
        text: 'Contact me on someone@example.org please',
      }),
    );
    expect(normalized.text).toBe('Contact me on [email] please');
    expect(normalized.rating).toBeNull();
    expect(normalized.title).toBeNull();
    expect(normalized.authorDisplayName).toBeNull();
    expect(normalized.language).toBeNull();
    expect(normalized.reviewedAt).toBeNull();
  });

  it('clamps a negative rating up to zero', () => {
    expect(normalizeReviewRow(row({ sourceReviewId: 'z', rating: -3 })).rating).toBe(0);
  });

  it('counts Unicode code points for every persisted bound and rejects non-finite ratings', () => {
    const normalized = normalizeReviewRow(
      row({
        sourceReviewId: '🔎'.repeat(201),
        rating: Number.NaN,
        title: '🌟'.repeat(201),
        text: '📝'.repeat(1001),
        authorDisplayName: '👤'.repeat(121),
        language: '🌐'.repeat(17),
      }),
    );

    expect([...normalized.sourceReviewId]).toHaveLength(200);
    expect([...normalized.title!]).toHaveLength(200);
    expect([...normalized.text]).toHaveLength(1000);
    expect([...normalized.authorDisplayName!]).toHaveLength(120);
    expect([...normalized.language!]).toHaveLength(16);
    expect(normalized.rating).toBeNull();

    const persisted = new LocalSeoReviewRow({
      accountId: new mongoose.Types.ObjectId(),
      profileId: new mongoose.Types.ObjectId(),
      source: 'google',
      sourceReviewId: normalized.sourceReviewId,
      rating: normalized.rating,
      title: normalized.title,
      text: normalized.text,
      authorDisplayName: normalized.authorDisplayName,
      language: normalized.language,
      reviewedAt: null,
      firstSeenRunId: new mongoose.Types.ObjectId(),
      fetchedAt: NOW,
    });
    expect(persisted.validateSync()).toBeUndefined();
  });

  it('rejects review content that exceeds a Unicode code-point persistence bound', () => {
    const persisted = new LocalSeoReviewRow({
      accountId: new mongoose.Types.ObjectId(),
      profileId: new mongoose.Types.ObjectId(),
      source: 'google',
      sourceReviewId: 'source-id',
      text: '📝'.repeat(1001),
      firstSeenRunId: new mongoose.Types.ObjectId(),
      fetchedAt: NOW,
    });

    expect(persisted.validateSync()?.errors.text).toBeDefined();
  });
});

describe('orderNewestFirst', () => {
  it('sorts newest first, pushes undated rows last, and breaks ties on the source id', () => {
    const ordered = orderNewestFirst([
      row({ sourceReviewId: 'b', reviewedAt: null }),
      row({ sourceReviewId: 'a', reviewedAt: null }),
      row({ sourceReviewId: 'old', reviewedAt: '2025-01-01T00:00:00.000Z' }),
      row({ sourceReviewId: 'new-2', reviewedAt: '2026-01-01T00:00:00.000Z' }),
      row({ sourceReviewId: 'new-1', reviewedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(ordered.map((entry) => entry.sourceReviewId)).toEqual([
      'new-1',
      'new-2',
      'old',
      'a',
      'b',
    ]);
  });

  it('pushes an undated row behind a dated one from either input order', () => {
    const dated = row({ sourceReviewId: 'dated', reviewedAt: '2026-01-01T00:00:00.000Z' });
    const undated = row({ sourceReviewId: 'undated', reviewedAt: null });
    expect(orderNewestFirst([undated, dated]).map((entry) => entry.sourceReviewId)).toEqual([
      'dated',
      'undated',
    ]);
    expect(orderNewestFirst([dated, undated]).map((entry) => entry.sourceReviewId)).toEqual([
      'dated',
      'undated',
    ]);
  });
});

describe('persistUnseenRows', () => {
  it('returns zero for an empty page and de-duplicates ids inside one page', async () => {
    const profileId = new mongoose.Types.ObjectId().toString();
    const runId = new mongoose.Types.ObjectId().toString();
    expect(
      await persistUnseenRows({
        accountId: ACCOUNT_ID,
        profileId,
        runId,
        source: 'google',
        rows: [],
        fetchedAt: NOW,
      }),
    ).toBe(0);

    const retained = await persistUnseenRows({
      accountId: ACCOUNT_ID,
      profileId,
      runId,
      source: 'google',
      rows: [row({ sourceReviewId: 'dup' }), row({ sourceReviewId: 'dup' })],
      fetchedAt: NOW,
    });
    expect(retained).toBe(1);
    expect(await LocalSeoReviewRow.countDocuments({ profileId })).toBe(1);
  });

  it('reports the surviving count when a concurrent writer wins the unique index', async () => {
    const profileId = new mongoose.Types.ObjectId().toString();
    const runId = new mongoose.Types.ObjectId().toString();
    await persistUnseenRows({
      accountId: ACCOUNT_ID,
      profileId,
      runId,
      source: 'google',
      rows: [row({ sourceReviewId: 'already-there' })],
      fetchedAt: NOW,
    });
    // Simulate the race: the pre-read misses the existing row, so the insert
    // batch collides on the unique index for one of the two documents.
    const find = vi.spyOn(LocalSeoReviewRow, 'find').mockReturnValueOnce({
      select: () => Promise.resolve([]),
    } as never);
    const retained = await persistUnseenRows({
      accountId: ACCOUNT_ID,
      profileId,
      runId,
      source: 'google',
      rows: [row({ sourceReviewId: 'already-there' }), row({ sourceReviewId: 'fresh' })],
      fetchedAt: NOW,
    });
    find.mockRestore();
    expect(retained).toBe(1);
    expect(await LocalSeoReviewRow.countDocuments({ profileId })).toBe(2);
  });

  it('rethrows unordered insert validation errors instead of reporting a false zeroNew', async () => {
    const validationError = new Error('invalid normalized row');
    const insertMany = vi.spyOn(LocalSeoReviewRow, 'insertMany').mockResolvedValueOnce({
      insertedCount: 0,
      mongoose: { validationErrors: [validationError] },
    } as never);

    await expect(
      persistUnseenRows({
        accountId: ACCOUNT_ID,
        profileId: new mongoose.Types.ObjectId().toString(),
        runId: new mongoose.Types.ObjectId().toString(),
        source: 'google',
        rows: [row({ sourceReviewId: 'invalid-row' })],
        fetchedAt: NOW,
      }),
    ).rejects.toBe(validationError);
    insertMany.mockRestore();
  });

  it('rethrows a partial non-duplicate storage failure for the worker to retry', async () => {
    const storageError = Object.assign(new Error('storage unavailable'), {
      code: 91,
      insertedDocs: [{ sourceReviewId: 'partially-inserted' }],
      writeErrors: [{ code: 91 }],
    });
    const insertMany = vi
      .spyOn(LocalSeoReviewRow, 'insertMany')
      .mockRejectedValueOnce(storageError);

    await expect(
      persistUnseenRows({
        accountId: ACCOUNT_ID,
        profileId: new mongoose.Types.ObjectId().toString(),
        runId: new mongoose.Types.ObjectId().toString(),
        source: 'google',
        rows: [row({ sourceReviewId: 'storage-failure' })],
        fetchedAt: NOW,
      }),
    ).rejects.toBe(storageError);
    insertMany.mockRestore();
  });
});

describe('review sync processor — settle status table', () => {
  it('dead-letters malformed work that has no addressable run identity', async () => {
    const provider = createFakeReviewsProvider();
    const providerSpy = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });
    const malformed = { data: null } as unknown as Job<ReviewSyncJob>;

    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('dead-letters a locale-less active job and fails the run before any provider call', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    await LocalSeoReviewSyncRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(runId) },
      { $unset: { outputLocale: 1 } },
    );
    const provider = createFakeReviewsProvider();
    const providerSpy = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });
    const malformed = {
      data: { accountId: ACCOUNT_ID, siteId: '000000000000000000000002', runId },
    } as unknown as Job<ReviewSyncJob>;

    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run).toMatchObject({ status: 'failed' });
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('dead-letters a valid payload whose locale differs from the frozen run locale', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const provider = createFakeReviewsProvider();
    const providerSpy = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });
    const mismatched = jobFor(runId, ACCOUNT_ID, 'fr');

    await expect(processor(mismatched)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(mismatched)).resolves.toBeUndefined();
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('fails locale-less settled work before a replay can resume its pending theme pass', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    await LocalSeoReviewSyncRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(runId) },
      {
        $set: { status: 'succeeded', aiTerminalState: 'pending' },
        $unset: { outputLocale: 1 },
      },
    );
    const provider = createFakeReviewsProvider();
    const providerSpy = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });
    const malformed = {
      data: { accountId: ACCOUNT_ID, siteId: profileId, runId },
    } as unknown as Job<ReviewSyncJob>;

    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run).toMatchObject({
      status: 'failed',
      aiTerminalState: 'ai-failed-reviews-intact',
    });
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('fails a settled replay whose job locale differs from the frozen run locale', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    await LocalSeoReviewSyncRun.updateOne(
      { _id: runId },
      { $set: { status: 'succeeded', aiTerminalState: 'pending' } },
    );
    const provider = createFakeReviewsProvider();
    const providerSpy = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });

    await expect(processor(jobFor(runId, ACCOUNT_ID, 'fr'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(await LocalSeoReviewSyncRun.findById(runId)).toMatchObject({
      status: 'failed',
      aiTerminalState: 'ai-failed-reviews-intact',
    });
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('(a) every source fails and nothing is retained → failed', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google', 'trustpilot']);

    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({
        google: new VendorTimeoutError('timeout', { provider: 'fake', operation: 'reviews' }),
        trustpilot: new VendorQuotaError('quota', { provider: 'fake', operation: 'reviews' }),
      }),
      now: () => NOW,
    });
    await processor(jobFor(runId));

    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.retainedCount).toBe(0);
    expect(run?.perSourceOutcomes.map((outcome) => outcome.outcome)).toEqual(['failed', 'failed']);
    expect(run?.perSourceOutcomes[0]?.errorCode).toBe('VendorTimeoutError');
  });

  it('(b) every source fails but a row was already retained this run → failed', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    // Pre-seed a retained row for the same run so the settle sees retained > 0
    // even though the single requested source failed.
    await settleReviewSyncRun(
      {
        accountId: ACCOUNT_ID,
        runId,
        outcomes: [{ source: 'google', outcome: 'failed', retained: 1, errorCode: 'VendorQuotaError' }],
        completedAt: NOW,
      },
    );
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.retainedCount).toBe(1);
  });

  it('(c) partial-source failure → status partial', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google', 'trustpilot']);

    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({
        google: [row({ sourceReviewId: 'g-1' })],
        trustpilot: new VendorTimeoutError('timeout', { provider: 'fake', operation: 'reviews' }),
      }),
      now: () => NOW,
    });
    await processor(jobFor(runId));

    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('partial');
    expect(run?.retainedCount).toBe(1);
  });

  it('(d) all sources ok → status succeeded, rows persisted and archived', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);

    const processor = createReviewSyncProcessor({
      db,
      provider: createFakeReviewsProvider(),
      now: () => NOW,
    });
    await processor(jobFor(runId));

    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.retainedCount).toBe(2);
    expect(run?.completedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await LocalSeoReviewRow.countDocuments({ profileId })).toBe(2);

    const archived = await db.select().from(vendorResponses);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      capability: 'local-listings',
      operation: 'reviews-sync-google',
      accountId: ACCOUNT_ID,
    });
  });

  it('books a source that returned only already-stored ids as zeroNew and stays succeeded', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const first = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const provider = providerReturning({ google: [row({ sourceReviewId: 'g-1' })] });
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });
    await processor(jobFor(first));
    expect(await LocalSeoReviewRow.countDocuments({ profileId })).toBe(1);

    const rerun = await LocalSeoReviewSyncRun.create({
      accountId: ACCOUNT_ID,
      profileId,
      outputLocale: 'en',
      sources: ['google'],
      depth: 100,
      status: 'queued',
    });
    await processor(jobFor(String(rerun._id)));

    const run = await LocalSeoReviewSyncRun.findById(rerun._id);
    expect(run?.status).toBe('succeeded');
    expect(run?.retainedCount).toBe(0);
    expect(run?.perSourceOutcomes[0]?.outcome).toBe('zeroNew');
    // Dedupe: the rerun appended nothing.
    expect(await LocalSeoReviewRow.countDocuments({ profileId })).toBe(1);
  });

  it('appends only the new ids when a rerun returns a mix of stored and fresh reviews', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const first = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({ google: [row({ sourceReviewId: 'g-1' })] }),
      now: () => NOW,
    });
    await processor(jobFor(first));

    const rerun = await LocalSeoReviewSyncRun.create({
      accountId: ACCOUNT_ID,
      profileId,
      outputLocale: 'en',
      sources: ['google'],
      depth: 100,
      status: 'queued',
    });
    const second = createReviewSyncProcessor({
      db,
      provider: providerReturning({
        google: [
          row({ sourceReviewId: 'g-1' }),
          row({ sourceReviewId: 'g-2', reviewedAt: '2026-02-01T00:00:00.000Z' }),
        ],
      }),
      now: () => NOW,
    });
    await second(jobFor(String(rerun._id)));

    const run = await LocalSeoReviewSyncRun.findById(rerun._id);
    expect(run?.retainedCount).toBe(1);
    expect(run?.perSourceOutcomes[0]?.outcome).toBe('ok');
    const stored = await LocalSeoReviewRow.find({ profileId }).sort({ sourceReviewId: 1 });
    expect(stored.map((doc) => doc.sourceReviewId)).toEqual(['g-1', 'g-2']);
    // The second run never rewrites the first run's attribution.
    expect(String(stored[0]?.firstSeenRunId)).toBe(first);
  });
});

describe('review sync processor — bundled theme pass', () => {
  it('runs the theme pass after the per-source outcomes are recorded', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const ai = themeRunner();
    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({
        google: [row({ sourceReviewId: 'g-1' }), row({ sourceReviewId: 'g-2' })],
      }),
      now: () => NOW,
      ai,
      aiProviderOrder: ['fake'],
    });

    await processor(jobFor(runId));

    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.aiTerminalState).toBe('themes-ok');
    expect(run?.aiCostMicros).toBe(3_000);
  });

  it('skips the theme pass when every source failed', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const ai = themeRunner();
    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({
        google: new VendorQuotaError('quota', { provider: 'fake', operation: 'reviews' }),
      }),
      now: () => NOW,
      ai,
      aiProviderOrder: ['fake'],
    });

    await processor(jobFor(runId));

    expect(ai.run).not.toHaveBeenCalled();
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.aiTerminalState).toBe('pending');
  });

  it('books zeroNew reruns as themeable because the stored inventory is not empty', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const rows = [row({ sourceReviewId: 'g-1' }), row({ sourceReviewId: 'g-2' })];
    const provider = providerReturning({ google: rows });
    const first = await seedRun(ACCOUNT_ID, profileId, ['google']);
    await createReviewSyncProcessor({ db, provider, now: () => NOW })(jobFor(first));

    const rerun = await LocalSeoReviewSyncRun.create({
      accountId: ACCOUNT_ID,
      profileId,
      outputLocale: 'en',
      sources: ['google'],
      depth: 100,
      status: 'queued',
    });
    await createReviewSyncProcessor({
      db,
      provider,
      now: () => NOW,
      ai: themeRunner(),
      aiProviderOrder: ['fake'],
    })(jobFor(String(rerun._id)));

    const run = await LocalSeoReviewSyncRun.findById(rerun._id);
    expect(run?.retainedCount).toBe(0);
    expect(run?.perSourceOutcomes[0]?.outcome).toBe('zeroNew');
    expect(run?.aiTerminalState).toBe('themes-ok');
  });
});

describe('review sync processor — idempotency', () => {
  it('is a no-op on a replay after the run settled', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const provider = providerReturning({
      google: new VendorTimeoutError('timeout', { provider: 'fake', operation: 'reviews' }),
    });
    const getReviews = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });

    await processor(jobFor(runId));
    await processor(jobFor(runId));
    expect(getReviews).toHaveBeenCalledTimes(1);
  });

  it('settleReviewSyncRun refuses to rewrite a terminal run', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const outcomes = [
      { source: 'google' as const, outcome: 'failed' as const, retained: 0, errorCode: 'VendorQuotaError' },
    ];
    const first = await settleReviewSyncRun({ accountId: ACCOUNT_ID, runId, outcomes, completedAt: NOW });
    expect(first).toEqual({ status: 'failed' });
    const later = new Date(NOW.getTime() + 60_000);
    const second = await settleReviewSyncRun({ accountId: ACCOUNT_ID, runId, outcomes, completedAt: later });
    expect(second).toEqual({ status: 'failed' });
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('falls back to the wall clock when no clock is injected', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const before = Date.now();
    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({ google: [row({ sourceReviewId: 'g-wall-clock' })] }),
    });
    await processor(jobFor(runId));
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.completedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns early when the run row is missing', async () => {
    const provider = providerReturning({ google: [] });
    const getReviews = vi.spyOn(provider, 'getReviews');
    const processor = createReviewSyncProcessor({ db, provider, now: () => NOW });
    await processor(jobFor(new mongoose.Types.ObjectId().toString()));
    expect(getReviews).not.toHaveBeenCalled();
  });

  it('resumes a theme pass that a crash left pending, without a second fan-out', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const provider = providerReturning({ google: [row({ sourceReviewId: 'g-1' }), row({ sourceReviewId: 'g-2' })] });
    const getReviews = vi.spyOn(provider, 'getReviews');
    // First pass: vendor-only wiring, so the run settles with themes pending.
    await createReviewSyncProcessor({ db, provider, now: () => NOW })(jobFor(runId));
    expect((await LocalSeoReviewSyncRun.findById(runId))?.aiTerminalState).toBe('pending');

    const ai = themeRunner();
    await createReviewSyncProcessor({
      db,
      provider,
      now: () => NOW,
      ai,
      aiProviderOrder: ['fake'],
    })(jobFor(runId));

    expect(getReviews).toHaveBeenCalledTimes(1);
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.aiTerminalState).toBe('themes-ok');
    expect(run?.aiThemes).toHaveLength(1);
  });

  it('rethrows a non-provider failure so the run can retry', async () => {
    const profileId = await seedAccount(ACCOUNT_ID);
    const runId = await seedRun(ACCOUNT_ID, profileId, ['google']);
    const processor = createReviewSyncProcessor({
      db,
      provider: providerReturning({ google: new Error('boom') }),
      now: () => NOW,
    });
    await expect(processor(jobFor(runId))).rejects.toThrow('boom');
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.status).toBe('running');
    expect(run?.perSourceOutcomes).toHaveLength(0);
  });
});
