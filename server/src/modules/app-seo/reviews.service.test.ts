import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';

const mocked = vi.hoisted(() => ({
  enqueue: vi.fn(),
  getQueue: vi.fn(),
  loadSite: vi.fn(),
  profileFind: vi.fn(),
  runCreate: vi.fn(),
  runFind: vi.fn(),
  runFindOne: vi.fn(),
  runLimit: vi.fn(),
  runSort: vi.fn(),
  runUpdate: vi.fn(),
}));

vi.mock('../sites/sites.guard.js', () => ({ loadOwnedSite: mocked.loadSite }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));
vi.mock('./reviews.model.js', () => ({
  AppReviewRun: {
    create: mocked.runCreate,
    find: mocked.runFind,
    findOne: mocked.runFindOne,
    updateOne: mocked.runUpdate,
  },
}));
vi.mock('../../shared/queue/index.js', () => ({ enqueueAppSeoReviewJob: mocked.enqueue }));
vi.mock('./keywords.queue-holder.js', () => ({ getAppSeoTrackingQueue: mocked.getQueue }));

import {
  appReviewServiceTestables as internals,
  createAppReviewRun,
  getAppReviewRun,
  listAppReviewRuns,
  previewAppReviewRun,
} from './reviews.service.js';

const accountId = '507f1f77bcf86cd799439010';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const runId = '507f1f77bcf86cd799439013';
const createdAt = new Date('2026-08-10T10:00:00.000Z');
const completedAt = new Date('2026-08-10T12:00:00.000Z');
const queue = { name: 'app-review-service-fixture' };
const observationMeta = {
  sourceKind: 'provider_observation',
  sourceLabel: 'dataforseo',
  observedAt: completedAt.toISOString(),
  freshUntil: null,
  freshness: 'unknown',
  market: { country: 'US', region: null, city: null, language: 'en', device: 'mobile' },
  sampleCount: 2,
  coverageNoteKey: 'observations.coverage.partialResult',
};

function profile(input: { playPackageId?: string | null; appStoreId?: string | null } = {}) {
  return {
    _id: profileId,
    playPackageId: input.playPackageId === undefined ? 'com.example.rankme' : input.playPackageId,
    appStoreId: input.appStoreId === undefined ? '123456789' : input.appStoreId,
  };
}

function reviewRun(input: {
  id?: string;
  status?: 'queued' | 'pulling' | 'clustering' | 'completed' | 'failed';
  stats?: Record<string, unknown> | null;
  completedAt?: Date | null;
  ratingMix?: { positive: number; neutral: number; negative: number };
} = {}) {
  const stats = input.stats === undefined ? {
    total: 2,
    averageRating: 4.25,
    histogram: [{ star: 1, count: 0 }, { star: 2, count: 0 }, { star: 3, count: 1 }, { star: 4, count: 0 }, { star: 5, count: 1 }],
    ratingMix: input.ratingMix ?? { positive: 1, neutral: 1, negative: 0 },
    volumeTrend: [{ period: '2026-08', count: 2, averageRating: 4.25 }],
  } : input.stats;
  return {
    _id: input.id ?? runId,
    accountId,
    siteId,
    profileId,
    store: 'google_play',
    locationCode: 2840,
    languageCode: 'en',
    locale: 'en',
    status: input.status ?? 'completed',
    reviews: [
      { id: 'review-001', rating: 5, title: 'Great', text: 'Fast support.', authorName: 'Ada', at: completedAt },
      { id: 'review-002', rating: 3.5, title: null, text: 'Clear reports.', authorName: null, at: null },
    ],
    stats,
    clusters: [{
      label: 'Support',
      sentiment: 'positive',
      citedReviewIds: ['review-001', 'review-002'],
      quotes: [
        { reviewId: 'review-001', quote: 'Fast support' },
        { reviewId: 'review-002', quote: 'Clear reports' },
        { reviewId: 'review-999', quote: 'Missing source' },
      ],
      observationMeta,
    }],
    clusterState: input.status === 'queued' ? 'pending' : 'available',
    observationMeta,
    aiCostMicros: 1234,
    aiPassStartedAt: completedAt,
    startedAt: createdAt,
    completedAt: input.completedAt === undefined ? completedAt : input.completedAt,
    createdAt,
    updatedAt: completedAt,
  };
}

function createInput(input: {
  confirm?: boolean;
  store?: 'google_play' | 'app_store';
} = {}) {
  return {
    accountId,
    siteId,
    locale: 'en' as const,
    run: {
      profileId,
      store: input.store ?? 'google_play',
      locationCode: 2840,
      languageCode: 'EN',
      confirm: input.confirm ?? true,
    },
  };
}

