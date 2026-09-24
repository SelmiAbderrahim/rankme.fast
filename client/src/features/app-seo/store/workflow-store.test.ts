import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import type { RootState } from '@app/store';
import type { AppChartListResponse, AppChartSubscription } from '../charts-types';
import type { AppSeoComparison } from '../compare-types';
import type { AppListingHistoryResponse, AppListingRunResponse } from '../listing-types';
import type {
  AppCompetitorResearchResult,
  AppGapResearchResult,
  AppKeywordResearchResult,
} from '../research-types';
import type { AppReviewRunDetail, AppReviewRunListResponse } from '../reviews-types';
import type { AppKeyword, AppKeywordListResponse } from '../tracking-types';

const trackingApi = vi.hoisted(() => ({
  createTrackedAppKeyword: vi.fn(),
  fetchAppKeywords: vi.fn(),
  fetchTrackedAppKeywordHistory: vi.fn(),
  previewMintAppKeyword: vi.fn(),
  recheckTrackedAppKeyword: vi.fn(),
  removeTrackedAppKeyword: vi.fn(),
}));
const chartsApi = vi.hoisted(() => ({
  createTrackedAppChart: vi.fn(),
  fetchAppChartSubscriptions: vi.fn(),
  fetchTrackedAppChartHistory: vi.fn(),
  recheckTrackedAppChart: vi.fn(),
  removeTrackedAppChart: vi.fn(),
}));
const listingApi = vi.hoisted(() => ({
  fetchAppListingHistory: vi.fn(),
  fetchLatestAppListing: vi.fn(),
  startAppListingRun: vi.fn(),
}));
const researchApi = vi.hoisted(() => ({
  fetchAppResearchPreview: vi.fn(),
  fetchLatestAppResearch: vi.fn(),
  submitAppCompetitorResearch: vi.fn(),
  submitAppGapResearch: vi.fn(),
  submitAppKeywordResearch: vi.fn(),
}));
const reviewsApi = vi.hoisted(() => ({
  fetchAppReviewRun: vi.fn(),
  fetchAppReviewRuns: vi.fn(),
  startAppReviewRun: vi.fn(),
}));
const compareApi = vi.hoisted(() => ({ fetchAppSeoComparison: vi.fn() }));

vi.mock('../tracking-api', () => trackingApi);
vi.mock('../charts-api', () => chartsApi);
vi.mock('../listing-api', () => listingApi);
vi.mock('../research-api', () => researchApi);
vi.mock('../reviews-api', () => reviewsApi);
vi.mock('../compare-api', () => compareApi);

import { selectAppSeoCharts } from './charts-selectors';
import {
  appSeoChartsReducer,
  clearAppSeoChartsPreview,
  initialAppSeoChartsState,
  selectAppChartSubscription,
} from './charts-slice';
import {
  confirmAppChartRecheck,
  createAppChart,
  deleteAppChart,
  loadAppChartHistory,
  loadTrackedAppCharts,
  previewAppChartRecheck,
} from './charts-thunks';
import { selectAppSeoCompare } from './compare-selectors';
import { appSeoCompareReducer, initialAppSeoCompareState } from './compare-slice';
import { loadAppSeoComparison } from './compare-thunks';
import { selectAppSeoListing } from './listing-selectors';
import {
  appSeoListingReducer,
  clearAppListingPreview,
  initialAppSeoListingState,
} from './listing-slice';
import {
  confirmAppListingRun,
  loadAppListingHistory,
  loadLatestAppListing,
  previewAppListingRun,
} from './listing-thunks';
import { selectAppSeoResearch } from './research-selectors';
import {
  appSeoResearchReducer,
  clearAppResearchPreview,
  initialAppSeoResearchState,
} from './research-slice';
import {
  loadLatestAppResearch,
  previewAppResearchSpend,
  runAppCompetitorResearch,
  runAppGapResearch,
  runAppKeywordResearch,
} from './research-thunks';
import { selectAppSeoReviews } from './reviews-selectors';
import {
  appSeoReviewsReducer,
  clearAppReviewPreview,
  initialAppSeoReviewsState,
  selectAppReviewRun,
} from './reviews-slice';
import {
  confirmAppReviewRun,
  loadAppReviewRunDetail,
  loadAppReviewRuns,
  previewAppReviewRun,
} from './reviews-thunks';
import { selectAppSeoTracking } from './tracking-selectors';
import {
  appSeoTrackingReducer,
  clearAppSeoTrackingPreview,
  initialAppSeoTrackingState,
  selectTrackedAppKeyword,
} from './tracking-slice';
import {
  confirmTrackedAppKeywordRecheck,
  deleteTrackedAppKeyword,
  loadTrackedAppKeywordHistory,
  loadTrackedAppKeywords,
  mintTrackedAppKeyword,
  previewTrackedAppKeywordMint,
  previewTrackedAppKeywordRecheck,
} from './tracking-thunks';

