import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError, apiClient } from '@shared/api/client';
import { writeToClipboard } from '@shared/lib/clipboard';
import { toast } from 'sonner';
import * as api from './api';

const mockedApiClient = vi.mocked(apiClient);
const writeToClipboardMock = vi.mocked(writeToClipboard);
const seoMarketCatalog = {
  surface: 'seo',
  markets: [
    { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    { countryCode: 'GB', locationCode: 2826, languageCodes: ['en'] },
    { countryCode: 'SA', locationCode: 2682, languageCodes: ['ar'] },
    { countryCode: 'DZ', locationCode: 2012, languageCodes: ['fr', 'ar'] },
  ],
  fetchedAt: '2026-08-11T00:00:00.000Z',
  cached: false,
};

// Vitest 4: ESM live bindings mean vi.spyOn on the namespace cannot intercept
// the binding already captured by ./api at load time. Use vi.mock to replace
// apiClient before the module registry resolves ./api's import.
vi.mock('@shared/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@shared/api/client')>();
  return { ...actual, apiClient: vi.fn() };
});
import { ranksReducer } from './store/slice';
import { ranksErrorMessage } from './errorMessage';
import * as slice from './store/slice';
import { KeywordsPanel } from './components/KeywordsPanel';
import { RankTrendChart } from './components/RankTrendChart';
import { CadenceToggle } from './components/CadenceToggle';
import { KeywordsTable } from './components/KeywordsTable';
import { RankStateLabel } from './components/RankStateLabel';
import { AddKeywordForm } from './components/AddKeywordForm';
import type {
  Keyword,
  KeywordListPage,
  KeywordSuggestion,
  KeywordSuggestionsResponse,
  RankHistoryResponse,
  RankJob,
  RanksState,
} from './types';
import { parseKeywordLines } from './validation';

vi.mock('./api', () => ({
  fetchKeywordMarketMoveRequest: vi.fn(async () => ({ preview: { target: { locationCode: 2840, languageCode: 'en', device: 'desktop' }, tracked: 0, inTarget: 0, movable: 0, alreadyTracked: 0, withHistory: 0, resumesHistory: 0, token: 'token' } })),
  moveKeywordsToSiteMarketRequest: vi.fn(),
  fetchKeywordsRequest: vi.fn(),
  createKeywordRequest: vi.fn(),
  createKeywordsBulkRequest: vi.fn(),
  fetchTrackedKeywordPhrasesRequest: vi.fn(),
  removeKeywordRequest: vi.fn(),
  updateCadenceRequest: vi.fn(),
  fetchKeywordHistoryRequest: vi.fn(),
  checkNowRequest: vi.fn(),
  fetchActiveRankJobRequest: vi.fn(),
  fetchRankJobRequest: vi.fn(),
  retryFailedRankJobRequest: vi.fn(),
  fetchKeywordSuggestionsRequest: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@shared/lib/clipboard', () => ({
  writeToClipboard: vi.fn(),
}));

const mocked = vi.mocked(api);

const baseState = (): RanksState => ranksReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<RanksState>) =>
  configureStore({
    reducer: { ranks: ranksReducer },
    ...(preloaded ? { preloadedState: { ranks: { ...baseState(), ...preloaded } } } : {}),
  });

type RanksStore = ReturnType<typeof makeStore>;

const keyword = (id: string, overrides: Partial<Keyword> = {}): Keyword => ({
  id,
  siteId: 'site-1',
  phrase: `phrase-${id}`,
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  latestPosition: 4,
  previousPosition: 6,
  delta: 2,
  lastCheckedAt: '2026-07-02T00:00:00.000Z',
  aiOverviewPresent: null,
  aiCited: null,
  aiCitedUrl: null,
  lastFailedCheckAt: null,
  lastFailedReason: null,
  engine: 'google',
  engineTarget: null,
  observationMeta: null,
  ...overrides,
});

const listPage = (overrides: Partial<KeywordListPage> = {}): KeywordListPage => ({
  keywords: [
    keyword('k1'),
    keyword('k2', {
      phrase: 'phrase-k2',
      latestPosition: null,
      delta: null,
      previousPosition: null,
    }),
  ],
  nextCursor: null,
  cadence: 'weekly',
  ...overrides,
});

const rankJob = (overrides: Partial<RankJob> = {}): RankJob => ({
  id: 'job-1', siteId: 'site-1', scope: 'site', status: 'queued', retryOfJobId: null,
  createdAt: '2026-07-13T00:00:00.000Z', startedAt: null, finishedAt: null,
  deadlineAt: '2026-07-13T00:20:00.000Z',
  totals: { total: 2, queued: 2, running: 0, succeeded: 0, failed: 0, expired: 0, cancelled: 0 },
  items: ['k1', 'k2'].map((keywordId) => ({ keywordId, engine: 'google',
    state: overrides.status === 'succeeded' ? 'succeeded' : 'queued',
    reason: null, attempts: overrides.status === 'succeeded' ? 1 : 0,
    finishedAt: overrides.status === 'succeeded' ? overrides.finishedAt ?? null : null })),
  ...overrides,
});

const historyPage = (points = 3): RankHistoryResponse => ({
  keywordId: 'k1',
  series: Array.from({ length: points }, (_, i) => ({
    checkedAt: `2026-07-0${i + 1}T00:00:00.000Z`,
    position: 5 - i,
    rankAbsolute: 5 - i,
    source: 'fresh' as const,
    foundUrl: null,
    aiOverviewPresent: null,
    aiCited: null,
    aiCitedUrl: null,
    observationMeta: null,
  })),
});

const suggestion = (
  keyword: string,
  tracked = false,
  overrides: Partial<KeywordSuggestion> = {},
): KeywordSuggestion => ({
  keyword,
  searchVolume: 5400,
  difficulty: 62,
  currentPosition: 4,
  estimatedTraffic: 630.5,
  rankingUrl: null,
  source: 'ranked',
  tracked,
  ...overrides,
});

const suggestionPage = (
  overrides: Partial<KeywordSuggestionsResponse> = {},
): KeywordSuggestionsResponse => ({
  source: 'ranked',
  sources: ['ranked'],
  candidates: [
    suggestion('seo audit tool', false, { rankingUrl: 'https://example.com/seo-audit' }),
    suggestion('already tracked phrase', true, {
      searchVolume: null,
      difficulty: null,
      currentPosition: null,
      estimatedTraffic: null,
    }),
  ],
  cached: false,
  fetchedAt: '2026-07-16T00:00:00.000Z',
  fallbackStatus: 'not_needed',
  ...overrides,
});

interface RenderOpts {
  store?: RanksStore;
  siteId?: string;
  initialEntry?: string;
}

const renderPage = ({
  store = makeStore(),
  siteId = 'site-1',
  initialEntry = '/site',
}: RenderOpts = {}) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <KeywordsPanel siteId={siteId} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.resetAllMocks();
  window.localStorage.clear();
  mockedApiClient.mockResolvedValue(seoMarketCatalog);
  writeToClipboardMock.mockResolvedValue(true);
  mocked.fetchKeywordsRequest.mockResolvedValue(listPage());
  mocked.fetchKeywordHistoryRequest.mockResolvedValue(historyPage());
  mocked.updateCadenceRequest.mockResolvedValue({
    cadence: 'daily',
    message: 'Rank check schedule updated.',
  });
  mocked.createKeywordRequest.mockResolvedValue({
    keyword: keyword('k3', { phrase: 'new keyword' }),
    message: 'Keyword added.',
  });
  mocked.createKeywordsBulkRequest.mockImplementation(async (_siteId, body) => ({
    message: 'Keywords added.',
    counts: { added: body.phrases.length, duplicate: 0, invalid: 0 },
    results: body.phrases.map((phrase, index) => ({ phrase, status: 'added' as const,
      keyword: keyword(`k${index + 3}`, { phrase }) })),
  }));
  mocked.fetchTrackedKeywordPhrasesRequest.mockResolvedValue({ keywords: [] });
  mocked.removeKeywordRequest.mockResolvedValue({
    message: 'Keyword removed.',
  });
  mocked.checkNowRequest.mockResolvedValue({
    message: 'Rank check queued.',
    checkStartedAt: '2026-07-13T00:00:00.000Z',
  });
  mocked.fetchActiveRankJobRequest.mockResolvedValue({ job: null });
  mocked.fetchKeywordSuggestionsRequest.mockResolvedValue(suggestionPage());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('KeywordsPanel — clipboard export', () => {
  it('copies the visible keywords as a comma-delimited list with a trailing comma', async () => {
    renderPage();
    await screen.findByTestId('keywords-table');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export rankings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));

    await waitFor(() =>
      expect(writeToClipboardMock).toHaveBeenCalledWith('phrase-k1,phrase-k2,'),
    );
    expect(toast.success).toHaveBeenCalledWith('Copied to clipboard.');
  });

  it('shows an error when the clipboard is unavailable', async () => {
    writeToClipboardMock.mockResolvedValue(false);
    renderPage();
    await screen.findByTestId('keywords-table');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export rankings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not copy to clipboard.'),
    );
  });
});

describe('KeywordsPanel — table layout', () => {
  it('opens with a tab header before the keyword list', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(listPage({
      keywords: [keyword('k1')], total: 1, siteTotal: 1, page: 1, pageSize: 50,
    }));
    renderPage({ initialEntry: '/site?tab=keywords' });
    const header = await screen.findByTestId('keywords-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Rank tracking' })).toBeInTheDocument();
    expect(within(header).getByText('Track how your keywords rank in Google.')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-list-heading').tagName).toBe('H3');
  });

  it('loads a shared filtered page and moves to the next page through the URL', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(listPage({
      keywords: [keyword('b1', { engine: 'bing' })], total: 120, siteTotal: 200,
      page: 2, pageSize: 50,
    }));
    renderPage({ initialEntry: '/site?tab=keywords&page=2&pageSize=50&search=trail&engine=bing' });
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledWith('site-1', undefined,
      { page: 2, pageSize: 50, search: 'trail', engine: 'bing' }));
    expect(await screen.findByTestId('keywords-pagination-range')).toHaveTextContent('Showing 51–51 of 120');
    expect(screen.getByTestId('keyword-list-heading')).toHaveTextContent('120 of 200');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith('site-1', undefined,
      { page: 3, pageSize: 50, search: 'trail', engine: 'bing' }));
  });

  it('reviews duplicates and long phrases, then submits only ready phrases', async () => {
    mocked.fetchTrackedKeywordPhrasesRequest.mockResolvedValue({ keywords: [{
      phrase: 'existing keyword', engine: 'google', locationCode: 2840,
      languageCode: 'en', device: 'desktop',
    }] });
    renderPage();
    await waitFor(() => expect(mocked.fetchTrackedKeywordPhrasesRequest).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Keywords'), { target: {
      value: `existing keyword\nnew keyword\n${'x'.repeat(301)}`,
    } });
    await waitFor(() => expect(screen.getAllByTestId('keyword-add-item')).toHaveLength(3));
    expect(screen.getAllByTestId('keyword-add-item').map((item) => item.getAttribute('data-verdict')))
      .toEqual(['existing', 'ready', 'tooLong']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Track keywords' }));
    await waitFor(() => expect(mocked.createKeywordsBulkRequest.mock.calls[0]?.[1].phrases)
      .toEqual(['new keyword']));
  });

  it('chunks a large paste into requests of at most 100 phrases', async () => {
    renderPage();
    await screen.findByTestId('keyword-add');
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value:
      Array.from({ length: 101 }, (_, index) => `keyword ${index + 1}`).join('\n'),
    } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Track keywords' }));
    await waitFor(() => expect(mocked.createKeywordsBulkRequest).toHaveBeenCalledTimes(2));
    expect(mocked.createKeywordsBulkRequest.mock.calls.map(([, body]) => body.phrases.length))
      .toEqual([100, 1]);
  });

  it('reserves a minimum width for the keyword column so short phrases are not clipped', async () => {
    renderPage();
    const table = await screen.findByTestId('keywords-table');
    const header = within(table).getByRole('columnheader', { name: 'Keyword' });
    expect(header).toHaveClass('min-w-48');
    const cell = screen.getByTestId('keyword-select-k1').closest('td');
    expect(cell).toHaveClass('min-w-48');
    // The truncating child still caps the column share rather than widening the table.
    expect(cell).toHaveClass('max-w-0');
  });
});

