import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import { initialState } from '../../store/slice';
import type {
  InventoryCannibalizationCandidate,
  InventoryPageFacts,
  InventoryRun,
  InventoryRunDetail,
  InventoryRunPage,
} from '../../types';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  listInventoryRuns: vi.fn(),
  getInventoryRun: vi.fn(),
  startInventory: vi.fn(),
  cancelInventory: vi.fn(),
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(hooks.state),
}));

vi.mock('../../api', () => api);

import { inventoryStatusTone } from './status';
import { ClusterView } from './ClusterView';
import { InternalLinksTable } from './InternalLinksTable';
import { CannibalizationList } from './CannibalizationList';
import { TopicalGaps } from './TopicalGaps';
import { InventoryProgress } from './InventoryProgress';
import { InventoryStartForm } from './InventoryStartForm';
import { InventoryTable } from './InventoryTable';
import { InventoryPanel } from './InventoryPanel';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { contentIntelligence: en } } });

function facts(overrides: Partial<InventoryPageFacts> = {}): InventoryPageFacts {
  return {
    url: 'https://example.com/page',
    canonical: null,
    statusCode: 200,
    robots: [],
    language: 'en',
    title: 'Title',
    description: null,
    headings: [],
    wordCount: 500,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 3,
    externalLinkCount: 1,
    internalOutLinks: [],
    contentHash: 'hash',
    primaryTopics: ['pricing'],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
    ...overrides,
  };
}

function page(url: string, overrides: Partial<InventoryPageFacts> = {}): InventoryRunPage {
  return { url, facts: facts({ url, ...overrides }) };
}

function run(overrides: Partial<InventoryRun> = {}): InventoryRun {
  return {
    runId: 'r1',
    siteId: 's1',
    origin: 'https://example.com',
    locale: 'en',
    status: 'completed',
    input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    progress: {
      pagesRequested: 20,
      pagesProcessed: 16,
      pagesFailed: 0,
      blocksReserved: 5,
      blocksRefunded: 0,
    },
    warnings: [],
    error: null,
    thresholdsVersion: 'v',
    findings: null,
    reservation: { key: 'k', reservedUnits: 5, refundedUnits: 0, refundedAt: null, refundReason: null },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: '2026-07-20T00:00:00Z',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<InventoryRunDetail> = {}): InventoryRunDetail {
  return { ...run(), pages: [], ...overrides };
}

function fullFindings() {
  return {
    version: 'v',
    thresholdsVersion: 'v',
    clusters: [{ id: 'c1', label: 'Pricing', urls: ['u1', 'u2'], sharedTerms: ['price', 'plan'] }],
    duplicates: [],
    thinPages: [],
    orphanPages: [],
    cannibalization: [
      {
        id: 'can1',
        query: 'best pricing',
        urls: ['https://example.com/a', 'https://example.com/b'],
        confidence: 'high' as const,
        evidenceSourceIds: ['gsc:x'],
        hasGscEvidence: true,
      },
    ],
    gaps: [{ id: 'g1', query: 'pricing calculator', confidence: 'medium' as const, evidenceSourceIds: ['rank:y'] }],
    opportunityExplanation: null as string | null,
  };
}

function setState(inventoryOverrides: Partial<typeof initialState.inventory> = {}) {
  hooks.state = {
    contentIntelligence: {
      ...initialState,
      inventory: { ...initialState.inventory, ...inventoryOverrides },
    },
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return action(hooks.dispatch, () => hooks.state, undefined);
    }
    return action;
  });
}

function LocationDisplay() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.search}</span>;
}

