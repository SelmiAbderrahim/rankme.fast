import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type {
  AppCompetitorResearchResult,
  AppGapResearchResult,
  AppKeywordResearchResult,
  AppRankingMetrics,
  AppSeoResearchState,
} from '../research-types';
import { appSeoResearchReducer, initialAppSeoResearchState } from '../store/research-slice';
import { appSeoReducer } from '../store/slice';
import type { AppProfile, AppSeoState } from '../types';
import { AppResearchPanel } from './research/AppResearchPanel';
import { CompetitorResearchPanel } from './research/CompetitorResearchPanel';
import { GapResearchPanel } from './research/GapResearchPanel';
import { KeywordResearchPanel } from './research/KeywordResearchPanel';

const researchApi = vi.hoisted(() => ({
  fetchAppResearchPreview: vi.fn(),
  fetchLatestAppResearch: vi.fn(),
  submitAppCompetitorResearch: vi.fn(),
  submitAppGapResearch: vi.fn(),
  submitAppKeywordResearch: vi.fn(),
}));

vi.mock('../research-api', () => researchApi);
vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Export report
    </button>
  ),
}));

const timestamp = '2026-04-02T12:00:00.000Z';

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
  profile('profile-2', { playPackageId: null, appStoreId: '987654321', paired: false }),
  profile('profile-empty', { playPackageId: null, appStoreId: null, paired: false }),
];

const appSeoState: AppSeoState = {
  profiles,
  registration: { status: 'idle', message: '' },
};

const keywordResult: AppKeywordResearchResult = {
  surface: 'keywords',
  profileId: 'profile-1',
  store: 'google_play',
  appId: 'com.example.profile-1',
  rows: [
    {
      store: 'google_play',
      appId: 'com.example.profile-1',
      keyword: 'ranked phrase',
      rank: 3,
      absoluteRank: 3,
      lastUpdatedAt: timestamp,
      observationMeta: { source: 'recorded-fixture' },
    },
    {
      store: 'google_play',
      appId: 'com.example.profile-1',
      keyword: 'missing phrase',
      rank: null,
      absoluteRank: null,
      lastUpdatedAt: null,
      observationMeta: {},
    },
  ],
  cursor: 0,
  nextCursor: 1,
  totalRows: 27,
  cached: false,
  fetchedAt: timestamp,
};

const gapResult: AppGapResearchResult = {
  surface: 'gap',
  profileId: 'profile-1',
  store: 'google_play',
  ownAppId: 'com.example.profile-1',
  appIds: ['com.example.profile-1', 'com.example.competitor'],
  rows: [
    {
      store: 'google_play',
      keyword: 'shared term',
      ranksByAppId: {
        'com.example.profile-1': { rank: 2, absoluteRank: 2 },
      },
      lastUpdatedAt: timestamp,
      observationMeta: {},
    },
    {
      store: 'google_play',
      keyword: 'unobserved term',
      ranksByAppId: {},
      lastUpdatedAt: null,
      observationMeta: {},
    },
  ],
  cached: false,
  fetchedAt: timestamp,
};

const metrics = (rankedKeywordCount: number): AppRankingMetrics => ({
  firstPositionCount: 1,
  secondToThirdPositionCount: 2,
  fourthToTenthPositionCount: 3,
  eleventhToHundredthPositionCount: 4,
  rankedKeywordCount,
  rankingKeywordSearchVolume: 100,
});

const competitorResult: AppCompetitorResearchResult = {
  surface: 'competitors',
  profileId: 'profile-1',
  store: 'google_play',
  appId: 'com.example.profile-1',
  rows: [
    {
      competitor: {
        store: 'google_play',
        appId: 'com.example.competitor',
        averagePosition: 3.25,
        summedPosition: 13,
        sharedKeywordCount: 4,
        sharedKeywordMetrics: metrics(4),
        allKeywordMetrics: metrics(8),
        observationMeta: {},
      },
      metrics: {
        store: 'google_play',
        appId: 'com.example.competitor',
        metrics: metrics(8),
        observationMeta: {},
      },
    },
    {
      competitor: {
        store: 'google_play',
        appId: 'com.example.partial',
        averagePosition: null,
        summedPosition: null,
        sharedKeywordCount: 1,
        sharedKeywordMetrics: metrics(1),
        allKeywordMetrics: metrics(1),
        observationMeta: {},
      },
      metrics: null,
    },
  ],
  partial: true,
  noteKey: 'metricsUnavailable',
  cached: false,
  fetchedAt: timestamp,
};

const renderParent = (
  state: AppSeoResearchState,
  path = '/sites/site-1?tab=apps&view=research&profile=profile-1&store=google_play&panel=keywords',
) => {
  const store = configureStore({
    reducer: { appSeo: appSeoReducer, appSeoResearch: appSeoResearchReducer },
    preloadedState: { appSeo: appSeoState, appSeoResearch: state },
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppResearchPanel siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    ),
  };
};