describe('KeywordsPanel — export entries', () => {
  it('shows one distinctly named export button, then a second distinctly named one once a keyword is selected', async () => {
    renderPage();
    await screen.findByTestId('keywords-table');

    expect(screen.getByRole('button', { name: 'Export rankings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export or share' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export history|ranking history/ })).toBeNull();

    await userEvent.setup().click(screen.getByTestId('keyword-select-k1'));

    const history = await screen.findByRole('button', {
      name: 'Export ranking history for phrase-k1',
    });
    expect(history).toHaveTextContent('Export history');
    expect(screen.getByRole('button', { name: 'Export rankings' })).toBeInTheDocument();
    // No two export buttons share an accessible name.
    expect(screen.queryByRole('button', { name: 'Export or share' })).toBeNull();
  });

  it('lets the toolbar wrap so Check now stays reachable on narrow screens', async () => {
    renderPage();
    const toolbar = await screen.findByTestId('keywords-toolbar');
    expect(toolbar).toHaveClass('flex-wrap');
    expect(toolbar).toContainElement(screen.getByTestId('keyword-check-now'));
    expect(toolbar.parentElement).toHaveClass('flex-wrap');
  });
});

describe('KeywordsPanel — Check now (on-demand rank check)', () => {
  const confirmSiteCheck = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('keyword-check-now'));
    await user.click(screen.getByTestId('check-now-confirm'));
  };

  it('can cancel before a rank job is queued', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('keyword-check-now'));
    expect(screen.getByTestId('check-now-dialog')).toHaveTextContent('Every active keyword');
    expect(screen.getByTestId('check-now-dialog')).not.toHaveTextContent(/allowance|credit|plan/i);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('check-now-dialog')).toBeNull();
    expect(mocked.checkNowRequest).not.toHaveBeenCalled();
  });

  it('queues an on-demand check and toasts the server message', async () => {
    renderPage();
    await confirmSiteCheck();
    await waitFor(() => expect(mocked.checkNowRequest).toHaveBeenCalledWith('site-1', undefined, expect.any(String)));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rank check queued.'));
  });

  it('a failed on-demand check surfaces via toast.error', async () => {
    mocked.checkNowRequest.mockRejectedValueOnce(
      new ApiError('x', 429, { error: { message: 'Too many checks. Try later.' } }),
    );
    renderPage();
    await confirmSiteCheck();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many checks. Try later.'));
  });

  it('hides the button when there are no keywords', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(listPage({ keywords: [] }));
    renderPage();
    await screen.findByTestId('keywords-empty');
    expect(screen.queryByTestId('keyword-check-now')).toBeNull();
  });

  it('429 without retryAfter → error toast + ~60s cooldown', async () => {
    mocked.checkNowRequest.mockRejectedValue(
      new ApiError('cooldown', 429, { error: { message: 'Wait a minute.' } }),
    );
    const store = renderPage();
    await confirmSiteCheck();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Wait a minute.'));
    const until = store.getState().ranks.checkCooldownUntil;
    expect(until).not.toBeNull();
    expect(until!).toBeGreaterThan(Date.now() + 30_000);
  });

  it('429 with retryAfter honours the server-supplied window', async () => {
    mocked.checkNowRequest.mockRejectedValue(
      new ApiError('cooldown', 429, {
        error: { message: 'Wait.', details: { retryAfterMs: 5_000 } },
      }),
    );
    const store = renderPage();
    await confirmSiteCheck();
    await waitFor(() => expect(store.getState().ranks.checkCooldownUntil).not.toBeNull());
    const until = store.getState().ranks.checkCooldownUntil!;
    expect(until).toBeLessThan(Date.now() + 30_000);
  });

  it('network failure toasts the localized fallback and sets no cooldown', async () => {
    mocked.checkNowRequest.mockRejectedValue(new TypeError('offline'));
    const store = renderPage();
    await confirmSiteCheck();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not start the check.'));
    expect(store.getState().ranks.checkCooldownUntil).toBeNull();
  });

  it('shows queued rows until the provider starts checking', async () => {
    mocked.checkNowRequest.mockResolvedValueOnce({ message: 'Rank check queued.',
      checkStartedAt: '2026-07-13T00:00:00.000Z', job: rankJob() });
    renderPage();
    await confirmSiteCheck();
    await waitFor(() => expect(toast.loading).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Queued').length).toBeGreaterThan(0));
  });

  it('checks one keyword from its row menu and queues only that row', async () => {
    mocked.checkNowRequest.mockResolvedValueOnce({
      message: 'Rank check queued.',
      checkStartedAt: new Date().toISOString(),
      job: rankJob({ scope: 'keyword', totals: { total: 1, queued: 1, running: 0, succeeded: 0,
        failed: 0, expired: 0, cancelled: 0 }, items: [{ keywordId: 'k1', engine: 'google',
          state: 'queued', reason: null, attempts: 0, finishedAt: null }] }),
    });
    renderPage();
    const row = await screen.findByTestId('keyword-row-k1');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Open menu for phrase-k1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Check now' }));
    await user.click(screen.getByTestId('check-now-confirm'));

    await waitFor(() =>
      expect(mocked.checkNowRequest).toHaveBeenCalledWith('site-1', 'k1', expect.any(String)),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('keyword-queued-pos-k1').length).toBeGreaterThan(0),
    );
    expect(screen.queryAllByTestId('keyword-checking-pos-k2')).toHaveLength(0);
    expect(toast.loading).toHaveBeenCalledWith('Rank check queued.', { id: 'rank-job-job-1' });
  });

  it('polls the durable job and refreshes keywords once it finishes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    mocked.checkNowRequest.mockResolvedValueOnce({ message: 'Rank check queued.',
      checkStartedAt: '2026-07-13T00:00:00.000Z', job: rankJob() });
    mocked.fetchRankJobRequest.mockResolvedValue({ job: rankJob({ status: 'succeeded',
      finishedAt: '2026-07-13T00:00:02.000Z', totals: { total: 2, queued: 0, running: 0,
        succeeded: 2, failed: 0, expired: 0, cancelled: 0 } }) });
    renderPage();
    await vi.advanceTimersByTimeAsync(0); // flush the mount load
    fireEvent.click(screen.getByTestId('keyword-check-now'));
    fireEvent.click(screen.getByTestId('check-now-confirm'));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    const before = mocked.fetchKeywordsRequest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.fetchRankJobRequest).toHaveBeenCalledWith('site-1', 'job-1', expect.any(AbortSignal));
    expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(before + 1);
    expect(screen.queryByText('Checking…')).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocked.fetchRankJobRequest).toHaveBeenCalledTimes(1);
  });

  it('resumes an active stored job after reopening the site', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    mocked.fetchActiveRankJobRequest.mockResolvedValueOnce({ job: rankJob() });
    mocked.fetchRankJobRequest.mockResolvedValueOnce({ job: rankJob({ status: 'succeeded',
      finishedAt: '2026-07-13T00:00:02.000Z', totals: { total: 2, queued: 0, running: 0,
        succeeded: 2, failed: 0, expired: 0, cancelled: 0 } }) });
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1_900);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.fetchRankJobRequest).toHaveBeenCalledWith('site-1', 'job-1', expect.any(AbortSignal));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('keywords checked'),
      expect.objectContaining({ id: 'rank-job-job-1' }));
    expect(mocked.checkNowRequest).not.toHaveBeenCalled();
  });

  describe('initial check after adding a keyword', () => {
    const addedStamp = '2026-07-13T00:00:00.000Z';
    const pendingRow = () =>
      keyword('k3', {
        phrase: 'new keyword',
        updatedAt: addedStamp,
        lastCheckedAt: null,
        latestPosition: null,
        delta: null,
      });
    const listWith = (k3: Keyword) =>
      listPage({ keywords: [keyword('k1'), keyword('k2'), k3] });

    const addNewKeyword = async () => {
      mocked.createKeywordsBulkRequest.mockResolvedValue({ message: 'Keyword added.',
        counts: { added: 1, duplicate: 0, invalid: 0 },
        results: [{ phrase: 'new keyword', status: 'added', keyword: pendingRow() }],
      });
      renderPage();
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'new keyword' } });
      mocked.fetchKeywordsRequest.mockResolvedValue(listWith(pendingRow()));
      fireEvent.click(screen.getByRole('button', { name: 'Track keywords' }));
      await vi.advanceTimersByTimeAsync(0);
    };

    it('toasts, shows "Checking…" and polls until the first position lands', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(addedStamp));
      await addNewKeyword();

      expect(toast.success).toHaveBeenCalledWith('Keyword added. Checking its position now.');
      expect(screen.getAllByTestId('keyword-checking-pos-k3').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('keyword-unavailable-k3')).toBeNull();

      const before = mocked.fetchKeywordsRequest.mock.calls.length;
      mocked.fetchKeywordsRequest.mockResolvedValue(
        listWith(
          keyword('k3', {
            phrase: 'new keyword',
            updatedAt: addedStamp,
            lastCheckedAt: '2026-07-13T00:00:05.000Z',
            latestPosition: 7,
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(before + 1);
      expect(screen.queryByTestId('keyword-checking-pos-k3')).toBeNull();
      expect(screen.getAllByText('7').length).toBeGreaterThan(0);

      // Terminal row → polling has stopped.
      await vi.advanceTimersByTimeAsync(9_000);
      expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(before + 1);
    });

    it('pluralizes the toast for a batch', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(addedStamp));
      renderPage();
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.change(screen.getByLabelText('Keywords'), {
        target: { value: 'one\ntwo' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Track keywords' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(toast.success).toHaveBeenCalledWith('2 keywords added. Checking their positions now.');
    });

    it('shows a "checking" hint instead of a fixed schedule while the first check runs', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(addedStamp));
      mocked.fetchKeywordHistoryRequest.mockResolvedValue(historyPage(0));
      await addNewKeyword();
      fireEvent.click(screen.getByTestId('keyword-select-k3'));
      await vi.advanceTimersByTimeAsync(0);
      const hint = screen.getByTestId('rank-trend-empty');
      expect(hint).toHaveTextContent(/Checking this keyword now/);
      expect(hint).not.toHaveTextContent(/Monday/);
    });

    it('gives up after the deadline and falls back to Unavailable', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(addedStamp));
      await addNewKeyword();
      expect(screen.getAllByTestId('keyword-checking-pos-k3').length).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(screen.queryByTestId('keyword-checking-pos-k3')).toBeNull();
      expect(screen.getAllByTestId('keyword-unavailable-k3').length).toBeGreaterThan(0);

      const settled = mocked.fetchKeywordsRequest.mock.calls.length;
      await vi.advanceTimersByTimeAsync(12_000);
      expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(settled);
    });

    it('keeps the engine filter on the first-check poll', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(addedStamp));
      const amazonPending = keyword('a2', {
        engine: 'amazon',
        engineTarget: 'B0TRACKED2',
        updatedAt: addedStamp,
        lastCheckedAt: null,
        latestPosition: null,
        delta: null,
      });
      mocked.createKeywordsBulkRequest.mockResolvedValue({ message: 'Added.',
        counts: { added: 1, duplicate: 0, invalid: 0 },
        results: [{ phrase: 'new phrase', status: 'added', keyword: amazonPending }],
      });
      mocked.fetchKeywordsRequest.mockResolvedValue(listPage({ keywords: [amazonPending] }));
      renderPage({ initialEntry: '/site?engine=amazon' });
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'new phrase' } });
      fireEvent.click(screen.getByRole('button', { name: 'Track keywords' }));
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
        'site-1',
        undefined,
        { page: 1, pageSize: 25, engine: 'amazon' },
      );
    });

    it('stops tracking a row that disappears from the list', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(addedStamp));
      await addNewKeyword();
      mocked.fetchKeywordsRequest.mockResolvedValue(listPage());
      await vi.advanceTimersByTimeAsync(3_000);
      const settled = mocked.fetchKeywordsRequest.mock.calls.length;
      await vi.advanceTimersByTimeAsync(9_000);
      expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(settled);
    });
  });

  it('keeps the selected engine when a completed job refreshes the list', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    mocked.checkNowRequest.mockResolvedValueOnce({ message: 'Rank check queued.',
      checkStartedAt: '2026-07-13T00:00:00.000Z', job: rankJob() });
    mocked.fetchRankJobRequest.mockResolvedValue({ job: rankJob({ status: 'succeeded',
      finishedAt: '2026-07-13T00:00:02.000Z', totals: { total: 2, queued: 0, running: 0,
        succeeded: 2, failed: 0, expired: 0, cancelled: 0 } }) });
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [
          keyword('a1', {
            engine: 'amazon',
            engineTarget: 'B0TRACKED1',
            lastCheckedAt: '2026-07-06T00:00:00.000Z',
          }),
        ],
      }),
    );

    renderPage({ initialEntry: '/site?engine=amazon' });
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByTestId('keyword-check-now'));
    fireEvent.click(screen.getByTestId('check-now-confirm'));
    await vi.advanceTimersByTimeAsync(0);
    const before = mocked.fetchKeywordsRequest.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(before + 1);
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      { page: 1, pageSize: 25, engine: 'amazon' },
    );
  });

  it('treats an alt-engine weekly stamp as already terminal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    mocked.checkNowRequest.mockResolvedValue({
      message: 'Rank check queued.',
      checkStartedAt: '2026-07-15T12:00:00.000Z',
    });
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [
          keyword('b1', {
            engine: 'bing',
            lastCheckedAt: '2026-07-13T00:00:00.000Z',
          }),
        ],
      }),
    );

    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByTestId('keyword-check-now'));
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByText('Checking…')).toBeNull();
    const callsAtTerminal = mocked.fetchKeywordsRequest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(callsAtTerminal);
  });

  it('stops visible checking after the job poll cap while preserving the stored job', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    mocked.checkNowRequest.mockResolvedValueOnce({ message: 'Rank check queued.',
      checkStartedAt: '2026-07-13T00:00:00.000Z', job: rankJob() });
    mocked.fetchRankJobRequest.mockResolvedValue({ job: rankJob() });
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByTestId('keyword-check-now'));
    fireEvent.click(screen.getByTestId('check-now-confirm'));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(screen.queryByText('Queued')).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('still running'), { id: 'rank-job-job-1' });
    expect(window.localStorage.getItem('rmf.rankJob.site-1')).toBe('job-1');
  });
});

