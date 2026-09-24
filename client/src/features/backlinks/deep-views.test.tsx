import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError, __resetCsrfTokenCacheForTests } from '@shared/api/client';
import type { ReportExportControlProps } from '@features/report-export';
import * as api from './api';
import {
  AnchorsView,
  BacklinksPanel,
  BacklinksWorkspace,
  BulkRankView,
  HistoryView,
  ReferringDomainsView,
  parseWorkspaceDomain,
} from './index';
import { initialState, backlinksReducer, cancelDeepPullPreview } from './store/slice';
import {
  loadLatestDeepPull,
  previewDeepPull as previewDeepPullThunk,
  submitDeepPull,
} from './store/thunks';
import { isBacklinkTab, useBacklinkTab } from './tabState';
import { bulkRankDomainsSchema } from './validation';
import { orderHistory } from './components/HistoryChart';
import { HistoryChart } from './components/HistoryChart';
import { SpendPreviewPanel } from './components/SpendPreviewPanel';
import { BacklinksWorkspaceRoute } from './components/BacklinksWorkspaceRoute';
import { backlinksRoutes } from './routes';
import type {
  BacklinkDeepRows,
  BacklinkPullType,
  BacklinkRun,
  DeepPullState,
  SpendPreview,
} from './types';

vi.mock('./api', () => ({
  fetchBacklinkRun: vi.fn(),
  fetchBacklinkRuns: vi.fn(),
  previewDeepPull: vi.fn(),
  startDeepPull: vi.fn(),
  fetchBacklinkSummary: vi.fn(),
  fetchBacklinksList: vi.fn(),
  refreshBacklinkSummary: vi.fn(),
  previewLinkGap: vi.fn(),
  startLinkGap: vi.fn(),
  fetchLinkGapRun: vi.fn(),
  previewToxicityReview: vi.fn(),
  startToxicityReview: vi.fn(),
  fetchToxicityRuns: vi.fn(),
  fetchToxicityReview: vi.fn(),
  downloadToxicityDisavow: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ kind, target }: ReportExportControlProps) => (
    <button
      type="button"
      data-testid="report-export-control"
      data-kind={kind}
      data-scope={target.scope}
    >
      Export report
    </button>
  ),
}));

const mocked = vi.mocked(api);
const globalFetchSpy = vi.spyOn(globalThis, 'fetch');
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const preview = (overrides: Partial<SpendPreview> = {}): SpendPreview => ({
  feature: 'link_intelligence',
  operation: 'anchors',
  cachedStatus: 'fresh_required',
  breakdown: [
    {
      operationKey: 'anchors',
      metric: 'link_intel_checks',
      productUnits: 1,
      cachedStatus: 'fresh_required',
    },
  ],
  estimatedAt: '2026-07-22T12:00:00.000Z',
  ...overrides,
});

function rowsFor(type: BacklinkPullType): BacklinkDeepRows {
  if (type === 'refDomains')
    return [
      {
        domain: 'strong.example',
        backlinks: 10,
        domainRank: 80,
        firstSeen: '2026-01-01T00:00:00.000Z',
        lastSeen: '2026-07-01T00:00:00.000Z',
      },
    ];
  if (type === 'anchors')
    return [{ anchor: '<script>alert(1)</script>', backlinks: 3, referringDomains: 2 }];
  if (type === 'history') return [{ year: 2026, month: 7, backlinks: 10, referringDomains: 4 }];
  return [{ domain: 'ranked.example', rank: 72 }];
}

function run(
  type: BacklinkPullType,
  status: BacklinkRun['status'] = 'succeeded',
  rows = rowsFor(type),
): BacklinkRun {
  return {
    runId: 'run-1',
    siteId: 'site-1',
    type,
    domain: 'example.com',
    inputs: { limit: type === 'history' ? 24 : 500, domains: [] },
    status,
    retainedCount: rows.length,
    refunded: status === 'failed' && rows.length === 0,
    createdAt: '2026-07-22T12:00:00.000Z',
    completedAt: '2026-07-22T12:01:00.000Z',
    result: {
      rows,
      observation: { capturedAt: '2026-07-22T12:01:00.000Z', source: 'provider_observation' },
    },
  };
}

const cleanDeep = (): DeepPullState => ({
  preview: null,
  run: null,
  previewLoading: false,
  runLoading: false,
  submitting: false,
  error: '',
  errorKind: null,
});

