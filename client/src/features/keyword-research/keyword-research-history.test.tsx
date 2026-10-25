import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import { isolateText } from '@shared/lib/bidi';
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
  lookupId: null,
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

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname + location.search}</div>;
};

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
  it('languageLabel resolves known codes and localizes unknown codes', () => {
    expect(languageLabel('en', t)).toBe('English');
    expect(languageLabel('xx', t)).toBe('common:market.unknownLanguage');
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
    // The wide table (narrow containers get the same rows as cards).
    const table = within(screen.getByRole('table'));
    // Kind badges (localized).
    expect(table.getByText('Metrics')).toBeInTheDocument();
    expect(table.getByText('Related')).toBeInTheDocument();
    expect(table.getByText('Intent')).toBeInTheDocument();
    expect(table.getByText('Ideas')).toBeInTheDocument();
    // Joined multi-phrase query.
    expect(table.getByText('a, b')).toBeInTheDocument();
    // Cached vs live source chips.
    expect(table.getByText('Cached')).toBeInTheDocument();
    expect(table.getAllByText('Live').length).toBeGreaterThan(0);
    // Legacy country and language codes use localized compatibility labels.
    expect(table.getByText('Unknown country')).toBeInTheDocument();
    expect(table.getByText('Unknown language')).toBeInTheDocument();
    expect(table.queryByText('xx')).toBeNull();
    // Known location label resolves.
    expect(table.getAllByText('United States').length).toBeGreaterThan(0);
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

  it('lets long cells wrap so Date and Actions stay inside the card', async () => {
    const phrases = ['best running shoes for flat feet', 'trail running shoes', 'marathon plan'];
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ phrases })],
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    // The query list wraps (clamped to two lines) with the full text on hover,
    // instead of a single nowrap line that widened the table past the card.
    const query = screen.getByTestId('keyword-research-history-query-h1');
    expect(query).toHaveTextContent(phrases.join(', '));
    expect(query).toHaveClass('line-clamp-2', 'break-words', 'max-w-64');
    expect(query.closest('td')).toHaveClass('whitespace-normal');
    expect(query.closest('td')).toHaveAttribute('title', isolateText(phrases.join(', ')));
    expect(screen.getByTestId('keyword-research-history-date-h1')).toHaveClass('whitespace-normal');
    expect(screen.getByTestId('keyword-research-history-search-again-h1')).toHaveClass(
      'whitespace-normal',
    );
  });

  it('lists each lookup as a card in a narrow container instead of a wide table', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ phrases: ['uptime monitor', 'status page'] })],
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    expect(screen.getByRole('table').closest('[data-slot="table-container"]')?.parentElement).toHaveClass(
      'hidden',
      '@4xl:block',
    );
    const cards = screen.getByRole('list', { name: 'Research history' });
    expect(cards).toHaveClass('@4xl:hidden');
    const card = within(cards).getByTestId('keyword-research-history-card-h1');
    expect(within(card).getByText('uptime monitor, status page')).toBeInTheDocument();
    expect(within(card).getByText('Metrics')).toBeInTheDocument();
    expect(within(card).getAllByRole('term').map((node) => node.textContent)).toEqual([
      'Location',
      'Language',
      'Results',
      'Date',
    ]);
    // The card's actions keep the hints and their own test ids.
    expect(within(card).getByTestId('keyword-research-history-card-view-h1')).toHaveAttribute(
      'aria-describedby',
      'keyword-research-history-hint-view',
    );
    expect(
      within(card).getByTestId('keyword-research-history-card-search-again-h1'),
    ).toHaveAttribute('aria-describedby', 'keyword-research-history-search-again-hint');
  });

  it('folds the metrics and intent records of one Research press into one row', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem({ id: 'i1', kind: 'intent', phrases: ['rank tracker'], lookupId: 'press-1' }),
        historyItem({ id: 'm1', kind: 'metrics', phrases: ['rank tracker'], lookupId: 'press-1' }),
      ],
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    const row = screen.getByTestId('keyword-research-history-row-m1');
    expect(row).toHaveTextContent('Metrics');
    expect(row).toHaveTextContent('Intent');
    expect(screen.queryByTestId('keyword-research-history-row-i1')).toBeNull();
  });

  it('opens the saved results of a viewable row and hides the action for other kinds', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'g1', kind: 'gap', phrases: ['rival.example'] }), historyItem()],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <MemoryRouter>
              <Routes>
                <Route path="/" element={<KeywordResearchHistoryPage />} />
                <Route path="/keyword-research" element={<LocationProbe />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </I18nextProvider>
      </Provider>,
    );
    await screen.findByTestId('keyword-research-history-table');
    expect(screen.queryByTestId('keyword-research-history-view-g1')).toBeNull();
    expect(screen.getByTestId('keyword-research-history-hint-view')).toHaveTextContent(
      'does not call the data provider again',
    );
    await user.click(screen.getByTestId('keyword-research-history-view-h1'));
    const probe = await screen.findByTestId('location-probe');
    expect(probe.textContent).toBe('/keyword-research?stored=h1');
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
    expect(within(screen.getByRole('table')).getByText('uptime monitor')).toBeInTheDocument();
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

  it('states how many saved lookups are loaded of the whole list, up to the last page', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem()],
      nextCursor: 'h1',
      total: 2,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    expect(screen.getByTestId('keyword-research-history-count')).toHaveTextContent(
      'Showing 1 of 2 saved lookups',
    );
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'h2', phrases: ['older query'] })],
      nextCursor: null,
      total: 2,
    });
    await user.click(screen.getByTestId('keyword-research-history-load-more'));
    await screen.findByTestId('keyword-research-history-row-h2');
    expect(screen.getByTestId('keyword-research-history-count')).toHaveTextContent(
      'Showing 2 of 2 saved lookups',
    );
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
      // Distinct phrases per row: identical metrics + intent rows would (correctly)
      // fold into one lookup row, which a different test covers.
      items: kinds.map((kind, i) => historyItem({ id: `k${i}`, kind, phrases: [`phrase ${i}`] })),
      nextCursor: null,
    });
    withProviders(<KeywordResearchHistoryPage />);
    await screen.findByTestId('keyword-research-history-table');
    await waitFor(() =>
      expect(screen.getAllByTestId(/keyword-research-history-row-/)).toHaveLength(9),
    );
    // Kinds are categories, so none may borrow a status tone: an Intent chip in
    // warning/destructive colours reads as an error next to Metrics.
    const chips = document.querySelectorAll('[data-slot="status-chip"][data-tone]');
    const tones = Array.from(chips)
      .map((chip) => chip.getAttribute('data-tone'))
      .filter((tone) => tone === 'warning' || tone === 'destructive');
    expect(tones).toEqual([]);
    expect(screen.getByTestId('keyword-research-history-row-k2').querySelector('[data-tone]'))
      .toHaveAttribute('data-tone', 'info');
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