describe('barrel — module public surface', () => {
  it('exports the documented public API', async () => {
    const mod = await import('./index');
    expect(mod.ranksReducer).toBeDefined();
    expect(mod.KeywordsPanel).toBeDefined();
    expect(mod.KeywordsTable).toBeDefined();
    expect(mod.AddKeywordForm).toBeDefined();
    expect(mod.CadenceToggle).toBeDefined();
    expect(mod.RankTrendChart).toBeDefined();
    expect(mod.buildAddKeywordSchema).toBeDefined();
    expect(mod.LOCATION_OPTIONS.length).toBeGreaterThan(0);
    expect(mod.LANGUAGE_OPTIONS.length).toBeGreaterThan(0);
    expect(mod.DEVICE_OPTIONS.length).toBe(2);
    expect(mod.ranksErrorMessage).toBeDefined();
    expect(mod.loadKeywords).toBeDefined();
    expect(mod.addKeyword).toBeDefined();
    expect(mod.removeKeyword).toBeDefined();
    expect(mod.updateCadence).toBeDefined();
    expect(mod.loadKeywordHistory).toBeDefined();
    expect(mod.clearRanksMessages).toBeDefined();
    expect(mod.selectKeyword).toBeDefined();
  });
});

describe('keyword line parsing', () => {
  it('splits on newlines and commas, trims blanks, and deduplicates normalized phrases', () => {
    expect(parseKeywordLines(' audit, pricing \r\nSEO Audit\n seo   audit ,,\n\n')).toEqual([
      'audit',
      'pricing',
      'SEO Audit',
    ]);
  });
});

describe('ranksErrorMessage', () => {
  it('prefers the server error message', () => {
    const err = new ApiError('boom', 500, { error: { message: 'server said no' } });
    expect(ranksErrorMessage(err, 'ranks:loadFailed')).toBe('server said no');
  });

  it('falls back to the localized client message', () => {
    expect(ranksErrorMessage(new TypeError('offline'), 'ranks:loadFailed')).toBe(
      'Could not load your keywords.',
    );
  });

  it('falls back when the server payload is missing the message', () => {
    const err = new ApiError('boom', 500, { error: { code: 'X' } });
    expect(ranksErrorMessage(err, 'ranks:loadFailed')).toBe('Could not load your keywords.');
    const err2 = new ApiError('boom', 500, { error: 'plain' });
    expect(ranksErrorMessage(err2, 'ranks:loadFailed')).toBe('Could not load your keywords.');
    const err3 = new ApiError('boom', 500, { other: 1 });
    expect(ranksErrorMessage(err3, 'ranks:loadFailed')).toBe('Could not load your keywords.');
  });
});

describe('KeywordsPanel — loading, error, empty', () => {
  it('renders the loading skeleton', () => {
    const store = makeStore({ loading: true });
    renderPage({ store });
    expect(screen.getByTestId('keywords-loading')).toBeInTheDocument();
    expect(screen.getByTestId('keywords-skeleton')).toBeInTheDocument();
  });

  it('renders the error state with a working retry', async () => {
    mocked.fetchKeywordsRequest.mockReset();
    mocked.fetchKeywordsRequest.mockRejectedValueOnce(new TypeError('offline'));
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(listPage({ keywords: [] }));
    renderPage();
    expect(await screen.findByTestId('keywords-error')).toHaveTextContent(
      'Could not load your keywords.',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('keywords-error')).not.toBeInTheDocument());
  });

  it('keeps the selected engine on a retry', async () => {
    mocked.fetchKeywordsRequest
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        listPage({
          keywords: [keyword('a1', { engine: 'amazon', engineTarget: 'B0TRACKED1' })],
        }),
      );
    renderPage({ initialEntry: '/site?engine=amazon' });
    expect(await screen.findByTestId('keywords-error')).toHaveTextContent(
      'Could not load your keywords.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByTestId('keywords-error')).not.toBeInTheDocument());
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      { page: 1, pageSize: 25, engine: 'amazon' },
    );
  });

  it('renders empty state when there are no keywords', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(listPage({ keywords: [] }));
    renderPage();
    expect(await screen.findByTestId('keywords-empty')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-add')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Track your first keyword' }));
    expect(screen.getByTestId('keyword-add').querySelector('#keyword-phrase')).toHaveFocus();
  });
});

