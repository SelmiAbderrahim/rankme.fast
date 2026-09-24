import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildObservationMeta } from '../../shared/observations/observations.js';
import type { AppReview } from '../../shared/providers/index.js';
import type * as ReviewsModel from './reviews.model.js';

const mocked = vi.hoisted(() => ({
  aiRun: vi.fn(),
  profileFind: vi.fn(),
  providerReviews: vi.fn(),
  runFind: vi.fn(),
  runFindUpdate: vi.fn(),
  runUpdate: vi.fn(),
  siteFind: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { findOne: mocked.siteFind } }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));
vi.mock('./reviews.model.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ReviewsModel>();
  return {
    ...actual,
    AppReviewRun: {
      findOne: mocked.runFind,
      findOneAndUpdate: mocked.runFindUpdate,
      updateOne: mocked.runUpdate,
    },
  };
});

import {
  APP_REVIEW_CLUSTER_PROFILE_NAME,
  appReviewProcessorTestables as internals,
  computeAppReviewStats,
  createAppReviewProcessor,
  enforceAppReviewClusters,
  normalizeAppReviews,
  onAppReviewJobExhausted,
} from './reviews.processor.js';

const accountId = '507f1f77bcf86cd799439010';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const runId = '507f1f77bcf86cd799439013';
const playAppId = 'com.example.rankme';
const appStoreId = '123456789';
const NOW = new Date('2026-08-12T12:00:00.000Z');
const observationMeta = buildObservationMeta({
  sourceKind: 'provider_observation',
  sourceLabel: 'dataforseo',
  observedAt: NOW,
  market: { country: 'US', region: null, city: null, language: 'en', device: 'mobile' },
  sampleCount: 10,
  coverageNoteKey: 'observations.coverage.partialResult',
});

function rawReviews(count: number): AppReview[] {
  return Array.from({ length: count }, (_, index) => ({
    reviewId: `vendor-${index + 1}`,
    rating: (index % 5) + 1,
    title: index % 2 === 0 ? `Title ${index + 1}` : null,
    text: `Feedback ${index + 1} is deterministic and useful.`,
    authorDisplayName: index % 2 === 0 ? `Author ${index + 1}` : null,
    reviewedAt: index % 2 === 0 ? new Date(2026, index % 12, 1).toISOString() : null,
  }));
}

function page(count: number) {
  return {
    store: 'google_play' as const,
    appId: playAppId,
    title: 'RankMe fixture',
    rating: 4.2,
    reviewCount: count,
    rows: rawReviews(count),
    locationCode: 2840,
    languageCode: 'en',
    observationMeta: { ...observationMeta, sampleCount: count },
  };
}

function run(input: {
  status?: 'queued' | 'pulling' | 'clustering' | 'completed' | 'failed';
  store?: 'google_play' | 'app_store';
  reviews?: ReturnType<typeof normalizeAppReviews>;
  stats?: ReturnType<typeof computeAppReviewStats> | null;
  clusters?: unknown[];
  observation?: typeof observationMeta | null;
} = {}) {
  return {
    _id: runId,
    accountId,
    siteId,
    profileId,
    store: input.store ?? 'google_play',
    locationCode: 2840,
    languageCode: 'en',
    locale: 'en',
    status: input.status ?? 'queued',
    reviews: input.reviews ?? [],
    stats: input.stats === undefined ? null : input.stats,
    clusters: input.clusters ?? [],
    clusterState: 'pending',
    observationMeta: input.observation === undefined ? null : input.observation,
    aiPassStartedAt: null,
  };
}

function selected(value: unknown) {
  return { select: vi.fn().mockResolvedValue(value) };
}

function job(data: unknown = { accountId, siteId, profileId, runId }) {
  return { data };
}

function deps(input: { now?: () => Date } = {}) {
  return {
    provider: { getAppReviews: mocked.providerReviews },
    ai: { run: mocked.aiRun },
    aiProviderOrder: ['fake'] as const,
    ...(input.now === undefined ? { now: () => NOW } : { now: input.now }),
  };
}

