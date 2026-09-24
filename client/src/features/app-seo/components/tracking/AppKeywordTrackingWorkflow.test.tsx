import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AppSeoTrackingState, AppKeyword } from '../../tracking-types';
import type { AppKeywordResearchResult, AppSeoResearchState } from '../../research-types';
import { appSeoResearchReducer, initialAppSeoResearchState } from '../../store/research-slice';
import { appSeoReducer } from '../../store/slice';
import { appSeoTrackingReducer, initialAppSeoTrackingState } from '../../store/tracking-slice';
import type { AppProfile, AppSeoState } from '../../types';
import { AppKeywordTrackingPanel } from './AppKeywordTrackingPanel';

const trackingApi = vi.hoisted(() => ({
  createTrackedAppKeyword: vi.fn(),
  fetchAppKeywords: vi.fn(),
  fetchTrackedAppKeywordHistory: vi.fn(),
  previewMintAppKeyword: vi.fn(),
  recheckTrackedAppKeyword: vi.fn(),
  removeTrackedAppKeyword: vi.fn(),
}));
const useMarketCatalogMock = vi.hoisted(() => vi.fn());
const researchApi = vi.hoisted(() => ({
  fetchAppResearchPreview: vi.fn(),
  fetchLatestAppResearch: vi.fn(),
  submitAppCompetitorResearch: vi.fn(),
  submitAppGapResearch: vi.fn(),
  submitAppKeywordResearch: vi.fn(),
}));

vi.mock('../../tracking-api', () => trackingApi);
vi.mock('../../research-api', () => researchApi);
vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: (surface: string) => useMarketCatalogMock(surface),
}));
vi.mock('@features/report-export', () => ({
  ReportExportControl: () => <button type="button">Export report</button>,
}));

const timestamp = '2026-05-02T12:00:00.000Z';

