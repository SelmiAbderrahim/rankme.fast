import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type {
  AppListingHistoryResponse,
  AppListingReport,
  AppListingRunResponse,
  AppSeoListingState,
} from '../listing-types';
import type {
  AppReviewRunDetail,
  AppReviewRunListItem,
  AppReviewRunListResponse,
  AppSeoReviewsState,
  StartAppReviewRunResponse,
} from '../reviews-types';
import { initialAppSeoListingState, appSeoListingReducer } from '../store/listing-slice';
import { initialAppSeoReviewsState, appSeoReviewsReducer } from '../store/reviews-slice';
import { appSeoReducer } from '../store/slice';
import { loadAppProfiles } from '../store/thunks';
import type { AppProfile, AppSeoState } from '../types';
import { AppListingPanel } from './listing/AppListingPanel';
import { AppReviewsPanel } from './reviews/AppReviewsPanel';

const listingApi = vi.hoisted(() => ({
  fetchAppListingHistory: vi.fn(),
  fetchLatestAppListing: vi.fn(),
  startAppListingRun: vi.fn(),
}));
const reviewsApi = vi.hoisted(() => ({
  fetchAppReviewRun: vi.fn(),
  fetchAppReviewRuns: vi.fn(),
  startAppReviewRun: vi.fn(),
}));

vi.mock('../listing-api', () => listingApi);
vi.mock('../reviews-api', () => reviewsApi);

const timestamp = '2026-03-02T12:00:00.000Z';

