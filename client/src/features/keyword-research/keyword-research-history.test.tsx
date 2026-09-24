import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import { TooltipProvider } from '@shared/ui/tooltip';
import * as api from './api';
import { ranksReducer } from '@features/ranks';
import { keywordResearchReducer, KeywordResearchHistoryPage, loadHistory } from './index';
import { languageLabel, locationLabel } from './components/KeywordResearchHistoryPage';
import type { HistoryResponse, ResearchHistoryItem, ResearchHistoryKind } from './types';

vi.mock('./api', () => ({
  fetchMetricsRequest: vi.fn(),
  fetchRelatedRequest: vi.fn(),
  fetchIntentRequest: vi.fn().mockResolvedValue({ intents: [] }),
  fetchIdeasRequest: vi.fn().mockResolvedValue({ seed: '', ideas: [], cached: false }),
  fetchHistoryRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const makeStore = () =>
  configureStore({
    reducer: { keywordResearch: keywordResearchReducer, ranks: ranksReducer },
  });

const historyItem = (overrides: Partial<ResearchHistoryItem> = {}): ResearchHistoryItem => ({
  id: 'h1',
  kind: 'metrics',
  phrases: ['seo audit tool'],
  locationCode: 2840,
  languageCode: 'en',
  resultCount: 3,
  cached: false,
  createdAt: '2026-07-01T12:30:00.000Z',
  ...overrides,
});

const withProviders = (ui: React.ReactNode, store = makeStore()) =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </TooltipProvider>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  return changeLanguage('en');
});
afterEach(() => vi.clearAllMocks());

describe('label helpers', () => {
  const t = (k: string) => k;
  it('locationLabel resolves known codes and localizes unknown codes', () => {
    expect(locationLabel(2840, t)).toBe('United States');
    expect(locationLabel(999, t)).toBe('common:market.unknownCountry');
  });
  it('languageLabel resolves known codes and preserves unknown codes', () => {
    expect(languageLabel('en', t)).toBe('English');
    expect(languageLabel('xx', t)).toBe('xx');
    expect(languageLabel('', t)).toBe('common:market.unknownLanguage');
  });
});

describe('loadHistory thunk + slice', () => {
  it('fulfilled replaces items on a cursor-less load and stores nextCursor', async () => {
    const store = makeStore();
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem()],
      nextCursor: 'h1',
    });
    await store.dispatch(loadHistory({}));
    const state = store.getState().keywordResearch;
    expect(state.history).toHaveLength(1);
    expect(state.historyLoaded).toBe(true);
    expect(state.historyCursor).toBe('h1');
    // A later cursor-less load replaces (fresh first page), never duplicates.
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'h9' })],
      nextCursor: null,
    });
    await store.dispatch(loadHistory({}));
    expect(store.getState().keywordResearch.history.map((r) => r.id)).toEqual(['h9']);
  });

  it('fulfilled APPENDS items when a cursor was passed', async () => {
    const store = makeStore();
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem()],
      nextCursor: 'h1',
    });
    await store.dispatch(loadHistory({}));
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'h2', phrases: ['older'] })],
      nextCursor: null,
    });
    await store.dispatch(loadHistory({ cursor: 'h1' }));
    const state = store.getState().keywordResearch;
    expect(state.history.map((r) => r.id)).toEqual(['h1', 'h2']);
    expect(state.historyCursor).toBeNull();
  });

  it('rejected sets historyError', async () => {
    const store = makeStore();
    mocked.fetchHistoryRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await store.dispatch(loadHistory({}));
    expect(store.getState().keywordResearch.historyError).toBeTruthy();
  });

  it('rejected with undefined payload hits the ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadHistory.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        arg: {},
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    } as UnknownAction);
    expect(store.getState().keywordResearch.historyError).toBe('');
    expect(store.getState().keywordResearch.historyLoading).toBe(false);
  });
});