const originalFlags = {
  appSeo: env.APP_SEO_ENABLED,
  reviews: env.APP_REVIEWS_ENABLED,
};

beforeEach(() => {
  env.APP_SEO_ENABLED = true;
  env.APP_REVIEWS_ENABLED = true;
  mocked.enqueue.mockReset().mockResolvedValue(undefined);
  mocked.getQueue.mockReset().mockReturnValue(queue);
  mocked.loadSite.mockReset().mockResolvedValue({ id: siteId });
  mocked.profileFind.mockReset().mockResolvedValue(profile());
  mocked.runCreate.mockReset().mockImplementation(async (value) => reviewRun({ id: value._id, status: 'queued', stats: null, completedAt: null }));
  mocked.runFindOne.mockReset().mockResolvedValue(reviewRun());
  mocked.runLimit.mockReset().mockResolvedValue([]);
  mocked.runSort.mockReset().mockReturnValue({ limit: mocked.runLimit });
  mocked.runFind.mockReset().mockReturnValue({ sort: mocked.runSort });
  mocked.runUpdate.mockReset().mockResolvedValue({ modifiedCount: 1 });
});

afterEach(() => {
  env.APP_SEO_ENABLED = originalFlags.appSeo;
  env.APP_REVIEWS_ENABLED = originalFlags.reviews;
  vi.restoreAllMocks();
});

describe('app review gates, ownership, and preview', () => {
  it('evaluates both rollout flags and keeps stored reads independent from spend availability', () => {
    expect(internals.reviewsEnabled()).toBe(true);
    expect(() => internals.requireReviewsEnabled()).not.toThrow();
    env.APP_SEO_ENABLED = false;
    expect(internals.reviewsEnabled()).toBe(false);
    expect(() => internals.requireReviewsEnabled()).toThrow();
    env.APP_SEO_ENABLED = true;
    env.APP_REVIEWS_ENABLED = false;
    expect(internals.reviewsEnabled()).toBe(false);
    expect(() => internals.requireReviewsEnabled()).toThrow();
  });

  it('fails closed for invalid, missing, and store-incomplete profiles', async () => {
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId: 'invalid', store: 'google_play', allowPaused: false,
    })).rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(null);
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId, store: 'google_play', allowPaused: true,
    })).rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(profile({ playPackageId: null }));
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId, store: 'google_play', allowPaused: true,
    })).rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(profile({ appStoreId: null }));
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId, store: 'app_store', allowPaused: true,
    })).rejects.toMatchObject({ status: 404 });
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId, store: 'google_play', allowPaused: false,
    })).resolves.toMatchObject({ _id: profileId });
  });

  it('returns the community spend preview contract', () => {
    expect(previewAppReviewRun()).toEqual({
      deploymentMode: 'community', capacityEnforced: false,
    });
  });
});

describe('app review run creation', () => {
  it('previews without creating until confirmation', async () => {
    await expect(createAppReviewRun(createInput({ confirm: false }))).resolves.toEqual({
      preview: { deploymentMode: 'community', capacityEnforced: false },
      queued: false,
      run: null,
    });
    expect(mocked.runCreate).not.toHaveBeenCalled();
    expect(mocked.loadSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: false });
  });

  it('refuses confirmation while the rollout flag is off', async () => {
    env.APP_REVIEWS_ENABLED = false;
    await expect(createAppReviewRun(createInput())).rejects.toMatchObject({ status: 404 });
    expect(mocked.runCreate).not.toHaveBeenCalled();
  });

  it('creates normalized state and enqueues the immutable owner tuple', async () => {
    const result = await createAppReviewRun(createInput());
    expect(result).toMatchObject({
      queued: true,
      run: {
        profileId, store: 'google_play', status: 'queued', clusterState: 'pending',
        reviewCount: 2, averageRating: null, completedAt: null,
      },
    });
    const created = mocked.runCreate.mock.calls[0]?.[0];
    expect(created).toEqual({
      _id: expect.stringMatching(/^[a-f0-9]{24}$/u),
      accountId, siteId, profileId, store: 'google_play', locationCode: 2840,
      languageCode: 'en', locale: 'en', status: 'queued',
    });
    expect(mocked.enqueue).toHaveBeenCalledWith(queue, {
      accountId, siteId, profileId, runId: created._id,
    });
    expect(mocked.runCreate.mock.invocationCallOrder[0]).toBeLessThan(mocked.enqueue.mock.invocationCallOrder[0]!);
  });

  it('propagates Mongo creation failure without queue work', async () => {
    const failure = new Error('mongo unavailable');
    mocked.runCreate.mockRejectedValueOnce(failure);
    await expect(createAppReviewRun(createInput())).rejects.toBe(failure);
    expect(mocked.enqueue).not.toHaveBeenCalled();
  });

  it('settles failed state when the queue is absent or enqueue rejects', async () => {
    mocked.getQueue.mockReturnValueOnce(null);
    await expect(createAppReviewRun(createInput())).rejects.toMatchObject({
      status: 500, message: 'appSeo.errors.productUnavailable',
    });
    const firstId = mocked.runCreate.mock.calls[0]?.[0]._id;
    expect(mocked.runUpdate).toHaveBeenCalledWith(
      { _id: firstId, accountId, status: 'queued' },
      { $set: { status: 'failed', completedAt: expect.any(Date) } },
    );
    expect(mocked.enqueue).not.toHaveBeenCalled();

    const failure = new Error('redis unavailable');
    mocked.enqueue.mockRejectedValueOnce(failure);
    await expect(createAppReviewRun(createInput({ store: 'app_store' }))).rejects.toBe(failure);
    const secondId = mocked.runCreate.mock.calls[1]?.[0]._id;
    expect(mocked.runUpdate).toHaveBeenCalledTimes(2);
    expect(mocked.runUpdate).toHaveBeenLastCalledWith(
      { _id: secondId, accountId, status: 'queued' },
      { $set: { status: 'failed', completedAt: expect.any(Date) } },
    );
  });
});

