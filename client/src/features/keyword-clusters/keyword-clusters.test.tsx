import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@shared/api/client';
import type { ReportExportControlProps } from '@features/report-export';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { BlockedKeywords } from './components/BlockedKeywords';
import { ClusterList } from './components/ClusterList';
import {
  KeywordClustersPage,
  keywordClusterLocale,
  ranksSurfaceHref,
} from './components/KeywordClustersPage';
import { NewRunPanel } from './components/NewRunPanel';
import { RunList } from './components/RunList';
import { StateNotice, type KeywordClusterNoticeKind } from './components/StateNotice';
import { keywordClusterGate } from './gate';
import type {
  KeywordCluster,
  KeywordClusterPreview,
  KeywordClusterRunDetail,
  KeywordClusterRunSummary,
  KeywordClusterUiState,
} from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ kind, target }: ReportExportControlProps) => (
    <div data-testid="report-export-control" data-kind={kind} data-scope={target.scope} />
  ),
}));

const mockedApi = vi.mocked(apiClient);
const SITE = 'a'.repeat(24);
const SECOND_SITE = 'c'.repeat(24);
const RUN = 'b'.repeat(24);
const DATE = '2026-08-04T10:00:00.000Z';
const kwId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let search = '';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

const groupedCluster = (overrides: Partial<KeywordCluster> = {}): KeywordCluster => ({
  id: 'cluster-1',
  size: 2,
  pivotKeywordId: kwId(1),
  sharedUrls: ['https://serp-1.example/a', 'https://serp-2.example/b'],
  members: [
    {
      keywordId: kwId(1),
      phrase: 'running shoes',
      observedAt: DATE,
      isPivot: true,
      sharedUrls: ['https://serp-1.example/a', 'https://serp-2.example/b'],
      sharedUrlCount: 4,
    },
    {
      keywordId: kwId(2),
      phrase: 'best running shoes',
      observedAt: DATE,
      isPivot: false,
      sharedUrls: ['https://serp-1.example/a', 'https://serp-2.example/b'],
      sharedUrlCount: 3,
    },
  ],
  label: 'Running shoes',
  labelSource: 'ai',
  ...overrides,
});

/** A cluster whose every rendered string is a hostile payload. */
const hostileCluster = (): KeywordCluster => ({
  id: 'cluster-2',
  size: 1,
  pivotKeywordId: kwId(3),
  sharedUrls: ['javascript:alert(1)<img src=x onerror=window.__urlPwned=1>'],
  members: [
    {
      keywordId: kwId(3),
      phrase: '<script>window.__phrasePwned=1</script>',
      observedAt: DATE,
      isPivot: true,
      sharedUrls: ['javascript:alert(1)<img src=x onerror=window.__urlPwned=1>'],
      sharedUrlCount: 1,
    },
  ],
  label: '=SUM(1)<svg onload=window.__labelPwned=1>',
  labelSource: 'ai',
});

const summary = (
  overrides: Partial<KeywordClusterRunSummary> = {},
): KeywordClusterRunSummary => ({
  id: RUN,
  siteId: SITE,
  status: 'completed',
  aiStatus: 'applied',
  rulesVersion: '2026-08-04.1',
  minSharedUrls: 3,
  topUrlWindow: 10,
  keywordCount: 3,
  blockedCount: 1,
  clusterCount: 2,
  groupedClusterCount: 1,
  requestedAt: DATE,
  startedAt: DATE,
  completedAt: DATE,
  error: null,
  ...overrides,
});

const detail = (
  overrides: Partial<KeywordClusterRunDetail> = {},
): KeywordClusterRunDetail => ({
  ...summary(),
  clusters: [groupedCluster(), hostileCluster()],
  blocked: [
    { keywordId: kwId(9), phrase: 'never checked', reason: 'missing', observedAt: null },
  ],
  ...overrides,
});

