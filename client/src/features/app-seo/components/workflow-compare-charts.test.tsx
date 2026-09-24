import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type {
  AppChartListResponse,
  AppChartSubscription,
  AppSeoChartsState,
} from '../charts-types';
import type { AppSeoCompareState, AppSeoComparison } from '../compare-types';
import { appSeoChartsReducer, initialAppSeoChartsState } from '../store/charts-slice';
import { appSeoCompareReducer, initialAppSeoCompareState } from '../store/compare-slice';
import { appSeoReducer } from '../store/slice';
import type { AppProfile, AppSeoState } from '../types';
import { AppChartTrackingPanel } from './charts/AppChartTrackingPanel';
import { AppSeoComparePanel } from './compare/AppSeoComparePanel';

const chartsApi = vi.hoisted(() => ({
  createTrackedAppChart: vi.fn(),
  fetchAppChartSubscriptions: vi.fn(),
  fetchTrackedAppChartHistory: vi.fn(),
  recheckTrackedAppChart: vi.fn(),
  removeTrackedAppChart: vi.fn(),
}));
const compareApi = vi.hoisted(() => ({ fetchAppSeoComparison: vi.fn() }));

vi.mock('../charts-api', () => chartsApi);
vi.mock('../compare-api', () => compareApi);

const timestamp = '2026-01-02T12:00:00.000Z';

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

const profiles = [
  profile('profile-1'),
  profile('profile-2', { playPackageId: null, appStoreId: null, paired: false }),
  profile('profile-3', { playPackageId: null, appStoreId: '987654321', paired: false }),
];

const appSeoState: AppSeoState = {
  profiles,
  registration: { status: 'idle', message: '' },
};

const chart = (
  id: string,
  overrides: Partial<AppChartSubscription> = {},
): AppChartSubscription => ({
  id,
  profileId: 'profile-1',
  store: 'google_play',
  chartId: 'top_free',
  categoryId: 'business',
  locationCode: 2840,
  languageCode: 'en',
  latestPosition: 2,
  previousPosition: 4,
  delta: 2,
  lastCheckedAt: timestamp,
  createdAt: timestamp,
  ...overrides,
});

const chartList: AppChartListResponse = {
  items: [
    chart('chart-1'),
    chart('chart-2', {
      store: 'app_store',
      chartId: 'unknown-chart',
      categoryId: 'unknown-category',
      latestPosition: null,
    }),
    chart('chart-3', { lastCheckedAt: null, latestPosition: null, delta: null }),
  ],
  catalogs: {
    google_play: {
      store: 'google_play',
      charts: [
        { id: 'top_free', nameKey: 'charts.google.topFree' },
        { id: 'top_paid', nameKey: 'charts.google.topPaid' },
      ],
      categories: [
        { id: 'business', nameKey: 'categories.business' },
        { id: 'games', nameKey: 'categories.games' },
      ],
    },
    app_store: {
      store: 'app_store',
      charts: [{ id: 'top_free', nameKey: 'charts.apple.topFree' }],
      categories: [{ id: 'business', nameKey: 'categories.business' }],
    },
  },
  limit: 5,
  trackingEnabled: true,
};

const comparison: AppSeoComparison = {
  profile: {
    id: 'profile-1',
    paired: true,
    playPackageId: 'com.example.profile-1',
    appStoreId: '123456789',
  },
  pairingProvenance: 'user-paired',
  listings: {
    google_play: {
      store: 'google_play',
      appId: 'com.example.profile-1',
      title: 'Play app',
      url: null,
      rating: 4,
      reviewCount: 100,
      capturedAt: timestamp,
    },
    app_store: {
      store: 'app_store',
      appId: '123456789',
      title: 'Apple app',
      url: null,
      rating: 4,
      reviewCount: 100,
      capturedAt: timestamp,
    },
  },
  ratingDelta: 0,
  reviewCountDelta: 0,
  ranks: { shared: [], onlyGooglePlay: [], onlyAppStore: [] },
  listingParity: { findings: [], rawFields: [] },
  charts: [],
};