const keyword: AppKeyword = {
  id: 'keyword-one',
  profileId: 'profile-one',
  store: 'google_play',
  phrase: 'coffee app',
  locationCode: 2840,
  languageCode: 'en',
  active: true,
  latestPosition: null,
  previousPosition: 4,
  delta: null,
  lastCheckedAt: '2026-08-01T00:00:00.000Z',
  lastFailedCheckAt: null,
  checkStatus: 'idle',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const keywordList: AppKeywordListResponse = {
  items: [keyword],
  trackingEnabled: true,
};

const chart: AppChartSubscription = {
  id: 'chart-one',
  profileId: 'profile-one',
  store: 'app_store',
  chartId: 'top_free',
  categoryId: 'games',
  locationCode: 2840,
  languageCode: 'en',
  latestPosition: null,
  previousPosition: 3,
  delta: null,
  lastCheckedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const chartList: AppChartListResponse = {
  items: [chart],
  catalogs: {
    google_play: {
      store: 'google_play',
      charts: [{ id: 'topselling_free', nameKey: 'free' }],
      categories: [{ id: 'APPLICATION', nameKey: 'apps' }],
    },
    app_store: {
      store: 'app_store',
      charts: [{ id: 'top_free', nameKey: 'free' }],
      categories: [{ id: 'games', nameKey: 'games' }],
    },
  },
  limit: 4,
  trackingEnabled: true,
};

const listingPreview: AppListingRunResponse = {
  preview: {},
  queued: false,
  runId: null,
  capturedAt: null,
};

const listingHistory: AppListingHistoryResponse = {
  items: [
    {
      capturedAt: '2026-08-01T00:00:00.000Z',
      engineVersion: 'listing-v1',
      stores: ['google_play'],
      partial: true,
      findingCounts: { fixNow: 1, watch: 2, advisory: 3 },
    },
  ],
  listingEnabled: true,
};

const keywordResearch: AppKeywordResearchResult = {
  surface: 'keywords',
  profileId: 'profile-one',
  store: 'google_play',
  appId: 'com.example.app',
  rows: [],
  cursor: 0,
  nextCursor: null,
  totalRows: 0,
  cached: false,
  fetchedAt: '2026-08-01T00:00:00.000Z',
};

const gapResearch: AppGapResearchResult = {
  surface: 'gap',
  profileId: 'profile-one',
  store: 'google_play',
  ownAppId: 'com.example.app',
  appIds: ['com.example.app', 'com.example.other'],
  rows: [],
  cached: false,
  fetchedAt: '2026-08-01T00:00:00.000Z',
};

const rankingMetrics = {
  firstPositionCount: 0,
  secondToThirdPositionCount: 0,
  fourthToTenthPositionCount: 0,
  eleventhToHundredthPositionCount: 0,
  rankedKeywordCount: 0,
  rankingKeywordSearchVolume: 0,
};

const competitorResearch: AppCompetitorResearchResult = {
  surface: 'competitors',
  profileId: 'profile-one',
  store: 'google_play',
  appId: 'com.example.app',
  rows: [
    {
      competitor: {
        store: 'google_play',
        appId: 'com.example.other',
        averagePosition: null,
        summedPosition: null,
        sharedKeywordCount: 0,
        sharedKeywordMetrics: rankingMetrics,
        allKeywordMetrics: rankingMetrics,
        observationMeta: {},
      },
      metrics: null,
    },
  ],
  partial: true,
  noteKey: 'partial',
  cached: false,
  fetchedAt: '2026-08-01T00:00:00.000Z',
};

const reviewRun: AppReviewRunDetail = {
  id: 'review-one',
  profileId: 'profile-one',
  store: 'google_play',
  status: 'completed',
  clusterState: 'available',
  reviewCount: 4,
  averageRating: 4.5,
  createdAt: '2026-08-01T00:00:00.000Z',
  completedAt: '2026-08-01T01:00:00.000Z',
  locationCode: 2840,
  languageCode: 'en',
  stats: null,
  clusters: [],
  observationMeta: { sourceKind: 'provider_observation' },
};

const reviewList: AppReviewRunListResponse = {
  items: [reviewRun],
  reviewsEnabled: true,
};

const comparison: AppSeoComparison = {
  profile: {
    id: 'profile-one',
    paired: true,
    playPackageId: 'com.example.app',
    appStoreId: '123456',
  },
  pairingProvenance: 'user-paired',
  listings: { google_play: null, app_store: null },
  ratingDelta: null,
  reviewCountDelta: null,
  ranks: { shared: [], onlyGooglePlay: [], onlyAppStore: [] },
  listingParity: { findings: [], rawFields: [] },
  charts: [],
};

const makeStore = () =>
  configureStore({
    reducer: {
      appSeoTracking: appSeoTrackingReducer,
      appSeoCharts: appSeoChartsReducer,
      appSeoListing: appSeoListingReducer,
      appSeoResearch: appSeoResearchReducer,
      appSeoReviews: appSeoReviewsReducer,
      appSeoCompare: appSeoCompareReducer,
    },
  });

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  for (const mock of [
    ...Object.values(trackingApi),
    ...Object.values(chartsApi),
    ...Object.values(listingApi),
    ...Object.values(researchApi),
    ...Object.values(reviewsApi),
    ...Object.values(compareApi),
  ]) {
    mock.mockReset();
  }
});