const readyPreview = (
  overrides: Partial<KeywordClusterPreview> = {},
): KeywordClusterPreview => ({
  ready: true,
  reason: null,
  readyCount: 3,
  blocked: [
    { keywordId: kwId(9), phrase: 'never checked', reason: 'missing', observedAt: null },
  ],
  blockedTotal: 1,
  minSharedUrls: 3,
  topUrlWindow: 10,
  freshnessDays: 7,
  minKeywords: 2,
  ...overrides,
});

interface ApiHandlers {
  sites?: () => unknown;
  list?: () => unknown;
  preview?: () => unknown;
  start?: () => unknown;
  run?: () => unknown;
}

const resolved = (fn: (() => unknown) | undefined, fallback: unknown) => {
  try {
    return Promise.resolve(fn ? fn() : fallback) as never;
  } catch (error) {
    return Promise.reject(error) as never;
  }
};

const routeApi = (handlers: ApiHandlers = {}) => {
  mockedApi.mockImplementation((path: string, options?: { method?: string }) => {
    if (/^\/sites\/[^/]+\/keywords(?:\?|$)/u.test(path)) {
      return Promise.resolve({
        keywords: [1, 2, 3].map((index) => ({
          id: kwId(index),
          phrase: `keyword ${index}`,
          active: true,
          engine: 'google',
        })),
        nextCursor: null,
      }) as never;
    }
    if (path.includes('/keyword-cluster-runs/preview')) {
      return resolved(handlers.preview, readyPreview());
    }
    if (
      path.startsWith('/sites/') &&
      path.endsWith('/keyword-cluster-runs') &&
      options?.method === 'POST'
    ) {
      return resolved(
        handlers.start,
        detail({ status: 'queued', aiStatus: 'pending', clusters: [] }),
      );
    }
    if (path.startsWith('/sites/') && path.endsWith('/keyword-cluster-runs')) {
      return resolved(handlers.list, { items: [summary()] });
    }
    if (path.startsWith('/keyword-cluster-runs/')) return resolved(handlers.run, detail());
    if (path === '/sites') {
      return resolved(handlers.sites, {
        sites: [
          { id: SITE, domain: 'example.test', displayName: 'Example' },
          { id: SECOND_SITE, domain: 'second.test', displayName: '' },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected API path: ${path}`)) as never;
  });
};

const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderWithI18n = (node: ReactNode, entry = `/sites/${SITE}?tab=keyword-clusters`) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        {node}
        <LocationProbe />
      </MemoryRouter>
    </I18nextProvider>,
  );

const renderPage = (entry = `/sites/${SITE}?tab=keyword-clusters`) =>
  renderWithI18n(<KeywordClustersPage siteId={SITE} />, entry);

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApi.mockReset();
  search = '';
  for (const key of ['__urlPwned', '__phrasePwned', '__labelPwned']) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('keywordClusterGate', () => {
  it.each([
    [404, 'notFound'],
    [409, 'notEnoughKeywords'],
    [429, 'rateLimited'],
    [503, 'disabled'],
    [500, 'failed'],
  ] as const)('maps HTTP %s to %s', (status, expected) => {
    expect(keywordClusterGate(new ApiError('nope', status, null))).toBe(expected);
  });

  it('treats a non-API failure as a generic failure', () => {
    expect(keywordClusterGate(new Error('offline'))).toBe('failed');
  });
});

describe('keywordClusterLocale and ranksSurfaceHref', () => {
  it('falls back to English for an unsupported language', () => {
    expect(keywordClusterLocale('ar')).toBe('ar');
    expect(keywordClusterLocale('it')).toBe('en');
    expect(keywordClusterLocale(undefined)).toBe('en');
  });

  it('deep-links to the ranks workspace of a site', () => {
    expect(ranksSurfaceHref(SITE)).toBe(`/sites/${SITE}?tab=keywords`);
  });
});

describe('StateNotice', () => {
  it.each([
    'disabled',
    'rateLimited',
    'notFound',
    'notEnoughKeywords',
    'failed',
    'emptyRuns',
    'emptyClusters',
  ] as const)('renders localized copy for %s', (kind: KeywordClusterNoticeKind) => {
    renderWithI18n(<StateNotice kind={kind} ranksHref="/sites/x?tab=ranks" />);
    expect(screen.getByTestId(`keyword-clusters-state-${kind}`)).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t(`states.${kind}.title`, { ns: 'keywordClusters' })),
    ).toBeInTheDocument();
  });

  it('offers the rank-check CTA only for the not-enough-keywords state', () => {
    const notEnough = renderWithI18n(
      <StateNotice kind="notEnoughKeywords" ranksHref="/sites/x?tab=ranks" />,
    );
    expect(screen.getByRole('link', { name: /run a rank check/i })).toHaveAttribute(
      'href',
      '/sites/x?tab=ranks',
    );
    notEnough.unmount();

    renderWithI18n(<StateNotice kind="notEnoughKeywords" />);
    expect(screen.queryByRole('link', { name: /run a rank check/i })).toBeNull();
  });

});

describe('BlockedKeywords', () => {
  it('renders nothing when no keyword was blocked', () => {
    const { container } = renderWithI18n(<BlockedKeywords blocked={[]} total={0} />);
    expect(container.querySelector('[data-testid="keyword-clusters-blocked"]')).toBeNull();
  });

  it.each(['missing', 'stale', 'empty'] as const)(
    'names the %s reason for every blocked keyword',
    async (reason) => {
      const user = userEvent.setup();
      renderWithI18n(
        <BlockedKeywords
          blocked={[
            {
              keywordId: kwId(9),
              phrase: 'blocked phrase',
              reason,
              observedAt: reason === 'missing' ? null : DATE,
            },
          ]}
          total={1}
          ranksHref="/sites/x?tab=ranks"
        />,
      );
      await user.click(screen.getByRole('button', { name: /could not take part/i }));
      const row = screen.getByTestId(`keyword-clusters-blocked-${reason}`);
      expect(within(row).getByText('blocked phrase')).toBeInTheDocument();
      expect(
        within(row).getByText(
          i18n.t(`blocked.reason.${reason}`, { ns: 'keywordClusters' }),
        ),
      ).toBeInTheDocument();
    },
  );

  it('discloses the honest overflow count', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <BlockedKeywords
        blocked={[
          { keywordId: kwId(9), phrase: 'one', reason: 'stale', observedAt: DATE },
        ]}
        total={25}
      />,
    );
    await user.click(screen.getByRole('button', { name: /could not take part/i }));
    expect(screen.getByText(/and 24 more/i)).toBeInTheDocument();
  });
});

describe('RunList', () => {
  it('summarizes each run and opens it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithI18n(
      <RunList runs={[summary()]} activeRunId={null} onOpen={onOpen} />,
    );
    expect(screen.getByText(/1 groups from 3 keywords/i)).toBeInTheDocument();
    await user.click(screen.getByTestId(`keyword-clusters-open-${RUN}`));
    expect(onOpen).toHaveBeenCalledWith(RUN);
  });

  it('marks the active run', () => {
    renderWithI18n(<RunList runs={[summary()]} activeRunId={RUN} onOpen={vi.fn()} />);
    expect(screen.getByTestId(`keyword-clusters-open-${RUN}`)).toBeInTheDocument();
  });
});

describe('ClusterList', () => {
  it('renders the AI label behind a suggestion marker', () => {
    renderWithI18n(
      <ClusterList
        clusters={[groupedCluster()]}
        openClusterId={null}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Running shoes')).toBeInTheDocument();
    expect(
      screen.getByTestId('keyword-cluster-label-suggestion-cluster-1'),
    ).toHaveTextContent(/ai suggestion/i);
  });

  it('falls back to an unnamed heading with no suggestion marker', () => {
    renderWithI18n(
      <ClusterList
        clusters={[groupedCluster({ label: null, labelSource: null })]}
        openClusterId={null}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/unnamed group/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId('keyword-cluster-label-suggestion-cluster-1'),
    ).toBeNull();
  });

  it('carries per-member evidence: observation date and overlap count', () => {
    renderWithI18n(
      <ClusterList
        clusters={[groupedCluster()]}
        openClusterId={null}
        onToggle={vi.fn()}
      />,
    );
    const member = screen.getByTestId(`keyword-cluster-member-${kwId(2)}`);
    expect(within(member).getByText(DATE)).toBeInTheDocument();
    expect(
      within(member).getByText(/3 shared with the reference keyword/i),
    ).toBeInTheDocument();
    const pivot = screen.getByTestId(`keyword-cluster-member-${kwId(1)}`);
    expect(within(pivot).getByText(/reference/i)).toBeInTheDocument();
    expect(within(pivot).getByText(/4 stored results compared/i)).toBeInTheDocument();
  });

  it('states honestly when no result is shared by every member', () => {
    renderWithI18n(
      <ClusterList
        clusters={[groupedCluster({ sharedUrls: [] })]}
        openClusterId={null}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/no single result is shared/i)).toBeInTheDocument();
  });

  it('toggles the overlap evidence panel through the URL-backed callback', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const view = renderWithI18n(
      <ClusterList
        clusters={[groupedCluster()]}
        openClusterId={null}
        onToggle={onToggle}
      />,
    );
    const toggle = screen.getByTestId('keyword-cluster-toggle-cluster-1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('cluster-1');
    view.unmount();

    renderWithI18n(
      <ClusterList
        clusters={[groupedCluster()]}
        openClusterId="cluster-1"
        onToggle={onToggle}
      />,
    );
    const open = screen.getByTestId('keyword-cluster-toggle-cluster-1');
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const evidence = screen.getByTestId('keyword-cluster-evidence-cluster-1');
    expect(within(evidence).getByText('https://serp-1.example/a')).toBeInTheDocument();
    await user.click(open);
    expect(onToggle).toHaveBeenLastCalledWith(null);
  });

  it('explains a singleton instead of pretending it was grouped', () => {
    renderWithI18n(
      <ClusterList
        clusters={[hostileCluster()]}
        openClusterId="cluster-2"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/not grouped/i)).toBeInTheDocument();
    expect(screen.getByText(/shared too few results/i)).toBeInTheDocument();
  });

  it('renders hostile phrases, URLs, and labels as inert text', () => {
    renderWithI18n(
      <ClusterList
        clusters={[hostileCluster()]}
        openClusterId="cluster-2"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('<script>window.__phrasePwned=1</script>')).toBeInTheDocument();
    expect(
      screen.getByText('=SUM(1)<svg onload=window.__labelPwned=1>'),
    ).toBeInTheDocument();
    // Never a link: a stored SERP URL is evidence, not a destination.
    expect(screen.queryByRole('link')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__phrasePwned).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__urlPwned).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__labelPwned).toBeUndefined();
  });
});

describe('NewRunPanel', () => {
  const props = {
    ranksHref: '/sites/x?tab=keywords',
    preview: null,
    previewing: false,
    starting: false,
    gate: null as KeywordClusterUiState | null,
    canPreview: true,
    onPreview: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  };

  it('surfaces an action gate instead of the form', () => {
    renderWithI18n(<NewRunPanel {...props} gate="disabled" />);
    expect(screen.getByTestId('keyword-clusters-state-disabled')).toBeInTheDocument();
  });

  it('shows the not-enough-keywords refusal with its blocked list', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <NewRunPanel
        {...props}
        preview={readyPreview({ ready: false, reason: 'notEnoughKeywords' })}
      />,
    );
    expect(
      screen.getByTestId('keyword-clusters-state-notEnoughKeywords'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /could not take part/i }));
    expect(screen.getByText('never checked')).toBeInTheDocument();
  });

  it('discloses the scope and method before confirmation', () => {
    renderWithI18n(<NewRunPanel {...props} preview={readyPreview()} />);
    expect(screen.getByTestId('keyword-clusters-preview')).toBeInTheDocument();
    const scopeDefinition = screen.getByTestId('keyword-clusters-preview-scope');
    expect(scopeDefinition).toHaveTextContent(/3 tracked keywords qualify/i);
    expect(scopeDefinition.previousElementSibling?.tagName).toBe('DT');
    expect(scopeDefinition.parentElement?.parentElement?.tagName).toBe('DL');
    expect(screen.getByText(/no search is sent to any provider/i)).toBeInTheDocument();
    expect(
      screen.getByText(/share at least 3 of their top 10 results/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Plan usage limits are not metered in self-hosted mode.'),
    ).toBeInTheDocument();
  });

  it('discloses that optional labels are included in the run unit', () => {
    renderWithI18n(<NewRunPanel {...props} preview={readyPreview()} />);
    expect(screen.getByText(/AI group labels are included/i)).toBeInTheDocument();
  });

  it('exposes busy state on both async controls', () => {
    const previewing = renderWithI18n(<NewRunPanel {...props} previewing />);
    expect(screen.getByTestId('keyword-clusters-preview-button')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    previewing.unmount();

    renderWithI18n(<NewRunPanel {...props} preview={readyPreview()} starting />);
    expect(screen.getByTestId('keyword-clusters-confirm')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByTestId('keyword-clusters-cancel')).toBeDisabled();
  });
});

describe('KeywordClustersPage', () => {
  it('lists the workspace site stored runs without writing a site param', async () => {
    routeApi();
    renderPage();
    expect(await screen.findByTestId('keyword-clusters-runs')).toBeInTheDocument();
    expect(search).not.toContain('siteId=');
    expect(screen.queryByRole('combobox', { name: 'Site' })).toBeNull();
  });

  it('shows the honest empty state when a site has no runs', async () => {
    routeApi({ list: () => ({ items: [] }) });
    renderPage();
    expect(
      await screen.findByTestId('keyword-clusters-state-emptyRuns'),
    ).toBeInTheDocument();
  });

  it.each([
    ['list', { list: () => Promise.reject(new ApiError('nope', 503, null)) }],
  ] as const)('surfaces a %s failure as a gate', async (_name, handlers) => {
    routeApi(handlers as ApiHandlers);
    renderPage();
    expect(
      await screen.findByTestId('keyword-clusters-state-disabled'),
    ).toBeInTheDocument();
  });

  it('previews, cancels without spending, then confirms and opens the run', async () => {
    const user = userEvent.setup();
    const start = vi.fn(() =>
      detail({ status: 'queued', aiStatus: 'pending', clusters: [] }),
    );
    routeApi({ start });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&view=new`);

    await user.click(await screen.findByTestId('keyword-clusters-preview-button'));
    expect(await screen.findByTestId('keyword-clusters-preview')).toBeInTheDocument();

    await user.click(screen.getByTestId('keyword-clusters-cancel'));
    expect(screen.queryByTestId('keyword-clusters-preview')).toBeNull();
    expect(start).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('keyword-clusters-preview-button'));
    await user.click(await screen.findByTestId('keyword-clusters-confirm'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(search).toContain(`run=${RUN}`));
  });

  it('maps a 409 on start to the not-enough-keywords state', async () => {
    const user = userEvent.setup();
    routeApi({ start: () => Promise.reject(new ApiError('nope', 409, null)) });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&view=new`);
    await user.click(await screen.findByTestId('keyword-clusters-preview-button'));
    await user.click(await screen.findByTestId('keyword-clusters-confirm'));
    expect(
      await screen.findByTestId('keyword-clusters-state-notEnoughKeywords'),
    ).toBeInTheDocument();
  });

  it('maps a 503 on preview to the disabled state', async () => {
    const user = userEvent.setup();
    routeApi({ preview: () => Promise.reject(new ApiError('off', 503, null)) });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&view=new`);
    await user.click(await screen.findByTestId('keyword-clusters-preview-button'));
    expect(await screen.findByTestId('keyword-clusters-state-disabled')).toBeInTheDocument();
  });

  it('renders a completed run: method line, clusters, and blocked keywords', async () => {
    routeApi();
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    expect(await screen.findByTestId('keyword-clusters-method')).toHaveTextContent(
      /at least 3 shared results out of the top 10/i,
    );
    expect(screen.getByTestId('keyword-cluster-cluster-1')).toBeInTheDocument();
    expect(screen.getByTestId('keyword-clusters-blocked')).toBeInTheDocument();
  });

  it('discloses that grouping is unchanged when naming was rejected', async () => {
    routeApi({ run: () => detail({ aiStatus: 'output_rejected' }) });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    expect(
      await screen.findByTestId('keyword-clusters-unlabeled'),
    ).toHaveTextContent(/naming never moves a keyword/i);
  });

  it('shows the failed state for a failed run', async () => {
    routeApi({ run: () => detail({ status: 'failed', clusters: [] }) });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    expect(
      await screen.findByTestId('keyword-clusters-state-failed'),
    ).toBeInTheDocument();
  });

  it('maps a 404 detail read to the not-found state', async () => {
    routeApi({ run: () => Promise.reject(new ApiError('nope', 404, null)) });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    expect(
      await screen.findByTestId('keyword-clusters-state-notFound'),
    ).toBeInTheDocument();
  });

  it('filters clusters by size through URL state', async () => {
    const user = userEvent.setup();
    routeApi();
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    await screen.findByTestId('keyword-cluster-cluster-1');
    expect(screen.getByTestId('keyword-cluster-cluster-2')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Group size' }));
    await user.click(await screen.findByRole('option', { name: 'Grouped keywords only' }));
    await waitFor(() => expect(search).toContain('size=grouped'));
    expect(screen.queryByTestId('keyword-cluster-cluster-2')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Group size' }));
    await user.click(await screen.findByRole('option', { name: 'Ungrouped keywords only' }));
    await waitFor(() => expect(search).toContain('size=singleton'));
    expect(screen.queryByTestId('keyword-cluster-cluster-1')).toBeNull();
  });

  it('shows the empty-clusters state when the filter hides everything', async () => {
    routeApi({ run: () => detail({ clusters: [groupedCluster()] }) });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}&size=singleton`);
    expect(
      await screen.findByTestId('keyword-clusters-state-emptyClusters'),
    ).toBeInTheDocument();
  });

  it('polls a queued run until it settles', async () => {
    const settled = deferred<KeywordClusterRunDetail>();
    let call = 0;
    routeApi({
      run: () => {
        call += 1;
        if (call === 1) return detail({ status: 'queued', clusters: [] });
        return settled.promise;
      },
    });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    expect(await screen.findByTestId('keyword-clusters-running')).toBeInTheDocument();
    settled.resolve(detail());
    expect(await screen.findByTestId('keyword-cluster-cluster-1')).toBeInTheDocument();
  });

  it('surfaces a poll failure as a gate', async () => {
    let call = 0;
    routeApi({
      run: () => {
        call += 1;
        if (call === 1) return detail({ status: 'processing', clusters: [] });
        return Promise.reject(new ApiError('nope', 429, null));
      },
    });
    renderPage(`/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    expect(
      await screen.findByTestId('keyword-clusters-state-rateLimited'),
    ).toBeInTheDocument();
  });

  it('normalizes invalid URL state instead of rendering a blank screen', async () => {
    routeApi();
    renderPage(
      `/sites/${SITE}?tab=keyword-clusters&view=bogus&run=bad&cluster=cluster-x&size=weird`,
    );
    await screen.findByTestId('keyword-clusters-page');
    await waitFor(() => expect(search).not.toContain('view=bogus'));
    await waitFor(() => expect(search).not.toContain('run=bad'));
    await waitFor(() => expect(search).not.toContain('cluster=cluster-x'));
    await waitFor(() => expect(search).not.toContain('size=weird'));
  });

  it('renders Arabic copy under the shipped RTL provider', async () => {
    await changeLanguage('ar');
    routeApi();
    renderPage();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: i18n.t('title', { ns: 'keywordClusters', lng: 'ar' }),
      }),
    ).toBeInTheDocument();
    expect(i18n.dir()).toBe('rtl');
    await changeLanguage('en');
  });
});