const profile = (id: string, overrides: Partial<AppProfile> = {}): AppProfile => ({
  id,
  siteId: 'site-1',
  playPackageId: `com.example.${id.replaceAll('-', '')}`,
  appStoreId: '123456789',
  paired: true,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const profiles = [
  profile('profile-1'),
  profile('apple-only', { playPackageId: null, appStoreId: '987654321', paired: false }),
  profile('play-only', { appStoreId: null, paired: false }),
  profile('profile-empty', { playPackageId: null, appStoreId: null, paired: false }),
];

const appSeoState: AppSeoState = {
  profiles,
  registration: { status: 'idle', message: '' },
};

const keyword = (id: string, overrides: Partial<AppKeyword> = {}): AppKeyword => ({
  id,
  profileId: 'profile-1',
  store: 'google_play',
  phrase: `phrase ${id}`,
  locationCode: 2840,
  languageCode: 'en',
  active: true,
  latestPosition: 2,
  previousPosition: 4,
  delta: 2,
  lastCheckedAt: timestamp,
  lastFailedCheckAt: null,
  checkStatus: 'idle',
  createdAt: timestamp,
  ...overrides,
});

const RESEARCH_FAILED = 'The research request failed. Try again.';

const discoveryResult = (rows: AppKeywordResearchResult['rows']): AppKeywordResearchResult => ({
  surface: 'keywords',
  profileId: 'profile-1',
  store: 'google_play',
  appId: 'com.example.profile1',
  rows,
  cursor: 0,
  nextCursor: null,
  totalRows: rows.length,
  cached: false,
  fetchedAt: timestamp,
});

const discoveryRow = (keyword: string, rank: number | null) => ({
  store: 'google_play' as const,
  appId: 'com.example.profile1',
  keyword,
  rank,
  absoluteRank: rank,
  lastUpdatedAt: timestamp,
  observationMeta: {},
});

const renderPanel = (
  state: AppSeoTrackingState,
  path = '/sites/site-1?tab=apps&view=keywords&profile=profile-1',
  research: AppSeoResearchState = initialAppSeoResearchState,
) => {
  const store = configureStore({
    reducer: {
      appSeo: appSeoReducer,
      appSeoTracking: appSeoTrackingReducer,
      appSeoResearch: appSeoResearchReducer,
    },
    preloadedState: { appSeo: appSeoState, appSeoTracking: state, appSeoResearch: research },
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppKeywordTrackingPanel siteId="site-1" />
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
  trackingApi.fetchAppKeywords.mockReturnValue(new Promise(() => undefined));
  trackingApi.fetchTrackedAppKeywordHistory.mockResolvedValue([
    { checkedAt: timestamp, position: 2, rankAbsolute: 2, foundAppId: 'app' },
  ]);
  trackingApi.previewMintAppKeyword.mockResolvedValue({ check: {} });
  trackingApi.createTrackedAppKeyword.mockResolvedValue(keyword('created'));
  researchApi.fetchAppResearchPreview.mockResolvedValue({ preview: {} });
  researchApi.submitAppKeywordResearch.mockResolvedValue(
    discoveryResult([
      discoveryRow('alpha', 3),
      discoveryRow('phrase tracked', 1),
      discoveryRow('gamma', null),
    ]),
  );
  trackingApi.removeTrackedAppKeyword.mockResolvedValue(undefined);
  trackingApi.recheckTrackedAppKeyword.mockResolvedValue({
    preview: {},
    queued: true,
    reservationStamp: 'reservation-1',
  });
  useMarketCatalogMock.mockImplementation((surface: string) => ({
    markets:
      surface === 'app-google-play'
        ? [
            { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
            { countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] },
          ]
        : [
            { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
            { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
          ],
    loading: false,
    error: false,
  }));
});

describe('App keyword tracking lifecycle', () => {
  it('covers stale loading and operator disabling', () => {
    const loading = renderPanel({
      ...initialAppSeoTrackingState,
      profileId: 'other',
      listStatus: 'loading',
    });
    expect(loading.container).not.toBeEmptyDOMElement();
    loading.unmount();

    const disabled = renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      listStatus: 'succeeded',
      trackingEnabled: false,
    });
    expect(screen.getByText('Keyword tracking is not available')).toBeVisible();
    disabled.unmount();
  });

  it('renders errors, every observation state, markets, and history', async () => {
    trackingApi.fetchAppKeywords.mockRejectedValueOnce(new Error('keyword list failed'));
    const state: AppSeoTrackingState = {
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [
        keyword('checked'),
        keyword('not-found', { store: 'app_store', latestPosition: null }),
        keyword('never', {
          locationCode: 999999,
          languageCode: '_',
          latestPosition: null,
          lastCheckedAt: null,
          delta: null,
        }),
      ],
      trackingEnabled: true,
      listStatus: 'succeeded',
      error: 'Recorded keyword error',
      selectedKeywordId: 'checked',
      history: [{ checkedAt: timestamp, position: 2, rankAbsolute: 2, foundAppId: 'app' }],
      historyStatus: 'succeeded',
    };
    renderPanel(state, '/sites/site-1?tab=apps&view=keywords&profile=profile-1&keyword=checked');
    expect(await screen.findByText('The request could not be completed. Try again.')).toBeVisible();
    expect(screen.getByText('Not in top results')).toBeVisible();
    // Never-checked rows show the copy in both the position and the change cell.
    expect(screen.getAllByText('Not checked yet')).toHaveLength(2);
    expect(screen.getByText(/Unknown country/)).toBeVisible();
    expect(screen.getAllByText('App Store').length).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect(trackingApi.fetchTrackedAppKeywordHistory).toHaveBeenCalledWith('site-1', 'checked'),
    );
    expect(await screen.findByTestId('app-keyword-history')).toBeVisible();
  });

  it('splits a pasted comma/newline list into one preview and one mint per phrase', async () => {
    const user = userEvent.setup();
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [],
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    await user.type(screen.getByLabelText('Keyword'), 'alpha, beta{enter}Alpha ,, gamma');
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(trackingApi.previewMintAppKeyword).toHaveBeenCalledTimes(1));
    expect(trackingApi.previewMintAppKeyword).toHaveBeenCalledWith(
      'site-1',
      'profile-1',
      expect.objectContaining({ phrase: 'alpha' }),
    );
    expect(
      await screen.findByText('Adding 3 keywords. Each uses one tracking slot.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(trackingApi.createTrackedAppKeyword).toHaveBeenCalledTimes(3));
    expect(
      vi.mocked(trackingApi.createTrackedAppKeyword).mock.calls.map(([, , input]) => input.phrase),
    ).toEqual(['alpha', 'beta', 'gamma']);
    expect(screen.getByLabelText('Keyword')).toHaveValue('');
  });

  it('discovers store keywords and moves selected ones into the phrase field', async () => {
    const user = userEvent.setup();
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [
        keyword('tracked', { phrase: 'Phrase Tracked' }),
        keyword('fresh', {
          phrase: 'fresh',
          latestPosition: null,
          previousPosition: null,
          delta: null,
        }),
      ],
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    expect(screen.getByText('No previous check')).toBeVisible();
    await user.type(screen.getByLabelText('Keyword'), 'alpha');
    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByText('Confirm this lookup')).toBeVisible();
    expect(researchApi.fetchAppResearchPreview).toHaveBeenCalledWith(
      'site-1',
      'keywords',
      'profile-1',
      'google_play',
      undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Run lookup' }));
    expect(await screen.findByTestId('app-keyword-discovery-table')).toBeVisible();
    expect(researchApi.submitAppKeywordResearch).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ profileId: 'profile-1', store: 'google_play', pageSize: 25 }),
    );
    expect(screen.getByText('Already tracked')).toBeVisible();
    expect(screen.getByText('Not ranked')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Select phrase tracked' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Track selected (0)' })).toBeDisabled();

    const selectAll = screen.getByRole('checkbox', { name: 'Select all visible keywords' });
    await user.click(selectAll);
    expect(selectAll).toHaveAttribute('data-state', 'checked');
    expect(screen.getByText('2 selected')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Select gamma' }));
    expect(selectAll).toHaveAttribute('data-state', 'indeterminate');
    // Indeterminate → checked selects everything again; checked → unchecked clears.
    await user.click(selectAll);
    expect(screen.getByText('2 selected')).toBeVisible();
    await user.click(selectAll);
    expect(screen.getByText('0 selected')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Select alpha' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select gamma' }));
    await user.type(screen.getByLabelText('Keyword'), ', zeta');
    await user.click(screen.getByRole('button', { name: 'Track selected (2)' }));
    expect(
      await screen.findByText('Adding 2 keywords. Each uses one tracking slot.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(trackingApi.createTrackedAppKeyword).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(trackingApi.createTrackedAppKeyword).mock.calls.map(([, , input]) => input.phrase),
    ).toEqual(['alpha', 'gamma']);
    // Minted phrases leave the field; the untracked typed one stays.
    expect(screen.getByLabelText('Keyword')).toHaveValue('zeta');
    expect(screen.getByText('0 selected')).toBeVisible();

    // Switching the store hides results captured for another store.
    await user.click(screen.getByRole('combobox', { name: 'Store' }));
    await user.click(screen.getByRole('option', { name: 'App Store' }));
    await waitFor(() => expect(screen.queryByTestId('app-keyword-discovery-table')).toBeNull());
  });

  it('handles discovery preview cancel, empty results, and lookup failures', async () => {
    const user = userEvent.setup();
    researchApi.submitAppKeywordResearch.mockResolvedValueOnce(discoveryResult([]));
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [],
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByText('Confirm this lookup')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm this lookup')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    expect(await screen.findByText('No ranking phrases were found for this app.')).toBeVisible();

    researchApi.submitAppKeywordResearch.mockRejectedValueOnce(new Error('lookup failed'));
    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    await user.click(await screen.findByRole('button', { name: 'Run lookup' }));
    expect(await screen.findByText(RESEARCH_FAILED)).toBeVisible();
    expect(screen.getByText('Confirm this lookup')).toBeVisible();

    researchApi.fetchAppResearchPreview.mockRejectedValueOnce(new Error('preview failed'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    await waitFor(() => expect(researchApi.fetchAppResearchPreview).toHaveBeenCalledTimes(4));
    expect(screen.getByText(RESEARCH_FAILED)).toBeVisible();
    expect(screen.queryByText('Confirm this lookup')).toBeNull();
  });

  it('hides discovery when research is switched off or the profile has no store id', () => {
    renderPanel(
      {
        ...initialAppSeoTrackingState,
        siteId: 'site-1',
        profileId: 'profile-1',
        items: [],
        trackingEnabled: true,
        listStatus: 'succeeded',
      },
      undefined,
      { ...initialAppSeoResearchState, researchEnabled: false },
    );
    expect(screen.queryByTestId('app-keyword-discovery')).toBeNull();
  });

  it('previews and confirms a keyword, changes scope, deletes, and rechecks explicitly', async () => {
    const user = userEvent.setup();
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [keyword('existing')],
      trackingEnabled: true,
      listStatus: 'succeeded',
    });

    await user.type(screen.getByLabelText('Keyword'), '  useful phrase  ');
    await user.click(screen.getByRole('combobox', { name: 'Country' }));
    await user.click(screen.getByRole('option', { name: /Germany/ }));
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() =>
      expect(trackingApi.previewMintAppKeyword).toHaveBeenCalledWith('site-1', 'profile-1', {
        phrase: 'useful phrase',
        store: 'google_play',
        locationCode: 2276,
        languageCode: 'de',
      }),
    );
    expect(await screen.findByText('Add this tracked keyword?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(trackingApi.createTrackedAppKeyword).toHaveBeenCalled());
    expect(screen.getByLabelText('Keyword')).toHaveValue('');

    await user.click(screen.getByRole('combobox', { name: 'Country' }));
    await user.click(screen.getByRole('option', { name: /United States/ }));

    await user.click(screen.getAllByRole('button', { name: /View history/ })[0]!);
    await user.click(screen.getAllByRole('button', { name: /Check .* now/ })[0]!);
    expect(await screen.findByText('Check this keyword now?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() =>
      expect(trackingApi.recheckTrackedAppKeyword).toHaveBeenCalledWith('site-1', 'created', true),
    );

    await user.click(screen.getAllByRole('button', { name: /Delete/ })[0]!);
    await waitFor(() => expect(trackingApi.removeTrackedAppKeyword).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    await user.click(screen.getByRole('option', { name: '987654321' }));
    await waitFor(() =>
      expect(trackingApi.fetchAppKeywords).toHaveBeenCalledWith('site-1', 'apple-only'),
    );
    await user.click(screen.getByRole('combobox', { name: 'App profile' }));
    expect(screen.getByRole('option', { name: 'profile-empty' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: 'com.example.playonly' }));
    await waitFor(() =>
      expect(trackingApi.fetchAppKeywords).toHaveBeenCalledWith('site-1', 'play-only'),
    );
  });

  it('keeps preview, mint, recheck, and history errors localized', async () => {
    trackingApi.previewMintAppKeyword.mockRejectedValueOnce(new Error('preview failed'));
    trackingApi.recheckTrackedAppKeyword.mockRejectedValueOnce(new Error('recheck preview failed'));
    trackingApi.fetchTrackedAppKeywordHistory.mockRejectedValueOnce(new Error('history failed'));
    const user = userEvent.setup();
    const view = renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      items: [keyword('existing')],
      trackingEnabled: true,
      listStatus: 'succeeded',
    });
    await user.type(screen.getByLabelText('Keyword'), 'failure phrase');
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    expect(await screen.findByText('The request could not be completed. Try again.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /View history/ }));
    await waitFor(() => expect(view.store.getState().appSeoTracking.historyStatus).toBe('failed'));
    await user.click(screen.getByRole('button', { name: /Check .* now/ }));
    await waitFor(() => expect(view.store.getState().appSeoTracking.mutationStatus).toBe('failed'));
  });

  it('disables minting when markets fail', () => {
    useMarketCatalogMock.mockReturnValue({ markets: [], loading: false, error: true });
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      trackingEnabled: true,
      listStatus: 'succeeded',
    });
    expect(screen.getByText('Countries could not be loaded. Try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add keyword' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
  });

  it('normalizes non-US markets and preserves an unknown language code', async () => {
    useMarketCatalogMock.mockReturnValue({
      markets: [{ countryCode: 'FR', locationCode: 2250, languageCodes: ['_'] }],
      loading: false,
      error: false,
    });
    const user = userEvent.setup();
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      trackingEnabled: true,
      listStatus: 'succeeded',
    });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('France'),
    );
    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    expect(screen.getByRole('option', { name: '_' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText('Keyword'), 'localized phrase');
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() =>
      expect(trackingApi.previewMintAppKeyword).toHaveBeenCalledWith('site-1', 'profile-1', {
        phrase: 'localized phrase',
        store: 'google_play',
        locationCode: 2250,
        languageCode: '_',
      }),
    );
  });

  it('falls back to English when a market unexpectedly has no language catalog', async () => {
    useMarketCatalogMock.mockReturnValue({
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: [] }],
      loading: false,
      error: false,
    });
    const user = userEvent.setup();
    renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      trackingEnabled: true,
      listStatus: 'succeeded',
    });
    await user.click(screen.getByRole('combobox', { name: 'Country' }));
    await user.click(screen.getByRole('option', { name: /United States/ }));
    await user.type(screen.getByLabelText('Keyword'), 'fallback language');
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() =>
      expect(trackingApi.previewMintAppKeyword).toHaveBeenCalledWith('site-1', 'profile-1', {
        phrase: 'fallback language',
        store: 'google_play',
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
  });

  it('rejects invalid form submissions and ignores dialogs without their bound records', async () => {
    useMarketCatalogMock.mockReturnValue({ markets: [], loading: false, error: false });
    const invalid = renderPanel({
      ...initialAppSeoTrackingState,
      siteId: 'site-1',
      profileId: 'profile-1',
      trackingEnabled: true,
      listStatus: 'succeeded',
    });
    const form = screen.getByLabelText('Keyword').closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'no market' } });
    fireEvent.submit(form!);
    expect(trackingApi.previewMintAppKeyword).not.toHaveBeenCalled();
    invalid.unmount();

    const user = userEvent.setup();
    const mint = renderPanel(
      {
        ...initialAppSeoTrackingState,
        siteId: 'site-1',
        profileId: 'profile-1',
        trackingEnabled: true,
        listStatus: 'succeeded',
        mintPreview: { check: {} },
      },
      '/sites/site-1?tab=apps&view=keywords&profile=profile-1&action=mint',
    );
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    expect(trackingApi.createTrackedAppKeyword).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    mint.unmount();

    renderPanel(
      {
        ...initialAppSeoTrackingState,
        siteId: 'site-1',
        profileId: 'profile-1',
        trackingEnabled: true,
        listStatus: 'succeeded',
        recheckPreview: {
          preview: {},
          queued: false,
          reservationStamp: null,
        },
      },
      '/sites/site-1?tab=apps&view=keywords&profile=profile-1&action=recheck',
    );
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(trackingApi.recheckTrackedAppKeyword).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
  });
});