describe('App SEO tracking store', () => {
  it('covers list identity, mint/delete, recheck, selection, history, and clear', async () => {
    trackingApi.fetchAppKeywords.mockResolvedValue(keywordList);
    trackingApi.previewMintAppKeyword.mockResolvedValue({ check: {} });
    trackingApi.createTrackedAppKeyword.mockResolvedValue({ ...keyword, id: 'keyword-two' });
    trackingApi.removeTrackedAppKeyword.mockResolvedValue(undefined);
    trackingApi.recheckTrackedAppKeyword
      .mockResolvedValueOnce({ preview: {}, queued: false, reservationStamp: null })
      .mockResolvedValueOnce({ preview: {}, queued: true, reservationStamp: 'stamp' });
    trackingApi.fetchTrackedAppKeywordHistory.mockResolvedValue([
      {
        checkedAt: '2026-08-01T00:00:00.000Z',
        position: null,
        rankAbsolute: null,
        foundAppId: null,
      },
    ]);
    const store = makeStore();

    await store.dispatch(loadTrackedAppKeywords({ siteId: 'site-one', profileId: 'profile-one' }));
    await store.dispatch(loadTrackedAppKeywords({ siteId: 'site-one', profileId: 'profile-one' }));
    await store.dispatch(
      previewTrackedAppKeywordMint({
        siteId: 'site-one',
        profileId: 'profile-one',
        input: { phrase: 'coffee app', store: 'google_play' },
      }),
    );
    await store.dispatch(
      mintTrackedAppKeyword({
        siteId: 'site-one',
        profileId: 'profile-one',
        input: { phrase: 'coffee app', store: 'google_play' },
      }),
    );
    expect(store.getState().appSeoTracking.items.map(({ id }) => id)).toEqual([
      'keyword-two',
      'keyword-one',
    ]);
    await store.dispatch(
      previewTrackedAppKeywordRecheck({ siteId: 'site-one', keywordId: 'keyword-two' }),
    );
    await store.dispatch(
      confirmTrackedAppKeywordRecheck({ siteId: 'site-one', keywordId: 'keyword-two' }),
    );
    store.dispatch(selectTrackedAppKeyword('keyword-two'));
    await store.dispatch(
      loadTrackedAppKeywordHistory({ siteId: 'site-one', keywordId: 'keyword-two' }),
    );
    expect(store.getState().appSeoTracking.history[0]?.position).toBeNull();
    await store.dispatch(deleteTrackedAppKeyword({ siteId: 'site-one', keywordId: 'keyword-two' }));
    expect(store.getState().appSeoTracking.items.map(({ id }) => id)).toEqual(['keyword-one']);
    store.dispatch(selectTrackedAppKeyword(null));
    store.dispatch(clearAppSeoTrackingPreview());
    expect(store.getState().appSeoTracking).toMatchObject({
      selectedKeywordId: null,
      history: [],
      historyStatus: 'idle',
      mintPreview: null,
      recheckPreview: null,
      mutationStatus: 'idle',
      error: '',
    });
  });
});