function generatedClusters(input: { valid?: boolean; label?: string } = {}) {
  return {
    object: {
      clusters: input.valid === false ? [{
        label: 'Unsupported', sentiment: 'neutral' as const,
        citedReviewIds: ['review-001', 'missing-review'],
        quotes: [{ reviewId: 'review-001', quote: 'Feedback 1' }],
      }] : [{
        label: input.label ?? '  Reliable support  ', sentiment: 'positive' as const,
        citedReviewIds: ['review-001', 'review-002'],
        quotes: [
          { reviewId: 'review-001', quote: 'Feedback 1' },
          { reviewId: 'review-002', quote: 'Feedback 2' },
        ],
      }],
      citations: ['review-001', 'review-002'],
    },
    provenance: { actualOrEstimatedCostMicros: 1_234n },
  };
}

function retained(count: number, input: { observation?: typeof observationMeta | null } = {}) {
  const reviews = normalizeAppReviews(rawReviews(count));
  return run({
    status: 'clustering',
    reviews,
    stats: computeAppReviewStats(reviews),
    observation: input.observation === undefined ? observationMeta : input.observation,
  });
}

beforeEach(() => {
  mocked.aiRun.mockReset().mockResolvedValue(generatedClusters());
  mocked.profileFind.mockReset().mockReturnValue(selected({ playPackageId: playAppId, appStoreId }));
  mocked.providerReviews.mockReset().mockResolvedValue(page(3));
  mocked.runFind.mockReset().mockResolvedValue(run());
  mocked.runFindUpdate.mockReset().mockResolvedValue(null);
  mocked.runUpdate.mockReset().mockResolvedValue({ modifiedCount: 1 });
  mocked.siteFind.mockReset().mockReturnValue(selected({ _id: siteId }));
});

