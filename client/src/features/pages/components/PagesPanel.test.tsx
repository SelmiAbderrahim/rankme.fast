import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { PagesClientError } from '../error';
import { pagesReducer } from '../store/slice';
import { loadPagesList } from '../store/thunks';
import type {
  PagesCacheEntry,
  PageMetrics,
  PageRow,
  PagesDetailResponse,
  PagesEnvelope,
  PagesListResponse,
  PagesRefreshResponse,
  PagesRequestError,
  PagesSource,
  PagesStatus,
  TrendPoint,
} from '../types';
import { fetchPagesDetail, fetchPagesList, requestPagesRefresh } from '../api';
import { PageDetailSheet } from './PageDetailSheet';
import { PagesPanel } from './PagesPanel';

vi.mock('../api', () => ({
  fetchPagesList: vi.fn(),
  fetchPagesDetail: vi.fn(),
  requestPagesRefresh: vi.fn(),
}));

const mockedList = vi.mocked(fetchPagesList);
const mockedDetail = vi.mocked(fetchPagesDetail);
const mockedRefresh = vi.mocked(requestPagesRefresh);
const PAGE_ID = 'a'.repeat(43);
const PAGE_ID_B = 'b'.repeat(43);

const metrics = (patch: Partial<PageMetrics> = {}): PageMetrics => ({
  clicks: 0,
  impressions: 120,
  ctr: 0,
  averagePosition: 7.4,
  bestPosition: null,
  keywordCount: null,
  searchVolume: null,
  difficulty: null,
  estimatedTraffic: null,
  associatedQueryCount: 2,
  ...patch,
});

const envelope = (
  source: PagesSource = 'gsc',
  status: PagesStatus = 'ready',
): PagesEnvelope => ({
  source,
  status,
  fallbackReason: source === 'gsc' ? null : 'gsc_not_connected',
  observedAt: '2026-08-09T12:00:00.000Z',
  staleAt: status === 'stale' ? '2026-08-10T12:00:00.000Z' : null,
  range: '28d',
  rangeSemantics: source === 'gsc' ? 'rolling_window' : 'point_in_time',
  comparison: { label: 'since_previous_sync', previousObservedAt: '2026-08-01T12:00:00.000Z' },
  market: source === 'gsc' || source === 'none'
    ? null
    : { locationCode: 2840, languageCode: 'en', selection: 'default' },
  coverage: {
    reportingLagDays: source === 'gsc' ? 3 : null,
    sampled: source === 'gsc' ? false : null,
    sourceRowsFetched: 3,
    sourceRowsAccepted: 2,
    sourceRowsDropped: 1,
    dropped: { malformedUrl: 1, offsiteUrl: 0, duplicateUrl: 0, invalidMetric: 0 },
    sourceLimit: 100,
    sourceTruncated: false,
    auditRowsFetched: 2,
    auditRowsAccepted: 2,
    auditRowsDropped: 0,
    auditTruncated: false,
    inventoryPages: 2,
    measuredPages: source === 'none' ? 0 : 1,
    unmeasuredPages: 1,
  },
});

const page = (patch: Partial<PageRow> = {}): PageRow => ({
  pageId: PAGE_ID,
  url: 'https://example.com/a?x=1',
  displayUrl: 'example.com/a?x=1',
  title: 'Example page',
  performanceSource: 'gsc',
  isIndexable: true,
  nonIndexableReason: null,
  onPageScore: 88,
  metrics: metrics(),
  deltas: { positionChange: 3.2, clickChangePct: 0.25 },
  insights: ['striking_distance', 'winning'],
  ...patch,
});

const listResponse = (
  source: PagesSource = 'gsc',
  status: PagesStatus = 'ready',
  rows: PageRow[] = [page()],
): PagesListResponse => {
  const fallback = source === 'dataforseo' || source === 'demo';
  const summary = fallback
    ? metrics({
      clicks: null,
      impressions: null,
      ctr: null,
      averagePosition: 5.2,
      bestPosition: 2,
      keywordCount: 12,
      searchVolume: 900,
      difficulty: 31,
      estimatedTraffic: 44.5,
    })
    : metrics();
  return {
    envelope: envelope(source, status),
    summary,
    items: rows,
    pageInfo: {
      limit: 25,
      hasNext: true,
      nextCursor: 'next-cursor',
      totalFiltered: rows.length,
      totalInventory: 2,
      totalMeasured: source === 'none' ? 0 : 1,
    },
  };
};

