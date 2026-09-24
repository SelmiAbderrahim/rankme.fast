import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from './api';
import * as ranksApi from '@features/ranks/api';
import { ranksReducer, type Keyword, type KeywordListPage } from '@features/ranks';
import * as ranksFeature from '@features/ranks';
import { toast } from 'sonner';
import {
  keywordResearchReducer,
  KeywordResearchPanel,
  KeywordResearchPage,
  IntentBadge,
  keywordResearchRoutes,
  loadMetrics,
  loadRelated,
  fetchIntent,
  fetchIdeas,
  fetchLongTail,
  MAX_KEYWORDS,
  MAX_PHRASE_LENGTH,
  buildSearchAgainUrl,
  difficultyBand,
  keywordResearchErrorMessage,
  apiErrorStatus,
  metricsFormSchema,
  parsePrefillParams,
} from './index';
import type { KeywordMetric, RelatedKeyword, ResearchHistoryItem, SearchIntent } from './types';
import {
  formatCpc,
  formatVolume,
  keywordSlug,
  normalizeKeywordPhrase,
  trackedKeywordPhrases,
} from './components/KeywordResearchPanel';

vi.mock('./api', () => ({
  fetchMetricsRequest: vi.fn(),
  fetchRelatedRequest: vi.fn(),
  // Default resolved values so every metrics submit (which also dispatches
  // fetchIntent) has a well-formed response unless a test overrides it.
  fetchIntentRequest: vi.fn().mockResolvedValue({ intents: [] }),
  fetchIdeasRequest: vi.fn().mockResolvedValue({ seed: '', ideas: [], cached: false }),
  fetchLongTailRequest: vi.fn().mockResolvedValue({
    seed: '',
    suggestions: [],
    cached: false,
  }),
  fetchHistoryRequest: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
vi.mock('@features/ranks/api', () => ({
  fetchKeywordsRequest: vi.fn(),
  createKeywordRequest: vi.fn(),
  removeKeywordRequest: vi.fn(),
  updateCadenceRequest: vi.fn(),
  fetchKeywordHistoryRequest: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => ({
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
      { countryCode: 'GB', locationCode: 2826, languageCodes: ['en', 'de'] },
      { countryCode: 'DE', locationCode: 2276, languageCodes: ['de', 'en'] },
    ],
    loading: false,
    error: false,
  }),
}));

const mocked = vi.mocked(api);
const mockedRanks = vi.mocked(ranksApi);

/** Minimal React fiber shape for the fiber-walking guard-branch tests below. */
type FiberNode = {
  memoizedProps?: Record<string, unknown>;
  return: FiberNode | null;
};

const makeStore = () =>
  configureStore({
    reducer: { keywordResearch: keywordResearchReducer, ranks: ranksReducer },
  });

const metric = (overrides: Partial<KeywordMetric> = {}): KeywordMetric => ({
  keyword: 'seo audit tool',
  searchVolume: 5400,
  difficulty: 62,
  cpc: '4.120000',
  monthlySearches: [
    { year: 2025, month: 10, searchVolume: 5000 },
    { year: 2025, month: 11, searchVolume: 5200 },
    { year: 2025, month: 12, searchVolume: 5400 },
  ],
  cached: false,
  fetchedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-07-31T00:00:00.000Z',
  ...overrides,
});

const relatedRow = (overrides: Partial<RelatedKeyword> = {}): RelatedKeyword => ({
  keyword: 'free seo audit tool',
  searchVolume: 3200,
  difficulty: 48,
  cpc: '3.140000',
  monthlySearches: [],
  ...overrides,
});

const trackedKeyword = (overrides: Partial<Keyword> = {}): Keyword => ({
  id: 'tracked-1',
  siteId: 's1',
  phrase: 'seo audit tool',
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  latestPosition: null,
  previousPosition: null,
  delta: null,
  lastCheckedAt: null,
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

const trackedKeywordPage = (keywords: Keyword[] = []): KeywordListPage => ({
  keywords,
  nextCursor: null,
  cadence: 'weekly',
});

const withProviders = (ui: React.ReactNode, store = makeStore()) =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(() => {
  mockedRanks.fetchKeywordsRequest.mockReset();
  mockedRanks.fetchKeywordsRequest.mockResolvedValue(trackedKeywordPage());
  initI18n({ initialLocale: 'en' });
  return changeLanguage('en');
});
afterEach(() => vi.clearAllMocks());

describe('difficultyBand', () => {
  it('bands 0..29 as easy, 30..69 as medium, 70+ as hard, null as unknown', () => {
    expect(difficultyBand(0)).toBe('easy');
    expect(difficultyBand(29)).toBe('easy');
    expect(difficultyBand(30)).toBe('medium');
    expect(difficultyBand(69)).toBe('medium');
    expect(difficultyBand(70)).toBe('hard');
    expect(difficultyBand(100)).toBe('hard');
    expect(difficultyBand(null)).toBe('unknown');
  });
});

describe('panel pure helpers', () => {
  it('formatCpc: null -> "—"; number -> $x.xx', () => {
    expect(formatCpc(null)).toBe('—');
    expect(formatCpc('4.120000')).toBe('$4.12');
  });
  it('formatVolume: null -> unavailable label; number -> Intl.NumberFormat(locale)', () => {
    const t = (k: string) => (k === 'keywordResearch:unavailable' ? '—' : k);
    expect(formatVolume(null, t, 'en')).toBe('—');
    expect(formatVolume(1234, t, 'en')).toBe(new Intl.NumberFormat('en').format(1234));
    // The locale is honored — fr groups thousands differently from en.
    expect(formatVolume(1234, t, 'fr')).toBe(new Intl.NumberFormat('fr').format(1234));
  });
  it('keywordSlug: turns non-alphanum into dashes and lowercases', () => {
    expect(keywordSlug('Seo AUDIT tool!')).toBe('seo-audit-tool-');
  });
  it('normalizes tracked phrases and filters them to the active market', () => {
    expect(normalizeKeywordPhrase('  SEO   Audit Tool ')).toBe('seo audit tool');
    expect(
      trackedKeywordPhrases(
        [
          trackedKeyword({ phrase: ' SEO   Audit Tool ' }),
          trackedKeyword({ id: 'tracked-2', phrase: 'seo audit tool', device: 'mobile' }),
          trackedKeyword({ id: 'tracked-3', phrase: 'inactive', active: false }),
          trackedKeyword({ id: 'tracked-4', phrase: 'wrong location', locationCode: 2276 }),
          trackedKeyword({ id: 'tracked-5', phrase: 'wrong language', languageCode: 'de' }),
          trackedKeyword({ id: 'tracked-6', phrase: 'x'.repeat(MAX_PHRASE_LENGTH + 1) }),
          trackedKeyword({
            id: 'tracked-7',
            phrase: 'Case-insensitive language',
            languageCode: 'EN',
          }),
        ],
        2840,
        'en',
      ),
    ).toEqual(['SEO Audit Tool', 'Case-insensitive language']);
  });
});

describe('validation', () => {
  it('accepts 1..50 phrases each ≤80 chars', () => {
    expect(
      metricsFormSchema.safeParse({
        keywords: ['seo'],
        locationCode: 2840,
        languageCode: 'en',
      }).success,
    ).toBe(true);
  });
  it('rejects empty phrase', () => {
    expect(
      metricsFormSchema.safeParse({
        keywords: [''],
        locationCode: 2840,
        languageCode: 'en',
      }).success,
    ).toBe(false);
  });
  it('rejects overlong phrase', () => {
    expect(
      metricsFormSchema.safeParse({
        keywords: ['a'.repeat(MAX_PHRASE_LENGTH + 1)],
        locationCode: 2840,
        languageCode: 'en',
      }).success,
    ).toBe(false);
  });
  it('rejects too many phrases', () => {
    expect(
      metricsFormSchema.safeParse({
        keywords: Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `k${i}`),
        locationCode: 2840,
        languageCode: 'en',
      }).success,
    ).toBe(false);
  });
});

describe('errorMessage helpers', () => {
  it('extracts server-provided localized message', () => {
    const err = new ApiError('x', 503, { error: { message: 'Try again later' } });
    expect(keywordResearchErrorMessage(err, 'keywordResearch:loadFailed')).toBe('Try again later');
  });
  it('falls back to i18n key when server has no message', () => {
    const err = new ApiError('x', 500, {});
    expect(keywordResearchErrorMessage(err, 'keywordResearch:loadFailed')).toBeTruthy();
  });
  it('falls back to i18n key on non-ApiError', () => {
    expect(
      keywordResearchErrorMessage(new TypeError('x'), 'keywordResearch:loadFailed'),
    ).toBeTruthy();
  });
  it('extracts status from ApiError', () => {
    expect(apiErrorStatus(new ApiError('x', 503, {}))).toBe(503);
    expect(apiErrorStatus(new Error('x'))).toBeNull();
  });
});

describe('thunks + slice', () => {
  it('loadMetrics.fulfilled updates state', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    await store.dispatch(
      loadMetrics({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' }),
    );
    expect(store.getState().keywordResearch.metrics).toHaveLength(1);
    expect(store.getState().keywordResearch.loaded).toBe(true);
  });

  it('loadMetrics.rejected sets error', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockRejectedValueOnce(new ApiError('x', 500, {}));
    await store.dispatch(
      loadMetrics({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' }),
    );
    expect(store.getState().keywordResearch.error).toBeTruthy();
  });

  it('loadRelated.fulfilled updates relatedByKeyword under the locale-aware cache key', async () => {
    const store = makeStore();
    mocked.fetchRelatedRequest.mockResolvedValueOnce({
      keyword: 'seo',
      related: [relatedRow()],
      cached: false,
    });
    await store.dispatch(loadRelated({ keyword: 'seo', locationCode: 2840, languageCode: 'en' }));
    expect(store.getState().keywordResearch.relatedByKeyword['seo::2840::en']).toHaveLength(1);
  });

  it('loadRelated.rejected sets relatedError', async () => {
    const store = makeStore();
    mocked.fetchRelatedRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await store.dispatch(loadRelated({ keyword: 'seo', locationCode: 2840, languageCode: 'en' }));
    expect(store.getState().keywordResearch.relatedError).toBeTruthy();
  });

  it('loadMetrics rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadMetrics.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        arg: { keywords: ['seo'], locationCode: 2840, languageCode: 'en' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    } as UnknownAction);
    expect(store.getState().keywordResearch.error).toBe('');
  });

  it('loadRelated rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadRelated.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        arg: { keyword: 'seo', locationCode: 2840, languageCode: 'en' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    } as UnknownAction);
    expect(store.getState().keywordResearch.relatedError).toBe('');
  });
});

describe('KeywordResearchPanel rendering', () => {
  it('renders form + shows results after query + add to tracking', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mockedRanks.createKeywordRequest.mockResolvedValueOnce({
      keyword: {
        id: 'k1',
        siteId: 's1',
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        active: true,
        createdAt: 'x',
        updatedAt: 'x',
        latestPosition: null,
        previousPosition: null,
        delta: null,
        lastCheckedAt: null,
        aiOverviewPresent: null,
        aiCited: null,
        aiCitedUrl: null,
        lastFailedCheckAt: null,
        lastFailedReason: null,
        engine: 'google',
        engineTarget: null,
        observationMeta: null,
      },
      message: 'ok',
    });

    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId="s1" />, store);

    const input = screen.getByTestId('keyword-research-input');
    await user.type(input, 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));

    await screen.findByTestId('keyword-research-table');
    expect(screen.getByTestId('keyword-research-row-seo-audit-tool')).toHaveTextContent(
      'seo audit tool',
    );

    // Track lives inside the per-row ⋯ menu.
    await user.click(screen.getByTestId('keyword-research-row-menu-seo-audit-tool'));
    await user.click(await screen.findByTestId('keyword-research-track-seo-audit-tool'));
    await waitFor(() => expect(mockedRanks.createKeywordRequest).toHaveBeenCalled());
  });

  it('renders the recent-research error alert when the mount history read fails', async () => {
    const store = makeStore();
    mocked.fetchHistoryRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    withProviders(<KeywordResearchPage />, store);
    await screen.findByTestId('keyword-research-recent-error');
  });

  it('renders the metrics error alert when a search fails', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'foo{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-error');
  });

  it('shows loading skeleton while a query is in flight', async () => {
    const store = makeStore();
    let resolve: (v: { keywords: KeywordMetric[] }) => void = () => undefined;
    mocked.fetchMetricsRequest.mockImplementationOnce(
      () =>
        new Promise<{ keywords: KeywordMetric[] }>((r) => {
          resolve = r;
        }),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'foo{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-loading');
    resolve({ keywords: [metric()] });
    await screen.findByTestId('keyword-research-table');
  });

  it('empty-results state renders when server returns no keywords', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'foo{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-empty');
  });

  it('expands related keywords on toggle', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mocked.fetchRelatedRequest.mockResolvedValueOnce({
      keyword: 'seo audit tool',
      related: [relatedRow()],
      cached: false,
    });

    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    const toggle = screen.getByRole('button', { name: /show related/i });
    await user.click(toggle);
    await screen.findByTestId('keyword-research-related');
    expect(screen.getByText('free seo audit tool')).toBeInTheDocument();
    // collapsing works too
    await user.click(toggle);
    await waitFor(() =>
      expect(screen.queryByTestId('keyword-research-related')).not.toBeInTheDocument(),
    );
  });

  it('removes a chip when clicked', async () => {
    const store = makeStore();
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    const input = screen.getByTestId('keyword-research-input');
    await user.type(input, 'chip-to-remove{enter}');
    const chip = await screen.findByRole('button', { name: 'Remove chip-to-remove' });
    await user.click(chip);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove chip-to-remove' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('re-expanding a keyword uses cached related keywords (no refetch)', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mocked.fetchRelatedRequest.mockResolvedValueOnce({
      keyword: 'seo audit tool',
      related: [relatedRow()],
      cached: false,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    const toggle = screen.getByRole('button', { name: /show related/i });
    await user.click(toggle); // fetches
    await screen.findByTestId('keyword-research-related');
    await user.click(toggle); // collapses
    await waitFor(() =>
      expect(screen.queryByTestId('keyword-research-related')).not.toBeInTheDocument(),
    );
    await user.click(toggle); // reopens WITHOUT fetching (cached branch)
    await screen.findByTestId('keyword-research-related');
    expect(mocked.fetchRelatedRequest).toHaveBeenCalledTimes(1);
  });

  it('shows a track-error alert when add-to-tracking fails', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mockedRanks.createKeywordRequest.mockRejectedValueOnce(new ApiError('x', 409, {}));
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId="s1" />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    await user.click(screen.getByTestId('keyword-research-row-menu-seo-audit-tool'));
    await user.click(await screen.findByTestId('keyword-research-track-seo-audit-tool'));
    await screen.findByTestId('keyword-research-track-error');
  });

  it('row menu without siteId shows copy + ideas but no track item', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    // Open the row menu: copy + ideas render everywhere, track needs a site.
    await user.click(screen.getByTestId('keyword-research-row-menu-seo-audit-tool'));
    await screen.findByTestId('keyword-research-copy-seo-audit-tool');
    expect(screen.getByTestId('keyword-research-ideas-seo-audit-tool')).toBeInTheDocument();
    expect(screen.queryByTestId('keyword-research-track-seo-audit-tool')).not.toBeInTheDocument();
  });

  it('chips: duplicate input is dropped; empty is ignored; hitting the cap is a no-op', async () => {
    const store = makeStore();
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    const input = screen.getByTestId('keyword-research-input');
    await user.type(input, 'a{enter}');
    await user.type(input, 'a{enter}'); // duplicate
    await user.type(input, '{enter}'); // empty
    expect(screen.getByRole('button', { name: 'Remove a' })).toBeInTheDocument();
  });

  it('routes.tsx exports matchers for the three keyword-research routes', () => {
    const paths = keywordResearchRoutes.map((r) => r.path);
    expect(paths).toContain('keyword-research');
    expect(paths).toContain('keyword-research/history');
    // Standalone Starter surface for Live Keyword Trends.
    expect(paths).toContain('keyword-research/live-trends');
  });

  it('shows related-error alert when related fetch fails', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mocked.fetchRelatedRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    await user.click(screen.getByRole('button', { name: /show related/i }));
    await screen.findByText(/could not load related/i);
  });

  it('shows related-empty message when server returned no related rows', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mocked.fetchRelatedRequest.mockResolvedValueOnce({
      keyword: 'seo audit tool',
      related: [],
      cached: false,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    await user.click(screen.getByRole('button', { name: /show related/i }));
    await screen.findByText(/no related keywords/i);
  });

  it('renders the hard difficulty band for a high-difficulty row', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric({ difficulty: 85 })] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    expect(screen.getByTitle('85')).toBeInTheDocument();
  });

  it('renders "unknown" for null-metric rows', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({
      keywords: [metric({ searchVolume: null, cpc: null, difficulty: null, monthlySearches: [] })],
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it('changes location + language via the selects and forwards them', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo{enter}');
    await user.click(screen.getByLabelText(/Location/i));
    await user.click(await screen.findByRole('option', { name: /Germany/ }));
    const languageSel = screen.getByLabelText(/Language/i) as HTMLSelectElement;
    await user.selectOptions(languageSel, 'de');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await waitFor(() =>
      expect(mocked.fetchMetricsRequest).toHaveBeenCalledWith(
        expect.objectContaining({ locationCode: 2276, languageCode: 'de' }),
      ),
    );
  });
});

