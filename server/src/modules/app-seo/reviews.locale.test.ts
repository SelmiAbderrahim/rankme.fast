import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import type * as ReviewsModel from './reviews.model.js';

const mocked = vi.hoisted(() => ({
  aiRun: vi.fn(),
  providerReviews: vi.fn(),
  runFind: vi.fn(),
  runFindUpdate: vi.fn(),
  runUpdate: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { findOne: vi.fn() } }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: vi.fn() } }));
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

import { APP_REVIEW_CLUSTER_PROFILE_NAME, createAppReviewProcessor } from './reviews.processor.js';

const accountId = '507f1f77bcf86cd799439010';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const observationMeta = {
  sourceKind: 'provider_observation',
  sourceLabel: 'fake',
  observedAt: '2026-08-12T12:00:00.000Z',
  freshUntil: null,
  freshness: 'fresh',
  market: { country: 'US', region: null, city: null, language: 'en', device: 'mobile' },
  sampleCount: 10,
  coverageNoteKey: null,
};

function retainedRun(locale: (typeof SUPPORTED_LOCALES)[number], runId: string) {
  return {
    _id: runId,
    accountId,
    siteId,
    profileId,
    store: 'google_play',
    locationCode: 2840,
    languageCode: 'en',
    locale,
    status: 'clustering',
    reviews: Array.from({ length: 10 }, (_, index) => ({
      id: `review-${index + 1}`,
      rating: 5,
      title: null,
      text: `SOURCE_REVIEW_${locale}_${index + 1}`,
      at: null,
    })),
    stats: { total: 10, averageRating: 5, ratingDistribution: { 5: 10 } },
    clusters: [],
    clusterState: 'pending',
    observationMeta,
    aiPassStartedAt: null,
  };
}

beforeEach(() => {
  mocked.aiRun.mockReset().mockResolvedValue({
    object: { clusters: [], citations: [] },
    provenance: { actualOrEstimatedCostMicros: 1_000n },
  });
  mocked.providerReviews.mockReset();
  mocked.runFind.mockReset();
  mocked.runFindUpdate.mockReset();
  mocked.runUpdate.mockReset().mockResolvedValue({ modifiedCount: 1 });
});

describe('App SEO review-cluster locale handoff', () => {
  it('passes every frozen run locale to AI without confusing market or source language', async () => {
    const processor = createAppReviewProcessor({
      provider: { getAppReviews: mocked.providerReviews } as never,
      ai: { run: mocked.aiRun } as never,
      aiProviderOrder: ['fake'],
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    });

    for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
      const runId = `507f1f77bcf86cd7994390${20 + index}`;
      const run = retainedRun(locale, runId);
      mocked.runFind.mockResolvedValueOnce(run);
      mocked.runFindUpdate.mockResolvedValueOnce(run);
      await processor({ data: { accountId, siteId, profileId, runId } });
    }

    expect(mocked.aiRun).toHaveBeenCalledTimes(SUPPORTED_LOCALES.length);
    expect(mocked.providerReviews).not.toHaveBeenCalled();
    for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
      const call = mocked.aiRun.mock.calls[index]?.[0];
      expect(call).toMatchObject({
        profile: APP_REVIEW_CLUSTER_PROFILE_NAME,
        locale,
      });
      expect(JSON.stringify(call.input)).toContain(`SOURCE_REVIEW_${locale}_1`);
      expect(call.input).not.toHaveProperty('languageCode');
    }
    expect(observationMeta.market.language).toBe('en');
  });
});