const fallbackPage = (): PageRow => page({
  performanceSource: 'dataforseo',
  isIndexable: false,
  nonIndexableReason: 'noindex',
  metrics: metrics({
    clicks: null,
    impressions: null,
    ctr: null,
    averagePosition: 5.2,
    bestPosition: 2,
    keywordCount: 12,
    searchVolume: 900,
    difficulty: 31,
    estimatedTraffic: 44.5,
  }),
  insights: ['non_indexable_visibility'],
});

const trendPoint = (observedAt = '2026-08-01T12:00:00.000Z'): TrendPoint => ({
  observedAt,
  source: 'gsc',
  range: '28d',
  market: null,
  metrics: metrics(),
});

const detailResponse = (): PagesDetailResponse => ({
  envelope: envelope(),
  page: page(),
  associated: {
    kind: 'queries',
    rows: [{
      query: 'example query',
      position: 7.4,
      clicks: 0,
      impressions: 100,
      ctr: 0,
      searchVolume: null,
      difficulty: null,
      estimatedTraffic: null,
    }],
    total: 101,
    truncated: true,
  },
  trend: [trendPoint(), trendPoint('2026-08-09T12:00:00.000Z')],
});

let currentSearch = '';
const LocationProbe = () => {
  currentSearch = useLocation().search;
  return null;
};

const renderPanel = (path = '/sites/site-1?tab=pages') => {
  const store = configureStore({ reducer: { pages: pagesReducer } });
  const result = render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/sites/:siteId" element={<PagesPanel siteId="site-1" />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return { store, ...result };
};

const detailEntry = (
  data: PagesDetailResponse | null,
  error: PagesRequestError | null = null,
): PagesCacheEntry<PagesDetailResponse> => ({
  data,
  loading: false,
  loaded: data !== null,
  invalidated: false,
  error,
  requestId: null,
});

const renderDetailSheet = (
  entry: PagesCacheEntry<PagesDetailResponse>,
  loadState: 'initial_loading' | 'background_loading' | 'ready' | 'error',
) => {
  const onOpenChange = vi.fn();
  const onRetry = vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <PageDetailSheet
        entry={entry}
        loadState={loadState}
        open
        onOpenChange={onOpenChange}
        onRetry={onRetry}
        returnFocusRef={createRef<HTMLButtonElement>()}
      />
    </I18nextProvider>,
  );
  return { ...result, onOpenChange, onRetry };
};

const requestError = (patch: Partial<PagesRequestError> = {}): PagesRequestError => ({
  kind: 'unavailable',
  status: 503,
  code: 'PAGES_PROVIDER_UNAVAILABLE',
  message: 'Localized provider failure',
  details: null,
  retryAfterMs: null,
  state: null,
  ...patch,
});

beforeEach(async () => {
  mockedList.mockReset();
  mockedDetail.mockReset();
  mockedRefresh.mockReset();
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  await i18n.loadNamespaces('pages');
  currentSearch = '';
});