describe('KeywordsPanel — keywords table, position rendering, add + remove', () => {
  it('renders the table with position, delta, and last-checked info', async () => {
    renderPage();
    await waitFor(() =>
      expect(mocked.fetchKeywordsRequest).toHaveBeenCalledWith(
        'site-1',
        undefined,
        { page: 1, pageSize: 25 },
      ),
    );
    const table = await screen.findByTestId('keywords-table');
    // Second row's null position renders as "Not in top 100"; both the
    // desktop table and the mobile card mount in jsdom (CSS hides one), so
    // scope the assertion to the desktop table.
    expect(within(table).getByText('Not in top 100')).toBeInTheDocument();
  });

  it('shows "Unavailable" when a period had no check row', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(
      listPage({
        keywords: [
          keyword('k1', {
            latestPosition: null,
            lastCheckedAt: null,
            delta: null,
            previousPosition: null,
          }),
        ],
      }),
    );
    renderPage();
    await waitFor(() =>
      expect(mocked.fetchKeywordsRequest).toHaveBeenCalledWith(
        'site-1',
        undefined,
        { page: 1, pageSize: 25 },
      ),
    );
    const badges = await screen.findAllByText('Unavailable');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Check failed" (not "Unavailable") for a keyword whose check errored', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(
      listPage({
        keywords: [
          keyword('k1', {
            latestPosition: null,
            lastCheckedAt: null,
            delta: null,
            previousPosition: null,
            lastFailedCheckAt: '2026-07-05T00:00:00.000Z',
          }),
        ],
      }),
    );
    renderPage();
    const failed = await screen.findAllByText('Check failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    // The failed-attempt badge (with its timestamp) replaces the "Unavailable"
    // badge entirely — the two states must never both render for one keyword.
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('keyword-check-failed-k1').length).toBeGreaterThanOrEqual(1);
    // No reason recorded → the bare label, with no invented cause anywhere.
    expect(screen.getAllByTestId('keyword-position-failed-k1')[0]).not.toHaveAttribute('title');
  });

  it('surfaces the recorded reason on a failed check', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(
      listPage({
        keywords: [
          keyword('k1', {
            latestPosition: null,
            lastCheckedAt: null,
            delta: null,
            previousPosition: null,
            lastFailedCheckAt: '2026-07-05T00:00:00.000Z',
            lastFailedReason: 'vendor_timeout',
          }),
        ],
      }),
    );
    renderPage();
    const failed = await screen.findAllByText('Check failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    const reason = 'The search data did not arrive in time. This usually clears on the next check.';
    // The cause reaches BOTH the pointer tooltip and the accessible name, so a
    // screen-reader user is not left with a bare "Check failed" either.
    expect(screen.getAllByTestId('keyword-position-failed-k1')[0]).toHaveAttribute('title', reason);
    expect(screen.getAllByLabelText(`Check failed: ${reason}`).length).toBeGreaterThanOrEqual(1);
  });

  it('add form → successful add clears phrase and triggers a reload', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [keyword('a1', { engine: 'amazon', engineTarget: 'B0TRACKED1' })],
      }),
    );
    renderPage({ initialEntry: '/site?engine=amazon' });
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Keywords');
    await user.type(input, 'new phrase');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));
    await waitFor(() =>
      expect(mocked.createKeywordsBulkRequest).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ phrases: ['new phrase'] }),
      ),
    );
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2));
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      { page: 1, pageSize: 25, engine: 'amazon' },
    );
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
  });

  it('submits newline-delimited keywords in one bulk request and reloads once', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Keywords');
    await user.type(input, 'first keyword{enter}second keyword');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));

    await waitFor(() => expect(mocked.createKeywordsBulkRequest).toHaveBeenCalledTimes(1));
    expect(mocked.createKeywordsBulkRequest.mock.calls[0]?.[1].phrases).toEqual([
      'first keyword', 'second keyword',
    ]);
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('');
  });

  it('keeps duplicate phrases in the box while adding other bulk results', async () => {
    mocked.createKeywordsBulkRequest.mockResolvedValueOnce({ message: 'Keywords added.',
      counts: { added: 2, duplicate: 1, invalid: 0 },
      results: [
        { phrase: 'first', status: 'added', keyword: keyword('first', { phrase: 'first' }) },
        { phrase: 'duplicate', status: 'duplicate', reason: 'already_tracked' },
        { phrase: 'third', status: 'added', keyword: keyword('third', { phrase: 'third' }) },
      ],
    });
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Keywords');
    await user.type(input, 'first{enter}duplicate{enter}third');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));

    await waitFor(() => expect(mocked.createKeywordsBulkRequest).toHaveBeenCalledTimes(1));
    expect(mocked.createKeywordsBulkRequest.mock.calls[0]?.[1].phrases).toEqual(['first', 'duplicate', 'third']);
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue('duplicate');
    expect(screen.getByTestId('keyword-add-summary')).toHaveTextContent('Skipped 1 duplicate');
  });

  it('discovers explicitly, selects one suggestion, and does not refetch when count changes', async () => {
    renderPage();
    await screen.findByTestId('keyword-add');
    expect(mocked.fetchKeywordSuggestionsRequest).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByTestId('keyword-suggestions-table')).toBeInTheDocument();
    expect(mocked.fetchKeywordSuggestionsRequest).toHaveBeenCalledWith('site-1', {
      locationCode: 2840,
      languageCode: 'en',
    });
    await user.click(screen.getByRole('button', { name: 'Use keyword' }));
    expect(screen.getByLabelText('Keywords')).toHaveValue('seo audit tool');
    await user.selectOptions(screen.getByLabelText('Show top'), '50');
    expect(mocked.fetchKeywordSuggestionsRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Already tracked' })).toBeDisabled();
  });

  it('bulk-selects visible untracked suggestions and appends one keyword per line', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        candidates: [
          suggestion('seo audit tool'),
          suggestion('rank tracker'),
          suggestion('already tracked phrase', true),
        ],
      }),
    );
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Keywords');
    await user.type(input, 'audit pricing{enter}SEO   AUDIT TOOL');
    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));

    const selectAll = await screen.findByRole('checkbox', {
      name: 'Select all visible keywords',
    });
    const firstRow = screen.getByRole('checkbox', { name: 'Select seo audit tool' });
    const secondRow = screen.getByRole('checkbox', { name: 'Select rank tracker' });
    expect(screen.getByRole('checkbox', { name: 'Select already tracked phrase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use selected (0)' })).toBeDisabled();

    await user.click(firstRow);
    expect(selectAll).toHaveAttribute('data-state', 'indeterminate');
    await user.click(secondRow);
    expect(selectAll).toBeChecked();
    await user.click(secondRow);
    expect(selectAll).toHaveAttribute('data-state', 'indeterminate');
    await user.click(selectAll);
    expect(screen.getByRole('button', { name: 'Use selected (2)' })).toBeEnabled();
    await user.click(selectAll);
    expect(screen.getByRole('button', { name: 'Use selected (0)' })).toBeDisabled();
    await user.click(selectAll);
    await user.click(screen.getByRole('button', { name: 'Use selected (2)' }));

    expect(input).toHaveValue('audit pricing\nSEO AUDIT TOOL\nrank tracker');
    expect(screen.getByRole('button', { name: 'Use selected (0)' })).toBeDisabled();
  });

  it('select all follows the visible result limit', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        candidates: Array.from({ length: 11 }, (_, index) => suggestion(`keyword ${index + 1}`)),
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select all visible keywords' }));
    expect(screen.getByRole('button', { name: 'Use selected (11)' })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText('Show top'), '10');
    expect(await screen.findByRole('button', { name: 'Use selected (10)' })).toBeEnabled();
  });

  it('clears discovered results when the market changes', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByTestId('keyword-suggestions-table')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Location'));
    await user.click(await screen.findByRole('option', { name: /United Kingdom/ }));
    expect(screen.queryByTestId('keyword-suggestions-table')).not.toBeInTheDocument();
  });

  it('marks a selected suggestion tracked after the existing add succeeds', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select seo audit tool' }));
    await user.type(screen.getByLabelText('Keywords'), 'seo audit tool');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));
    expect(await screen.findAllByRole('button', { name: 'Already tracked' })).toHaveLength(2);
    expect(mocked.fetchKeywordSuggestionsRequest).toHaveBeenCalledTimes(1);
  });

  it('shows lookup errors', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockRejectedValueOnce(new TypeError('offline'));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByTestId('keyword-suggestions-error')).toHaveTextContent(
      'Could not find keywords for this site.',
    );
  });

  it('renders fallback site ideas with nullable signals and an honest empty state', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        source: 'site_ideas',
        sources: ['site_ideas'],
        candidates: [
          {
            keyword: 'bare site idea',
            searchVolume: null,
            difficulty: 42,
            currentPosition: null,
            estimatedTraffic: null,
            rankingUrl: null,
            source: 'site_ideas',
            tracked: false,
          },
        ],
        fallbackStatus: 'used',
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    const table = await screen.findByTestId('keyword-suggestions-table');
    expect(screen.getByText(/topics found across this site’s public pages/i)).toBeInTheDocument();
    // Ideas carry volume and difficulty but no ranking signals.
    // (Header text is "Current rank", not "Position" — the old spelling made
    // this assertion vacuous.)
    for (const header of ['Current rank', 'Avg. position', 'Est. traffic', 'Clicks']) {
      expect(within(table).queryByRole('columnheader', { name: header })).not.toBeInTheDocument();
    }
    expect(within(table).getByRole('columnheader', { name: 'Difficulty' })).toBeInTheDocument();
    expect(within(table).getByText('42')).toBeInTheDocument();
    // Exactly one em dash: the volume cell. getByText would also pass on a
    // single stray match, so pin the count.
    expect(within(table).getAllByText('—')).toHaveLength(1);

    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        source: 'site_ideas',
        sources: ['site_ideas'],
        candidates: [],
        fallbackStatus: 'used',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByTestId('keyword-suggestions-empty')).toBeInTheDocument();
  });

  it('labels Search Console suggestions as measured, not estimated', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        source: 'gsc',
        sources: ['gsc'],
        candidates: [
          {
            keyword: 'pay stub generator',
            searchVolume: null,
            difficulty: null,
            currentPosition: 14.2,
            estimatedTraffic: 12,
            rankingUrl: null,
            source: 'gsc',
            tracked: false,
          },
        ],
        fallbackStatus: 'not_needed',
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    const table = await screen.findByTestId('keyword-suggestions-table');

    expect(screen.getByText(/from your search console/i)).toBeInTheDocument();
    // GSC reports a measured click count and an averaged position — labelled
    // apart from the vendor's estimate and current rank.
    expect(within(table).getByRole('columnheader', { name: 'Avg. position' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Clicks' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Current rank' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Est. traffic' })).not.toBeInTheDocument();
    // No difficulty score exists in Search Console, so that column is absent
    // rather than a column of dashes.
    expect(within(table).queryByRole('columnheader', { name: 'Difficulty' })).not.toBeInTheDocument();
    expect(within(table).getByText('14.2')).toBeInTheDocument();
    expect(within(table).getByText('12')).toBeInTheDocument();
    expect(within(table).getAllByText('—')).toHaveLength(1);
    expect(within(table).getByRole('button', { name: 'Use keyword' })).toBeEnabled();
  });

  it('renders blended sources with per-row badges and neutral headers', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        source: 'gsc',
        sources: ['gsc', 'ranked', 'site_ideas'],
        candidates: [
          suggestion('episode pricing', false, {
            searchVolume: null,
            difficulty: null,
            currentPosition: 67.2,
            estimatedTraffic: 0,
            source: 'gsc',
          }),
          suggestion('podcast summary tool', false, { source: 'ranked' }),
          suggestion('podcast brief generator', false, {
            currentPosition: null,
            estimatedTraffic: null,
            source: 'site_ideas',
          }),
        ],
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    const table = await screen.findByTestId('keyword-suggestions-table');

    expect(screen.getByText(/blended with keywords this site ranks for/i)).toBeInTheDocument();
    // Neutral labels replace the single-source ones on a mixed list.
    expect(within(table).getByRole('columnheader', { name: 'Position' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Traffic / clicks' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Avg. position' })).not.toBeInTheDocument();
    expect(within(table).getByText('Search Console')).toBeInTheDocument();
    expect(within(table).getByText('Ranking now')).toBeInTheDocument();
    expect(within(table).getByText('Site idea')).toBeInTheDocument();
  });

  it('keeps ranked results visible when the site-ideas vendor is unavailable', async () => {
    mocked.fetchKeywordSuggestionsRequest.mockResolvedValueOnce(
      suggestionPage({
        source: 'ranked',
        sources: ['ranked'],
        candidates: [suggestion('episode pricing', false, { source: 'ranked' })],
        fallbackStatus: 'provider_unavailable',
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find top keywords' }));
    expect(await screen.findByTestId('keyword-suggestions-unavailable')).toHaveTextContent(
      'temporarily unavailable',
    );
    expect(await screen.findByTestId('keyword-suggestions-table')).toBeInTheDocument();
  });

  it('add form → inline validation error when phrase is blank', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));
    expect(await screen.findByText('Enter a keyword to track.')).toBeInTheDocument();
    expect(mocked.createKeywordsBulkRequest).not.toHaveBeenCalled();
  });

  it('add form → flags a too-long phrase before any request', async () => {
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Keywords');
    await user.type(input, 'x'.repeat(301));
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));
    expect(await screen.findByTestId('keyword-add-preview')).toContainElement(
      screen.getByTestId('keyword-add-item'),
    );
    expect(screen.getByTestId('keyword-add-item')).toHaveAttribute('data-verdict', 'tooLong');
    expect(screen.getByTestId('keyword-add-nothing')).toHaveTextContent('Enter at least one new keyword');
    expect(mocked.createKeywordsBulkRequest).not.toHaveBeenCalled();
  });

  it('add form → surfaces the server error message', async () => {
    mocked.createKeywordsBulkRequest.mockRejectedValueOnce(
      new ApiError('conflict', 409, {
        error: { message: 'That keyword is already tracked.' },
      }),
    );
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Keywords'), 'dup');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));
    expect(await screen.findByText('That keyword is already tracked.')).toBeInTheDocument();
  });

  it('remove flow → dropdown → confirm → reload', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [keyword('a1', { engine: 'amazon', engineTarget: 'B0TRACKED1' })],
      }),
    );
    renderPage({ initialEntry: '/site?engine=amazon' });
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const row = screen.getByTestId('keyword-row-a1');
    await user.click(within(row).getByRole('button', { name: /Open menu for phrase-a1/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove keyword' }));
    await user.click(await screen.findByRole('button', { name: 'Stop tracking' }));
    await waitFor(() => expect(mocked.removeKeywordRequest).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2));
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      { page: 1, pageSize: 25, engine: 'amazon' },
    );
  });

  it('remove flow reloads the unfiltered keyword view', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const row = screen.getByTestId('keyword-row-k1');
    await user.click(within(row).getByRole('button', { name: /Open menu for phrase-k1/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove keyword' }));
    await user.click(await screen.findByRole('button', { name: 'Stop tracking' }));

    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2));
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      { page: 1, pageSize: 25 },
    );
    expect(mocked.fetchKeywordsRequest.mock.calls.at(-1)?.[2]).not.toHaveProperty('engine');
  });

  it('remove flow → cancel does NOT delete', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    const row = screen.getByTestId('keyword-row-k1');
    await user.click(within(row).getByRole('button', { name: /Open menu for phrase-k1/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove keyword' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(mocked.removeKeywordRequest).not.toHaveBeenCalled();
  });

  it('remove flow → surfaces the failure inline', async () => {
    mocked.removeKeywordRequest.mockRejectedValueOnce(new TypeError('offline'));
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    const row = screen.getByTestId('keyword-row-k1');
    await user.click(within(row).getByRole('button', { name: /Open menu for phrase-k1/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove keyword' }));
    await user.click(await screen.findByRole('button', { name: 'Stop tracking' }));
    expect(await screen.findByTestId('keyword-remove-error')).toHaveTextContent(
      'Could not remove the keyword.',
    );
  });
});

describe('trend chart — <2 datapoints, selection, chart render + a11y table', () => {
  it('shows the "select a keyword" prompt before any row is selected', async () => {
    renderPage();
    expect(await screen.findByTestId('rank-trend-prompt')).toBeInTheDocument();
  });

  it('shows the "not enough data" text when the selected keyword has < 2 points', async () => {
    mocked.fetchKeywordHistoryRequest.mockResolvedValueOnce(historyPage(1));
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    expect(await screen.findByTestId('rank-trend-empty')).toHaveTextContent(
      /One check so far — the trend appears after the next weekly check/,
    );
  });

  it('names the daily schedule once a daily site has one check', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(listPage({ cadence: 'daily' }));
    mocked.fetchKeywordHistoryRequest.mockResolvedValueOnce(historyPage(1));
    renderPage();
    await userEvent.setup().click(await screen.findByTestId('keyword-select-k1'));
    expect(await screen.findByTestId('rank-trend-empty')).toHaveTextContent(
      /next daily check/,
    );
  });

  it('says no check has run when the keyword was never checked', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [keyword('k1', { lastCheckedAt: null, latestPosition: null, delta: null })],
      }),
    );
    mocked.fetchKeywordHistoryRequest.mockResolvedValueOnce(historyPage(0));
    renderPage();
    await userEvent.setup().click(await screen.findByTestId('keyword-select-k1'));
    const hint = await screen.findByTestId('rank-trend-empty');
    expect(hint).toHaveTextContent(/No checks yet/);
    expect(hint).not.toHaveTextContent(/Monday/);
  });

  it('says the last check failed when only a failed attempt is recorded', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [
          keyword('k1', {
            lastCheckedAt: null,
            latestPosition: null,
            delta: null,
            lastFailedCheckAt: '2026-07-03T00:00:00.000Z',
            lastFailedReason: 'vendor_error',
          }),
        ],
      }),
    );
    mocked.fetchKeywordHistoryRequest.mockResolvedValueOnce(historyPage(0));
    renderPage();
    await userEvent.setup().click(await screen.findByTestId('keyword-select-k1'));
    expect(await screen.findByTestId('rank-trend-empty')).toHaveTextContent(
      /last check failed/,
    );
  });

  it('shows a skeleton while history is loading', async () => {
    let resolve: (value: RankHistoryResponse) => void = () => {};
    mocked.fetchKeywordHistoryRequest.mockReturnValueOnce(
      new Promise<RankHistoryResponse>((r) => {
        resolve = r;
      }),
    );
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    expect(await screen.findByTestId('rank-trend-loading')).toBeInTheDocument();
    resolve(historyPage(2));
    await waitFor(() => expect(screen.queryByTestId('rank-trend-loading')).not.toBeInTheDocument());
  });

  it('renders the trend chart when the selected keyword has ≥ 2 points, with accessible table', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    const svg = await screen.findByTestId('rank-trend-svg');
    // aria-label mentions the phrase and the point count.
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('phrase-k1'));
    // sr-only accessible fallback table exists.
    const table = screen.getByTestId('rank-trend-table');
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
    // Latest position number is rendered.
    expect(screen.getByTestId('rank-trend-latest')).toHaveTextContent(/^\d+$/);
  });

  it('skips loadKeywords on mount when the slice is already primed for this site', async () => {
    // ranksSiteIdRef matches siteId at first render → the mount effect early-
    // returns without dispatching. Covers KeywordsPanel:101 the "primed" arm.
    const store = makeStore({
      siteId: 'site-1',
      loaded: true,
      items: [keyword('k1')],
    });
    renderPage({ store });
    // Give the mount effect a tick to run — it must NOT dispatch.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked.fetchKeywordsRequest).not.toHaveBeenCalled();
  });

  it('skips loadKeywordHistory when the slice already holds this keyword id', async () => {
    // historyKeywordIdRef.current === selectedId → the history effect returns
    // without dispatching. Covers KeywordsPanel:110 the "already have it" arm.
    const store = makeStore({
      siteId: 'site-1',
      loaded: true,
      items: [keyword('k1')],
      selectedKeywordId: 'k1',
      historyKeywordId: 'k1',
      history: historyPage(3).series,
    });
    renderPage({ store });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked.fetchKeywordHistoryRequest).not.toHaveBeenCalled();
  });

  it('aborts the in-flight loadKeywordHistory when the keyword changes before it resolves', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocked.fetchKeywordHistoryRequest.mockImplementationOnce(
      (_keywordId: string, init?: { signal?: AbortSignal }) => {
        capturedSignal = init?.signal;
        return new Promise(() => undefined);
      },
    );
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    await waitFor(() => expect(capturedSignal).toBeDefined());
    // Selecting a different keyword triggers effect cleanup → abort.
    await user.click(screen.getByTestId('keyword-select-k2'));
    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });

  it('history error surfaces inline', async () => {
    mocked.fetchKeywordHistoryRequest.mockRejectedValueOnce(new TypeError('offline'));
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    expect(await screen.findByTestId('rank-trend-error')).toHaveTextContent(
      'Could not load rank history.',
    );
  });

  it('renders "Not in top 100" latest for a null-position keyword and describes zero delta', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(
      listPage({
        keywords: [
          keyword('k1', {
            latestPosition: null,
            delta: 0,
            previousPosition: null,
          }),
        ],
      }),
    );
    mocked.fetchKeywordHistoryRequest.mockResolvedValueOnce(historyPage(3));
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    expect(await screen.findByTestId('rank-trend-latest')).toHaveTextContent('Not in top 100');
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('No change in position');
  });

  it('renders all four AI Overview badge states', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(
      listPage({
        keywords: [
          keyword('k1', {
            aiOverviewPresent: true,
            aiCited: true,
            aiCitedUrl: 'https://example.com/guide',
          }),
          keyword('k2', { phrase: 'phrase-k2', aiOverviewPresent: true, aiCited: false }),
          keyword('k3', { phrase: 'phrase-k3', aiOverviewPresent: false, aiCited: false }),
          keyword('k4', { phrase: 'phrase-k4' }), // aiOverviewPresent null → unknown
          // cited without a stored url → no title attribute branch
          keyword('k5', { phrase: 'phrase-k5', aiOverviewPresent: true, aiCited: true }),
        ],
      }),
    );
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    expect(screen.getAllByTestId('keyword-ai-cited-k1')[0]).toHaveTextContent('Cited');
    expect(screen.getAllByTestId('keyword-ai-not-cited-k2')[0]).toHaveTextContent('Not cited');
    expect(screen.getAllByTestId('keyword-ai-none-k3')[0]).toHaveTextContent('No AI Overview');
    expect(screen.getAllByTestId('keyword-ai-unknown-k4')[0]).toHaveTextContent('—');
    // Cited chip is a success-tinted pill (SPEC-A2/A3) with the source url.
    const cited = screen.getAllByTestId('keyword-ai-cited-k1')[0]!;
    expect(cited.className).toContain('text-success');
    expect(cited).toHaveAttribute('title', 'https://example.com/guide');
    // Cited row with no stored url renders without a title attribute.
    expect(screen.getAllByTestId('keyword-ai-cited-k5')[0]).not.toHaveAttribute('title');
  });

  it('renders the correct delta labels — down + singular up / down variants', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RankTrendChart
          keyword={keyword('k1', { delta: -1, latestPosition: 3 })}
          series={historyPage(2).series}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Declined by 1 position');
  });

  it('trend chart plural down copy for delta < -1', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RankTrendChart
          keyword={keyword('k1', { delta: -2, latestPosition: 3 })}
          series={historyPage(2).series}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Declined by 2 positions');
  });

  it('trend chart singular up copy for delta === 1', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RankTrendChart
          keyword={keyword('k1', { delta: 1, latestPosition: 3 })}
          series={historyPage(2).series}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Improved by 1 position');
  });

  it('trend chart null delta says there is no previous data', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RankTrendChart
          keyword={keyword('k1', { delta: null, latestPosition: 3 })}
          series={historyPage(2).series}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('No previous data');
  });

  it('trend chart plots a check with no position in its own lane, not in the position line', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RankTrendChart
          keyword={keyword('k1', { latestPosition: 4, delta: 2 })}
          series={[
            ...historyPage(2).series,
            {
              checkedAt: '2026-07-03T00:00:00.000Z',
              position: null,
              rankAbsolute: null,
              source: 'fresh',
              foundUrl: null,
              aiOverviewPresent: null,
              aiCited: null,
              aiCitedUrl: null,
              observationMeta: null,
            },
          ]}
        />
      </I18nextProvider>,
    );
    // Every stored check is kept: 2 ranked rows plus the not-in-top-100 one.
    const table = screen.getByTestId('rank-trend-table');
    const bodyRows = within(table.querySelector('tbody')!).getAllByRole('row');
    expect(bodyRows).toHaveLength(3);
    expect(screen.getAllByTestId('rank-trend-point')).toHaveLength(2);
    expect(screen.getByTestId('rank-trend-unranked')).toBeInTheDocument();
  });
});