function renderInRouter(node: React.ReactNode, path = '/sites/s1?tab=content&view=inventory') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        {node}
        <LocationDisplay />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  hooks.dispatch.mockReset();
  for (const mock of Object.values(api)) mock.mockReset();
  api.listInventoryRuns.mockResolvedValue({ items: [], nextCursor: null });
  api.getInventoryRun.mockResolvedValue(detail());
  api.startInventory.mockResolvedValue({ runId: 'newrun', status: 'queued', reservedBlocks: 5, duplicate: false, message: 'ok' });
  api.cancelInventory.mockResolvedValue({ ok: true });
  setState();
  installThunkDispatch();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('inventoryStatusTone', () => {
  it('maps every status to a tone', () => {
    expect(inventoryStatusTone('queued')).toBe('warning');
    expect(inventoryStatusTone('crawling')).toBe('info');
    expect(inventoryStatusTone('analyzing')).toBe('info');
    expect(inventoryStatusTone('completed')).toBe('success');
    expect(inventoryStatusTone('partial')).toBe('warning');
    expect(inventoryStatusTone('failed')).toBe('destructive');
    expect(inventoryStatusTone('cancelled')).toBe('muted');
  });
});

describe('ClusterView', () => {
  it('renders empty and populated states', () => {
    const empty = renderInRouter(<ClusterView clusters={[]} />);
    expect(screen.getByTestId('inventory-clusters-empty')).toBeInTheDocument();
    empty.unmount();
    renderInRouter(
      <ClusterView clusters={[{ id: 'c1', label: 'Pricing', urls: ['u1', 'u2'], sharedTerms: ['price'] }]} />,
    );
    expect(screen.getByTestId('inventory-cluster-c1')).toHaveTextContent('Pricing');
    expect(screen.getByText('price')).toBeInTheDocument();
  });
});

describe('InternalLinksTable', () => {
  it('renders empty and computes inbound links from out-links', () => {
    const empty = renderInRouter(<InternalLinksTable pages={[]} />);
    expect(screen.getByTestId('inventory-links-empty')).toBeInTheDocument();
    empty.unmount();

    const pages = [
      page('https://example.com/a', { internalOutLinks: ['https://example.com/b', 'https://example.com/a', 'https://example.com/unknown'] }),
      page('https://example.com/b', { internalOutLinks: [], qualityFlags: ['orphan'] }),
    ];
    renderInRouter(<InternalLinksTable pages={pages} />);
    const rows = screen.getAllByTestId('inventory-link-row');
    expect(rows).toHaveLength(2);
    // page /a has 3 out-links (self + unknown counted in outbound); /b has 1 inbound (from /a).
    expect(rows[1]).toHaveTextContent('Orphan');
  });
});