describe('PagesPanel source-aware list and detail', () => {
  it('renders observed zero values, semantic desktop/mobile representations, safe links, and detail history', async () => {
    mockedList.mockResolvedValue(listResponse());
    mockedDetail.mockResolvedValue(detailResponse());
    renderPanel();

    expect(await screen.findByText('Google Search Console')).toBeVisible();
    expect(screen.getByText('Observed clicks, impressions, CTR, and average position from the selected rolling window.')).toBeVisible();
    expect(screen.getByTestId('pages-desktop-table')).toBeInTheDocument();
    expect(screen.getByTestId('pages-mobile-cards')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: /example\.com\/a/i });
    expect(links[0]).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('columnheader', { name: /Page/ })).toHaveAttribute('aria-sort', 'none');

    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Inspect page' })[0]!);
    expect(await screen.findByTestId('pages-detail-sheet')).toBeInTheDocument();
    expect(await screen.findByText('example query')).toBeVisible();
    expect(screen.getByText(/capped at 100 rows/)).toBeVisible();
    expect(screen.getByTestId('pages-trend')).toBeInTheDocument();
    expect(screen.getByTestId('pages-trend-table')).toHaveTextContent('Average position');
    expect(currentSearch).toContain(`pageId=${PAGE_ID}`);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close page detail' }));
    await waitFor(() => expect(currentSearch).not.toContain('pageId='));
  });

  it.each(['dataforseo', 'demo'] as const)(
    'labels %s ranking data as estimates and keeps observed metrics unavailable',
    async (source) => {
      const fallback = fallbackPage();
      if (source === 'demo') fallback.performanceSource = 'demo';
      mockedList.mockResolvedValue(listResponse(source, 'ready', [fallback]));
      renderPanel();
      expect(await screen.findByText(source === 'demo' ? 'Demo ranking snapshot' : 'Fallback ranking snapshot')).toBeVisible();
      expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(3);
      expect(screen.getAllByText(source === 'demo' ? 'Demo estimate' : 'Ranking estimate').length).toBeGreaterThan(0);
      expect(screen.getByText(/Point-in-time ranking snapshot/)).toBeVisible();
      expect(screen.getByText(source === 'demo'
        ? /not Google Search Console data or live DataForSEO data/
        : /Clicks, impressions, and CTR are not available/)).toBeVisible();
    },
  );

  it('renders audit-only pages as unmeasured and preserves null rather than zero', async () => {
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', [page({
      pageId: PAGE_ID_B,
      performanceSource: null,
      title: null,
      isIndexable: null,
      metrics: metrics({ clicks: null, impressions: null, ctr: null, averagePosition: null }),
      deltas: { positionChange: null, clickChangePct: null },
      insights: [],
    })]));
    renderPanel();
    expect((await screen.findAllByText('Unmeasured')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Untitled page').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Crawl state unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No current opportunity flag').length).toBeGreaterThan(0);
  });

  it('retries a failed detail request and closes a missing detail without losing list context', async () => {
    mockedList.mockResolvedValue(listResponse());
    mockedDetail
      .mockRejectedValueOnce(new PagesClientError(requestError({ kind: 'network', status: null, message: '' })))
      .mockResolvedValueOnce(detailResponse());
    renderPanel(`/sites/site-1?tab=pages&keep=1&pageId=${PAGE_ID}`);
    expect(await screen.findByText('Page detail could not be loaded')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('example query')).toBeVisible();
    expect(currentSearch).toContain('keep=1');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close page detail' }));
    mockedDetail.mockRejectedValueOnce(new PagesClientError(requestError({
      kind: 'not_found',
      status: 404,
      code: 'PAGES_NOT_FOUND',
    })));
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Inspect page' })[0]!);
    await waitFor(() => expect(currentSearch).not.toContain('pageId='));
    expect(currentSearch).toContain('keep=1');
  });

  it('discloses unknown observation/comparison dates and sampled coverage', async () => {
    const response = listResponse();
    response.envelope.observedAt = null;
    response.envelope.comparison.previousObservedAt = null;
    response.envelope.coverage.sampled = true;
    response.envelope.coverage.reportingLagDays = null;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByText('Google Search Console');
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.getByText(/No eligible previous sync/)).toBeVisible();
    expect(screen.getByText('The source reports sampled data.')).toBeVisible();
    expect(screen.getByText('This source has no Search Console reporting-lag claim.')).toBeVisible();
  });

  it('uses the unknown-language label for an unrecognized fallback market', async () => {
    const response = listResponse('dataforseo');
    response.envelope.market!.languageCode = '';
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByText(/Unknown language/)).toBeVisible();
  });
});