const historyItem = (overrides: Partial<ResearchHistoryItem> = {}): ResearchHistoryItem => ({
  id: 'h1',
  kind: 'metrics',
  phrases: ['rank tracker'],
  locationCode: 2840,
  languageCode: 'en',
  resultCount: 3,
  cached: false,
  createdAt: '2026-07-10T00:00:00.000Z',
  ...overrides,
});

describe('KeywordResearchPage — mount history read', () => {
  it('loads recent research history on mount, with no metered metrics probe', async () => {
    withProviders(<KeywordResearchPage />);
    await waitFor(() => expect(mocked.fetchHistoryRequest).toHaveBeenCalled());
    // Opening the tab spends no keyword lookup.
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
    expect(mockedRanks.fetchKeywordsRequest).not.toHaveBeenCalled();
  });

  it('passes siteId through to the panel so the track action renders (site-workspace embed)', async () => {
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await user.click(await screen.findByTestId('keyword-research-row-menu-seo-audit-tool'));
    await screen.findByTestId('keyword-research-track-seo-audit-tool');
    expect(mockedRanks.fetchKeywordsRequest).toHaveBeenCalledWith(
      's1',
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('KeywordResearchPanel — tracked keyword suggestions', () => {
  it('dedupes device variants, adds and removes a suggestion without running research', async () => {
    mockedRanks.fetchKeywordsRequest.mockResolvedValueOnce(
      trackedKeywordPage([
        trackedKeyword({ phrase: ' SEO   Audit Tool ' }),
        trackedKeyword({ id: 'tracked-2', phrase: 'seo audit tool', device: 'mobile' }),
      ]),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);

    const suggestion = await screen.findByRole('button', { name: 'Add SEO Audit Tool' });
    expect(screen.getAllByTestId('keyword-research-tracked-seo-audit-tool')).toHaveLength(1);
    await user.click(suggestion);

    const chip = await screen.findByRole('button', { name: 'Remove SEO Audit Tool' });
    expect(screen.getByText('1 of 50 selected')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-research-tracked-all-selected')).toBeInTheDocument();
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
    expect(mocked.fetchIntentRequest).not.toHaveBeenCalled();

    await user.click(chip);
    expect(await screen.findByRole('button', { name: 'Add SEO Audit Tool' })).toBeInTheDocument();
  });

  it('adds all matching tracked keywords without auto-submitting', async () => {
    mockedRanks.fetchKeywordsRequest.mockResolvedValueOnce(
      trackedKeywordPage([
        trackedKeyword({ phrase: 'seo audit tool' }),
        trackedKeyword({ id: 'tracked-2', phrase: 'rank tracker' }),
      ]),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);

    await user.click(await screen.findByTestId('keyword-research-tracked-add-all'));
    expect(screen.getByRole('button', { name: 'Remove seo audit tool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove rank tracker' })).toBeInTheDocument();
    expect(screen.getByText('2 of 50 selected')).toBeInTheDocument();
    expect(await screen.findByTestId('keyword-research-tracked-all-selected')).toBeInTheDocument();
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
    expect(mocked.fetchIntentRequest).not.toHaveBeenCalled();
  });

  it('explains a market mismatch and updates suggestions when the filters change', async () => {
    mockedRanks.fetchKeywordsRequest.mockResolvedValueOnce(
      trackedKeywordPage([
        trackedKeyword({ phrase: 'seo werkzeug', locationCode: 2276, languageCode: 'de' }),
      ]),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);

    await screen.findByTestId('keyword-research-tracked-no-match');
    await user.click(screen.getByLabelText(/Location/i));
    await user.click(await screen.findByRole('option', { name: /Germany/ }));
    await user.selectOptions(screen.getByLabelText(/Language/i), 'de');
    expect(await screen.findByRole('button', { name: 'Add seo werkzeug' })).toBeInTheDocument();
  });

  it('shows loading and empty states for the tracked-keyword read', async () => {
    let resolve: (page: KeywordListPage) => void = () => undefined;
    mockedRanks.fetchKeywordsRequest.mockImplementationOnce(
      () =>
        new Promise((fulfil) => {
          resolve = fulfil;
        }),
    );
    withProviders(<KeywordResearchPage siteId="s1" />);

    await screen.findByTestId('keyword-research-tracked-loading');
    resolve(trackedKeywordPage());
    expect(await screen.findByTestId('keyword-research-tracked-empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to tracked keywords' })).toHaveAttribute(
      'href',
      '/sites/s1?tab=keywords',
    );
  });

  it('does not expose cached suggestions while refreshing the initial page', async () => {
    const store = makeStore();
    mockedRanks.fetchKeywordsRequest.mockResolvedValueOnce(
      trackedKeywordPage([trackedKeyword({ phrase: 'cached page keyword' })]),
    );
    await store.dispatch(ranksFeature.loadKeywords({ siteId: 's1', direction: 'initial' }));

    let resolve: (page: KeywordListPage) => void = () => undefined;
    mockedRanks.fetchKeywordsRequest.mockImplementationOnce(
      () =>
        new Promise((fulfil) => {
          resolve = fulfil;
        }),
    );
    withProviders(<KeywordResearchPage siteId="s1" />, store);

    await screen.findByTestId('keyword-research-tracked-loading');
    expect(
      screen.queryByRole('button', { name: 'Add cached page keyword' }),
    ).not.toBeInTheDocument();
    resolve(trackedKeywordPage());
    expect(await screen.findByTestId('keyword-research-tracked-empty')).toBeInTheDocument();
  });

  it('retries a failed tracked-keyword read', async () => {
    mockedRanks.fetchKeywordsRequest
      .mockRejectedValueOnce(new ApiError('x', 503, {}))
      .mockResolvedValueOnce(trackedKeywordPage());
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('keyword-research-tracked-empty')).toBeInTheDocument();
    expect(mockedRanks.fetchKeywordsRequest).toHaveBeenCalledTimes(2);
  });

  it('shows the selection limit instead of suggestion controls at fifty chips', async () => {
    mockedRanks.fetchKeywordsRequest.mockResolvedValueOnce(
      trackedKeywordPage([trackedKeyword({ phrase: 'overflow tracked keyword' })]),
    );
    const query = Array.from({ length: MAX_KEYWORDS }, (_, index) => `kw${index}`).join(',');
    withProvidersAt([`/sites/s1?tab=research&q=${query}`], <KeywordResearchPage siteId="s1" />);

    expect(await screen.findByTestId('keyword-research-tracked-limit')).toBeInTheDocument();
    expect(screen.queryByTestId('keyword-research-tracked-add-all')).not.toBeInTheDocument();
  });
});

describe('KeywordResearchPanel — recent research', () => {
  it('shows a loading skeleton while the mount history read is in flight, then the empty line', async () => {
    let resolve: (v: { items: ResearchHistoryItem[]; nextCursor: string | null }) => void = () =>
      undefined;
    mocked.fetchHistoryRequest.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    withProviders(<KeywordResearchPage siteId="s1" />);
    await screen.findByTestId('keyword-research-recent-loading');
    resolve({ items: [], nextCursor: null });
    await screen.findByTestId('keyword-research-recent-empty');
  });

  it('renders the recent lookups with both cached and live source chips', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem({ id: 'h1', phrases: ['rank tracker'], cached: false }),
        historyItem({ id: 'h2', kind: 'ideas', phrases: ['backlinks'], cached: true }),
      ],
      nextCursor: null,
    });
    withProviders(<KeywordResearchPage siteId="s1" />);
    await screen.findByTestId('keyword-research-recent-table');
    expect(screen.getByTestId('keyword-research-recent-row-h1')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-research-recent-row-h2')).toBeInTheDocument();
  });

  it('"Search again" re-runs the lookup IN PLACE (no navigation) and fills the metrics table', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem({
          id: 'h1',
          phrases: ['rank tracker'],
          locationCode: 2276,
          languageCode: 'de',
        }),
      ],
      nextCursor: null,
    });
    mocked.fetchMetricsRequest.mockResolvedValueOnce({
      keywords: [metric({ keyword: 'rank tracker' })],
    });
    let currentPath = '';
    const LocationSpy = () => {
      currentPath = useLocation().pathname;
      return null;
    };
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/s1']}>
            <KeywordResearchPage siteId="s1" />
            <LocationSpy />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('keyword-research-recent-table');
    await user.click(screen.getByTestId('keyword-research-recent-search-again-h1'));
    await waitFor(() =>
      expect(mocked.fetchMetricsRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          keywords: ['rank tracker'],
          locationCode: 2276,
          languageCode: 'de',
        }),
      ),
    );
    expect(mocked.fetchIntentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: ['rank tracker'],
        locationCode: 2276,
        languageCode: 'de',
      }),
    );
    // In place: the standalone-page navigation to /keyword-research did NOT fire.
    expect(currentPath).toBe('/sites/s1');
    await screen.findByTestId('keyword-research-table');
  });

  it('"Search again" on a seedless long-tail entry spends nothing', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [historyItem({ id: 'h1', kind: 'long_tail', phrases: [] })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);
    await screen.findByTestId('keyword-research-recent-table');
    await user.click(screen.getByTestId('keyword-research-recent-search-again-h1'));
    expect(mocked.fetchLongTailRequest).not.toHaveBeenCalled();
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
  });

  it('"Search again" replays long-tail history through the long-tail operation', async () => {
    mocked.fetchHistoryRequest.mockResolvedValueOnce({
      items: [
        historyItem({
          id: 'h1',
          kind: 'long_tail',
          phrases: ['seo, audit'],
          locationCode: 2276,
          languageCode: 'de',
        }),
      ],
      nextCursor: null,
    });
    mocked.fetchLongTailRequest.mockResolvedValueOnce({
      seed: 'seo, audit',
      suggestions: [relatedRow()],
      cached: true,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPage siteId="s1" />);
    await screen.findByTestId('keyword-research-recent-table');
    await user.click(screen.getByTestId('keyword-research-recent-search-again-h1'));
    await screen.findByTestId('keyword-research-long-tail-list');
    expect(mocked.fetchLongTailRequest).toHaveBeenCalledWith({
      seed: 'seo, audit',
      locationCode: 2276,
      languageCode: 'de',
    });
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
  });
});

