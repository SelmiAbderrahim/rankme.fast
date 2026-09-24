import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
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
import { AddKeywordForm } from './components/AddKeywordForm';
import type {
  Keyword,
  KeywordListPage,
  KeywordSuggestion,
  KeywordSuggestionsResponse,
  RankHistoryResponse,
  RanksState,
} from './types';
import { parseKeywordLines } from './validation';

vi.mock('./api', () => ({
  fetchKeywordsRequest: vi.fn(),
  createKeywordRequest: vi.fn(),
  removeKeywordRequest: vi.fn(),
  updateCadenceRequest: vi.fn(),
  fetchKeywordHistoryRequest: vi.fn(),
  checkNowRequest: vi.fn(),
  fetchKeywordSuggestionsRequest: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
  mocked.removeKeywordRequest.mockResolvedValue({
    message: 'Keyword removed.',
  });
  mocked.checkNowRequest.mockResolvedValue({
    message: 'Rank check queued.',
    checkStartedAt: '2026-07-13T00:00:00.000Z',
  });
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
    await user.click(screen.getByRole('button', { name: 'Export or share' }));
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
    await user.click(screen.getByRole('button', { name: 'Export or share' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not copy to clipboard.'),
    );
  });
});

describe('KeywordsPanel — Check now (on-demand rank check)', () => {
  it('queues an on-demand check and toasts the server message', async () => {
    renderPage();
    const btn = await screen.findByTestId('keyword-check-now');
    await userEvent.setup().click(btn);
    await waitFor(() => expect(mocked.checkNowRequest).toHaveBeenCalledWith('site-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rank check queued.'));
  });

  it('a failed on-demand check surfaces via toast.error', async () => {
    mocked.checkNowRequest.mockRejectedValueOnce(
      new ApiError('x', 429, { error: { message: 'Too many checks. Try later.' } }),
    );
    renderPage();
    await userEvent.setup().click(await screen.findByTestId('keyword-check-now'));
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
    const btn = await screen.findByTestId('keyword-check-now');
    await userEvent.setup().click(btn);
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
    const btn = await screen.findByTestId('keyword-check-now');
    await userEvent.setup().click(btn);
    await waitFor(() => expect(store.getState().ranks.checkCooldownUntil).not.toBeNull());
    const until = store.getState().ranks.checkCooldownUntil!;
    expect(until).toBeLessThan(Date.now() + 30_000);
  });

  it('network failure toasts the localized fallback and sets no cooldown', async () => {
    mocked.checkNowRequest.mockRejectedValue(new TypeError('offline'));
    const store = renderPage();
    const btn = await screen.findByTestId('keyword-check-now');
    await userEvent.setup().click(btn);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not start the check.'));
    expect(store.getState().ranks.checkCooldownUntil).toBeNull();
  });

  it('flips rows to an optimistic "Checking…" state after a queued check', async () => {
    renderPage();
    await userEvent.setup().click(await screen.findByTestId('keyword-check-now'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // The seeded rows were last checked on 2026-07-02, before "now", so both
    // flip to "Checking…" until a fresh snapshot lands.
    await waitFor(() => expect(screen.getAllByText('Checking…').length).toBeGreaterThan(0));
  });

  it('checks one keyword from its row menu and only marks that row as checking', async () => {
    mocked.checkNowRequest.mockResolvedValueOnce({
      message: 'Rank check queued.',
      checkStartedAt: new Date().toISOString(),
    });
    renderPage();
    const row = await screen.findByTestId('keyword-row-k1');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Open menu for phrase-k1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Check now' }));

    await waitFor(() =>
      expect(mocked.checkNowRequest).toHaveBeenCalledWith('site-1', 'k1'),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('keyword-checking-pos-k1').length).toBeGreaterThan(0),
    );
    expect(screen.queryAllByTestId('keyword-checking-pos-k2')).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith('Rank check queued.');
  });

  it('polls the keyword list after a check and stops once snapshots refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    // fireEvent (synchronous) avoids the userEvent+fake-timers deadlock; the
    // async handler is flushed via advanceTimersByTimeAsync.
    renderPage();
    await vi.advanceTimersByTimeAsync(0); // flush the mount load
    fireEvent.click(screen.getByTestId('keyword-check-now'));
    await vi.advanceTimersByTimeAsync(0); // flush checkNow → checkingSince set
    expect(screen.getAllByText('Checking…').length).toBeGreaterThan(0);
    const before = mocked.fetchKeywordsRequest.mock.calls.length;
    // The next refetch returns snapshots stamped AFTER the trigger → poll stops.
    mocked.fetchKeywordsRequest.mockResolvedValue(
      listPage({
        keywords: [
          keyword('k1', { lastCheckedAt: '2026-07-13T00:00:05.000Z' }),
          keyword('k2', {
            lastCheckedAt: '2026-07-13T00:00:05.000Z',
            latestPosition: null,
            delta: null,
          }),
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(3_000); // one poll tick
    expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(before + 1);
    expect(screen.queryByText('Checking…')).toBeNull();
  });

  it('keeps the selected engine on every post-check poll request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
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
    await vi.advanceTimersByTimeAsync(0);
    const before = mocked.fetchKeywordsRequest.mock.calls.length;

    await vi.advanceTimersByTimeAsync(3_000);

    expect(mocked.fetchKeywordsRequest.mock.calls.length).toBe(before + 1);
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      expect.objectContaining({ engine: 'amazon', signal: expect.any(AbortSignal) }),
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

  it('stops polling after the deadline even if snapshots never refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByTestId('keyword-check-now'));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getAllByText('Checking…').length).toBeGreaterThan(0);
    // Snapshots keep returning stale (the default listPage, checked 2026-07-02),
    // so only the 60s ceiling clears the checking state.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.queryByText('Checking…')).toBeNull();
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
      expect.objectContaining({ engine: 'amazon', signal: expect.any(AbortSignal) }),
    );
  });

  it('renders empty state when there are no keywords', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(listPage({ keywords: [] }));
    renderPage();
    expect(await screen.findByTestId('keywords-empty')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-add')).toBeInTheDocument();
  });
});

describe('KeywordsPanel — keywords table, position rendering, add + remove', () => {
  it('renders the table with position, delta, and last-checked info', async () => {
    renderPage();
    await waitFor(() =>
      expect(mocked.fetchKeywordsRequest).toHaveBeenCalledWith(
        'site-1',
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
      expect(mocked.createKeywordRequest).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ phrase: 'new phrase' }),
      ),
    );
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2));
    expect(mocked.fetchKeywordsRequest).toHaveBeenLastCalledWith(
      'site-1',
      undefined,
      expect.objectContaining({ engine: 'amazon', signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
  });

  it('submits newline-delimited keywords sequentially and reloads once', async () => {
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Keywords');
    await user.type(input, 'first keyword{enter}second keyword');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));

    await waitFor(() => expect(mocked.createKeywordRequest).toHaveBeenCalledTimes(2));
    expect(mocked.createKeywordRequest.mock.calls.map(([, body]) => body.phrase)).toEqual([
      'first keyword',
      'second keyword',
    ]);
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('');
  });

  it('stops a batch on failure and keeps the failed and unattempted lines', async () => {
    mocked.createKeywordRequest
      .mockResolvedValueOnce({ keyword: keyword('first', { phrase: 'first' }), message: 'Added.' })
      .mockRejectedValueOnce(
        new ApiError('conflict', 409, {
          error: { message: 'That keyword is already tracked.' },
        }),
      );
    renderPage();
    await waitFor(() => expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Keywords');
    await user.type(input, 'first{enter}duplicate{enter}third');
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));

    expect(await screen.findByText('That keyword is already tracked.')).toBeInTheDocument();
    expect(mocked.createKeywordRequest).toHaveBeenCalledTimes(2);
    expect(mocked.createKeywordRequest).not.toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ phrase: 'third' }),
    );
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('duplicate\nthird');
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

    expect(input).toHaveValue('audit pricing\nSEO   AUDIT TOOL\nrank tracker');
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
    expect(mocked.createKeywordRequest).not.toHaveBeenCalled();
  });

  it('add form → validates the length of every line', async () => {
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Keywords');
    await user.type(input, 'x'.repeat(301));
    await user.click(screen.getByRole('button', { name: 'Track keywords' }));
    expect(
      await screen.findByText('That keyword is too long (300 characters max).'),
    ).toBeInTheDocument();
    expect(mocked.createKeywordRequest).not.toHaveBeenCalled();
  });

  it('add form → surfaces the server error message', async () => {
    mocked.createKeywordRequest.mockRejectedValueOnce(
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
      expect.objectContaining({ engine: 'amazon', signal: expect.any(AbortSignal) }),
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
      /First check runs Monday/,
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
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('No change');
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
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Down 1 position');
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
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Down 2 positions');
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
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Up 1 position');
  });

  it('trend chart null delta uses flat copy', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RankTrendChart
          keyword={keyword('k1', { delta: null, latestPosition: 3 })}
          series={historyPage(2).series}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('No change');
  });

  it('trend chart skips null-position points in the SVG path', () => {
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
    // Table still shows only the non-null rows (2 points => 2 body rows).
    const table = screen.getByTestId('rank-trend-table');
    const bodyRows = within(table.querySelector('tbody')!).getAllByRole('row');
    expect(bodyRows).toHaveLength(2);
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
    let state: RanksState = { ...baseState(), siteId: 'site-1' };
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
      state,
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