describe('App SEO charts store', () => {
  it('covers list identity, create/delete, preview/confirm, selection, history, and clear', async () => {
    chartsApi.fetchAppChartSubscriptions.mockResolvedValue(chartList);
    chartsApi.createTrackedAppChart.mockResolvedValue({ ...chart, id: 'chart-two' });
    chartsApi.removeTrackedAppChart.mockResolvedValue(undefined);
    chartsApi.recheckTrackedAppChart
      .mockResolvedValueOnce({ preview: {}, queued: false, reservationStamp: null })
      .mockResolvedValueOnce({ preview: {}, queued: true, reservationStamp: 'stamp' });
    chartsApi.fetchTrackedAppChartHistory.mockResolvedValue([
      { checkedAt: '2026-08-01T00:00:00.000Z', position: null },
    ]);
    const store = makeStore();
    await store.dispatch(loadTrackedAppCharts({ siteId: 'site-one', profileId: 'profile-one' }));
    await store.dispatch(loadTrackedAppCharts({ siteId: 'site-one', profileId: 'profile-one' }));
    const input = {
      profileId: 'profile-one',
      store: 'app_store' as const,
      chartId: 'top_free',
      categoryId: 'games',
    };
    await store.dispatch(createAppChart({ siteId: 'site-one', input }));
    await store.dispatch(
      previewAppChartRecheck({ siteId: 'site-one', subscriptionId: 'chart-two' }),
    );
    await store.dispatch(
      confirmAppChartRecheck({ siteId: 'site-one', subscriptionId: 'chart-two' }),
    );
    store.dispatch(selectAppChartSubscription('chart-two'));
    await store.dispatch(loadAppChartHistory({ siteId: 'site-one', subscriptionId: 'chart-two' }));
    await store.dispatch(deleteAppChart({ siteId: 'site-one', subscriptionId: 'chart-two' }));
    store.dispatch(selectAppChartSubscription(null));
    store.dispatch(clearAppSeoChartsPreview());
    expect(store.getState().appSeoCharts).toMatchObject({
      items: [chart],
      selectedSubscriptionId: null,
      history: [],
      recheckPreview: null,
      mutationStatus: 'idle',
    });
  });
});

