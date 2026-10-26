import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, createRef } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { PagesClientError } from '../error';
import { pagesReducer } from '../store/slice';
import { loadPagesList, refreshPages } from '../store/thunks';
import type {
  PagesCacheEntry,
  PageMetrics,
  PageRow,
  PagesDetailResponse,
  PagesEnvelope,
  PagesLastCrawl,
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
import {
  googleReducer,
  SiteGoogleReadinessProvider,
  type SiteGoogleReadiness,
} from '@features/google';

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
  crawlState: 'indexable',
  crawlEvidence: null,
  metrics: metrics(),
  associatedQueryState: 'observed',
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
  crawlState: 'non_indexable',
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

const panelTree = (
  store: ReturnType<typeof configureStore>,
  path: string,
  siteId: string,
  strict: boolean,
  readiness?: SiteGoogleReadiness,
) => {
  const panel = <PagesPanel siteId={siteId} />;
  const tree = (
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route
              path="/sites/:siteId"
              element={
                readiness ? (
                  // The site workspace provides one Google readiness.
                  <SiteGoogleReadinessProvider siteId={siteId} domain="example.com" readiness={readiness}>
                    {panel}
                  </SiteGoogleReadinessProvider>
                ) : (
                  panel
                )
              }
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
};

const renderPanel = (
  path = '/sites/site-1?tab=pages',
  options: { strict?: boolean; readiness?: SiteGoogleReadiness } = {},
) => {
  const store = configureStore({ reducer: { pages: pagesReducer, google: googleReducer } });
  const result = render(
    panelTree(store, path, 'site-1', options.strict ?? false, options.readiness),
  );
  return {
    store,
    ...result,
    /** Re-render the same router for another site (the route param stays). */
    showSite: (siteId: string) => result.rerender(panelTree(store, path, siteId, options.strict ?? false)),
  };
};

const detailEntry = (
  data: PagesDetailResponse | null,
  error: PagesRequestError | null = null,
): PagesCacheEntry<PagesDetailResponse> => ({
  data,
  loading: false,
  loaded: data !== null,
  invalidated: false,
  loadedAt: data !== null ? Date.now() : null,
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
    <MemoryRouter>
    <I18nextProvider i18n={i18n}>
      <PageDetailSheet
        siteId="site-1"
        entry={entry}
        loadState={loadState}
        open
        onOpenChange={onOpenChange}
        onRetry={onRetry}
        returnFocusRef={createRef<HTMLButtonElement>()}
      />
    </I18nextProvider>
    </MemoryRouter>,
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
    // the panel's own width picks the layout, so tablets get
    // the compact cards; the table needs about 56rem.
    expect(screen.getByTestId('pages-results')).toHaveClass('@container');
    expect(screen.getByTestId('pages-desktop-table').closest('.hidden')).toHaveClass('@4xl:block');
    expect(screen.getByTestId('pages-mobile-cards')).toHaveClass('@4xl:hidden', '@2xl:grid-cols-2');
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: /^\/a\?x=1$/ });
    expect(links[0]).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(links[0]).toHaveAttribute('target', '_blank');
    // The page cell shows the path, truncates it on one line, and keeps the
    // full URL in the tooltip instead of breaking it mid-word.
    expect(links[0]).toHaveAttribute('title', '⁨https://example.com/a?x=1⁩');
    expect(links[0]).not.toHaveClass('break-all');
    const desktopTitle = screen.getAllByText('Example page')[0]!.closest('span');
    expect(desktopTitle).toHaveClass('truncate');
    expect(desktopTitle).toHaveAttribute('title', '\u2066Example page\u2069');
    expect(screen.getByRole('columnheader', { name: /Page/ })).toHaveAttribute('aria-sort', 'none');

    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Inspect page' })[0]!);
    expect(await screen.findByTestId('pages-detail-sheet')).toBeInTheDocument();
    expect(await screen.findByText('example query')).toBeVisible();
    // The crawled page title in the sheet heading is isolated.
    const sheetTitle = screen.getByRole('heading', { name: 'Example page' });
    expect(sheetTitle.querySelector('bdi[dir="ltr"]')).toHaveTextContent('Example page');
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
      expect(await screen.findByText(source === 'demo' ? 'Demo ranking snapshot' : 'Ranking snapshot')).toBeVisible();
      expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(3);
      expect(screen.getAllByText(source === 'demo' ? 'Demo estimate' : 'Ranking estimate').length).toBeGreaterThan(0);
      expect(screen.getByText('This is one ranking snapshot. The date range changes only the history and comparison, not the totals.')).toBeVisible();
      expect(screen.getByText(source === 'demo'
        ? /not Google Search Console data or live ranking data/
        : /Clicks, impressions, and CTR are not available/)).toBeVisible();
    },
  );

  it('names the GSC window and explains why per-page totals differ from site totals', async () => {
    const response = listResponse();
    response.envelope.dataWindow = { startDate: '2026-07-10', endDate: '2026-08-06' };
    mockedList.mockResolvedValue(response);
    renderPanel();
    const note = await screen.findByTestId('pages-summary-note');
    expect(note).toHaveTextContent(
      'Per-page totals for Jul 10, 2026 – Aug 6, 2026, for the pages that match your filters.',
    );
    expect(note).toHaveTextContent(/can be higher than the site totals on the Google tab/);
    expect(note).toHaveTextContent(/weighted by each page's impressions/);
    // The same one-sentence scope note the Overview and Google tabs show.
    expect(screen.getByTestId('pages-scope-note')).toHaveTextContent(
      "Search Console counts each list on its own, so the rows in a list can add up to a little more or less than the site total.",
    );
  });

  it('keeps the aggregation note but omits dates when no GSC window is reported', async () => {
    mockedList.mockResolvedValue(listResponse());
    renderPanel();
    const note = await screen.findByTestId('pages-summary-note');
    expect(note).not.toHaveTextContent(/Per-page totals for/);
    expect(note).toHaveTextContent(/site totals on the Google tab/);
  });

  it('shows no GSC totals note for ranking-snapshot estimates', async () => {
    mockedList.mockResolvedValue(listResponse('dataforseo', 'ready', [fallbackPage()]));
    renderPanel();
    expect(await screen.findByText('Ranking snapshot')).toBeVisible();
    expect(screen.queryByTestId('pages-summary-note')).toBeNull();
  });

  it('names measured pages the crawl missed by path or by their crawled locale twin', async () => {
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', [
      page({ title: null, isIndexable: null, crawlState: 'not_in_crawl', displayUrl: 'example.com/episode-pass' }),
      page({
        pageId: PAGE_ID_B,
        title: 'Pricing',
        isIndexable: null,
        crawlState: 'not_in_crawl',
        displayUrl: 'example.com/pricing',
        crawledAs: 'example.com/en/pricing',
      }),
    ]));
    renderPanel();
    const rows = await screen.findAllByTestId('pages-desktop-row');
    expect(rows[0]!).toHaveTextContent('/episode-pass');
    expect(rows[0]!).toHaveTextContent('Not in the last crawl');
    expect(rows[1]!).toHaveTextContent('Pricing');
    expect(rows[1]!).toHaveTextContent('Crawled as /en/pricing');
    expect(screen.queryByText('Untitled page')).toBeNull();
  });

  it('renders audit-only pages as unmeasured and preserves null rather than zero', async () => {
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', [page(), page({
      pageId: PAGE_ID_B,
      performanceSource: null,
      title: null,
      isIndexable: null,
      crawlState: 'no_crawl',
      metrics: metrics({ clicks: null, impressions: null, ctr: null, averagePosition: null }),
      deltas: { positionChange: null, clickChangePct: null },
      insights: [],
    })]));
    renderPanel();
    expect((await screen.findAllByText('Unmeasured')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    // An untitled page is named by its path, never "Untitled page".
    expect(screen.queryByText('Untitled page')).toBeNull();
    expect(screen.getAllByText('No crawl yet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No current opportunity flag').length).toBeGreaterThan(0);
    // Missing values are a muted dash for sighted users and "Not available" for screen readers.
    const dash = screen.getAllByTestId('pages-not-available')[0]!;
    expect(dash).toHaveClass('text-muted-foreground');
    expect(dash.querySelector('[aria-hidden="true"]')).toHaveTextContent('—');
    expect(dash.querySelector('.sr-only')).toHaveTextContent('Not available');
    expect(screen.getAllByTestId('pages-page-cell')[1]!.parentElement).toHaveClass('sticky');
  });

  it('derives default columns from the source, offers only fillable columns, and lets each viewer pick, persist, and reset', async () => {
    window.localStorage.clear();
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', [page({
      insights: ['low_data'],
      metrics: metrics({ impressions: 3, averagePosition: 50.3, associatedQueryCount: 0 }),
      associatedQueryState: 'anonymized',
      deltas: { positionChange: null, clickChangePct: null },
    })]));
    const user = userEvent.setup();
    const view = renderPanel();
    await screen.findByText('Google Search Console');
    const header = (name: RegExp) => screen.queryByRole('columnheader', { name });

    // Search Console: observed columns, queries, and the change column show
    // even though this one row has no change; ranking-estimate columns start hidden.
    for (const shown of [/^Clicks/, /^Impressions/, /^Average position/, /^Queries/, /^Position change/]) {
      expect(header(shown)).not.toBeNull();
    }
    for (const hidden of [/^Best position/, /^Ranking keywords/, /^Search volume/, /^Difficulty/, /^Estimated traffic/]) {
      expect(header(hidden)).toBeNull();
    }
    expect(screen.getAllByText('Too little data').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await screen.findByText('Visible columns')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reset to defaults' })).toHaveAttribute('aria-disabled', 'true');
    // A column this source cannot fill is listed as such and cannot be switched on.
    const bestPosition = screen.getByRole('menuitemcheckbox', { name: /^Best position/ });
    expect(bestPosition).toHaveAttribute('aria-disabled', 'true');
    expect(bestPosition).toHaveTextContent('Not provided by this source');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Clicks' })).toHaveAttribute('aria-checked', 'true');
    // The menu stays open so several columns can be toggled in a row.
    for (const name of ['Clicks', 'Position change', 'Performance source', 'Crawl indexability', 'Insights']) {
      await user.click(screen.getByRole('menuitemcheckbox', { name }));
    }
    await user.keyboard('{Escape}');

    expect(header(/^Clicks/)).toBeNull();
    expect(header(/^Position change/)).toBeNull();
    expect(header(/^Performance source/)).toBeNull();
    expect(header(/^Crawl indexability/)).toBeNull();
    expect(header(/^Insights/)).toBeNull();
    expect(header(/^Impressions/)).not.toBeNull();
    expect(screen.queryByText('Too little data')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('rmf.pages.columns.v1')!)).toMatchObject({
      clicks: false, positionChange: false, source: false, crawl: false, insights: false,
    });

    // The choice survives a remount for the same viewer.
    view.unmount();
    renderPanel();
    await screen.findByText('Google Search Console');
    expect(header(/^Impressions/)).not.toBeNull();
    expect(header(/^Clicks/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset to defaults' }));
    await waitFor(() => expect(header(/^Clicks/)).not.toBeNull());
    expect(header(/^Position change/)).not.toBeNull();
    expect(window.localStorage.getItem('rmf.pages.columns.v1')).toBeNull();
  }, 60_000);

  it('keeps the same default columns whichever rows are on the page', async () => {
    window.localStorage.clear();
    // The first page has no change values and no queries at all; the defaults
    // come from the source and coverage, so the columns do not depend on it.
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', [page({
      metrics: metrics({ associatedQueryCount: null }),
      associatedQueryState: 'unavailable',
      deltas: { positionChange: null, clickChangePct: null },
    })]));
    renderPanel();
    await screen.findByText('Google Search Console');
    expect(screen.getByRole('columnheader', { name: /^Queries/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^Position change/ })).toBeInTheDocument();
  });

  it('hides every metric column when nothing is measured', async () => {
    window.localStorage.clear();
    const response = listResponse('gsc', 'ready', [page({
      performanceSource: null,
      insights: ['unmeasured'],
      metrics: metrics({ clicks: null, impressions: null, ctr: null, averagePosition: null, associatedQueryCount: null }),
      associatedQueryState: 'unavailable',
      deltas: { positionChange: null, clickChangePct: null },
    })]);
    response.envelope.coverage.measuredPages = 0;
    response.envelope.comparison.previousObservedAt = null;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByText('Google Search Console');
    for (const name of [/^Clicks/, /^Average position/, /^Queries/, /^Position change/]) {
      expect(screen.queryByRole('columnheader', { name })).toBeNull();
    }
  });

  it('retries a failed detail request and closes a missing detail without losing list context', async () => {
    mockedList.mockResolvedValue(listResponse());
    mockedDetail
      .mockRejectedValueOnce(new PagesClientError(requestError({ kind: 'network', status: null, message: '' })))
      .mockResolvedValueOnce(detailResponse());
    const { store } = renderPanel(`/sites/site-1?tab=pages&keep=1&pageId=${PAGE_ID}`);
    expect(await screen.findByText('Page detail could not be loaded')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('example query')).toBeVisible();
    expect(currentSearch).toContain('keep=1');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close page detail' }));
    // Reopening a loaded inspector is served from the store; only a page the
    // last Refresh made out of date asks the server again.
    act(() => {
      store.dispatch(refreshPages.pending('refresh', {
        siteId: 'site-1',
        query: {
          range: '28d', q: '', insight: null, indexability: null, visibility: null,
          sort: 'opportunity', direction: 'desc', limit: 25, cursor: null,
        },
        pageId: PAGE_ID,
      }));
    });
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
    // No lag reported → no lag sentence.
    expect(screen.queryByText(/reports Search Console data about/)).toBeNull();
    expect(screen.queryByText(/reporting-lag claim/)).toBeNull();
  });

  it('uses the unknown-language label for an unrecognized fallback market', async () => {
    const response = listResponse('dataforseo');
    response.envelope.market!.languageCode = '';
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByText(/Unknown language/)).toBeVisible();
  });
});

