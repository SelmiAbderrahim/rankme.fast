import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { appSeoReducer } from '../../store/slice';
import {
  appSeoTrackingReducer,
  initialAppSeoTrackingState,
} from '../../store/tracking-slice';
import { confirmTrackedAppKeywordRecheck } from '../../store/tracking-thunks';
import * as trackingApi from '../../tracking-api';
import { AppKeywordTrackingPanel } from './AppKeywordTrackingPanel';

const useMarketCatalogMock = vi.hoisted(() => vi.fn());

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: (surface: string) => useMarketCatalogMock(surface),
}));

vi.mock('@features/report-export', () => ({ ReportExportControl: () => null }));

vi.mock('../../tracking-api', () => ({
  fetchAppKeywords: vi.fn(),
  fetchTrackedAppKeywordHistory: vi.fn(),
  previewMintAppKeyword: vi.fn(),
  createTrackedAppKeyword: vi.fn(),
  removeTrackedAppKeyword: vi.fn(),
  recheckTrackedAppKeyword: vi.fn(),
}));

const emptyList = {
  items: [],
  trackingEnabled: true,
};

describe('AppKeywordTrackingPanel markets', () => {
  beforeEach(async () => {
    initI18n({ initialLocale: 'en' });
    await changeLanguage('en');
    vi.resetAllMocks();
    vi.mocked(trackingApi.fetchAppKeywords).mockResolvedValue(emptyList);
    useMarketCatalogMock.mockImplementation((surface: string) => ({
      markets: surface === 'app-google-play'
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

  it('reloads the catalog and resets country and language when the store changes', async () => {
    const store = configureStore({
      reducer: {
        appSeo: appSeoReducer,
        appSeoTracking: appSeoTrackingReducer,
      },
      preloadedState: {
        appSeo: {
          profiles: [{
            id: 'profile-1',
            siteId: 'site-1',
            playPackageId: 'com.example.app',
            appStoreId: '123456789',
            paired: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
          registration: { status: 'idle' as const, message: '' },
        },
        appSeoTracking: {
          ...initialAppSeoTrackingState,
          ...emptyList,
          listStatus: 'succeeded' as const,
        },
      },
    });
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter>
            <AppKeywordTrackingPanel siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    );

    const country = screen.getByRole('combobox', { name: 'Country' });
    await user.click(country);
    await user.click(screen.getByRole('option', { name: /Germany/ }));
    expect(country).toHaveTextContent('Germany');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('German');

    await user.click(screen.getByRole('combobox', { name: 'Store' }));
    await user.click(screen.getByRole('option', { name: 'App Store' }));

    await waitFor(() => expect(useMarketCatalogMock).toHaveBeenLastCalledWith('app-store'));
    expect(country).toHaveTextContent('United States');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English');
  });

  it('marks a confirmed check as queued and polls until its durable status changes', async () => {
    vi.useFakeTimers();
    const trackedKeyword = {
      id: 'keyword-1',
      profileId: 'profile-1',
      store: 'google_play' as const,
      phrase: 'keyword',
      locationCode: 2840,
      languageCode: 'en',
      active: true,
      latestPosition: null,
      previousPosition: null,
      delta: null,
      lastCheckedAt: null,
      lastFailedCheckAt: null,
      checkStatus: 'idle' as const,
      createdAt: '2026-08-11T22:23:30.000Z',
    };
    vi.mocked(trackingApi.fetchAppKeywords).mockReturnValueOnce(
      new Promise<never>(() => undefined),
    ).mockResolvedValueOnce({
      ...emptyList,
      items: [{
        ...trackedKeyword,
        checkStatus: 'failed',
        lastFailedCheckAt: '2026-08-11T22:23:31.000Z',
      }],
    });
    const store = configureStore({
      reducer: {
        appSeo: appSeoReducer,
        appSeoTracking: appSeoTrackingReducer,
      },
      preloadedState: {
        appSeo: {
          profiles: [{
            id: 'profile-1',
            siteId: 'site-1',
            playPackageId: 'com.example.app',
            appStoreId: null,
            paired: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
          registration: { status: 'idle' as const, message: '' },
        },
        appSeoTracking: {
          ...initialAppSeoTrackingState,
          ...emptyList,
          siteId: 'site-1',
          profileId: 'profile-1',
          items: [trackedKeyword],
          listStatus: 'succeeded' as const,
        },
      },
    });
    const rendered = render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={['/?profile=profile-1']}>
            <AppKeywordTrackingPanel siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    );

    try {
      await act(() => {
        store.dispatch(confirmTrackedAppKeywordRecheck.fulfilled(
          {
            preview: {},
            queued: true,
            reservationStamp: '2026-W33',
          },
          'request-1',
          { siteId: 'site-1', keywordId: 'keyword-1' },
        ));
      });
      expect(screen.getByRole('status')).toHaveTextContent('Checking…');
      expect(screen.getByRole('button', { name: 'Check keyword now' })).toBeDisabled();
      expect(trackingApi.fetchAppKeywords).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });

      expect(trackingApi.fetchAppKeywords).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getAllByText('Check failed')).toHaveLength(2);
      expect(screen.getByRole('button', { name: 'Check keyword now' })).toBeEnabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });
      expect(trackingApi.fetchAppKeywords).toHaveBeenCalledTimes(2);
    } finally {
      rendered.unmount();
      vi.useRealTimers();
    }
  });

  it('keeps row status unchanged when a recheck was not queued', () => {
    const state = {
      ...initialAppSeoTrackingState,
      items: [{
        id: 'keyword-1',
        profileId: 'profile-1',
        store: 'google_play' as const,
        phrase: 'keyword',
        locationCode: 2840,
        languageCode: 'en',
        active: true,
        latestPosition: null,
        previousPosition: null,
        delta: null,
        lastCheckedAt: null,
        lastFailedCheckAt: null,
        checkStatus: 'idle' as const,
        createdAt: '2026-08-11T22:23:30.000Z',
      }],
    };
    const response = {
      preview: {},
      queued: false,
      reservationStamp: '2026-W33',
    };

    const deduplicated = appSeoTrackingReducer(
      state,
      confirmTrackedAppKeywordRecheck.fulfilled(
        response,
        'request-2',
        { siteId: 'site-1', keywordId: 'keyword-1' },
      ),
    );
    const missingKeyword = appSeoTrackingReducer(
      state,
      confirmTrackedAppKeywordRecheck.fulfilled(
        { ...response, queued: true },
        'request-3',
        { siteId: 'site-1', keywordId: 'missing-keyword' },
      ),
    );

    expect(deduplicated.items[0]?.checkStatus).toBe('idle');
    expect(missingKeyword.items[0]?.checkStatus).toBe('idle');
  });
});