function makeStore(type: BacklinkPullType, state: Partial<DeepPullState> = {}) {
  const deepPulls = {
    refDomains: cleanDeep(),
    anchors: cleanDeep(),
    history: cleanDeep(),
    bulkRanks: cleanDeep(),
  };
  deepPulls[type] = { ...deepPulls[type], ...state };
  return configureStore({
    reducer: { backlinks: backlinksReducer },
    preloadedState: { backlinks: { ...initialState, siteId: 'site-1', deepPulls } },
  });
}

function renderView(
  type: BacklinkPullType,
  state: Partial<DeepPullState> = {},
  search = '',
) {
  const props = { siteId: 'site-1', domain: 'example.com', loadStored: false };
  const view =
    type === 'refDomains' ? (
      <ReferringDomainsView {...props} />
    ) : type === 'anchors' ? (
      <AnchorsView {...props} />
    ) : type === 'history' ? (
      <HistoryView {...props} />
    ) : (
      <BulkRankView {...props} />
    );
  return render(
    <Provider store={makeStore(type, state)}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/sites/site-1/backlinks${search}`]}>{view}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  __resetCsrfTokenCacheForTests();
});

describe.each([
  ['refDomains', 'referring domains'],
  ['anchors', 'anchors'],
  ['history', 'history'],
  ['bulkRanks', 'bulk rank'],
] as const)('%s deep-pull view state matrix', (type, _label) => {
  it.each([
    ['default', {}, `${type}-default`],
    ['loading', { runLoading: true }, `${type}-loading`],
    ['empty', { run: run(type, 'succeeded', []) }, `${type}-empty`],
    ['partial', { run: run(type, 'failed') }, `${type}-partial`],
    ['provider-failed', { run: run(type, 'failed', []) }, `${type}-provider-failed`],
    ['disabled', { errorKind: 'disabled' }, `${type}-disabled`],
  ] as Array<[string, Partial<DeepPullState>, string]>)('renders %s', (_label, state, testId) => {
    renderView(type, state);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('labels retained rows as provider observations', () => {
    renderView(type, { run: run(type) });
    expect(screen.getByTestId(`${type}-provenance`)).toHaveTextContent('Provider observation');
  });
});

describe('deep tables, security, sorting, and validation', () => {
  it('applies both URL-backed referring-domain filters and deterministic sort', () => {
    const rows = [
      { domain: 'weak.example', backlinks: 2, domainRank: 40, firstSeen: null, lastSeen: null },
      { domain: 'z.example', backlinks: 7, domainRank: 70, firstSeen: null, lastSeen: null },
      { domain: 'a.example', backlinks: 9, domainRank: 70, firstSeen: null, lastSeen: null },
    ];
    renderView(
      'refDomains',
      { run: run('refDomains', 'succeeded', rows) },
      '?tab=domains&minRank=50&minBacklinks=5&utm=x',
    );
    const table = screen.getByTestId('referring-domains-table');
    expect(table).not.toHaveTextContent('weak.example');
    expect(table.textContent?.indexOf('a.example')).toBeLessThan(
      table.textContent?.indexOf('z.example') ?? 0,
    );
  });

  it('sorts equal-strength domains alphabetically and renders nullable rank/dates', () => {
    const rows = [
      { domain: 'z.example', backlinks: 7, domainRank: 70, firstSeen: null, lastSeen: null },
      { domain: 'a.example', backlinks: 7, domainRank: 70, firstSeen: null, lastSeen: null },
      {
        domain: 'unknown.example',
        backlinks: 0,
        domainRank: null,
        firstSeen: null,
        lastSeen: null,
      },
    ];
    renderView('refDomains', { run: run('refDomains', 'succeeded', rows) });
    const table = screen.getByTestId('referring-domains-table');
    expect(table.textContent?.indexOf('a.example')).toBeLessThan(
      table.textContent?.indexOf('z.example') ?? 0,
    );
    expect(table).toHaveTextContent('unknown.example');
    expect(table).toHaveTextContent('—');
  });

  it('writes and clears URL-backed numeric and text filters', async () => {
    renderView('refDomains', { run: run('refDomains') }, '?tab=domains&utm=x');
    const rank = screen.getByLabelText('Minimum domain rank');
    await userEvent.type(rank, '70');
    expect(rank).toHaveValue(70);
    await userEvent.clear(rank);
    expect(rank).toHaveValue(null);
    const links = screen.getByLabelText('Minimum backlinks');
    await userEvent.type(links, '5');
    expect(links).toHaveValue(5);
    const rendered = renderView('anchors', { run: run('anchors') });
    await userEvent.type(screen.getByLabelText('Filter anchor text'), 'script');
    expect(screen.getByLabelText('Filter anchor text')).toHaveValue('script');
    rendered.unmount();
  });

  it('filters anchors from the URL and renders hostile HTML as inert text', () => {
    const rows = [
      { anchor: '<img src=x onerror=alert(1)>', backlinks: 4, referringDomains: 2 },
      { anchor: 'safe match', backlinks: 3, referringDomains: 2 },
    ];
    const rendered = renderView(
      'anchors',
      { run: run('anchors', 'succeeded', rows) },
      '?tab=anchors&anchor=%3Cimg',
    );
    expect(screen.getByTestId('anchors-table')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(screen.getByTestId('anchors-table')).not.toHaveTextContent('safe match');
    expect(rendered.container.querySelector('img')).toBeNull();
    expect(rendered.container.querySelector('script')).toBeNull();
  });

  it('orders and clamps history to the last 24 ascending points', () => {
    const points = Array.from({ length: 25 }, (_, index) => ({
      year: 2024 + Math.floor(index / 12),
      month: (index % 12) + 1,
      backlinks: index,
      referringDomains: index,
    }));
    const ordered = orderHistory([...points].reverse());
    expect(ordered).toHaveLength(24);
    expect(ordered[0]).toEqual(points[1]);
    expect(ordered.at(-1)).toEqual(points.at(-1));
  });

  it('normalizes 1..100 unique domains and rejects duplicates or unsafe values', () => {
    expect(bulkRankDomainsSchema.parse('WWW.Example.com, https://second.example')).toEqual([
      'example.com',
      'second.example',
    ]);
    expect(bulkRankDomainsSchema.safeParse('example.com\nexample.com').success).toBe(false);
    expect(bulkRankDomainsSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(
      bulkRankDomainsSchema.safeParse(
        Array.from({ length: 101 }, (_, index) => `d${index}.example`).join('\n'),
      ).success,
    ).toBe(false);
  });

  it('shows duplicate/invalid bulk feedback, then reveals the preview form for valid unique domains', async () => {
    renderView('bulkRanks');
    const field = screen.getByLabelText('Domains');
    fireEvent.change(field, { target: { value: 'example.com\nexample.com' } });
    fireEvent.blur(field);
    expect(await screen.findByRole('alert')).toHaveTextContent('Remove duplicate domains');
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } });
    fireEvent.blur(field);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter between 1 and 100');
    fireEvent.change(field, { target: { value: 'example.com\nsecond.example' } });
    fireEvent.blur(field);
    mocked.previewDeepPull.mockResolvedValue(preview({ operation: 'bulk-ranks' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Preview spend' }));
    await waitFor(() =>
      expect(mocked.previewDeepPull).toHaveBeenCalledWith({
        type: 'bulkRanks',
        domains: ['example.com', 'second.example'],
      }),
    );
    mocked.startDeepPull.mockResolvedValue({
      runId: 'bulk-run',
      siteId: 'site-1',
      type: 'bulkRanks',
      status: 'queued',
      reservedUnits: 1,
    });
    mocked.fetchBacklinkRun.mockResolvedValue(run('bulkRanks', 'queued', []));
    await userEvent.click(await screen.findByRole('button', { name: /Confirm and spend 1 units/ }));
    await waitFor(() =>
      expect(mocked.startDeepPull).toHaveBeenCalledWith({
        type: 'bulkRanks',
        siteId: 'site-1',
        domains: ['example.com', 'second.example'],
      }),
    );
  });

  it('guards hostile outbound URLs and uses the complete external rel', () => {
    const store = makeStore('anchors');
    store.dispatch({
      type: 'backlinks/loadList/fulfilled',
      payload: {
        rows: [
          {
            urlFrom: 'javascript:alert(1)',
            urlTo: 'https://example.com',
            anchor: '<script>x</script>',
            dofollow: true,
            isBroken: false,
            firstSeen: null,
            lastSeen: null,
          },
        ],
        nextCursor: null,
        cached: true,
      },
      meta: { arg: { siteId: 'site-1' }, requestId: 'x', requestStatus: 'fulfilled' },
    });
    const rendered = render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <BacklinksPanel siteId="site-1" view="rows" managedExternally />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    const link = rendered.container.querySelector('a');
    expect(link).toHaveAttribute('href', '#');
    expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(rendered.container.querySelector('script')).toBeNull();
  });

  it('renders a missing bulk rank with an em dash', () => {
    renderView('bulkRanks', {
      run: run('bulkRanks', 'succeeded', [{ domain: 'unknown.example', rank: null }]),
    });
    expect(screen.getByTestId('bulk-rank-table')).toHaveTextContent('—');
  });
});

describe('Link Intelligence deep-view accessibility', () => {
  it('keeps preview disabled until the workspace site domain has loaded', () => {
    const store = makeStore('refDomains');
    const renderDomain = (domain: string) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ReferringDomainsView
              siteId="site-1"
              domain={domain}
              loadStored={false}
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
    const rendered = render(renderDomain(''));
    expect(screen.getByTestId('link-intel-preview-refDomains')).toBeDisabled();
    rendered.rerender(renderDomain('example.com'));
    expect(screen.getByTestId('link-intel-preview-refDomains')).toBeEnabled();
  });

  it('supports keyboard-only traversal with visible focus styles in every deep form', async () => {
    const user = userEvent.setup();
    const cases = [
      {
        type: 'refDomains' as const,
        labels: ['Minimum domain rank', 'Minimum backlinks'],
        previewId: 'link-intel-preview-refDomains',
      },
      {
        type: 'anchors' as const,
        labels: ['Filter anchor text'],
        previewId: 'link-intel-preview-anchors',
      },
      {
        type: 'history' as const,
        labels: [],
        previewId: 'link-intel-preview-history',
      },
    ];

    for (const item of cases) {
      renderView(item.type);
      for (const label of item.labels) {
        await user.tab();
        const field = screen.getByLabelText(label);
        expect(field).toHaveFocus();
        expect(field.className).toContain('focus-visible:');
      }
      await user.tab();
      const previewButton = screen.getByTestId(item.previewId);
      expect(previewButton).toHaveFocus();
      expect(previewButton.className).toContain('focus-visible:');
      cleanup();
    }

    renderView('bulkRanks');
    await user.tab();
    const domains = screen.getByLabelText('Domains');
    expect(domains).toHaveFocus();
    expect(domains.className).toContain('focus-visible:');
    await user.type(domains, 'one.example');
    await user.tab();
    const bulkPreview = await screen.findByTestId('link-intel-preview-bulkRanks');
    await user.tab();
    await user.tab();
    expect(bulkPreview).toHaveFocus();
    expect(bulkPreview.className).toContain('focus-visible:');
  });

  it('sets RTL direction on every deep view under Arabic', async () => {
    await act(async () => changeLanguage('ar'));
    for (const [type, testId] of [
      ['refDomains', 'link-intel-view-domains'],
      ['anchors', 'link-intel-view-anchors'],
      ['history', 'link-intel-view-history'],
      ['bulkRanks', 'link-intel-view-bulk-ranks'],
    ] as const) {
      renderView(type);
      expect(screen.getByTestId(testId)).toHaveAttribute('dir', 'rtl');
      cleanup();
    }
  });

  it('mirrors the history axis and formats chart-table numerals in Arabic', async () => {
    await act(async () => changeLanguage('ar'));
    render(
      <I18nextProvider i18n={i18n}>
        <HistoryChart
          points={[
            { year: 2026, month: 1, backlinks: 1200, referringDomains: 300 },
            { year: 2026, month: 2, backlinks: 1500, referringDomains: 450 },
          ]}
        />
      </I18nextProvider>,
    );

    const chart = screen.getByTestId('link-history-chart');
    expect(chart.querySelector('svg')).toHaveAttribute('data-rtl', 'true');
    expect(chart).toHaveTextContent(new Intl.NumberFormat('ar').format(1200));
    expect(chart).toHaveTextContent(new Intl.NumberFormat('ar').format(450));
    expect(chart.querySelectorAll('path')[1]).toHaveAttribute(
      'd',
      expect.stringMatching(/^M 616 /),
    );
  });

  it('keeps the history chart static when reduced motion is requested', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HistoryChart points={rowsFor('history') as import('./types').HistoryPoint[]} />
      </I18nextProvider>,
    );
    const chart = screen.getByTestId('link-history-chart');
    expect(chart).toHaveAttribute('data-motion', 'static');
    expect(chart.className).toContain('motion-reduce:animate-none');
    for (const animatedSurface of chart.querySelectorAll('svg[role="img"], svg[role="img"] path')) {
      expect(animatedSurface.getAttribute('class')).toContain('motion-reduce:transition-none');
    }
  });
});

describe('secondary deep-view branches', () => {
  it('renders explicit provider, generic error, queued, and running states', () => {
    const cases: Array<[Partial<DeepPullState>, string]> = [
      [{ errorKind: 'providerFailed' }, 'anchors-provider-failed'],
      [{ error: 'wire broke', errorKind: 'unknown' }, 'anchors-error'],
      [{ run: run('anchors', 'queued', []) }, 'anchors-loading'],
      [{ run: run('anchors', 'running', []) }, 'anchors-loading'],
    ];
    for (const [state, testId] of cases) {
      const rendered = renderView('anchors', state);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      rendered.unmount();
    }
  });

  it('covers the spend-preview disclosure and loading branches', () => {
    const store = makeStore('anchors');
    const wrap = (node: React.ReactNode) =>
      render(
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
        </Provider>,
      );
    const loading = wrap(<SpendPreviewPanel preview={null} loading />);
    expect(screen.getByTestId('link-intel-preview-loading')).toBeInTheDocument();
    loading.unmount();
    const selfHost = wrap(<SpendPreviewPanel preview={preview()} loading={false} />);
    expect(selfHost.container).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
    selfHost.unmount();
    const empty = wrap(<SpendPreviewPanel preview={null} loading={false} />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it('renders history with zero, one, and multiple points', () => {
    const renderChart = (points: Parameters<typeof HistoryChart>[0]['points']) =>
      render(
        <I18nextProvider i18n={i18n}>
          <HistoryChart points={points} />
        </I18nextProvider>,
      );
    const zero = renderChart([]);
    expect(zero.container.querySelector('path')).toBeInTheDocument();
    zero.unmount();
    const many = renderChart([
      { year: 2026, month: 1, backlinks: 0, referringDomains: 0 },
      { year: 2026, month: 2, backlinks: 2, referringDomains: 1 },
    ]);
    expect(many.container.querySelector('svg[role="img"]')?.querySelectorAll('path')).toHaveLength(
      2,
    );
  });
});

describe('preview, cancel, confirm, and stored reads', () => {
  it('uses one unit in the confirmation label without inventing a quota', () => {
    renderView('anchors', { preview: preview() });
    expect(screen.getByTestId('link-intel-confirm-anchors')).toHaveTextContent(
      'Confirm and spend 1 units',
    );
  });

  it('cancel spends nothing; confirm calls the paid submit and then the stored-run GET', async () => {
    mocked.previewDeepPull.mockResolvedValue(preview());
    mocked.startDeepPull.mockResolvedValue({
      runId: 'run-1',
      siteId: 'site-1',
      type: 'anchors',
      status: 'queued',
      reservedUnits: 1,
    });
    mocked.fetchBacklinkRun.mockResolvedValue(run('anchors', 'queued', []));
    renderView('anchors');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Preview spend' }));
    await screen.findByTestId('link-intel-preview');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocked.startDeepPull).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Preview spend' }));
    await user.click(await screen.findByRole('button', { name: /Confirm and spend 1 units/ }));
    await waitFor(() =>
      expect(mocked.startDeepPull).toHaveBeenCalledWith({
        type: 'anchors',
        siteId: 'site-1',
        limit: 500,
      }),
    );
    expect(mocked.fetchBacklinkRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reopens the latest stored result using GET helpers only', async () => {
    mocked.fetchBacklinkRuns.mockResolvedValue({
      runs: [{ ...run('history'), result: undefined } as never],
      nextCursor: null,
    });
    mocked.fetchBacklinkRun.mockResolvedValue(run('history'));
    const props = { siteId: 'site-1', domain: 'example.com' };
    render(
      <Provider store={makeStore('history')}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <HistoryView {...props} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await screen.findByTestId('link-history-chart');
    expect(mocked.fetchBacklinkRuns).toHaveBeenCalled();
    expect(mocked.previewDeepPull).not.toHaveBeenCalled();
    expect(mocked.startDeepPull).not.toHaveBeenCalled();
  });

  it('handles an empty stored-run page without issuing a detail read', async () => {
    mocked.fetchBacklinkRuns.mockResolvedValue({ runs: [], nextCursor: null });
    const props = { siteId: 'site-1', domain: 'example.com' };
    render(
      <Provider store={makeStore('anchors')}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <AnchorsView {...props} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() => expect(mocked.fetchBacklinkRuns).toHaveBeenCalled());
    expect(mocked.fetchBacklinkRun).not.toHaveBeenCalled();
  });
});

function TabHarness() {
  const [tab, setTab] = useBacklinkTab();
  const location = useLocation();
  return (
    <>
      <output data-testid="active-tab">{tab}</output>
      <output data-testid="search">{location.search}</output>
      <button onClick={() => setTab('history')}>history</button>
    </>
  );
}

describe('URL-backed workspace tabs', () => {
  it('accepts only the seven closed workspace tab values', () => {
    for (const tab of ['overview', 'rows', 'domains', 'anchors', 'history', 'gap', 'toxicity']) {
      expect(isBacklinkTab(tab)).toBe(true);
    }
    expect(isBacklinkTab('unknown')).toBe(false);
    expect(isBacklinkTab(null)).toBe(false);
  });

  it('normalizes invalid values and preserves unrelated query params', async () => {
    render(
      <MemoryRouter initialEntries={['/links?tab=nope&utm=campaign']}>
        <TabHarness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('tab=overview'));
    expect(screen.getByTestId('search')).toHaveTextContent('utm=campaign');
  });

  it('survives reload-style remounts and browser back/forward navigation', async () => {
    const router = createMemoryRouter([{ path: '/links', element: <TabHarness /> }], {
      initialEntries: ['/links?tab=anchors&x=1', '/links?tab=history&x=1'],
      initialIndex: 1,
    });
    const rendered = render(<RouterProvider router={router} />);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('history');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent('anchors'));
    await act(() => router.navigate(1));
    await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent('history'));
    rendered.unmount();
    render(
      <MemoryRouter initialEntries={['/links?tab=history&x=1']}>
        <TabHarness />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('active-tab')).toHaveTextContent('history');
  });
});

describe('workspace composition', () => {
  function workspaceStore() {
    return configureStore({
      reducer: {
        backlinks: backlinksReducer,
        sites: (state = { items: [{ id: 'site-1', domain: 'example.com' }], loaded: true }) =>
          state,
      },
    });
  }

  it('renders all seven tabs, switches panels, and preserves unrelated params', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValue(null);
    mocked.fetchBacklinkRuns.mockResolvedValue({ runs: [], nextCursor: null });
    mocked.fetchToxicityRuns.mockResolvedValue({ runs: [], nextCursor: null });
    render(
      <Provider store={workspaceStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1/backlinks?tab=gap&utm=x']}>
            <BacklinksWorkspace siteId="site-1" />
            <LocationOutput />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    for (const tab of ['overview', 'rows', 'domains', 'anchors', 'history', 'gap', 'toxicity'])
      expect(screen.getByTestId(`link-intel-tab-${tab}`)).toBeInTheDocument();
    expect(screen.getByTestId('link-gap-workspace')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('link-intel-tab-anchors'));
    await waitFor(() =>
      expect(screen.getByTestId('location-output')).toHaveTextContent('tab=anchors'),
    );
    expect(screen.getByTestId('location-output')).toHaveTextContent('utm=x');
    await userEvent.click(screen.getByTestId('link-intel-tab-overview'));
    await waitFor(() => expect(mocked.fetchBacklinkSummary).toHaveBeenCalled());
    mocked.fetchBacklinksList.mockResolvedValue({
      rows: [],
      nextCursor: null,
      cached: true,
    });
    await userEvent.click(screen.getByTestId('link-intel-tab-rows'));
    await userEvent.click(screen.getByTestId('link-intel-tab-gap'));
    await userEvent.click(screen.getByTestId('link-intel-tab-toxicity'));
    await waitFor(() => expect(mocked.fetchToxicityRuns).toHaveBeenCalled());
    await userEvent.click(screen.getByTestId('link-intel-tab-overview'));
  });

  it('uses ?view= for embedded tabs while preserving the outer site tab', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValue(null);
    mocked.fetchToxicityRuns.mockResolvedValue({ runs: [], nextCursor: null });
    render(
      <Provider store={workspaceStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1?tab=backlinks&utm=x']}>
            <BacklinksWorkspace siteId="site-1" embedded />
            <LocationOutput />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );

    expect(screen.getByTestId('link-intel-tab-overview')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('location-output')).toHaveTextContent('tab=backlinks');
    expect(screen.getByTestId('location-output')).not.toHaveTextContent('view=');

    await userEvent.click(screen.getByTestId('link-intel-tab-toxicity'));
    await waitFor(() =>
      expect(screen.getByTestId('location-output')).toHaveTextContent('view=toxicity'),
    );
    expect(screen.getByTestId('location-output')).toHaveTextContent('tab=backlinks');
    expect(screen.getByTestId('location-output')).toHaveTextContent('utm=x');
    expect(screen.getByTestId('toxicity-workspace')).toBeInTheDocument();
  });

  it('traverses the seven URL tabs by keyboard with visible focus and Arabic direction', async () => {
    await act(async () => changeLanguage('ar'));
    mocked.fetchBacklinkSummary.mockResolvedValue(null);
    mocked.fetchBacklinkRuns.mockResolvedValue({ runs: [], nextCursor: null });
    render(
      <Provider store={workspaceStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1/backlinks?tab=overview']}>
            <BacklinksWorkspace siteId="site-1" />
            <LocationOutput />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('link-intelligence-workspace')).toHaveAttribute('dir', 'rtl');
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByTestId('report-export-control')).toHaveFocus();
    expect(screen.getByTestId('report-export-control')).toHaveAttribute(
      'data-kind',
      'backlinks.summary',
    );
    await user.tab();
    expect(screen.getByTestId('docs-link-link-intelligence')).toHaveFocus();
    await user.tab();
    const overview = screen.getByTestId('link-intel-tab-overview');
    expect(overview).toHaveFocus();
    expect(overview.className).toContain('focus-visible:');
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByTestId('location-output')).toHaveTextContent('tab=rows'),
    );
    expect(screen.getByTestId('link-intel-tab-rows')).toHaveFocus();
  });

  it('loads missing site context', async () => {
    globalFetchSpy
      .mockReset()
      .mockImplementation(async () => jsonResponse({ sites: [], nextCursor: null }));
    const store = configureStore({
      reducer: {
        backlinks: backlinksReducer,
        sites: (state = { items: [], loaded: false }) => state,
      },
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1/backlinks?tab=domains']}>
            <BacklinksWorkspace siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() => expect(globalFetchSpy).toHaveBeenCalled());
  });

  it('renders the route adapter with and without a site param and executes lazy route setup', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValue(null);
    const store = workspaceStore();
    const first = render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/route-site/backlinks']}>
            <BacklinksWorkspaceRoute />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('link-intelligence-workspace')).toBeInTheDocument();
    first.unmount();
    render(
      <Provider store={workspaceStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <BacklinksWorkspaceRoute />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('link-intelligence-workspace')).toBeInTheDocument();
    const lazy = backlinksRoutes[0]?.lazy;
    expect(lazy).toBeTypeOf('function');
    await lazy?.();
  });
});

function LocationOutput() {
  return <output data-testid="location-output">{useLocation().search}</output>;
}

describe('deep thunks and reducer failure branches', () => {
  it.each([
    [503, 'disabled'],
    [500, 'unknown'],
  ] as const)('classifies preview HTTP %s', async (status, kind) => {
    mocked.previewDeepPull.mockRejectedValue(
      new ApiError('x', status, { error: { message: 'failed' } }),
    );
    const store = makeStore('anchors');
    await store.dispatch(
      previewDeepPullThunk({ type: 'anchors', domain: 'example.com', limit: 10 }),
    );
    expect(store.getState().backlinks.deepPulls.anchors.errorKind).toBe(kind);
  });

  it('clears sibling previews and covers missing rejected payload reducer fallbacks', () => {
    const store = makeStore('anchors');
    store.dispatch({
      type: previewDeepPullThunk.fulfilled.type,
      payload: preview(),
      meta: { arg: { type: 'history' }, requestId: 'seed', requestStatus: 'fulfilled' },
    });
    store.dispatch({
      type: previewDeepPullThunk.pending.type,
      meta: { arg: { type: 'anchors' }, requestId: 'pending', requestStatus: 'pending' },
    });
    expect(store.getState().backlinks.deepPulls.history.preview).toBeNull();
    store.dispatch({
      type: previewDeepPullThunk.fulfilled.type,
      payload: preview(),
      meta: { arg: { type: 'anchors' }, requestId: 'x', requestStatus: 'fulfilled' },
    });
    expect(store.getState().backlinks.deepPulls.anchors.preview).not.toBeNull();
    for (const thunk of [previewDeepPullThunk, submitDeepPull, loadLatestDeepPull]) {
      store.dispatch({
        type: thunk.rejected.type,
        payload: undefined,
        meta: {
          arg: { type: 'anchors', siteId: 'site-1' },
          requestId: 'x',
          requestStatus: 'rejected',
          aborted: false,
        },
      });
    }
    expect(store.getState().backlinks.deepPulls.anchors.errorKind).toBe('unknown');
    store.dispatch(cancelDeepPullPreview('anchors'));
  });

  it('classifies submit failures and stored-read failures', async () => {
    mocked.startDeepPull.mockRejectedValueOnce(
      new ApiError('x', 503, { error: { message: 'off' } }),
    );
    const store = makeStore('anchors');
    await store.dispatch(submitDeepPull({ type: 'anchors', siteId: 'site-1', limit: 10 }));
    expect(store.getState().backlinks.deepPulls.anchors.errorKind).toBe('disabled');
    mocked.fetchBacklinkRuns.mockRejectedValueOnce(new Error('network'));
    await store.dispatch(loadLatestDeepPull({ siteId: 'site-1', type: 'anchors' }));
    expect(store.getState().backlinks.deepPulls.anchors.errorKind).toBe('unknown');
  });

  it('drops an aborted stored read and parses valid/invalid workspace domains', () => {
    const store = makeStore('anchors');
    store.dispatch({
      type: loadLatestDeepPull.rejected.type,
      payload: { error: 'x', kind: 'unknown' },
      meta: {
        arg: { type: 'anchors', siteId: 'site-1' },
        requestId: 'x',
        requestStatus: 'rejected',
        aborted: true,
      },
    });
    expect(store.getState().backlinks.deepPulls.anchors.error).toBe('');
    expect(parseWorkspaceDomain('WWW.Example.com')).toBe('example.com');
    expect(parseWorkspaceDomain('javascript:alert(1)')).toBe('');
  });
});

describe('deep API wire helpers', () => {
  const realApiPromise = vi.importActual<typeof import('./api')>('./api');
  const withCsrf = (body: unknown) =>
    globalFetchSpy
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(jsonResponse(body));

  it('posts preview and each submit body shape', async () => {
    const realApi = await realApiPromise;
    let spy = withCsrf(preview());
    await realApi.previewDeepPull({ type: 'anchors', domain: 'example.com', limit: 10 });
    expect(spy.mock.calls[1]?.[0]).toContain('/backlinks/deep/preview');
    __resetCsrfTokenCacheForTests();
    spy = withCsrf({ runId: 'r' });
    await realApi.startDeepPull({ type: 'bulkRanks', siteId: 's', domains: ['a.example'] });
    expect(spy.mock.calls[1]?.[0]).toContain('/backlinks/deep/bulk-ranks');
    __resetCsrfTokenCacheForTests();
    spy = withCsrf({ runId: 'r' });
    await realApi.startDeepPull({ type: 'history', siteId: 's', limit: 24 });
    expect(spy.mock.calls[1]?.[0]).toContain('/backlinks/deep/history');
    __resetCsrfTokenCacheForTests();
    spy = withCsrf({ runId: 'r' });
    await realApi.startDeepPull({ type: 'refDomains', siteId: 's' });
    expect(spy.mock.calls[1]?.[0]).toContain('/backlinks/deep/referring-domains');
  });

  it('reads run lists/details with and without AbortSignal init', async () => {
    const realApi = await realApiPromise;
    let spy = globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse({ runs: [] }));
    await realApi.fetchBacklinkRuns('site/id', 'anchors');
    expect(spy.mock.calls[0]?.[0]).toContain('siteId=site%2Fid&type=anchors&limit=1');
    spy = globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(run('anchors')));
    await realApi.fetchBacklinkRun('run/id');
    expect(spy.mock.calls[0]?.[0]).toContain('run%2Fid');
    const controller = new AbortController();
    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse({ runs: [] }));
    await realApi.fetchBacklinkRuns('s', 'history', { signal: controller.signal });
    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(run('history')));
    await realApi.fetchBacklinkRun('r', { signal: controller.signal });
  });
});