describe('App SEO listing and research stores', () => {
  it('covers listing latest/history identity, preview/confirm, and clear', async () => {
    listingApi.fetchLatestAppListing.mockResolvedValue({
      report: null,
      listingEnabled: false,
    });
    listingApi.fetchAppListingHistory.mockResolvedValue(listingHistory);
    listingApi.startAppListingRun.mockResolvedValueOnce(listingPreview).mockResolvedValueOnce({
      ...listingPreview,
      queued: true,
      runId: 'listing-one',
    });
    const store = makeStore();
    await store.dispatch(loadLatestAppListing({ siteId: 'site-one', profileId: 'profile-one' }));
    await store.dispatch(loadLatestAppListing({ siteId: 'site-one', profileId: 'profile-one' }));
    await store.dispatch(
      loadAppListingHistory({ siteId: 'site-two', profileId: 'profile-two', limit: 3 }),
    );
    await store.dispatch(loadAppListingHistory({ siteId: 'site-two', profileId: 'profile-two' }));
    await store.dispatch(
      previewAppListingRun({
        siteId: 'site-one',
        input: { profileId: 'profile-one' },
      }),
    );
    await store.dispatch(
      confirmAppListingRun({
        siteId: 'site-one',
        input: { profileId: 'profile-one' },
      }),
    );
    expect(listingApi.startAppListingRun.mock.calls).toEqual([
      ['site-one', { profileId: 'profile-one', confirm: false }],
      ['site-one', { profileId: 'profile-one', confirm: true }],
    ]);
    store.dispatch(clearAppListingPreview());
    expect(store.getState().appSeoListing).toMatchObject({
      history: listingHistory.items,
      preview: null,
      mutationStatus: 'idle',
      error: '',
    });
  });

  it('loads all research surfaces, previews optional app IDs, runs each surface, and clears', async () => {
    researchApi.fetchLatestAppResearch
      .mockResolvedValueOnce({
        result: keywordResearch,
        researchEnabled: true,
      })
      .mockResolvedValueOnce({
        result: gapResearch,
        researchEnabled: true,
      })
      .mockResolvedValueOnce({
        result: competitorResearch,
        researchEnabled: false,
      });
    researchApi.fetchAppResearchPreview.mockResolvedValue({
      preview: {},
    });
    researchApi.submitAppKeywordResearch.mockResolvedValue(keywordResearch);
    researchApi.submitAppGapResearch.mockResolvedValue(gapResearch);
    researchApi.submitAppCompetitorResearch.mockResolvedValue(competitorResearch);
    const store = makeStore();
    for (const surface of ['keywords', 'gap', 'competitors'] as const) {
      await store.dispatch(
        loadLatestAppResearch({
          siteId: 'site-one',
          profileId: 'profile-one',
          store: 'google_play',
          surface,
        }),
      );
    }
    await store.dispatch(
      previewAppResearchSpend({
        siteId: 'site-one',
        profileId: 'profile-one',
        store: 'google_play',
        surface: 'gap',
        appIds: ['com.example.app', 'com.example.other'],
      }),
    );
    const base = {
      profileId: 'profile-one',
      store: 'google_play' as const,
      locationCode: 2840 as const,
      languageCode: 'en' as const,
    };
    await store.dispatch(
      runAppKeywordResearch({ siteId: 'site-one', input: { ...base, cursor: 0, pageSize: 25 } }),
    );
    await store.dispatch(
      runAppGapResearch({
        siteId: 'site-one',
        input: { ...base, appIds: ['com.example.app', 'com.example.other'] },
      }),
    );
    await store.dispatch(runAppCompetitorResearch({ siteId: 'site-one', input: base }));
    store.dispatch(clearAppResearchPreview());
    expect(store.getState().appSeoResearch).toMatchObject({
      results: {
        keywords: keywordResearch,
        gap: gapResearch,
        competitors: competitorResearch,
      },
      researchEnabled: false,
      preview: null,
      mutationStatus: 'idle',
    });
  });
});