describe('PageDetailSheet state and source variants', () => {
  it('renders its skeleton and fallback heading before detail arrives', () => {
    renderDetailSheet(detailEntry(null), 'initial_loading');
    expect(screen.getByTestId('pages-detail-skeleton')).toBeVisible();
    expect(screen.getByText('Page detail')).toBeVisible();
  });

  it.each(['', 'Detail request failed'])(
    'renders a retryable detail error with message %s',
    async (message) => {
      const error = requestError({ message });
      const { onRetry } = renderDetailSheet(detailEntry(null, error), 'error');
      expect(screen.getByText(message || 'The request did not complete. Check the connection and try again.')).toBeVisible();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it('renders retained unmeasured keyword detail, crawl reason, empty opportunities and empty trend', () => {
    const detail = detailResponse();
    detail.page = page({
      title: null,
      performanceSource: null,
      isIndexable: false,
      nonIndexableReason: 'noindex',
      insights: [],
      metrics: metrics({
        clicks: null,
        impressions: null,
        ctr: null,
        averagePosition: null,
        keywordCount: 8,
        searchVolume: 20,
        estimatedTraffic: 1.5,
      }),
    });
    detail.associated = { kind: 'keywords', rows: [], total: 0, truncated: false };
    detail.trend = [];
    renderDetailSheet(detailEntry(detail), 'background_loading');
    expect(screen.getByText('Updating this view while keeping the previous data visible.')).toBeVisible();
    expect(screen.getByText('Unmeasured')).toBeVisible();
    expect(screen.getByText('Not crawl-indexable')).toBeVisible();
    expect(screen.getByText(/noindex/)).toBeVisible();
    expect(screen.getByText('No current opportunity rule applies to this page.')).toBeVisible();
    expect(screen.getAllByText('Ranking keywords').length).toBeGreaterThan(0);
    expect(screen.getByText('No associated query or keyword rows are stored for this page.')).toBeVisible();
    expect(screen.getByText('No comparable average-position history is stored yet.')).toBeVisible();
  });

  it('renders unknown crawl state and null query cells while filtering invalid trend points', () => {
    const detail = detailResponse();
    detail.page = page({ isIndexable: null, nonIndexableReason: null });
    detail.associated.truncated = false;
    detail.associated.rows[0] = {
      query: 'nullable query',
      position: null,
      clicks: null,
      impressions: null,
      ctr: null,
      searchVolume: 10,
      difficulty: 20,
      estimatedTraffic: 3,
    };
    detail.trend = [
      trendPoint('not-a-date'),
      { ...trendPoint('2026-08-02T12:00:00.000Z'), metrics: metrics({ averagePosition: null }) },
      { ...trendPoint('2026-08-03T12:00:00.000Z'), metrics: metrics({ clicks: null, estimatedTraffic: 2 }) },
    ];
    renderDetailSheet(detailEntry(detail), 'ready');
    expect(screen.getByText('Crawl state unknown')).toBeVisible();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(4);
    expect(screen.getByTestId('pages-trend-table')).toHaveTextContent('2');
  });
});

describe('PagesPanel status, controls, pagination, and refresh', () => {
  it.each([
    ['gsc', 'syncing', 'Search Console is syncing'],
    ['gsc', 'empty', 'No matching pages'],
    ['gsc', 'stale', 'Showing the last good data'],
    ['gsc', 'unavailable', 'Page data is unavailable'],
    ['dataforseo', 'empty', 'No matching pages'],
    ['dataforseo', 'stale', 'Showing the last good data'],
    ['none', 'empty', 'No matching pages'],
    ['none', 'unavailable', 'Page data is unavailable'],
  ] as const)('renders %s/%s state guidance', async (source, status, title) => {
    mockedList.mockResolvedValue(listResponse(source, status, []));
    renderPanel();
    expect(await screen.findByText(title)).toBeVisible();
    if (source === 'none') {
      expect(screen.getByRole('link', { name: 'Connect Google' })).toHaveAttribute(
        'href',
        '/sites/site-1?tab=google',
      );
    }
  });

  it.each([
    ['gsc_property_unmatched', 'Select property'],
    ['gsc_needs_reconnect', 'Reconnect Google'],
    ['gsc_revoked', 'Reconnect Google'],
  ] as const)('offers the existing Google flow for %s', async (fallbackReason, label) => {
    const response = listResponse('dataforseo', 'unavailable', []);
    response.envelope.fallbackReason = fallbackReason;
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByRole('link', { name: label })).toHaveAttribute(
      'href',
      '/sites/site-1?tab=google',
    );
  });

  it('does not offer a fallback collection during a provider sync', async () => {
    const response = listResponse('dataforseo', 'syncing', []);
    response.envelope.fallbackReason = null;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByText('Search Console is syncing');
    expect(screen.queryByRole('button', { name: 'Collect fallback data' })).not.toBeInTheDocument();
  });

  it('shows structure-preserving initial loading and then a background loading announcement', async () => {
    let resolveList: ((value: PagesListResponse) => void) | undefined;
    mockedList.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    renderPanel();
    expect(screen.getByTestId('pages-initial-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('table', { name: 'Pages performance and crawl-indexability results' }),
    ).toBeInTheDocument();
    resolveList?.(listResponse());
    expect(await screen.findByText('Google Search Console')).toBeVisible();
  });

  it('debounces search into URL state, resets durable filters, sorts, and paginates', async () => {
    mockedList.mockResolvedValue(listResponse());
    renderPanel('/sites/site-1?tab=pages&keep=1&insight=winning&visibility=measured');
    const search = await screen.findByLabelText('Search pages and queries');
    await userEvent.setup().type(search, 'guide');
    await waitFor(() => expect(currentSearch).toContain('q=guide'), { timeout: 2000 });
    expect(currentSearch).toContain('keep=1');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(currentSearch).not.toContain('insight='));
    expect(currentSearch).not.toContain('visibility=');
    expect(currentSearch).toContain('keep=1');

    await userEvent.setup().click(screen.getAllByRole('button', { name: /Clicks/ })[0]!);
    await waitFor(() => expect(currentSearch).toContain('sort=clicks'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentSearch).toContain('cursor=next-cursor'));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(currentSearch).not.toContain('cursor='));
  });

  it('writes every range and filter control to the URL and toggles active sort direction', async () => {
    mockedList.mockResolvedValue(listResponse());
    mockedDetail.mockResolvedValue(detailResponse());
    renderPanel('/sites/site-1?tab=pages&q=guide&indexability=indexable&sort=url&direction=asc&cursor=older');
    const user = userEvent.setup();
    await screen.findByText('Google Search Console');
    expect(screen.getByText(/Search: guide/)).toBeVisible();
    expect(screen.getAllByText(/Crawl-indexable/).length).toBeGreaterThan(0);

    const choose = async (label: string, option: string) => {
      await user.click(screen.getByLabelText(label));
      await user.click(screen.getByRole('option', { name: option }));
    };
    await choose('Date range', '7 days');
    await waitFor(() => expect(currentSearch).toContain('range=7d'));
    await choose('Insight', 'Winning');
    await waitFor(() => expect(currentSearch).toContain('insight=winning'));
    await choose('Crawl indexability', 'Not crawl-indexable');
    await waitFor(() => expect(currentSearch).toContain('indexability=non_indexable'));
    await choose('Search visibility', 'Unmeasured');
    await waitFor(() => expect(currentSearch).toContain('visibility=unmeasured'));
    await choose('Sort by', 'Title');
    await waitFor(() => expect(currentSearch).toContain('sort=title'));
    await choose('Direction', 'Descending');
    await waitFor(() => expect(currentSearch).toContain('direction=desc'));
    await choose('Direction', 'Ascending');
    await waitFor(() => expect(currentSearch).not.toContain('direction='));
    await choose('Page size', '50 per page');
    await waitFor(() => expect(currentSearch).toContain('limit=50'));

    await choose('Insight', 'All insights');
    await waitFor(() => expect(currentSearch).not.toContain('insight='));
    await user.click(screen.getAllByRole('button', { name: /^Page/ })[0]!);
    await waitFor(() => expect(currentSearch).toContain('sort=url'));
    expect(currentSearch).not.toContain('direction=asc');
    await user.click(screen.getAllByRole('button', { name: /^Page/ })[0]!);
    await waitFor(() => expect(currentSearch).toContain('direction=desc'));
    await user.click(screen.getAllByRole('button', { name: /^Page/ })[0]!);
    await waitFor(() => expect(currentSearch).not.toContain('direction='));

    await user.click(screen.getAllByRole('button', { name: 'Inspect page' })[1]!);
    expect(currentSearch).toContain(`pageId=${PAGE_ID}`);
    await user.click(screen.getByRole('button', { name: 'Close page detail' }));
    await waitFor(() => expect(currentSearch).not.toContain('pageId='));
  }, 240_000);

  it('renders disabled pagination when the server has no next page', async () => {
    const response = listResponse();
    response.pageInfo.hasNext = false;
    response.pageInfo.nextCursor = null;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByText('Google Search Console');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('retains list data after background failures and retries the same stored query', async () => {
    const query = {
      range: '28d',
      q: '',
      insight: null,
      indexability: null,
      visibility: null,
      sort: 'opportunity',
      direction: 'desc',
      limit: 25,
      cursor: null,
    } as const;
    mockedList.mockResolvedValue(listResponse());
    const { store } = renderPanel();
    await screen.findByText('Google Search Console');

    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({ message: '' })));
    await act(async () => { await store.dispatch(loadPagesList({ siteId: 'site-1', query })); });
    expect(screen.getByText('The update failed, so the previous page data remains visible.')).toBeVisible();
    expect(screen.getAllByText('Example page').length).toBeGreaterThan(0);

    mockedList.mockResolvedValueOnce(listResponse());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Pages could not be loaded')).not.toBeInTheDocument());

    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({ message: 'Background source failed' })));
    await act(async () => { await store.dispatch(loadPagesList({ siteId: 'site-1', query })); });
    expect(screen.getByText('Background source failed')).toBeVisible();
  });

  it('runs refresh only after activation and announces success', async () => {
    const refreshed: PagesRefreshResponse = {
      refresh: {
        outcome: 'refreshed',
        source: 'gsc',
        cache: 'not_applicable',
        observedAt: '2026-08-10T12:00:00.000Z',
      },
      state: listResponse(),
    };
    mockedList.mockResolvedValue(listResponse());
    mockedRefresh.mockResolvedValue(refreshed);
    renderPanel();
    await screen.findByText('Google Search Console');
    expect(mockedRefresh).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Refresh' })[0]!);
    await waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('GSC observed data was refreshed successfully.')).toBeVisible();
  });

  it('retains the last snapshot on a transport refresh failure and retries explicitly', async () => {
    mockedList.mockResolvedValue(listResponse());
    mockedRefresh
      .mockRejectedValueOnce(new PagesClientError(requestError({
        kind: 'network',
        status: null,
        message: '',
        state: listResponse('gsc', 'stale'),
      })))
      .mockResolvedValueOnce({
        refresh: {
          outcome: 'empty',
          source: 'gsc',
          cache: 'not_applicable',
          observedAt: '2026-08-10T12:00:00.000Z',
        },
        state: listResponse(),
      });
    renderPanel();
    await screen.findByText('Google Search Console');
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Refresh' })[0]!);
    expect(await screen.findByText('Refresh failed')).toBeVisible();
    expect(screen.getByText('The last good data remains visible. Try the explicit refresh again when the source is available.')).toBeVisible();
    expect(screen.getAllByText('Example page').length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try refresh again' }));
    expect(await screen.findByText('GSC observed refresh completed with no page rows.')).toBeVisible();

    mockedRefresh.mockRejectedValueOnce(new PagesClientError(requestError({
      kind: 'network',
      status: null,
      message: 'Refresh transport interrupted',
      state: listResponse('gsc', 'stale'),
    })));
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Refresh' })[0]!);
    expect(await screen.findByText('Refresh transport interrupted')).toBeVisible();
  });

  it('renders localized no-data 404 and filtered-empty reset states', async () => {
    mockedList
      .mockRejectedValueOnce(new PagesClientError(requestError({
        kind: 'not_found',
        status: 404,
        code: 'PAGES_NOT_FOUND',
        message: '',
      })))
      .mockResolvedValueOnce(listResponse('gsc', 'empty', []));
    const { unmount } = renderPanel();
    expect(await screen.findByText('Site or page data was not found')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No matching pages')).toBeVisible();
    unmount();

    mockedList.mockResolvedValue(listResponse('gsc', 'empty', []));
    renderPanel('/sites/site-1?tab=pages&q=nothing');
    expect(await screen.findByText('No page matches the current search and filters. Reset them to return to the full stored inventory.')).toBeVisible();
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Reset filters' }).at(-1)!);
    await waitFor(() => expect(currentSearch).not.toContain('q='));
  });

  it('retries list transport errors and gracefully resets an invalid cursor', async () => {
    mockedList
      .mockRejectedValueOnce(new PagesClientError(requestError({ kind: 'network', status: null })))
      .mockResolvedValue(listResponse());
    renderPanel('/sites/site-1?tab=pages&cursor=expired');
    expect(await screen.findByText('Pages could not be loaded')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Google Search Console')).toBeVisible();

    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({
      kind: 'invalid_request',
      status: 400,
      code: 'PAGES_INVALID_CURSOR',
    })));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentSearch).not.toContain('cursor='));
  });
});

describe('PagesPanel locale and RTL', () => {
  it('renders Arabic copy, logical layout, and an RTL-side detail sheet', async () => {
    await changeLanguage('ar');
    mockedList.mockResolvedValue(listResponse());
    mockedDetail.mockResolvedValue(detailResponse());
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'الصفحات' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'فحص الصفحة' })[0]!);
    expect(await screen.findByRole('button', { name: 'إغلاق تفاصيل الصفحة' })).toBeVisible();
  });
});
