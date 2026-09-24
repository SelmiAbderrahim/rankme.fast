import { describe, expect, it } from 'vitest';
import { appSeoChartsReducer, initialAppSeoChartsState } from './charts-slice';
import { createAppChart, loadTrackedAppCharts } from './charts-thunks';
import { appSeoListingReducer, initialAppSeoListingState } from './listing-slice';
import { loadAppListingHistory, previewAppListingRun } from './listing-thunks';
import { appSeoResearchReducer, initialAppSeoResearchState } from './research-slice';
import { previewAppResearchSpend } from './research-thunks';
import {
  appSeoReviewsReducer,
  initialAppSeoReviewsState,
  selectAppReviewRun,
} from './reviews-slice';
import { loadAppReviewRuns, previewAppReviewRun } from './reviews-thunks';
import { appSeoTrackingReducer, initialAppSeoTrackingState } from './tracking-slice';
import { loadTrackedAppKeywordHistory, previewTrackedAppKeywordMint } from './tracking-thunks';

const error = new Error('transport failed');

describe('App SEO reducer rejection fallbacks', () => {
  it('uses empty error text when chart thunks reject without a payload', () => {
    const load = appSeoChartsReducer(
      initialAppSeoChartsState,
      loadTrackedAppCharts.rejected(error, 'chart-load', {
        siteId: 'site-one',
        profileId: 'profile-one',
      }),
    );
    const mutation = appSeoChartsReducer(
      initialAppSeoChartsState,
      createAppChart.rejected(error, 'chart-create', {
        siteId: 'site-one',
        input: {
          profileId: 'profile-one',
          store: 'google_play',
          chartId: 'top_free',
          categoryId: 'APPLICATION',
        },
      }),
    );
    expect(load.error).toBe('');
    expect(mutation.error).toBe('');
  });

  it('uses empty error text when listing and research thunks reject without a payload', () => {
    const listingRead = appSeoListingReducer(
      initialAppSeoListingState,
      loadAppListingHistory.rejected(error, 'listing-history', {
        siteId: 'site-one',
        profileId: 'profile-one',
      }),
    );
    const listingMutation = appSeoListingReducer(
      initialAppSeoListingState,
      previewAppListingRun.rejected(error, 'listing-preview', {
        siteId: 'site-one',
        input: { profileId: 'profile-one' },
      }),
    );
    const researchMutation = appSeoResearchReducer(
      initialAppSeoResearchState,
      previewAppResearchSpend.rejected(error, 'research-preview', {
        siteId: 'site-one',
        profileId: 'profile-one',
        store: 'google_play',
        surface: 'keywords',
      }),
    );
    expect(listingRead.error).toBe('');
    expect(listingMutation.error).toBe('');
    expect(researchMutation.error).toBe('');
  });

  it('preserves matching review detail and covers payload-free review failures', () => {
    const selected = appSeoReviewsReducer(
      {
        ...initialAppSeoReviewsState,
        selectedRunId: 'run-one',
        selectedRun: {
          id: 'run-one',
          profileId: 'profile-one',
          store: 'google_play',
          status: 'queued',
          clusterState: 'pending',
          reviewCount: 0,
          averageRating: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          completedAt: null,
          locationCode: 2840,
          languageCode: 'en',
          stats: null,
          clusters: [],
          observationMeta: { sourceKind: 'provider_observation' },
        },
      },
      selectAppReviewRun('run-one'),
    );
    const load = appSeoReviewsReducer(
      initialAppSeoReviewsState,
      loadAppReviewRuns.rejected(error, 'review-load', {
        siteId: 'site-one',
        profileId: 'profile-one',
        store: 'google_play',
      }),
    );
    const mutation = appSeoReviewsReducer(
      initialAppSeoReviewsState,
      previewAppReviewRun.rejected(error, 'review-preview', {
        siteId: 'site-one',
        input: { profileId: 'profile-one', store: 'google_play' },
      }),
    );
    expect(selected.selectedRun?.id).toBe('run-one');
    expect(load.error).toBe('');
    expect(mutation.error).toBe('');
  });

  it('uses empty error text when tracking thunks reject without a payload', () => {
    const history = appSeoTrackingReducer(
      initialAppSeoTrackingState,
      loadTrackedAppKeywordHistory.rejected(error, 'keyword-history', {
        siteId: 'site-one',
        keywordId: 'keyword-one',
      }),
    );
    const mutation = appSeoTrackingReducer(
      initialAppSeoTrackingState,
      previewTrackedAppKeywordMint.rejected(error, 'keyword-preview', {
        siteId: 'site-one',
        profileId: 'profile-one',
        input: {
          phrase: 'coffee app',
          store: 'google_play',
          locationCode: 2840,
          languageCode: 'en',
        },
      }),
    );
    expect(history.error).toBe('');
    expect(mutation.error).toBe('');
  });
});