const renderChild = (
  node: React.ReactNode,
  state: AppSeoResearchState,
  path = '/sites/site-1?tab=apps&view=research',
) => {
  const store = configureStore({
    reducer: { appSeoResearch: appSeoResearchReducer },
    preloadedState: { appSeoResearch: state },
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
        </Provider>
      </I18nextProvider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.resetAllMocks();
  researchApi.fetchLatestAppResearch.mockImplementation(
    async (_siteId: string, surface: 'keywords' | 'gap' | 'competitors') => ({
      result:
        surface === 'keywords' ? keywordResult : surface === 'gap' ? gapResult : competitorResult,
      researchEnabled: true,
    }),
  );
  researchApi.fetchAppResearchPreview.mockResolvedValue({ preview: {} });
  researchApi.submitAppKeywordResearch.mockResolvedValue(keywordResult);
  researchApi.submitAppGapResearch.mockResolvedValue(gapResult);
  researchApi.submitAppCompetitorResearch.mockResolvedValue(competitorResult);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:research'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('App research workspace', () => {
  it('normalizes URL scope and switches profiles, stores, and research panels', async () => {
    const user = userEvent.setup();
    const normalized = renderParent(
      { ...initialAppSeoResearchState, researchEnabled: true },
      '/sites/site-1?tab=apps&view=research',
    );
    expect(screen.getByText('App research')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeEnabled();
    await waitFor(() => expect(researchApi.fetchLatestAppResearch).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: 'Keyword gap' }));
    expect(await screen.findByText('Compare keyword coverage')).toBeVisible();

    await user.click(screen.getByRole('combobox', { name: 'Store' }));
    await user.click(screen.getByRole('option', { name: 'App Store' }));
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    expect(screen.getByRole('option', { name: 'profile-empty' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: '987654321' }));
    normalized.unmount();

    const gap = renderParent(
      { ...initialAppSeoResearchState, researchEnabled: true },
      '/sites/site-1?tab=apps&view=research&profile=profile-1&store=google_play&panel=gap',
    );
    expect(screen.getByText('Compare keyword coverage')).toBeVisible();
    gap.unmount();

    renderParent(
      { ...initialAppSeoResearchState, researchEnabled: true },
      '/sites/site-1?tab=apps&view=research&profile=profile-1&store=google_play&panel=competitors',
    );
    expect(screen.getByText('Discover competitors')).toBeVisible();
  });

  it('covers no-store, transient loading, operator disabling, and errors', async () => {
    const noStore = renderParent(
      initialAppSeoResearchState,
      '/sites/site-1?tab=apps&view=research&profile=profile-empty&store=google_play&panel=keywords',
    );
    expect(noStore.container).toBeEmptyDOMElement();
    noStore.unmount();

    const loading = renderParent({
      ...initialAppSeoResearchState,
      loadStatus: 'loading',
      profileId: 'other',
    });
    expect(loading.container).not.toBeEmptyDOMElement();
    loading.unmount();

    researchApi.fetchLatestAppResearch.mockRejectedValueOnce(new Error('research failed'));
    renderParent({
      ...initialAppSeoResearchState,
      siteId: 'site-1',
      profileId: 'profile-1',
      researchEnabled: false,
      loadStatus: 'succeeded',
      error: 'Recorded error',
    });
    expect(screen.getByText('New research is paused')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
    expect(await screen.findByText('The research request failed. Try again.')).toBeVisible();
  });
});

describe('Keyword research workflow', () => {
  it('renders rich, empty, stale-scope, next-page, and export states', async () => {
    const user = userEvent.setup();
    const state: AppSeoResearchState = {
      ...initialAppSeoResearchState,
      results: { keywords: keywordResult, gap: null, competitors: null },
      researchEnabled: true,
      loadStatus: 'succeeded',
    };
    const rich = renderChild(
      <KeywordResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    expect(screen.getByRole('heading', { name: 'Ranked keywords' })).toBeVisible();
    expect(screen.getByText('ranked phrase')).toBeVisible();
    expect(screen.getByText('missing phrase')).toBeVisible();
    expect(screen.getByText('Not ranked')).toBeVisible();
    expect(screen.getByText('Unknown')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    const createObjectUrl = URL.createObjectURL;
    const toastError = vi.spyOn(toast, 'error');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(toastError).toHaveBeenCalled();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Confirm this lookup')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    rich.unmount();

    const emptyResult = { ...keywordResult, rows: [], nextCursor: null };
    const empty = renderChild(
      <KeywordResearchPanel siteId="site-1" profileId="profile-1" store="google_play" disabled />,
      { ...state, results: { ...state.results, keywords: emptyResult } },
    );
    expect(screen.getByText('This app did not rank for any observed keywords.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    empty.unmount();

    renderChild(
      <KeywordResearchPanel
        siteId="site-1"
        profileId="other"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    expect(screen.queryByText('ranked phrase')).not.toBeInTheDocument();
  });

  it('previews and confirms keywords and retains preview/run failures', async () => {
    const user = userEvent.setup();
    const state = { ...initialAppSeoResearchState, researchEnabled: true };
    const view = renderChild(
      <KeywordResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview keyword lookup' }));
    await waitFor(() =>
      expect(researchApi.fetchAppResearchPreview).toHaveBeenCalledWith(
        'site-1',
        'keywords',
        'profile-1',
        'google_play',
        undefined,
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Preview keyword lookup' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    await waitFor(() => expect(researchApi.submitAppKeywordResearch).toHaveBeenCalled());
    view.unmount();

    researchApi.fetchAppResearchPreview.mockRejectedValueOnce(new Error('preview failed'));
    researchApi.submitAppKeywordResearch.mockRejectedValueOnce(new Error('run failed'));
    const failed = renderChild(
      <KeywordResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview keyword lookup' }));
    await waitFor(() =>
      expect(failed.store.getState().appSeoResearch.error).toBe(
        'The research request failed. Try again.',
      ),
    );
    failed.unmount();

    const runFailure = renderChild(
      <KeywordResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview keyword lookup' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    await waitFor(() =>
      expect(runFailure.store.getState().appSeoResearch.error).toBe(
        'The research request failed. Try again.',
      ),
    );
    runFailure.unmount();

    renderChild(
      <KeywordResearchPanel siteId="site-1" profileId="" store="google_play" disabled={false} />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview keyword lookup' }));
    expect(researchApi.fetchAppResearchPreview).not.toHaveBeenLastCalledWith(
      'site-1',
      'keywords',
      '',
      'google_play',
      undefined,
    );
  });
});

describe('Keyword gap research workflow', () => {
  it('validates store IDs then previews and confirms a valid comparison', async () => {
    const user = userEvent.setup();
    const state = { ...initialAppSeoResearchState, researchEnabled: true };
    renderChild(
      <GapResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        ownAppId="com.example.profileone"
        disabled={false}
      />,
      state,
    );
    await user.type(screen.getByLabelText('Competitor app IDs'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Preview keyword gap' }));
    expect(screen.getByText(/valid competitor IDs/)).toBeVisible();

    await user.clear(screen.getByLabelText('Competitor app IDs'));
    await user.type(screen.getByLabelText('Competitor app IDs'), 'com.example.competitor');
    await user.click(screen.getByRole('button', { name: 'Preview keyword gap' }));
    await waitFor(() =>
      expect(researchApi.fetchAppResearchPreview).toHaveBeenCalledWith(
        'site-1',
        'gap',
        'profile-1',
        'google_play',
        ['com.example.profileone', 'com.example.competitor'],
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Preview keyword gap' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    await waitFor(() => expect(researchApi.submitAppGapResearch).toHaveBeenCalled());
  });

  it('renders partial ranks, empty rows, exports, and catches preview and run failures', async () => {
    const user = userEvent.setup();
    const richState: AppSeoResearchState = {
      ...initialAppSeoResearchState,
      results: { keywords: null, gap: gapResult, competitors: null },
      researchEnabled: true,
    };
    const rich = renderChild(
      <GapResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        ownAppId="com.example.profile-1"
        disabled={false}
      />,
      richState,
    );
    expect(screen.getByRole('heading', { name: 'Keyword gap' })).toBeVisible();
    expect(screen.getByText('shared term')).toBeVisible();
    expect(screen.getAllByText('Not ranked').length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const createObjectUrl = URL.createObjectURL;
    const toastError = vi.spyOn(toast, 'error');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(toastError).toHaveBeenCalled();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    rich.unmount();

    renderChild(
      <GapResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        ownAppId="com.example.profile-1"
        disabled
      />,
      { ...richState, results: { ...richState.results, gap: { ...gapResult, rows: [] } } },
    );
    expect(
      screen.getByText('No shared or missing keyword opportunities were observed.'),
    ).toBeVisible();
  });

  it('clears failed previews and retains failed gap-run evidence', async () => {
    const user = userEvent.setup();
    const state = { ...initialAppSeoResearchState, researchEnabled: true };
    researchApi.fetchAppResearchPreview.mockRejectedValueOnce(new Error('preview failed'));
    const failedPreview = renderChild(
      <GapResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        ownAppId="com.example.primary"
        disabled={false}
      />,
      state,
    );
    await user.type(screen.getByLabelText('Competitor app IDs'), 'com.example.competitor');
    await user.click(screen.getByRole('button', { name: 'Preview keyword gap' }));
    await waitFor(() => expect(failedPreview.store.getState().appSeoResearch.preview).toBeNull());
    failedPreview.unmount();

    researchApi.submitAppGapResearch.mockRejectedValueOnce(new Error('run failed'));
    const failedRun = renderChild(
      <GapResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        ownAppId="com.example.primary"
        disabled={false}
      />,
      state,
    );
    await user.type(screen.getByLabelText('Competitor app IDs'), 'com.example.competitor');
    await user.click(screen.getByRole('button', { name: 'Preview keyword gap' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    await waitFor(() =>
      expect(failedRun.store.getState().appSeoResearch.error).toBe(
        'The research request failed. Try again.',
      ),
    );
  });
});

describe('Competitor research workflow', () => {
  it('renders enriched and partial competitors with store-safe links and exports', async () => {
    const user = userEvent.setup();
    const state: AppSeoResearchState = {
      ...initialAppSeoResearchState,
      results: { keywords: null, gap: null, competitors: competitorResult },
      researchEnabled: true,
    };
    renderChild(
      <CompetitorResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    expect(screen.getByRole('heading', { name: 'Discovered competitors' })).toBeVisible();
    expect(screen.getByText('Partial result')).toBeVisible();
    expect(screen.getByText('3.3')).toBeVisible();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('link', { name: 'com.example.competitor' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.example.competitor',
    );
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    const createObjectUrl = URL.createObjectURL;
    const toastError = vi.spyOn(toast, 'error');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(toastError).toHaveBeenCalled();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  });

  it('previews and confirms competitors and renders empty App Store results', async () => {
    const user = userEvent.setup();
    const state = { ...initialAppSeoResearchState, researchEnabled: true };
    const run = renderChild(
      <CompetitorResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="app_store"
        disabled={false}
      />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview competitor lookup' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Preview competitor lookup' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    await waitFor(() => expect(researchApi.submitAppCompetitorResearch).toHaveBeenCalled());
    run.unmount();

    const googleRow = competitorResult.rows[0]!;
    const appleResult: AppCompetitorResearchResult = {
      ...competitorResult,
      store: 'app_store',
      rows: [
        {
          ...googleRow,
          competitor: {
            ...googleRow.competitor,
            store: 'app_store',
            appId: '987654321',
          },
        },
      ],
      partial: false,
    };
    const apple = renderChild(
      <CompetitorResearchPanel siteId="site-1" profileId="profile-1" store="app_store" disabled />,
      {
        ...state,
        results: { keywords: null, gap: null, competitors: appleResult },
      },
    );
    expect(screen.getByRole('link', { name: '987654321' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id987654321',
    );
    apple.unmount();

    renderChild(
      <CompetitorResearchPanel siteId="site-1" profileId="profile-1" store="app_store" disabled />,
      {
        ...state,
        results: {
          keywords: null,
          gap: null,
          competitors: { ...appleResult, rows: [] },
        },
      },
    );
    expect(screen.getByText('No competitors were found for this app.')).toBeVisible();
  });

  it('rejects an invalid competitor scope before requesting a spend preview', async () => {
    const user = userEvent.setup();
    renderChild(
      <CompetitorResearchPanel siteId="site-1" profileId="" store="google_play" disabled={false} />,
      { ...initialAppSeoResearchState, researchEnabled: true },
    );
    await user.click(screen.getByRole('button', { name: 'Preview competitor lookup' }));
    expect(researchApi.fetchAppResearchPreview).not.toHaveBeenCalled();
  });

  it('clears failed competitor previews and retains failed-run evidence', async () => {
    const user = userEvent.setup();
    const state = { ...initialAppSeoResearchState, researchEnabled: true };
    researchApi.fetchAppResearchPreview.mockRejectedValueOnce(new Error('preview failed'));
    const failedPreview = renderChild(
      <CompetitorResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview competitor lookup' }));
    await waitFor(() => expect(failedPreview.store.getState().appSeoResearch.preview).toBeNull());
    failedPreview.unmount();

    researchApi.submitAppCompetitorResearch.mockRejectedValueOnce(new Error('run failed'));
    const failedRun = renderChild(
      <CompetitorResearchPanel
        siteId="site-1"
        profileId="profile-1"
        store="google_play"
        disabled={false}
      />,
      state,
    );
    await user.click(screen.getByRole('button', { name: 'Preview competitor lookup' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    await waitFor(() =>
      expect(failedRun.store.getState().appSeoResearch.error).toBe(
        'The research request failed. Try again.',
      ),
    );
  });
});