describe('App SEO review and comparison stores', () => {
  it('covers review list identity, detail replacement/miss, preview, queued/no-run confirm, selection, and clear', async () => {
    reviewsApi.fetchAppReviewRuns.mockResolvedValue(reviewList);
    reviewsApi.fetchAppReviewRun.mockResolvedValue(reviewRun);
    reviewsApi.startAppReviewRun
      .mockResolvedValueOnce({ preview: {}, queued: false, run: null })
      .mockResolvedValueOnce({ preview: {}, queued: true, run: reviewRun })
      .mockResolvedValueOnce({ preview: {}, queued: true, run: null });
    const store = makeStore();
    await store.dispatch(
      loadAppReviewRuns({ siteId: 'site-one', profileId: 'profile-one', store: 'google_play' }),
    );
    await store.dispatch(
      loadAppReviewRuns({ siteId: 'site-one', profileId: 'profile-one', store: 'google_play' }),
    );
    store.dispatch(selectAppReviewRun('different'));
    await store.dispatch(loadAppReviewRunDetail({ siteId: 'site-one', runId: 'review-one' }));
    reviewsApi.fetchAppReviewRun.mockResolvedValueOnce({ ...reviewRun, id: 'review-missing' });
    await store.dispatch(loadAppReviewRunDetail({ siteId: 'site-one', runId: 'review-missing' }));
    await store.dispatch(
      previewAppReviewRun({
        siteId: 'site-one',
        input: { profileId: 'profile-one', store: 'google_play' },
      }),
    );
    await store.dispatch(
      confirmAppReviewRun({
        siteId: 'site-one',
        input: { profileId: 'profile-one', store: 'google_play' },
      }),
    );
    await store.dispatch(
      confirmAppReviewRun({
        siteId: 'site-one',
        input: { profileId: 'profile-one', store: 'google_play' },
      }),
    );
    store.dispatch(selectAppReviewRun('review-one'));
    store.dispatch(selectAppReviewRun(null));
    store.dispatch(clearAppReviewPreview());
    expect(store.getState().appSeoReviews).toMatchObject({
      selectedRunId: null,
      selectedRun: null,
      preview: null,
      mutationStatus: 'idle',
    });
  });

  it('covers changed and stable comparison identity plus a successful read-only result', async () => {
    compareApi.fetchAppSeoComparison.mockResolvedValue(comparison);
    const store = makeStore();
    await store.dispatch(loadAppSeoComparison({ siteId: 'site-one', profileId: 'profile-one' }));
    await store.dispatch(loadAppSeoComparison({ siteId: 'site-one', profileId: 'profile-one' }));
    expect(store.getState().appSeoCompare).toMatchObject({
      siteId: 'site-one',
      profileId: 'profile-one',
      comparison,
      status: 'succeeded',
      error: '',
    });
  });
});

