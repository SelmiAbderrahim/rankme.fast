import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';

vi.mock('../api', () => ({
  getWeeklyPulseState: vi.fn(),
  previewWeeklyPulse: vi.fn(),
  setWeeklyPulseSubscription: vi.fn(),
  listWeeklyPulseHistory: vi.fn(),
  getWeeklyPulseHistoryDetail: vi.fn(),
  getGenerativeAppearance: vi.fn(),
}));

import * as api from '../api';
import { GscGenerativeAppearanceCard } from './GscGenerativeAppearanceCard';
import { weeklyPulseReducer } from '../store/slice';

async function withProviders(children: React.ReactElement) {
  const store = configureStore({ reducer: { weeklyPulse: weeklyPulseReducer } });
  const i18n = initI18n({ initialLocale: 'en' });
  return (
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Provider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('GscGenerativeAppearanceCard', () => {
  it('renders loading state initially', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    expect(screen.getByText(/Loading Google Search Console/i)).toBeInTheDocument();
  });

  it('renders available rows', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'available',
        window: { start: '2025-12-01', end: '2026-01-04', windowDays: 28 },
        rows: [
          {
            rawAppearance: 'AI_OVERVIEW',
            classificationSlug: 'ai_overviews',
            isGenerative: true,
            clicks: 5,
            impressions: 120,
            ctr: 0.04,
            position: 4,
          },
        ],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() =>
      expect(screen.getByTestId('gsc-appearance-row')).toBeInTheDocument(),
    );
  });

  it('renders unavailable empty state', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'unavailable',
        window: null,
        rows: [],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() => expect(screen.getByTestId('gsc-empty')).toBeInTheDocument());
  });

  it('renders reconnect state', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'reconnect_required',
        window: null,
        rows: [],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() => expect(screen.getByTestId('gsc-reconnect')).toBeInTheDocument());
  });

  it('renders partial state', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'partial',
        window: null,
        rows: [],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() => expect(screen.getByTestId('gsc-partial')).toBeInTheDocument());
  });

  it('falls back to unavailable when only non-generative rows are present', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'available',
        window: null,
        rows: [
          {
            rawAppearance: 'REVIEW_SNIPPET',
            classificationSlug: 'other_unknown',
            isGenerative: false,
            clicks: 5,
            impressions: 120,
            ctr: 0.04,
            position: 4,
          },
        ],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() => expect(screen.getByTestId('gsc-empty')).toBeInTheDocument());
  });

  it('renders failed status with an alert', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'failed',
        window: null,
        rows: [],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
  });

  it('renders network error alert on rejected fetch', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('renders the reconnect copy when the fetch fails with a reconnect 404', async () => {
    const { ApiError } = await import('@shared/api/client');
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('GSC reconnect required', 404, null),
    );
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() =>
      expect(
        screen.getByText(/Reconnect Google Search Console to load this data/i),
      ).toBeInTheDocument(),
    );
  });

  it('renders generative rows without the window line when window is null', async () => {
    (api.getGenerativeAppearance as ReturnType<typeof vi.fn>).mockResolvedValue({
      appearance: {
        status: 'available',
        window: null,
        rows: [
          {
            rawAppearance: 'AI_OVERVIEW',
            classificationSlug: 'ai_overviews',
            isGenerative: true,
            clicks: 5,
            impressions: 120,
            ctr: 0.04,
            position: 4,
          },
        ],
        observationMeta: null,
      },
    });
    render(await withProviders(<GscGenerativeAppearanceCard siteId="s1" />));
    await waitFor(() =>
      expect(screen.getByTestId('gsc-appearance-row')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Window:/i)).not.toBeInTheDocument();
  });
});