describe('PageDetailSheet — from the latest audit', () => {
  it('shows the crawl facts with units and links each open issue to its report finding', () => {
    const detail = detailResponse();
    detail.audit = {
      runId: 'run-1',
      facts: { clickDepth: 6, inboundInternalLinks: 1200, pageSizeBytes: 3_400_000, serverResponseMs: 2_400 },
      issues: [
        { ruleId: 'placeholder-text', bucket: 'fix-now', severity: 'critical', title: 'Placeholder text on live pages' },
        { ruleId: 'deep-pages', bucket: 'watch', severity: 'info', title: 'Pages buried deep in the site' },
      ],
    };
    renderDetailSheet(detailEntry(detail), 'ready');
    const card = screen.getByTestId('page-audit-card');
    expect(within(card).getByText('From the latest audit')).toBeVisible();
    const facts = within(card).getByTestId('page-audit-facts');
    expect(facts).toHaveTextContent('Clicks from home6');
    expect(facts).toHaveTextContent('Internal links to it1,200');
    expect(facts).toHaveTextContent('Page size3.4 MB');
    expect(facts).toHaveTextContent('First byte2.4 sec');
    const issues = within(card).getAllByTestId('page-audit-issue');
    expect(issues).toHaveLength(2);
    expect(issues[0]).toHaveTextContent('Fix now');
    expect(within(issues[0]!).getByRole('link', { name: 'Placeholder text on live pages' })).toHaveAttribute(
      'href',
      '/sites/site-1?tab=report&bucket=fix-now&finding=placeholder-text',
    );
    expect(issues[1]).toHaveTextContent('Watch');
  });

  it('says so when the audit found nothing open or did not crawl the page', () => {
    const clean = detailResponse();
    clean.audit = { runId: 'run-1', facts: {}, issues: [] };
    const first = renderDetailSheet(detailEntry(clean), 'ready');
    expect(screen.getByTestId('page-audit-no-issues')).toHaveTextContent('The latest audit found no open issues on this page.');
    expect(screen.queryByTestId('page-audit-facts')).toBeNull();
    first.unmount();

    const uncrawled = detailResponse();
    uncrawled.audit = null;
    renderDetailSheet(detailEntry(uncrawled), 'ready');
    expect(screen.getByTestId('page-audit-card')).toHaveTextContent('The latest audit did not crawl this page.');
  });

  it('lists only the facts the audit recorded', () => {
    const detail = detailResponse();
    detail.audit = { runId: 'run-1', facts: { clickDepth: 2 }, issues: [] };
    renderDetailSheet(detailEntry(detail), 'ready');
    const facts = screen.getByTestId('page-audit-facts');
    expect(facts).toHaveTextContent('Clicks from home2');
    expect(facts).not.toHaveTextContent('Page size');
  });

  it('shows no audit card for a server that does not send the audit view', () => {
    renderDetailSheet(detailEntry(detailResponse()), 'ready');
    expect(screen.queryByTestId('page-audit-card')).toBeNull();
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
      crawlState: 'non_indexable',
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

  it('shows the same crawl state in the list and the inspector, with the recorded cause', async () => {
    const redirected = page({
      title: 'Home',
      isIndexable: null,
      crawlState: 'redirected',
      crawlEvidence: {
        source: 'probe',
        statusCode: 200,
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
        contentType: 'text/html',
        failure: null,
        nonIndexableReason: null,
      },
      displayUrl: 'example.com/',
    });
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', [redirected]));
    renderPanel();
    const row = (await screen.findAllByTestId('pages-desktop-row'))[0]!;
    expect(row).toHaveTextContent('Redirects to /en');
    const detail = detailResponse();
    detail.page = redirected;
    renderDetailSheet(detailEntry(detail), 'ready');
    expect(screen.getByTestId('page-crawl-state')).toHaveTextContent('Redirects to /en');
    expect(screen.getByTestId('page-crawl-evidence')).toHaveTextContent('Final address: https://example.com/en');
    expect(screen.getByTestId('page-crawl-evidence')).toHaveTextContent('Redirect path: 301 /');
    expect(screen.getByTestId('page-crawl-evidence')).toHaveTextContent('Checked directly while the audit ran.');
  });

  it('explains a page that could not be read', () => {
    const detail = detailResponse();
    detail.page = page({
      isIndexable: null,
      crawlState: 'failed',
      crawlEvidence: {
        source: 'probe',
        statusCode: 404,
        finalUrl: null,
        redirectChain: [],
        contentType: 'text/html',
        failure: { kind: 'http_error', statusCode: 404 },
        nonIndexableReason: null,
      },
    });
    renderDetailSheet(detailEntry(detail), 'ready');
    expect(screen.getByTestId('page-crawl-state')).toHaveTextContent('Could not be read');
    expect(screen.getByTestId('page-crawl-evidence')).toHaveTextContent('The page answered HTTP 404.');
  });

  it('renders unknown crawl state and null query cells while filtering invalid trend points', () => {
    const detail = detailResponse();
    detail.page = page({ isIndexable: null, nonIndexableReason: null, crawlState: 'no_crawl' });
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
    expect(screen.getByTestId('page-crawl-state')).toHaveTextContent('No crawl yet');
    expect(screen.getByTestId('page-crawl-evidence')).toHaveTextContent(
      'Run an audit to see how this address crawls.',
    );
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(4);
    expect(screen.getByTestId('pages-trend-table')).toHaveTextContent('2');
  });
});

describe('PagesPanel status, controls, pagination, and refresh', () => {
  it.each([
    ['gsc', 'syncing', 'Search Console is syncing'],
    ['gsc', 'empty', 'No search data yet'],
    ['gsc', 'stale', 'Showing the last good data'],
    ['gsc', 'unavailable', 'Page data is unavailable'],
    ['dataforseo', 'empty', 'No search data yet'],
    ['dataforseo', 'stale', 'Showing the last good data'],
    ['none', 'empty', 'No search data yet'],
    ['none', 'unavailable', 'Page data is unavailable'],
  ] as const)('renders %s/%s state guidance without a Google CTA of its own', async (source, status, title) => {
    mockedList.mockResolvedValue(listResponse(source, status, []));
    renderPanel();
    expect(await screen.findByText(title)).toBeVisible();
    // Why Search Console isn't the source is the shared notice's job.
    expect(screen.queryByRole('link', { name: /Google/ })).not.toBeInTheDocument();
  });

  it.each([
    ['gsc_not_connected', 'not_connected', "Search Console isn't connected", 'Connect Google'],
    ['gsc_property_unmatched', 'no_property', 'Choose a Search Console property', 'Select a Search Console property'],
    ['gsc_property_unmatched', 'property_mismatch', "This property doesn't cover the site", 'Select a Search Console property'],
    ['gsc_needs_reconnect', 'not_connected', "Search Console isn't connected", 'Connect Google'],
    ['gsc_revoked', 'not_connected', "Search Console isn't connected", 'Connect Google'],
  ] as const)(
    'shows the shared Google readiness for %s / %s with exactly one CTA',
    async (fallbackReason, readiness, title, cta) => {
      const response = listResponse('none', 'empty', []);
      response.envelope.fallbackReason = fallbackReason;
      mockedList.mockResolvedValue(response);
      renderPanel(undefined, {
        readiness: {
          gsc: { status: readiness, matching: false },
          ga4: { status: 'no_property', matching: false },
        },
      });
      const notice = await screen.findByTestId('google-readiness-gsc');
      expect(notice).toHaveAttribute('data-status', readiness);
      expect(within(notice).getByText(title)).toBeVisible();
      const googleLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === '/sites/site-1?tab=google');
      expect(googleLinks).toHaveLength(1);
      expect(googleLinks[0]).toHaveTextContent(cta);
      // Not configured is not a failure: no red "unavailable" alert.
      expect(screen.queryByText('Page data is unavailable')).not.toBeInTheDocument();
    },
  );

  it('shows no Google notice once Search Console is usable', async () => {
    mockedList.mockResolvedValue(listResponse());
    renderPanel(undefined, {
      readiness: {
        gsc: { status: 'ok', matching: false },
        ga4: { status: 'ok', matching: false },
      },
    });
    expect(await screen.findByText('Google Search Console')).toBeVisible();
    expect(screen.queryByTestId('google-readiness-gsc')).not.toBeInTheDocument();
  });

  it('does not offer a fallback collection during a provider sync', async () => {
    const response = listResponse('dataforseo', 'syncing', []);
    response.envelope.fallbackReason = null;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByText('Search Console is syncing');
    // The header's one button refreshes; the notice offers no second collect button.
    expect(screen.queryByRole('button', { name: 'Get ranking data' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
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

    // A good entry is served from the store; Refresh marks it out of date, and
    // only an out-of-date entry reaches the network again.
    const markOutOfDate = () => act(() => {
      store.dispatch(refreshPages.pending('refresh', { siteId: 'site-1', query, pageId: null }));
    });
    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({ message: '' })));
    markOutOfDate();
    await act(async () => { await store.dispatch(loadPagesList({ siteId: 'site-1', query })); });
    expect(screen.getByText('The update failed, so the previous page data remains visible.')).toBeVisible();
    expect(screen.getAllByText('Example page').length).toBeGreaterThan(0);

    mockedList.mockResolvedValueOnce(listResponse());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Pages could not be loaded')).not.toBeInTheDocument());

    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({ message: 'Background source failed' })));
    markOutOfDate();
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
    expect(await screen.findByText('No search data yet')).toBeVisible();
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

describe('PagesPanel plain copy, one button, empty states and crawl evidence', () => {
  const lastCrawl = (patch: Partial<PagesLastCrawl> = {}): PagesLastCrawl => ({
    finishedAt: '2026-08-09T12:00:00.000Z',
    pageCap: 100,
    pagesStored: 1,
    vendorPagesCrawled: 1,
    stopReason: 'no_more_links',
    sitemapFound: false,
    ...patch,
  });

  it('describes the real control and offers exactly one collect button, with no Refresh it does not have', async () => {
    const response = listResponse('none', 'empty', [page({ performanceSource: null })]);
    response.summary = metrics({ clicks: null, impressions: null, ctr: null, averagePosition: null, associatedQueryCount: null });
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByText(
      'Each page is shown with the search data already stored for this site. New data is only collected when you ask for it.',
    )).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Get ranking data' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByText(/Collect fallback data|choose Refresh/)).toBeNull();
  });

  it('collapses the empty source into one neutral empty state: no metric cards and no alert', async () => {
    const response = listResponse('none', 'empty', [page({ performanceSource: null })]);
    response.summary = metrics({ clicks: null, impressions: null, ctr: null, averagePosition: null, associatedQueryCount: null });
    mockedList.mockResolvedValue(response);
    renderPanel();
    const empty = await screen.findByTestId('pages-no-data');
    expect(within(empty).getByText('No search data yet')).toBeVisible();
    expect(within(empty).getByText(
      'No search data is stored for these pages yet. Get ranking data to collect it.',
    )).toBeVisible();
    expect(screen.queryByTestId('pages-summary')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No matching pages')).toBeNull();
  });

  it('keeps a real failure as an alert and hides an all-empty metric grid behind it', async () => {
    const response = listResponse('gsc', 'unavailable', []);
    response.summary = metrics({ clicks: null, impressions: null, ctr: null, averagePosition: null, associatedQueryCount: null });
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Page data is unavailable');
    expect(screen.queryByTestId('pages-no-data')).toBeNull();
    expect(screen.queryByTestId('pages-summary')).toBeNull();
  });

  it('still shows the metric cards when stored data exists', async () => {
    mockedList.mockResolvedValue(listResponse('dataforseo', 'ready', [fallbackPage()]));
    renderPanel();
    expect(await screen.findByTestId('pages-summary')).toBeVisible();
    expect(screen.queryByTestId('pages-no-data')).toBeNull();
  });

  it.each([
    ['en', 0, 0, 'No pages are listed yet.'],
    ['en', 1, 0, 'Canonical pages with search data: 0 of 1.'],
    ['en', 2, 1, 'Canonical pages with search data: 1 of 2.'],
    ['ru', 1, 0, 'Канонические страницы с поисковыми данными: 0 из 1.'],
    ['ru', 5, 2, 'Канонические страницы с поисковыми данными: 2 из 5.'],
    ['ar', 2, 1, 'الصفحات الأساسية ذات بيانات البحث: 1 من 2.'],
    ['ar', 3, 1, 'الصفحات الأساسية ذات بيانات البحث: 1 من 3.'],
    ['zh', 1, 1, '有搜索数据的规范页面：1 / 1。'],
  ] as const)('keeps the measured and total canonical page counts independent in %s for %i pages', async (locale, inventory, measured, expected) => {
    await changeLanguage(locale);
    const response = listResponse();
    response.envelope.coverage.inventoryPages = inventory;
    response.envelope.coverage.measuredPages = measured;
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByTestId('pages-coverage')).toHaveTextContent(expected);
  });

  it('names skipped source rows only when there are some, and says the lag plainly', async () => {
    const response = listResponse();
    mockedList.mockResolvedValue(response);
    const { unmount } = renderPanel();
    expect(await screen.findByText('1 row from the data source was skipped because it could not be used.')).toBeVisible();
    expect(screen.getByText('Google reports Search Console data about 3 days late, so the most recent days are missing.')).toBeVisible();
    expect(screen.getByText('Search Console data for the last 28 days.')).toBeVisible();
    unmount();
    const clean = listResponse();
    clean.envelope.coverage.sourceRowsDropped = 0;
    mockedList.mockResolvedValue(clean);
    renderPanel();
    await screen.findByTestId('pages-coverage');
    expect(screen.queryByText(/skipped because/)).toBeNull();
    expect(screen.queryByText(/source rows accepted|inventory pages/)).toBeNull();
  });

  it.each([
    [lastCrawl(), 'Your last audit fetched 1 URL. It stopped because it found no more links to follow. Our crawler reads the HTML your server sends, so links that only appear after JavaScript runs are not followed.', true],
    [lastCrawl({ stopReason: 'page_limit', pagesStored: 100, sitemapFound: true }), 'Your last audit fetched 100 URLs, including redirects, duplicates and files that are not pages. It stopped at the page limit set for that audit.', false],
    [lastCrawl({ stopReason: 'stopped', sitemapFound: null }), 'Your last audit fetched 1 URL. The crawl was stopped before it finished.', false],
    [lastCrawl({ stopReason: 'crawler_error', sitemapFound: null }), 'Your last audit fetched 1 URL. The crawl service hit an error and stopped early.', false],
    [lastCrawl({ stopReason: null, pagesStored: null, sitemapFound: null }), 'The reason was not recorded for this older run. Run again', false],
    [lastCrawl({ stopReason: 'page_limit', stopReasonSource: 'derived', pageCap: 100, pagesStored: 100, sitemapFound: null }), 'Your last audit fetched 100 URLs, including redirects, duplicates and files that are not pages. It stopped at the page limit that applied at the time (100).', false],
    [lastCrawl({ stopReason: 'finished_below_limit', stopReasonSource: 'recorded', sitemapFound: null }), 'Your last audit fetched 1 URL. It finished on its own before reaching the page limit.', false],
  ] as const)('explains why the last crawl stopped from stored evidence (%#)', async (crawl, text, noSitemap) => {
    const response = listResponse('none', 'empty', [page({ performanceSource: null })]);
    response.envelope.coverage.lastCrawl = crawl;
    mockedList.mockResolvedValue(response);
    renderPanel();
    const note = await screen.findByTestId('pages-last-crawl');
    expect(note).toHaveTextContent(text);
    expect(within(note).getByTestId('pages-crawl-stop-reason')).toHaveAttribute('data-reason', crawl.stopReason ?? 'unrecorded');
    if (noSitemap) {
      expect(within(note).getByTestId('pages-crawl-no-sitemap')).toHaveTextContent('No sitemap was found to list more pages.');
    } else {
      expect(within(note).queryByTestId('pages-crawl-no-sitemap')).toBeNull();
    }
  });

  it('links a legacy run with no recorded reason to a new audit', async () => {
    const response = listResponse('none', 'empty', [page({ performanceSource: null })]);
    response.envelope.coverage.lastCrawl = lastCrawl({ stopReason: null, sitemapFound: null });
    mockedList.mockResolvedValue(response);
    renderPanel();
    const runAgain = await screen.findByTestId('crawl-stop-reason-run-again');
    expect(runAgain).toHaveAttribute('href', expect.stringContaining('?tab=report&retest=1'));
  });

  it('explains both counts and names redirect sources outside the inventory', async () => {
    const user = userEvent.setup();
    const response = listResponse();
    response.envelope.coverage.inventoryPages = 71;
    response.envelope.coverage.measuredPages = 8;
    response.envelope.coverage.redirectPages = 1;
    mockedList.mockResolvedValue(response);
    renderPanel();
    expect(await screen.findByTestId('pages-coverage')).toHaveTextContent('Canonical pages with search data: 8 of 71.');
    expect(screen.getByTestId('pages-coverage-redirects')).toHaveTextContent(
      '1 listed address redirects to one of these pages and is counted as that page.',
    );
    await user.click(screen.getByRole('button', { name: /Canonical pages/ }));
    expect((await screen.findAllByText(/Canonical pages are the unique pages we know about/))[0]).toBeInTheDocument();
  });

  it('hides the redirect line when no listed address redirects', async () => {
    const response = listResponse();
    response.envelope.coverage.redirectPages = 0;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByTestId('pages-coverage');
    expect(screen.queryByTestId('pages-coverage-redirects')).toBeNull();
  });

  it('shows no crawl note before any audit has completed', async () => {
    const response = listResponse();
    response.envelope.coverage.lastCrawl = null;
    mockedList.mockResolvedValue(response);
    renderPanel();
    await screen.findByTestId('pages-coverage');
    expect(screen.queryByTestId('pages-last-crawl')).toBeNull();
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

describe('PagesPanel request volume and viewport stability', () => {
  it('loads the list exactly once under StrictMode, including a remount', async () => {
    mockedList.mockResolvedValue(listResponse());
    renderPanel('/sites/site-1?tab=pages', { strict: true });
    expect(await screen.findByText('Google Search Console')).toBeVisible();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('serves Pages -> Overview -> Pages inside the freshness window from the store', async () => {
    mockedList.mockResolvedValue(listResponse());
    const first = renderPanel();
    await screen.findByText('Google Search Console');
    first.unmount();

    render(panelTree(first.store, '/sites/site-1?tab=pages', 'site-1', false));
    expect(await screen.findByText('Google Search Console')).toBeVisible();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('lets a request that was still loading when the panel unmounted finish into the store', async () => {
    let resolve: ((value: PagesListResponse) => void) | undefined;
    mockedList.mockImplementationOnce(() => new Promise((res) => { resolve = res; }));
    const first = renderPanel();
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(1));
    first.unmount();
    resolve?.(listResponse());

    render(panelTree(first.store, '/sites/site-1?tab=pages', 'site-1', false));
    expect(await screen.findByText('Google Search Console')).toBeVisible();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('loads a non-canonical URL once and rewrites it without a second request', async () => {
    mockedList.mockResolvedValue(listResponse());
    renderPanel('/sites/site-1?tab=pages&limit=25&range=28d&sort=opportunity&keep=1');
    expect(await screen.findByText('Google Search Console')).toBeVisible();
    await waitFor(() => expect(currentSearch).toBe('?keep=1&tab=pages'));
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('opens the inspector from a deep link with one detail request, also under StrictMode', async () => {
    mockedList.mockResolvedValue(listResponse());
    mockedDetail.mockResolvedValue(detailResponse());
    renderPanel(`/sites/site-1?tab=pages&pageId=${PAGE_ID}`, { strict: true });
    expect(await screen.findByText('example query')).toBeVisible();
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedDetail).toHaveBeenCalledTimes(1);
  });

  it('keeps the filters and table mounted, focused, and dimmed while a search loads, then swaps the rows', async () => {
    mockedList.mockResolvedValueOnce(listResponse());
    renderPanel();
    await screen.findByText('Google Search Console');
    const search = screen.getByLabelText('Search pages and queries');
    const table = screen.getByTestId('pages-desktop-table');
    const results = screen.getByTestId('pages-results');
    expect(results).toHaveAttribute('aria-busy', 'false');

    let resolveSearch: ((value: PagesListResponse) => void) | undefined;
    mockedList.mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve; }));
    await userEvent.setup().type(search, 'guide');
    await waitFor(() => expect(currentSearch).toContain('q=guide'), { timeout: 2000 });

    expect(screen.queryByTestId('pages-initial-skeleton')).toBeNull();
    expect(screen.getByLabelText('Search pages and queries')).toBe(search);
    expect(search).toBeEnabled();
    expect(search).toHaveFocus();
    expect(screen.getByTestId('pages-desktop-table')).toBe(table);
    expect(screen.getByTestId('pages-results')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('pages-summary')).toHaveClass('opacity-60');
    expect(screen.getAllByText('Example page').length).toBeGreaterThan(0);

    resolveSearch?.(listResponse('gsc', 'ready', [page({ title: 'Guide result' })]));
    expect((await screen.findAllByText('Guide result')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('pages-results')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByTestId('pages-summary')).not.toHaveClass('opacity-60');
    expect(screen.queryByText('Example page')).toBeNull();
  });

  it('hides the previous answer and offers a retry when the new query fails, keeping the filters usable', async () => {
    mockedList.mockResolvedValueOnce(listResponse());
    renderPanel();
    await screen.findByText('Google Search Console');
    const search = screen.getByLabelText('Search pages and queries');

    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({ message: 'Search failed' })));
    await userEvent.setup().type(search, 'guide');
    expect(await screen.findByText('Search failed', {}, { timeout: 3000 })).toBeVisible();
    // Rows for the old query are not passed off as results for the new one.
    expect(screen.queryAllByTestId('pages-desktop-row')).toHaveLength(0);
    expect(screen.queryByRole('navigation', { name: 'Pages pagination' })).toBeNull();
    expect(screen.getByLabelText('Search pages and queries')).toBe(search);

    mockedList.mockResolvedValueOnce(listResponse('gsc', 'ready', [page({ title: 'Recovered' })]));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findAllByText('Recovered')).length).toBeGreaterThan(0);
  });

  it('falls back to the default transport message when the failing query carries none', async () => {
    mockedList.mockResolvedValueOnce(listResponse());
    renderPanel();
    await screen.findByText('Google Search Console');
    mockedList.mockRejectedValueOnce(new PagesClientError(requestError({ message: '' })));
    await userEvent.setup().type(screen.getByLabelText('Search pages and queries'), 'x');
    expect(await screen.findByText(
      'The request did not complete. Check the connection and try again.',
      {},
      { timeout: 3000 },
    )).toBeVisible();
  });

  it('never shows another site\'s previous answer while the next site loads', async () => {
    mockedList.mockResolvedValueOnce(listResponse());
    const view = renderPanel();
    await screen.findByText('Google Search Console');
    mockedList.mockImplementationOnce(() => new Promise(() => {}));
    view.showSite('site-2');
    expect(await screen.findByTestId('pages-initial-skeleton')).toBeVisible();
    expect(screen.queryByText('Example page')).toBeNull();
  });
});

describe('PagesPanel associated-query semantics', () => {
  const rows = () => [
    page({ pageId: PAGE_ID, title: 'Observed page' }),
    page({
      pageId: PAGE_ID_B,
      title: 'Anonymized page',
      url: 'https://example.com/b',
      displayUrl: 'example.com/b',
      metrics: metrics({ impressions: 90, associatedQueryCount: 0 }),
      associatedQueryState: 'anonymized',
    }),
    page({
      pageId: 'c'.repeat(43),
      title: 'Audit only page',
      url: 'https://example.com/c',
      displayUrl: 'example.com/c',
      performanceSource: null,
      insights: ['unmeasured'],
      metrics: metrics({
        clicks: null, impressions: null, ctr: null, averagePosition: null, associatedQueryCount: null,
      }),
      associatedQueryState: 'unavailable',
    }),
  ];

  it('shows a real count, a dash with the reason for withheld queries, and a plain dash when unavailable, on desktop and mobile', async () => {
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', rows()));
    renderPanel();
    await screen.findAllByText('Anonymized page');

    const desktop = screen.getAllByTestId('pages-desktop-row');
    const mobile = screen.getAllByTestId('pages-mobile-card');
    for (const [index, expectedCount] of [[0, '2'], [1, null], [2, null]] as const) {
      for (const container of [desktop[index]!, mobile[index]!]) {
        if (expectedCount) expect(container).toHaveTextContent(expectedCount);
      }
    }
    // Withheld queries: never a bare "0", always the reason.
    const anonymized = screen.getAllByTestId('pages-queries-anonymized');
    expect(anonymized).toHaveLength(2);
    for (const cell of anonymized) {
      expect(cell).toHaveTextContent('—');
      expect(cell).toHaveTextContent('Queries hidden by Google');
      expect(cell).not.toHaveTextContent('0');
    }
    expect(within(mobile[1]!).getByTestId('pages-queries-anonymized')).toBeVisible();
    // Unavailable: the same quiet dash as every other missing value.
    expect(within(mobile[2]!).getAllByTestId('pages-not-available').length).toBeGreaterThan(0);
    expect(within(mobile[2]!).queryByTestId('pages-queries-anonymized')).toBeNull();
  });

  it('renders compact phone rows: title and Inspect share the first line, metrics sit in a tight grid', async () => {
    mockedList.mockResolvedValue(listResponse('gsc', 'ready', rows()));
    mockedDetail.mockResolvedValue(detailResponse());
    renderPanel();
    await screen.findAllByText('Anonymized page');

    const card = screen.getAllByTestId('pages-mobile-card')[0]!;
    // A tight card (not the default gap-6 / py-6 shell) ...
    expect(card).toHaveClass('gap-2', 'py-3');
    // ... whose Inspect action sits in the header beside the title ...
    const header = card.querySelector('[data-slot="card-header"]')!;
    const inspect = within(card).getByRole('button', { name: 'Inspect page' });
    expect(header).toContainElement(inspect);
    expect(inspect.closest('[data-slot="card-action"]')).not.toBeNull();
    expect(header.querySelector('[data-slot="card-title"]')).toHaveClass('line-clamp-2');
    // ... and whose metrics are a dense definition grid with visible labels.
    const grid = card.querySelector('dl')!;
    expect(grid).toHaveClass('grid-cols-2', 'min-[340px]:grid-cols-3', 'min-[380px]:grid-cols-4', 'text-xs');
    // Source, crawl state and insight chips share one wrapping line.
    const chipLine = card.querySelector('[data-slot="card-content"] > div')!;
    expect(chipLine).toHaveClass('flex-wrap');
    expect(within(chipLine as HTMLElement).getAllByText(/.+/).length).toBeGreaterThanOrEqual(2);
    expect(within(grid as HTMLElement).getAllByRole('term').length).toBeGreaterThan(0);
    // The path link keeps its safe-link contract at the smaller size.
    const path = within(card).getAllByRole('link')[0]!;
    expect(path).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(path).toHaveAttribute('target', '_blank');
    // Inspect still opens the inspector for that page.
    await userEvent.click(inspect);
    await waitFor(() => expect(mockedDetail).toHaveBeenCalled());
  });

  it('explains the same states in the inspector instead of a generic empty message', () => {
    const detail = detailResponse();
    detail.associated = { kind: 'queries', rows: [], total: 0, truncated: false };
    detail.page = rows()[1]!;
    const anonymized = renderDetailSheet(detailEntry(detail), 'ready');
    expect(screen.getByTestId('page-queries-empty')).toHaveTextContent(
      'Google reported impressions for this page but did not share the search terms behind them.',
    );
    expect(screen.getByText('Showing 0 of 0 associated rows.')).toBeVisible();
    anonymized.unmount();

    detail.associated = { kind: 'none', rows: [], total: 0, truncated: false };
    detail.page = rows()[2]!;
    renderDetailSheet(detailEntry(detail), 'ready');
    expect(screen.getByTestId('page-queries-empty')).toHaveTextContent(
      'No search query data is stored for this page yet.',
    );
    expect(screen.queryByText(/associated rows\./)).toBeNull();
  });
});