describe('CannibalizationList', () => {
  it('renders empty, GSC evidence variants, and deep-links to a new analysis', async () => {
    const user = userEvent.setup();
    const emptyView = renderInRouter(<CannibalizationList candidates={[]} onStartAnalysis={vi.fn()} />);
    expect(screen.getByTestId('inventory-cannibalization-empty')).toBeInTheDocument();
    emptyView.unmount();

    const onStart = vi.fn();
    const candidates: InventoryCannibalizationCandidate[] = [
      { id: 'c1', query: 'q1', urls: ['https://example.com/a', 'https://example.com/b'], confidence: 'high', evidenceSourceIds: ['gsc:x'], hasGscEvidence: true },
      { id: 'c2', query: 'q2', urls: [], confidence: 'low', evidenceSourceIds: [], hasGscEvidence: false },
    ];
    renderInRouter(<CannibalizationList candidates={candidates} onStartAnalysis={onStart} />);
    expect(screen.getByTestId('inventory-cannibalization-gsc')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-cannibalization-nogsc')).toBeInTheDocument();
    await user.click(screen.getByTestId('inventory-cannibalization-start-c1'));
    expect(onStart).toHaveBeenCalledWith('q1', 'https://example.com/a');
    await user.click(screen.getByTestId('inventory-cannibalization-start-c2'));
    expect(onStart).toHaveBeenCalledWith('q2', '');
  });
});

describe('TopicalGaps', () => {
  it('renders empty and populated states', () => {
    const empty = renderInRouter(<TopicalGaps gaps={[]} />);
    expect(screen.getByTestId('inventory-gaps-empty')).toBeInTheDocument();
    empty.unmount();
    renderInRouter(
      <TopicalGaps
        gaps={[
          { id: 'g1', query: 'q1', confidence: 'high', evidenceSourceIds: ['a'] },
          { id: 'g2', query: 'q2', confidence: 'low', evidenceSourceIds: [] },
        ]}
      />,
    );
    expect(screen.getByTestId('inventory-gap-g1')).toHaveTextContent('q1');
    expect(screen.getByTestId('inventory-gap-g2')).toHaveTextContent('q2');
  });
});

describe('InventoryProgress', () => {
  it('renders counters, warnings, error, and a cancel affordance', async () => {
    const onCancel = vi.fn();
    renderInRouter(
      <InventoryProgress
        run={run({
          status: 'queued',
          progress: { pagesRequested: 20, pagesProcessed: 4, pagesFailed: 1, blocksReserved: 5, blocksRefunded: 3 },
          warnings: [
            { code: 'partialCrawl', messageKey: 'x', message: 'The crawl was partial.' },
            { code: 'mysteryCode', messageKey: 'y', message: 'Mystery warning.' },
          ],
          error: { category: 'crawl_failed', messageKey: 'k', retryable: false, terminal: true },
        })}
        onCancel={onCancel}
        cancelling={false}
      />,
    );
    expect(screen.getByTestId('inventory-progress-processed')).toHaveTextContent('4');
    expect(screen.getByTestId('inventory-progress-warnings')).toHaveTextContent('Mystery warning.');
    expect(screen.getByTestId('inventory-progress-error')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('inventory-progress-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('hides the cancel button on a terminal run and falls back on unknown error categories', () => {
    renderInRouter(
      <InventoryProgress
        run={run({
          status: 'completed',
          progress: { pagesRequested: 20, pagesProcessed: 16, pagesFailed: 0, blocksReserved: 5, blocksRefunded: 0 },
          error: { category: 'mystery', messageKey: 'k', retryable: false, terminal: true },
        })}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('inventory-progress-cancel')).toBeNull();
    // Unknown category → generic error copy.
    expect(screen.getByTestId('inventory-progress-error')).toHaveTextContent(
      'The run stopped before it finished.',
    );
  });
});

describe('InventoryStartForm', () => {
  it('shows the live block calc, validates non-empty inputs, and submits', async () => {
    const onStarted = vi.fn();
    renderInRouter(<InventoryStartForm siteId="s1" onStarted={onStarted} />);
    // Default page limit 20 → 5 blocks.
    expect(screen.getByTestId('inventory-form-blocks')).toHaveTextContent('5 block(s)');
    // Valid path + seed exercise the loop false-branches (length ok, regex ok).
    fireEvent.change(screen.getByTestId('inventory-form-allowed'), { target: { value: '/blog\n' } });
    fireEvent.change(screen.getByTestId('inventory-form-seeds'), {
      target: { value: 'https://example.com/sitemap.xml' },
    });
    fireEvent.submit(screen.getByTestId('inventory-form-submit').closest('form')!);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('newrun'));
    expect(api.startInventory).toHaveBeenCalledWith(
      expect.objectContaining({ allowedPaths: ['/blog'], sitemapSeeds: ['https://example.com/sitemap.xml'] }),
      expect.anything(),
    );
  });

  it('keeps a rejected submission visible with destructive guidance', async () => {
    setState({ submitError: 'Could not start' });
    const view = renderInRouter(<InventoryStartForm siteId="s1" />);
    expect(screen.getByTestId('inventory-form-server-error')).toHaveClass('text-destructive');
    api.startInventory.mockRejectedValueOnce(new Error('offline'));
    const onStarted = vi.fn();
    view.unmount();
    renderInRouter(<InventoryStartForm siteId="s1" onStarted={onStarted} />);
    fireEvent.submit(screen.getByTestId('inventory-form-submit').closest('form')!);
    await waitFor(() => expect(api.startInventory).toHaveBeenCalled());
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('surfaces each client-side validation error and the invalid-block hint', async () => {
    const cases: Array<[Partial<Record<'pagelimit' | 'allowed' | 'excluded' | 'seeds', string>>, string]> = [
      [{ pagelimit: '0' }, 'Enter a page count between one and 100.'],
      [{ allowed: Array.from({ length: 21 }, (_, i) => `/p${i}`).join('\n') }, 'Use at most 20 paths in each list.'],
      [{ allowed: 'no-slash' }, 'Each path must start with a slash (for example /blog).'],
      [{ allowed: `/${'a'.repeat(300)}` }, 'Each path must start with a slash (for example /blog).'],
      [{ seeds: Array.from({ length: 6 }, (_, i) => `https://x/${i}`).join('\n') }, 'Use at most five sitemap URLs.'],
      [{ seeds: `https://x/${'a'.repeat(2100)}` }, 'One of the sitemap URLs is too long.'],
    ];
    for (const [inputs, message] of cases) {
      const view = renderInRouter(<InventoryStartForm siteId="s1" />);
      if (inputs.pagelimit !== undefined) {
        fireEvent.change(screen.getByTestId('inventory-form-pagelimit'), { target: { value: inputs.pagelimit } });
      }
      if (inputs.allowed !== undefined) {
        fireEvent.change(screen.getByTestId('inventory-form-allowed'), { target: { value: inputs.allowed } });
      }
      if (inputs.seeds !== undefined) {
        fireEvent.change(screen.getByTestId('inventory-form-seeds'), { target: { value: inputs.seeds } });
      }
      fireEvent.submit(screen.getByTestId('inventory-form-submit').closest('form')!);
      expect(await screen.findByText(message)).toBeInTheDocument();
      if (inputs.pagelimit === '0') {
        expect(screen.getByTestId('inventory-form-blocks')).toHaveTextContent(
          'Enter a valid page count',
        );
      }
      view.unmount();
    }
  });

  it('clears the server error on edit, shows the in-flight state, and renders submit errors', () => {
    setState({ submitError: 'Could not start' });
    const view = renderInRouter(<InventoryStartForm siteId="s1" disabled />);
    expect(screen.getByTestId('inventory-form-in-flight')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-form-server-error')).toHaveTextContent('Could not start');
    // Editing clears the submit error.
    fireEvent.change(screen.getByTestId('inventory-form-excluded'), { target: { value: '/tag' } });
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contentIntelligence/clearInventorySubmitError' }),
    );
    // Disabled form no-ops on submit.
    fireEvent.submit(screen.getByTestId('inventory-form-submit').closest('form')!);
    expect(api.startInventory).not.toHaveBeenCalled();
    view.unmount();

    setState({ submitting: true });
    renderInRouter(<InventoryStartForm siteId="s1" />);
    expect(screen.getByTestId('inventory-form-submit')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('InventoryTable', () => {
  const pages = [
    ...Array.from({ length: 10 }, (_, i) => page(`https://example.com/p${i}`, { language: 'en' })),
    page('https://example.com/fr-page', { language: 'fr', qualityFlags: ['thin'], primaryTopics: ['tarifs'] }),
    page('https://example.com/orphan', { language: 'en', qualityFlags: ['orphan'], primaryTopics: ['pricing'] }),
    // A null-language page exercises the language-set skip + the "—" cell.
    page('https://example.com/nolang', { language: null }),
  ];

  it('renders the empty state', () => {
    renderInRouter(<InventoryTable pages={[]} />);
    expect(screen.getByTestId('inventory-table-empty')).toBeInTheDocument();
  });

  it('paginates, filters through URL params, and clears filters', async () => {
    const user = userEvent.setup();
    renderInRouter(<InventoryTable pages={pages} />);
    expect(screen.getByTestId('inventory-table-page')).toHaveTextContent('Page 1 of 2');
    expect(screen.getAllByTestId('inventory-page-row')).toHaveLength(10);
    await user.click(screen.getByTestId('inventory-table-next'));
    expect(screen.getByTestId('inventory-table-page')).toHaveTextContent('Page 2 of 2');
    await user.click(screen.getByTestId('inventory-table-prev'));
    expect(screen.getByTestId('inventory-table-page')).toHaveTextContent('Page 1 of 2');

    // URL text filter.
    fireEvent.change(screen.getByTestId('inventory-filter-url'), { target: { value: 'fr-page' } });
    expect(screen.getByTestId('loc').textContent).toContain('invUrl=fr-page');
    expect(screen.getAllByTestId('inventory-page-row')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('inventory-filter-url'), { target: { value: '' } });
    expect(screen.getByTestId('loc').textContent).not.toContain('invUrl=');

    // Topic filter.
    fireEvent.change(screen.getByTestId('inventory-filter-topic'), { target: { value: 'tarifs' } });
    expect(screen.getAllByTestId('inventory-page-row')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('inventory-filter-topic'), { target: { value: '' } });

    // Language Select filter (Radix combobox).
    const combos = screen.getAllByRole('combobox');
    await user.click(combos[0]!);
    await user.click(screen.getByRole('option', { name: 'fr' }));
    expect(screen.getByTestId('loc').textContent).toContain('invLang=fr');
    await user.click(combos[0]!);
    await user.click(screen.getByRole('option', { name: 'All languages' }));
    expect(screen.getByTestId('loc').textContent).not.toContain('invLang=');

    // Issue Select filter (select then reset to "All issues").
    await user.click(combos[1]!);
    await user.click(screen.getByRole('option', { name: 'Orphan' }));
    expect(screen.getByTestId('loc').textContent).toContain('invIssue=orphan');
    await user.click(combos[1]!);
    await user.click(screen.getByRole('option', { name: 'All issues' }));
    expect(screen.getByTestId('loc').textContent).not.toContain('invIssue=');

    // No-match + clear.
    fireEvent.change(screen.getByTestId('inventory-filter-url'), { target: { value: 'zzz-nomatch' } });
    expect(screen.getByTestId('inventory-table-nomatch')).toBeInTheDocument();
    await user.click(screen.getByTestId('inventory-table-clear'));
    expect(screen.getByTestId('loc').textContent).not.toContain('invUrl=');
  });

  it('clamps an out-of-range page cursor from the URL', () => {
    renderInRouter(<InventoryTable pages={pages} />, '/sites/s1?invPage=99&invUrl=p1');
    expect(screen.getByTestId('inventory-filter-url')).toHaveValue('p1');
    // /p1 matches p1 only among the ten en pages (single page of results).
    expect(screen.getByTestId('inventory-table-page')).toHaveTextContent('Page 1 of 1');
  });
});

describe('InventoryPanel — index', () => {
  it('renders loading, error+retry, and empty run states', async () => {
    setState({ listLoading: true, listLoaded: false });
    const loading = renderInRouter(<InventoryPanel siteId="s1" />);
    expect(loading.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    loading.unmount();

    setState({ listLoaded: true, listError: 'network down' });
    const errored = renderInRouter(<InventoryPanel siteId="s1" />);
    expect(screen.getByTestId('inventory-runs-error')).toHaveTextContent('network down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.listInventoryRuns).toHaveBeenCalled();
    errored.unmount();

    setState({ listLoaded: true });
    renderInRouter(<InventoryPanel siteId="s1" />);
    expect(screen.getByTestId('inventory-runs-empty')).toBeInTheDocument();
  });

  it('lists runs, disables the form while a run is in flight, loads more, and opens a run', async () => {
    const user = userEvent.setup();
    setState({
      listLoaded: true,
      nextCursor: 'next',
      runs: [
        run({ runId: 'active', status: 'crawling', requestedAt: null }),
        run({ runId: 'done', status: 'completed' }),
      ],
    });
    renderInRouter(<InventoryPanel siteId="s1" />);
    expect(screen.getByTestId('inventory-run-active')).toBeInTheDocument();
    // An active run disables the start form.
    expect(screen.getByTestId('inventory-form-submit')).toBeDisabled();
    await user.click(screen.getByTestId('inventory-runs-load-more'));
    expect(api.listInventoryRuns).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 's1', cursor: 'next' }),
      expect.anything(),
    );
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(screen.getByTestId('loc').textContent).toContain('invRun=active');
  });
});

describe('InventoryPanel — run detail', () => {
  it('shows detail loading and error states', () => {
    setState({ detailLoading: { r1: true } });
    const loading = renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=r1');
    expect(screen.getByTestId('inventory-detail-loading')).toBeInTheDocument();
    loading.unmount();

    setState({ detailError: { r1: 'not found' } });
    const errored = renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=r1');
    expect(screen.getByTestId('inventory-detail-error')).toHaveTextContent('not found');
    errored.unmount();

    setState({});
    renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=missing');
    expect(screen.getByTestId('inventory-detail-back')).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-detail')).toBeNull();
  });

  it('renders a completed run with all findings and navigates back', async () => {
    const user = userEvent.setup();
    setState({
      detail: {
        r1: detail({
          status: 'completed',
          findings: { ...fullFindings(), opportunityExplanation: 'Consolidate overlapping pages.' },
          pages: [page('https://example.com/a'), page('https://example.com/b', { qualityFlags: ['thin'] })],
        }),
      },
    });
    renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=r1');
    expect(screen.getByTestId('inventory-detail')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-opportunity')).toHaveTextContent('Consolidate');
    expect(screen.getByTestId('inventory-clusters')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-cannibalization')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-gaps')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-internal-links')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('inventory-detail-back'));
    expect(screen.getByTestId('loc').textContent).not.toContain('invRun=');
  });

  it('deep-links a cannibalization finding into a prefilled new analysis', async () => {
    const user = userEvent.setup();
    setState({
      detail: {
        r1: detail({ status: 'partial', findings: fullFindings(), pages: [page('https://example.com/a')] }),
      },
    });
    renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=r1');
    await user.click(screen.getByTestId('inventory-cannibalization-start-can1'));
    const loc = screen.getByTestId('loc').textContent!;
    expect(loc).toContain('view=analyses');
    expect(loc).toContain('prefillKeyword=best+pricing');
    expect(loc).toContain(encodeURIComponent('https://example.com/a'));
    expect(loc).not.toContain('invRun=');
  });

  it('renders the pending panel and cancels a non-terminal run', async () => {
    const user = userEvent.setup();
    setState({
      detail: { r1: detail({ status: 'queued', findings: null }) },
      cancelling: {},
    });
    renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=r1');
    expect(screen.getByTestId('inventory-detail-pending')).toBeInTheDocument();
    await user.click(screen.getByTestId('inventory-progress-cancel'));
    expect(api.cancelInventory).toHaveBeenCalledWith('s1', 'r1', expect.anything());
  });
});

describe('InventoryPanel — polling', () => {
  it('re-polls the runs list while a run is in flight', async () => {
    vi.useFakeTimers();
    setState({ listLoaded: true, runs: [run({ runId: 'x', status: 'crawling' })] });
    const view = renderInRouter(<InventoryPanel siteId="s1" />);
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.listInventoryRuns).toHaveBeenCalled();
    view.unmount();
  });

  it('re-polls a non-terminal run detail', async () => {
    vi.useFakeTimers();
    setState({ detail: { r1: detail({ status: 'crawling', findings: null }) } });
    const view = renderInRouter(<InventoryPanel siteId="s1" />, '/sites/s1?view=inventory&invRun=r1');
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.getInventoryRun).toHaveBeenCalled();
    view.unmount();
  });
});