describe('App SEO workflow failure and selector matrix', () => {
  it('maps every API failure into the owning state without leaking raw messages', async () => {
    const refusal = new ApiError('raw provider detail', 503, {
      error: { message: 'Localized workflow refusal' },
    });
    for (const mock of [
      ...Object.values(trackingApi),
      ...Object.values(chartsApi),
      ...Object.values(listingApi),
      ...Object.values(researchApi),
      ...Object.values(reviewsApi),
      ...Object.values(compareApi),
    ]) {
      mock.mockRejectedValue(refusal);
    }
    const store = makeStore();
    const keywordInput = { phrase: 'coffee app', store: 'google_play' as const };
    await store.dispatch(loadTrackedAppKeywords({ siteId: 's', profileId: 'p' }));
    await store.dispatch(
      previewTrackedAppKeywordMint({ siteId: 's', profileId: 'p', input: keywordInput }),
    );
    await store.dispatch(
      mintTrackedAppKeyword({ siteId: 's', profileId: 'p', input: keywordInput }),
    );
    await store.dispatch(deleteTrackedAppKeyword({ siteId: 's', keywordId: 'k' }));
    await store.dispatch(previewTrackedAppKeywordRecheck({ siteId: 's', keywordId: 'k' }));
    await store.dispatch(confirmTrackedAppKeywordRecheck({ siteId: 's', keywordId: 'k' }));
    await store.dispatch(loadTrackedAppKeywordHistory({ siteId: 's', keywordId: 'k' }));

    const chartInput = {
      profileId: 'p',
      store: 'app_store' as const,
      chartId: 'top_free',
      categoryId: 'games',
    };
    await store.dispatch(loadTrackedAppCharts({ siteId: 's', profileId: 'p' }));
    await store.dispatch(createAppChart({ siteId: 's', input: chartInput }));
    await store.dispatch(deleteAppChart({ siteId: 's', subscriptionId: 'c' }));
    await store.dispatch(previewAppChartRecheck({ siteId: 's', subscriptionId: 'c' }));
    await store.dispatch(confirmAppChartRecheck({ siteId: 's', subscriptionId: 'c' }));
    await store.dispatch(loadAppChartHistory({ siteId: 's', subscriptionId: 'c' }));

    await store.dispatch(loadLatestAppListing({ siteId: 's', profileId: 'p' }));
    await store.dispatch(loadAppListingHistory({ siteId: 's', profileId: 'p' }));
    await store.dispatch(previewAppListingRun({ siteId: 's', input: { profileId: 'p' } }));
    await store.dispatch(confirmAppListingRun({ siteId: 's', input: { profileId: 'p' } }));

    const base = {
      profileId: 'p',
      store: 'google_play' as const,
      locationCode: 2840 as const,
      languageCode: 'en' as const,
    };
    await store.dispatch(
      loadLatestAppResearch({
        siteId: 's',
        profileId: 'p',
        store: 'google_play',
        surface: 'keywords',
      }),
    );
    await store.dispatch(
      previewAppResearchSpend({
        siteId: 's',
        profileId: 'p',
        store: 'google_play',
        surface: 'keywords',
      }),
    );
    await store.dispatch(
      runAppKeywordResearch({ siteId: 's', input: { ...base, cursor: 0, pageSize: 25 } }),
    );
    await store.dispatch(
      runAppGapResearch({
        siteId: 's',
        input: { ...base, appIds: ['com.example.one', 'com.example.two'] },
      }),
    );
    await store.dispatch(runAppCompetitorResearch({ siteId: 's', input: base }));

    await store.dispatch(loadAppReviewRuns({ siteId: 's', profileId: 'p', store: 'google_play' }));
    await store.dispatch(loadAppReviewRunDetail({ siteId: 's', runId: 'r' }));
    await store.dispatch(
      previewAppReviewRun({
        siteId: 's',
        input: { profileId: 'p', store: 'google_play' },
      }),
    );
    await store.dispatch(
      confirmAppReviewRun({
        siteId: 's',
        input: { profileId: 'p', store: 'google_play' },
      }),
    );
    await store.dispatch(loadAppSeoComparison({ siteId: 's', profileId: 'p' }));

    for (const value of [
      store.getState().appSeoTracking,
      store.getState().appSeoCharts,
      store.getState().appSeoListing,
      store.getState().appSeoResearch,
      store.getState().appSeoReviews,
      store.getState().appSeoCompare,
    ]) {
      expect(value.error).toBe('Localized workflow refusal');
      expect(value.error).not.toContain('provider detail');
    }
  });

  it('falls back every selector before injection and covers payload-less rejection state', () => {
    const root = {} as RootState;
    expect(selectAppSeoTracking(root)).toBe(initialAppSeoTrackingState);
    expect(selectAppSeoCharts(root)).toBe(initialAppSeoChartsState);
    expect(selectAppSeoListing(root)).toBe(initialAppSeoListingState);
    expect(selectAppSeoResearch(root)).toBe(initialAppSeoResearchState);
    expect(selectAppSeoReviews(root)).toBe(initialAppSeoReviewsState);
    expect(selectAppSeoCompare(root)).toBe(initialAppSeoCompareState);

    expect(
      appSeoTrackingReducer(
        initialAppSeoTrackingState,
        loadTrackedAppKeywords.rejected(new Error('aborted'), 'request', {
          siteId: 's',
          profileId: 'p',
        }),
      ).error,
    ).toBe('');
    expect(
      appSeoChartsReducer(
        initialAppSeoChartsState,
        loadAppChartHistory.rejected(new Error('aborted'), 'request', {
          siteId: 's',
          subscriptionId: 'c',
        }),
      ).error,
    ).toBe('');
    expect(
      appSeoListingReducer(
        initialAppSeoListingState,
        loadLatestAppListing.rejected(new Error('aborted'), 'request', {
          siteId: 's',
          profileId: 'p',
        }),
      ).error,
    ).toBe('');
    expect(
      appSeoResearchReducer(
        initialAppSeoResearchState,
        loadLatestAppResearch.rejected(new Error('aborted'), 'request', {
          siteId: 's',
          profileId: 'p',
          store: 'google_play',
          surface: 'keywords',
        }),
      ).error,
    ).toBe('');
    expect(
      appSeoReviewsReducer(
        initialAppSeoReviewsState,
        loadAppReviewRunDetail.rejected(new Error('aborted'), 'request', {
          siteId: 's',
          runId: 'r',
        }),
      ).error,
    ).toBe('');
    expect(
      appSeoCompareReducer(
        initialAppSeoCompareState,
        loadAppSeoComparison.rejected(new Error('aborted'), 'request', {
          siteId: 's',
          profileId: 'p',
        }),
      ).error,
    ).toBe('');
  });
});