const renderCompare = (state: AppSeoCompareState, path: string) => {
  const store = configureStore({
    reducer: { appSeo: appSeoReducer, appSeoCompare: appSeoCompareReducer },
    preloadedState: { appSeo: appSeoState, appSeoCompare: state },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <AppSeoComparePanel siteId="site-1" />
        </MemoryRouter>
      </Provider>
    </I18nextProvider>,
  );
};

const renderCharts = (
  state: AppSeoChartsState,
  path = '/sites/site-1?tab=apps&view=charts&profile=profile-1',
) => {
  const store = configureStore({
    reducer: { appSeo: appSeoReducer, appSeoCharts: appSeoChartsReducer },
    preloadedState: { appSeo: appSeoState, appSeoCharts: state },
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppChartTrackingPanel siteId="site-1" />
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
  compareApi.fetchAppSeoComparison.mockResolvedValue(comparison);
  chartsApi.fetchAppChartSubscriptions.mockResolvedValue(chartList);
  chartsApi.fetchTrackedAppChartHistory.mockResolvedValue([{ checkedAt: timestamp, position: 2 }]);
  chartsApi.createTrackedAppChart.mockResolvedValue(chart('created-chart'));
  chartsApi.removeTrackedAppChart.mockResolvedValue(undefined);
  chartsApi.recheckTrackedAppChart.mockResolvedValue({
    preview: {},
    queued: true,
    reservationStamp: 'reservation-1',
  });
});

describe('App store comparison panel', () => {
  it('normalizes an absent profile parameter and renders the paired comparison', async () => {
    renderCompare(
      {
        ...initialAppSeoCompareState,
        comparison,
        status: 'succeeded',
        profileId: 'profile-1',
        siteId: 'site-1',
      },
      '/sites/site-1?tab=apps&view=compare',
    );
    for (const heading of ['Store listings', 'Keyword ranks', 'Listing parity', 'Chart positions']) {
      expect(screen.getByRole('heading', { name: heading, level: 3 })).toBeVisible();
    }
    await waitFor(() =>
      expect(compareApi.fetchAppSeoComparison).toHaveBeenCalledWith('site-1', 'profile-1'),
    );
  });

  it('shows loading, unpaired, and error states and changes the URL-backed profile', async () => {
    const loading = renderCompare(
      { ...initialAppSeoCompareState, status: 'loading', profileId: 'other' },
      '/sites/site-1?tab=apps&view=compare&profile=profile-1',
    );
    expect(loading.container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    loading.unmount();

    compareApi.fetchAppSeoComparison.mockRejectedValueOnce(new Error('comparison failed'));
    const unpaired = renderCompare(
      { ...initialAppSeoCompareState, status: 'failed', error: 'Recorded failure' },
      '/sites/site-1?tab=apps&view=compare&profile=profile-2',
    );
    expect(screen.getByText('Pair the store listings to compare them')).toBeVisible();
    expect(
      await screen.findByText('The saved comparison could not be loaded. Try again.'),
    ).toBeVisible();
    unpaired.unmount();

    renderCompare(
      { ...initialAppSeoCompareState, status: 'idle' },
      '/sites/site-1?tab=apps&view=compare&profile=missing',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    await user.click(screen.getByRole('option', { name: '987654321' }));
    await waitFor(() =>
      expect(compareApi.fetchAppSeoComparison).toHaveBeenCalledWith('site-1', 'profile-3'),
    );
  });
});

describe('App chart tracking panel', () => {
  it('renders stale loading', () => {
    const loading = renderCharts({
      ...initialAppSeoChartsState,
      listStatus: 'loading',
      profileId: 'other',
    });
    expect(loading.container).not.toBeEmptyDOMElement();
  });

  it('shows operator, error, limit, result, and history states without losing stored evidence', async () => {
    chartsApi.fetchAppChartSubscriptions.mockRejectedValueOnce(new Error('chart list failed'));
    const state: AppSeoChartsState = {
      ...initialAppSeoChartsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: chartList.items,
      catalogs: chartList.catalogs,
      limit: 3,
      trackingEnabled: false,
      listStatus: 'succeeded',
      error: 'Recorded chart error',
      selectedSubscriptionId: 'chart-1',
      history: [{ checkedAt: timestamp, position: 2 }],
      historyStatus: 'succeeded',
    };
    renderCharts(
      state,
      '/sites/site-1?tab=apps&view=charts&profile=profile-1&chartSubscription=chart-1',
    );
    expect(screen.getByText('Chart tracking is switched off')).toBeVisible();
    expect(
      await screen.findByText('The chart request could not be completed. Try again.'),
    ).toBeVisible();
    expect(screen.getByText('Chart limit reached')).toBeVisible();
    expect(screen.getByText('Not in top 100')).toBeVisible();
    expect(screen.getByText('Not checked yet')).toBeVisible();
    expect(screen.getByText('unknown-chart')).toBeVisible();
    await waitFor(() =>
      expect(chartsApi.fetchTrackedAppChartHistory).toHaveBeenCalledWith('site-1', 'chart-1'),
    );
    expect(await screen.findByTestId('app-chart-history')).toBeVisible();
  });

  it('creates charts and switches URL-backed profiles', async () => {
    const user = userEvent.setup();
    renderCharts({
      ...initialAppSeoChartsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [chart('chart-1')],
      catalogs: chartList.catalogs,
      limit: 5,
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    await user.click(screen.getByRole('button', { name: 'Track chart' }));
    await waitFor(() =>
      expect(chartsApi.createTrackedAppChart).toHaveBeenCalledWith('site-1', {
        profileId: 'profile-1',
        store: 'google_play',
        chartId: 'top_free',
        categoryId: 'business',
      }),
    );

    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    await user.click(screen.getByRole('option', { name: '987654321' }));
    await waitFor(() =>
      expect(chartsApi.fetchAppChartSubscriptions).toHaveBeenCalledWith('site-1', 'profile-3'),
    );
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    await user.click(screen.getByRole('option', { name: 'com.example.profile-1' }));
    await waitFor(() =>
      expect(chartsApi.fetchAppChartSubscriptions).toHaveBeenLastCalledWith(
        'site-1',
        'profile-1',
      ),
    );
  });

  it('switches chart catalogs and opens saved history', async () => {
    const user = userEvent.setup();
    renderCharts({
      ...initialAppSeoChartsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [chart('chart-1')],
      catalogs: chartList.catalogs,
      limit: 5,
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    await user.click(screen.getByRole('combobox', { name: 'Chart' }));
    await user.click(screen.getByRole('option', { name: 'Top paid' }));
    await user.click(screen.getByRole('combobox', { name: 'Category' }));
    await user.click(screen.getByRole('option', { name: 'Games' }));

    await user.click(screen.getByRole('combobox', { name: 'Store' }));
    await user.click(screen.getByRole('option', { name: 'App Store' }));
    await user.click(screen.getByRole('combobox', { name: 'Chart' }));
    await user.click(screen.getByRole('option', { name: 'Top free' }));
    await user.click(screen.getByRole('combobox', { name: 'Category' }));
    await user.click(screen.getByRole('option', { name: 'Business' }));

    await user.click(screen.getAllByRole('button', { name: 'View chart history' })[0]!);
    await waitFor(() =>
      expect(chartsApi.fetchTrackedAppChartHistory).toHaveBeenCalledWith('site-1', 'chart-1'),
    );
    expect(await screen.findByTestId('app-chart-history')).toBeVisible();
  });

  it('previews, confirms, deletes, and closes URL-backed chart actions', async () => {
    const user = userEvent.setup();
    const { store } = renderCharts({
      ...initialAppSeoChartsState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [chart('chart-1'), chart('chart-2')],
      catalogs: chartList.catalogs,
      limit: 5,
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    await user.click(screen.getAllByRole('button', { name: 'Check chart now' })[0]!);
    await waitFor(() =>
      expect(chartsApi.recheckTrackedAppChart).toHaveBeenCalledWith('site-1', 'chart-1', false),
    );
    expect(await screen.findByText('Check this chart now?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() =>
      expect(chartsApi.recheckTrackedAppChart).toHaveBeenCalledWith('site-1', 'chart-1', true),
    );
    await waitFor(() =>
      expect(screen.queryByText('Check this chart now?')).not.toBeInTheDocument(),
    );

    await user.click(screen.getAllByRole('button', { name: 'Delete chart subscription' })[0]!);
    await waitFor(() =>
      expect(chartsApi.removeTrackedAppChart).toHaveBeenCalledWith('site-1', 'chart-1'),
    );
    await waitFor(() =>
      expect(store.getState().appSeoCharts.items.some((item) => item.id === 'chart-1')).toBe(false),
    );

    await user.click(screen.getAllByRole('button', { name: 'Check chart now' })[0]!);
    await waitFor(() =>
      expect(chartsApi.recheckTrackedAppChart).toHaveBeenCalledWith('site-1', 'chart-2', false),
    );
    expect(await screen.findByText('Check this chart now?')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Check this chart now?')).not.toBeInTheDocument(),
    );
  });

  it('normalizes missing scope, supports empty store catalogs, and ignores an unbound recheck URL', async () => {
    const user = userEvent.setup();
    const emptyAppleCatalogs = {
      ...chartList.catalogs,
      app_store: { store: 'app_store' as const, charts: [], categories: [] },
    };
    chartsApi.fetchAppChartSubscriptions.mockResolvedValueOnce({
      ...chartList,
      catalogs: emptyAppleCatalogs,
    });
    renderCharts(
      {
        ...initialAppSeoChartsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        items: [chart('chart-1')],
        catalogs: emptyAppleCatalogs,
        limit: 5,
        trackingEnabled: true,
        listStatus: 'succeeded',
      },
      '/sites/site-1?tab=apps&view=charts&action=chart-recheck',
    );
    await waitFor(() =>
      expect(chartsApi.fetchAppChartSubscriptions).toHaveBeenCalledWith('site-1', 'profile-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(chartsApi.recheckTrackedAppChart).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('combobox', { name: 'Store' }));
    await user.click(screen.getByRole('option', { name: 'App Store' }));
    expect(screen.getByRole('button', { name: 'Track chart' })).toBeDisabled();
  });

  it('retains localized API failures across create, preview, and confirmation paths', async () => {
    chartsApi.createTrackedAppChart.mockRejectedValueOnce(new Error('create failed'));
    chartsApi.recheckTrackedAppChart
      .mockRejectedValueOnce(new Error('preview failed'))
      .mockRejectedValueOnce(new Error('confirm failed'));
    const user = userEvent.setup();
    renderCharts(
      {
        ...initialAppSeoChartsState,
        siteId: 'site-1',
        profileId: 'profile-1',
        items: [chart('chart-1')],
        catalogs: chartList.catalogs,
        limit: 5,
        trackingEnabled: true,
        listStatus: 'succeeded',
      },
      '/sites/site-1?tab=apps&view=charts&profile=profile-1&chartSubscription=chart-1&action=chart-recheck',
    );
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(
      await screen.findByText('The chart request could not be completed. Try again.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Track chart' }));
    expect(
      await screen.findByText('The chart request could not be completed. Try again.'),
    ).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Check chart now' })[0]!);
    await waitFor(() => expect(chartsApi.recheckTrackedAppChart).toHaveBeenCalled());
  });
});