describe('app review stored run reads', () => {
  it('validates optional profile scope and lists filtered and unfiltered runs with rollout state', async () => {
    await expect(listAppReviewRuns({
      accountId, siteId, profileId: 'invalid', limit: 10,
    })).rejects.toMatchObject({ status: 404 });

    mocked.runLimit.mockResolvedValueOnce([
      reviewRun(),
      reviewRun({ id: '507f1f77bcf86cd799439014', stats: null, completedAt: null, status: 'queued' }),
    ]);
    const unfiltered = await listAppReviewRuns({ accountId, siteId, limit: 10 });
    expect(mocked.runFind).toHaveBeenLastCalledWith({ accountId, siteId });
    expect(unfiltered).toEqual({ reviewsEnabled: true, items: expect.any(Array) });
    expect(unfiltered.items).toEqual([
      expect.objectContaining({ id: runId, reviewCount: 2, averageRating: 4.25, completedAt: completedAt.toISOString() }),
      expect.objectContaining({ averageRating: null, completedAt: null }),
    ]);

    mocked.runLimit.mockResolvedValueOnce([]);
    await listAppReviewRuns({ accountId, siteId, profileId, store: 'google_play', limit: 5 });
    expect(mocked.runFind).toHaveBeenLastCalledWith({ accountId, siteId, profileId, store: 'google_play' });
    expect(mocked.runLimit).toHaveBeenLastCalledWith(5);
  });

  it('returns a safe detail projection with exact citations and drops dangling quote references', async () => {
    await expect(getAppReviewRun({ accountId, siteId, runId: 'invalid' }))
      .rejects.toMatchObject({ status: 404 });
    mocked.runFindOne.mockResolvedValueOnce(null);
    await expect(getAppReviewRun({ accountId, siteId, runId }))
      .rejects.toMatchObject({ status: 404 });

    const result = await getAppReviewRun({ accountId, siteId, runId });
    expect(result).toMatchObject({
      id: runId,
      stats: {
        total: 2,
        averageRating: 4.25,
        histogram: expect.any(Array),
        ratingMix: { positive: 1, neutral: 1, negative: 0 },
        volumeTrend: [{ period: '2026-08', count: 2, averageRating: 4.25 }],
      },
      clusters: [{
        label: 'Support',
        citedReviewIds: ['review-001', 'review-002'],
        citations: [
          { reviewId: 'review-001', quote: 'Fast support', authorName: 'Ada', rating: 5, at: completedAt.toISOString() },
          { reviewId: 'review-002', quote: 'Clear reports', authorName: null, rating: 3.5, at: null },
        ],
        observationMeta,
      }],
      observationMeta,
    });
  });

  it('normalizes legacy missing rating-mix values and absent stats', async () => {
    const legacy = reviewRun();
    if (!legacy.stats) throw new Error('stats fixture missing');
    delete legacy.stats.ratingMix;
    delete legacy.stats.averageRating;
    mocked.runFindOne.mockResolvedValueOnce(legacy);
    await expect(getAppReviewRun({ accountId, siteId, runId })).resolves.toMatchObject({
      stats: {
        averageRating: null,
        ratingMix: { positive: 0, neutral: 0, negative: 0 },
      },
    });

    mocked.runFindOne.mockResolvedValueOnce(reviewRun({ stats: null }));
    await expect(getAppReviewRun({ accountId, siteId, runId })).resolves.toMatchObject({ stats: null });
  });
});