describe('app review deterministic helpers', () => {
  it('clamps bounded review fields, ratings, dates, ids, and the three-hundred-row ceiling', () => {
    const rows = [
      {
        ...rawReviews(1)[0]!,
        rating: -2,
        title: 't'.repeat(701),
        text: 'x'.repeat(20_001),
        authorDisplayName: 'a'.repeat(301),
        reviewedAt: NOW.toISOString(),
      },
      { ...rawReviews(1)[0]!, rating: 9, title: null, authorDisplayName: null, reviewedAt: null },
      ...rawReviews(300),
    ];
    const normalized = normalizeAppReviews(rows);
    expect(normalized).toHaveLength(300);
    expect(normalized[0]).toMatchObject({
      id: 'review-001', rating: 0, title: 't'.repeat(700), text: 'x'.repeat(20_000),
      authorName: 'a'.repeat(300), at: NOW,
    });
    expect(normalized[1]).toMatchObject({
      id: 'review-002', rating: 5, title: null, authorName: null, at: null,
    });
    expect(normalized.at(-1)?.id).toBe('review-300');
    expect(internals.clampText('short', 10)).toBe('short');
    expect(internals.clampText('too long', 3)).toBe('too');
  });

  it('computes exact empty, sentiment, histogram, invalid-date, and rolling-month statistics', () => {
    expect(computeAppReviewStats([])).toEqual({
      total: 0,
      averageRating: null,
      histogram: [1, 2, 3, 4, 5].map((star) => ({ star, count: 0 })),
      ratingMix: { positive: 0, neutral: 0, negative: 0 },
      volumeTrend: [],
    });
    const dated: Array<{ rating: number; at: Date | null }> = Array.from(
      { length: 26 },
      (_, index) => ({
      rating: index % 3 === 0 ? 5 : index % 3 === 1 ? 3 : 1,
      at: new Date(Date.UTC(2024 + Math.floor(index / 12), index % 12, 1)),
      }),
    );
    dated.push({ rating: 0, at: new Date('invalid') }, { rating: 5, at: null });
    const stats = computeAppReviewStats(dated);
    expect(stats.total).toBe(28);
    expect(stats.ratingMix).toEqual({ positive: 10, neutral: 9, negative: 9 });
    expect(stats.histogram[0]?.count).toBe(9);
    expect(stats.histogram[4]?.count).toBe(10);
    expect(stats.volumeTrend).toHaveLength(24);
    expect(stats.volumeTrend[0]?.period).toBe('2024-03');
  });

  it('keeps only clusters with complete stored citations and exact per-review quotes', () => {
    const reviews = [
      { id: 'review-001', text: 'Fast support and clear answers.' },
      { id: 'review-002', text: 'Clear reports every week.' },
      { id: 'review-003', text: '' },
    ];
    const generated = [
      { label: 'one citation', sentiment: 'neutral' as const, citedReviewIds: ['review-001'], quotes: [] },
      { label: 'unknown', sentiment: 'negative' as const, citedReviewIds: ['review-001', 'missing'], quotes: [] },
      {
        label: 'bad quotes', sentiment: 'mixed' as const,
        citedReviewIds: ['review-001', 'review-002'],
        quotes: [
          { reviewId: 'other', quote: 'ignored' },
          { reviewId: 'review-001', quote: 'Fast support' },
          { reviewId: 'review-001', quote: 'duplicate' },
          { reviewId: 'review-002', quote: 'paraphrase' },
        ],
      },
      {
        label: 'empty text', sentiment: 'neutral' as const,
        citedReviewIds: ['review-001', 'review-003'],
        quotes: [
          { reviewId: 'review-001', quote: 'Fast support' },
          { reviewId: 'review-003', quote: '' },
        ],
      },
      {
        label: '  Good support  ', sentiment: 'positive' as const,
        citedReviewIds: ['review-001', 'review-002', 'review-001'],
        quotes: [
          { reviewId: 'review-001', quote: 'Fast support' },
          { reviewId: 'review-002', quote: 'Clear reports' },
        ],
      },
      {
        label: '   ', sentiment: 'positive' as const,
        citedReviewIds: ['review-001', 'review-002'],
        quotes: [
          { reviewId: 'review-001', quote: 'Fast support' },
          { reviewId: 'review-002', quote: 'Clear reports' },
        ],
      },
    ];
    expect(enforceAppReviewClusters(generated, reviews, observationMeta)).toEqual([{
      label: 'Good support',
      sentiment: 'positive',
      citedReviewIds: ['review-001', 'review-002'],
      quotes: [
        { reviewId: 'review-001', quote: 'Fast support' },
        { reviewId: 'review-002', quote: 'Clear reports' },
      ],
      observationMeta,
    }]);
  });

  it('uses injected time and a real current-time fallback', () => {
    expect(internals.processorNow(() => NOW)).toBe(NOW);
    const before = Date.now();
    expect(internals.processorNow().getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('app review processing before vendor evidence', () => {
  it('rejects malformed queue data and treats missing or terminal runs as idempotent', async () => {
    const process = createAppReviewProcessor(deps());
    await expect(process(job({ unsafe: true }))).rejects.toThrow();
    mocked.runFind.mockResolvedValueOnce(null);
    await expect(process(job())).resolves.toEqual({
      runId, status: 'already_terminal', reviewCount: 0, clusterCount: 0,
    });
    mocked.runFind.mockResolvedValueOnce(run({
      status: 'completed', reviews: normalizeAppReviews(rawReviews(2)), clusters: [{ id: 1 }],
    }));
    await expect(process(job())).resolves.toMatchObject({
      status: 'already_terminal', reviewCount: 2, clusterCount: 1,
    });
    mocked.runFind.mockResolvedValueOnce(run({ status: 'failed' }));
    await expect(process(job())).resolves.toMatchObject({ status: 'already_terminal' });
  });

  it('fails missing site, profile, and store identifiers without vendor spend', async () => {
    const process = createAppReviewProcessor(deps());
    mocked.siteFind.mockReturnValueOnce(selected(null));
    await expect(process(job())).resolves.toMatchObject({ status: 'failed' });
    mocked.profileFind.mockReturnValueOnce(selected(null));
    await expect(process(job())).resolves.toMatchObject({ status: 'failed' });
    mocked.profileFind.mockReturnValueOnce(selected({ playPackageId: null, appStoreId }));
    await expect(process(job())).resolves.toMatchObject({ status: 'failed' });
    mocked.runFind.mockResolvedValueOnce(run({ store: 'app_store' }));
    mocked.profileFind.mockReturnValueOnce(selected({ playPackageId: playAppId, appStoreId: null }));
    await expect(process(job())).resolves.toMatchObject({ status: 'failed' });
    expect(mocked.runUpdate).toHaveBeenCalledTimes(8);
    expect(mocked.runUpdate).toHaveBeenLastCalledWith(
      { _id: runId, accountId, status: { $in: ['queued', 'pulling'] } },
      { $set: { status: 'failed', clusterState: 'unavailable', completedAt: NOW } },
    );
    expect(mocked.providerReviews).not.toHaveBeenCalled();
  });

  it('fails on provider failure and preserves an idempotent winner after vendor persistence races', async () => {
    const process = createAppReviewProcessor(deps());
    mocked.providerReviews.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(process(job())).resolves.toMatchObject({ status: 'failed' });

    mocked.runUpdate.mockClear();
    mocked.runFindUpdate.mockResolvedValueOnce(null);
    await expect(process(job())).resolves.toEqual({
      runId, status: 'already_terminal', reviewCount: 0, clusterCount: 0,
    });
    expect(mocked.runUpdate).toHaveBeenCalledOnce();
    expect(mocked.runUpdate).toHaveBeenCalledWith(
      { _id: runId, accountId, status: 'queued' },
      { $set: { status: 'pulling', startedAt: NOW } },
    );
  });
});

describe('app review evidence and AI settlement', () => {
  it('stores deterministic provider evidence and completes thin samples without AI', async () => {
    const reviews = normalizeAppReviews(rawReviews(3));
    const persisted = retained(3);
    mocked.runFindUpdate.mockResolvedValueOnce(persisted);
    const process = createAppReviewProcessor(deps());
    await expect(process(job())).resolves.toEqual({
      runId, status: 'completed', reviewCount: 3, clusterCount: 0,
    });
    expect(mocked.providerReviews).toHaveBeenCalledWith({
      store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en', depth: 300,
    });
    expect(mocked.runFindUpdate).toHaveBeenCalledWith(expect.any(Object), {
      $set: expect.objectContaining({
        reviews,
        stats: computeAppReviewStats(reviews),
        observationMeta: expect.objectContaining({ sourceLabel: 'dataforseo' }),
        status: 'clustering',
      }),
    }, { new: true, runValidators: true });
    expect(mocked.aiRun).not.toHaveBeenCalled();
  });

  it('resumes retained evidence, and an already-claimed AI pass settles unavailable without a second dispatch', async () => {
    const retainedRun = retained(10);
    mocked.runFind.mockResolvedValueOnce(retainedRun);
    mocked.runFindUpdate.mockResolvedValueOnce(null);
    await expect(createAppReviewProcessor(deps())(job())).resolves.toEqual({
      runId, status: 'completed', reviewCount: 10, clusterCount: 0,
    });
    expect(mocked.providerReviews).not.toHaveBeenCalled();
    expect(mocked.aiRun).not.toHaveBeenCalled();

    mocked.runFind.mockResolvedValueOnce(run({
      status: 'clustering', reviews: retainedRun.reviews,
      stats: null, observation: observationMeta,
    }));
    mocked.providerReviews.mockResolvedValueOnce(page(3));
    mocked.runFindUpdate.mockResolvedValueOnce(retained(3));
    await expect(createAppReviewProcessor(deps())(job())).resolves.toMatchObject({ status: 'completed' });
  });

  it('settles AI failure as completed while keeping retained evidence', async () => {
    const retainedRun = retained(10);
    mocked.runFind.mockResolvedValueOnce(retainedRun);
    mocked.runFindUpdate.mockResolvedValueOnce(retainedRun);
    mocked.aiRun.mockRejectedValueOnce(new Error('AI unavailable'));
    await expect(createAppReviewProcessor(deps())(job())).resolves.toEqual({
      runId, status: 'completed', reviewCount: 10, clusterCount: 0,
    });
    expect(mocked.runUpdate).toHaveBeenLastCalledWith(expect.any(Object), {
      $set: expect.objectContaining({ status: 'completed', clusterState: 'unavailable', clusters: [] }),
    });
  });

  it('persists citation-safe clusters, AI cost, market provenance, and nullable review inputs', async () => {
    const retainedRun = retained(10);
    mocked.runFind.mockResolvedValueOnce(retainedRun);
    mocked.runFindUpdate.mockResolvedValueOnce(retainedRun);
    const result = await createAppReviewProcessor(deps())(job());
    expect(result).toEqual({ runId, status: 'completed', reviewCount: 10, clusterCount: 1 });
    expect(mocked.aiRun).toHaveBeenCalledWith(expect.objectContaining({
      profile: APP_REVIEW_CLUSTER_PROFILE_NAME,
      locale: 'en',
      correlationId: `app-review-clusters-${runId}`,
      configuredProviderOrder: ['fake'],
      input: { reviews: expect.arrayContaining([
        expect.objectContaining({ title: expect.any(String), at: expect.any(String) }),
        expect.objectContaining({ title: null, at: null }),
      ]) },
    }));
    expect(mocked.runUpdate).toHaveBeenLastCalledWith(expect.any(Object), {
      $set: expect.objectContaining({
        status: 'completed', clusterState: 'available', aiCostMicros: 1234,
        clusters: [expect.objectContaining({
          label: 'Reliable support',
          observationMeta: expect.objectContaining({
            sourceKind: 'ai_interpretation',
            market: { country: 'US', region: null, city: null, language: 'en', device: 'mobile' },
          }),
        })],
      }),
    }, { runValidators: true });
  });

  it('marks rejected AI clusters as thin evidence and supports absent market provenance', async () => {
    const noMarket = { ...observationMeta, market: null };
    const retainedRun = retained(10, { observation: noMarket });
    mocked.runFind.mockResolvedValueOnce(retainedRun);
    mocked.runFindUpdate.mockResolvedValueOnce(retainedRun);
    mocked.aiRun.mockResolvedValueOnce(generatedClusters({ valid: false }));
    await expect(createAppReviewProcessor(deps())(job())).resolves.toEqual({
      runId, status: 'completed', reviewCount: 10, clusterCount: 0,
    });
    expect(mocked.runUpdate).toHaveBeenLastCalledWith(expect.any(Object), {
      $set: expect.objectContaining({ clusterState: 'thin_evidence', clusters: [] }),
    }, { runValidators: true });
  });
});

describe('app review exhausted-job settlement', () => {
  it('ignores absent, malformed, missing, completed, and failed jobs', async () => {
    await onAppReviewJobExhausted(undefined, { now: () => NOW });
    await onAppReviewJobExhausted(job({ unsafe: true }), { now: () => NOW });
    mocked.runFind.mockResolvedValueOnce(null);
    await onAppReviewJobExhausted(job(), { now: () => NOW });
    mocked.runFind.mockResolvedValueOnce(run({ status: 'completed' }));
    await onAppReviewJobExhausted(job(), { now: () => NOW });
    mocked.runFind.mockResolvedValueOnce(run({ status: 'failed' }));
    await onAppReviewJobExhausted(job(), { now: () => NOW });
    expect(mocked.runUpdate).not.toHaveBeenCalled();
  });

  it('completes a run with retained evidence and fails a run with no evidence', async () => {
    mocked.runFind.mockResolvedValueOnce(retained(10));
    await onAppReviewJobExhausted(job(), { now: () => NOW });
    expect(mocked.runUpdate).toHaveBeenLastCalledWith({ _id: runId, accountId }, {
      $set: { status: 'completed', clusterState: 'unavailable', completedAt: NOW },
    });

    mocked.runFind.mockResolvedValueOnce(run());
    await onAppReviewJobExhausted(job());
    expect(mocked.runUpdate).toHaveBeenLastCalledWith({ _id: runId, accountId }, {
      $set: { status: 'failed', clusterState: 'unavailable', completedAt: expect.any(Date) },
    });
  });
});