describe('KeywordResearchPanel — RTL utility sweep', () => {
  it('uses logical directional utilities only (RTL-safe)', async () => {
    withProviders(<KeywordResearchPanel siteId={null} />);
    const rawSrc = await import('./components/KeywordResearchPanel.tsx?raw');
    const src = rawSrc.default;
    expect(src).not.toMatch(/\btext-right\b|\btext-left\b/);
    expect(src).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
  });
});

const intentRow = (overrides: Record<string, unknown> = {}) => ({
  keyword: 'seo audit tool',
  intent: 'commercial' as SearchIntent,
  confidence: 0.8,
  cached: false,
  fetchedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-07-31T00:00:00.000Z',
  ...overrides,
});

describe('intent + ideas thunks/slice', () => {
  it('fetchIntent.fulfilled merges intent onto matching metrics rows', async () => {
    const store = makeStore();
    // metrics land first, then intent merges onto the row.
    store.dispatch({
      type: loadMetrics.fulfilled.type,
      payload: { keywords: [metric()] },
    });
    mocked.fetchIntentRequest.mockResolvedValueOnce({ intents: [intentRow()] });
    await store.dispatch(
      fetchIntent({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' }),
    );
    const row = store.getState().keywordResearch.metrics[0];
    expect(row?.intent).toBe('commercial');
    expect(row?.confidence).toBe(0.8);
  });

  it('intent that resolves BEFORE metrics still merges when metrics arrive', async () => {
    const store = makeStore();
    mocked.fetchIntentRequest.mockResolvedValueOnce({ intents: [intentRow()] });
    await store.dispatch(
      fetchIntent({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' }),
    );
    // metrics arrive afterwards — merge happens on loadMetrics.fulfilled.
    store.dispatch({
      type: loadMetrics.fulfilled.type,
      payload: { keywords: [metric()] },
    });
    expect(store.getState().keywordResearch.metrics[0]?.intent).toBe('commercial');
  });

  it('fetchIntent.rejected sets intentError', async () => {
    const store = makeStore();
    mocked.fetchIntentRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await store.dispatch(
      fetchIntent({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' }),
    );
    expect(store.getState().keywordResearch.intentError).toBeTruthy();
  });

  it('fetchIdeas.fulfilled appends ideas, dedupes, and records the seed', async () => {
    const store = makeStore();
    mocked.fetchIdeasRequest.mockResolvedValueOnce({
      seed: 'seo audit',
      ideas: [relatedRow(), relatedRow({ keyword: 'seo checker' })],
      cached: false,
    });
    await store.dispatch(fetchIdeas({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' }));
    // Second call returns an overlapping row — must NOT duplicate.
    mocked.fetchIdeasRequest.mockResolvedValueOnce({
      seed: 'seo audit',
      ideas: [relatedRow(), relatedRow({ keyword: 'seo grader' })],
      cached: true,
    });
    await store.dispatch(fetchIdeas({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' }));
    const { ideas, ideasSeed } = store.getState().keywordResearch;
    expect(ideasSeed).toBe('seo audit');
    expect(ideas.map((r) => r.keyword)).toEqual([
      'free seo audit tool',
      'seo checker',
      'seo grader',
    ]);
  });

  it('fetchIdeas.rejected sets ideasError', async () => {
    const store = makeStore();
    mocked.fetchIdeasRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await store.dispatch(fetchIdeas({ seed: 'seo', locationCode: 2840, languageCode: 'en' }));
    expect(store.getState().keywordResearch.ideasError).toBeTruthy();
  });

  it('fetchLongTail rejects with localized errors', async () => {
    const store = makeStore();
    mocked.fetchLongTailRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await store.dispatch(
      fetchLongTail({ seed: 'seo', locationCode: 2840, languageCode: 'en' }),
    );
    expect(store.getState().keywordResearch.longTail.error).toBeTruthy();
  });

  it('fetchLongTail rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: fetchLongTail.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        arg: { seed: 'seo', locationCode: 2840, languageCode: 'en' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    } as UnknownAction);
    expect(store.getState().keywordResearch.longTail.error).toBe('');
  });

  it('fetchIntent rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: fetchIntent.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        arg: { keywords: ['seo'], locationCode: 2840, languageCode: 'en' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    } as UnknownAction);
    expect(store.getState().keywordResearch.intentError).toBe('');
  });

  it('fetchIdeas rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: fetchIdeas.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        arg: { seed: 'seo', locationCode: 2840, languageCode: 'en' },
        requestId: 'r',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    } as UnknownAction);
    expect(store.getState().keywordResearch.ideasError).toBe('');
  });
});

describe('IntentBadge', () => {
  it('renders a distinct tinted chip + localized label for each of the four intents', () => {
    const cases: Array<[SearchIntent, RegExp]> = [
      ['informational', /Research/i],
      ['commercial', /Comparing options/i],
      ['transactional', /Ready to buy/i],
      ['navigational', /specific site/i],
    ];
    for (const [intent, label] of cases) {
      const { unmount } = withProviders(<IntentBadge intent={intent} />);
      expect(screen.getByTestId(`keyword-research-intent-${intent}`)).toHaveTextContent(label);
      unmount();
    }
  });

  it('renders nothing for a null or undefined intent (honest absence)', () => {
    const { container, rerender } = render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <IntentBadge intent={null} />
        </I18nextProvider>
      </Provider>,
    );
    expect(container.querySelector('[data-slot="status-chip"]')).toBeNull();
    rerender(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <IntentBadge intent={undefined} />
        </I18nextProvider>
      </Provider>,
    );
    expect(container.querySelector('[data-slot="status-chip"]')).toBeNull();
  });
});

describe('KeywordResearchPanel — intent column + ideas action', () => {
  it('shows an intent badge on the row after the /intent call resolves', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    mocked.fetchIntentRequest.mockResolvedValueOnce({ intents: [intentRow()] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    await screen.findByTestId('keyword-research-intent-commercial');
  });

  it('disables "Get ideas" until there is a seed', async () => {
    const store = makeStore();
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    expect(screen.getByTestId('keyword-research-get-ideas')).toBeDisabled();
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    expect(screen.getByTestId('keyword-research-get-ideas')).toBeEnabled();
  });

  it('fetches ideas from the seed and renders them in the shared candidate list', async () => {
    const store = makeStore();
    mocked.fetchIdeasRequest.mockResolvedValueOnce({
      seed: 'seo audit',
      ideas: [relatedRow()],
      cached: false,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    await user.click(screen.getByTestId('keyword-research-get-ideas'));
    await screen.findByTestId('keyword-research-ideas-list');
    expect(screen.getByText('free seo audit tool')).toBeInTheDocument();
  });

  it('shows a loading skeleton while ideas are in flight', async () => {
    const store = makeStore();
    let resolve: (v: { seed: string; ideas: RelatedKeyword[]; cached: boolean }) => void = () =>
      undefined;
    mocked.fetchIdeasRequest.mockImplementationOnce(
      () =>
        new Promise<{ seed: string; ideas: RelatedKeyword[]; cached: boolean }>((r) => {
          resolve = r;
        }),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    await user.click(screen.getByTestId('keyword-research-get-ideas'));
    await screen.findByTestId('keyword-research-ideas-loading');
    resolve({ seed: 'seo audit', ideas: [relatedRow()], cached: false });
    await screen.findByTestId('keyword-research-ideas-list');
  });

  it('shows an empty state when the seed returns no ideas', async () => {
    const store = makeStore();
    mocked.fetchIdeasRequest.mockResolvedValueOnce({ seed: 'seo audit', ideas: [], cached: false });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    await user.click(screen.getByTestId('keyword-research-get-ideas'));
    await screen.findByTestId('keyword-research-ideas-empty');
  });

  it('shows an error alert when the ideas fetch fails', async () => {
    const store = makeStore();
    mocked.fetchIdeasRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    await user.click(screen.getByTestId('keyword-research-get-ideas'));
    await screen.findByTestId('keyword-research-ideas-error');
  });

  it('uses the in-progress draft as the ideas seed when no chip is committed', async () => {
    const store = makeStore();
    mocked.fetchIdeasRequest.mockResolvedValueOnce({
      seed: 'draft seed',
      ideas: [],
      cached: false,
    });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    // Type WITHOUT pressing Enter → stays in the draft, not a chip.
    await user.type(screen.getByTestId('keyword-research-input'), 'draft seed');
    await user.click(screen.getByTestId('keyword-research-get-ideas'));
    await waitFor(() =>
      expect(mocked.fetchIdeasRequest).toHaveBeenCalledWith(
        expect.objectContaining({ seed: 'draft seed' }),
      ),
    );
  });

  it('finds long-tail suggestions separately and replaces prior seed results', async () => {
    const store = makeStore();
    mocked.fetchLongTailRequest
      .mockResolvedValueOnce({
        seed: 'seo audit',
        suggestions: [relatedRow({ keyword: 'seo audit for small business', searchVolume: 450 })],
        cached: false,
      })
      .mockResolvedValueOnce({
        seed: 'rank tracker',
        suggestions: [relatedRow({ keyword: 'rank tracker for local shops', difficulty: 20 })],
        cached: true,
      });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);

    expect(screen.getByTestId('keyword-research-find-long-tail')).toBeDisabled();
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    await user.click(screen.getByTestId('keyword-research-find-long-tail'));
    await screen.findByText('seo audit for small business');
    expect(screen.getByTestId('keyword-research-long-tail')).toHaveTextContent('Live');
    expect(screen.getByTestId('keyword-research-long-tail-list')).toHaveTextContent('450');

    await user.click(screen.getByRole('button', { name: 'Remove seo audit' }));
    await user.type(screen.getByTestId('keyword-research-input'), 'rank tracker{enter}');
    await user.click(screen.getByTestId('keyword-research-find-long-tail'));
    await screen.findByText('rank tracker for local shops');
    expect(screen.queryByText('seo audit for small business')).not.toBeInTheDocument();
    expect(screen.getByTestId('keyword-research-long-tail')).toHaveTextContent('Cached');
    expect(mocked.fetchLongTailRequest).toHaveBeenLastCalledWith({
      seed: 'rank tracker',
      locationCode: 2840,
      languageCode: 'en',
    });
  });

  it('shows long-tail loading, empty, and failure states', async () => {
    const store = makeStore();
    let resolve: (value: { seed: string; suggestions: RelatedKeyword[]; cached: boolean }) => void =
      () => undefined;
    mocked.fetchLongTailRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit{enter}');
    await user.click(screen.getByTestId('keyword-research-find-long-tail'));
    await screen.findByTestId('keyword-research-long-tail-loading');
    resolve({ seed: 'seo audit', suggestions: [], cached: false });
    await screen.findByTestId('keyword-research-long-tail-empty');

    mocked.fetchLongTailRequest.mockRejectedValueOnce(new ApiError('x', 503, {}));
    await user.click(screen.getByTestId('keyword-research-find-long-tail'));
    await screen.findByTestId('keyword-research-long-tail-error');
  });

  it('disables long-tail discovery for an overlong draft', async () => {
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />);
    await user.type(
      screen.getByTestId('keyword-research-input'),
      'x'.repeat(MAX_PHRASE_LENGTH + 1),
    );
    expect(screen.getByTestId('keyword-research-find-long-tail')).toBeDisabled();
  });
});

const withProvidersAt = (entries: string[], ui: React.ReactNode, store = makeStore()) =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={entries}>{ui}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

describe('KeywordResearchPanel — row actions menu', () => {
  const openRowMenu = async (
    user: ReturnType<typeof userEvent.setup>,
    siteId: string | null = null,
  ) => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    withProviders(<KeywordResearchPanel siteId={siteId} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    await user.click(screen.getByTestId('keyword-research-row-menu-seo-audit-tool'));
  };

  it('copy action writes the keyword to the clipboard and toasts success', async () => {
    const user = userEvent.setup();
    await openRowMenu(user);
    await user.click(await screen.findByTestId('keyword-research-copy-seo-audit-tool'));
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    // userEvent installs a working clipboard stub — verify the payload landed.
    await expect(navigator.clipboard.readText()).resolves.toBe('seo audit tool');
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('copy failure (clipboard rejects) toasts the localized error', async () => {
    const user = userEvent.setup();
    await openRowMenu(user);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(await screen.findByTestId('keyword-research-copy-seo-audit-tool'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it('ideas action dispatches fetchIdeas with the row keyword as seed', async () => {
    const user = userEvent.setup();
    await openRowMenu(user);
    await user.click(await screen.findByTestId('keyword-research-ideas-seo-audit-tool'));
    await waitFor(() =>
      expect(mocked.fetchIdeasRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          seed: 'seo audit tool',
          locationCode: 2840,
          languageCode: 'en',
        }),
      ),
    );
  });

  it('deep-links a keyword result into the site content analysis form', async () => {
    const user = userEvent.setup();
    await openRowMenu(user, 'site-1');
    expect(await screen.findByTestId('keyword-research-content-seo-audit-tool')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=content&view=analyses&prefillKeyword=seo+audit+tool&source=keyword',
    );
  });

  it('renders a history link pointing at /keyword-research/history', () => {
    withProviders(<KeywordResearchPanel siteId={null} />);
    const link = screen.getByTestId('keyword-research-history-link');
    expect(link).toHaveAttribute('href', '/keyword-research/history');
  });
});

describe('prefill (?q=&location=&lang=)', () => {
  it('prefills an exact comma-containing seed without running research', () => {
    withProvidersAt(
      ['/sites/site-1?tab=research&seed=seo%2C+audit&location=2826&lang=en'],
      <KeywordResearchPanel siteId="site-1" />,
    );
    expect(screen.getByRole('button', { name: 'Remove seo, audit' })).toBeInTheDocument();
    expect(mocked.fetchLongTailRequest).not.toHaveBeenCalled();
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
  });

  it('prefills chips + selects from the URL without auto-submitting', async () => {
    withProvidersAt(
      ['/keyword-research?q=alpha, beta,alpha&location=2826&lang=de'],
      <KeywordResearchPanel siteId={null} />,
    );
    expect(screen.getByRole('button', { name: 'Remove alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove beta' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Location/i)).toHaveTextContent('United Kingdom');
    expect((screen.getByLabelText(/Language/i) as HTMLSelectElement).value).toBe('de');
    // Prefill NEVER auto-runs — no quota spend on landing.
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
  });

  it('parsePrefillParams: defaults missing values and preserves provider-resolved values', () => {
    expect(parsePrefillParams(new URLSearchParams(''))).toEqual({
      chips: [],
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(parsePrefillParams(new URLSearchParams('q=&location=999&lang=xx'))).toEqual({
      chips: [],
      locationCode: 999,
      languageCode: 'xx',
    });
  });

  it('parsePrefillParams: trims, drops empties + overlong, dedupes, caps at MAX_KEYWORDS', () => {
    const long = 'x'.repeat(MAX_PHRASE_LENGTH + 1);
    const parsed = parsePrefillParams(
      new URLSearchParams(`q=${encodeURIComponent(` a , ,a,${long},b `)}`),
    );
    expect(parsed.chips).toEqual(['a', 'b']);
    const many = Array.from({ length: MAX_KEYWORDS + 5 }, (_, i) => `kw${i}`).join(',');
    expect(parsePrefillParams(new URLSearchParams(`q=${many}`)).chips).toHaveLength(MAX_KEYWORDS);
  });

  it('buildSearchAgainUrl tolerates a long-tail entry without a stored seed', () => {
    const url = buildSearchAgainUrl(historyItem({ kind: 'long_tail', phrases: [] }));
    expect(new URLSearchParams(url.split('?')[1]).get('seed')).toBe('');
  });

  it('buildSearchAgainUrl round-trips phrases, location and language', () => {
    const item: ResearchHistoryItem = {
      id: 'h1',
      kind: 'metrics',
      phrases: ['seo audit tool', 'rank tracker'],
      locationCode: 2826,
      languageCode: 'de',
      resultCount: 2,
      cached: true,
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const url = buildSearchAgainUrl(item);
    expect(url.startsWith('/keyword-research?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('q')).toBe('seo audit tool,rank tracker');
    expect(params.get('location')).toBe('2826');
    expect(params.get('lang')).toBe('de');
    // Feeding it back through the parser restores the exact form state.
    expect(parsePrefillParams(params)).toEqual({
      chips: ['seo audit tool', 'rank tracker'],
      locationCode: 2826,
      languageCode: 'de',
    });
  });
});

describe('KeywordResearchPanel — guard branches (BRDA)', () => {
  it('formatCpc returns "—" for non-finite strings — line 166 branch', () => {
    // Number('abc') = NaN, Number('Infinity') = Infinity — both non-finite.
    // Covers the !Number.isFinite(num) true branch that the server never emits.
    expect(formatCpc('abc')).toBe('—');
    expect(formatCpc('Infinity')).toBe('—');
  });

  it('commitChip is a no-op when chips.length >= MAX_KEYWORDS — line 243 branch', async () => {
    // Fill exactly MAX_KEYWORDS (50) chips via fast fireEvent, then attempt one more.
    // The true branch of `if (chips.length >= MAX_KEYWORDS) return;` fires on the 51st.
    withProviders(<KeywordResearchPanel siteId={null} />);
    const input = screen.getByTestId('keyword-research-input');
    for (let i = 0; i < MAX_KEYWORDS; i++) {
      fireEvent.change(input, { target: { value: `kw${i}` } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    }
    // Attempt to add a 51st chip — guard fires, chip is not added.
    fireEvent.change(input, { target: { value: 'overflow' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(MAX_KEYWORDS),
    );
    expect(screen.queryByText(/overflow/)).not.toBeInTheDocument();
  });

  it('handleSubmit returns early when chips is empty — line 255 branch', () => {
    // Submit button is disabled when no chips exist, but we can fire the submit
    // event directly on the form. chips.length === 0 → early return before dispatch.
    withProviders(<KeywordResearchPanel siteId={null} />);
    const form = screen.getByTestId('keyword-research-form');
    fireEvent.submit(form);
    expect(mocked.fetchMetricsRequest).not.toHaveBeenCalled();
  });

  it('handleGetIdeas returns early when ideaSeed is empty — line 267 branch', () => {
    // ideaSeed = draft.trim() || chips[0] || '' — initially empty → button disabled.
    // Fiber-walk to call the onClick handler directly, bypassing the disabled check.
    withProviders(<KeywordResearchPanel siteId={null} />);
    const btn = screen.getByTestId('keyword-research-get-ideas');
    // React 18 stores fiber under __reactFiber$<random> — find the key dynamically.
    const fiberKey = Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    let node: FiberNode | null | undefined = fiberKey
      ? (btn as unknown as Record<string, FiberNode>)[fiberKey]
      : undefined;
    let onClick: (() => void) | undefined;
    while (node) {
      if (typeof node.memoizedProps?.onClick === 'function') {
        onClick = node.memoizedProps.onClick as () => void;
        break;
      }
      node = node.return;
    }
    act(() => {
      onClick?.();
    });
    expect(mocked.fetchIdeasRequest).not.toHaveBeenCalled();
  });

  it('handleAddToTracking returns early when siteId is null — line 286 branch', async () => {
    // canAdd=false → no track buttons render. But onAdd is still passed to RowGroup.
    // Walk fiber from the row <tr> upward — RowGroup (2 levels up) carries the prop.
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');

    const rowEl = screen.getByTestId('keyword-research-row-seo-audit-tool');
    const fiberKey = Object.keys(rowEl).find((k) => k.startsWith('__reactFiber'));
    let node: FiberNode | null | undefined = fiberKey
      ? (rowEl as unknown as Record<string, FiberNode>)[fiberKey]
      : undefined;
    let onAdd: ((kw: string) => void) | undefined;
    while (node) {
      if (typeof node.memoizedProps?.onAdd === 'function') {
        onAdd = node.memoizedProps.onAdd as (kw: string) => void;
        break;
      }
      node = node.return;
    }
    expect(onAdd).toBeDefined();

    // siteId is null in the closure → !siteId true → returns before createKeywordRequest.
    await act(async () => {
      await onAdd?.('seo audit tool');
    });
    expect(mockedRanks.createKeywordRequest).not.toHaveBeenCalled();
  });

  it('resolveAddToTracking falls back to "error" when addKeyword payload is undefined — line 299 branch', async () => {
    // Spy on addKeyword to return a rejected action with payload=undefined (no rejectWithValue).
    // This exercises the `result.payload ?? 'error'` right branch.
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    const originalAddKeyword = ranksFeature.addKeyword;
    const spy = vi.spyOn(ranksFeature, 'addKeyword');
    // Preserve RTK static action-creator properties so addKeyword.rejected.match works.
    const spyStatics = spy as unknown as Record<string, unknown>;
    spyStatics.pending = originalAddKeyword.pending;
    spyStatics.fulfilled = originalAddKeyword.fulfilled;
    spyStatics.rejected = originalAddKeyword.rejected;
    spyStatics.typePrefix = originalAddKeyword.typePrefix;
    spy.mockImplementationOnce(((arg: Parameters<typeof originalAddKeyword>[0]) =>
      async (dispatch: (action: unknown) => unknown) => {
        // Rejected action with payload=undefined → hits the ?? 'error' right branch.
        const action = originalAddKeyword.rejected(new Error('test'), 'guard-test-req-id', arg);
        dispatch(action);
        return action;
      }) as unknown as typeof originalAddKeyword);

    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId="site-1" />);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    await screen.findByTestId('keyword-research-table');
    await user.click(screen.getByTestId('keyword-research-row-menu-seo-audit-tool'));
    await user.click(await screen.findByTestId('keyword-research-track-seo-audit-tool'));
    // resolveAddToTracking({ error: 'error' }) → track-error alert appears.
    await screen.findByTestId('keyword-research-track-error');

    spy.mockRestore();
  });
});

describe('KeywordResearchPanel — CTA + affordance polish', () => {
  it('submit button shows a busy spinner while the query is in flight, then restores', async () => {
    const store = makeStore();
    let resolve: (v: { keywords: KeywordMetric[] }) => void = () => undefined;
    mocked.fetchMetricsRequest.mockImplementationOnce(
      () =>
        new Promise<{ keywords: KeywordMetric[] }>((r) => {
          resolve = r;
        }),
    );
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'foo{enter}');
    const submit = screen.getByTestId('keyword-research-submit');
    await user.click(submit);
    // Pending: aria-busy set, shared spinner rendered in place, disabled (no double-submit).
    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    expect(submit.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(submit).toBeDisabled();
    // Resolve: busy state clears and the spinner is gone.
    resolve({ keywords: [metric()] });
    await screen.findByTestId('keyword-research-table');
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
    expect(submit.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it('empty state renders the Empty composition and its CTA focuses the seed input', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'foo{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    const empty = await screen.findByTestId('keyword-research-empty');
    // shadcn Empty composition — not a bare paragraph.
    expect(empty.querySelector('[data-slot="empty-title"]')).not.toBeNull();
    expect(empty.querySelector('[data-slot="empty-description"]')).not.toBeNull();
    // Focus starts off the input (it's on the submit button after the click).
    const input = screen.getByTestId('keyword-research-input');
    expect(input).not.toHaveFocus();
    await user.click(screen.getByTestId('keyword-research-empty-cta'));
    expect(input).toHaveFocus();
  });

  it('formats search volume with the active locale after changeLanguage(fr)', async () => {
    const store = makeStore();
    mocked.fetchMetricsRequest.mockResolvedValueOnce({ keywords: [metric()] });
    const user = userEvent.setup();
    withProviders(<KeywordResearchPanel siteId={null} />, store);
    await user.type(screen.getByTestId('keyword-research-input'), 'seo audit tool{enter}');
    await user.click(screen.getByTestId('keyword-research-submit'));
    const table = await screen.findByTestId('keyword-research-table');
    // en groups 5400 as "5,400".
    expect(table.textContent).toContain(new Intl.NumberFormat('en').format(5400));
    await act(async () => {
      await changeLanguage('fr');
    });
    // fr regroups the same value locale-aware (non-breaking space separator).
    expect(table.textContent).toContain(new Intl.NumberFormat('fr').format(5400));
  });
});

describe('KeywordResearchPanel — renders before the lazy slice materializes', () => {
  it('does not throw when `state.keywordResearch` is still undefined on first render', async () => {
    // The research tab (`/sites/:siteId?tab=research`) injects the
    // 'keywordResearch' reducer and renders the panel in the same tick, but RTK
    // only materializes the slice on the NEXT dispatched action — so the panel's
    // very first render sees no `state.keywordResearch` key. A bare store
    // reproduces that precondition; the selectors must fall back to initialState
    // rather than throw (an unguarded read here is what surfaced as the
    // route-level "Page not found" boundary on the research tab).
    const bareStore = configureStore({
      reducer: {
        ranks: ranksReducer,
        unrelated: (s: Record<string, never> = {}) => s,
      },
    });
    withProviders(<KeywordResearchPanel siteId="s1" />, bareStore as never);
    expect(await screen.findByTestId('keyword-research-panel')).toBeInTheDocument();
  });
});