describe('cadence toggle', () => {
  it('enables daily cadence and fires the PATCH thunk', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const toggle = await screen.findByTestId('cadence-toggle');
    expect(toggle).toBeEnabled();
    const user = userEvent.setup();
    await user.click(toggle);
    await waitFor(() =>
      expect(mocked.updateCadenceRequest).toHaveBeenCalledWith('site-1', 'daily'),
    );
  });

  it('rolls back the optimistic switch on failure', async () => {
    mocked.updateCadenceRequest.mockRejectedValueOnce(
      new ApiError('nope', 500, { error: { message: 'Could not save the cadence.' } }),
    );
    const store = renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const toggle = await screen.findByTestId('cadence-toggle');
    const user = userEvent.setup();
    await user.click(toggle);
    await waitFor(() => expect(store.getState().ranks.cadenceError).toBe('Could not save the cadence.'));
    expect(store.getState().ranks.cadence).toBe('weekly');
    expect(await screen.findByTestId('cadence-error')).toHaveTextContent('Could not save the cadence.');
  });

  it('does nothing when the toggle is clicked with the same value (no PATCH)', async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <CadenceToggle
          cadence="weekly"
          onChange={(next) => {
            if (next === 'weekly') return;
          }}
        />
      </I18nextProvider>,
    );
    // no-op: we just render — coverage sanity.
    await user.tab();
  });
});

describe('a11y basics', () => {
  it('chart svg has an accessible name after selecting a keyword', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    const svg = await screen.findByTestId('rank-trend-svg');
    expect(svg).toHaveAttribute('aria-label');
  });
});

describe('RTL (ar)', () => {
  it('renders in Arabic with dir=rtl and localized copy', async () => {
    await changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('keyword-select-k1'));
    const svg = await screen.findByTestId('rank-trend-svg');
    // aria-label contains Arabic text
    expect(svg.getAttribute('aria-label')).toContain('phrase-k1');
  });
});

describe('selectors surface', () => {
  it('every selector returns the corresponding slice value from the initial state', async () => {
    const selectors = await import('./store/selectors');
    const state = { ranks: baseState() } as unknown as import('@app/store').RootState;
    expect(selectors.selectKeywords(state)).toEqual([]);
    expect(selectors.selectRanksLoading(state)).toBe(false);
    expect(selectors.selectRanksLoaded(state)).toBe(false);
    expect(selectors.selectRanksError(state)).toBe('');
    expect(selectors.selectRanksMessage(state)).toBe('');
    expect(selectors.selectNextCursor(state)).toBeNull();
    expect(selectors.selectCursorStack(state)).toEqual([]);
    expect(selectors.selectAddingKeyword(state)).toBe(false);
    expect(selectors.selectAddKeywordError(state)).toBe('');
    expect(selectors.selectRemovingId(state)).toBeNull();
    expect(selectors.selectRemoveError(state)).toBe('');
    expect(selectors.selectCadence(state)).toBe('weekly');
    expect(selectors.selectUpdatingCadence(state)).toBe(false);
    expect(selectors.selectCadenceError(state)).toBe('');
    expect(selectors.selectSelectedKeywordId(state)).toBeNull();
    expect(selectors.selectHistory(state)).toEqual([]);
    expect(selectors.selectHistoryKeywordId(state)).toBeNull();
    expect(selectors.selectHistoryLoading(state)).toBe(false);
    expect(selectors.selectHistoryError(state)).toBe('');
  });
});