describe('KeywordResearchHistoryPage', () => {
  it('loads on mount and renders one row per entry with kind + source chips', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem(),
        historyItem({ id: 'h2', kind: 'related', phrases: ['seo'], cached: true }),
        historyItem({ id: 'h3', kind: 'intent', phrases: ['a', 'b'] }),
        historyItem({ id: 'h4', kind: 'ideas', locationCode: 999, languageCode: 'xx' }),
      ],
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    expect(mocked.fetchHistoryRequest).toHaveBeenCalledTimes(1);

    // One row per entry.
    for (const id of ['h1', 'h2', 'h3', 'h4']) {
      expect(screen.getByTestId(`keyword-research-history-row-${id}`)).toBeInTheDocument();
    }
    // Kind badges (localized).
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Related')).toBeInTheDocument();
    expect(screen.getByText('Intent')).toBeInTheDocument();
    expect(screen.getByText('Ideas')).toBeInTheDocument();
    // Joined multi-phrase query.
    expect(screen.getByText('a, b')).toBeInTheDocument();
    // Cached vs live source chips.
    expect(screen.getByText('Cached')).toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    // Unknown country values use localized compatibility labels; unknown
    // language codes remain visible for legacy history rows.
    expect(screen.getByText('Unknown country')).toBeInTheDocument();
    expect(screen.getByText('xx')).toBeInTheDocument();
    // Known location label resolves.
    expect(screen.getAllByText('United States').length).toBeGreaterThan(0);
    const resultsHelp = screen.getByRole('button', { name: 'About Results' });
    fireEvent.click(resultsHelp, { detail: 0 });
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'The number of rows returned by this research run.',
    );
    fireEvent.click(resultsHelp, { detail: 0 });
    const sourceHelp = screen.getByRole('button', { name: 'About Source' });
    fireEvent.click(sourceHelp, { detail: 0 });
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Live means fetched from the provider for this run.',
      ),
    );
    fireEvent.click(sourceHelp, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'About Type' }), { detail: 0 });
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'The research operation used for this row',
      ),
    );
    // No load-more button on a terminal page.
    expect(screen.queryByTestId('keyword-research-history-load-more')).not.toBeInTheDocument();
  });

  it('re-fetches on mount when history was already loaded (reflects searches since the last visit)', async () => {
    const store = makeStore();
    // A prior visit loaded an EMPTY history and set historyLoaded=true — this is
    // the reported bug: the page was fetched before the user's search recorded.
    mocked.fetchHistoryRequest.mockResolvedValueOnce({ items: [], nextCursor: null });
    await store.dispatch(loadHistory({}));
    expect(store.getState().keywordResearch.historyLoaded).toBe(true);

    // A search has since recorded a row; mounting the page again must refetch
    // (not short-circuit on historyLoaded) so the new row appears without a reload.
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'fresh', phrases: ['uptime monitor'] })],
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />, store);
    await screen.findByTestId('keyword-research-history-row-fresh');
    expect(mocked.fetchHistoryRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByText('uptime monitor')).toBeInTheDocument();
  });

  it('shows the empty state when the account has no history', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({ items: [], nextCursor: null });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-empty');
  });

  it('shows the loading skeleton while the first page is in flight', async () => {
    let resolve: (v: HistoryResponse) => void = () => undefined;
    mocked.fetchHistoryRequest.mockImplementationOnce(
      () =>
        new Promise<HistoryResponse>((r) => {
          resolve = r;
        }),
    );
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-loading');
    resolve({ items: [historyItem()], nextCursor: null });
    await screen.findByTestId('keyword-research-history-table');
  });

  it('shows an error alert when the load fails', async () => {
    mocked.fetchHistoryRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-error');
  });

  it('load more fetches the next cursor page and appends', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem()],
      nextCursor: 'h1',
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'h2', phrases: ['older query'] })],
      nextCursor: null,
    });
    await user.click(screen.getByTestId('keyword-research-history-load-more'));
    await screen.findByTestId('keyword-research-history-row-h2');
    // First page still present (appended, not replaced).
    expect(screen.getByTestId('keyword-research-history-row-h1')).toBeInTheDocument();
    expect(mocked.fetchHistoryRequest).toHaveBeenLastCalledWith({ cursor: 'h1' });
    // Terminal page → button gone.
    expect(screen.queryByTestId('keyword-research-history-load-more')).not.toBeInTheDocument();
  });

  it('search again navigates to a prefilled /keyword-research URL without any API call', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem({
          id: 'h5',
          phrases: ['seo audit tool', 'rank tracker'],
          locationCode: 2826,
          languageCode: 'de',
        }),
      ],
      nextCursor: null,
    });
    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="location-probe">{location.pathname + location.search}</div>;
    };
    const user = userEvent.setup();
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <MemoryRouter initialEntries={['/keyword-research/history']}>
              <Routes>
                <Route path="/keyword-research/history" element={<KeywordResearchHistoryPage />} />
                <Route path="/keyword-research" element={<LocationProbe />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </I18nextProvider>
      </Provider>,
    );
    await screen.findByTestId('keyword-research-history-table');
    await user.click(screen.getByTestId('keyword-research-history-search-again-h5'));
    const probe = await screen.findByTestId('location-probe');
    const [pathname = '', search = ''] = probe.textContent!.split('?');
    expect(pathname).toBe('/keyword-research');
    const params = new URLSearchParams(search);
    expect(params.get('q')).toBe('seo audit tool,rank tracker');
    expect(params.get('location')).toBe('2826');
    expect(params.get('lang')).toBe('de');
    // Navigation only — no research POST fired.
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
    expect(mocked.fetchIdeasRequest).not.toHaveBeenCalled();
  });

  it('back link points at /keyword-research', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({ items: [], nextCursor: null });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-empty');
    expect(screen.getByTestId('keyword-research-history-back')).toHaveAttribute(
      'href',
      '/keyword-research',
    );
  });

  it('renders every kind tone without crashing (exhaustive KIND_TONE map)', async () => {
    const kinds: ResearchHistoryKind[] = [
      'metrics',
      'related',
      'intent',
      'ideas',
      'long_tail',
      'gap',
      'overview',
      'trends',
      'clusters',
    ];
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: kinds.map((kind, i) => historyItem({ id: `k${i}`, kind })),
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    await waitFor(() =>
      expect(screen.getAllByTestId(/keyword-research-history-row-/)).toHaveLength(9),
    );
  });

  it('labels the kinds the server already writes (latent-defect fix)', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem({ id: 'g1', kind: 'gap' }),
        historyItem({ id: 'o1', kind: 'overview' }),
        historyItem({ id: 't1', kind: 'trends' }),
        historyItem({ id: 'c1', kind: 'clusters' }),
      ],
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    expect(screen.getByTestId('keyword-research-history-row-g1')).toHaveTextContent('Gap');
    expect(screen.getByTestId('keyword-research-history-row-o1')).toHaveTextContent('Overview');
    expect(screen.getByTestId('keyword-research-history-row-t1')).toHaveTextContent('Trends');
    expect(screen.getByTestId('keyword-research-history-row-c1')).toHaveTextContent('Clusters');
    // Never a raw i18n key path leaking into the table.
    expect(screen.queryByText(/history\.kind\./)).toBeNull();
  });
});