const profile = (id: string, overrides: Partial<AppProfile> = {}): AppProfile => ({
  id,
  siteId: 'site-1',
  playPackageId: `com.example.${id}`,
  appStoreId: '123456789',
  paired: true,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const appSeoState: AppSeoState = {
  profiles: [
    profile('profile-1'),
    profile('profile-2', { playPackageId: null, appStoreId: '987654321', paired: false }),
    profile('profile-3', { playPackageId: null, appStoreId: null, paired: false }),
  ],
  registration: { status: 'idle', message: '' },
};

const report: AppListingReport = {
  capturedAt: timestamp,
  engineVersion: 'listing-rules-v1',
  findings: [
    {
      id: 'stores-diverge',
      scope: 'parity',
      status: 'finding',
      severity: 'fixNow',
      copyKey: 'stores-diverge',
      params: {},
      provenance: 'user-paired',
      titleKey: 'appSeo.listing.findings.stores-diverge.title',
      whyKey: 'appSeo.listing.findings.stores-diverge.why',
      fixKey: 'appSeo.listing.findings.stores-diverge.fix',
      passedLabelKey: 'appSeo.listing.findings.stores-diverge.passed',
      notEvaluatedKey: 'appSeo.listing.findings.stores-diverge.notEvaluated',
      title: 'Store listings differ',
      why: 'Consistent listings help people recognize the app.',
      fix: 'Align the store listings.',
      passedText: 'Store listings are aligned.',
      notEvaluatedText: 'Store listing parity was not evaluated.',
    },
    {
      id: 'ratings-diverge',
      scope: 'parity',
      status: 'notEvaluated',
      severity: 'watch',
      copyKey: 'ratings-diverge',
      params: {},
      provenance: 'user-paired',
      titleKey: 'appSeo.listing.findings.ratings-diverge.title',
      whyKey: 'appSeo.listing.findings.ratings-diverge.why',
      fixKey: 'appSeo.listing.findings.ratings-diverge.fix',
      passedLabelKey: 'appSeo.listing.findings.ratings-diverge.passed',
      notEvaluatedKey: 'appSeo.listing.findings.ratings-diverge.notEvaluated',
      title: 'Store ratings differ',
      why: 'A large rating gap can signal a store-specific issue.',
      fix: 'Review feedback in the weaker store.',
      passedText: 'Store ratings are aligned.',
      notEvaluatedText: 'Store rating parity was not evaluated.',
    },
  ],
  notObserved: [
    { store: 'google_play', field: 'listing', copyKey: 'storeFailed', messageKey: 'appSeo.listing.notObserved.storeFailed', message: 'The Google Play listing was not observed.' },
    { store: 'app_store', field: 'listing', copyKey: 'storeFailed', messageKey: 'appSeo.listing.notObserved.storeFailed', message: 'The App Store listing was not observed.' },
  ],
  stores: { google_play: null, app_store: null },
};

const history: AppListingHistoryResponse = {
  listingEnabled: true,
  items: [
    {
      capturedAt: timestamp,
      engineVersion: 'listing-rules-v1',
      stores: ['google_play', 'app_store'],
      partial: true,
      findingCounts: { fixNow: 1, watch: 2, advisory: 3 },
    },
    {
      capturedAt: '2026-03-01T12:00:00.000Z',
      engineVersion: 'listing-rules-v1',
      stores: ['google_play'],
      partial: false,
      findingCounts: { fixNow: 0, watch: 0, advisory: 0 },
    },
  ],
};

const listingPreview = (overrides: Partial<AppListingRunResponse> = {}): AppListingRunResponse => ({
  preview: {},
  queued: false,
  runId: null,
  capturedAt: null,
  ...overrides,
});

const reviewSummary = (
  id: string,
  status: AppReviewRunListItem['status'],
  overrides: Partial<AppReviewRunListItem> = {},
): AppReviewRunListItem => ({
  id,
  profileId: 'profile-1',
  store: 'google_play',
  status,
  clusterState: status === 'completed' ? 'available' : 'pending',
  reviewCount: 12,
  averageRating: 4,
  createdAt: timestamp,
  completedAt: status === 'completed' || status === 'failed' ? timestamp : null,
  ...overrides,
});

const reviewDetail = (
  id: string,
  status: AppReviewRunDetail['status'] = 'completed',
  overrides: Partial<AppReviewRunDetail> = {},
): AppReviewRunDetail => ({
  ...reviewSummary(id, status),
  locationCode: 2840,
  languageCode: 'en',
  stats: {
    total: 12,
    averageRating: 4,
    histogram: [{ star: 5, count: 9 }],
    ratingMix: { positive: 9, neutral: 2, negative: 1 },
    volumeTrend: [{ period: '2026-03', count: 12, averageRating: 4 }],
  },
  clusters: [],
  observationMeta: { sourceKind: 'provider_observation' },
  ...overrides,
});

const reviewList: AppReviewRunListResponse = {
  reviewsEnabled: true,
  items: [
    reviewSummary('completed', 'completed'),
    reviewSummary('failed', 'failed', { averageRating: null }),
    reviewSummary('pulling', 'pulling'),
    reviewSummary('clustering', 'clustering'),
    reviewSummary('queued', 'queued'),
  ],
};

const reviewPreview = (run: AppReviewRunListItem | null = null): StartAppReviewRunResponse => ({
  preview: {},
  queued: Boolean(run),
  run,
});

const renderListing = (
  state: AppSeoListingState,
  path = '/sites/site-1?tab=apps&view=listing&profile=profile-1',
) => {
  const store = configureStore({
    reducer: { appSeo: appSeoReducer, appSeoListing: appSeoListingReducer },
    preloadedState: { appSeo: appSeoState, appSeoListing: state },
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppListingPanel siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    ),
  };
};

const renderReviews = (
  state: AppSeoReviewsState,
  path = '/sites/site-1?tab=apps&view=reviews&profile=profile-1&reviewStore=google_play',
  profilesState: AppSeoState = appSeoState,
) => {
  const store = configureStore({
    reducer: { appSeo: appSeoReducer, appSeoReviews: appSeoReviewsReducer },
    preloadedState: { appSeo: profilesState, appSeoReviews: state },
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppReviewsPanel siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.resetAllMocks();
  listingApi.fetchLatestAppListing.mockResolvedValue({
    report,
    listingEnabled: true,
  });
  listingApi.fetchAppListingHistory.mockResolvedValue(history);
  listingApi.startAppListingRun.mockImplementation(
    async (_siteId: string, input: { confirm: boolean }) =>
      input.confirm
        ? listingPreview({ queued: true, runId: 'listing-run-1', capturedAt: timestamp })
        : listingPreview(),
  );
  reviewsApi.fetchAppReviewRuns.mockResolvedValue(reviewList);
  reviewsApi.fetchAppReviewRun.mockImplementation(async (_siteId: string, runId: string) =>
    reviewDetail(runId, runId === 'failed' ? 'failed' : 'completed'),
  );
  reviewsApi.startAppReviewRun.mockImplementation(
    async (_siteId: string, input: { confirm: boolean }) =>
      input.confirm ? reviewPreview(reviewSummary('new-run', 'queued')) : reviewPreview(),
  );
});

describe('App listing health panel', () => {
  it('covers transient loading', () => {
    const loading = renderListing({
      ...initialAppSeoListingState,
      latestStatus: 'loading',
      profileId: 'other',
    });
    expect(loading.container).not.toBeEmptyDOMElement();
  });

  it('keeps reports, parity, queued status, and history readable when new reads fail', async () => {
    listingApi.fetchLatestAppListing.mockRejectedValueOnce(new Error('latest failed'));
    listingApi.fetchAppListingHistory.mockRejectedValueOnce(new Error('history failed'));
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const state: AppSeoListingState = {
      ...initialAppSeoListingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      report: { ...report, capturedAt: '2026-03-01T00:00:00.000Z' },
      history: history.items,
      listingEnabled: false,
      latestStatus: 'succeeded',
      historyStatus: 'succeeded',
      preview: listingPreview({ queued: true, capturedAt: timestamp }),
      error: 'Recorded listing error',
    };
    const view = renderListing(state);
    expect(screen.getByText('New listing checks are unavailable')).toBeVisible();
    expect(screen.getByText('Listing check in progress')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Latest listing report' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Paired-store consistency' })).toBeVisible();
    expect(screen.getByText('Partial observation')).toBeVisible();
    expect(screen.getByText(/Fix now: 1/)).toBeVisible();
    await waitFor(
      () => expect(
        screen.getByText('The listing health request failed. Please try again.'),
      ).toBeVisible(),
      { timeout: 45_000 },
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_500);
    const poll = setIntervalSpy.mock.calls[0]?.[0];
    expect(typeof poll).toBe('function');
    if (typeof poll === 'function') {
      await act(async () => poll());
    }
    await waitFor(() => expect(
      listingApi.fetchLatestAppListing.mock.calls.length,
    ).toBeGreaterThanOrEqual(2), { timeout: 45_000 });
    view.unmount();
  });

  it('renders empty and loading report and history surfaces', async () => {
    const view = renderListing({
      ...initialAppSeoListingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      latestStatus: 'loading',
      historyStatus: 'loading',
      listingEnabled: true,
    });
    expect(view.container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(
      2,
    );
    view.unmount();

    listingApi.fetchLatestAppListing.mockResolvedValueOnce({
      report: null,
      listingEnabled: true,
    });
    listingApi.fetchAppListingHistory.mockResolvedValueOnce({
      items: [],
      listingEnabled: true,
    });
    renderListing({
      ...initialAppSeoListingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      latestStatus: 'succeeded',
      historyStatus: 'succeeded',
      listingEnabled: true,
    });
    expect(
      await screen.findByText('No listing report has been stored for this profile yet.'),
    ).toBeVisible();
    expect(await screen.findByText('No listing history yet.')).toBeVisible();
  });

  it('previews, confirms, closes, and switches profile for explicit listing runs', async () => {
    const user = userEvent.setup();
    renderListing({
      ...initialAppSeoListingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      latestStatus: 'succeeded',
      historyStatus: 'succeeded',
      listingEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    await waitFor(() =>
      expect(listingApi.startAppListingRun).toHaveBeenCalledWith('site-1', {
        profileId: 'profile-1',
        confirm: false,
      }),
    );
    expect(await screen.findByText('Confirm listing health check')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start listing check' }));
    await waitFor(() =>
      expect(listingApi.startAppListingRun).toHaveBeenCalledWith('site-1', {
        profileId: 'profile-1',
        confirm: true,
      }),
    );

    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    await user.click(screen.getByRole('option', { name: '987654321' }));
    await waitFor(() =>
      expect(listingApi.fetchLatestAppListing).toHaveBeenCalledWith('site-1', 'profile-2'),
    );
  });

  it('normalizes a missing profile and keeps a nonqueued confirmation open until dismissal', async () => {
    listingApi.startAppListingRun.mockImplementation(
      async (_siteId: string, input: { confirm: boolean }) =>
        listingPreview({ queued: false, runId: input.confirm ? 'synchronous-run' : null }),
    );
    const user = userEvent.setup();
    renderListing(
      {
        ...initialAppSeoListingState,
        listingEnabled: true,
        latestStatus: 'succeeded',
        historyStatus: 'succeeded',
      },
      '/sites/site-1?tab=apps&view=listing',
    );
    await waitFor(() =>
      expect(listingApi.fetchLatestAppListing).toHaveBeenCalledWith('site-1', 'profile-1'),
    );
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    expect(screen.getByRole('option', { name: 'profile-3' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    await user.click(await screen.findByRole('button', { name: 'Start listing check' }));
    expect(screen.getByText('Confirm listing health check')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Confirm listing health check')).not.toBeInTheDocument(),
    );
  });

  it('surfaces preview and confirm failures without discarding evidence', async () => {
    listingApi.startAppListingRun
      .mockRejectedValueOnce(new Error('preview failed'))
      .mockResolvedValueOnce(listingPreview())
      .mockRejectedValueOnce(new Error('confirm failed'));
    const user = userEvent.setup();
    renderListing({
      ...initialAppSeoListingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      latestStatus: 'succeeded',
      historyStatus: 'succeeded',
      listingEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    expect(
      await screen.findByText('The listing health request failed. Please try again.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    await user.click(await screen.findByRole('button', { name: 'Start listing check' }));
    expect(
      await screen.findByText('The listing health request failed. Please try again.'),
    ).toBeVisible();
  });
});

describe('App review analysis panel', () => {
  it('waits for profile hydration before loading a deep-linked review run', async () => {
    const view = renderReviews(
      initialAppSeoReviewsState,
      '/sites/site-1?tab=apps&view=reviews&profile=profile-1&reviewStore=google_play&reviewRun=completed',
      { profiles: [], registration: { status: 'loading', message: '' } },
    );
    expect(reviewsApi.fetchAppReviewRun).not.toHaveBeenCalled();

    await act(async () => {
      view.store.dispatch(loadAppProfiles.fulfilled(
        [profile('profile-1')],
        'profile-hydration',
        { siteId: 'site-1' },
      ));
    });

    expect(await screen.findByRole('heading', { name: 'Review themes' })).toBeVisible();
    expect(reviewsApi.fetchAppReviewRun).toHaveBeenCalledWith('site-1', 'completed');
  });

  it('covers transient loading, operator disabling, errors, and all run statuses', async () => {
    const loading = renderReviews({
      ...initialAppSeoReviewsState,
      listStatus: 'loading',
      profileId: 'other',
    });
    expect(loading.container).not.toBeEmptyDOMElement();
    loading.unmount();

    reviewsApi.fetchAppReviewRuns.mockRejectedValueOnce(new Error('reviews failed'));
    renderReviews(
      {
        ...initialAppSeoReviewsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        store: 'google_play',
        items: reviewList.items,
        reviewsEnabled: false,
        listStatus: 'succeeded',
        error: 'Recorded review error',
      },
    );
    expect(screen.getByText('New review runs are unavailable')).toBeVisible();
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.getByText('Pulling reviews')).toBeVisible();
    expect(screen.getByText('Finding themes')).toBeVisible();
    expect(screen.getByText('Queued')).toBeVisible();
    expect(screen.getByText('Not available')).toBeVisible();
    expect(await screen.findByText('The review request failed. Please try again.')).toBeVisible();
  });

  it('renders empty lists, loading details, failed details, pending evidence, and completed evidence', async () => {
    reviewsApi.fetchAppReviewRuns.mockResolvedValue({
      items: [],
      reviewsEnabled: true,
    });
    const empty = renderReviews({
      ...initialAppSeoReviewsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      store: 'google_play',
      listStatus: 'succeeded',
      reviewsEnabled: true,
    });
    expect(screen.getByText('No review runs yet for this app and store.')).toBeVisible();
    empty.unmount();

    reviewsApi.fetchAppReviewRuns.mockResolvedValue(reviewList);
    reviewsApi.fetchAppReviewRun.mockRejectedValueOnce(new Error('detail failed'));
    const detail = renderReviews(
      {
        ...initialAppSeoReviewsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        store: 'google_play',
        items: reviewList.items,
        listStatus: 'succeeded',
        reviewsEnabled: true,
        detailStatus: 'loading',
      },
      '/sites/site-1?tab=apps&view=reviews&profile=profile-1&reviewStore=google_play&reviewRun=failed',
    );
    expect(detail.container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(await screen.findByText('The review request failed. Please try again.')).toBeVisible();
    detail.unmount();

    reviewsApi.fetchAppReviewRun.mockResolvedValueOnce(reviewDetail('failed', 'failed'));
    const failed = renderReviews(
      {
        ...initialAppSeoReviewsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        store: 'google_play',
        items: reviewList.items,
        listStatus: 'succeeded',
        reviewsEnabled: true,
      },
      '/sites/site-1?tab=apps&view=reviews&profile=profile-1&reviewStore=google_play&reviewRun=failed',
    );
    expect(await screen.findByText('Review pull failed')).toBeVisible();
    failed.unmount();

    reviewsApi.fetchAppReviewRun.mockResolvedValueOnce(
      reviewDetail('completed', 'completed', {
        stats: null,
        clusterState: 'pending',
      }),
    );
    const pending = renderReviews(
      {
        ...initialAppSeoReviewsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        store: 'google_play',
        items: reviewList.items,
        listStatus: 'succeeded',
        reviewsEnabled: true,
      },
      '/sites/site-1?tab=apps&view=reviews&profile=profile-1&reviewStore=google_play&reviewRun=completed',
    );
    expect(
      (await screen.findAllByText('The review evidence is still being processed.')).length,
    ).toBeGreaterThanOrEqual(1);
    pending.unmount();

    reviewsApi.fetchAppReviewRun.mockResolvedValueOnce(reviewDetail('completed'));
    renderReviews(
      {
        ...initialAppSeoReviewsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        store: 'google_play',
        items: reviewList.items,
        listStatus: 'succeeded',
        reviewsEnabled: true,
      },
      '/sites/site-1?tab=apps&view=reviews&profile=profile-1&reviewStore=google_play&reviewRun=completed',
    );
    expect(await screen.findByText('Star distribution')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Run details' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Review themes' })).toBeVisible();
  });

  it('previews, confirms, selects, switches scope, and polls a nonterminal review run', async () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    const user = userEvent.setup();
    renderReviews({
      ...initialAppSeoReviewsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      store: 'google_play',
      items: [reviewSummary('queued', 'queued')],
      listStatus: 'succeeded',
      reviewsEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() =>
      expect(reviewsApi.fetchAppReviewRun).toHaveBeenCalledWith('site-1', 'queued'),
    );
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    await waitFor(() =>
      expect(reviewsApi.startAppReviewRun).toHaveBeenCalledWith('site-1', {
        profileId: 'profile-1',
        store: 'google_play',
        confirm: false,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Start review analysis' }));
    await waitFor(() =>
      expect(reviewsApi.startAppReviewRun).toHaveBeenCalledWith('site-1', {
        profileId: 'profile-1',
        store: 'google_play',
        confirm: true,
      }),
    );
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 2_500);
    const poll = timeout.mock.calls.find((call) => call[1] === 2_500)?.[0];
    expect(typeof poll).toBe('function');
    if (typeof poll === 'function') {
      await act(async () => poll());
    }

    await user.click(screen.getByRole('combobox', { name: 'Store' }));
    await user.click(screen.getByRole('option', { name: 'App Store' }));
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    await user.click(screen.getByRole('option', { name: '987654321' }));
    await waitFor(() =>
      expect(reviewsApi.fetchAppReviewRuns).toHaveBeenCalledWith(
        'site-1',
        'profile-2',
        'app_store',
      ),
    );
  });

  it('normalizes a missing profile, exposes fallback labels, and handles a synchronous review response', async () => {
    reviewsApi.startAppReviewRun.mockImplementation(
      async (_siteId: string, input: { confirm: boolean }) =>
        input.confirm ? reviewPreview(null) : reviewPreview(),
    );
    const user = userEvent.setup();
    renderReviews(
      {
        ...initialAppSeoReviewsState,
        reviewsEnabled: true,
        listStatus: 'succeeded',
      },
      '/sites/site-1?tab=apps&view=reviews',
    );
    await waitFor(() =>
      expect(reviewsApi.fetchAppReviewRuns).toHaveBeenCalledWith(
        'site-1',
        'profile-1',
        'google_play',
      ),
    );
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    expect(screen.getByRole('option', { name: 'profile-3' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    await user.click(await screen.findByRole('button', { name: 'Start review analysis' }));
    await waitFor(() => expect(reviewsApi.startAppReviewRun).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Start review analysis')).not.toBeInTheDocument();
  });

  it('surfaces preview and confirmation failures', async () => {
    reviewsApi.startAppReviewRun
      .mockRejectedValueOnce(new Error('preview failed'))
      .mockResolvedValueOnce(reviewPreview())
      .mockRejectedValueOnce(new Error('confirm failed'));
    const user = userEvent.setup();
    renderReviews({
      ...initialAppSeoReviewsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      store: 'google_play',
      listStatus: 'succeeded',
      reviewsEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    expect(await screen.findByText('The review request failed. Please try again.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Preview run' }));
    await user.click(await screen.findByRole('button', { name: 'Start review analysis' }));
    expect(await screen.findByText('The review request failed. Please try again.')).toBeVisible();
  });
});