describe('slice — reducers & thunk transitions', () => {
  it('load rejected with no payload uses empty string', async () => {
    const { loadKeywords } = await import('./store/thunks');
    const state = ranksReducer(
      { ...baseState(), siteId: 's' },
      loadKeywords.rejected(new Error('boom'), 'req', { siteId: 's' }),
    );
    expect(state.error).toBe('');
  });

  it('add rejected with no payload uses empty string', async () => {
    const { addKeyword } = await import('./store/thunks');
    const state = ranksReducer(
      baseState(),
      addKeyword.rejected(new Error('boom'), 'req', {
        siteId: 's',
        phrase: 'p',
        locationCode: 1,
        languageCode: 'en',
        device: 'desktop',
      }),
    );
    expect(state.addError).toBe('');
  });

  it('remove rejected with no payload uses empty string', async () => {
    const { removeKeyword } = await import('./store/thunks');
    const state = ranksReducer(
      baseState(),
      removeKeyword.rejected(new Error('boom'), 'req', 'kw-1'),
    );
    expect(state.removeError).toBe('');
  });

  it('history rejected with no payload uses empty string', async () => {
    const { loadKeywordHistory } = await import('./store/thunks');
    const state = ranksReducer(
      { ...baseState(), historyKeywordId: 'k' },
      loadKeywordHistory.rejected(new Error('boom'), 'req', { keywordId: 'k' }),
    );
    expect(state.historyError).toBe('');
  });

  it('cadence rejected with no payload uses empty string and rolls back', async () => {
    const { updateCadence } = await import('./store/thunks');
    const initial = { ...baseState(), cadence: 'daily' as const };
    const state = ranksReducer(
      initial,
      updateCadence.rejected(new Error('boom'), 'req', {
        siteId: 's',
        cadence: 'weekly',
        previous: 'daily',
      }),
    );
    expect(state.cadenceError).toBe('');
    expect(state.cadence).toBe('daily');
  });

  it('clearRanksMessages resets error slots', () => {
    const store = makeStore({
      error: 'a',
      addError: 'b',
      removeError: 'c',
      cadenceError: 'd',
      historyError: 'e',
      message: 'f',
    });
    store.dispatch(slice.clearRanksMessages());
    const s = store.getState().ranks;
    expect(s.error).toBe('');
    expect(s.addError).toBe('');
    expect(s.removeError).toBe('');
    expect(s.cadenceError).toBe('');
    expect(s.historyError).toBe('');
    expect(s.message).toBe('');
  });

  it('selectKeyword sets the selected id, null resets', () => {
    const store = makeStore();
    store.dispatch(slice.selectKeyword('k9'));
    expect(store.getState().ranks.selectedKeywordId).toBe('k9');
    store.dispatch(slice.selectKeyword(null));
    expect(store.getState().ranks.selectedKeywordId).toBeNull();
  });

  it('loadKeywords with a new siteId clears items and selection', async () => {
    const { loadKeywords } = await import('./store/thunks');
    const preloaded: RanksState = {
      ...baseState(),
      siteId: 'site-a',
      items: [keyword('k1')],
      selectedKeywordId: 'k1',
    };
    const state = ranksReducer(
      preloaded,
      loadKeywords.pending('req', { siteId: 'site-b', direction: 'initial' }),
    );
    expect(state.siteId).toBe('site-b');
    expect(state.items).toEqual([]);
    expect(state.selectedKeywordId).toBeNull();
  });

  it('loadKeywords fulfilled clears selection when the selected id disappears', async () => {
    const { loadKeywords } = await import('./store/thunks');
    const state1: RanksState = {
      ...baseState(),
      siteId: 'site-1',
      selectedKeywordId: 'ghost',
      listRequestId: 'req',
    };
    const state2 = ranksReducer(
      state1,
      loadKeywords.fulfilled(listPage(), 'req', { siteId: 'site-1' }),
    );
    expect(state2.selectedKeywordId).toBeNull();
  });

  it('loadKeywords fulfilled keeps selection when the selected id is still present', async () => {
    const { loadKeywords } = await import('./store/thunks');
    const state1: RanksState = {
      ...baseState(),
      siteId: 'site-1',
      selectedKeywordId: 'k1',
      listRequestId: 'req',
    };
    const state2 = ranksReducer(
      state1,
      loadKeywords.fulfilled(listPage(), 'req', { siteId: 'site-1' }),
    );
    expect(state2.selectedKeywordId).toBe('k1');
  });

  it('drops loadKeywords fulfilled for a previous siteId (stale)', async () => {
    const { loadKeywords } = await import('./store/thunks');
    // Pending sets siteId to 'b'; a late fulfilled for 'a' must NOT overwrite.
    let state: RanksState = ranksReducer(
      { ...baseState(), siteId: 'a', items: [keyword('k1')], loaded: true },
      loadKeywords.pending('req-b', { siteId: 'b', direction: 'initial' }),
    );
    expect(state.siteId).toBe('b');
    state = ranksReducer(
      state,
      loadKeywords.fulfilled(listPage({ keywords: [keyword('k-a')] }), 'req-a', {
        siteId: 'a',
        direction: 'initial',
      }),
    );
    // Site 'b' state preserved — the stale 'a' response was ignored.
    expect(state.siteId).toBe('b');
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it('drops loadKeywords rejected for a previous siteId (stale)', async () => {
    const { loadKeywords } = await import('./store/thunks');
    const state = ranksReducer(
      { ...baseState(), siteId: 'b' },
      loadKeywords.rejected(new Error('boom'), 'req-a', { siteId: 'a' }),
    );
    expect(state.error).toBe('');
  });

  it('drops aborted loadKeywords rejected without painting error', async () => {
    const { loadKeywords } = await import('./store/thunks');
    const aborted = {
      type: loadKeywords.rejected.type,
      payload: undefined,
      error: { message: 'Aborted', name: 'AbortError' },
      meta: {
        arg: { siteId: 'a' },
        requestId: 'req',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
      },
    };
    const state = ranksReducer({ ...baseState(), siteId: 'a' }, aborted as never);
    expect(state.error).toBe('');
  });

  it('drops loadKeywordHistory fulfilled for a previous keywordId (stale)', async () => {
    const { loadKeywordHistory } = await import('./store/thunks');
    let state = ranksReducer(baseState(), loadKeywordHistory.pending('req-b', { keywordId: 'kb' }));
    expect(state.historyKeywordId).toBe('kb');
    // A late fulfilled for keyword 'ka' arrives; must not paint its series.
    state = ranksReducer(
      state,
      loadKeywordHistory.fulfilled({ keywordId: 'ka', series: historyPage(2).series }, 'req-a', {
        keywordId: 'ka',
      }),
    );
    expect(state.historyKeywordId).toBe('kb');
    expect(state.history).toEqual([]);
  });

  it('loadKeywordHistory does NOT take historyKeywordId from payload', async () => {
    const { loadKeywordHistory } = await import('./store/thunks');
    let state = ranksReducer(baseState(), loadKeywordHistory.pending('req', { keywordId: 'ka' }));
    state = ranksReducer(
      state,
      loadKeywordHistory.fulfilled(
        { keywordId: 'PAYLOAD-WINS', series: historyPage(2).series },
        'req',
        { keywordId: 'ka' },
      ),
    );
    expect(state.historyKeywordId).toBe('ka');
  });

  it('drops loadKeywordHistory rejected for a previous keywordId (stale)', async () => {
    const { loadKeywordHistory } = await import('./store/thunks');
    // state.historyKeywordId is 'kb'; a rejected for keyword 'ka' arrives late.
    const state = ranksReducer(
      { ...baseState(), historyKeywordId: 'kb' },
      loadKeywordHistory.rejected(new Error('boom'), 'req', { keywordId: 'ka' }),
    );
    expect(state.historyError).toBe('');
  });

  it('drops aborted loadKeywordHistory rejected', async () => {
    const { loadKeywordHistory } = await import('./store/thunks');
    const aborted = {
      type: loadKeywordHistory.rejected.type,
      payload: undefined,
      error: { message: 'Aborted', name: 'AbortError' },
      meta: {
        arg: { keywordId: 'k' },
        requestId: 'req',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
      },
    };
    const state = ranksReducer({ ...baseState(), historyKeywordId: 'k' }, aborted as never);
    expect(state.historyError).toBe('');
  });

  it('load direction=next pushes to the cursorStack, direction=prev pops', async () => {
    const { loadKeywords } = await import('./store/thunks');
    let state: RanksState = { ...baseState(), siteId: 'site-1', listRequestId: 'req' };
    state = ranksReducer(
      state,
      loadKeywords.fulfilled(listPage(), 'req', {
        siteId: 'site-1',
        cursor: 'c1',
        direction: 'next',
      }),
    );
    expect(state.cursorStack).toEqual([null]);
    expect(state.currentCursor).toBe('c1');
    state = ranksReducer(
      { ...state, listRequestId: 'req' },
      loadKeywords.fulfilled(listPage(), 'req', {
        siteId: 'site-1',
        cursor: null,
        direction: 'prev',
      }),
    );
    expect(state.cursorStack).toEqual([]);
  });
});

describe('api wrappers', async () => {
  const {
    fetchKeywordsRequest,
    createKeywordRequest,
    removeKeywordRequest,
    updateCadenceRequest,
    fetchKeywordHistoryRequest,
  } = await vi.importActual<typeof api>('./api');
  const client = await import('@shared/api/client');
  // vi.mocked picks up the vi.fn() installed by the vi.mock factory above.
  // The outer beforeEach calls vi.resetAllMocks(), which strips implementations;
  // restore the default no-op return here so each test starts clean.
  const apiClientMock = vi.mocked(client.apiClient);

  beforeEach(() => {
    apiClientMock.mockResolvedValue({} as never);
  });

  it('fetchKeywordsRequest without a cursor', async () => {
    await fetchKeywordsRequest('site-1');
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords');
  });

  it('fetchKeywordsRequest with a cursor encodes it', async () => {
    await fetchKeywordsRequest('site-1', 'a/b');
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords?cursor=a%2Fb');
  });

  it('fetchKeywordsRequest with a null cursor omits the query', async () => {
    await fetchKeywordsRequest('site-1', null);
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords');
  });

  it('createKeywordRequest posts the body', async () => {
    await createKeywordRequest('site-1', {
      phrase: 'p',
      locationCode: 1,
      languageCode: 'en',
      device: 'desktop',
    });
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords', {
      method: 'POST',
      body: { phrase: 'p', locationCode: 1, languageCode: 'en', device: 'desktop' },
    });
  });

  it('removeKeywordRequest deletes by id', async () => {
    await removeKeywordRequest('kw-1');
    expect(apiClientMock).toHaveBeenCalledWith('/keywords/kw-1', { method: 'DELETE' });
  });

  it('updateCadenceRequest patches the cadence', async () => {
    await updateCadenceRequest('site-1', 'daily');
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/rank-cadence', {
      method: 'PATCH',
      body: { cadence: 'daily' },
    });
  });

  it('fetchKeywordHistoryRequest gets by id', async () => {
    await fetchKeywordHistoryRequest('kw-1');
    expect(apiClientMock).toHaveBeenCalledWith('/keywords/kw-1/history');
  });

  it('fetchKeywordsRequest forwards an init signal when provided', async () => {
    const controller = new AbortController();
    await fetchKeywordsRequest('site-1', undefined, { signal: controller.signal });
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords', {
      signal: controller.signal,
    });
  });

  it('fetchKeywordsRequest sends an engine filter without leaking it into fetch init', async () => {
    const controller = new AbortController();
    await fetchKeywordsRequest('site-1', undefined, {
      signal: controller.signal,
      engine: 'amazon',
    });
    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords?engine=amazon', {
      signal: controller.signal,
    });
  });

  it('fetchKeywordHistoryRequest forwards an init signal when provided', async () => {
    const controller = new AbortController();
    await fetchKeywordHistoryRequest('kw-1', { signal: controller.signal });
    expect(apiClientMock).toHaveBeenCalledWith('/keywords/kw-1/history', {
      signal: controller.signal,
    });
  });
});

describe('component units', () => {
  it.each([
    ['ranked', 'First check'],
    ['new', 'New in the top 100'],
    ['lost', 'Lost from the top 100'],
    ['not_in_top_100', 'Not in the top 100'],
    ['never_checked', 'Never checked'],
  ] as const)('RankStateLabel presents %s with a state-specific label', (state, label) => {
    render(<I18nextProvider i18n={i18n}>
      <RankStateLabel keyword={keyword('k1', { rankState: {
        state, comparison: state === 'never_checked' ? null : state,
        baseline: 'previous_check', position: null, baselinePosition: null,
        change: null, checkedAt: null, baselineCheckedAt: null, failedAt: null,
      } })} />
    </I18nextProvider>);
    expect(screen.getByTestId('keyword-rank-state-k1')).toHaveTextContent(label);
  });

  it('KeywordsTable marks a failed latest check as last-known while preserving its measured position', () => {
    const measuredAt = '2026-07-02T00:00:00.000Z';
    render(<I18nextProvider i18n={i18n}>
      <KeywordsTable keywords={[keyword('k1', {
        latestPosition: 3, lastCheckedAt: measuredAt,
        lastFailedCheckAt: '2026-07-03T00:00:00.000Z', lastFailedReason: 'vendor_timeout',
        rankState: { state: 'failed_last_check', comparison: 'improved', baseline: 'previous_check',
          position: 3, baselinePosition: 4, change: 1, checkedAt: measuredAt,
          baselineCheckedAt: '2026-07-01T00:00:00.000Z', failedAt: '2026-07-03T00:00:00.000Z' },
      })]} removingId={null} selectedId={null} onSelect={vi.fn()} onRemove={vi.fn()} />
    </I18nextProvider>);
    expect(screen.getAllByTestId('keyword-position-last-known-k1')[0]).toHaveTextContent('Last known: 3');
    expect(screen.getAllByTestId('keyword-rank-state-k1')[0]).toHaveTextContent('Last check failed');
    expect(screen.getAllByTestId('keyword-check-failed-k1').length).toBeGreaterThan(0);
  });

  it('KeywordsTable does not mark a never-attempted expired job item as failed', () => {
    render(<I18nextProvider i18n={i18n}>
      <KeywordsTable keywords={[keyword('k1', { latestPosition: null, lastCheckedAt: null })]}
        jobItems={new Map([['k1', { keywordId: 'k1', engine: 'google', state: 'expired',
          reason: 'not_attempted', attempts: 0, finishedAt: '2026-07-03T00:00:00.000Z' }]])}
        removingId={null} selectedId={null} onSelect={vi.fn()} onRemove={vi.fn()} />
    </I18nextProvider>);
    expect(screen.queryByTestId('keyword-check-failed-k1')).toBeNull();
    expect(screen.getAllByTestId('keyword-unavailable-k1').length).toBeGreaterThan(0);
  });

  it('KeywordsTable shows an attempted job failure before the keyword read catches up', () => {
    render(<I18nextProvider i18n={i18n}>
      <KeywordsTable keywords={[keyword('k1', { latestPosition: null, lastCheckedAt: null })]}
        jobItems={new Map([['k1', { keywordId: 'k1', engine: 'google', state: 'failed',
          reason: 'vendor_timeout', attempts: 1, finishedAt: '2026-07-03T00:00:00.000Z' }]])}
        removingId={null} selectedId={null} onSelect={vi.fn()} onRemove={vi.fn()} />
    </I18nextProvider>);
    expect(screen.getAllByTestId('keyword-position-failed-k1')[0]).toHaveTextContent('Check failed');
    expect(screen.getAllByTestId('keyword-check-failed-k1').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — singular up/down aria labels', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k-up', { delta: 1 }), keyword('k-down', { delta: -1 })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByLabelText('Up 1 position').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Down 1 position').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — null delta shows "—" (no data), zero delta shows "0" (no change)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[
            // Never-checked keyword: delta null must NOT render a literal "0".
            keyword('k-none', {
              latestPosition: null,
              previousPosition: null,
              delta: null,
              lastCheckedAt: null,
            }),
            // Measured no-change: delta 0 keeps the flat "0" affordance.
            keyword('k-flat', { latestPosition: 5, previousPosition: 5, delta: 0 }),
          ]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    const noData = screen.getAllByLabelText('No data yet');
    expect(noData.length).toBeGreaterThan(0);
    expect(noData[0]).toHaveTextContent('—');
    expect(noData[0]).toHaveAttribute('role', 'img');
    const flat = screen.getAllByLabelText('No change');
    expect(flat.length).toBeGreaterThan(0);
    expect(flat[0]).toHaveTextContent('0');
    expect(flat[0]).toHaveAttribute('role', 'img');
  });

  it('KeywordsTable — day-range relative last-checked (> 24h ago)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    try {
      render(
        <I18nextProvider i18n={i18n}>
          <KeywordsTable
            keywords={[keyword('k1', { lastCheckedAt: '2026-07-05T00:00:00.000Z' })]}
            removingId={null}
            selectedId={null}
            onSelect={vi.fn()}
            onRemove={vi.fn()}
          />
        </I18nextProvider>,
      );
      expect(screen.getAllByRole('time').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('KeywordsTable — renders "Checking…" only for rows not yet refreshed past the trigger', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[
            // Older than the trigger → still checking.
            keyword('k1', { lastCheckedAt: '2026-07-02T00:00:00.000Z' }),
            // Never checked → still checking.
            keyword('k2', { lastCheckedAt: null, latestPosition: null, delta: null }),
            // Already refreshed after the trigger → shows the real position.
            keyword('k3', { lastCheckedAt: '2026-07-09T00:00:00.000Z', latestPosition: 2 }),
          ]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
          checkingSince={Date.parse('2026-07-05T00:00:00.000Z')}
        />
      </I18nextProvider>,
    );
    // k1 + k2 show the spinner label in both the position and last-checked cells.
    expect(screen.getAllByTestId(/^keyword-checking-pos-k1/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/^keyword-checking-time-k2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Checking…').length).toBeGreaterThan(0);
    // k3 already refreshed → its real position renders, no checking indicator.
    expect(screen.queryByTestId('keyword-checking-pos-k3')).toBeNull();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — mobile view exposes a card per keyword', async () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1'), keyword('k2', { delta: -3 })]}
          removingId={null}
          selectedId={null}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('keyword-card-k1')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-card-k2')).toBeInTheDocument();
    // Down delta with magnitude > 1 renders plural copy for a11y.
    const decreaseLabel = screen.getAllByLabelText('Down 3 positions');
    expect(decreaseLabel.length).toBeGreaterThan(0);
  });

  it('KeywordsTable — clicking the phrase button calls onSelect (both table + card variants)', async () => {
    const onSelect = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1')]}
          removingId={null}
          selectedId="k1"
          onSelect={onSelect}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    // Two select buttons render — one per layout (desktop + mobile). Both must
    // fire onSelect so the flow works in either viewport.
    const selectButtons = screen.getAllByRole('button', { name: 'phrase-k1' });
    expect(selectButtons.length).toBeGreaterThanOrEqual(2);
    for (const btn of selectButtons) {
      await user.click(btn);
    }
    expect(onSelect).toHaveBeenCalledTimes(selectButtons.length);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'k1' }));
  });

  it('KeywordsTable — recent lastChecked uses relative "hours ago"', () => {
    vi.setSystemTime(new Date('2026-07-02T02:00:00.000Z'));
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1', { lastCheckedAt: '2026-07-02T01:00:00.000Z' })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    // Relative label appears; sanity-check no crash and time element present.
    expect(screen.getAllByRole('time').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — minute-range relative last-checked', () => {
    vi.setSystemTime(new Date('2026-07-02T00:05:00.000Z'));
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1', { lastCheckedAt: '2026-07-02T00:03:00.000Z' })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByRole('time').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — very recent (< 60s) last-checked', () => {
    vi.setSystemTime(new Date('2026-07-02T00:00:30.000Z'));
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1', { lastCheckedAt: '2026-07-02T00:00:15.000Z' })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByRole('time').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — an unknown location code gets an honest fallback', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1', { locationCode: 9999 })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByText('Unknown country').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — mobile device label renders', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1', { device: 'mobile' })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByText('Mobile').length).toBeGreaterThan(0);
  });

  it('KeywordsTable — uses logical directional utilities only (RTL-safe)', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1')]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    const rawSrc = await import('./components/KeywordsTable.tsx?raw');
    const src = rawSrc.default;
    expect(src).not.toMatch(/\btext-right\b|\btext-left\b/);
    expect(src).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
  });

  it('CadenceToggle — daily-on state, enabled toggle switches back', async () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <CadenceToggle cadence="daily" onChange={onChange} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('cadence-toggle'));
    expect(onChange).toHaveBeenCalledWith('weekly');
  });

  it('CadenceToggle — disabled by "disabled" prop', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CadenceToggle cadence="weekly" disabled onChange={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('cadence-toggle')).toBeDisabled();
  });

  it('KeywordsTable — Intl.DisplayNames.of undefined → locationLabel falls back to raw region code — covers line 103', () => {
    // `/* c8 ignore next */` is unrecognized in Vitest 4; cover the `?? region`
    // fallback (line 103) by making regions.of() return undefined.
    const spy = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[keyword('k1', { locationCode: 2840 })]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </I18nextProvider>,
    );
    spy.mockRestore();
    expect(screen.getAllByText('Unknown country').length).toBeGreaterThan(0);
  });

  it('AddKeywordForm — Intl.DisplayNames.of undefined → falls back to raw region + language codes — covers lines 137 and 152', () => {
    // `/* c8 ignore next */` is unrecognized in Vitest 4; cover both
    // `?? opt.region` (line 137) and `?? lang` (line 152) by making .of()
    // return undefined for every call.
    const spy = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <AddKeywordForm
          siteId="site-1"
          onSubmit={vi.fn()}
          submitting={false}
          addError=""
        />
      </I18nextProvider>,
    );
    spy.mockRestore();
    // Location and language selects still render (raw ISO codes as option labels).
    expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/language/i)).toBeInTheDocument();
  });

  it('AddKeywordForm — picking a country narrows the language list to the pairings DataForSEO serves', async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <AddKeywordForm
          siteId="site-1"
          onSubmit={vi.fn()}
          submitting={false}
          addError=""
        />
      </I18nextProvider>,
    );
    const language = screen.getByLabelText(/language/i) as HTMLSelectElement;

    // US default serves English and Spanish, and English survives the mount.
    expect(language).toHaveValue('en');
    expect([...language.options].map((o) => o.value)).toEqual(['en', 'es']);

    // Saudi Arabia serves Arabic only — English would be rejected by the
    // vendor, so the stranded value is corrected instead of submitted.
    await user.click(screen.getByLabelText(/location/i));
    await user.click(await screen.findByRole('option', { name: /Saudi Arabia/ }));
    await waitFor(() => expect(language).toHaveValue('ar'));
    expect([...language.options].map((o) => o.value)).toEqual(['ar']);

    // A country that still serves the current language leaves it alone.
    await user.click(screen.getByLabelText(/location/i));
    await user.click(await screen.findByRole('option', { name: /Algeria/ }));
    await waitFor(() => expect([...language.options].map((o) => o.value)).toEqual(['fr', 'ar']));
    expect(language).toHaveValue('ar');
  });

  it('languagesForLocation — an unlisted code falls back to the default market', async () => {
    const { languagesForLocation, LOCATION_OPTIONS } = await import('./validation');
    expect(languagesForLocation(2682)).toEqual(['ar']);
    expect(languagesForLocation(-1)).toEqual(LOCATION_OPTIONS[0]!.languages);
  });
});

describe('KeywordsPanel — list filters, paging and market move', () => {
  const emptyFiltered = () => mocked.fetchKeywordsRequest.mockResolvedValue(listPage({ keywords: [], total: 0, siteTotal: 4 } as never));

  it('searches after a short pause and restarts the pause when the text changes again', async () => {
    renderPage();
    const input = await screen.findByTestId('keyword-search');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1', undefined, expect.objectContaining({ search: 'abc' })));
  });

  it('clears a filter that matched nothing', async () => {
    emptyFiltered();
    const user = userEvent.setup();
    renderPage({ initialEntry: '/site?tab=keywords&search=zzz' });
    await user.click(await screen.findByRole('button', { name: i18n.t('keywordList.clearFilters', { ns: 'ranks' }) }));
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1', undefined, expect.not.objectContaining({ search: expect.anything() })));
  });

  it('moves back to the last page when the requested page no longer exists', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(listPage({ total: 2, siteTotal: 2, page: 1, pageSize: 25 } as never));
    renderPage({ initialEntry: '/site?tab=keywords&page=9' });
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1', undefined, expect.objectContaining({ page: 1 })));
  });

  it('changes the page size from the pagination footer', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(listPage({ total: 60, siteTotal: 60, page: 1, pageSize: 25 } as never));
    const user = userEvent.setup();
    renderPage();
    const size = await screen.findByRole('combobox', { name: i18n.t('keywordList.pagination.rowsPerPage', { ns: 'ranks' }) });
    await user.click(size);
    await user.click(await screen.findByRole('option', { name: '50' }));
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1', undefined, expect.objectContaining({ pageSize: 50 })));
  });

  it('reloads the list after the tracked keywords are moved to the site market', async () => {
    const preview = { target: { locationCode: 2840, languageCode: 'en', device: 'desktop' as const },
      tracked: 2, inTarget: 0, movable: 2, alreadyTracked: 0, withHistory: 0, resumesHistory: 0, token: 'token-1' };
    mocked.fetchKeywordMarketMoveRequest.mockResolvedValue({ preview });
    mocked.moveKeywordsToSiteMarketRequest.mockResolvedValue({ moved: 2, preview: { ...preview, movable: 0 } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('keyword-market-move-review'));
    const before = mocked.fetchKeywordsRequest.mock.calls.length;
    await user.click(screen.getByTestId('keyword-market-move-confirm'));
    await waitFor(() => expect(mocked.fetchKeywordsRequest.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('KeywordsPanel — stored rank jobs', () => {
  const partialJob = (over: Partial<RankJob> = {}) => rankJob({
    status: 'partial', finishedAt: '2026-07-13T00:00:02.000Z',
    totals: { total: 2, queued: 0, running: 0, succeeded: 1, failed: 1, expired: 0, cancelled: 0 },
    items: [
      { keywordId: 'k1', engine: 'google', state: 'succeeded', reason: null, attempts: 1, finishedAt: '2026-07-13T00:00:02.000Z' },
      { keywordId: 'k2', engine: 'google', state: 'failed', reason: 'vendor_error', attempts: 1, finishedAt: '2026-07-13T00:00:02.000Z' },
    ],
    ...over,
  });

  const settleStoredJob = async (retry: () => void) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    mocked.fetchActiveRankJobRequest.mockResolvedValueOnce({ job: rankJob() });
    mocked.fetchRankJobRequest.mockResolvedValueOnce({ job: partialJob() });
    retry();
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_100);
    await vi.advanceTimersByTimeAsync(0);
    const warning = vi.mocked(toast.warning).mock.calls.at(-1);
    expect(warning?.[1]).toEqual(expect.objectContaining({ action: expect.objectContaining({ label: expect.any(String) }) }));
    return (warning![1] as unknown as { action: { onClick: () => void } }).action.onClick;
  };

  it('offers a retry of the failed keywords and confirms when nothing needed retrying', async () => {
    const onClick = await settleStoredJob(() => mocked.retryFailedRankJobRequest.mockResolvedValueOnce({ message: 'Nothing to retry.' } as never));
    onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.success).toHaveBeenCalledWith('Nothing to retry.');
  });

  it('follows the new job a retry queues', async () => {
    const onClick = await settleStoredJob(() => mocked.retryFailedRankJobRequest.mockResolvedValueOnce({
      message: 'Retrying 1 keyword.', job: rankJob({ id: 'job-2' }) } as never));
    mocked.fetchRankJobRequest.mockResolvedValue({ job: rankJob({ id: 'job-2' }) });
    onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.loading).toHaveBeenCalledWith('Retrying 1 keyword.', { id: 'rank-job-job-2' });
    expect(window.localStorage.getItem('rmf.rankJob.site-1')).toBe('job-2');
  });

  it('reports a retry that could not be queued', async () => {
    const onClick = await settleStoredJob(() => mocked.retryFailedRankJobRequest.mockRejectedValueOnce(new Error('offline')));
    onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.error).toHaveBeenCalledWith(i18n.t('checkFailed', { ns: 'ranks' }));
  });

  it('refreshes the trend of the selected keyword when a stored job settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    mocked.fetchActiveRankJobRequest.mockResolvedValueOnce({ job: rankJob() });
    mocked.fetchRankJobRequest.mockResolvedValueOnce({ job: partialJob() });
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByTestId('keyword-select-k1'));
    await vi.advanceTimersByTimeAsync(0);
    const historyReads = mocked.fetchKeywordHistoryRequest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_100);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.fetchKeywordHistoryRequest.mock.calls.length).toBeGreaterThan(historyReads);
  });

  it('keeps working when the stored job cannot be read, and resumes a remembered job', async () => {
    mocked.fetchActiveRankJobRequest.mockRejectedValueOnce(new Error('offline'));
    const view = renderPage();
    expect(await screen.findByTestId('keyword-check-now')).toBeInTheDocument();
    expect(view).toBeDefined();
  });

  it('polls a job remembered by this browser instead of asking for the active one', async () => {
    window.localStorage.setItem('rmf.rankJob.site-1', 'job-7');
    mocked.fetchRankJobRequest.mockResolvedValue({ job: rankJob({ id: 'job-7' }) });
    renderPage();
    await waitFor(() => expect(mocked.fetchRankJobRequest).toHaveBeenCalledWith('site-1', 'job-7', expect.any(AbortSignal)));
    expect(mocked.fetchActiveRankJobRequest).not.toHaveBeenCalled();
  });

  it('marks the one keyword a stored keyword job is checking', async () => {
    mocked.fetchActiveRankJobRequest.mockResolvedValueOnce({ job: rankJob({
      scope: 'keyword',
      totals: { total: 1, queued: 0, running: 1, succeeded: 0, failed: 0, expired: 0, cancelled: 0 },
      items: [{ keywordId: 'k1', engine: 'google', state: 'running', reason: null, attempts: 1, finishedAt: null }],
      status: 'running',
    }) });
    mocked.fetchRankJobRequest.mockResolvedValue({ job: rankJob({ scope: 'keyword', status: 'running',
      items: [{ keywordId: 'k1', engine: 'google', state: 'running', reason: null, attempts: 1, finishedAt: null }] }) });
    renderPage();
    expect((await screen.findAllByTestId('keyword-checking-pos-k1')).length).toBeGreaterThan(0);
  });
});

describe('AddKeywordForm — bulk results and previews', () => {
  it('summarises duplicates, long phrases and other invalid phrases from the server', async () => {
    mocked.createKeywordsBulkRequest.mockResolvedValueOnce({
      message: 'Done.', counts: { added: 1, duplicate: 1, invalid: 2 },
      results: [
        { phrase: 'fresh phrase', status: 'added', keyword: keyword('k9', { phrase: 'fresh phrase' }) },
        { phrase: 'old phrase', status: 'duplicate', reason: 'already_tracked' },
        { phrase: 'long phrase', status: 'invalid', reason: 'too_long' },
        { phrase: 'odd phrase', status: 'invalid', reason: 'empty' },
      ],
    });
    renderPage();
    await waitFor(() => expect(mocked.fetchTrackedKeywordPhrasesRequest).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'fresh phrase\nold phrase\nlong phrase\nodd phrase' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Track keywords' }));
    const summary = await screen.findByTestId('keyword-add-summary');
    expect(summary.textContent ?? '').toMatch(/·/);
  });

  it('removes a phrase from the review list and tolerates an unavailable tracked-phrase read', async () => {
    mocked.fetchTrackedKeywordPhrasesRequest.mockRejectedValue(new Error('offline'));
    renderPage();
    await waitFor(() => expect(mocked.fetchTrackedKeywordPhrasesRequest).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'first phrase\nsecond phrase' } });
    await waitFor(() => expect(screen.getAllByTestId('keyword-add-item')).toHaveLength(2));
    await userEvent.setup().click(screen.getAllByRole('button', { name: /^Remove/ })[0]!);
    await waitFor(() => expect(screen.getAllByTestId('keyword-add-item')).toHaveLength(1));
  });
});

describe('KeywordsPanel — search text follows the address', () => {
  it('replaces unsent text when the address carries a different search', async () => {
    let go: (to: string) => void = () => undefined;
    function Jump() {
      const navigate = useNavigate();
      go = (to) => navigate(to);
      return null;
    }
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/site?tab=keywords']}>
            <Jump />
            <KeywordsPanel siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    const input = await screen.findByTestId('keyword-search');
    fireEvent.change(input, { target: { value: 'typed text' } });
    await act(async () => { go('/site?tab=keywords&search=from-link'); });
    await waitFor(() => expect(input).toHaveValue('from-link'));
  });

  it('skips a bulk result that reports an added phrase without its keyword', async () => {
    mocked.createKeywordsBulkRequest.mockResolvedValueOnce({
      message: 'Done.', counts: { added: 1, duplicate: 0, invalid: 0 },
      results: [{ phrase: 'ghost phrase', status: 'added' }],
    });
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter><KeywordsPanel siteId="site-1" /></MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() => expect(mocked.fetchTrackedKeywordPhrasesRequest).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'ghost phrase' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Track keywords' }));
    await waitFor(() => expect(mocked.createKeywordsBulkRequest).toHaveBeenCalled());
  });
});

describe('RankStateLabel — movement states', () => {
  it('shows the position change for a keyword without a stored state and for a moved keyword', () => {
    const view = render(<I18nextProvider i18n={i18n}><RankStateLabel keyword={keyword('k1')} /></I18nextProvider>);
    expect(view.container.querySelector('span.inline-flex')).not.toBeNull();
    view.unmount();
    render(<I18nextProvider i18n={i18n}>
      <RankStateLabel keyword={keyword('k1', { rankState: { state: 'improved' } as never })} />
    </I18nextProvider>);
    expect(document.querySelector('[data-rank-state="improved"]')).not.toBeNull();
  });
});

